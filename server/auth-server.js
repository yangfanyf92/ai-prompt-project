import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { connect as connectTls } from 'node:tls'

function parseEnvValue(rawValue = '') {
  const value = String(rawValue).trim()
  if (!value) return ''

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function loadEnvFile(filePath, protectedKeys) {
  if (!existsSync(filePath)) return

  const content = readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    if (!key || protectedKeys.has(key)) continue

    const rawValue = trimmed.slice(separatorIndex + 1)
    process.env[key] = parseEnvValue(rawValue)
  }
}

function loadLocalEnv() {
  const protectedKeys = new Set(Object.keys(process.env))
  loadEnvFile(resolve(process.cwd(), '.env'), protectedKeys)
  loadEnvFile(resolve(process.cwd(), '.env.local'), protectedKeys)
}

function extractEmailAddress(value = '') {
  const trimmed = String(value).trim()
  const matched = trimmed.match(/<([^>]+)>/)
  return normalizeEmail(matched ? matched[1] : trimmed)
}

loadLocalEnv()

const serverPort = Number(process.env.AUTH_SERVER_PORT || 8787)
const appOrigin = process.env.AUTH_APP_ORIGIN || 'http://localhost:5173'
const sessionCookieName = 'ai_prompt_auth_session'
const verificationExpireMs = 5 * 60 * 1000
const sessionExpireMs = 30 * 24 * 60 * 60 * 1000
const dbPath = resolve(process.cwd(), 'server', 'data', 'auth.sqlite')

mkdirSync(dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS verification_codes (
    email TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`)

try {
  db.exec(`ALTER TABLE users ADD COLUMN phone TEXT`)
} catch {}

const findUserByEmailStmt = db.prepare(`
  SELECT id, email, name, phone, password_hash, password_salt, created_at, last_login_at
  FROM users
  WHERE email = ?
`)
const findUserByPhoneStmt = db.prepare(`
  SELECT id
  FROM users
  WHERE phone = ?
`)
const findUserByIdStmt = db.prepare(`
  SELECT id, email, name, phone, created_at, last_login_at
  FROM users
  WHERE id = ?
`)
const insertUserStmt = db.prepare(`
  INSERT INTO users (id, email, name, phone, password_hash, password_salt, created_at, last_login_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)
const upsertVerificationStmt = db.prepare(`
  INSERT INTO verification_codes (email, code, expires_at, created_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(email) DO UPDATE SET
    code = excluded.code,
    expires_at = excluded.expires_at,
    created_at = excluded.created_at
`)
const findVerificationStmt = db.prepare(`
  SELECT email, code, expires_at
  FROM verification_codes
  WHERE email = ?
`)
const deleteVerificationStmt = db.prepare(`
  DELETE FROM verification_codes
  WHERE email = ?
`)
const insertSessionStmt = db.prepare(`
  INSERT INTO sessions (session_id, user_id, expires_at, created_at)
  VALUES (?, ?, ?, ?)
`)
const findSessionStmt = db.prepare(`
  SELECT session_id, user_id, expires_at
  FROM sessions
  WHERE session_id = ?
`)
const deleteSessionStmt = db.prepare(`
  DELETE FROM sessions
  WHERE session_id = ?
`)
const deleteExpiredSessionsStmt = db.prepare(`
  DELETE FROM sessions
  WHERE expires_at < ?
`)
const deleteExpiredCodesStmt = db.prepare(`
  DELETE FROM verification_codes
  WHERE expires_at < ?
`)
const updateLastLoginStmt = db.prepare(`
  UPDATE users
  SET last_login_at = ?
  WHERE id = ?
`)

function createId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${randomBytes(8).toString('hex')}`
}

function nowText(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase()
}

function isValidEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '').slice(0, 11)
}

function isValidPhone(value = '') {
  return /^1[3-9]\d{9}$/.test(value)
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex')
  return { salt, hash }
}

function verifyPassword(password, salt, expectedHash) {
  const computed = Buffer.from(scryptSync(password, salt, 64).toString('hex'), 'utf8')
  const expected = Buffer.from(expectedHash, 'utf8')
  return computed.length === expected.length && timingSafeEqual(computed, expected)
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolveBody(text ? JSON.parse(text) : {})
      } catch {
        rejectBody(new Error('请求体不是有效的 JSON。'))
      }
    })
    req.on('error', rejectBody)
  })
}

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(
    header
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf('=')
        if (index === -1) return [item, '']
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))]
      }),
  )
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  })
  res.end(JSON.stringify(payload))
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || appOrigin
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
}

function setSessionCookie(res, sessionId, expiresAt) {
  const secure = appOrigin.startsWith('https://') ? '; Secure' : ''
  const cookie = `${sessionCookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure}`
  res.setHeader('Set-Cookie', cookie)
}

function clearSessionCookie(res) {
  const secure = appOrigin.startsWith('https://') ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(0).toUTCString()}${secure}`)
}

function sanitizeUser(userRow) {
  if (!userRow) return null
  return {
    id: userRow.id,
    email: userRow.email,
    name: userRow.name,
    phone: userRow.phone || '',
    createdAt: nowText(Number(userRow.created_at)),
    lastLoginAt: nowText(Number(userRow.last_login_at)),
  }
}

async function sendVerificationEmail(email, code) {
  const smtpHost = process.env.AUTH_SMTP_HOST
  const smtpPort = Number(process.env.AUTH_SMTP_PORT || 465)
  const smtpUser = process.env.AUTH_SMTP_USER
  const smtpPass = process.env.AUTH_SMTP_PASS
  const smtpFrom = process.env.AUTH_SMTP_FROM
  const smtpEnvelopeFrom = extractEmailAddress(smtpFrom)

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    throw new Error('邮件服务未配置，请先补全 AUTH_SMTP_HOST、AUTH_SMTP_USER、AUTH_SMTP_PASS、AUTH_SMTP_FROM。')
  }
  if (!isValidEmail(smtpEnvelopeFrom)) {
    throw new Error('发件人地址格式不正确，请检查 AUTH_SMTP_FROM。')
  }

  const body = [
    `From: ${smtpFrom}`,
    `To: ${email}`,
    'Subject: =?UTF-8?B?QUkg6L+Q6ZWc5o+Q56S65q2N6aKM5Y+3IOazqOWGjA==?=',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    `你的注册验证码是：${code}`,
    '',
    '验证码 5 分钟内有效，请尽快完成注册。',
    '',
    '如果这不是你的操作，请忽略本邮件。',
    '',
  ].join('\r\n')

  await sendMailViaSmtp({
    host: smtpHost,
    port: smtpPort,
    username: smtpUser,
    password: smtpPass,
    from: smtpEnvelopeFrom,
    recipient: email,
    message: body,
  })
}

function sendMailViaSmtp({ host, port, username, password, from, recipient, message }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = connectTls({
      host,
      port,
      servername: host,
      rejectUnauthorized: true,
    })

    let buffer = ''
    let step = 0

    function sendLine(line) {
      socket.write(`${line}\r\n`)
    }

    function nextStep() {
      step += 1
      if (step === 1) sendLine(`EHLO ${host}`)
      if (step === 2) sendLine('AUTH LOGIN')
      if (step === 3) sendLine(Buffer.from(username, 'utf8').toString('base64'))
      if (step === 4) sendLine(Buffer.from(password, 'utf8').toString('base64'))
      if (step === 5) sendLine(`MAIL FROM:<${from}>`)
      if (step === 6) sendLine(`RCPT TO:<${recipient}>`)
      if (step === 7) sendLine('DATA')
      if (step === 8) socket.write(`${message}\r\n.\r\n`)
      if (step === 9) sendLine('QUIT')
    }

    function handleResponse(line) {
      const code = Number(line.slice(0, 3))
      if ([220, 235, 250, 251, 334, 354, 221].includes(code) === false) {
        rejectPromise(new Error(`邮件发送失败：${line}`))
        socket.destroy()
        return
      }

      if (line.startsWith('220') && step === 0) return nextStep()
      if (line.startsWith('250') && step === 1) return nextStep()
      if (line.startsWith('334') && step === 2) return nextStep()
      if (line.startsWith('334') && step === 3) return nextStep()
      if (line.startsWith('235') && step === 4) return nextStep()
      if ((line.startsWith('250') || line.startsWith('251')) && step === 5) return nextStep()
      if ((line.startsWith('250') || line.startsWith('251')) && step === 6) return nextStep()
      if (line.startsWith('354') && step === 7) return nextStep()
      if (line.startsWith('250') && step === 8) return nextStep()
      if (line.startsWith('221') && step === 9) {
        socket.end()
        resolvePromise()
      }
    }

    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n')
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (!line) continue
        if (/^\d{3}-/.test(line)) continue
        handleResponse(line)
      }
    })
    socket.on('error', (error) => rejectPromise(error))
  })
}

async function ensureCurrentUser(req) {
  deleteExpiredSessionsStmt.run(Date.now())
  const cookies = parseCookies(req)
  const sessionId = cookies[sessionCookieName]
  if (!sessionId) return null

  const session = findSessionStmt.get(sessionId)
  if (!session) return null
  if (Number(session.expires_at) < Date.now()) {
    deleteSessionStmt.run(sessionId)
    return null
  }

  return sanitizeUser(findUserByIdStmt.get(session.user_id))
}

const server = createServer(async (req, res) => {
  setCorsHeaders(req, res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    deleteExpiredCodesStmt.run(Date.now())
    deleteExpiredSessionsStmt.run(Date.now())

    if (req.url === '/api/auth/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, message: '认证服务正常运行。' })
      return
    }

    if (req.url === '/api/auth/me' && req.method === 'GET') {
      const user = await ensureCurrentUser(req)
      sendJson(res, 200, { authenticated: Boolean(user), user })
      return
    }

    if (req.url === '/api/auth/send-code' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const email = normalizeEmail(body.email)
      if (!isValidEmail(email)) {
        sendJson(res, 400, { message: '请输入有效的邮箱地址。' })
        return
      }

      if (findUserByEmailStmt.get(email)) {
        sendJson(res, 409, { message: '该邮箱已注册，请直接登录。' })
        return
      }

      const code = `${Math.floor(100000 + Math.random() * 900000)}`
      const now = Date.now()
      upsertVerificationStmt.run(email, code, now + verificationExpireMs, now)
      await sendVerificationEmail(email, code)
      sendJson(res, 200, { message: '验证码已发送到你的邮箱，请注意查收。' })
      return
    }

    if (req.url === '/api/auth/register' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const email = normalizeEmail(body.email)
      const code = String(body.code || '').trim()
      const name = String(body.name || '').trim()
      const phone = normalizePhone(body.phone)
      const password = String(body.password || '')
      const confirmPassword = String(body.confirmPassword || '')

      if (!isValidEmail(email)) {
        sendJson(res, 400, { message: '请输入有效的邮箱地址。' })
        return
      }
      if (!code) {
        sendJson(res, 400, { message: '请输入邮箱验证码。' })
        return
      }
      if (!name) {
        sendJson(res, 400, { message: '请输入用户名。' })
        return
      }
      if (!isValidPhone(phone)) {
        sendJson(res, 400, { message: '请输入有效的手机号。' })
        return
      }
      if (password.length < 6) {
        sendJson(res, 400, { message: '密码至少需要 6 个字符。' })
        return
      }
      if (password !== confirmPassword) {
        sendJson(res, 400, { message: '两次输入的密码不一致。' })
        return
      }
      if (findUserByEmailStmt.get(email)) {
        sendJson(res, 409, { message: '该邮箱已注册，请直接登录。' })
        return
      }
      if (findUserByPhoneStmt.get(phone)) {
        sendJson(res, 409, { message: '该手机号已注册，请更换后重试。' })
        return
      }

      const verification = findVerificationStmt.get(email)
      if (!verification) {
        sendJson(res, 400, { message: '请先获取当前邮箱的验证码。' })
        return
      }
      if (Number(verification.expires_at) < Date.now()) {
        deleteVerificationStmt.run(email)
        sendJson(res, 400, { message: '验证码已过期，请重新获取。' })
        return
      }
      if (verification.code !== code) {
        sendJson(res, 400, { message: '验证码不正确，请重新输入。' })
        return
      }

      const now = Date.now()
      const userId = createId()
      const { salt, hash } = hashPassword(password)
      insertUserStmt.run(userId, email, name, phone, hash, salt, now, now)
      deleteVerificationStmt.run(email)

      const sessionId = createId()
      const expiresAt = now + sessionExpireMs
      insertSessionStmt.run(sessionId, userId, expiresAt, now)
      setSessionCookie(res, sessionId, expiresAt)
      sendJson(res, 200, {
        message: '注册成功，当前已自动登录。',
        user: sanitizeUser(findUserByIdStmt.get(userId)),
      })
      return
    }

    if (req.url === '/api/auth/login' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const email = normalizeEmail(body.email)
      const password = String(body.password || '')

      if (!isValidEmail(email)) {
        sendJson(res, 400, { message: '请输入已注册的邮箱地址。' })
        return
      }
      if (!password) {
        sendJson(res, 400, { message: '请输入密码。' })
        return
      }

      const user = findUserByEmailStmt.get(email)
      if (!user) {
        sendJson(res, 404, { message: '未找到该账号，请先注册。' })
        return
      }

      if (!verifyPassword(password, user.password_salt, user.password_hash)) {
        sendJson(res, 401, { message: '密码不正确，请重新输入。' })
        return
      }

      const now = Date.now()
      updateLastLoginStmt.run(now, user.id)
      const sessionId = createId()
      const expiresAt = now + sessionExpireMs
      insertSessionStmt.run(sessionId, user.id, expiresAt, now)
      setSessionCookie(res, sessionId, expiresAt)
      sendJson(res, 200, {
        message: '登录成功，欢迎回来。',
        user: sanitizeUser(findUserByIdStmt.get(user.id)),
      })
      return
    }

    if (req.url === '/api/auth/logout' && req.method === 'POST') {
      const cookies = parseCookies(req)
      const sessionId = cookies[sessionCookieName]
      if (sessionId) deleteSessionStmt.run(sessionId)
      clearSessionCookie(res)
      sendJson(res, 200, { message: '当前账号已退出登录。' })
      return
    }

    sendJson(res, 404, { message: '未找到对应接口。' })
  } catch (error) {
    sendJson(res, 500, { message: error.message || '服务内部错误。' })
  }
})

server.listen(serverPort, () => {
  console.log(`认证服务已启动：http://127.0.0.1:${serverPort}`)
})
