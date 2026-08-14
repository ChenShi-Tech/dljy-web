// Shared mock data for the /demo/* cockpit style showcases.
// Pure deterministic mock (no backend) — only used by the demo pages.

// 96-point (15-min) intraday curve, ¥/MWh — day-ahead vs realtime spot price.
function curve(seed: number, base: number, amp: number) {
  const out: number[] = []
  for (let i = 0; i < 96; i++) {
    const h = i / 4
    // morning + evening peaks, midday solar dip
    const peak = Math.sin((h - 8) / 24 * Math.PI * 2) * amp
    const evening = Math.exp(-Math.pow((h - 19) / 2.4, 2)) * amp * 1.5
    const solarDip = -Math.exp(-Math.pow((h - 13) / 2.6, 2)) * amp * 1.1
    const wob = Math.sin(i * 0.7 + seed) * amp * 0.16
    out.push(Math.round((base + peak + evening + solarDip + wob) * 10) / 10)
  }
  return out
}

export const timeLabels = Array.from({ length: 96 }, (_, i) => {
  const m = i * 15
  const hh = String(Math.floor(m / 60)).padStart(2, '0')
  const mm = String(m % 60).padStart(2, '0')
  return `${hh}:${mm}`
})

export const dayAhead = curve(1.2, 386, 150)
export const realtime = curve(2.7, 372, 188)

// New-energy output share (%) across the day
export const newEnergyShare = Array.from({ length: 96 }, (_, i) => {
  const h = i / 4
  const solar = Math.exp(-Math.pow((h - 13) / 4.2, 2)) * 46
  const wind = 18 + Math.sin(i * 0.5) * 6
  return Math.round((solar + wind) * 10) / 10
})

export type Kpi = {
  label: string
  value: number
  unit: string
  delta: number // percent change
  spark: number[]
  decimals?: number
}

function spark(seed: number) {
  return Array.from({ length: 16 }, (_, i) => Math.round((Math.sin(i * 0.6 + seed) * 0.5 + Math.sin(i * 0.21 + seed) * 0.5 + 1.6) * 100) / 100)
}

export const kpis: Kpi[] = [
  { label: '当日现货均价', value: 412.6, unit: '元/MWh', delta: 3.8, spark: spark(1), decimals: 1 },
  { label: '峰谷价差', value: 486.2, unit: '元/MWh', delta: 12.4, spark: spark(2), decimals: 1 },
  { label: '新能源出力占比', value: 41.7, unit: '%', delta: 5.2, spark: spark(3), decimals: 1 },
  { label: '持仓浮动收益', value: 238.5, unit: '万元', delta: 8.9, spark: spark(4), decimals: 1 },
  { label: '日前出清电量', value: 6.84, unit: '亿kWh', delta: -2.1, spark: spark(5), decimals: 2 },
  { label: '价格预测准确率', value: 94.3, unit: '%', delta: 1.6, spark: spark(6), decimals: 1 },
]

// Region clearing snapshot table (mock) for the overview "市场快照"
export const regionRows = [
  { region: '晋北', price: 421.3, load: 3820, ne: 44.1, status: '偏紧' },
  { region: '晋中', price: 408.7, load: 5210, ne: 39.8, status: '平衡' },
  { region: '晋南', price: 396.2, load: 4470, ne: 47.5, status: '宽松' },
  { region: '晋东南', price: 433.9, load: 2960, ne: 35.2, status: '偏紧' },
]

// AI analysis artifact (mock) — the table the AI "generates"
export const aiArtifactTable = {
  title: '次日 24 时段现货价格预测 · 关键时段',
  columns: ['时段', '日前预测(元/MWh)', '实时预测(元/MWh)', '价差', '建议'],
  rows: [
    ['07:00–09:00', '486.2', '512.8', '+26.6', '逢高出货'],
    ['11:30–13:30', '208.5', '176.3', '−32.2', '低谷补仓'],
    ['18:00–20:30', '598.7', '641.2', '+42.5', '峰段顶格申报'],
    ['23:00–24:00', '312.4', '298.6', '−13.8', '持仓观望'],
  ],
}

// The AI "streamed" analysis paragraph
export const aiAnalysisText =
  '已完成对山西现货市场次日 96 点价格曲线的回归分析。综合负荷预测、新能源出力预测与机组检修计划:晚高峰(18:00–20:30)受光伏退坡叠加负荷抬升影响,价格中枢上移至 598 元/MWh,较今日 +42.5;午间(11:30–13:30)光伏大发压价至 208 元/MWh 低谷。建议:晚峰顶格申报、午谷择机补仓,全天预期增益约 23.8 万元。'

export const aiChips = ['分析次日价格走势', '复盘本周持仓收益', '新能源出力对价格的影响', '生成今日交易建议']
