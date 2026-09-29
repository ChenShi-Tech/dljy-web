// 套保补仓试算与方案对比纯函数测试（openspec build-midlong-spot-hedging 任务 8.5，HM-07/HB-05；dljy#3422）。
// node 环境（*.spec.ts）：输入预校验、窗口与标准窗口口径、请求体形状、422 字段定位、响应防御归一、
// 对比预览判级（与 shared 的 compareSchemes 手算对拍）。不发任何请求。
import { describe, expect, it } from 'vitest'
import {
  SIMULATION_PROFILE_DAYS_DEFAULT, SIMULATION_PROFILE_DAYS_MAX, buildSimulateBody, compareSchemeRows, customSchemeFrom,
  evaluationToday, normalizeSimulationResult, parseProfileDays, parseQuantityMwh, presetSchemes, simulateFailureOf,
  standardMetricOfWindow, windowRange,
} from './hedgeSimulateModel'
import type { TierDraft } from './hedgeMaintenanceModel'

const T = '2026-09-15'

describe('parseQuantityMwh（试算电量预校验）', () => {
  it('接受非零十进制数（正为补仓、负为减仓）', () => {
    expect(parseQuantityMwh('2000')).toEqual({ ok: true, value: '2000' })
    expect(parseQuantityMwh('-500.5')).toEqual({ ok: true, value: '-500.5' })
    expect(parseQuantityMwh(' 300 ')).toEqual({ ok: true, value: '300' })
  })
  it('拒绝空串、非数字、0', () => {
    expect(parseQuantityMwh('').ok).toBe(false)
    expect(parseQuantityMwh('abc').ok).toBe(false)
    expect(parseQuantityMwh('2e3').ok).toBe(false)
    expect(parseQuantityMwh('0').ok).toBe(false)
    expect(parseQuantityMwh('0.0').ok).toBe(false)
    expect(parseQuantityMwh('1,000').ok).toBe(false)
  })
})

describe('parseProfileDays（回看天数）', () => {
  it('空串取缺省 14，整数 1—60 通过', () => {
    expect(parseProfileDays('')).toEqual({ ok: true, value: SIMULATION_PROFILE_DAYS_DEFAULT })
    expect(parseProfileDays('14')).toEqual({ ok: true, value: 14 })
    expect(parseProfileDays('1')).toEqual({ ok: true, value: 1 })
    expect(parseProfileDays(String(SIMULATION_PROFILE_DAYS_MAX))).toEqual({ ok: true, value: SIMULATION_PROFILE_DAYS_MAX })
  })
  it('越界与小数拒绝', () => {
    expect(parseProfileDays('0').ok).toBe(false)
    expect(parseProfileDays('61').ok).toBe(false)
    expect(parseProfileDays('3.5').ok).toBe(false)
    expect(parseProfileDays('abc').ok).toBe(false)
  })
})

describe('evaluationToday / windowRange（窗口与后端 resolveWindow 同口径）', () => {
  it('asOf 有效取其北京日，无效或空回落当前', () => {
    expect(evaluationToday('2026-09-15T10:00:00+08:00')).toBe('2026-09-15')
    expect(evaluationToday('2026-09-14T20:00:00Z')).toBe('2026-09-15') // 次日凌晨 04:00（北京时间）
    expect(evaluationToday(null, Date.parse('2026-09-15T03:00:00Z'))).toBe('2026-09-15')
    expect(evaluationToday('garbage', Date.parse('2026-09-15T03:00:00Z'))).toBe('2026-09-15')
  })
  it('TODAY2 = T 的今明两日，MONTH = T 所在整月', () => {
    expect(windowRange('TODAY2', { from: '', to: '' }, T)).toEqual({ fromDate: T, toDate: '2026-09-16' })
    expect(windowRange('MONTH', { from: '', to: '' }, T)).toEqual({ fromDate: '2026-09-01', toDate: '2026-09-30' })
  })
  it('CUSTOM 校验 ISO 且起不晚于止', () => {
    expect(windowRange('CUSTOM', { from: '2026-09-10', to: '2026-09-12' }, T)).toEqual({ fromDate: '2026-09-10', toDate: '2026-09-12' })
    expect(windowRange('CUSTOM', { from: '2026-09-10', to: '2026-09-10' }, T)).toEqual({ fromDate: '2026-09-10', toDate: '2026-09-10' })
    expect(windowRange('CUSTOM', { from: '2026-09-12', to: '2026-09-10' }, T)).toBeNull()
    expect(windowRange('CUSTOM', { from: '2026-9-1', to: '2026-09-10' }, T)).toBeNull()
    expect(windowRange('CUSTOM', { from: '', to: '2026-09-10' }, T)).toBeNull()
  })
  it('standardMetricOfWindow：今明两日/整月为标准窗口，其余不判级', () => {
    expect(standardMetricOfWindow(T, '2026-09-16', T)).toBe('TODAY2_INTERVAL')
    expect(standardMetricOfWindow('2026-09-01', '2026-09-30', T)).toBe('MONTH_INTERVAL')
    expect(standardMetricOfWindow('2026-09-15', '2026-09-17', T)).toBeNull()
    expect(standardMetricOfWindow('2026-08-31', '2026-09-16', T)).toBeNull()
  })
})

describe('buildSimulateBody（三种形状的请求体，HM-07）', () => {
  const window = { fromDate: T, toDate: '2026-09-16' }
  it('FLAT 只带 kind，不带任何形状参数', () => {
    expect(buildSimulateBody({ window, quantityMwh: '2000', shape: { kind: 'FLAT' } })).toEqual({
      window,
      adjustments: [{ quantityMwh: '2000', shape: { kind: 'FLAT' } }],
    })
  })
  it('RECENT_ACTUAL_PROFILE：days 缺省 14、显式传入生效；stationId 未选不带', () => {
    expect(buildSimulateBody({ window, quantityMwh: '500', shape: { kind: 'RECENT_ACTUAL_PROFILE' } }).adjustments[0].shape).toEqual({ kind: 'RECENT_ACTUAL_PROFILE', days: 14 })
    expect(buildSimulateBody({ window, quantityMwh: '500', shape: { kind: 'RECENT_ACTUAL_PROFILE', days: 30 } }).adjustments[0].shape).toEqual({ kind: 'RECENT_ACTUAL_PROFILE', days: 30 })
    expect(buildSimulateBody({ window, quantityMwh: '500', shape: { kind: 'RECENT_ACTUAL_PROFILE', days: 30, stationId: 7 } }).adjustments[0].shape).toEqual({ kind: 'RECENT_ACTUAL_PROFILE', days: 30, stationId: 7 })
  })
  it('CONTRACT_CURVE 必须带 contractId', () => {
    expect(buildSimulateBody({ window, quantityMwh: '-100', shape: { kind: 'CONTRACT_CURVE', contractId: 201 } }).adjustments[0].shape).toEqual({ kind: 'CONTRACT_CURVE', contractId: 201 })
  })
})

describe('simulateFailureOf（422 按 details.field 定位）', () => {
  class HedgeApiErrorLike extends Error {
    status: number
    errorCode: string
    details: Record<string, unknown> | null
    constructor(status: number, errorCode: string, message: string, details: Record<string, unknown> | null = null) {
      super(message)
      this.status = status
      this.errorCode = errorCode
      this.details = details
    }
  }

  it('422 带 details.field 时文案含字段名与中文字段名', () => {
    const failure = simulateFailureOf(new HedgeApiErrorLike(422, 'VALIDATION_FAILED', '回看天数超出范围', { field: 'shape.days' }))
    expect(failure.field).toBe('shape.days')
    expect(failure.label).toBe('回看天数')
    expect(failure.text).toContain('shape.days')
    expect(failure.text).toContain('「回看天数」')
  })
  it('SIMULATION_EXCEEDS_LOCKED 保留错误码，可据此显示减仓提示', () => {
    const failure = simulateFailureOf(new HedgeApiErrorLike(422, 'SIMULATION_EXCEEDS_LOCKED', '减仓量超过该时段的中长期锁价电量', { field: 'quantityMwh' }))
    expect(failure.errorCode).toBe('SIMULATION_EXCEEDS_LOCKED')
    expect(failure.label).toBe('试算电量')
    expect(failure.text).toContain('quantityMwh')
  })
  it('非 HedgeApiError 的异常按网络失败兜底', () => {
    expect(simulateFailureOf(new Error('网络中断')).errorCode).toBe('NETWORK')
    expect(simulateFailureOf('boom').text).toBe('试算失败，可重试')
  })
})

describe('normalizeSimulationResult（防御归一，不造字段）', () => {
  const payload = {
    basis: 'simulation',
    fromDate: T,
    toDate: '2026-09-16',
    granularity: 'HOUR',
    before: {
      ratio: { coverage: { coveredCount: 1, totalCount: 2 }, withMechanism: { value: '0.6', status: 'OK' }, midlongOnly: { value: null, status: 'INCOMPLETE_COVERAGE' } },
      intervals: [{ start: `${T}T01:00:00+08:00`, covered: true, generationMwh: 50, midlongMwh: '20', mechanismMwh: '10' }],
    },
    intervals: [{ start: `${T}T01:00:00+08:00`, covered: true, generationMwh: '50', midlongMwh: '24', mechanismMwh: '10', exposure: { withMechanism: '16', midlongOnly: '26' } }],
    ratio: { coverage: { coveredCount: 2, totalCount: 2 }, withMechanism: { value: '0.68', status: 'OK' }, midlongOnly: { value: '0.64', status: 'OK' } },
    shapes: [{ index: 0, kind: 'RECENT_ACTUAL_PROFILE', label: '近 14 天实际出力形状', assumption: '假设', days: 14, weightedIntervalCount: 46, skippedIntervalCount: 2, skippedStarts: [`${T}T00:00:00+08:00`, `${T}T23:00:00+08:00`] }],
    note: '试算不落库',
  }

  it('完整响应逐字段归一（number 也转成十进制字符串）', () => {
    const result = normalizeSimulationResult(payload)!
    expect(result.fromDate).toBe(T)
    expect(result.before.intervals[0].generationMwh).toBe('50')
    expect(result.intervals[0].exposure).toEqual({ withMechanism: '16', midlongOnly: '26' })
    expect(result.shapes[0].skippedIntervalCount).toBe(2)
    expect(result.before.intervals[0].exposure).toBeNull() // before 不带敞口（正式敞口不由试算响应冒充）
  })
  it('缺 shapes / before / ratio 时如实降级，不造字段', () => {
    const result = normalizeSimulationResult({ fromDate: T, toDate: '2026-09-16', intervals: [] })!
    expect(result.shapes).toEqual([])
    expect(result.before.intervals).toEqual([])
    expect(result.before.ratio).toBeNull()
    expect(result.ratio).toBeNull()
    expect(result.note).toBeNull()
  })
  it('非对象返回 null（页面按失败处理）', () => {
    expect(normalizeSimulationResult(null)).toBeNull()
    expect(normalizeSimulationResult('oops')).toBeNull()
    expect(normalizeSimulationResult([1])).toBeNull()
  })
})

describe('方案对比预览（HB-05：纯函数、零请求）', () => {
  const ratio = (value: string | null, status = 'OK') => ({
    coverage: { coveredCount: 2, totalCount: 2 },
    withMechanism: { value, status },
    midlongOnly: { value, status },
  })

  it('预置方案三条、全部含机制依据与推断标注', () => {
    const schemes = presetSchemes()
    expect(schemes.map((s) => s.label)).toEqual(['保守', '均衡', '灵活'])
    expect(schemes.every((s) => s.basis === 'WITH_MECHANISM')).toBe(true)
    expect(schemes.every((s) => s.inferenceNote !== null)).toBe(true)
  })

  it('0.76 在月度指标下：保守欠保、均衡与灵活区间内（与 compareSchemes 手算对拍）', () => {
    const rows = compareSchemeRows(presetSchemes(), ratio('0.76'), 'MONTH_INTERVAL')
    expect(rows.map((r) => r.metrics.MONTH_INTERVAL?.level)).toEqual(['UNDER', 'WITHIN', 'WITHIN'])
  })

  it('比率不可计算时全部 NOT_ASSESSED 并带原因，不用默认安全色冒充', () => {
    const rows = compareSchemeRows(presetSchemes(), ratio(null, 'INCOMPLETE_COVERAGE'), 'MONTH_INTERVAL')
    expect(rows.every((r) => r.metrics.MONTH_INTERVAL?.level === 'NOT_ASSESSED')).toBe(true)
    expect(rows[0].metrics.MONTH_INTERVAL?.reason).toBe('INCOMPLETE_COVERAGE')
  })

  it('按方案判级依据挑口径：MIDLONG_ONLY 的方案用仅中长期比率', () => {
    const mixed = ratio('0.76')
    mixed.midlongOnly = { value: '1.2', status: 'OK' }
    const rows = compareSchemeRows([
      { key: 'midlong-only', label: '仅中长期方案', basis: 'MIDLONG_ONLY', tiers: { DAY_AHEAD: null, INTRA_MONTH: { lower: '0.55', upper: '0.85' }, FORWARD: null }, scenario: null, inferenceNote: null },
    ], mixed, 'MONTH_INTERVAL')
    expect(rows[0].metrics.MONTH_INTERVAL?.level).toBe('OVER')
  })

  it('非标准窗口（metric=null）不判级：metrics 为空对象', () => {
    const rows = compareSchemeRows(presetSchemes(), ratio('0.76'), null)
    expect(rows.every((r) => Object.keys(r.metrics).length === 0)).toBe(true)
  })

  it('自定义方案：合法草稿参与判级，非法草稿按字段报错', () => {
    const draft: TierDraft = {
      DAY_AHEAD: { lower: '75', upper: '100' },
      INTRA_MONTH: { lower: '70', upper: '95' },
      FORWARD: { lower: '60', upper: '85' },
    }
    const ok = customSchemeFrom(draft, 'WITH_MECHANISM')
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.scheme.tiers.INTRA_MONTH).toEqual({ lower: '0.7', upper: '0.95' })
      const rows = compareSchemeRows([ok.scheme], ratio('0.5'), 'MONTH_INTERVAL')
      expect(rows[0].metrics.MONTH_INTERVAL?.level).toBe('UNDER')
    }
    const bad = customSchemeFrom({ ...draft, INTRA_MONTH: { lower: '70', upper: '60' } }, 'WITH_MECHANISM')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.field).toContain('INTRA_MONTH')
  })
})
