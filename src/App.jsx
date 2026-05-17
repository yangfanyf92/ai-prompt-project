import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FaChevronDown,
  FaChevronLeft,
  FaChevronRight,
  FaCog,
  FaCopy,
  FaImage,
  FaPaperPlane,
  FaPlus,
  FaSearch,
} from 'react-icons/fa'

const STORAGE_KEY = 'video-camera-prompt-projects-v1'
const SETTINGS_KEY = 'video-camera-prompt-settings-v2'
const MAX_IMAGES = 10
const MAX_IMAGE_SIZE = 10 * 1024 * 1024
const IMAGE_MAX_EDGE = 1600
const IMAGE_QUALITY = 0.82

const STORYBOARD_TEMPLATES = {
  default: {
    label: '默认模板',
    short: '正常生成完整运镜提示词',
    instruction:
      '按常规方式输出完整中英文运镜提示词，重点包含镜头语言、主体关系、画面节奏、参考图用途和适配 AI 视频平台的英文版本。',
  },
  split: {
    label: '专业拆分',
    short: '强制按时间段输出分镜脚本',
    instruction: [
      '【强制输出规则】当用户选择“专业拆分”时，禁止输出笼统段落、总述式提示词或只有一段的描述。',
      '中文 Prompt 的 cn 字段必须只使用分镜脚本结构输出，至少拆成 3 个镜头段落；如果用户明确给出总时长，则按总时长合理拆分。',
      '每一个镜头段落必须逐字包含以下 4 个字段名，顺序不能改变：',
      '时长：',
      '镜头运镜 & 角度：',
      '画面内容：',
      '环境音效：',
      '每个字段后必须写细化内容，不能写“同上”“略”“根据需求”等空泛文字。',
      '“镜头运镜 & 角度”必须具体写清景别、机位高度、镜头方向、运动方式、速度变化、是否手持/稳定/推拉摇移跟。',
      '“画面内容”必须具体写清主体动作、环境、光线、材质、空间关系、冲击点、参考图用途；如果用户要求冲击感，必须强化速度、压迫、爆发、颗粒、震动或运动模糊。',
      '“环境音效”必须具体写清可听见的声音层次，不能只写“环境音”。',
      '所有可用参考图必须用 @图1、@图2 这类标记说明用途。',
      '中文 cn 字段末尾必须追加“参考图使用建议：”，说明每张参考图对应哪些时间段和镜头用途。',
      'English Prompt 的 en 字段也必须对应拆分，使用字段 Duration、Camera movement & angle、Visual content、Ambient sound，末尾追加 Reference image usage suggestion。',
    ].join('\n'),
  },
}

const PROVIDERS = {
  viva_gpt: {
    label: 'GPT 5.4 / VivaAPI',
    baseUrl: 'https://www.vivaapi.cn/v1',
    chatPath: '/chat/completions',
    healthPath: '/api/health',
    models: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex'],
  },
  viva_claude: {
    label: 'Claude 4.7 / VivaAPI',
    baseUrl: 'https://www.vivaapi.cn/v1',
    chatPath: '/chat/completions',
    healthPath: '/api/health',
    models: ['claude-4.7-sonnet', 'claude-4.7-opus'],
  },
  openai: {
    label: 'OpenAI Compatible',
    baseUrl: 'https://api.openai.com/v1',
    chatPath: '/chat/completions',
    healthPath: '/models',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  },
  deepseek: {
    label: 'DeepSeek V4',
    baseUrl: 'https://api.deepseek.com',
    chatPath: '/chat/completions',
    healthPath: '/models',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  qwen: {
    label: '千问 Qwen / 阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    chatPath: '/chat/completions',
    healthPath: '/models',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-vl-plus'],
  },
  custom: {
    label: '自定义兼容接口',
    baseUrl: '',
    chatPath: '/chat/completions',
    healthPath: '/models',
    models: ['custom-model'],
  },
}

const defaultCnPrompt =
  '第一人称电影化镜头语言，镜头以稳定但具有真实惯性的移动方式推进，先以中近景建立空间关系，再逐步靠近主体，在关键动作点加入明显的速度变化与节奏推进。'

const defaultEnPrompt =
  'First-person cinematic camera language with stable movement and believable inertia, starting from medium-close framing to establish spatial relations, then pushing closer to the subject with clear rhythm shifts at key action beats.'

const assistantIntro =
  '告诉我你想保留什么、修改什么，我会先在这里总结你的需求与优化方向，右侧再展示最终提示词。'

function nowText() {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function buildEndpoint(settings) {
  const base = (settings.baseUrl || '').replace(/\/$/, '')
  const path = settings.chatPath?.startsWith('/') ? settings.chatPath : `/${settings.chatPath || 'chat/completions'}`
  return `${base}${path}`
}

function buildHealthEndpoint(settings) {
  const base = (settings.baseUrl || '').replace(/\/$/, '')
  const path = settings.healthPath?.startsWith('/') ? settings.healthPath : `/${settings.healthPath || 'models'}`
  return `${base}${path}`
}

function createProviderConfig(providerId, previous = {}) {
  const preset = PROVIDERS[providerId] || PROVIDERS.openai
  return {
    providerId,
    provider: preset.label,
    apiKey: previous.apiKey || '',
    baseUrl: preset.baseUrl,
    model: preset.models[0],
    chatPath: preset.chatPath,
    healthPath: preset.healthPath,
    backendUrl: previous.backendUrl || '',
  }
}

function createProject(index = 1) {
  return {
    id: crypto.randomUUID(),
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
  const defaults = {
    activeProviderId: 'viva_gpt',
    providers: {
      viva_gpt: createProviderConfig('viva_gpt', {
        apiKey: import.meta.env.VITE_DEFAULT_API_KEY || '',
      }),
      viva_claude: createProviderConfig('viva_claude'),
      openai: createProviderConfig('openai'),
      deepseek: createProviderConfig('deepseek'),
      qwen: createProviderConfig('qwen'),
      custom: createProviderConfig('custom'),
    },
  }

  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY))
    if (saved?.providers) {
      return {
        ...defaults,
        ...saved,
        providers: { ...defaults.providers, ...saved.providers },
      }
    }

    if (saved?.endpoint || saved?.model || saved?.apiKey) {
      return {
        ...defaults,
        providers: {
          ...defaults.providers,
          openai: {
            ...defaults.providers.openai,
            apiKey: saved.apiKey || '',
            model: saved.model || defaults.providers.openai.model,
            baseUrl: (saved.endpoint || defaults.providers.openai.baseUrl).replace(/\/chat\/completions$/, ''),
          },
        },
        activeProviderId: 'openai',
      }
    }

    return defaults
  } catch {
    return defaults
  }
}

function canvasToDataUrl(canvas, type) {
  const outputType = type === 'image/gif' ? 'image/png' : 'image/jpeg'
  return canvas.toDataURL(outputType, outputType === 'image/jpeg' ? IMAGE_QUALITY : undefined)
}

function dataUrlBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1] || ''
  return Math.round((base64.length * 3) / 4)
}

async function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const originalDataUrl = reader.result
      const img = new Image()
      img.onload = () => {
        try {
          const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(img.width, img.height))
          const width = Math.max(1, Math.round(img.width * scale))
          const height = Math.max(1, Math.round(img.height * scale))
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const context = canvas.getContext('2d')
          context.drawImage(img, 0, 0, width, height)
          const compressedDataUrl = canvasToDataUrl(canvas, file.type)
          resolve({
            id: crypto.randomUUID(),
            name: file.name,
            size: dataUrlBytes(compressedDataUrl),
            originalSize: file.size,
            type: file.type,
            dataUrl: compressedDataUrl,
          })
        } catch {
          resolve({
            id: crypto.randomUUID(),
            name: file.name,
            size: file.size,
            originalSize: file.size,
            type: file.type,
            dataUrl: originalDataUrl,
          })
        }
      }
      img.onerror = () =>
        resolve({
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          originalSize: file.size,
          type: file.type,
          dataUrl: originalDataUrl,
        })
      img.src = originalDataUrl
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function formatSize(size) {
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(size / 1024))} KB`
}

function fallbackGenerate(userText, images, templateId = 'default') {
  const template = STORYBOARD_TEMPLATES[templateId] || STORYBOARD_TEMPLATES.default
  const refs = images.length
    ? images
        .map((image, index) => `@图${index + 1}「${image.name}」用于建立参考画面、主体关系与镜头调度。`)
        .join('\n')
    : '暂无参考图，按用户描述建立镜头画面。'

  const cn =
    templateId === 'split'
      ? `时长：0-2s；\n镜头运镜 & 角度：以当前需求「${userText || '电影感运镜'}」作为开场，使用可用参考图建立主体与空间关系，镜头稳定推进并带轻微真实惯性；\n画面内容：主体进入画面核心，环境层次逐步展开，强调中近景、背景视差和第一段情绪建立；\n环境音效：环境底噪、轻微运动声与空间氛围声；\n\n时长：2-4s；\n镜头运镜 & 角度：镜头顺着主体运动方向继续推进或环绕，加入一次节奏变化，让画面从建立关系转入动作强化；\n画面内容：主体动作更明确，画面重点从整体关系过渡到关键动作和细节质感；\n环境音效：动作声增强，节奏更紧，环境声保持连续；\n\n时长：4-6s；\n镜头运镜 & 角度：进入高潮镜头，可根据参考图切换到更低机位、近景或更强透视角度；\n画面内容：关键动作爆发，颗粒、光影、运动模糊和景深共同强化冲击力；\n环境音效：关键动作声、冲击声或风声达到峰值；\n\n参考图使用建议：\n${refs}`
      : `基于当前需求「${userText || '电影感运镜提示词'}」，采用第一人称电影化运镜。镜头以稳定推进开场，用中近景先建立主体、环境与空间层次；随后围绕关键主体缓慢靠近，在动作发生点加入轻微加速、停顿与再推进，让节奏形成清晰的起承转合。\n${refs}\n画面保持真实惯性、柔和景深、自然运动模糊与连续构图，强调主体动作和背景视差的关系，最终形成可直接用于 AI 视频平台的完整镜头提示词。`

  const en =
    templateId === 'split'
      ? `Duration: 0-2s;\nCamera movement & angle: Establish the subject and spatial relationship based on "${userText || 'cinematic camera movement'}", using available reference images as visual guidance. Use a stable push-in with believable inertia.\nVisual content: The subject enters the visual center while the environment layers unfold, emphasizing medium-close framing, parallax, and mood setup.\nAmbient sound: Environmental bed, subtle movement sound, and spatial atmosphere.\n\nDuration: 2-4s;\nCamera movement & angle: Continue following the subject motion with a clear rhythm shift, moving from setup into action emphasis.\nVisual content: The subject action becomes stronger, shifting attention from the full relation to key motion details.\nAmbient sound: Action sound rises while the environmental bed remains continuous.\n\nDuration: 4-6s;\nCamera movement & angle: Move into the climax shot with a lower angle, close framing, or stronger perspective when suitable.\nVisual content: The key action peaks with particles, lighting, motion blur, and shallow depth of field for stronger impact.\nAmbient sound: Impact, wind, or action sound reaches the strongest point.\n\nReference image usage suggestion:\n${images.length ? images.map((image, index) => `@Image${index + 1} "${image.name}" defines the corresponding visual and camera purpose.`).join('\n') : 'No reference image is provided; build the visual scene from the text description.'}`
      : `Based on the current request "${userText || 'cinematic camera movement prompt'}", use first-person cinematic camera language. Start with a stable push-in and medium-close framing to establish the subject, environment, and spatial layers. Then move gradually closer around the key subject, adding subtle acceleration, pauses, and renewed motion at important action beats for a clear rhythmic progression.\n${images.length ? images.map((image, index) => `@Image${index + 1} "${image.name}" defines the reference frame, subject relationship, and camera purpose.`).join('\n') : 'No reference image is provided; build the visual scene from the text description.'}\nKeep believable inertia, soft depth of field, natural motion blur, and continuous composition, emphasizing the relationship between subject movement and background parallax.`

  return {
    summary: `已总结你的需求：围绕「${userText || '电影感运镜'}」组织镜头语言，并使用「${template.label}」输出格式，把 ${images.length} 张参考图按 @图 标记纳入画面/镜头用途。`,
    result: {
      title: '电影感运镜提示词',
      cn,
      en,
      notes: images.map((_, index) => `@图${index + 1} 已纳入画面与镜头用途`).concat(`当前模板：${template.label}`, 'API 未连接时使用本地模拟生成，可在右上角配置真实模型。'),
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
  const [healthStatus, setHealthStatus] = useState('idle')
  const [isLoading, setIsLoading] = useState(false)
  const [copyTip, setCopyTip] = useState('')
  const [showMentions, setShowMentions] = useState(false)
  const [mentionStart, setMentionStart] = useState(-1)
  const [mentionQuery, setMentionQuery] = useState('')
  const [hoveredMentionId, setHoveredMentionId] = useState('')
  const [notesOpen, setNotesOpen] = useState(true)
  const [uploadWarning, setUploadWarning] = useState('')
  const [storyboardTemplate, setStoryboardTemplate] = useState('default')
  const [projectPanelCollapsed, setProjectPanelCollapsed] = useState(false)
  const fileInputRef = useRef(null)
  const chatRef = useRef(null)
  const inputRef = useRef(null)
  const mentionMenuRef = useRef(null)

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeId) || projects[0],
    [projects, activeId],
  )
  const activeProvider = settings.providers[settings.activeProviderId] || settings.providers.openai
  const activePreset = PROVIDERS[activeProvider.providerId] || PROVIDERS.custom
  const apiStatus = !activeProvider.apiKey
    ? { className: 'offline', label: 'API 未配置' }
    : healthStatus === 'ok'
      ? { className: 'online', label: 'API 有效' }
      : healthStatus === 'failed'
        ? { className: 'failed', label: 'API 无效' }
        : healthStatus === 'checking'
          ? { className: 'checking', label: '检测中' }
          : { className: 'unknown', label: 'API 未检测' }

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
    } catch {
      setUploadWarning('图片已显示，但浏览器本地存储空间不足，刷新后可能无法保留。请删除部分参考图或使用更小图片。')
    }
  }, [projects])

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      setUploadWarning('浏览器本地存储空间不足，API 设置可能无法保存。')
    }
  }, [settings])

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' })
  }, [activeProject?.messages, isLoading])

  useEffect(() => {
    if (!showMentions) return undefined

    function closeMentionsOnOutsideClick(event) {
      const target = event.target
      if (mentionMenuRef.current?.contains(target) || inputRef.current?.contains(target)) return
      setShowMentions(false)
      setHoveredMentionId('')
    }

    document.addEventListener('pointerdown', closeMentionsOnOutsideClick, true)
    return () => document.removeEventListener('pointerdown', closeMentionsOnOutsideClick, true)
  }, [showMentions])

  function updateActiveProject(patch) {
    setProjects((current) =>
      current.map((project) =>
        project.id === activeProject.id ? { ...project, ...patch(project) } : project,
      ),
    )
  }

  function updateProvider(patch) {
    setSettings((current) => ({
      ...current,
      providers: {
        ...current.providers,
        [current.activeProviderId]: {
          ...current.providers[current.activeProviderId],
          ...patch,
        },
      },
    }))
    setHealthStatus('idle')
  }

  function switchProvider(providerId) {
    setSettings((current) => {
      const existing = current.providers[providerId]
      return {
        ...current,
        activeProviderId: providerId,
        providers: {
          ...current.providers,
          [providerId]: existing || createProviderConfig(providerId),
        },
      }
    })
    setHealthStatus('idle')
  }

  function applyModelPreset(model) {
    updateProvider({ model })
  }

  function restoreCurrentProvider() {
    setSettings((current) => ({
      ...current,
      providers: {
        ...current.providers,
        [current.activeProviderId]: createProviderConfig(current.activeProviderId, {
          apiKey: current.providers[current.activeProviderId]?.apiKey || '',
        }),
      },
    }))
    setHealthStatus('idle')
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
    if (!files.length) return
    setUploadWarning('')
    const available = MAX_IMAGES - activeProject.images.length
    const oversized = files.filter((file) => file.size > MAX_IMAGE_SIZE)
    const valid = files.filter((file) => file.size <= MAX_IMAGE_SIZE).slice(0, available)
    if (!valid.length) {
      if (oversized.length) {
        const names = oversized.slice(0, 2).map((file) => file.name).join('、')
        const suffix = oversized.length > 2 ? ' 等图片' : ''
        setUploadWarning(`上传失败：${names}${suffix} 超过 10MB，系统已拒绝上传。`)
      } else {
        setUploadWarning('图片未添加：单项目最多只能上传 10 张参考图。')
      }
      return
    }
    try {
      const images = await Promise.all(valid.map(fileToImage))
      updateActiveProject((project) => ({ images: [...project.images, ...images] }))
      if (oversized.length) {
        const names = oversized.slice(0, 2).map((file) => file.name).join('、')
        const suffix = oversized.length > 2 ? ' 等图片' : ''
        setUploadWarning(`部分图片未上传：${names}${suffix} 超过 10MB，已自动跳过。`)
      } else if (valid.length < files.length) {
        setUploadWarning('部分图片未添加：单项目最多只能上传 10 张参考图。')
      }
    } catch {
      setUploadWarning('图片读取失败，请换一张图片重试。')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
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

  function updateMentionState(value, cursorPosition) {
    const beforeCursor = value.slice(0, cursorPosition)
    const atIndex = beforeCursor.lastIndexOf('@')
    if (atIndex === -1) {
      setShowMentions(false)
      setMentionStart(-1)
      setMentionQuery('')
      setHoveredMentionId('')
      return
    }

    const token = beforeCursor.slice(atIndex + 1)
    if (/\s/.test(token)) {
      setShowMentions(false)
      setMentionStart(-1)
      setMentionQuery('')
      setHoveredMentionId('')
      return
    }

    setShowMentions(activeProject.images.length > 0)
    setMentionStart(atIndex)
    setMentionQuery(token)
  }

  function insertMention(index) {
    const mention = `@图${index + 1} `
    setInput((value) => {
      const cursorPosition = inputRef.current?.selectionStart ?? value.length
      const start = mentionStart >= 0 ? mentionStart : cursorPosition
      const nextValue = `${value.slice(0, start)}${mention}${value.slice(cursorPosition)}`
      requestAnimationFrame(() => {
        const nextCursor = start + mention.length
        inputRef.current?.focus()
        inputRef.current?.setSelectionRange(nextCursor, nextCursor)
      })
      return nextValue
    })
    setShowMentions(false)
    setMentionStart(-1)
    setMentionQuery('')
    setHoveredMentionId('')
  }

  function insertMentionTrigger() {
    const cursorPosition = inputRef.current?.selectionStart ?? input.length
    const selectionEnd = inputRef.current?.selectionEnd ?? cursorPosition

    setInput((value) => {
      const nextValue = `${value.slice(0, cursorPosition)}@${value.slice(selectionEnd)}`
      requestAnimationFrame(() => {
        const nextCursor = cursorPosition + 1
        inputRef.current?.focus()
        inputRef.current?.setSelectionRange(nextCursor, nextCursor)
      })
      return nextValue
    })

    setMentionStart(cursorPosition)
    setMentionQuery('')
    setHoveredMentionId(activeProject.images[0]?.id || '')
    setShowMentions(activeProject.images.length > 0)
  }

  async function copyText(text, label) {
    await navigator.clipboard.writeText(text)
    setCopyTip(label)
    setTimeout(() => setCopyTip(''), 1600)
  }

  async function checkHealth() {
    if (!activeProvider.baseUrl) {
      setHealthStatus('failed')
      return
    }
    setHealthStatus('checking')
    try {
      const response = await fetch(buildHealthEndpoint(activeProvider), {
        headers: activeProvider.apiKey ? { Authorization: `Bearer ${activeProvider.apiKey}` } : {},
      })
      setHealthStatus(response.ok ? 'ok' : 'failed')
    } catch {
      setHealthStatus('failed')
    }
  }

  async function callModel(userText) {
    if (!activeProvider.apiKey) return fallbackGenerate(userText, activeProject.images, storyboardTemplate)

    const template = STORYBOARD_TEMPLATES[storyboardTemplate] || STORYBOARD_TEMPLATES.default
    const system = [
      '你是专业 AI 视频运镜提示词生成助手。请根据用户需求、历史对话和参考图标记生成 JSON，格式为 {"summary":"需求总结","title":"结果标题","cn":"中文提示词","en":"English prompt","notes":["补充说明"]}。',
      '中文提示词必须包含镜头语言、画面关系、节奏推进；英文提示词适配 Pika/Runway/Seedance 等 AI 视频平台。',
      `当前分镜模板：${template.label}。${template.instruction}`,
      storyboardTemplate === 'split'
        ? [
            '再次强调：当前必须输出“专业拆分”格式。',
            'cn 字段不允许是一整段描述，不允许只写总结，不允许省略字段名。',
            'cn 字段中的每个镜头段落必须严格长这样：',
            '时长：0-2s；',
            '镜头运镜 & 角度：这里写非常具体的运镜、景别、角度、速度、机位、镜头运动；',
            '画面内容：这里写非常具体的主体动作、环境、光线、材质、冲击点、参考图用途；',
            '环境音效：这里写非常具体的声音层次；',
            '然后换行进入下一段镜头。至少 3 段。末尾必须写“参考图使用建议：”。',
          ].join('\n')
        : '',
    ].join('\n')
    const content = [
      `当前参考图：${activeProject.images.map((image, index) => `@图${index + 1}=${image.name}`).join('；') || '无'}`,
      `当前输出模板：${template.label}`,
      storyboardTemplate === 'split'
        ? '专业拆分硬性要求：最终 cn 字段必须按“时长：/镜头运镜 & 角度：/画面内容：/环境音效：”逐段输出，不能写成笼统的一段描述。'
        : '',
      `用户需求：${userText}`,
    ].join('\n')

    const response = await fetch(buildEndpoint(activeProvider), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${activeProvider.apiKey}`,
      },
      body: JSON.stringify({
        model: activeProvider.model,
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
    const text = data.choices?.[0]?.message?.content || data.output_text || ''
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
          { id: crypto.randomUUID(), role: 'assistant error', content: 'API请求失败，请检查 Key、Base URL、模型名称或网络。' },
        ],
      }))
    } finally {
      setIsLoading(false)
    }
  }

  const filteredProjects = projects.filter((project) => project.name.toLowerCase().includes(query.toLowerCase()))
  const shouldScrollProjects = filteredProjects.length > 4
  const mentionMatches = activeProject.images.filter((image, index) => {
    const normalizedQuery = mentionQuery.trim().toLowerCase()
    if (!normalizedQuery) return true
    return `图${index + 1}`.includes(normalizedQuery) || image.name.toLowerCase().includes(normalizedQuery)
  })
  const hoveredMention = activeProject.images.find((image) => image.id === hoveredMentionId)

  return (
    <div className={`app-page ${showSettings ? 'settings-open' : ''}`} onPaste={(event) => addFiles(event.clipboardData.files)}>
      <header className="top-nav">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark">✦</div>
            <div>
              <strong>YF_AIGC Studio</strong>
              <span>AI Prompt Project 提示词生成 —— 想你所想,答你所问</span>
            </div>
          </div>
          <nav className="top-actions" aria-label="顶部功能区">
            <button className="nav-pill active">视频运镜提示词</button>
            <span className={`status-pill ${apiStatus.className}`} title="在 API 设置中点击检测联通可验证有效性">
              {apiStatus.label}
            </span>
            <span className="model-pill">{activeProvider.model || '未选择模型'}</span>
            <button className="nav-pill" onClick={() => setShowSettings(true)}>API 设置</button>
            <button className="nav-pill">注册 / 登录</button>
          </nav>
        </div>
      </header>

      <main className={`workspace-shell ${projectPanelCollapsed ? 'project-panel-collapsed' : ''}`}>
        <aside className={`left-panel panel ${projectPanelCollapsed ? 'collapsed' : ''}`}>
          <div className="left-panel-toolbar">
            {!projectPanelCollapsed && <div className="left-footer">视频运镜提示词</div>}
            <button
              className="project-collapse-toggle"
              onClick={() => setProjectPanelCollapsed((value) => !value)}
              aria-label={projectPanelCollapsed ? '展开项目栏' : '折叠项目栏'}
              aria-expanded={!projectPanelCollapsed}
              title={projectPanelCollapsed ? '展开项目栏' : '折叠项目栏'}
            >
              {projectPanelCollapsed ? <FaChevronRight /> : <FaChevronLeft />}
            </button>
          </div>
          {!projectPanelCollapsed && (
            <div className="project-panel-content">
              <button className="primary-button" onClick={addProject}>
                <FaPlus /> 新增项目
              </button>
              <label className="search-box">
                <FaSearch />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" />
              </label>
              <div className="section-label">PROJECTS</div>
              <div className={`project-list ${shouldScrollProjects ? 'scrollable' : ''}`}>
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
                      title={project.name}
                    />
                    <div className="project-card-body">
                      <div className="project-thumb-wrap">
                        {project.images?.[0] ? (
                          <img className="project-thumb" src={project.images[0].dataUrl} alt={project.images[0].name || project.name} />
                        ) : (
                          <div className="project-thumb project-thumb-placeholder">暂无图</div>
                        )}
                      </div>
                      <div className="project-meta">
                        <time>{project.createdAt}</time>
                        <div className="card-actions">
                          <button onClick={() => setActiveId(project.id)}>打开</button>
                          <button className="ghost-danger" onClick={(event) => { event.stopPropagation(); deleteProject(project.id) }}>
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
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

          <div className="center-workspace">
            <div className="asset-column">
          <section className="storyboard-templates">
            <div className="template-head">
              <div>
                <span>SHOT TEMPLATE</span>
                <strong>常见分镜模板</strong>
              </div>
              <p>选择后会影响右侧最终提示词的输出结构。</p>
            </div>
            <div className="template-options">
              {Object.entries(STORYBOARD_TEMPLATES).map(([id, template]) => (
                <button
                  key={id}
                  className={storyboardTemplate === id ? 'active' : ''}
                  onClick={() => setStoryboardTemplate(id)}
                >
                  <strong>{template.label}</strong>
                  <span>{template.short}</span>
                </button>
              ))}
            </div>
          </section>

          {!activeProvider.apiKey && <div className="api-warning">请先在右上角 API 设置中填写当前模型的 API Key。</div>}
            </div>

            <div className="conversation-column">
          <section className="chat-box" ref={chatRef}>
            {activeProject.messages.map((message) => (
              <div className={`message ${message.role.replace(' ', '-')}`} key={message.id}>
                <span>{message.role === 'user' ? 'YOU' : message.role.includes('error') ? 'ERROR' : 'AI ASSISTANT'}</span>
                <p>{message.content}</p>
              </div>
            ))}
            {isLoading && <div className="message assistant typing"><span>AI ASSISTANT</span><p>正在生成需求总结与最终提示词...</p></div>}
          </section>

          <section
            className="composer"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }}
          >
            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => addFiles(event.target.files)} />
            <div className="composer-input-shell">
              <div className="attachment-rail">
                {activeProject.images.length > 0 ? (
                  <div className="attachment-stack" title="已添加参考图">
                    {activeProject.images.slice(0, 3).map((image, index) => (
                      <img
                        className="stack-preview"
                        key={image.id}
                        src={image.dataUrl}
                        alt={image.name}
                        style={{ '--stack-index': index }}
                      />
                    ))}
                    <button className="attachment-add-button" type="button" onClick={() => fileInputRef.current?.click()} title="继续添加参考图">
                      <FaPlus />
                    </button>
                    <div className="attachment-popover" aria-label="已上传参考图">
                      <div className="attachment-popover-title">
                        <strong>已上传参考图</strong>
                        <span>{activeProject.images.length}/{MAX_IMAGES}</span>
                      </div>
                      <div className="attachment-popover-list">
                        {activeProject.images.map((image, index) => (
                          <figure
                            className="attachment-popover-card"
                            key={image.id}
                            style={{ '--fan-index': index }}
                          >
                            <img src={image.dataUrl} alt={image.name} />
                            <figcaption>@图{index + 1}</figcaption>
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); deleteImage(image.id) }}
                              title={`删除 @图${index + 1}`}
                            >
                              ×
                            </button>
                          </figure>
                        ))}
                        <button
                          className="attachment-popover-add"
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={activeProject.images.length >= MAX_IMAGES}
                          title="继续添加参考图"
                        >
                          <FaPlus />
                          <span>继续添加</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="attachment-empty" onClick={() => fileInputRef.current?.click()}>
                    <FaImage />
                    <span>添加参考图</span>
                  </button>
                )}
              </div>
              <div className="composer-main">
                <div className="preset-line">
                  <span>使用 <b>@</b> 快速调用参考内容</span>
                  <button type="button" onClick={insertMentionTrigger}>
                    参考图标记 @图1
                  </button>
                </div>
                <textarea
                  ref={inputRef}
                  value={input}
                  disabled={isLoading}
                  onChange={(event) => {
                    const value = event.target.value
                    setInput(value)
                    updateMentionState(value, event.target.selectionStart)
                  }}
                  onClick={(event) => updateMentionState(event.currentTarget.value, event.currentTarget.selectionStart)}
                  onKeyUp={(event) => {
                    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                      updateMentionState(event.currentTarget.value, event.currentTarget.selectionStart)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setShowMentions(false)
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) sendMessage()
                  }}
                  placeholder="例如：@图1 模仿画面构图，@图2 参考主体动作，然后描述你希望生成的运镜方向。"
                />
              </div>
            </div>
            {uploadWarning && <div className="upload-warning composer-warning">{uploadWarning}</div>}
            {showMentions && activeProject.images.length > 0 && (
              <div className="mention-menu" ref={mentionMenuRef}>
                {mentionMatches.length === 0 && <div className="mention-empty">没有匹配的参考图</div>}
                {mentionMatches.map((image) => {
                  const index = activeProject.images.findIndex((item) => item.id === image.id)
                  return (
                  <button
                    key={image.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHoveredMentionId(image.id)}
                    onFocus={() => setHoveredMentionId(image.id)}
                    onClick={() => insertMention(index)}
                  >
                    <strong>@图{index + 1}</strong>
                    <span title={image.name}>{image.name}</span>
                  </button>
                  )
                })}
                {hoveredMention && (
                  <div className="mention-preview">
                    <img src={hoveredMention.dataUrl} alt={hoveredMention.name} />
                    <div>
                      <strong>{hoveredMention.name}</strong>
                      <span>{formatSize(hoveredMention.size)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="composer-footer">
              <small>中间区域显示连续对话总结，右侧显示最终结果。</small>
              <button disabled={isLoading || !input.trim()} onClick={sendMessage}>
                {isLoading ? '生成中' : '发送'} <FaPaperPlane />
              </button>
            </div>
          </section>
            </div>
          </div>
        </section>

        <aside className="right-panel panel">
          <header>
            <h2>生成结果</h2>
            <p>中英文分别复制 + 历史记录点击查看</p>
          </header>
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
        <div className="drawer-backdrop" onClick={() => setShowSettings(false)}>
          <aside className="settings-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <span>CONNECTION</span>
                <h2>API 设置</h2>
              </div>
              <button onClick={() => setShowSettings(false)}>关闭</button>
            </div>

            <label>
              Provider
              <select value={settings.activeProviderId} onChange={(event) => switchProvider(event.target.value)}>
                {Object.entries(PROVIDERS).map(([id, provider]) => (
                  <option key={id} value={id}>{provider.label}</option>
                ))}
              </select>
            </label>

            <label>
              Model Preset
              <select value={activeProvider.model} onChange={(event) => applyModelPreset(event.target.value)}>
                {activePreset.models.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </label>

            <label>
              API Key
              <input type="password" value={activeProvider.apiKey} onChange={(event) => updateProvider({ apiKey: event.target.value })} />
            </label>

            <label>
              Base URL
              <input value={activeProvider.baseUrl} onChange={(event) => updateProvider({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
            </label>

            <label>
              Model
              <input value={activeProvider.model} onChange={(event) => updateProvider({ model: event.target.value })} placeholder="gpt-5.4" />
            </label>

            <label>
              Chat Path
              <input value={activeProvider.chatPath} onChange={(event) => updateProvider({ chatPath: event.target.value })} placeholder="/chat/completions" />
            </label>

            <label>
              Health Path
              <input value={activeProvider.healthPath} onChange={(event) => updateProvider({ healthPath: event.target.value })} placeholder="/models" />
            </label>

            <label>
              后端 API 地址
              <input value={activeProvider.backendUrl} onChange={(event) => updateProvider({ backendUrl: event.target.value })} placeholder="静态 CDN 和 API 分开时填写后端服务地址，留空则使用当前域名" />
            </label>

            <div className="drawer-actions">
              <button className="test-button" onClick={checkHealth} disabled={healthStatus === 'checking'}>
                {healthStatus === 'checking' ? '检测中' : '检测联通'}
              </button>
              <span className={`health-badge ${healthStatus}`}>
                {healthStatus === 'ok' ? 'API 联通正常' : healthStatus === 'failed' ? 'API 联通失败' : '未检测'}
              </span>
            </div>

            <button className="restore-button" onClick={restoreCurrentProvider}>恢复当前 Provider 默认配置</button>

            <section className="settings-note">
              <strong>说明</strong>
              <p>1. 每个模型会单独保存 API Key、Base URL 和 Model。</p>
              <p>2. GPT 5.4 / VivaAPI 与 Claude 4.7 / VivaAPI 的 Base URL 默认为 https://www.vivaapi.cn/v1。</p>
              <p>3. Gemini 或 Claude 兼容网关可使用自定义兼容接口，并填写对应 Base URL 与模型名。</p>
              <p>4. DeepSeek V4 的 Base URL 默认为 https://api.deepseek.com。</p>
              <p>5. 千问 Qwen 使用阿里云百炼 OpenAI 兼容模式，Base URL 默认为 https://dashscope.aliyuncs.com/compatible-mode/v1。</p>
              <p>6. 如果前端由 CDN 托管，后端 API 地址可填写 Node 服务访问域名。</p>
            </section>

            <div className="drawer-bottom">
              <button className="save-button" onClick={() => setShowSettings(false)}>保存并返回</button>
              <button className="secondary-button" onClick={restoreCurrentProvider}>恢复默认</button>
            </div>
          </aside>
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
