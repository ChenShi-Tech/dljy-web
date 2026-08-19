// 语音服务:语音识别(ASR)+ 语音合成(TTS)。
// provider 可切换:
// · native：浏览器原生 Web Speech API,免费、零接入,默认/演示用;
// · cloud ：第三方云语音(讯飞 / 百度 等),接口与配置已预留,需按厂商协议对接。
// 两种都保留:native 开箱即用,cloud 可在设置里配置后切换,代码无需返工。

export type VoiceProvider = 'native' | 'cloud'
export type VoiceConfig = {
  provider: VoiceProvider
  tts: boolean // 跳转/确认时是否语音播报
  cloud?: { baseURL?: string; apiKey?: string; appId?: string }
}

const KEY = 'dljy_voice_config'
// tts 默认关:AI 回复不再自动朗读(改为每条回复手动「朗读」按钮);tts 仅控制页面跳转/确认提示音,
// 由「AI 设置 → 语音播报」开关切换。
const DEFAULT_CONFIG: VoiceConfig = { provider: 'native', tts: false }

export function getVoiceConfig(): VoiceConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as VoiceConfig) }
  } catch {
    /* ignore broken cache */
  }
  return { ...DEFAULT_CONFIG }
}

export function saveVoiceConfig(cfg: Partial<VoiceConfig>) {
  localStorage.setItem(KEY, JSON.stringify({ ...getVoiceConfig(), ...cfg }))
}

// 识别器统一接口
export type RecognizerHandlers = {
  onInterim?: (text: string) => void // 实时中间结果(边说边出)
  onFinal?: (text: string) => void // 一句说完的最终结果
  onStart?: () => void
  onEnd?: () => void
  onError?: (msg: string) => void
}
export interface Recognizer {
  start(): void
  stop(): void
  readonly listening: boolean
}

// 浏览器是否支持原生语音识别
export function isNativeSupported(): boolean {
  return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
}

export function isVoiceSupported(provider?: VoiceProvider): boolean {
  const p = provider ?? getVoiceConfig().provider
  if (p === 'cloud') return !!getVoiceConfig().cloud?.baseURL
  return isNativeSupported()
}

// 浏览器是否支持语音合成（TTS 朗读），与 isNativeSupported（语音识别 ASR）正交：
// Firefox 等支持 speechSynthesis 但不支持 SpeechRecognition，朗读按钮应据此独立检测，
// 而非混用 ASR 能力的 isVoiceSupported，否则在不支持 ASR 的环境会误隐藏朗读按钮。
export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

// 原生实现(Web Speech API)
function createNativeRecognizer(handlers: RecognizerHandlers): Recognizer {
  const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  let listening = false
  if (!SR) {
    return {
      get listening() { return false },
      start() { handlers.onError?.('当前浏览器不支持语音识别,建议用 Chrome / Edge,或切换为云语音。'); handlers.onEnd?.() },
      stop() {}
    }
  }
  const rec = new SR()
  rec.lang = 'zh-CN'
  rec.interimResults = true
  rec.continuous = false
  rec.maxAlternatives = 1

  rec.onstart = () => { listening = true; handlers.onStart?.() }
  rec.onend = () => { listening = false; handlers.onEnd?.() }
  rec.onerror = (e: any) => {
    const map: Record<string, string> = {
      'no-speech': '没听到声音,再说一次试试。',
      'not-allowed': '麦克风权限被拒绝,请在浏览器地址栏允许麦克风。',
      'audio-capture': '没有检测到麦克风设备。',
      'network': '语音识别网络异常(原生识别需联网)。'
    }
    handlers.onError?.(map[e?.error] || ('语音识别出错:' + (e?.error || '未知')))
  }
  rec.onresult = (e: any) => {
    let interim = '', final = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0]?.transcript ?? ''
      if (e.results[i].isFinal) final += t
      else interim += t
    }
    if (interim) handlers.onInterim?.(interim)
    if (final) handlers.onFinal?.(final.trim())
  }

  return {
    get listening() { return listening },
    start() { try { rec.start() } catch { /* 已在录音,忽略重复 start */ } },
    stop() { try { rec.stop() } catch { /* ignore */ } }
  }
}

// 云语音实现(预留)
// 接讯飞 / 百度 等:通常是 MediaRecorder 录音 → WebSocket / HTTP 上传 → 返回文本。
// 各厂商协议不同,这里保留统一出入口;未配置时给出友好提示,引导用原生或去设置。
function createCloudRecognizer(handlers: RecognizerHandlers): Recognizer {
  const cfg = getVoiceConfig()
  return {
    get listening() { return false },
    start() {
      if (!cfg.cloud?.baseURL) {
        handlers.onError?.('云语音尚未配置(已预留接口)。请在「AI 设置」填写云语音地址与密钥,或继续使用浏览器原生识别。')
      } else {
        handlers.onError?.('云语音对接占位:已读取到配置,接入具体厂商(讯飞/百度)协议后即可启用。')
      }
      handlers.onEnd?.()
    },
    stop() {}
  }
}

export function createRecognizer(handlers: RecognizerHandlers, provider?: VoiceProvider): Recognizer {
  const p = provider ?? getVoiceConfig().provider
  return p === 'cloud' ? createCloudRecognizer(handlers) : createNativeRecognizer(handlers)
}

// 语音合成(TTS)
// 挑一个尽量好听的中文嗓音:微软神经在线声(晓晓/云希等)> Apple 中文女声 > 系统中文女声。
let cachedVoice: SpeechSynthesisVoice | null = null
function bestZhVoice(): SpeechSynthesisVoice | null {
  const vs = window.speechSynthesis?.getVoices?.() ?? []
  if (!vs.length) return null
  const score = (v: SpeechSynthesisVoice) => {
    const n = v.name
    let s = 0
    if (/zh|cmn|chinese/i.test(v.lang)) s += 10
    else if (/^yue|HK|TW/i.test(v.lang)) s += 4
    if (/xiaoxiao|xiaoyi|yunxi|yunyang|yunjian|晓晓|晓伊|云希|云扬|云健/i.test(n)) s += 9 // 微软神经在线
    if (/online|natural|neural/i.test(n)) s += 5
    if (/tingting|mei-?jia|sinji|婷婷|美佳/i.test(n)) s += 6 // Apple
    if (/huihui|yaoyao|kangkang/i.test(n)) s += 3 // 旧微软
    if (/female|女/i.test(n)) s += 2
    return s
  }
  return vs.slice().sort((a, b) => score(b) - score(a))[0] ?? null
}
function ensureVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice
  cachedVoice = bestZhVoice()
  return cachedVoice
}
// 嗓音列表是异步加载的,首次可能为空 → 加载完成后再挑一次
try {
  window.speechSynthesis?.addEventListener?.('voiceschanged', () => { cachedVoice = bestZhVoice() })
} catch { /* ignore */ }

export function speak(text: string, opts?: { force?: boolean; onEnd?: () => void }) {
  if (!text) return
  if (!opts?.force && !getVoiceConfig().tts) return
  try {
    const synth = window.speechSynthesis
    if (!synth) return
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    const v = ensureVoice()
    if (v) { u.voice = v; u.lang = v.lang } else { u.lang = 'zh-CN' }
    u.rate = 1.0
    u.pitch = 1.05 // 略柔和
    // onEnd:播放自然结束或出错都回调一次,供调用方复位「正在朗读」状态(按钮图标)。
    if (opts?.onEnd) {
      u.onend = () => opts.onEnd?.()
      u.onerror = () => opts.onEnd?.()
    }
    synth.speak(u)
  } catch {
    /* TTS 不可用则静默降级 */
  }
}

export function cancelSpeak() {
  try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
}
