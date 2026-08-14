// 业务图表转换层：把电力交易语义 JSON 转成 ECharts option。
// 让 agent 只产出业务字段（如申报点位、预测区间、敞口），无需手写复杂 option；
// 解析器(artifactBlocks)用这些 builder 把对应围栏回落为 kind:'chart'，复用
// ChartArtifact 渲染 —— 零新组件、零 ArtifactRenderer 改动。
//
// 约定：builder 接收已 looseParseJson 的值，返回 ECharts option（Record）或 null
// （无法构成有效图表时 null，由解析器降级为 JSON 代码块）。颜色用固定值，主题适配
// 由 useEChart 的 activeChartTheme 负责。

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function num(v: unknown, dflt = NaN): number {
  if (typeof v === 'number') return v
  const n = parseFloat(String(v))
  return isNaN(n) ? dflt : n
}
function optS(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v)
  return s === '' ? undefined : s
}
// 转义 tooltip/label 中拼接的模型字段：ECharts 自定义 formatter 返回原始 HTML 不二次转义，
// agent 产出的 name/label 可能含 < > " 等，直接拼接会 XSS。Codex P1。
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
const BASE_GRID = { top: 32, left: 8, right: 8, bottom: 8, containLabel: true }

// 申报曲线：价-量阶梯 + 限价线 + 时段标注。
// 标准 { points:[{t,price,mw}], priceCap?, priceFloor? }；
// 兼容 agent 变体 { priceCurve:{data:[]}, annotations:[{hour,text,type}], priceCap? }。
export function buildDeclarationOption(data: unknown): Record<string, unknown> | null {
  const d = obj(data)
  let pts = asArray(d.points ?? d.curve)
  const pc = obj(d.priceCurve)
  if (!pts.length && Array.isArray(pc.data)) pts = (pc.data as unknown[]).map((v, i) => ({ t: i + 1, price: v }))
  if (!pts.length && Array.isArray(d.data)) pts = (d.data as unknown[]).map((v, i) => ({ t: i + 1, price: v }))
  if (!pts.length) pts = asArray(data)
  if (!pts.length) return null
  const x: string[] = []
  const price: number[] = []
  const mw: number[] = []
  pts.forEach((p, i) => {
    const o = obj(p)
    x.push(String(o.t ?? o.time ?? o.hour ?? o.period ?? i + 1))
    price.push(num(o.price ?? o.p ?? o.value))
    mw.push(num(o.mw ?? o.volume ?? o.qty ?? o.q))
  })
  const hasPrice = price.some((v) => !isNaN(v))
  const hasMw = mw.some((v) => !isNaN(v))
  if (!hasPrice && !hasMw) return null
  const cap = num(d.priceCap ?? d.cap ?? pc.cap)
  const floor = num(d.priceFloor ?? d.floor ?? pc.floor)
  const markData: Record<string, unknown>[] = []
  if (!isNaN(cap)) markData.push({ yAxis: cap, name: '限价上限' })
  if (!isNaN(floor)) markData.push({ yAxis: floor, name: '限价下限' })
  const annoColor: Record<string, string> = { info: '#2563eb', warning: '#f59e0b', critical: '#dc2626' }
  const markPointData = asArray(d.annotations)
    .map((a) => {
      const o = obj(a)
      const hr = num(o.hour ?? o.t ?? o.x ?? o.index)
      if (isNaN(hr)) return null
      const idx = Math.max(0, Math.min(price.length - 1, Math.round(hr) - 1))
      return {
        name: String(o.text ?? o.label ?? ''),
        coord: [x[idx], price[idx]],
        itemStyle: { color: annoColor[String(o.type ?? 'info').toLowerCase()] ?? '#2563eb' }
      }
    })
    .filter(Boolean)
  const yAxis: Record<string, unknown>[] = [{ type: 'value', name: hasPrice ? '元/MWh' : 'MW' }]
  if (hasPrice && hasMw) yAxis.push({ type: 'value', name: 'MW' })
  const series: Record<string, unknown>[] = []
  if (hasMw) {
    series.push({ name: '申报电量', type: 'bar', yAxisIndex: hasPrice ? 1 : 0, data: mw, itemStyle: { color: '#60a5fa' } })
  }
  if (hasPrice) {
    series.push({
      name: '申报价格',
      type: 'line',
      step: 'middle',
      data: price,
      yAxisIndex: 0,
      symbol: 'none',
      lineStyle: { width: 2, color: '#f59e0b' },
      itemStyle: { color: '#f59e0b' },
      markLine: markData.length
        ? { silent: true, symbol: 'none', data: markData, lineStyle: { type: 'dashed', color: '#dc2626' } }
        : undefined,
      markPoint: markPointData.length
        ? { symbol: 'pin', symbolSize: 38, data: markPointData, label: { fontSize: 9, color: '#fff', formatter: '{b}' } }
        : undefined
    })
  }
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: BASE_GRID,
    xAxis: { type: 'category', data: x, boundaryGap: hasMw },
    yAxis,
    series
  }
}

// 价格预测带：中值 + 置信区间。{ points:[{t,value,lower,upper}], unit? }
export function buildForecastOption(data: unknown): Record<string, unknown> | null {
  const d = obj(data)
  let pts = asArray(d.points ?? d.data ?? d.series)
  // 兼容 agent 变体：{ time:[], value/mid/price/lower/upper 平行数组 }
  const tArr = asArray(d.time ?? d.times ?? d.x ?? d.hours)
  if (!pts.length && tArr.length) {
    const valArr = asArray(d.value ?? d.mid ?? d.price ?? d.predict ?? d.median)
    const loArr = asArray(d.lower ?? d.low ?? d.min)
    const upArr = asArray(d.upper ?? d.high ?? d.max)
    pts = tArr.map((t, i) => ({ t, value: valArr[i], lower: loArr[i], upper: upArr[i] }))
  }
  if (!pts.length) pts = asArray(d.forecast ?? data)
  if (!pts.length) return null
  const x: string[] = []
  const mid: number[] = []
  const lo: (number | null)[] = []
  const range: (number | null)[] = []
  let hasBand = false
  pts.forEach((p, i) => {
    const o = obj(p)
    x.push(String(o.t ?? o.time ?? o.hour ?? i + 1))
    mid.push(num(o.value ?? o.mid ?? o.v))
    const l = num(o.lower ?? o.low ?? o.l)
    const u = num(o.upper ?? o.high ?? o.u)
    if (!isNaN(l) && !isNaN(u)) {
      hasBand = true
      lo.push(l)
      range.push(u - l)
    } else {
      lo.push(null)
      range.push(null)
    }
  })
  if (!mid.some((v) => !isNaN(v))) return null
  const unit = optS(d.unit) ?? '元/MWh'
  const series: Record<string, unknown>[] = []
  if (hasBand) {
    // band 与中值同为分时价格(按时段恒定)，统一阶梯呈现保持贴合
    series.push({ name: '下界', type: 'line', step: 'end', data: lo, stack: 'conf', lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, symbol: 'none', silent: true })
    series.push({ name: '置信区间', type: 'line', step: 'end', data: range, stack: 'conf', lineStyle: { opacity: 0 }, areaStyle: { color: '#93c5fd', opacity: 0.35 }, symbol: 'none', silent: true })
  }
  series.push({ name: '预测中值', type: 'line', step: 'end', data: mid, symbol: 'none', lineStyle: { width: 2, color: '#2563eb' }, itemStyle: { color: '#2563eb' } })
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0, data: hasBand ? ['预测中值', '置信区间'] : ['预测中值'] },
    grid: BASE_GRID,
    xAxis: { type: 'category', data: x, boundaryGap: false },
    yAxis: { type: 'value', name: unit, scale: true },
    series
  }
}

// 持仓敞口：中长期/现货堆叠 + 净敞口线。{ items:[{label,midlong,spot,net}] }
export function buildPositionOption(data: unknown): Record<string, unknown> | null {
  const d = obj(data)
  const items = asArray(d.items ?? d.periods ?? data)
  if (!items.length) return null
  const x: string[] = []
  const ml: number[] = []
  const spot: number[] = []
  const net: (number | null)[] = []
  let hasNet = false
  items.forEach((it, i) => {
    const o = obj(it)
    x.push(String(o.label ?? o.period ?? o.month ?? o.t ?? i + 1))
    ml.push(num(o.midlong ?? o.ml ?? o.contract ?? 0))
    spot.push(num(o.spot ?? o.sp ?? 0))
    if (o.net !== undefined) {
      hasNet = true
      net.push(num(o.net))
    } else net.push(null)
  })
  const series: Record<string, unknown>[] = [
    { name: '中长期', type: 'bar', stack: 'pos', data: ml, itemStyle: { color: '#3b82f6' } },
    { name: '现货', type: 'bar', stack: 'pos', data: spot, itemStyle: { color: '#f59e0b' } }
  ]
  if (hasNet) {
    series.push({ name: '净敞口', type: 'line', data: net, symbol: 'circle', lineStyle: { width: 2, color: '#dc2626' }, itemStyle: { color: '#dc2626' } })
  }
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: BASE_GRID,
    xAxis: { type: 'category', data: x },
    yAxis: { type: 'value', name: 'MW' },
    series
  }
}

// 套利窗口：价格曲线 + 充/放窗口高亮。{ points:[{t,price}], windows:[{start,end,type}] }
export function buildArbitrageOption(data: unknown): Record<string, unknown> | null {
  const d = obj(data)
  const pts = asArray(d.points ?? d.prices ?? data)
  if (!pts.length) return null
  const x: string[] = []
  const price: number[] = []
  pts.forEach((p, i) => {
    const o = obj(p)
    x.push(String(o.t ?? o.time ?? o.hour ?? i + 1))
    price.push(num(o.price ?? o.value ?? o.p))
  })
  if (!price.some((v) => !isNaN(v))) return null
  const markArea = asArray(d.windows).map((w) => {
    const o = obj(w)
    const type = String(o.type ?? '').toLowerCase()
    const buy = type.includes('charge') || type.includes('buy') || type.includes('谷') || type.includes('低')
    return [
      { xAxis: String(o.start ?? o.from ?? ''), itemStyle: { color: buy ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)' } },
      { xAxis: String(o.end ?? o.to ?? '') }
    ]
  })
  return {
    tooltip: { trigger: 'axis' },
    grid: { top: 18, left: 8, right: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: x, boundaryGap: false },
    yAxis: { type: 'value', name: '元/MWh', scale: true },
    series: [
      {
        name: '价格',
        type: 'line',
        step: 'end',
        data: price,
        symbol: 'none',
        lineStyle: { width: 2, color: '#2563eb' },
        areaStyle: { color: 'rgba(37,99,235,0.06)' },
        markArea: markArea.length ? { silent: true, data: markArea } : undefined
      }
    ]
  }
}

// 储能充放：充放功率 + SOC + 电价(套利对照)。
// 标准 { points:[{t,soc,charge,discharge|power,price}] }；
// 兼容 agent 变体 { priceCurve:{data:[]}, soc:[], charge:[], discharge:[], power:[] }。
export function buildStorageOption(data: unknown): Record<string, unknown> | null {
  const d = obj(data)
  let pts = asArray(d.points ?? d.schedule)
  const pc = obj(d.priceCurve)
  const priceArr = Array.isArray(pc.data) ? (pc.data as unknown[]) : asArray(d.price)
  if (!pts.length) {
    const socArr = asArray(d.soc ?? d.SOC)
    const chargeArr = asArray(d.charge)
    const disArr = asArray(d.discharge)
    const powerArr = asArray(d.power)
    const n = Math.max(socArr.length, chargeArr.length, disArr.length, powerArr.length, priceArr.length)
    if (n) {
      pts = Array.from({ length: n }, (_, i) => ({
        t: i + 1, soc: socArr[i], charge: chargeArr[i], discharge: disArr[i], power: powerArr[i], price: priceArr[i]
      }))
    }
  }
  if (!pts.length) pts = asArray(data)
  if (!pts.length) return null
  const x: string[] = []
  const soc: number[] = []
  const power: number[] = []
  const price: number[] = []
  pts.forEach((p, i) => {
    const o = obj(p)
    x.push(String(o.t ?? o.time ?? o.hour ?? i + 1))
    soc.push(num(o.soc ?? o.SOC))
    let pw = num(o.power)
    if (isNaN(pw)) pw = num(o.charge, 0) - num(o.discharge, 0)
    power.push(pw)
    price.push(num(o.price))
  })
  const hasSoc = soc.some((v) => !isNaN(v))
  const hasPrice = price.some((v) => !isNaN(v))
  const yAxis: Record<string, unknown>[] = [{ type: 'value', name: 'MW' }]
  if (hasSoc) yAxis.push({ type: 'value', name: 'SOC %', min: 0, max: 100 })
  if (hasPrice) yAxis.push({ type: 'value', name: '元/MWh', position: 'right', offset: hasSoc ? 52 : 0 })
  const series: Record<string, unknown>[] = [
    { name: '充放功率', type: 'bar', data: power, yAxisIndex: 0, itemStyle: { color: '#60a5fa' } }
  ]
  if (hasSoc) series.push({ name: 'SOC', type: 'line', data: soc, yAxisIndex: 1, smooth: false, symbol: 'none', lineStyle: { width: 2, color: '#16a34a' }, itemStyle: { color: '#16a34a' } })
  if (hasPrice) series.push({ name: '电价', type: 'line', step: 'end', data: price, yAxisIndex: hasSoc ? 2 : 1, symbol: 'none', lineStyle: { width: 2, color: '#f59e0b', type: 'dashed' }, itemStyle: { color: '#f59e0b' } })
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { ...BASE_GRID, right: hasPrice && hasSoc ? 60 : 8 },
    xAxis: { type: 'category', data: x },
    yAxis,
    series
  }
}

// 风险仪表：单值或多表盘 + 绿/黄/红分段(或自定义 thresholds)。
// 标准 { value, max?, min?, label? }；
// 兼容 agent 变体 { gauges:[{label,value,unit,min,max,thresholds:[{value,color}]}], warnings }。
export function buildGaugeOption(data: unknown): Record<string, unknown> | null {
  const d = obj(data)
  const list = asArray(d.gauges ?? d.items)
  const gauges = list.length ? list.map(obj) : isNaN(num(d.value ?? d.val ?? data)) ? [] : [d]
  if (!gauges.length) return null
  const n = gauges.length
  const series = gauges.map((g, i) => {
    const gg = obj(g)
    const val = num(gg.value ?? gg.val ?? (n === 1 ? data : NaN))
    const max = num(gg.max, 100)
    const min = num(gg.min, 0)
    const span = max - min || 1
    const name = optS(gg.label ?? gg.name ?? gg.title) ?? `指标${i + 1}`
    const unit = optS(gg.unit) ?? ''
    const thr = asArray(gg.thresholds)
      .map(obj)
      .filter((t) => !isNaN(num(t.value)) && optS(t.color))
    const colorStops: Array<[number, string]> = thr.length
      ? thr.map((t) => [Math.max(0, Math.min(1, (num(t.value) - min) / span)), String(t.color)] as [number, string])
      : [
          [0.6, '#16a34a'],
          [0.85, '#f59e0b'],
          [1, '#dc2626']
        ]
    if (colorStops.length && colorStops[colorStops.length - 1][0] < 1) {
      colorStops.push([1, colorStops[colorStops.length - 1][1]])
    }
    return {
      type: 'gauge',
      center: [`${((i + 0.5) / n) * 100}%`, '58%'],
      radius: n > 1 ? `${Math.min(72, 96 / n)}%` : '75%',
      min,
      max,
      axisLine: { lineStyle: { width: 12, color: colorStops } },
      pointer: { itemStyle: { color: 'auto' } },
      axisTick: { distance: -12 },
      splitLine: { distance: -12, length: 12 },
      axisLabel: { distance: 14, fontSize: 9 },
      detail: { valueAnimation: true, formatter: `{value}${unit}`, fontSize: n > 1 ? 14 : 20, offsetCenter: [0, '68%'] },
      title: { offsetCenter: [0, '94%'], fontSize: 12 },
      data: [{ value: isNaN(val) ? 0 : val, name }]
    }
  })
  return { series }
}

// 出清博弈：按成本排序的阶梯供给曲线 + 出清价/需求标线。
// { segments:[{capacity,cost,label?}], clearingPrice?, demand? }
export function buildClearingOption(data: unknown): Record<string, unknown> | null {
  const d = obj(data)
  let segs = asArray(d.segments ?? d.supply ?? d.generators ?? data)
  // 兼容 agent「边际机组推演」变体：marginal_unit + contender_units 合成阶梯供给曲线
  if (!segs.length) {
    const mu = obj(d.marginal_unit ?? d.marginalUnit)
    const contenders = asArray(d.contender_units ?? d.contenders ?? d.rival_units ?? d.units)
    const merged = [...contenders, ...(Object.keys(mu).length ? [mu] : [])]
    if (merged.length) segs = merged
  }
  if (!segs.length) return null
  const parsed = segs
    .map((s) => {
      const o = obj(s)
      return { cost: num(o.cost ?? o.price ?? o.bid ?? o.offer), cap: num(o.capacity ?? o.cap ?? o.mw ?? o.qty) }
    })
    .filter((s) => !isNaN(s.cost) && !isNaN(s.cap))
    .sort((a, b) => a.cost - b.cost)
  if (!parsed.length) return null
  const pts: [number, number][] = []
  let cum = 0
  parsed.forEach((s) => {
    pts.push([cum, s.cost])
    cum += s.cap
    pts.push([cum, s.cost])
  })
  const clearing = num(d.clearingPrice ?? d.price ?? d.clearing_price)
  const demand = num(d.demand ?? d.load ?? d.clearing_volume ?? d.clearingVolume)
  const markLine: Record<string, unknown>[] = []
  if (!isNaN(clearing)) markLine.push({ yAxis: clearing, name: '出清价', lineStyle: { color: '#dc2626' } })
  if (!isNaN(demand)) markLine.push({ xAxis: demand, name: '需求', lineStyle: { color: '#2563eb' } })
  return {
    tooltip: { trigger: 'axis' },
    grid: { top: 20, left: 8, right: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', name: '累积容量 MW' },
    yAxis: { type: 'value', name: '报价 元/MWh', scale: true },
    series: [
      {
        name: '供给曲线',
        type: 'line',
        step: 'end',
        data: pts,
        symbol: 'none',
        lineStyle: { width: 2, color: '#7c3aed' },
        areaStyle: { color: 'rgba(124,58,237,0.08)' },
        markLine: markLine.length ? { silent: true, symbol: 'none', label: { formatter: '{b}' }, data: markLine } : undefined
      }
    ]
  }
}

// 地理分布：经纬度散点 + 数值热力(visualMap)。无底图依赖(项目暂无地图 GeoJSON)，
// 适合厂站/负荷点位分布；如需省界底图可后续 echarts.registerMap 接入。
// { points:[{name?,lng,lat,value?}] }
export function buildGeoOption(data: unknown): Record<string, unknown> | null {
  const d = obj(data)
  const pts = asArray(d.points ?? d.locations ?? data)
  if (!pts.length) return null
  const rows = pts
    .map((p) => {
      const o = obj(p)
      const coord = Array.isArray(o.coord) ? (o.coord as unknown[]) : []
      const lng = num(o.lng ?? o.lon ?? o.longitude ?? coord[0])
      const lat = num(o.lat ?? o.latitude ?? coord[1])
      const value = num(o.value ?? o.v)
      return { name: optS(o.name ?? o.label ?? o.station ?? o.region) ?? '', lng, lat, value }
    })
    .filter((r) => !isNaN(r.lng) && !isNaN(r.lat))
  if (!rows.length) return null
  const values = rows.map((r) => r.value).filter((v) => !isNaN(v))
  const hasValue = values.length > 0
  const max = hasValue ? Math.max(...values) : 1
  const min = hasValue ? Math.min(...values) : 0
  const seriesData = rows.map((r) => ({ name: r.name, value: [r.lng, r.lat, isNaN(r.value) ? 0 : r.value] }))
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: { name?: string; value: number[] }) =>
        `${escapeHtml(p.name || '')}<br/>经度 ${p.value[0]}, 纬度 ${p.value[1]}` + (hasValue ? `<br/>值: ${p.value[2]}` : '')
    },
    grid: { top: 20, left: 8, right: 8, bottom: hasValue ? 40 : 8, containLabel: true },
    xAxis: { type: 'value', name: '经度', scale: true, axisLabel: { formatter: '{value}°' } },
    yAxis: { type: 'value', name: '纬度', scale: true, axisLabel: { formatter: '{value}°' } },
    visualMap: hasValue
      ? { min, max, calculable: true, orient: 'horizontal', left: 'center', bottom: 0, dimension: 2, inRange: { color: ['#93c5fd', '#f59e0b', '#dc2626'] } }
      : undefined,
    series: [
      {
        type: 'scatter',
        data: seriesData,
        symbolSize: hasValue ? (val: number[]) => Math.max(8, Math.min(32, 8 + (max ? (val[2] / max) * 24 : 0))) : 12,
        itemStyle: { color: '#2563eb' },
        label: {
          show: rows.length <= 12,
          formatter: (p: { name?: string }) => escapeHtml(p.name || ''),
          position: 'right',
          fontSize: 10
        }
      }
    ]
  }
}

// 分时热力：x(小时/列) × y(日期/对象) 的数值热力 + visualMap 分段着色。
// 兼容 { matrix:[[...]], x?, y? }、{ rows:[{label,values:[]}], x? }、{ data:[[xi,yi,v]], x, y }。
export function buildHeatmapOption(data: unknown): Record<string, unknown> | null {
  const d = obj(data)
  const cells: [number, number, number][] = []
  let xLabels: string[] = asArray(d.x ?? d.cols ?? d.columns ?? d.hours).map((v) => String(v))
  let yLabels: string[] = []
  const rows = asArray(d.rows)
  const matrix = asArray(d.matrix ?? d.grid)
  if (rows.length && rows.some((r) => obj(r).values !== undefined || obj(r).data !== undefined)) {
    rows.forEach((r, yi) => {
      const o = obj(r)
      yLabels.push(String(o.label ?? o.name ?? o.y ?? yi + 1))
      asArray(o.values ?? o.data).forEach((v, xi) => {
        const n = num(v)
        if (!isNaN(n)) cells.push([xi, yi, n])
      })
    })
  } else if (matrix.length && Array.isArray(matrix[0])) {
    const yArr = asArray(d.y ?? d.days ?? d.dates ?? d.rows)
    matrix.forEach((row, yi) => {
      yLabels.push(String(yArr[yi] ?? yi + 1))
      asArray(row).forEach((v, xi) => {
        const n = num(v)
        if (!isNaN(n)) cells.push([xi, yi, n])
      })
    })
  } else {
    yLabels = asArray(d.y ?? d.days ?? d.dates).map((v) => String(v))
    asArray(d.data ?? d.points ?? data).forEach((t) => {
      const a = asArray(t)
      if (a.length < 3) return
      const xi = num(a[0])
      const yi = num(a[1])
      const v = num(a[2])
      if (!isNaN(xi) && !isNaN(yi) && !isNaN(v)) cells.push([xi, yi, v])
    })
  }
  if (!cells.length) return null
  const maxX = Math.max(...cells.map((c) => c[0]))
  const maxY = Math.max(...cells.map((c) => c[1]))
  if (!xLabels.length) xLabels = Array.from({ length: maxX + 1 }, (_, i) => String(i))
  if (!yLabels.length) yLabels = Array.from({ length: maxY + 1 }, (_, i) => String(i + 1))
  const vals = cells.map((c) => c[2])
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: { value: number[] }) =>
        `${escapeHtml(yLabels[p.value[1]] ?? '')} / ${escapeHtml(xLabels[p.value[0]] ?? '')}<br/>${p.value[2]}`
    },
    grid: { top: 20, left: 8, right: 8, bottom: 48, containLabel: true },
    xAxis: { type: 'category', data: xLabels, splitArea: { show: true } },
    yAxis: { type: 'category', data: yLabels, splitArea: { show: true } },
    visualMap: {
      min: Math.min(...vals),
      max: Math.max(...vals),
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: { color: ['#1e3a8a', '#3b82f6', '#93c5fd', '#fde68a', '#f59e0b', '#dc2626'] }
    },
    series: [
      {
        type: 'heatmap',
        data: cells,
        label: { show: cells.length <= 60, fontSize: 9 },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.3)' } }
      }
    ]
  }
}

// 电价 K 线：OHLC 蜡烛 + 可选移动均线。涨红跌绿(国内习惯)。
// { points:[{t,open,close,low,high}], ma?:[5,10], unit? }；兼容 { time:[], open/close/low/high:[] } 平行数组。
export function buildCandleOption(data: unknown): Record<string, unknown> | null {
  const d = obj(data)
  let pts = asArray(d.points ?? d.candles ?? d.data ?? d.bars)
  const tArr = asArray(d.time ?? d.times ?? d.dates ?? d.t ?? d.x)
  if (!pts.length && tArr.length) {
    const o = asArray(d.open ?? d.o)
    const c = asArray(d.close ?? d.c)
    const l = asArray(d.low ?? d.l)
    const h = asArray(d.high ?? d.h)
    pts = tArr.map((t, i) => ({ t, open: o[i], close: c[i], low: l[i], high: h[i] }))
  }
  if (!pts.length) pts = asArray(data)
  if (!pts.length) return null
  const x: string[] = []
  const ohlc: [number, number, number, number][] = []
  pts.forEach((p, i) => {
    const o = obj(p)
    const open = num(o.open ?? o.o)
    const close = num(o.close ?? o.c)
    let low = num(o.low ?? o.l ?? o.min)
    let high = num(o.high ?? o.h ?? o.max)
    if (isNaN(open) || isNaN(close)) return
    // 缺 high/low 时用开收价兜底，避免个别点缺字段拖垮整张 K 线
    if (isNaN(high)) high = Math.max(open, close)
    if (isNaN(low)) low = Math.min(open, close)
    x.push(String(o.t ?? o.time ?? o.date ?? o.day ?? i + 1))
    ohlc.push([open, close, low, high]) // ECharts candlestick 数据顺序：开/收/低/高
  })
  if (!ohlc.length) return null
  const series: Record<string, unknown>[] = [
    {
      name: optS(d.name) ?? '电价',
      type: 'candlestick',
      data: ohlc,
      itemStyle: { color: '#dc2626', color0: '#16a34a', borderColor: '#dc2626', borderColor0: '#16a34a' }
    }
  ]
  const closes = ohlc.map((o) => o[1])
  const maColors = ['#2563eb', '#f59e0b', '#7c3aed', '#0891b2']
  asArray(d.ma ?? d.movingAverage ?? d.mas)
    .map((v) => num(v))
    .filter((v) => !isNaN(v) && v >= 2)
    .forEach((pd, idx) => {
      const ma = closes.map((_, i) => {
        if (i < pd - 1) return null
        let s = 0
        for (let k = 0; k < pd; k++) s += closes[i - k]
        return Number((s / pd).toFixed(2))
      })
      series.push({
        name: `MA${pd}`,
        type: 'line',
        data: ma,
        smooth: false,
        symbol: 'none',
        lineStyle: { width: 1.5, color: maColors[idx % maColors.length] },
        itemStyle: { color: maColors[idx % maColors.length] }
      })
    })
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: { top: 0 },
    grid: { top: series.length > 1 ? 28 : 16, left: 8, right: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: x, boundaryGap: true },
    yAxis: { type: 'value', name: optS(d.unit) ?? '元/MWh', scale: true },
    series
  }
}

// 瀑布分解：从基准逐项加减到结果(结算费用/成本/收益归因)。透明占位柱 + 升降色柱实现。
// { items:[{label,value,type?:'total'}], start?, unit? }；type 含 total/合计 时画为从 0 起的累计柱。
export function buildWaterfallOption(data: unknown): Record<string, unknown> | null {
  const d = obj(data)
  const items = asArray(d.items ?? d.steps ?? d.parts ?? data)
  if (!items.length) return null
  const x: string[] = []
  const placeholder: number[] = []
  const incr: (number | null)[] = []
  const decr: (number | null)[] = []
  const totalBar: (number | null)[] = []
  let cum = num(d.start, 0)
  if (isNaN(cum)) cum = 0
  let valid = false
  items.forEach((it) => {
    const o = obj(it)
    const isTotal = /total|sum|net|合计|总|净/i.test(String(o.type ?? '')) || o.total === true
    const v = num(o.value ?? o.delta ?? o.amount)
    if (isNaN(v) && !isTotal) return
    x.push(String(o.label ?? o.name ?? o.key ?? ''))
    if (isTotal) {
      const tv = isNaN(v) ? cum : v
      placeholder.push(0)
      incr.push(null)
      decr.push(null)
      totalBar.push(Number(tv.toFixed(4)))
      cum = tv
    } else if (v >= 0) {
      placeholder.push(Number(cum.toFixed(4)))
      incr.push(Number(v.toFixed(4)))
      decr.push(null)
      totalBar.push(null)
      cum += v
    } else {
      placeholder.push(Number((cum + v).toFixed(4)))
      incr.push(null)
      decr.push(Number((-v).toFixed(4)))
      totalBar.push(null)
      cum += v
    }
    valid = true
  })
  if (!valid) return null
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps: Array<{ dataIndex: number }>) => {
        const i = ps[0].dataIndex
        const real = totalBar[i] ?? (incr[i] != null ? incr[i] : decr[i] != null ? -(decr[i] as number) : 0)
        return `${escapeHtml(x[i])}<br/>${real}`
      }
    },
    legend: { show: false },
    grid: BASE_GRID,
    xAxis: { type: 'category', data: x, axisLabel: { interval: 0, fontSize: 10 } },
    yAxis: { type: 'value', name: optS(d.unit) ?? '' },
    series: [
      { name: 'ph', type: 'bar', stack: 'wf', silent: true, itemStyle: { color: 'transparent' }, emphasis: { itemStyle: { color: 'transparent' } }, data: placeholder },
      { name: '增加', type: 'bar', stack: 'wf', data: incr, itemStyle: { color: '#dc2626' }, label: { show: true, position: 'top', fontSize: 9 } },
      { name: '减少', type: 'bar', stack: 'wf', data: decr, itemStyle: { color: '#16a34a' }, label: { show: true, position: 'top', fontSize: 9 } },
      { name: '合计', type: 'bar', stack: 'wf', data: totalBar, itemStyle: { color: '#2563eb' }, label: { show: true, position: 'top', fontSize: 9 } }
    ]
  }
}

// 流向桑基图：电量流向(电源→母线→负荷)、资金流向。{ nodes:[{name}|"name"], links:[{source,target,value}] }。
// 仅过滤自环(source===target)；ECharts sankey 不支持成环图，agent 应给无环 DAG。
export function buildSankeyOption(data: unknown): Record<string, unknown> | null {
  const d = obj(data)
  const links = asArray(d.links ?? d.edges ?? d.flows)
    .map((l) => {
      const o = obj(l)
      return {
        source: String(o.source ?? o.from ?? o.src ?? ''),
        target: String(o.target ?? o.to ?? o.dst ?? ''),
        value: num(o.value ?? o.v ?? o.weight ?? o.amount, 0)
      }
    })
    .filter((l) => l.source && l.target && l.source !== l.target)
  if (!links.length) return null
  const names = new Set<string>()
  links.forEach((l) => {
    names.add(l.source)
    names.add(l.target)
  })
  asArray(d.nodes)
    .map((n) => (n && typeof n === 'object' ? String(obj(n).name ?? obj(n).id ?? '') : String(n)))
    .filter(Boolean)
    .forEach((n) => names.add(n))
  return {
    tooltip: { trigger: 'item', triggerOn: 'mousemove' },
    series: [
      {
        type: 'sankey',
        data: Array.from(names).map((name) => ({ name })),
        links,
        emphasis: { focus: 'adjacency' },
        lineStyle: { color: 'gradient', curveness: 0.5 },
        label: { fontSize: 11 },
        left: 8,
        right: 80,
        top: 12,
        bottom: 12
      }
    ]
  }
}

// 结构占比饼/环图：电源结构、成本构成、客户结构。{ items:[{name,value}], donut?, unit? } 或顶层数组。
export function buildPieOption(data: unknown): Record<string, unknown> | null {
  const d = obj(data)
  const slices = asArray(Array.isArray(data) ? data : (d.items ?? d.data ?? d.slices ?? d.segments))
    .map((it) => {
      const o = obj(it)
      return { name: String(o.name ?? o.label ?? o.key ?? ''), value: num(o.value ?? o.val ?? o.amount ?? o.v) }
    })
    .filter((s) => s.name && !isNaN(s.value) && s.value >= 0)
  if (!slices.length) return null
  const donut = d.donut === true || d.type === 'donut' || /donut|ring|环/i.test(String(d.style ?? ''))
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { type: 'scroll', orient: 'horizontal', bottom: 0, left: 'center' },
    color: ['#2563eb', '#f59e0b', '#16a34a', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#0d9488'],
    series: [
      {
        type: 'pie',
        radius: donut ? ['42%', '68%'] : '64%',
        center: ['50%', '46%'],
        data: slices,
        label: { formatter: '{b}\n{d}%', fontSize: 10 },
        labelLine: { length: 8, length2: 8 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.25)' } }
      }
    ]
  }
}
