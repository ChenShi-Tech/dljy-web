// 守住日前盯盘结果适配的诚实口径（dljy#3484，规格 DW-04/DW-08/DW-09/DW-12）：
// 首屏只取服务端重点项、日级/单点不画小时区间、区间裁剪到目标日、缺测不补、曲线不平滑不连空、未知不写 0。
// 坏掉的症状：一般/待核项冒充重点、必开名单被画成全天停运、跨日计划画出目标日外、负荷缺槽被连成直线、
// 覆盖缺字段显示成 0 让人误以为“没有未处理”。
import { describe, expect, it } from 'vitest'
import type { DisclosureWatchItem, DisclosureWatchRunResult } from 'shared/schema/disclosure-watch-contract.mjs'
import {
  buildWatchLoadChartOption, buildWatchTimeline, countText, formatBeijingTime, groupWatchItems, hasModelJudgement, highLoadBands, minuteOfTradeDate,
  watchChangeText, watchCountRows, watchCoverageRows, watchCoverageSummary, watchHeadlineCounts, watchLoadPoints, watchProcessingRows,
  watchSubmittedVerdicts, watchTargetDateGaps, watchTopFocus,
} from './disclosureWatchModel'

const TRADE_DATE = '2026-09-30'

function item(id: string, patch: Partial<DisclosureWatchItem> = {}): DisclosureWatchItem {
  return {
    itemId: id, level: 'focus', kind: 'maintenance-plan',
    object: { objectKey: `yunnan:${id}`, plantName: `电厂${id}`, unitName: '1号机', deviceName: null },
    change: { kind: 'new', comparedCoverageDate: '2026-09-27', detail: null },
    window: { kind: 'interval', start: `${TRADE_DATE}T08:00:00`, end: `${TRADE_DATE}T18:00:00`, label: '08:00–18:00 计划检修' },
    headline: `${id} 计划检修`, facts: [], reviewReasons: [], flags: [], processing: 'rule', mechanism: null, consistency: null,
    evidence: [{ ref: 'S1', sourceRef: { snapshotId: 'snap-1', rowIndex: 0 }, dataset: 'forecast_maintenance_plan', coverageDate: TRADE_DATE, receivedAt: '2026-09-29T07:00:00Z', fields: { 设备名称: `电厂${id}1号机` } }],
    nextAction: '核对计划是否按期执行', eventId: null,
    ...patch,
  }
}

function result(patch: Partial<DisclosureWatchRunResult> = {}): DisclosureWatchRunResult {
  return {
    contractVersion: '1.0.0', runId: 'run-1', status: 'complete', mode: 'live', tradeDate: TRADE_DATE, regionId: 'yunnan',
    asOf: '2026-09-29T08:00:00Z', createdAt: '2026-09-29T08:00:00Z', finishedAt: '2026-09-29T08:00:05Z', deadlineAt: '2026-09-29T08:00:45Z',
    scopeLabel: '云南', calibrationStatus: 'uncalibrated',
    versions: { contract: '1.0.0', ruleset: 'dw-rules-v1', questionSet: 'dw-questions-v1', format: 'dw-format-v1', dateRule: 'dw-date-v1', budget: 'dw-budget-v1', requestModel: null, modelVersions: [] },
    inputVersion: { hash: 'abc', snapshots: [] },
    inputCoverage: {
      forecast_maintenance_plan: { status: 'complete', snapshotId: 's1', coverageDate: TRADE_DATE, receivedAt: '2026-09-29T07:00:00Z', note: null },
      actual_unplanned_unit_outage: { status: 'partial', snapshotId: 's2', coverageDate: '2026-09-28', receivedAt: null, note: '分页不全' },
      forecast_must_run_stop_unit_list: { status: 'missing', snapshotId: null, coverageDate: null, receivedAt: null, note: null },
    },
    backgroundCoverage: { load_forecast: { status: 'complete', snapshotId: 's3', coverageDate: TRADE_DATE, receivedAt: '2026-09-29T07:00:00Z', note: null } },
    processingCoverage: { chains: 5, modelRequired: 3, evaluated: 2, modelFailed: 1, unprocessed: 0 },
    counts: { rawRows: 10, duplicateRows: 2, chains: 5, byDisposition: { eligible: 4, 'review-needed': 1, 'out-of-scope': 0, invalid: 0 }, byLevel: { focus: 1, general: 1, review: 1 } },
    attention: 'focus', summary: '有 1 项重点核对', items: [], background: { loadForecast: null },
    usage: { calls: 0, inputTokens: null, outputTokens: null, elapsedMs: null }, errors: [],
    dataMeta: { sourceType: 'IMPORT', mock: false, productionWrite: false, persisted: true },
    ...patch,
  }
}

describe('日前盯盘事项分组', () => {
  it('首屏 Top 3 只取 level=focus，按服务端顺序，不拿一般/待核补位', () => {
    const items = [item('g1', { level: 'general' }), item('f1'), item('r1', { level: 'review' }), item('f2'), item('f3'), item('f4')]
    expect(watchTopFocus(result({ items })).map((entry) => entry.itemId)).toEqual(['f1', 'f2', 'f3'])
    expect(watchTopFocus(result({ items: [item('g1', { level: 'general' }), item('r1', { level: 'review' })] }))).toEqual([])
    expect(watchTopFocus(null)).toEqual([])
  })

  it('分组三档互斥并保留服务端顺序', () => {
    const groups = groupWatchItems([item('r1', { level: 'review' }), item('f1'), item('g1', { level: 'general' }), item('r2', { level: 'review' })])
    expect(groups.focus.map((entry) => entry.itemId)).toEqual(['f1'])
    expect(groups.general.map((entry) => entry.itemId)).toEqual(['g1'])
    expect(groups.review.map((entry) => entry.itemId)).toEqual(['r1', 'r2'])
  })

  it('变化文案写实际比较日期；不可比较时不附比较日；名单未列入不称复机', () => {
    expect(watchChangeText(item('a'))).toBe('新增（对比 2026-09-27）')
    expect(watchChangeText(item('a', { change: { kind: 'not-comparable', comparedCoverageDate: null, detail: null } }))).toBe('无法比较（上一份缺失或不完整）')
    expect(watchChangeText(item('a', { change: { kind: 'removed', comparedCoverageDate: '2026-09-26', detail: null } }))).toContain('不代表复机')
  })

  it('只有存在模型判断时才标试验研判', () => {
    expect(hasModelJudgement(result({ items: [item('a')] }))).toBe(false)
    const judged = item('b', { level: 'review', kind: 'unplanned-outage', mechanism: { origin: 'model', trial: true, choice: 'equipment-limit', probabilities: {}, confidence: null, modelVersion: 'jev-1.13.0', questionSetVersion: 'dw-questions-v1' } })
    expect(hasModelJudgement(result({ items: [item('a'), judged] }))).toBe(true)
  })

  it('服务端已提交评价按事项取最新一条，未知枚举丢弃', () => {
    expect(watchSubmittedVerdicts([
      { itemId: 'a', verdict: 'useful', createdAt: '2026-09-29T08:00:00Z' },
      { itemId: 'a', verdict: 'needs-correction', createdAt: '2026-09-29T09:00:00Z' },
      { itemId: 'b', verdict: 'maybe', createdAt: '2026-09-29T09:00:00Z' },
    ])).toEqual({ a: 'needs-correction' })
    expect(watchSubmittedVerdicts(undefined)).toEqual({})
  })
})

describe('日前盯盘覆盖与计数：未知不写 0', () => {
  it('非负整数照常显示，缺失/负数/小数一律显示未知', () => {
    expect(countText(0)).toBe('0')
    expect(countText(1234)).toBe('1,234')
    for (const value of [undefined, null, -1, 1.5, Number.NaN, '3']) expect(countText(value)).toBe('未知')
  })

  it('三类核心资料逐项列出状态，缺失与部分如实显示，缺接收时间写未提供', () => {
    const rows = watchCoverageRows(result())
    expect(rows.map((row) => [row.dataset, row.statusLabel])).toEqual([
      ['forecast_maintenance_plan', '完整'], ['actual_unplanned_unit_outage', '部分'], ['forecast_must_run_stop_unit_list', '缺失'], ['load_forecast', '完整'],
    ])
    expect(rows[1]).toMatchObject({ receivedAt: '未提供', note: '分页不全' })
    expect(rows[2]).toMatchObject({ coverageDate: '未提供', receivedAt: '未提供' })
    expect(rows[0].receivedAt).toBe('2026-09-29 15:00:00')
  })

  it('覆盖条目缺失时显示未知而不是完整', () => {
    const partial = result({ inputCoverage: {} as DisclosureWatchRunResult['inputCoverage'], backgroundCoverage: {} as DisclosureWatchRunResult['backgroundCoverage'] })
    expect(watchCoverageRows(partial).every((row) => row.statusLabel === '未知')).toBe(true)
  })

  it('处理覆盖与计数字段缺失时写未知，不写 0', () => {
    const missing = result({ processingCoverage: {} as DisclosureWatchRunResult['processingCoverage'], counts: {} as DisclosureWatchRunResult['counts'] })
    expect(watchProcessingRows(missing).map((row) => row.value)).toEqual(['未知', '未知', '未知', '未知', '未知'])
    const counts = watchCountRows(missing)
    expect([...counts.totals, ...counts.dispositions, ...counts.levels].every((row) => row.value === '未知')).toBe(true)
    expect(watchCoverageSummary(missing)).toContain('需模型判断 未知 条（已研判 未知 · 失败 未知 · 未处理 未知）')
    expect(watchHeadlineCounts(missing).unprocessed).toBe('未知')
    expect(watchProcessingRows(result()).map((row) => row.value)).toEqual(['5', '3', '2', '1', '0'])
  })

  it('覆盖摘要逐项写出核心资料状态与负荷背景', () => {
    expect(watchCoverageSummary(result())).toBe('核心资料：检修（含改造）执行计划 完整 · 发电机组计划外停运 部分 · 必开必停机组名单 缺失；负荷背景：完整；需模型判断 3 条（已研判 2 · 失败 1 · 未处理 0）')
  })

  it('目标日清单类资料缺失才算明日资料未到；未登记类别视为未到', () => {
    const summary = { snapshotId: 'x', dataset: 'forecast_maintenance_plan' as const, coverageDate: TRADE_DATE, receivedAt: '2026-09-29T07:00:00Z', completeness: 'complete' as const, origin: 'capture' as const, contentSha256: 'a'.repeat(64) }
    expect(watchTargetDateGaps({ datasets: [] })).toEqual({ missing: ['检修（含改造）执行计划', '必开必停机组名单'], allMissing: true })
    expect(watchTargetDateGaps({ datasets: [{ dataset: 'forecast_maintenance_plan', label: '', latest: summary, forTradeDate: summary }, { dataset: 'actual_unplanned_unit_outage', label: '', latest: null, forTradeDate: null }] }))
      .toEqual({ missing: ['必开必停机组名单'], allMissing: false })
  })

  it('系统时刻按北京时间显示，非法返回 null', () => {
    expect(formatBeijingTime('2026-09-29T16:30:00Z')).toBe('2026-09-30 00:30:00')
    expect(formatBeijingTime('not-a-time')).toBeNull()
    expect(formatBeijingTime(null)).toBeNull()
  })
})

describe('日前盯盘时间轴', () => {
  it('日级、单点、未知时段不画小时区间，列为日级/持续性未知', () => {
    const timeline = buildWatchTimeline(result({ items: [
      item('day', { kind: 'must-run-stop', window: { kind: 'day', start: null, end: null, label: '目标日全天要求' } }),
      item('point', { level: 'review', kind: 'unplanned-outage', window: { kind: 'point', start: '2026-09-29T09:00:00', end: null, label: '09-29 09:00 停机' } }),
      item('unknown', { level: 'review', window: { kind: 'unknown', start: null, end: null, label: '时段未知' } }),
    ] }))
    expect(timeline.rows).toEqual([])
    expect(timeline.undrawn.map((entry) => [entry.itemId, entry.reason])).toEqual([
      ['day', '日级要求，不画小时区间'], ['point', '仅有状态时点，明日持续性未知'], ['unknown', '时段未知'],
    ])
  })

  it('计划区间裁剪到目标日 00:00–24:00，并标记前日起/次日止', () => {
    const timeline = buildWatchTimeline(result({ items: [
      item('inside'),
      item('cross', { window: { kind: 'interval', start: '2026-09-29T20:00:00', end: '2026-10-02T06:00:00', label: '跨日检修' } }),
    ] }))
    expect(timeline.rows.map((row) => [row.itemId, row.startMinute, row.endMinute, row.startText, row.endText])).toEqual([
      ['inside', 480, 1080, '08:00', '18:00'],
      ['cross', 0, 1440, '00:00（前日起）', '24:00（次日止）'],
    ])
    expect(timeline.rows[1]).toMatchObject({ clippedStart: true, clippedEnd: true })
  })

  it('目标日外、区间倒置、缺端点或已转区间待核的事项不画', () => {
    const timeline = buildWatchTimeline(result({ items: [
      item('outside', { window: { kind: 'interval', start: '2026-10-01T02:00:00', end: '2026-10-01T05:00:00', label: '次日检修' } }),
      item('reversed', { window: { kind: 'interval', start: `${TRADE_DATE}T18:00:00`, end: `${TRADE_DATE}T08:00:00`, label: '倒置' } }),
      item('open', { window: { kind: 'interval', start: `${TRADE_DATE}T08:00:00`, end: null, label: '缺复电' } }),
      item('ambiguous', { level: 'review', reviewReasons: ['column-order-ambiguous'] }),
    ] }))
    expect(timeline.rows).toEqual([])
    expect(timeline.undrawn.map((entry) => entry.reason)).toEqual(['区间不在目标日内', '区间异常（结束不晚于开始）', '区间不完整，不画小时区间', '区间待核，不画小时区间'])
  })

  it('带时区的时刻按北京时间换算，无时区的非标准串不猜', () => {
    expect(minuteOfTradeDate('2026-09-30T02:00:00Z', TRADE_DATE)).toBe(600)
    expect(minuteOfTradeDate('2026-09-30 10:00', TRADE_DATE)).toBeNull()
    expect(minuteOfTradeDate(`${TRADE_DATE}T10:30:00`, TRADE_DATE)).toBe(630)
  })

  it('行按级别排序、同级保持服务端顺序，超出上限计入 hiddenRows', () => {
    const items = [item('g1', { level: 'general' }), item('f1'), item('r1', { level: 'review' }), item('f2')]
    const timeline = buildWatchTimeline(result({ items }), 3)
    expect(timeline.rows.map((row) => row.itemId)).toEqual(['f1', 'f2', 'g1'])
    expect(timeline.hiddenRows).toBe(1)
  })

  it('负荷缺测 null 保留、缺槽插入断点，不插值不补零', () => {
    const { points, missingPoints, validPoints } = watchLoadPoints([
      { timePoint: '00:00', valueMw: 100 }, { timePoint: '00:15', valueMw: null }, { timePoint: '00:30', valueMw: 0 },
      { timePoint: '01:15', valueMw: 120 }, { timePoint: 'bad', valueMw: 5 },
    ])
    expect(points).toEqual([
      { minute: 0, value: 100 }, { minute: 15, value: null }, { minute: 30, value: 0 },
      { minute: 45, value: null }, { minute: 75, value: 120 },
    ])
    expect(missingPoints).toBe(3) // 1 个显式缺测 + 00:45、01:00 两个缺槽
    expect(validPoints).toBe(3)
  })

  it('较高负荷小时合并为连续区段；样本不全（null）不生成标签', () => {
    expect(highLoadBands(['18:00', '10', '11:00', '19', 'x', '25'])).toEqual([{ fromMinute: 600, toMinute: 720 }, { fromMinute: 1080, toMinute: 1200 }])
    const withBands = buildWatchTimeline(result({ background: { loadForecast: { coverageDate: TRADE_DATE, unit: 'MW', points: [], highLoadHours: ['10:00', '11:00'], method: '小时均值上四分位' } } }))
    expect(withBands.highLoadNote).toBe('较高负荷时段 10:00–12:00（当日相对位置，非官方紧张阈值）')
    const incomplete = buildWatchTimeline(result({ background: { loadForecast: { coverageDate: TRADE_DATE, unit: 'MW', points: [], highLoadHours: null, method: '' } } }))
    expect(incomplete.highLoadBands).toEqual([])
    expect(incomplete.highLoadNote).toBe('负荷预测样本不完整，未生成较高负荷时段')
    expect(buildWatchTimeline(result()).load).toBeNull()
  })

  it('负荷曲线 smooth:false 且 connectNulls:false，缺测点以 null 进入数据', () => {
    const timeline = buildWatchTimeline(result({ background: { loadForecast: { coverageDate: TRADE_DATE, unit: 'MW', points: [{ timePoint: '00:00', valueMw: 100 }, { timePoint: '00:15', valueMw: null }, { timePoint: '00:30', valueMw: 90 }], highLoadHours: ['00:00'], method: 'm' } } }))
    const option = buildWatchLoadChartOption(timeline, { line: '#111111', band: '#222222', axis: '#333333', split: '#444444' })
    const [series] = option.series as Array<Record<string, unknown>>
    expect(series).toMatchObject({ type: 'line', smooth: false, connectNulls: false })
    expect(series.data).toEqual([[0, 100], [15, null], [30, 90]])
    expect(series.markArea).toMatchObject({ data: [[{ xAxis: 0 }, { xAxis: 60 }]] })
    expect(option.xAxis).toMatchObject({ type: 'value', min: 0, max: 1440 })
    const tooltip = option.tooltip.formatter([{ value: [15, null] }])
    expect(tooltip).toBe('00:15 · 缺测')
  })
})
