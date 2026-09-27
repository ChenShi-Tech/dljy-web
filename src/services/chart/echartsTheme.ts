// ECharts 暗色图表主题注册（arc 弧光 / flow 流光）+ 主题感知工具。
// 规划：docs/agent-harness/主题与信息架构规划.md §1.4 第 2 层；flow 配色取自品牌开场动效（dljy#3332）。
import * as echarts from 'echarts'
import { themeState } from '@/services/theme'

let registered = false

export function ensureDarkChartThemes() {
  if (registered) return
  registered = true
  echarts.registerTheme('arc', {
    darkMode: true,
    backgroundColor: 'transparent',
    color: ['#22d3ee', '#fbbf24', '#34d399', '#f87171', '#a78bfa', '#38bdf8'],
    textStyle: { color: '#9fb2c8' },
    title: { textStyle: { color: '#d7e4f5' } },
    legend: { textStyle: { color: '#9fb2c8' } },
    tooltip: {
      backgroundColor: '#101d33',
      borderColor: '#1c2c44',
      textStyle: { color: '#d7e4f5' }
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: '#283a55' } },
      axisLabel: { color: '#74879f' },
      splitLine: { show: false }
    },
    valueAxis: {
      axisLine: { show: false },
      axisLabel: { color: '#74879f' },
      splitLine: { lineStyle: { color: 'rgba(56, 189, 248, 0.08)' } }
    },
    grid: { borderColor: '#1c2c44' }
  })
  // 流光：低饱和科技青为主序列，琥珀 / 青绿 / 柔红 / 雾蓝 / 冷白青依次（与开场动效同一色板）
  echarts.registerTheme('flow', {
    darkMode: true,
    backgroundColor: 'transparent',
    color: ['#5cc3d6', '#c9a461', '#5dbe9a', '#e0786e', '#8fa8e0', '#bfe3ec'],
    textStyle: { color: '#a3b8c6' },
    title: { textStyle: { color: '#e6eff4' } },
    legend: { textStyle: { color: '#a3b8c6' } },
    tooltip: {
      backgroundColor: '#0e1e33',
      borderColor: 'rgba(108, 201, 219, 0.28)',
      textStyle: { color: '#e6eff4' }
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: '#22405c' } },
      axisLabel: { color: '#7890a3' },
      splitLine: { show: false }
    },
    valueAxis: {
      axisLine: { show: false },
      axisLabel: { color: '#7890a3' },
      splitLine: { lineStyle: { color: 'rgba(108, 201, 219, 0.08)' } }
    },
    grid: { borderColor: '#1a324a' }
  })
}

/** 当前应使用的 ECharts 主题名（暗色档 arc / flow 各用专属暗色图表主题；classic/paper 用默认）。 */
export function activeChartTheme(): string | undefined {
  ensureDarkChartThemes()
  const t = themeState.theme
  return t === 'arc' || t === 'flow' ? t : undefined
}
