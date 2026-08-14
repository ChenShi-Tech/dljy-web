// ECharts「arc 弧光」暗色主题注册 + 主题感知工具。
// 规划：docs/agent-harness/主题与信息架构规划.md §1.4 第 2 层
import * as echarts from 'echarts'
import { themeState } from '@/services/theme'

let registered = false

export function ensureArcChartTheme() {
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
}

/** 当前应使用的 ECharts 主题名（暗色档 arc/neon 复用 arc 暗色图表主题；classic/paper 用默认）。 */
export function activeChartTheme(): string | undefined {
  ensureArcChartTheme()
  return themeState.theme === 'arc' || themeState.theme === 'neon' ? 'arc' : undefined
}
