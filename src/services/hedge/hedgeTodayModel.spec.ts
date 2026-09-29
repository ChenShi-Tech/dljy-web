// 套保「今明两日」视图模型纯函数测试（build-midlong-spot-hedging 任务 8.2/8.4/8.7，HW-01/02/05/09；ChenShi-Tech/dljy#3420）。
// 核心纪律：未知为 null 绝不补 0；台账「无合同=已知 0」与「失败=未知」分开；标签全部走契约中文标签；
// 导出带认知时点且用当前结果的查询快照；侧边栏摘要不含试算与方案对比、未覆盖时段不带数值。
import { describe, expect, it } from 'vitest'
import {
  assessmentLevelLabel,
  assessmentReasonLabel,
  buildExposureSeries,
  buildTodayCsv,
  buildTodaySummary,
  formatIsoShort,
  generationSourceLabel,
  intervalLabel,
  legPublishText,
  legRowsOf,
  midlongText,
  ratioStatusText,
  ratioValueText,
  splitGaps,
  todayCsvFilename,
  todayOverviewOf,
  uncoveredLabel,
  watchlistDirectionLabel,
} from './hedgeTodayModel'
import type { TodayInterval, TodayResult } from './hedgeTodayModel'

function interval(partial: Partial<TodayInterval>): TodayInterval {
  return {
    start: '2026-09-15T07:00:00+08:00',
    end: '2026-09-15T08:00:00+08:00',
    covered: true,
    generation: { value: '50', source: 'ACTUAL', uncoveredReason: null, unknownStationIds: [] },
    locked: { midlong: '20', lockNote: null, mechanism: { value: '10', note: null }, total: '30' },
    exposure: { withMechanism: '20', midlongOnly: '30' },
    ...partial,
  }
}

describe('buildExposureSeries（HW-02：未知 null 断开）', () => {
  it('未知时段的敞口点为 null 而不是 0，发电柱同样不绘制', () => {
    const series = buildExposureSeries([
      interval({}),
      interval({
        start: '2026-09-16T08:00:00+08:00', end: '2026-09-16T09:00:00+08:00', covered: false,
        generation: { value: null, source: null, uncoveredReason: 'FORECAST_NOT_ARRIVED', unknownStationIds: [] },
        locked: { midlong: null, lockNote: 'CURVE_MISSING', mechanism: { value: null, note: null }, total: null },
        exposure: { withMechanism: null, midlongOnly: null },
      }),
    ])
    expect(series.withMechanism).toEqual([20, null])
    expect(series.midlongOnly).toEqual([30, null])
    expect(series.generation[1]).toEqual({ value: null, source: null, uncoveredReason: 'FORECAST_NOT_ARRIVED' })
    expect(series.generation[0]?.source).toBe('ACTUAL')
  })

  it('连续未覆盖时段合成一个区间，原因取首个非空', () => {
    const series = buildExposureSeries([
      interval({ start: '2026-09-15T07:00:00+08:00' }),
      interval({
        start: '2026-09-16T01:00:00+08:00', covered: false,
        generation: { value: null, source: null, uncoveredReason: 'FORECAST_NOT_ARRIVED', unknownStationIds: [] },
        locked: { midlong: null, lockNote: null, mechanism: { value: null, note: null }, total: null },
        exposure: { withMechanism: null, midlongOnly: null },
      }),
      interval({
        start: '2026-09-16T02:00:00+08:00', covered: false,
        generation: { value: null, source: null, uncoveredReason: null, unknownStationIds: [] },
        locked: { midlong: null, lockNote: null, mechanism: { value: null, note: null }, total: null },
        exposure: { withMechanism: null, midlongOnly: null },
      }),
      interval({ start: '2026-09-16T03:00:00+08:00' }),
    ])
    expect(series.uncoveredRanges).toEqual([
      { fromLabel: '09-16 01:00', toLabel: '09-16 02:00', reason: '预测未到达' },
    ])
  })

  it('跨天窗口标签带月日', () => {
    expect(intervalLabel('2026-09-16T08:00:00+08:00')).toBe('09-16 08:00')
    expect(buildExposureSeries([interval({})]).labels).toEqual(['09-15 07:00'])
  })
})

describe('splitGaps（读取失败与数据覆盖分开）', () => {
  it('查询失败类缺口进 failures，覆盖类缺口进 coverage', () => {
    const { failures, coverage } = splitGaps([
      { code: 'LEDGER_WATERMARK_FAILED', message: '台账水位读取失败', affected: null },
      { code: 'BASELINES_QUERY_FAILED', message: '月度基准读取失败', affected: null },
      { code: 'CAPS_QUERY_FAILED', message: '核定上限读取失败', affected: null },
      { code: 'STATIONS_QUERY_FAILED', message: '场站映射读取失败', affected: null },
      { code: 'FORECAST_NOT_ARRIVED', message: '明日预测未到达', affected: null },
      { code: 'UNMAPPED', message: '存在未映射场站', affected: '甲风电' },
      { code: 'SCHEME_TRANSITION_PENDING', message: '方案切换待生效', affected: null },
    ])
    expect(failures.map((g) => g.code)).toEqual(['BASELINES_QUERY_FAILED', 'CAPS_QUERY_FAILED', 'LEDGER_WATERMARK_FAILED', 'STATIONS_QUERY_FAILED'])
    expect(coverage.map((g) => g.code)).toEqual(['FORECAST_NOT_ARRIVED', 'SCHEME_TRANSITION_PENDING', 'UNMAPPED'])
  })

  it('gaps 缺失或空时两区皆空', () => {
    expect(splitGaps([])).toEqual({ failures: [], coverage: [] })
  })
})

describe('midlongText（台账无合同与失败分开）', () => {
  it('无生效合同是已知 0，分解缺段/无权限是未知，文案不同', () => {
    expect(midlongText(interval({ locked: { midlong: null, lockNote: 'NO_CONTRACT', mechanism: { value: null, note: null }, total: null } }))).toBe('0（无生效合同）')
    expect(midlongText(interval({ locked: { midlong: null, lockNote: 'CURVE_MISSING', mechanism: { value: null, note: null }, total: null } }))).toBe('未知（分解缺段）')
    expect(midlongText(interval({ locked: { midlong: null, lockNote: 'FORBIDDEN', mechanism: { value: null, note: null }, total: null } }))).toBe('无权限')
    expect(midlongText(interval({ locked: { midlong: null, lockNote: null, mechanism: { value: null, note: null }, total: null } }))).toBe('未知')
    expect(midlongText(interval({}))).toBe('20')
  })
})

describe('比率与判级标签', () => {
  it('FORBIDDEN 显示无权限文案，不显示数值（更不是 0）', () => {
    expect(ratioValueText({ value: '0.5', status: 'FORBIDDEN' })).toBe('无权限查看中长期持仓')
    expect(ratioValueText({ value: null, status: 'MECHANISM_INCOMPLETE' })).toBe('不可计算')
    expect(ratioValueText({ value: '0.6', status: 'OK' })).toBe('0.6')
    expect(ratioValueText(null)).toBe('不可计算')
  })

  it('状态文案走判级原因标签：MECHANISM_INCOMPLETE → 机制参数不完整；有值不显示状态', () => {
    expect(ratioStatusText({ value: null, status: 'MECHANISM_INCOMPLETE' })).toBe('机制参数不完整')
    expect(ratioStatusText({ value: '0.6', status: 'OK' })).toBe(null)
    expect(ratioStatusText({ value: null, status: 'FORBIDDEN' })).toBe('无权限查看中长期持仓')
  })

  it('判级与原因用契约中文标签；未知码原样', () => {
    expect(assessmentLevelLabel('NOT_ASSESSED')).toBe('未评估')
    expect(assessmentLevelLabel('OVER')).toBe('过保')
    expect(assessmentReasonLabel('MECHANISM_INCOMPLETE')).toBe('机制参数不完整')
    expect(assessmentReasonLabel('FORBIDDEN')).toBe('无权限查看中长期持仓')
    expect(assessmentReasonLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
    expect(uncoveredLabel('FORECAST_NOT_ARRIVED')).toBe('预测未到达')
    expect(uncoveredLabel('WEIRD_CODE')).toBe('WEIRD_CODE')
    expect(uncoveredLabel(null)).toBe(null)
  })
})

describe('legRowsOf / legPublishText（HW-01 数据腿）', () => {
  it('提取逐腿行（供应商预测按来源多行），缺 rows 时为空', () => {
    const overview = todayOverviewOf({
      legs: { status: 'DEGRADED', degraded: true, rows: [
        { key: 'LEDGER', label: '中长期合同台账', status: 'OK', reason: '台账无已确认合同' },
        { key: 'FORECAST_VENDOR', sourceKey: 'enyvision', label: '供应商发电预测·远景', status: 'STALE', reason: '预测未到达：供应商远景停更', dataThrough: '2026-09-15T08:00:00+08:00' },
        { key: 'PRICE', label: '价格', status: 'FAILED', reason: '价格读取失败：连接超时' },
        { key: '', label: '空 key 行被丢弃' },
      ] },
    })
    const rows = legRowsOf(overview)
    expect(rows.map((r) => r.label)).toEqual(['中长期合同台账', '供应商发电预测·远景', '价格'])
    expect(rows[1]).toMatchObject({ key: 'FORECAST_VENDOR', sourceKey: 'enyvision', status: 'STALE', dataThrough: '2026-09-15T08:00:00+08:00' })
    expect(legRowsOf(todayOverviewOf({ legs: {} }))).toEqual([])
  })

  it('发布时刻标注登记假设', () => {
    expect(legPublishText({
      key: 'FORECAST_VENDOR', sourceKey: null, label: '', status: 'OK',
      changedAt: null, dataThrough: null, publishRule: null, publishAssumption: '每日 17:30 前发布',
      publishedAt: '2026-09-15T17:30:00+08:00', ingestedAt: null, version: null, reason: null, note: null,
    })).toBe('09-15 17:30（登记假设）')
    expect(legPublishText({
      key: 'ACTUAL', sourceKey: null, label: '', status: 'OK',
      changedAt: '2026-09-15T06:00:00+08:00', dataThrough: null, publishRule: null, publishAssumption: null,
      publishedAt: null, ingestedAt: null, version: null, reason: null, note: null,
    })).toBe('09-15 06:00')
    expect(formatIsoShort(null)).toBe(null)
  })

  it('formatIsoShort 解析时区偏移后按北京时间显示：02:00Z → 10:00，+08:00 偏移的值不变（R1-02）', () => {
    // UTC 的 Z 时间必须换算成 Asia/Shanghai，否则新鲜度整体错报 8 小时。
    expect(formatIsoShort('2026-09-29T02:00:00Z')).toBe('09-29 10:00')
    // 已带 +08:00 偏移的时刻（本地口径的 dataThrough/发布时刻）显示不变。
    expect(formatIsoShort('2026-09-15T08:00:00+08:00')).toBe('09-15 08:00')
    // 同一 instant 的两种写法显示一致。
    expect(formatIsoShort('2026-09-29T02:00:00+00:00')).toBe(formatIsoShort('2026-09-29T02:00:00Z'))
    expect(formatIsoShort(null)).toBe(null)
  })
})

function todayResult(overrides: Record<string, unknown> = {}): TodayResult {
  const data = todayOverviewOf({
    asOf: '2026-09-15T02:00:00Z', view: 'CURRENT',
    intervals: [
      interval({}),
      interval({
        start: '2026-09-16T08:00:00+08:00', end: '2026-09-16T09:00:00+08:00', covered: false,
        generation: { value: null, source: null, uncoveredReason: 'FORECAST_NOT_ARRIVED', unknownStationIds: [] },
        locked: { midlong: null, lockNote: 'CURVE_MISSING', mechanism: { value: null, note: null }, total: null },
        exposure: { withMechanism: null, midlongOnly: null },
      }),
    ],
    ratio: { coverage: { coveredCount: 1, totalCount: 2 }, withMechanism: { value: null, status: 'MECHANISM_INCOMPLETE' }, midlongOnly: { value: '0.6', status: 'OK' } },
    standardMetrics: { TODAY2_INTERVAL: { level: 'NOT_ASSESSED', reason: 'MECHANISM_INCOMPLETE', hints: [], tier: null, basis: 'WITH_MECHANISM' } },
    sensitivity: { value: null, incomplete: true, reference: '30', note: '未计机制电量' },
    watchlist: { rows: [
      { start: '2026-09-15T07:00:00+08:00', end: '2026-09-15T08:00:00+08:00', basis: 'WITH_MECHANISM', note: null, exposureMwh: '20.5', direction: 'SELL', riskNote: null, priceTag: null },
    ], basisUsed: 'WITH_MECHANISM', note: null, disclaimer: '决策支持参考' },
    scheme: null,
    legs: {},
    gaps: [{ code: 'FORECAST_NOT_ARRIVED', message: '明日预测未到达', affected: null }],
    ...overrides,
  })
  return { data, query: { fromDate: '2026-09-15', toDate: '2026-09-16', granularity: 'HOUR', asOf: null } }
}

describe('buildTodayCsv（HW-05：导出带认知时点与查询快照）', () => {
  it('每行带认知时点与查询参数；数值缺失留空不写 0', () => {
    const csv = buildTodayCsv(todayResult())
    expect(csv.headers.slice(0, 5)).toEqual(['认知时点', '视图', '窗口起', '窗口止', '粒度'])
    expect(csv.rows[0]?.slice(0, 5)).toEqual(['当前视图', 'CURRENT', '2026-09-15', '2026-09-16', 'HOUR'])
    const uncovered = csv.rows[1] ?? []
    expect(uncovered[7]).toBe('') // 发电缺失 → 空
    expect(uncovered[8]).toBe('未覆盖')
    expect(uncovered[9]).toBe('预测未到达')
    expect(uncovered[13]).toBe('') // 敞口缺失 → 空，不是 0
  })

  it('asOf 快照进每行与文件名（冒号等字符转安全）', () => {
    const result = todayResult()
    result.query = { fromDate: '2026-09-15', toDate: '2026-09-16', granularity: 'HOUR', asOf: '2026-09-15T08:00:00+08:00' }
    const csv = buildTodayCsv(result)
    expect(csv.rows[0]?.[0]).toBe('2026-09-15T08:00:00+08:00')
    expect(csv.rows[0]?.[1]).toBe('AS_OF')
    expect(csv.filename).toBe('hedge-today2_2026-09-15_2026-09-16_asof-2026-09-15T08-00-00-08-00.csv')
    expect(todayCsvFilename({ fromDate: 'a', toDate: 'b', granularity: 'HOUR', asOf: null })).toBe('hedge-today2_a_b.csv')
  })
})

describe('buildTodaySummary（HW-09：侧边栏摘要）', () => {
  it('含两个套保率、判级、需关注与数据腿；不含试算与方案对比字段；未覆盖时段不带数值', () => {
    const summary = buildTodaySummary(todayResult())
    expect(summary).not.toBe(null)
    expect(summary?.ratios).toMatchObject({
      withMechanism: { value: '不可计算', status: '机制参数不完整' },
      midlongOnly: { value: '0.6', status: null },
    })
    expect(summary?.assessment).toMatchObject({ level: '未评估', reason: '机制参数不完整' })
    expect(summary?.watchlist).toEqual([
      { start: '2026-09-15T07:00:00+08:00', direction: '多发需现货卖出', exposureMwh: '20.5', note: null },
    ])
    expect(summary?.coverage).toEqual({ coveredCount: 1, totalCount: 2 })
    const text = JSON.stringify(summary)
    expect(text).not.toContain('试算')
    expect(text).not.toContain('simulate')
    // 未覆盖时段不带数值：摘要里没有逐时段明细键，只有需关注行（已覆盖）。
    expect(summary).not.toHaveProperty('intervals')
  })

  it('无结果时返回 null；腿行带中文状态', () => {
    expect(buildTodaySummary(null)).toBe(null)
    const summary = buildTodaySummary(todayResult({
      legs: { degraded: false, rows: [
        { key: 'LEDGER', label: '中长期合同台账', status: 'OK', reason: '台账无已确认合同' },
        { key: 'FORECAST_VENDOR', sourceKey: 'enyvision', label: '供应商发电预测·远景', status: 'STALE', reason: '预测未到达' },
      ] },
    }))
    expect(summary?.legs).toEqual([
      { label: '中长期合同台账', status: '正常', reason: '台账无已确认合同' },
      { label: '供应商发电预测·远景', status: '过期', reason: '预测未到达' },
    ])
  })
})

describe('显示辅助', () => {
  it('方向与发电来源中文', () => {
    expect(watchlistDirectionLabel('SELL')).toBe('多发需现货卖出')
    expect(watchlistDirectionLabel('BUY')).toBe('欠发需现货买回')
    expect(watchlistDirectionLabel('ZERO')).toBe('持平')
    expect(generationSourceLabel('ACTUAL')).toBe('实际')
    expect(generationSourceLabel('FORECAST_VENDOR')).toBe('预测')
    expect(generationSourceLabel(null)).toBe('')
  })
})
