import { describe, it, expect } from 'vitest'
import {
  LOAD_PANEL_UNIT,
  buildLoadRangeSeries,
  isEmptyLoadSource,
  loadRangeStats,
  isSingleTimeline,
  buildLoadPanelModel,
  continuousTickFormatter,
  overlayTickFormatter
} from './loadPanelModel'

// 构造一个 366 槽的月-日 nameList（与生产端 NAME_LIST 同构，此处只需长度与「M月D日」格式一致）。
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const NAME_LIST = MONTH_DAYS.flatMap((n, mi) =>
  Array.from({ length: n }, (_, di) => `${mi + 1}月${di + 1}日`)
)
const slotOf = (m: number, d: number) => MONTH_DAYS.slice(0, m - 1).reduce((a, b) => a + b, 0) + (d - 1)

/** 造一整年（1/1~12/31）满覆盖的行；非闰年 2/29 槽保持 null。 */
function fullYearRow(base: number, leap = true): (number | null)[] {
  const row = Array<number | null>(366).fill(null)
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) {
      if (!leap && m === 2 && d === 29) continue
      row[slotOf(m, d)] = base + m
    }
  }
  return row
}

describe('isSingleTimeline', () => {
  it('云南型：2025 下半年 + 2026 上半年（仅 7/1 边界重叠）判为连续线', () => {
    const y2025 = Array<number | null>(366).fill(null)
    const y2026 = Array<number | null>(366).fill(null)
    // 2025-07-01 ~ 2025-12-31
    for (let m = 7; m <= 12; m++) for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) y2025[slotOf(m, d)] = 100
    // 2026-01-01 ~ 2026-07-01
    for (let m = 1; m <= 6; m++) for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) y2026[slotOf(m, d)] = 200
    y2026[slotOf(7, 1)] = 200 // 边界日 7/1 两年都有 → overlap=1 ≤ years-1=1
    expect(isSingleTimeline(NAME_LIST, ['2025年', '2026年'], [y2025, y2026])).toBe(true)
  })

  it('山西型：六年满覆盖（大量重叠）判为逐年对比', () => {
    const years = ['2021年', '2022年', '2023年', '2024年', '2025年', '2026年']
    const mat = years.map((_, i) => fullYearRow(i * 1000, i % 4 === 3))
    expect(isSingleTimeline(NAME_LIST, years, mat)).toBe(false)
  })

  it('单年不触发连续线（无对比对象，folding 本就不拼接）', () => {
    expect(isSingleTimeline(NAME_LIST, ['2025年'], [fullYearRow(0)])).toBe(false)
  })

  it('两年同为上半年（真同期对比、非连续）判为逐年对比', () => {
    const a = Array<number | null>(366).fill(null)
    const b = Array<number | null>(366).fill(null)
    for (let m = 1; m <= 6; m++) for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) { a[slotOf(m, d)] = 1; b[slotOf(m, d)] = 2 }
    expect(isSingleTimeline(NAME_LIST, ['2025年', '2026年'], [a, b])).toBe(false)
  })

  it('低重叠但中间有半年缺口（2025 仅 12 月 + 2026 仅 6 月）判为逐年对比，不误拼连续（#1385）', () => {
    const y2025 = Array<number | null>(366).fill(null)
    const y2026 = Array<number | null>(366).fill(null)
    for (let d = 1; d <= 31; d++) y2025[slotOf(12, d)] = 100 // 2025-12 整月
    for (let d = 1; d <= 30; d++) y2026[slotOf(6, d)] = 200 // 2026-06 整月
    // 重叠槽=0 满足②，但 2025/12/31 → 2026/6/1 跨半年 → ③ 连续性不满足
    expect(isSingleTimeline(NAME_LIST, ['2025年', '2026年'], [y2025, y2026])).toBe(false)
    expect(buildLoadPanelModel(NAME_LIST, ['2025年', '2026年'], [y2025, y2026], '均值').mode).toBe('overlay')
  })

  it('上游增长略超一年（2026 多至 7/2，边界重叠 2 天）仍判连续，不突切逐年（#1385 二审）', () => {
    const y2025 = Array<number | null>(366).fill(null)
    const y2026 = Array<number | null>(366).fill(null)
    for (let m = 7; m <= 12; m++) for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) y2025[slotOf(m, d)] = 100
    for (let m = 1; m <= 6; m++) for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) y2026[slotOf(m, d)] = 200
    y2026[slotOf(7, 1)] = 200
    y2026[slotOf(7, 2)] = 200 // 上游刷新多一天 → 7/1、7/2 两个重叠槽（旧固定阈值会误切）
    expect(isSingleTimeline(NAME_LIST, ['2025年', '2026年'], [y2025, y2026])).toBe(true)
  })

  it('满两年（每月-日都可同期对比、重叠≈100%）判为逐年对比', () => {
    const y2025 = fullYearRow(0, false)
    const y2026 = fullYearRow(1000, false)
    // 两年满覆盖 → 重叠占比≈100% ≥ 0.5 → 逐年同期对比
    expect(isSingleTimeline(NAME_LIST, ['2025年', '2026年'], [y2025, y2026])).toBe(false)
  })

  it('数据长约 1.5 年（真连续、无缺口）仍判连续线', () => {
    const y2025 = fullYearRow(0) // 2025 整年
    const y2026 = Array<number | null>(366).fill(null)
    for (let m = 1; m <= 6; m++) for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) y2026[slotOf(m, d)] = 200 // 2026 上半年
    // 重叠占比≈0.497 < 0.5，且拼接连续无缺口 → 连续线（1.5 年连续走势本可一条线呈现）
    expect(isSingleTimeline(NAME_LIST, ['2025年', '2026年'], [y2025, y2026])).toBe(true)
  })

  it('单年内部小缺口（漏采数日）仍判为连续', () => {
    const y2025 = Array<number | null>(366).fill(null)
    const y2026 = Array<number | null>(366).fill(null)
    for (let m = 7; m <= 12; m++) for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) y2025[slotOf(m, d)] = 100
    for (let m = 1; m <= 6; m++) for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) y2026[slotOf(m, d)] = 200
    y2026[slotOf(7, 1)] = 200
    // 挖掉 2025-09-10 ~ 09-12 三天（gap≤5，仍算连续）
    for (let d = 10; d <= 12; d++) y2025[slotOf(9, d)] = null
    expect(isSingleTimeline(NAME_LIST, ['2025年', '2026年'], [y2025, y2026])).toBe(true)
  })
})

describe('buildLoadPanelModel · 连续线模式', () => {
  const y2025 = Array<number | null>(366).fill(null)
  const y2026 = Array<number | null>(366).fill(null)
  for (let m = 7; m <= 12; m++) for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) y2025[slotOf(m, d)] = 100
  for (let m = 1; m <= 6; m++) for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) y2026[slotOf(m, d)] = 200
  y2026[slotOf(7, 1)] = 200
  const model = buildLoadPanelModel(NAME_LIST, ['2025年', '2026年'], [y2025, y2026], '均值')

  it('mode=continuous 且只有一条线', () => {
    expect(model.mode).toBe('continuous')
    expect(model.lines).toHaveLength(1)
    expect(model.lines[0].name).toBe('连续实际值·均值')
  })

  it('x 轴按时序拼接：首=2025/7月1日，跨年处 2025/12月31日→2026/1月1日，末=2026/7月1日', () => {
    expect(model.xData[0]).toBe('2025/7月1日')
    expect(model.xData[model.xData.length - 1]).toBe('2026/7月1日')
    const boundary = model.xData.indexOf('2025/12月31日')
    expect(model.xData[boundary + 1]).toBe('2026/1月1日')
  })

  it('无缺口时数据无 null，长度与 x 轴一致', () => {
    expect(model.lines[0].data.length).toBe(model.xData.length)
    expect(model.lines[0].data.every((v) => v != null)).toBe(true)
  })

  it('连续模式跳过非闰年 2/29，2/28→3/1 相邻不假断线（#1385）', () => {
    // 2025 下半年 + 2026(非闰年) 上半年，连续跨 2026 年 2 月
    const a = Array<number | null>(366).fill(null)
    const b = Array<number | null>(366).fill(null)
    for (let m = 7; m <= 12; m++) for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) a[slotOf(m, d)] = 100
    for (let m = 1; m <= 6; m++) for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) b[slotOf(m, d)] = 200
    b[slotOf(7, 1)] = 200
    const m2 = buildLoadPanelModel(NAME_LIST, ['2025年', '2026年'], [a, b], '均值')
    expect(m2.xData).not.toContain('2026/2月29日') // 非闰年不生成 2/29
    // 2026/2月28日 与 2026/3月1日 相邻（中间不夹 2/29 断点）
    expect(m2.xData.indexOf('2026/3月1日') - m2.xData.indexOf('2026/2月28日')).toBe(1)
    expect(m2.lines[0].data[m2.xData.indexOf('2026/2月28日')]).toBe(200)
    expect(m2.lines[0].data[m2.xData.indexOf('2026/3月1日')]).toBe(200)
  })

  it('连续模式保留缺测日为 null（不压缩空槽，缺口可见）（#1385）', () => {
    const a = Array<number | null>(366).fill(null)
    const b = Array<number | null>(366).fill(null)
    for (let m = 7; m <= 12; m++) for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) a[slotOf(m, d)] = 100
    for (let m = 1; m <= 6; m++) for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) b[slotOf(m, d)] = 200
    b[slotOf(7, 1)] = 200
    a[slotOf(9, 10)] = null // 漏采 2025-09-10
    a[slotOf(9, 11)] = null
    const m2 = buildLoadPanelModel(NAME_LIST, ['2025年', '2026年'], [a, b], '均值')
    expect(m2.mode).toBe('continuous')
    // 缺测日仍在类目轴上，且对应值为 null（而非被删掉、缺口两侧相连）
    const i10 = m2.xData.indexOf('2025/9月10日')
    const i11 = m2.xData.indexOf('2025/9月11日')
    expect(i10).toBeGreaterThan(-1)
    expect(i11).toBeGreaterThan(-1)
    expect(m2.lines[0].data[i10]).toBeNull()
    expect(m2.lines[0].data[i11]).toBeNull()
    // 两侧日期仍相邻保留（9/9 与 9/12 之间隔着 9/10、9/11 类目）
    expect(m2.xData.indexOf('2025/9月12日') - m2.xData.indexOf('2025/9月9日')).toBe(3)
  })
})

describe('buildLoadPanelModel · 逐年对比模式', () => {
  const years = ['2025年', '2026年']
  const mat = years.map((_, i) => fullYearRow(i * 1000))
  const model = buildLoadPanelModel(NAME_LIST, years, mat, '最大值')

  it('mode=overlay，每年一条线，共用月-日轴', () => {
    expect(model.mode).toBe('overlay')
    expect(model.lines.map((l) => l.name)).toEqual(['2025年最大值', '2026年最大值'])
    expect(model.xData).toBe(NAME_LIST)
    expect(model.lines[0].data).toBe(mat[0])
  })
})

describe('tick formatters', () => {
  it('continuous：月首打刻度带年后两位', () => {
    expect(continuousTickFormatter('2025/7月1日')).toBe('25/7月')
    expect(continuousTickFormatter('2026/1月1日')).toBe('26/1月')
    expect(continuousTickFormatter('2025/7月2日')).toBe('')
  })
  it('overlay：月首打刻度去掉「1日」', () => {
    expect(overlayTickFormatter('7月1日')).toBe('7月')
    expect(overlayTickFormatter('7月2日')).toBe('')
  })
})

describe('逐日负荷口径（#3379）', () => {
  it('单位是负荷功率 MW，不是电量', () => {
    expect(LOAD_PANEL_UNIT).toBe('MW')
  })
  it('缺失与空壳（无年份）都视为空，有年份则非空', () => {
    expect(isEmptyLoadSource(null)).toBe(true)
    expect(isEmptyLoadSource(undefined)).toBe(true)
    expect(isEmptyLoadSource({ years: [] })).toBe(true)
    expect(isEmptyLoadSource({ years: ['2025年'] })).toBe(false)
  })
})

describe('单源版面：连续日期序列与指标（dljy#3384）', () => {
  const names = ['12月30日', '12月31日', '1月1日', '1月2日', '2月29日']
  // 年 × 槽：2025 只有 12/30、12/31；2026 只有 1/2（1/1 缺数）；2026 的 2月29日槽非法须忽略
  const years = ['2025年', '2026年']
  const metrics = {
    average: [[100, 110, null, null, null], [null, null, null, 130, 999]],
    min: [[90, 95, null, null, null], [null, null, null, 120, 999]],
    max: [[120, 140, null, null, null], [null, null, null, 150, 999]]
  }

  it('按真实日期展开并保留缺数日为 null（断线不插值），非法日期槽忽略', () => {
    const s = buildLoadRangeSeries(names, years, metrics)
    expect(s.dates).toEqual(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'])
    expect(s.avg).toEqual([100, 110, null, 130])
    expect(s.spread).toEqual([30, 45, null, 30])
  })

  it('指标：最近日均、区间最高/最低、覆盖天数与缺口', () => {
    const st = loadRangeStats(buildLoadRangeSeries(names, years, metrics))
    expect(st.latest).toEqual({ date: '2026-01-02', avg: 130 })
    expect(st.peak).toEqual({ date: '2026-01-02', value: 150 })
    expect(st.trough).toEqual({ date: '2025-12-30', value: 90 })
    expect(st.days).toBe(3)
    expect(st.gapDays).toBe(1)
    expect([st.firstDate, st.lastDate]).toEqual(['2025-12-30', '2026-01-02'])
  })

  it('无任何有数日：空序列、空指标', () => {
    const s = buildLoadRangeSeries([], [], { average: [], min: [], max: [] })
    expect(s.dates).toEqual([])
    expect(loadRangeStats(s)).toMatchObject({ days: 0, latest: null, peak: null, trough: null, gapDays: 0 })
  })
})
