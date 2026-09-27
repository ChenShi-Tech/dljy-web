// 主题适配层：状态与切换的唯一权威源在 services/theme.ts（四档:classic/arc/flow/paper）。
// 本文件保留三档换肤时代的 API 形状（useTheme/chartChrome/cssVar），供 25+ 业务视图
// 与 ThemeSwitcher 继续使用；同时提供 echarts 等 JS 配置的 CSS 变量取色工具。

import { computed } from 'vue'
import {
  THEME_OPTIONS,
  setTheme,
  themeState,
  initTheme,
  type ThemeName,
  type ThemeOption
} from '@/services/theme'

export type ThemeKey = ThemeName
export type { ThemeOption }
export { THEME_OPTIONS, setTheme, initTheme }

/** 当前主题（只读 computed,可 watch 以在切换时重渲染 echarts）。 */
const currentTheme = computed<ThemeName>(() => themeState.theme)

/**
 * 读取当前主题下某个 CSS 变量的计算值(供 echarts 等无法吃 CSS 变量的
 * JS 配置取色)。传入 'primary' 或 '--primary' 均可。
 */
export function cssVar(name: string): string {
  const varName = name.startsWith('--') ? name : `--${name}`
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
}

export interface ChartChrome {
  /** 轴标签 / 轴名文字 */
  axisLabel: string
  /** 网格分隔线 */
  splitLine: string
  /** 中性虚线(markLine 等) */
  neutralLine: string
  /** 涨/正向 / 今日标记等强调红 */
  danger: string
  /** tooltip 背景(纯色,echarts 不吃渐变) */
  tooltipBg: string
  /** tooltip 边框 */
  tooltipBorder: string
  /** tooltip 文字 */
  tooltipText: string
}

/**
 * echarts 图表 chrome 取色(随当前主题)。在每个 render 函数内调用取最新值,
 * 并 watch(theme) 重渲染即可让图表随主题切换。数据系列色为数据编码,不走此函数。
 */
export function chartChrome(): ChartChrome {
  return {
    axisLabel: cssVar('--chart-axis-label'),
    splitLine: cssVar('--chart-split-line'),
    neutralLine: cssVar('--chart-neutral-line'),
    danger: cssVar('--chart-danger'),
    tooltipBg: cssVar('--el-bg-color-overlay') || '#ffffff',
    tooltipBorder: cssVar('--line'),
    tooltipText: cssVar('--text')
  }
}

export function useTheme() {
  return {
    /** 当前主题(只读,可 watch 以在切换时重渲染 echarts) */
    theme: currentTheme,
    options: THEME_OPTIONS,
    setTheme,
    cssVar
  }
}
