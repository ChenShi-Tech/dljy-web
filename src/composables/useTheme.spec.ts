// @vitest-environment happy-dom
// ↑ 勿删：本文件不是 *.component.spec.ts，vitest node project 默认不给 DOM；主题层
//   读写 document.documentElement / localStorage / setTimeout，靠此 pragma 切 happy-dom。
// composables/useTheme.spec.ts — 主题适配层回归（权威源在 services/theme.ts）
// 守什么不变量：
//   ① setTheme 是唯一写入口：同值/非法值 no-op（不触发过渡、不落盘）；
//      生效切换必须同时更新 themeState + <html data-theme> + localStorage 持久化，
//      并清掉三档换肤旧 key（dljy-theme）。
//   ② initTheme 还原顺序：新 key 校验合法 → 旧 key 迁移（default→classic）→ 回退 classic。
//   ③ cssVar/chartChrome 从 <html> 计算样式取色，echarts 配置色随主题走；tooltipBg
//      取不到值时必须回退 '#ffffff'（空串会让 echarts 画透明底）。
// 坏掉的症状：刷新后主题回弹；echarts 在暗色主题下画白底 tooltip；旧 key 残留导致
// 双 key 竞争回弹。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { themeState, type ThemeName } from '../services/theme'
import { THEME_OPTIONS, chartChrome, cssVar, initTheme, setTheme, useTheme } from './useTheme'

const LEGACY_KEY = 'dljy-theme'
const THEME_KEY = 'dljy_theme'

beforeEach(() => {
  // 模块级单例（themeState）与 DOM/localStorage 状态在用例间共享，统一归位。
  localStorage.clear()
  themeState.theme = 'classic'
  delete (themeState as Partial<typeof themeState>).period // 不触碰：period 由真实时钟推导，不在本层验证
  const el = document.documentElement
  delete el.dataset.theme
  delete el.dataset.period
  el.classList.remove('theme-anim')
  el.removeAttribute('style')
})

afterEach(() => {
  vi.useRealTimers()
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition
})

describe('useTheme · options 与初始态', () => {
  it('options 对拍 THEME_OPTIONS：四档顺序即切换器展示顺序', () => {
    const { options } = useTheme()
    expect(options).toBe(THEME_OPTIONS)
    expect(options.map((o) => o.key)).toEqual(['classic', 'arc', 'flow', 'paper'])
  })

  it('默认主题为 classic', () => {
    expect(useTheme().theme.value).toBe('classic')
  })
})

describe('setTheme', () => {
  it('生效切换：themeState + <html data-theme> + localStorage 三处同步，旧 key 清除', () => {
    localStorage.setItem(LEGACY_KEY, 'neon') // 预置三档换肤旧 key
    const { theme } = useTheme()

    setTheme('arc')

    expect(theme.value).toBe('arc')
    expect(document.documentElement.dataset.theme).toBe('arc')
    expect(localStorage.getItem(THEME_KEY)).toBe('arc')
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull() // 旧 key 出清，避免双 key 竞争
  })

  it('同值 no-op：不触发过渡动画（无 theme-anim 类）', () => {
    setTheme('arc')
    // 第一次切换会加 theme-anim（520ms 后自动移除），先手动清掉，隔离观察第二次调用
    document.documentElement.classList.remove('theme-anim')

    setTheme('arc') // 当前已 arc

    expect(themeState.theme).toBe('arc')
    expect(document.documentElement.classList.contains('theme-anim')).toBe(false)
  })

  it('已下线的霓虹不再可选：setTheme(neon) 为 no-op', () => {
    setTheme('neon' as ThemeName)

    expect(themeState.theme).toBe('classic')
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
  })

  it('非法值 no-op：状态不变、不落盘、不触发过渡', () => {
    setTheme('dark' as ThemeName)

    expect(themeState.theme).toBe('classic')
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
    expect(document.documentElement.classList.contains('theme-anim')).toBe(false)
  })

  it('无 View Transitions 兜底：切换时加 theme-anim 过渡类，520ms 后自动移除', () => {
    vi.useFakeTimers()

    setTheme('flow')

    expect(document.documentElement.classList.contains('theme-anim')).toBe(true)
    vi.advanceTimersByTime(530)
    expect(document.documentElement.classList.contains('theme-anim')).toBe(false)
  })

  it('有 View Transitions 分支：过渡回调内提交，状态同样三处同步', () => {
    // happy-dom 无 startViewTransition，stub 为「同步执行回调」的最小实现，覆盖该分支。
    const doc = document as unknown as { startViewTransition?: (cb: () => unknown) => unknown }
    doc.startViewTransition = (cb) => cb()

    setTheme('paper')

    expect(themeState.theme).toBe('paper')
    expect(document.documentElement.dataset.theme).toBe('paper')
    expect(localStorage.getItem(THEME_KEY)).toBe('paper')
  })
})

describe('initTheme · 启动还原', () => {
  it('新 key 存合法主题 → 还原并写入 <html>', () => {
    localStorage.setItem(THEME_KEY, 'arc')

    initTheme()

    expect(themeState.theme).toBe('arc')
    expect(document.documentElement.dataset.theme).toBe('arc')
  })

  it('新 key 非法值 → 回退 classic（不猜、不沿用）', () => {
    localStorage.setItem(THEME_KEY, 'dark')

    initTheme()

    expect(themeState.theme).toBe('classic')
  })

  it('旧 key 迁移：default→classic，neon→flow（霓虹下线并入流光），并回写新 key、清旧 key', () => {
    localStorage.setItem(LEGACY_KEY, 'default')
    initTheme()
    expect(themeState.theme).toBe('classic')

    localStorage.removeItem(THEME_KEY)
    localStorage.setItem(LEGACY_KEY, 'neon')
    initTheme()
    expect(themeState.theme).toBe('flow')
    expect(document.documentElement.dataset.theme).toBe('flow')
    expect(localStorage.getItem(THEME_KEY)).toBe('flow')
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('新 key 存霓虹（已下线）→ 迁到流光并回写，不回落浅色', () => {
    localStorage.setItem(THEME_KEY, 'neon')

    initTheme()

    expect(themeState.theme).toBe('flow')
    expect(document.documentElement.dataset.theme).toBe('flow')
    expect(localStorage.getItem(THEME_KEY)).toBe('flow')
  })

  it('新 key 已是合法主题 → 不做多余回写', () => {
    localStorage.setItem(THEME_KEY, 'paper')
    localStorage.setItem(LEGACY_KEY, 'neon') // 残留旧 key 不应覆盖新 key

    initTheme()

    expect(themeState.theme).toBe('paper')
    expect(localStorage.getItem(LEGACY_KEY)).toBe('neon')
  })
})

describe('cssVar / chartChrome', () => {
  it('cssVar 归一变量名：primary 与 --primary 等价，读计算值并 trim', () => {
    document.documentElement.style.setProperty('--primary', ' #00aabb ')

    expect(cssVar('primary')).toBe('#00aabb')
    expect(cssVar('--primary')).toBe('#00aabb')
    expect(cssVar('not-set')).toBe('')
  })

  it('chartChrome：六个 chrome 色各取对应 CSS 变量', () => {
    const el = document.documentElement
    el.style.setProperty('--chart-axis-label', '#aaaaaa')
    el.style.setProperty('--chart-split-line', '#bbbbbb')
    el.style.setProperty('--chart-neutral-line', '#cccccc')
    el.style.setProperty('--chart-danger', '#dddddd')
    el.style.setProperty('--el-bg-color-overlay', '#eeeeee')
    el.style.setProperty('--line', '#111111')
    el.style.setProperty('--text', '#222222')

    expect(chartChrome()).toEqual({
      axisLabel: '#aaaaaa',
      splitLine: '#bbbbbb',
      neutralLine: '#cccccc',
      danger: '#dddddd',
      tooltipBg: '#eeeeee',
      tooltipBorder: '#111111',
      tooltipText: '#222222'
    })
  })

  it('chartChrome 负例：tooltipBg 取不到值必须回退 #ffffff（空串会画透明底）', () => {
    // 不设 --el-bg-color-overlay：chartChrome() 里 `|| '#ffffff'` 兜底生效
    expect(chartChrome().tooltipBg).toBe('#ffffff')
  })
})
