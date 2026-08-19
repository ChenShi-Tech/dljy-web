// 主题服务（全站唯一权威源）：四档主题 classic（经典浅色）/ arc（弧光·能源科技暗色）
// / neon（霓虹·深色辉光）/ paper（暖纸·暖色质感），唯一写入 <html data-theme>。
// 同时维护市场时段 data-period（峰/平/谷），驱动时段感知配色与电价带。
// 历史：classic/arc 来自 agent-harness 规划（docs/agent-harness/主题与信息架构规划.md）；
// neon/paper 来自三档换肤交接（历史文档已归档，git log 可追溯），
// 本文件在合并时统一两套系统。composables/useTheme.ts 是本服务的薄适配层。

import { nextTick, reactive } from 'vue'

export type ThemeName = 'classic' | 'arc' | 'neon' | 'paper'
export type MarketPeriod = 'peak' | 'flat' | 'valley'

export interface ThemeOption {
  key: ThemeName
  label: string
  desc: string
}

/** 四档主题选项（顺序即切换器展示顺序）。 */
export const THEME_OPTIONS: ThemeOption[] = [
  { key: 'classic', label: '经典', desc: '浅色商务' },
  { key: 'arc', label: '弧光', desc: '能源科技暗色 · 时段感知' },
  { key: 'neon', label: '霓虹', desc: '深色辉光' },
  { key: 'paper', label: '暖纸', desc: '暖纸质感' }
]

const KEY = 'dljy_theme'
const LEGACY_KEY = 'dljy-theme' // 三档换肤旧 key（'default'|'neon'|'paper'）
const VALID = new Set<ThemeName>(['classic', 'arc', 'neon', 'paper'])

// 峰谷时段表（小时 → 时段），默认参考晋蒙鲁常见目录结构，可按省调整
const PEAK_HOURS = new Set([8, 9, 10, 17, 18, 19, 20, 21])
const VALLEY_HOURS = new Set([0, 1, 2, 3, 4, 5, 6, 12, 13])

export const themeState = reactive<{ theme: ThemeName; period: MarketPeriod }>({
  theme: 'classic',
  period: 'flat'
})

export function currentPeriod(date = new Date()): MarketPeriod {
  const h = date.getHours()
  if (PEAK_HOURS.has(h)) return 'peak'
  if (VALLEY_HOURS.has(h)) return 'valley'
  return 'flat'
}

export const periodLabel: Record<MarketPeriod, string> = {
  peak: '峰段',
  flat: '平段',
  valley: '谷段'
}

function apply() {
  const el = document.documentElement
  el.dataset.theme = themeState.theme
  el.dataset.period = themeState.period
}

function readStoredTheme(): ThemeName {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw && VALID.has(raw as ThemeName)) return raw as ThemeName
    // 迁移三档换肤旧 key：'default' → 'classic'，neon/paper 原样
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const mapped = legacy === 'default' ? 'classic' : (legacy as ThemeName)
      if (VALID.has(mapped)) return mapped
    }
  } catch {
    /* localStorage 不可用（隐私模式等）时回退默认 */
  }
  return 'classic'
}

function persist(theme: ThemeName) {
  try {
    localStorage.setItem(KEY, theme)
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* 持久化失败不影响本次切换 */
  }
}

let animTimer = 0

/** 不支持 View Transitions 的浏览器兜底：临时过渡类做颜色淡入（theme.css .theme-anim）。 */
function playThemeTransition() {
  try {
    const el = document.documentElement
    el.classList.add('theme-anim')
    window.clearTimeout(animTimer)
    animTimer = window.setTimeout(() => el.classList.remove('theme-anim'), 520)
  } catch {
    /* ignore */
  }
}

/** 切换主题：View Transitions 整页交叉淡入（无残影），更新状态 + data-theme + 持久化。 */
export function setTheme(theme: ThemeName) {
  if (!VALID.has(theme) || theme === themeState.theme) return
  const commit = () => {
    themeState.theme = theme
    persist(theme)
    apply()
  }
  const doc = document as unknown as { startViewTransition?: (cb: () => unknown) => unknown }
  if (typeof doc.startViewTransition === 'function') {
    doc.startViewTransition(() => {
      commit()
      return nextTick()
    })
  } else {
    playThemeTransition()
    commit()
  }
}

/** 兼容旧调用：经典 ⇄ 弧光。 */
export function toggleTheme() {
  setTheme(themeState.theme === 'arc' ? 'classic' : 'arc')
}

let timer: number | undefined

export function initTheme() {
  themeState.theme = readStoredTheme()
  themeState.period = currentPeriod()
  apply()
  // 每分钟校准市场时段（跨时段时界面随之换色）
  if (timer === undefined) {
    timer = window.setInterval(() => {
      const p = currentPeriod()
      if (p !== themeState.period) {
        themeState.period = p
        apply()
      }
    }, 60_000)
  }
}
