// ECharts 图表「美学设计语言」层：与 chartOptions.ts 分工：
// chartOptions.ts 管「展示规范」(单位 tooltip / dataZoom / toolbox / 空态)；
// chartStyle.ts   管「美学质感」(语义色板 / 渐变 / 圆角 / 标注 / 动效 / 精致 tooltip)。
//
// 设计取向：电力交易控制室式的克制专业感：语义化配色、面积渐变、圆角柱、
// 描边 tooltip、阈值/相位标注、克制动效(≤600ms cubicOut)。所有 chrome 取色走
// chartChrome()，随 classic/arc/neon/paper 四档主题自动切换，暗色下同样精致。
//
// 用法：在视图 render() 内组合调用：palette()/lineSeries()/stepSeries()/barSeries()/
// gradientArea()/markLineThreshold()/tooltipStyle() 等拼进 setOption。
//
// 曲线真实呈现纪律：禁用 smooth 平滑(样条插值会画出数据中不存在的假峰谷)；
// 按时段恒定的值(出清价/申报量/持仓比例)用 stepSeries 阶梯线，连续物理量采样用 lineSeries 直线。
import { cssVar, chartChrome } from '@/composables/useTheme'
import { fmtNum, chartToolbox } from '@/services/chart/chartOptions'

/* 配色系统 */

/** 电力语义命名色：系列按业务含义取色，保证跨视图一致(负荷恒为蓝、新能源恒为青绿…)。 */
export const POWER = {
  load: '#2563eb',        // 负荷 / 用电量：蓝
  newEnergy: '#0f9d8a',   // 新能源合计：青绿(与 --primary teal 同族)
  wind: '#38bdf8',        // 风电：浅天蓝
  solar: '#f59e0b',       // 光伏：琥珀
  thermal: '#b45309',     // 火电 / 燃煤：赭
  hydro: '#0891b2',       // 水电：青
  nuclear: '#db2777',     // 核电：品红
  storage: '#7c3aed',     // 储能：紫
  price: '#f97316',       // 价格：橙
  forecast: '#94a3b8',    // 预测 / 计划：中性灰(常配虚线)
  deviation: '#dc2626',   // 偏差 / 风险：红
  positive: '#16a34a',    // 盈利 / 买入 / 正向：绿
  negative: '#dc2626'     // 亏损 / 卖出 / 负向：红
} as const

/** 通用分类色板(≥10 色)：未指定语义时按序取色，色相分散、明度协调。 */
const CATEGORICAL = [
  '#2563eb', '#0f9d8a', '#f97316', '#b45309', '#0891b2',
  '#7c3aed', '#db2777', '#16a34a', '#eab308', '#64748b'
]

/** 取分类色板(可旋转起点)。 */
export function palette(offset = 0): string[] {
  if (!offset) return [...CATEGORICAL]
  const n = CATEGORICAL.length
  return CATEGORICAL.map((_, i) => CATEGORICAL[(i + offset) % n])
}

/** 顺序色板(浅→深 青蓝)：用于热力图强度 / 单色 visualMap。 */
const SEQUENTIAL = ['#e0f7f4', '#9ce0d6', '#4fc3b0', '#16a394', '#0b6f64']
export function seqColors(): string[] {
  return [...SEQUENTIAL]
}

/** 发散色板(蓝冷 ← 中性 → 红暖)：用于 ONI/温度距平等正负发散量(RdBu 反向)。 */
const DIVERGING = ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b']
export function divergingColors(): string[] {
  return [...DIVERGING]
}

/* 渐变与质感 */

type GradientStop = { offset: number; color: string }
function linear(stops: GradientStop[]) {
  return { type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: stops }
}

/** 十六进制色 + alpha → rgba 字符串(alpha 0~1)。 */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 面积渐变填充：顶部实色 → 底部近透明，营造体积感。 */
export function gradientArea(color: string, topAlpha = 0.32, bottomAlpha = 0.02) {
  return {
    color: linear([
      { offset: 0, color: withAlpha(color, topAlpha) },
      { offset: 1, color: withAlpha(color, bottomAlpha) }
    ])
  }
}

/* 系列预设 */

/** 折线系列基底：直线连接采样点(不平滑，平滑样条会画出数据中不存在的假峰谷)、2.5px、悬停聚焦本系列、隐藏数据点(悬停时显)。 */
export function lineSeries(name: string, data: unknown[], color?: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    type: 'line' as const,
    data,
    smooth: false,
    symbol: 'circle',
    symbolSize: 6,
    showSymbol: false,
    lineStyle: { width: 2.5, ...(color ? { color } : {}) },
    ...(color ? { itemStyle: { color } } : {}),
    emphasis: { focus: 'series' as const },
    ...extra
  }
}

/**
 * 阶梯线系列：用于「按时段恒定」的值，现货出清价/申报价、申报电量、持仓比例、策略系数等。
 * 电力现货 96 点(15min)/24 点(1h)数据每个点代表一个时段的恒定值，物理形态就是阶梯。
 *
 * ⚠️ step 方向必须匹配 x 轴标签口径（错配会让曲线整体错位一格，#335）：
 * - 时段「末刻」标签(首点 00:15/01:00，如 sdpt 采集 POINTS_96=(i+1)*15) → 默认 'start'(00:15 的值覆盖 00:00~00:15)；
 * - 时段「起点」标签(首点 00:00/0:00，如 i*15、slot0=00:00、agent hour=0 起) → 传 extra {step:'end'}(横段保持当前点值至下一点)。
 */
export function stepSeries(name: string, data: unknown[], color?: string, extra: Record<string, unknown> = {}) {
  return {
    step: 'start' as const,
    ...lineSeries(name, data, color, extra)
  }
}

/** 面积折线系列：lineSeries + 渐变填充。 */
export function areaSeries(name: string, data: unknown[], color: string, extra: Record<string, unknown> = {}) {
  return lineSeries(name, data, color, { areaStyle: gradientArea(color), ...extra })
}

/** 柱状系列基底：顶部圆角、悬停聚焦。 */
export function barSeries(name: string, data: unknown[], color?: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    type: 'bar' as const,
    data,
    barMaxWidth: 36,
    itemStyle: { borderRadius: [4, 4, 0, 0], ...(color ? { color } : {}) },
    emphasis: { focus: 'series' as const },
    ...extra
  }
}

/** 正负双向柱配色 callback：正值绿、负值红(盈亏 / 净持仓等)。 */
export function signColorItem() {
  return {
    color: (p: { value: number | number[] }) => {
      const v = Array.isArray(p.value) ? p.value[p.value.length - 1] : p.value
      return Number(v) >= 0 ? POWER.positive : POWER.negative
    },
    borderRadius: [3, 3, 3, 3]
  }
}

/* 标注 */

/** 阈值参考线(水平虚线 + 端部标签)：如频率 50Hz、利润率 0、ONI ±0.5。 */
export function markLineThreshold(value: number, label: string, color?: string) {
  const c = color || chartChrome().neutralLine || '#c8cdd6'
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { type: 'dashed' as const, color: c, width: 1.2 },
    label: { formatter: label, position: 'end' as const, color: c, fontSize: 11 },
    data: [{ yAxis: value }]
  }
}

type Band = { from: number; to: number; color: string; label?: string }
/** 区间色带(水平):ENSO 暖/冷相位、峰谷分时背景等。from/to 为 y 轴值。 */
export function markAreaBands(bands: Band[]) {
  return {
    silent: true,
    data: bands.map((b) => [
      { yAxis: b.from, itemStyle: { color: withAlpha(b.color, 0.1) }, ...(b.label ? { label: { show: true, formatter: b.label, color: withAlpha(b.color, 0.9), fontSize: 11, position: 'insideTopLeft' as const } } : {}) },
      { yAxis: b.to }
    ])
  }
}

/** 高亮最大/最小/最新值的 markPoint(实时数据「最新值高亮」)。 */
export function markPointExtrema(opts: { max?: boolean; min?: boolean } = { max: true, min: true }) {
  const data: Record<string, string>[] = []
  if (opts.max) data.push({ type: 'max', name: '峰值' })
  if (opts.min) data.push({ type: 'min', name: '谷值' })
  return {
    symbol: 'pin',
    symbolSize: 44,
    label: { fontSize: 10, color: '#fff' },
    data
  }
}

/* 精致 tooltip / 图例 / grid */

/** tooltip 视觉皮肤(描边 + 投影 + 圆角)。与 chartOptions.axisTooltip 的 formatter 组合使用。 */
export function tooltipStyle() {
  const cc = chartChrome()
  return {
    backgroundColor: cc.tooltipBg || '#ffffff',
    borderColor: cssVar('--primary') || '#0f766e',
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: cc.tooltipText || '#1f2a37', fontSize: 12 },
    extraCssText: 'border-radius:8px;box-shadow:0 6px 24px rgba(15,23,42,0.14);backdrop-filter:saturate(1.2);'
  }
}

/** 可滚动圆角图例(系列多时不溢出)。position 默认顶部居中。 */
export function legend(extra: Record<string, unknown> = {}) {
  const cc = chartChrome()
  return {
    type: 'scroll' as const,
    top: 2,
    icon: 'roundRect',
    itemWidth: 14,
    itemHeight: 8,
    itemGap: 14,
    textStyle: { color: cc.axisLabel || '#909399', fontSize: 12 },
    ...extra
  }
}

/** 统一 grid 边距(containLabel 自适应轴标签)。hasLegend/hasZoom 时上下留白更多。 */
export function grid(opts: { legend?: boolean; zoom?: boolean; right?: number } = {}) {
  return {
    left: 12,
    right: opts.right ?? 18,
    top: opts.legend ? 40 : 24,
    bottom: opts.zoom ? 36 : 12,
    containLabel: true
  }
}

/** X 轴基底(类目)：轴线淡、标签取 chrome 色。 */
export function catAxis(data: unknown[], extra: Record<string, unknown> = {}) {
  const cc = chartChrome()
  return {
    type: 'category' as const,
    data,
    boundaryGap: true,
    axisLine: { lineStyle: { color: cc.splitLine || '#e5e7eb' } },
    axisTick: { show: false },
    axisLabel: { color: cc.axisLabel || '#909399', fontSize: 11 },
    ...extra
  }
}

/** Y 轴基底(数值)：去轴线、虚分隔线。name 显示在轴顶。 */
export function valueAxis(name = '', extra: Record<string, unknown> = {}) {
  const cc = chartChrome()
  return {
    type: 'value' as const,
    name,
    nameTextStyle: { color: cc.axisLabel || '#909399', fontSize: 11, align: 'left' as const },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: cc.splitLine || '#f0f2f5', type: 'dashed' as const } },
    axisLabel: { color: cc.axisLabel || '#909399', fontSize: 11 },
    ...extra
  }
}

/* 动效 */

/** 克制入场动效(≤600ms cubicOut + 轻微逐项延迟)，避免廉价弹跳感。 */
export function animation() {
  return {
    animationDuration: 600,
    animationEasing: 'cubicOut' as const,
    animationDelay: (idx: number) => idx * 12
  }
}

/** visualMap(连续) 通用皮肤：用于热力图。calculable 可拖拽。 */
export function continuousVisualMap(opts: { min: number; max: number; colors?: string[]; text?: [string, string]; dimension?: number }) {
  const cc = chartChrome()
  return {
    type: 'continuous' as const,
    min: opts.min,
    max: opts.max,
    calculable: true,
    orient: 'horizontal' as const,
    left: 'center',
    bottom: 0,
    itemWidth: 12,
    itemHeight: 120,
    ...(opts.dimension !== undefined ? { dimension: opts.dimension } : {}),
    ...(opts.text ? { text: opts.text } : {}),
    textStyle: { color: cc.axisLabel || '#909399', fontSize: 11 },
    inRange: { color: opts.colors ?? seqColors() }
  }
}

/* 分时背景 / 参考线 / 浮层 */

/** 峰平谷分时定义：from/to 为小时(0-24)。 */
export interface PeriodDef { from: number; to: number; label: string; color: string }

/** 电力默认峰平谷划分(可按地区规则覆盖)：低谷/高峰/尖峰/平段。 */
export const DEFAULT_PERIODS: PeriodDef[] = [
  { from: 0, to: 8, label: '低谷', color: POWER.load },
  { from: 8, to: 11, label: '高峰', color: POWER.solar },
  { from: 11, to: 14, label: '尖峰', color: POWER.deviation },
  { from: 14, to: 17, label: '平段', color: '#94a3b8' },
  { from: 17, to: 22, label: '高峰', color: POWER.solar },
  { from: 22, to: 24, label: '低谷', color: POWER.load }
]

/**
 * 峰平谷时段背景(markArea)：给日内曲线加分时底色。挂到任一 series.markArea。
 * xLabels 为 X 轴类目(形如 '08:00'/'08:15')，按小时映射到对应类目定位。
 */
export function markPeriodBands(xLabels: string[], periods: PeriodDef[] = DEFAULT_PERIODS) {
  const hourOf = (s: unknown): number => {
    const m = /(\d{1,2}):(\d{2})/.exec(String(s))
    return m ? Number(m[1]) + Number(m[2]) / 60 : NaN
  }
  const hours = xLabels.map(hourOf)
  const labelAt = (h: number): string => {
    let idx = hours.findIndex((hh) => Number.isFinite(hh) && hh >= h)
    if (idx < 0) idx = xLabels.length - 1
    return xLabels[idx] ?? ''
  }
  return {
    silent: true,
    data: periods.map((p) => [
      {
        xAxis: labelAt(p.from),
        itemStyle: { color: withAlpha(p.color, 0.07) },
        label: { show: true, formatter: p.label, color: withAlpha(p.color, 0.85), fontSize: 10, position: 'insideTop' as const }
      },
      { xAxis: labelAt(p.to) }
    ])
  }
}

/** 通用水平参考线(markLine)：均值/目标/阈值/基线等。挂到任一 series.markLine。 */
export function markLinesAt(lines: { value: number; label: string; color?: string }[]) {
  const neutral = chartChrome().neutralLine || '#c8cdd6'
  return {
    silent: true,
    symbol: 'none' as const,
    data: lines.map((l) => ({
      yAxis: l.value,
      lineStyle: { type: 'dashed' as const, color: l.color || neutral, width: 1.2 },
      label: { formatter: l.label, position: 'end' as const, color: l.color || neutral, fontSize: 11 }
    }))
  }
}

/** 图角常驻 KPI 浮层(graphic)：大数字 + 副标题，叠加在图上。默认右上角竖排。 */
export function kpiOverlay(items: { text: string; sub?: string; color?: string }[], pos: { right?: number; top?: number; left?: number } = { right: 18, top: 8 }) {
  const cc = chartChrome()
  const children: Record<string, unknown>[] = []
  let y = 0
  for (const it of items) {
    children.push({ type: 'text', left: 0, top: y, style: { text: it.text, fontSize: 20, fontWeight: 700, fill: it.color || cssVar('--primary') || '#0f766e' } })
    y += 24
    if (it.sub) {
      children.push({ type: 'text', left: 0, top: y, style: { text: it.sub, fontSize: 11, fill: cc.axisLabel || '#909399' } })
      y += 18
    }
    y += 6
  }
  return {
    graphic: [{
      type: 'group' as const,
      ...(pos.left !== undefined ? { left: pos.left } : { right: pos.right ?? 18 }),
      top: pos.top ?? 8,
      silent: true,
      children
    }]
  }
}

/* 工具箱 / 分段着色 / 实时 */

/** 增强工具箱：在 chartToolbox 基础上加 折线↔柱↔堆叠 一键切换(magicType)。 */
export function enhancedToolbox(name = '图表', magic: ('line' | 'bar' | 'stack')[] = ['line', 'bar']) {
  const base = chartToolbox(name) as { feature?: Record<string, unknown> }
  return {
    ...base,
    feature: {
      ...(base.feature ?? {}),
      magicType: { type: magic, title: { line: '切折线', bar: '切柱状', stack: '切堆叠' } }
    }
  }
}

/**
 * 底部增强工具箱：在 enhancedToolbox 基础上移到底部右下角。
 * 保留 magicType 折线/柱/堆叠切换；top:'auto' 覆盖继承自 chartToolbox 的 top:0，否则 bottom 不生效。
 */
export function bottomEnhancedToolbox(
  name = '图表',
  right = 8,
  magic: ('line' | 'bar' | 'stack')[] = ['line', 'bar', 'stack']
) {
  return { ...enhancedToolbox(name, magic), top: 'auto' as const, bottom: 0, right }
}

type Piece = { lt?: number; gt?: number; lte?: number; gte?: number; value?: number; color: string; label?: string }
/** 分段视觉映射(piecewise)：按区间给值红黄绿等着色(价格/偏差分级)。 */
export function piecewiseVisualMap(pieces: Piece[], opts: { dimension?: number; orient?: 'horizontal' | 'vertical' } = {}) {
  const cc = chartChrome()
  return {
    type: 'piecewise' as const,
    pieces,
    orient: opts.orient ?? 'horizontal',
    left: 'center',
    bottom: 0,
    ...(opts.dimension !== undefined ? { dimension: opts.dimension } : {}),
    textStyle: { color: cc.axisLabel || '#909399', fontSize: 11 },
    itemWidth: 14,
    itemHeight: 12
  }
}

/** 实时最新值脉冲点(effectScatter)：在序列末点画涟漪 + 数值标签。叠加为独立 series。 */
export function pulsePoint(name: string, point: [unknown, number], color: string) {
  return {
    name,
    type: 'effectScatter' as const,
    data: [point],
    symbolSize: 10,
    rippleEffect: { scale: 3.2, brushType: 'stroke' as const },
    itemStyle: { color, shadowBlur: 8, shadowColor: withAlpha(color, 0.6) },
    label: { show: true, position: 'top' as const, formatter: () => fmtNum(point[1], 2), color, fontWeight: 700 as const, fontSize: 12 },
    z: 6,
    silent: true
  }
}
