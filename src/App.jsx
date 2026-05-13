import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FaCopy,
  FaPlus,
  FaRegTrashAlt,
  FaSearch,
  FaPaperPlane,
  FaCog,
  FaChevronDown,
  FaChevronRight,
  FaImage,
} from 'react-icons/fa'

const STORAGE_KEY = 'video-camera-prompt-projects-v1'
const SETTINGS_KEY = 'video-camera-prompt-settings-v1'
const MAX_IMAGES = 10
const MAX_IMAGE_SIZE = 10 * 1024 * 1024

const defaultCnPrompt =
  '第一人称电影化镜头语言，镜头以稳定但具有真实惯性的移动方式推进，先以中近景建立空间关系，再逐步靠近主体，在关键动作点加入明显的速度变化与节奏推进。'

const defaultEnPrompt =
  'First-person cinematic camera language with stable movement and believable inertia, starting from medium-close framing to establish spatial relations, then pushing closer to the subject with clear rhythm shifts at key action beats.'

const assistantIntro =
  '告诉我你想保留什么、修改什么，我会先在这里总结你的需求与优化方向，右侧再展示最终提示词。'

function nowText() {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function createProject(index = 1) {
  const id = crypto.randomUUID()
  return {
    id,
    name: `运镜项目 ${index}`,
    createdAt: nowText(),
    images: [],
    messages: [{ id: crypto.randomUUID(), role: 'assistant', content: assistantIntro }],
    result: {
      title: '电影感运镜提示词',
      cn: defaultCnPrompt,
      en: defaultEnPrompt,
      notes: ['根据参考图标记补充镜头用途', '可继续对节奏、景别、主体运动做精修'],
    },
    history: [],
  }
}

function loadProjects() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return Array.isArray(saved) && saved.length ? saved : [createProject(1)]
  } catch {
    return [createProject(1)]
  }
}

function loadSettings() {
  try {
    return {
      provider: 'OpenAI Compatible',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
      apiKey: '',
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY)),
    }
  } catch {
    return {
      provider: 'OpenAI Compatible',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
      apiKey: '',
    }
  }
}

async function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type,
        dataUrl: reader.result,
      })
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function formatSize(size) {
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(size / 1024))} KB`
}

function fallbackGenerate(userText, images) {
  const refs = images.length
    ? images.map((image, index) => `@图${index + 1}「${image.name}」用于建立参考画面、主体关系与镜头调度。`).join('\n')
    : '暂无参考图，按用户描述建立镜头画面。'

  const cn = `基于当前需求「${userText || '电影感运镜提示词'}」，采用第一人称电影化运镜。镜头以稳定推进开场，用中近景先建立主体、环境与空间层次；随后围绕关键主体缓慢靠近，在动作发生点加入轻微加速、停顿与再推进，让节奏形成清晰的起承转合。\n${refs}\n画面保持真实惯性、柔和景深、自然运动模糊与连续构图，强调主体动作和背景视差的关系，最终形成可直接用于 AI 视频平台的完整镜头提示词。`

  const en = `Based on the current request "${userText || 'cinematic camera movement prompt'}", use first-person cinematic camera language. Start with a stable push-in and medium-close framing to establish the subject, environment, and spatial layers. Then move gradually closer around the key subject, adding subtle acceleration, pauses, and renewed motion at important action beats for a clear rhythmic progression.\n${images.length ? images.map((image, index) => `@Image${index + 1} "${image.name}" defines the reference frame, subject relationship, and camera purpose.`).join('\n') : 'No reference image is provided; build the visual scene from the text description.'}\nKeep believable inertia, soft depth of field, natural motion blur, and continuous composition, emphasizing the relationship between subject movement and background parallax.`

  return {
    summary: `已总结你的需求：围绕「${userText || '电影感运镜'}」组织镜头语言，并把 ${images.length} 张参考图按 @图 标记纳入画面/镜头用途。右侧已生成中英文版本，可继续让我强化节奏、景别或主体动作。`,
    result: {
      title: '电影感运镜提示词',
      cn,
      en,
      notes: images.map((_, index) => `@图${index + 1} 已纳入画面与镜头用途`).concat('API 未连接时使用本地模拟生成，可在右上角配置真实模型。'),
    },
  }
}

export default function App() {
  const [projects, setProjects] = useState(loadProjects)
  const [activeId, setActiveId] = useState(() => loadProjects()[0]?.id)
  const [query, setQuery] = useState('')
  const [input, setInput] = useState('')
  const [settings, setSettings] = useState(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [copyTip, setCopyTip] = useState('')
  const [showMentions, setShowMentions] = useState(false)
  const [notesOpen, setNotesOpen] = useState(true)
  const fileInputRef = useRef(null)
  const chatRef = useRef(null)

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeId) || projects[0],
    [projects, activeId],
  )

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
  }, [projects])

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' })
  }, [activeProject?.messages, isLoading])

  function updateActiveProject(patch) {
    setProjects((current) =>
      current.map((project) =>
        project.id === activeProject.id ? { ...project, ...patch(project) } : project,
      ),
    )
  }

  function addProject() {
    const project = createProject(projects.length + 1)
    setProjects((current) => [project, ...current])
    setActiveId(project.id)
  }

  function deleteProject(id) {
    const next = projects.filter((project) => project.id !== id)
    const normalized = next.length ? next : [createProject(1)]
    setProjects(normalized)
    if (activeId === id) setActiveId(normalized[0].id)
  }

  async function addFiles(fileList) {
    if (!activeProject) return
    const files = Array.from(fileList).filter((file) => file.type.startsWith('image/'))
    const available = MAX_IMAGES - activeProject.images.length
    const valid = files.filter((file) => file.size <= MAX_IMAGE_SIZE).slice(0, available)
    const images = await Promise.all(valid.map(fileToImage))
    updateActiveProject((project) => ({ images: [...project.images, ...images] }))
  }

  function deleteImage(id) {
    updateActiveProject((project) => ({ images: project.images.filter((image) => image.id !== id) }))
  }

  function clearCurrent() {
    updateActiveProject(() => ({
      images: [],
      messages: [{ id: crypto.randomUUID(), role: 'assistant', content: assistantIntro }],
    }))
  }

  function insertMention(index) {
    setInput((value) => `${value.replace(/@?$/, '')}@图${index + 1} `)
    setShowMentions(false)
  }

  async function copyText(text, label) {
    await navigator.clipboard.writeText(text)
    setCopyTip(label)
    setTimeout(() => setCopyTip(''), 1600)
  }

  async function callModel(userText) {
    if (!settings.apiKey) return fallbackGenerate(userText, activeProject.images)

    const system = `你是专业 AI 视频运镜提示词生成助手。请根据用户需求、历史对话和参考图标记生成 JSON，格式为 {"summary":"需求总结","title":"结果标题","cn":"中文提示词","en":"English prompt","notes":["补充说明"]}。中文提示词必须包含镜头语言、画面关系、节奏推进；英文提示词适配 Pika/Runway。`
    const content = [
      `当前参考图：${activeProject.images.map((image, index) => `@图${index + 1}=${image.name}`).join('；') || '无'}`,
      `用户需求：${userText}`,
    ].join('\n')

    const response = await fetch(settings.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: system },
          ...activeProject.messages.slice(-8).map((message) => ({
            role: message.role === 'user' ? 'user' : 'assistant',
            content: message.content,
          })),
          { role: 'user', content },
        ],
        temperature: 0.7,
      }),
    })

    if (!response.ok) throw new Error('API request failed')
    const data = await response.json()
    const text = data.choices?.[0]?.message?.content || ''
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text)
    return {
      summary: parsed.summary,
      result: {
        title: parsed.title || activeProject.result.title,
        cn: parsed.cn,
        en: parsed.en,
        notes: parsed.notes || [],
      },
    }
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    setIsLoading(true)

    const userMessage = { id: crypto.randomUUID(), role: 'user', content: text }
    updateActiveProject((project) => ({ messages: [...project.messages, userMessage] }))

    try {
      const generated = await callModel(text)
      const aiMessage = { id: crypto.randomUUID(), role: 'assistant', content: generated.summary }
      const historyItem = {
        id: crypto.randomUUID(),
        createdAt: nowText(),
        ...generated.result,
      }
      updateActiveProject((project) => ({
        messages: [...project.messages, userMessage, aiMessage],
        result: generated.result,
        history: [historyItem, ...project.history],
      }))
    } catch {
      updateActiveProject((project) => ({
        messages: [
          ...project.messages,
          userMessage,
          { id: crypto.randomUUID(), role: 'assistant error', content: 'API请求失败，请检查Key或网络。' },
        ],
      }))
    } finally {
      setIsLoading(false)
    }
  }

  const filteredProjects = projects.filter((project) => project.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="app-page" onPaste={(event) => addFiles(event.clipboardData.files)}>
      <header className="top-nav">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark">✦</div>
            <div>
              <strong>TheONE studio</strong>
              <span>AI Prompt App</span>
            </div>
          </div>
          <nav className="top-actions" aria-label="顶部功能区">
            <button className="nav-pill active">视频运镜提示词</button>
            <span className="status-pill">Server online</span>
            <span className="model-pill">{settings.model || 'GPT'}</span>
            <button className="nav-pill" onClick={() => setShowSettings(true)}>API 设置</button>
            <button className="nav-pill">注册 / 登录</button>
          </nav>
        </div>
      </header>

      <main className="workspace-shell">
      <aside className="left-panel panel">
        <button className="primary-button" onClick={addProject}>
          <FaPlus /> 新增项目
        </button>
        <label className="search-box">
          <FaSearch />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" />
        </label>
        <div className="section-label">PROJECTS</div>
        <div className="project-list">
          {filteredProjects.map((project) => (
            <article
              className={`project-card ${project.id === activeProject.id ? 'active' : ''}`}
              key={project.id}
              onClick={() => setActiveId(project.id)}
            >
              <input
                className="project-name"
                value={project.name}
                onChange={(event) => {
                  const name = event.target.value
                  setProjects((current) => current.map((item) => (item.id === project.id ? { ...item, name } : item)))
                }}
                onClick={(event) => event.stopPropagation()}
              />
              <time>{project.createdAt}</time>
              <div className="card-actions">
                <button onClick={() => setActiveId(project.id)}>打开</button>
                <button className="ghost-danger" onClick={(event) => { event.stopPropagation(); deleteProject(project.id) }}>
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className="left-footer">视频运镜提示词</div>
      </aside>

      <section className="center-panel panel">
        <header className="top-row">
          <div>
            <h1>视频运镜提示词</h1>
            <p>支持点击、拖拽、粘贴参考图，最多 10 张，每张不超过 10MB。</p>
          </div>
          <div className="header-actions">
            <button className="icon-button" onClick={() => setShowSettings(true)} title="API 设置">
              <FaCog />
            </button>
            <button className="clear-button" onClick={clearCurrent}>清空</button>
          </div>
        </header>

        <section
          className="upload-zone"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }}
        >
          <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => addFiles(event.target.files)} />
          <div className="upload-head">
            <div>
              <strong>已添加参考图</strong>
              <span>最多 10 张，每张不超过 10MB。当前 {activeProject.images.length}/{MAX_IMAGES}</span>
            </div>
            <button type="button" onClick={(event) => { event.stopPropagation(); fileInputRef.current?.click() }}>继续添加</button>
          </div>
          <div className="thumb-list">
            {activeProject.images.length === 0 && <div className="empty-upload"><FaImage /> 点击、拖拽或粘贴图片</div>}
            {activeProject.images.map((image, index) => (
              <figure className="thumb-card" key={image.id}>
                <img src={image.dataUrl} alt={image.name} />
                <figcaption>
                  <b>@图{index + 1}</b>
                  <span>{image.name}</span>
                  <small>{formatSize(image.size)}</small>
                </figcaption>
                <button onClick={(event) => { event.stopPropagation(); deleteImage(image.id) }} title="删除图片">
                  <FaRegTrashAlt />
                </button>
              </figure>
            ))}
          </div>
        </section>

        {!settings.apiKey && <div className="api-warning">请先在右上角 API 设置中填写当前模型的 API Key。</div>}

        <section className="chat-box" ref={chatRef}>
          {activeProject.messages.map((message) => (
            <div className={`message ${message.role.replace(' ', '-')}`} key={message.id}>
              <span>{message.role === 'user' ? 'YOU' : message.role.includes('error') ? 'ERROR' : 'AI ASSISTANT'}</span>
              <p>{message.content}</p>
            </div>
          ))}
          {isLoading && <div className="message assistant typing"><span>AI ASSISTANT</span><p>正在生成需求总结与最终提示词...</p></div>}
        </section>

        <section className="composer">
          <div className="preset-line">
            <span>预设</span>
            <button onClick={() => setInput('请在运镜提示词中使用 @图1、@图2 这类标记，对应说明每张参考图的画面/镜头用途。')}>
              参考图标记 @图1
            </button>
          </div>
          <textarea
            value={input}
            disabled={isLoading}
            onChange={(event) => {
              setInput(event.target.value)
              setShowMentions(event.target.value.endsWith('@'))
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) sendMessage()
            }}
            placeholder="请在运镜提示词中使用 @图1、@图2 这类标记，对应说明每张参考图的画面/镜头用途。"
          />
          {showMentions && activeProject.images.length > 0 && (
            <div className="mention-menu">
              {activeProject.images.map((image, index) => (
                <button key={image.id} onClick={() => insertMention(index)}>
                  @图{index + 1} <span>{image.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="composer-footer">
            <small>中间区域显示连续对话总结，右侧显示最终结果。</small>
            <button disabled={isLoading || !input.trim()} onClick={sendMessage}>
              {isLoading ? '生成中' : '发送'} <FaPaperPlane />
            </button>
          </div>
        </section>
      </section>

      <aside className="right-panel panel">
        <header>
          <h2>生成结果</h2>
          <p>中英文分别复制 + 历史记录点击查看</p>
        </header>
        <input
          className="result-title"
          value={activeProject.result.title}
          onChange={(event) => updateActiveProject((project) => ({ result: { ...project.result, title: event.target.value } }))}
        />
        <PromptBlock title="中文 Prompt" button="复制中文" value={activeProject.result.cn} onCopy={() => copyText(activeProject.result.cn, '复制中文成功')} />
        <PromptBlock title="English Prompt" button="Copy English" value={activeProject.result.en} onCopy={() => copyText(activeProject.result.en, 'Copy English success')} />
        {copyTip && <div className="copy-tip">{copyTip}</div>}

        <section className="notes">
          <button onClick={() => setNotesOpen(!notesOpen)}>
            {notesOpen ? <FaChevronDown /> : <FaChevronRight />} 补充说明 · {activeProject.result.notes?.length || 0} 条
          </button>
          {notesOpen && (
            <ul>
              {(activeProject.result.notes || []).map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}
            </ul>
          )}
        </section>

        <section className="history-box">
          <div className="history-head">
            <strong>历史结果</strong>
            <span>{activeProject.history.length} 条</span>
          </div>
          <div className="history-list">
            {activeProject.history.length === 0 && <p>暂无历史结果</p>}
            {activeProject.history.map((item) => (
              <button
                key={item.id}
                onClick={() => updateActiveProject(() => ({ result: { title: item.title, cn: item.cn, en: item.en, notes: item.notes } }))}
              >
                <strong>{item.title}</strong>
                <span>{item.createdAt}</span>
              </button>
            ))}
          </div>
        </section>
      </aside>

      </main>

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <section className="settings-modal" onClick={(event) => event.stopPropagation()}>
            <h3>API 设置</h3>
            <label>模型服务<input value={settings.provider} onChange={(event) => setSettings({ ...settings, provider: event.target.value })} /></label>
            <label>接口地址<input value={settings.endpoint} onChange={(event) => setSettings({ ...settings, endpoint: event.target.value })} /></label>
            <label>模型名称<input value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} /></label>
            <label>API Key<input type="password" value={settings.apiKey} onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })} /></label>
            <button className="primary-button" onClick={() => setShowSettings(false)}>保存设置</button>
          </section>
        </div>
      )}
    </div>
  )
}

function PromptBlock({ title, button, value, onCopy }) {
  return (
    <section className="prompt-block">
      <div>
        <h3>{title}</h3>
        <button onClick={onCopy}><FaCopy /> {button}</button>
      </div>
      <textarea value={value} readOnly />
    </section>
  )
}
