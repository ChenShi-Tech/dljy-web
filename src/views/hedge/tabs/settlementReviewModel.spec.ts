// 结算复核视图模型纯函数测试（build-midlong-spot-hedging 任务 10.5，HR-01/02/03；ChenShi-Tech/dljy#3054）。
// 守的不变量：回看窗口与月份区间不写死月份、当月截到今天；默认月份优先最近的正式覆盖；覆盖矩阵三态且缺失不计 0；
// 已实现汇总只用恒等核对通过的场站日、分母为 0 不可计算；响应缺字段归一为「没有」而不是 0。
// 坏掉的症状：默认月份落到没有数据的当月、闰月/跨年区间错位、缺失日被当成 0 拉低套保率、实际上网为 0 时显示 0%。
import { describe, expect, it } from 'vitest'
import {
  buildCoverageMatrix,
  compressDates,
  coverageWindow,
  datesBetween,
  defaultMonth,
  formatAmount,
  formatRatio,
  monthLastDay,
  monthOptionLabel,
  monthRange,
  normalizeCoverage,
  normalizeReview,
  shiftMonth,
  summarizeByPlant,
  summarizeMonths,
  summarizeRealized,
} from './settlementReviewModel'
import { coveragePayload, incompleteRow, reviewRow } from '@/test/hedgeSettlement'

describe('月份与区间（HR-02：不写死月份）', () => {
  it('月份平移跨年、月末含闰年', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2025-12', 1)).toBe('2026-01')
    expect(shiftMonth('2026-09', -11)).toBe('2025-10')
    expect(monthLastDay('2026-02')).toBe('2026-02-28')
    expect(monthLastDay('2024-02')).toBe('2024-02-29')
    expect(monthLastDay('2026-05')).toBe('2026-05-31')
  })

  it('回看窗口含当月最近 12 个月，从新到旧，截到今天', () => {
    const window = coverageWindow('2026-09-29')
    expect(window.fromDate).toBe('2025-10-01')
    expect(window.toDate).toBe('2026-09-29')
    expect(window.months).toHaveLength(12)
    expect(window.months[0]).toBe('2026-09')
    expect(window.months[11]).toBe('2025-10')
  })

  it('月份区间：往月取整月，当月截到今天', () => {
    expect(monthRange('2026-05', '2026-09-29')).toEqual({ fromDate: '2026-05-01', toDate: '2026-05-31' })
    expect(monthRange('2026-09', '2026-09-29')).toEqual({ fromDate: '2026-09-01', toDate: '2026-09-29' })
    expect(datesBetween('2024-02-28', '2024-03-01')).toEqual(['2024-02-28', '2024-02-29', '2024-03-01'])
  })

  it('默认月份优先最近的正式覆盖，没有正式时才取暂结，都没有返回 null', () => {
    const months = coverageWindow('2026-09-29').months
    const formal = coveragePayload({ plants: ['甲'], covered: { '2026-04-10': ['甲'], '2026-03-01': ['甲'] } })
    const provisional = coveragePayload({ plants: ['甲'], covered: { '2026-06-02': ['甲'], '2026-04-10': ['甲'] }, view: 'PROVISIONAL' })
    const summaries = summarizeMonths(months, formal, provisional)
    // 6 月只有暂结，比 4 月新，但默认只用正式（HR-03）。
    expect(defaultMonth(summaries)).toBe('2026-04')
    const april = summaries.find((s) => s.month === '2026-04')
    expect(april).toEqual({ month: '2026-04', formalDays: 1, provisionalOnlyDays: 0 })
    expect(monthOptionLabel(summaries.find((s) => s.month === '2026-06')!)).toBe('2026-06（仅暂结 1 天）')
    expect(monthOptionLabel(summaries[0])).toBe('2026-09（未入库）')

    const empty = coveragePayload({ plants: [], covered: {} })
    expect(defaultMonth(summarizeMonths(months, empty, provisional))).toBe('2026-06')
    expect(defaultMonth(summarizeMonths(months, empty, empty))).toBeNull()
    // 窗口外的日期不计入任何月份。
    const outside = coveragePayload({ plants: ['甲'], covered: { '2025-09-30': ['甲'] } })
    expect(defaultMonth(summarizeMonths(months, outside, empty))).toBeNull()
  })
})

describe('覆盖矩阵（HR-02：场站 × 日，缺失为未覆盖）', () => {
  const dates = ['2026-05-15', '2026-05-16', '2026-05-17']

  it('正式优先、只有暂结为暂结、都没有为未覆盖；全场站行区分全覆盖与部分覆盖', () => {
    const formal = coveragePayload({ plants: ['甲', '乙'], covered: { '2026-05-15': ['甲', '乙'], '2026-05-16': ['甲'] } })
    const provisional = coveragePayload({ plants: ['乙', '丙'], covered: { '2026-05-16': ['乙'], '2026-05-17': ['丙'], '2026-05-15': ['乙'] }, view: 'PROVISIONAL' })
    const matrix = buildCoverageMatrix(dates, formal, provisional)
    expect(matrix.plants).toEqual(['丙', '乙', '甲'].sort())
    const cellsOf = (plant: string) => matrix.rows.find((row) => row.plant === plant)?.cells
    expect(cellsOf('甲')).toEqual(['FORMAL', 'FORMAL', 'MISSING'])
    expect(cellsOf('乙')).toEqual(['FORMAL', 'PROVISIONAL', 'MISSING'])
    expect(cellsOf('丙')).toEqual(['MISSING', 'MISSING', 'PROVISIONAL'])
    expect(matrix.days.map((day) => day.state)).toEqual(['PARTIAL', 'PARTIAL', 'PROVISIONAL'])
    expect(matrix.totals).toEqual({ cells: 9, formal: 3, provisionalRecords: 3, provisionalOnly: 2, missing: 4, fullFormalDays: 0 })
    // 乙 5-15 同时有正式与暂结：格子只显示正式，暂结记录计数仍记一次，二者不相加。
    expect(matrix.rows.find((row) => row.plant === '乙')).toMatchObject({ formal: 1, provisionalRecords: 2, provisionalOnly: 1, missing: 1 })
  })

  it('全部场站有正式记录的日子是全覆盖；没有任何场站时每天都是未覆盖、格数为 0', () => {
    const formal = coveragePayload({ plants: ['甲'], covered: { '2026-05-15': ['甲'] } })
    const matrix = buildCoverageMatrix(dates, formal, null)
    expect(matrix.days.map((day) => day.state)).toEqual(['FORMAL', 'MISSING', 'MISSING'])
    expect(matrix.totals.fullFormalDays).toBe(1)
    const none = buildCoverageMatrix(dates, coveragePayload({ plants: [], covered: {} }), null)
    expect(none.rows).toHaveLength(0)
    expect(none.totals.cells).toBe(0)
    expect(none.days.every((day) => day.state === 'MISSING')).toBe(true)
  })

  it('连续日期压成区间，整段命中写「全部 N 天」', () => {
    const all = datesBetween('2026-05-01', '2026-05-06')
    expect(compressDates(['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-05'], all)).toBe('05-01~05-03、05-05')
    expect(compressDates(['2026-05-06'], all)).toBe('05-06')
    expect(compressDates(all, all)).toBe('全部 6 天')
    expect(compressDates([], all)).toBe('')
  })
})

describe('已实现指标汇总（HR-01：只用恒等核对通过的场站日）', () => {
  it('不平与分段缺失的行剔除并计数，套保率按计入行手算', () => {
    const rows = [
      reviewRow(),
      reviewRow({ date: '2026-05-16', ltmEnergy: 60, dayAheadIncrementMwh: -10, realTimeIncrementMwh: 0, actualOnGridEnergy: 50, spotExposure: { dayAheadAbsMwh: 10, realTimeAbsMwh: 0, netMwh: -10 } }),
      reviewRow({ date: '2026-05-17', actualOnGridEnergy: 150, balanced: false, residual: 35 }),
      incompleteRow({ date: '2026-05-18' }),
    ]
    // 计入 5-15、5-16：中长期 160，实际上网 165，套保率 160/165=0.9697；总敞口 25+10=35，净敞口 15−10=5。
    expect(summarizeRealized(rows)).toEqual({
      rowCount: 4, usedRows: 2, unbalancedRows: 1, incompleteRows: 1,
      ltmMwh: 160, actualMwh: 165, realizedRatio: 0.9697, spotGrossMwh: 35, spotNetMwh: 5,
    })
  })

  it('实际上网为 0：套保率不可计算（null），敞口照常为 0；没有计入行时全部为 null', () => {
    const zero = reviewRow({ ltmEnergy: 0, dayAheadIncrementMwh: 0, realTimeIncrementMwh: 0, actualOnGridEnergy: 0, realizedRatio: null, spotExposure: { dayAheadAbsMwh: 0, realTimeAbsMwh: 0, netMwh: 0 } })
    expect(summarizeRealized([zero])).toMatchObject({ usedRows: 1, realizedRatio: null, spotGrossMwh: 0, spotNetMwh: 0 })
    expect(formatRatio(summarizeRealized([zero]).realizedRatio)).toBe('不可计算')
    expect(summarizeRealized([incompleteRow()])).toEqual({
      rowCount: 1, usedRows: 0, unbalancedRows: 0, incompleteRows: 1,
      ltmMwh: null, actualMwh: null, realizedRatio: null, spotGrossMwh: null, spotNetMwh: null,
    })
  })

  it('逐场站汇总按场站列表顺序，结算行里多出的场站追加在后', () => {
    const rows = [reviewRow({ plant: '乙' }), reviewRow({ plant: '丁' })]
    expect(summarizeByPlant(rows, ['甲', '乙']).map((item) => [item.plant, item.usedRows, item.ltmMwh])).toEqual([
      ['甲', 0, null], ['乙', 1, 100], ['丁', 1, 100],
    ])
  })
})

describe('响应归一与格式（缺失是「没有」，不是 0）', () => {
  it('缺字段的响应归一为空集合与 null', () => {
    expect(normalizeReview({}, 'FORMAL')).toMatchObject({ status: 'NOT_REPORTED', rows: [], ledger: null, mechanismFee: null, calendar: null, view: 'FORMAL' })
    expect(normalizeReview({ rows: [reviewRow()] }, 'PROVISIONAL')).toMatchObject({ status: 'OK', view: 'PROVISIONAL' })
    expect(normalizeReview({ status: 'NOT_REPORTED', rows: [] }, 'FORMAL').status).toBe('NOT_REPORTED')
    const coverage = normalizeCoverage(undefined, 'PROVISIONAL')
    expect(coverage).toMatchObject({ plants: [], status: 'NOT_REPORTED', view: 'PROVISIONAL', dataQuality: { excludedUnverified: 0 } })
    expect(coverage.calendar.days).toEqual([])
  })

  it('金额/电量缺失显示「—」，0 就是 0；比率按百分比两位', () => {
    expect(formatAmount(null)).toBe('—')
    expect(formatAmount(undefined)).toBe('—')
    expect(formatAmount(Number.NaN)).toBe('—')
    expect(formatAmount(0)).toBe('0')
    expect(formatAmount(-100)).toBe('-100')
    expect(formatAmount(12.346)).toBe('12.35')
    expect(formatRatio(0.8696)).toBe('86.96%')
    expect(formatRatio(0)).toBe('0.00%')
  })
})
