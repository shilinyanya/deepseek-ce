import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import type { ChatModel, ModelInfo } from './api/types.js'
import { normalizeLocation, type UserLocation } from './location.js'
import { createId } from '../utils/id.js'

/** 一个系统提示词预设：名字随便起，内容为空表示回落到官方身份说明 */
export type PromptPreset = { id: string; name: string; content: string }

export type Locale = 'zh-CN' | 'zh-TW' | 'ja-JP' | 'en-US'

/** 语言下拉的展示顺序 */
export const LOCALES: readonly Locale[] = ['zh-CN', 'zh-TW', 'ja-JP', 'en-US']

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * 界面缩放档位。存的是档位名而不是倍数，
 * 这样下拉框直接可用，也方便以后调数值而不影响已保存的偏好。
 */
export const FONT_SIZE_SCALES = {
  small: 0.9,
  standard: 1,
  large: 1.15,
  xlarge: 1.3,
} as const

export type FontSizeKey = keyof typeof FONT_SIZE_SCALES

/**
 * 内置兜底模型：没联网刷新过、或刷新失败时用这两个。
 * 用户在设置里点「刷新模型列表」后会与 GET /models 的结果合并。
 */
export const DEFAULT_MODELS: readonly ModelInfo[] = [
  { id: 'deepseek-flash' },
  { id: 'deepseek-v4-pro' },
]

/** 未保存过时的默认模型；deepseek-flash 同时支持深度思考与图片输入 */
export const DEFAULT_MODEL: ChatModel = 'deepseek-flash'

/**
 * 上下文用量条的分母兜底：接口（GET /models）没有给出 `context_window` 时按 DeepSeek 官方
 * 上下文窗口 1M（1_000_000 token）计算。内置的兜底模型列表不带这个字段，也会落到这里。
 */
export const DEFAULT_CONTEXT_WINDOW = 1_000_000

/** 官方默认的助手身份说明；用户把系统提示词清空时仍回落到这段内容 */
export const DEFAULT_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

/**
 * 合并模型列表：按 id 去重，新拿到的展示名与上下文长度优先，已有顺序不变，新模型追加在后面。
 * 上下文长度只在新结果里有时覆盖，避免一次失败的刷新把已知的窗口清空。
 */
export const mergeModels = (current: ModelInfo[], incoming: ModelInfo[]): ModelInfo[] => {
  const merged = current.map((item) => ({ ...item }))
  for (const model of incoming) {
    const existing = merged.find((item) => item.id === model.id)
    if (existing) {
      if (model.name) {
        existing.name = model.name
      }
      if (model.contextWindow !== undefined) {
        existing.contextWindow = model.contextWindow
      }
      if (model.maxOutputTokens !== undefined) {
        existing.maxOutputTokens = model.maxOutputTokens
      }
    } else {
      merged.push({ ...model })
    }
  }
  return merged
}

/**
 * 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、
 * 深度思考与智能搜索开关、模型与系统提示词、侧边栏收起状态
 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  /** 界面缩放档位；1 为标准大小 */
  fontSize: FontSizeKey
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  /** 回答生成完是否自动朗读 */
  autoReadAloud: boolean
  /** 新请求使用的模型；已生成回答的模型记录在消息上 */
  model: ChatModel
  /** 模型选择器里可选的模型；刷新按钮会把 /models 的结果并进来 */
  models: ModelInfo[]
  /** 系统提示词预设；第一条固定是「默认」（内容为空表示回落到 DEFAULT_SYSTEM_PROMPT） */
  promptPresets: PromptPreset[]
  /** 新会话默认使用的预设 id */
  defaultPromptPresetId: string
  siderCollapsed: boolean
  /** 开启后会话菜单里出现「压缩上下文」；多数人用不到，默认关 */
  manualCompress: boolean
  /** 实验性：当前模型无法联网时，用指定模型执行搜索/网页读取，再把资料交给当前模型 */
  networkModel: ChatModel
  /** 实验性：是否启用自定义联网模型；关闭时用标准 deepseek-flash */
  networkModelEnabled: boolean
  /** 实验性：标题用额外请求生成（旧接口） */
  titleByExtraRequest: boolean
  /** 启用标题生成：主请求带 title.enabled=true，服务端顺带生成（新接口） */
  titleServerEnabled: boolean
  /** 标题生成方式：新接口（服务端 title.enabled）或旧接口（额外请求） */
  titleMode: 'server' | 'extra'
  /** 使用自定义模型（中转站）：开启后不再走官方模型 */
  relayEnabled: boolean
  /** 中转站地址，例如 https://api.example.com（会自动补 /v1/chat/completions） */
  relayBaseUrl: string
  /** 中转站的 Key；留空表示沿用官方 Key */
  relayApiKey: string
  /** 中转站的模型名，例如 gpt-4o-mini / qwen-max */
  relayModel: string
  /** 会话整理模式（实验）：可以把会话归进自定义分组 */
  sessionOrganizer: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  fontSize: 'chat-demo:font-size',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  autoReadAloud: 'chat-demo:auto-read-aloud',
  manualCompress: 'chat-demo:manual-compress',
  networkModel: 'chat-demo:network-model',
  networkModelEnabled: 'chat-demo:network-model-enabled',
  titleByExtraRequest: 'chat-demo:title-by-extra-request',
  titleServerEnabled: 'chat-demo:title-server-enabled',
  titleMode: 'chat-demo:title-mode',
  relayEnabled: 'chat-demo:relay-enabled',
  relayBaseUrl: 'chat-demo:relay-base-url',
  relayApiKey: 'chat-demo:relay-api-key',
  relayModel: 'chat-demo:relay-model',
  sessionOrganizer: 'chat-demo:session-organizer',
  model: 'chat-demo:model',
  models: 'chat-demo:models',
  systemPrompt: 'chat-demo:system-prompt',
  promptPresets: 'chat-demo:prompt-presets',
  promptPresetDefault: 'chat-demo:prompt-preset-default',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
const browserLanguage = (): string =>
  (typeof navigator === 'undefined' ? 'zh' : (navigator.language ?? '')).toLowerCase()

/**
 * 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。
 * 只有中国大陆习惯用省市两级，港澳台和日文界面都走国家/地区选择。
 */
export const isChineseBrowser = (): boolean => {
  const tag = browserLanguage()
  return (
    tag === 'zh' || tag.startsWith('zh-cn') || tag.startsWith('zh-hans') || tag.startsWith('zh-sg')
  )
}

/** 首次打开时按浏览器语言猜一个：日文 → 繁体 → 简体 → 英文 */
const detectLocale = (): Locale => {
  const tag = browserLanguage()
  if (tag.startsWith('ja')) {
    return 'ja-JP'
  }
  if (tag.startsWith('zh')) {
    return isChineseBrowser() ? 'zh-CN' : 'zh-TW'
  }
  return 'en-US'
}

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  return LOCALES.find((locale) => locale === saved) ?? detectLocale()
}

/** 未保存过或存了非法档位时用标准大小 */
const initialFontSize = (): FontSizeKey => {
  const saved = read(KEYS.fontSize) ?? ''
  return Object.hasOwn(FONT_SIZE_SCALES, saved) ? (saved as FontSizeKey) : 'standard'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 已保存的模型列表与内置兜底模型合并，保证选择器里始终有可选项 */
const initialModels = (): ModelInfo[] => {
  const raw = read(KEYS.models)
  const saved: ModelInfo[] = []
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || typeof item !== 'object') {
            continue
          }
          const { id, name, contextWindow, maxOutputTokens } = item as {
            id?: unknown
            name?: unknown
            contextWindow?: unknown
            maxOutputTokens?: unknown
          }
          if (typeof id !== 'string' || !id.trim()) {
            continue
          }
          const label = typeof name === 'string' ? name.trim() : ''
          const window = typeof contextWindow === 'number' ? contextWindow : undefined
          const maxOutput = typeof maxOutputTokens === 'number' ? maxOutputTokens : undefined
          saved.push({
            id: id.trim(),
            ...(label ? { name: label } : {}),
            // 上下文长度随刷新模型列表一起存盘，重开页面后用量条的分母不会退回兜底值
            ...(window !== undefined && window > 0 ? { contextWindow: window } : {}),
            ...(maxOutput !== undefined && maxOutput > 0 ? { maxOutputTokens: maxOutput } : {}),
          })
        }
      }
    } catch {
      // 数据损坏时按没保存过处理
    }
  }
  return mergeModels([...DEFAULT_MODELS], saved)
}

/** 未保存过、或保存的模型已经不在列表里时用默认模型 */
const initialModel = (models: ModelInfo[]): ChatModel => {
  const saved = read(KEYS.model)
  return models.some((model) => model.id === saved) ? (saved as string) : DEFAULT_MODEL
}

/** 默认预设的固定 id：名字按界面语言显示，内容留空即官方身份说明 */
export const DEFAULT_PRESET_ID = 'default'

/**
 * 读取系统提示词预设列表。
 * 老版本只有一个 systemPrompt 字符串，这里平滑迁移：原来那段自定义内容
 * 变成「默认」预设的内容，不会丢。
 */
const initialPresets = (): PromptPreset[] => {
  const saved = read(KEYS.promptPresets)
  if (saved !== null) {
    try {
      const parsed = JSON.parse(saved) as PromptPreset[]
      if (Array.isArray(parsed) && parsed.length > 0) {
        const valid = parsed.filter(
          (item) => item && typeof item.id === 'string' && typeof item.content === 'string'
        )
        if (valid.length > 0) {
          return valid.some((item) => item.id === DEFAULT_PRESET_ID)
            ? valid
            : [{ id: DEFAULT_PRESET_ID, name: '', content: '' }, ...valid]
        }
      }
    } catch {
      // 存坏了就按下面的迁移逻辑重建
    }
  }
  const legacy = read(KEYS.systemPrompt)
  return [
    {
      id: DEFAULT_PRESET_ID,
      name: '',
      content: legacy && legacy !== DEFAULT_SYSTEM_PROMPT ? legacy : '',
    },
  ]
}

const initialDefaultPresetId = (presets: PromptPreset[]): string => {
  const saved = read(KEYS.promptPresetDefault)
  return saved && presets.some((item) => item.id === saved) ? saved : DEFAULT_PRESET_ID
}

export const useSettings = create<Settings>(() => {
  const models = initialModels()
  const promptPresets = initialPresets()
  return {
    apiKey: read(KEYS.apiKey),
    locale: initialLocale(),
    fontSize: initialFontSize(),
    location: initialLocation(),
    themePreference: initialThemePreference(),
    ttsVoice: initialTtsVoice(),
    thinking: read(KEYS.thinking) === 'true',
    search: read(KEYS.search) === 'true',
    autoReadAloud: read(KEYS.autoReadAloud) === 'true',
    model: initialModel(models),
    models,
    promptPresets,
    defaultPromptPresetId: initialDefaultPresetId(promptPresets),
    siderCollapsed: read(KEYS.siderCollapsed) === 'true',
    manualCompress: read(KEYS.manualCompress) === 'true',
    networkModel: read(KEYS.networkModel) ?? 'deepseek-flash',
    networkModelEnabled: read(KEYS.networkModelEnabled) === 'true',
    titleByExtraRequest: read(KEYS.titleByExtraRequest) === 'true',
    titleServerEnabled: read(KEYS.titleServerEnabled) !== 'false',
    titleMode: read(KEYS.titleMode) === 'extra' ? 'extra' : 'server',
    relayEnabled: read(KEYS.relayEnabled) === 'true',
    relayBaseUrl: read(KEYS.relayBaseUrl) ?? '',
    relayApiKey: read(KEYS.relayApiKey) ?? '',
    relayModel: read(KEYS.relayModel) ?? '',
    sessionOrganizer: read(KEYS.sessionOrganizer) === 'true',
  }
})

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setFontSize = (fontSize: FontSizeKey) => {
  write(KEYS.fontSize, fontSize)
  useSettings.setState({ fontSize })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setAutoReadAloud = (autoReadAloud: boolean) => {
  write(KEYS.autoReadAloud, String(autoReadAloud))
  useSettings.setState({ autoReadAloud })
}

/** 手动压缩上下文：开启后会话菜单里出现「压缩上下文」 */
export const setManualCompress = (manualCompress: boolean) => {
  write(KEYS.manualCompress, String(manualCompress))
  useSettings.setState({ manualCompress })
}

/** 实验性：模型无法联网时使用的搜索模型 */
export const setNetworkModel = (networkModel: ChatModel) => {
  write(KEYS.networkModel, networkModel)
  useSettings.setState({ networkModel })
}

/** 实验性：是否启用自定义联网模型（关闭时用标准 flash） */
export const setNetworkModelEnabled = (networkModelEnabled: boolean) => {
  write(KEYS.networkModelEnabled, String(networkModelEnabled))
  useSettings.setState({ networkModelEnabled })
}

/** 实验性：标题用额外请求生成（关闭时用服务端标题） */
export const setTitleByExtraRequest = (titleByExtraRequest: boolean) => {
  write(KEYS.titleByExtraRequest, String(titleByExtraRequest))
  useSettings.setState({ titleByExtraRequest })
}

/** 启用标题生成（官方新接口：title.enabled） */
export const setTitleServerEnabled = (titleServerEnabled: boolean) => {
  write(KEYS.titleServerEnabled, String(titleServerEnabled))
  useSettings.setState({ titleServerEnabled })
}

/** 标题生成方式：新接口 / 旧接口（二选一） */
export const setTitleMode = (titleMode: 'server' | 'extra') => {
  write(KEYS.titleMode, titleMode)
  useSettings.setState({ titleMode })
}

/** 自定义模型（中转站）开关与参数 */
export const setRelayEnabled = (relayEnabled: boolean) => {
  write(KEYS.relayEnabled, String(relayEnabled))
  useSettings.setState({ relayEnabled })
}

export const setRelayConfig = (config: {  relayBaseUrl?: string
  relayApiKey?: string
  relayModel?: string
}) => {
  if (config.relayBaseUrl !== undefined) {
    write(KEYS.relayBaseUrl, config.relayBaseUrl)
  }
  if (config.relayApiKey !== undefined) {
    write(KEYS.relayApiKey, config.relayApiKey)
  }
  if (config.relayModel !== undefined) {
    write(KEYS.relayModel, config.relayModel)
  }
  useSettings.setState(config)
}

/** 会话整理模式（实验）：只是把会话归类，不改变对话行为 */
export const setSessionOrganizer = (sessionOrganizer: boolean) => {
  write(KEYS.sessionOrganizer, String(sessionOrganizer))
  useSettings.setState({ sessionOrganizer })
}

export const setModel = (model: ChatModel) => {
  write(KEYS.model, model)
  useSettings.setState({ model })
}

/**
 * 上下文用量条的分母：先按消息上记录的模型（缺省用当前选择的模型）找接口给过的窗口，
 * 找不到（没刷新过模型列表、或接口没返回该字段）时回落到 DEFAULT_CONTEXT_WINDOW。
 */
export const getContextWindow = (model?: ChatModel | null): number => {
  const { models, model: current } = useSettings.getState()
  const id = model ?? current
  return models.find((item) => item.id === id)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
}

export const setModels = (models: ModelInfo[]) => {
  write(KEYS.models, JSON.stringify(models))
  useSettings.setState({ models })
}

/** 预设列表变了就整体落盘，避免逐条写坏 */
const persistPresets = (promptPresets: PromptPreset[]) => {
  write(KEYS.promptPresets, JSON.stringify(promptPresets))
  useSettings.setState({ promptPresets })
}

/** 取某个预设的内容；空内容回落到官方身份说明。不传 id 用默认预设。 */
export const getPresetContent = (presetId?: string): string => {
  const { promptPresets, defaultPromptPresetId } = useSettings.getState()
  const id = presetId ?? defaultPromptPresetId
  const preset = promptPresets.find((item) => item.id === id)
  return preset?.content.trim() || DEFAULT_SYSTEM_PROMPT
}

/** 预设名字；「默认」那条的名字按界面语言显示，所以返回空串交给调用方翻译 */
export const getPresetName = (presetId?: string): string => {
  const { promptPresets, defaultPromptPresetId } = useSettings.getState()
  const id = presetId ?? defaultPromptPresetId
  const preset = promptPresets.find((item) => item.id === id)
  return preset?.id === DEFAULT_PRESET_ID ? '' : (preset?.name ?? '')
}

/** 新建一个预设，返回它的 id */
export const addPromptPreset = (name: string, content = ''): string => {
  const id = createId()
  persistPresets([...useSettings.getState().promptPresets, { id, name, content }])
  return id
}

/** 改名字或内容；「默认」只允许改内容 */
export const updatePromptPreset = (id: string, patch: { name?: string; content?: string }) => {
  persistPresets(
    useSettings.getState().promptPresets.map((item) =>
      item.id === id
        ? {
            ...item,
            ...(patch.name !== undefined && id !== DEFAULT_PRESET_ID ? { name: patch.name } : {}),
            ...(patch.content !== undefined ? { content: patch.content } : {}),
          }
        : item
    )
  )
}

/** 删除预设；「默认」删不掉，删掉正在用的那条时默认预设会接回第一位 */
export const removePromptPreset = (id: string) => {
  if (id === DEFAULT_PRESET_ID) {
    return
  }
  persistPresets(useSettings.getState().promptPresets.filter((item) => item.id !== id))
  if (useSettings.getState().defaultPromptPresetId === id) {
    setDefaultPromptPreset(DEFAULT_PRESET_ID)
  }
}

/** 指定新会话默认用哪个预设 */
export const setDefaultPromptPreset = (id: string) => {
  write(KEYS.promptPresetDefault, id)
  useSettings.setState({ defaultPromptPresetId: id })
}

export const setSystemPrompt = (systemPrompt: string) => {
  // 兼容旧入口：写进「默认」预设的内容
  updatePromptPreset(DEFAULT_PRESET_ID, { content: systemPrompt })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
