// @vitest-environment happy-dom
//
// 「当月/后续」页签纯函数测试（HW-03/HW-04/HB-07/HM-02/HM-06；ChenShi-Tech/dljy#3421）。
// 守什么：未知显示「未知」而非 0、套保率按 status 给原因、核定上限超出/未登记文案、按日序列未知日断开。
// 坏掉的症状：页面上出现 0 冒充未知、FORBIDDEN 被当普通不可计算、超出上限不显眼、折线跨未知日连线。
// 环境说明：monthsModel 经 hedgeMonthsApi 转发 shared 标签，后者 import 链顶层读 window.localStorage
// （regionContext），node 环境起不来——靠此 pragma 切 happy-dom（useTheme.spec 同一做法）。
import { describe, expect, it } from 'vitest'
import type { HedgeMonthCapRow } from '@/services/hedge/hedgeMonthsApi'
import {
  assessmentText, assessmentTierText, capRowView, consistencyView, daysChartSeries, isNegativeDecimal,
  mwhText, percentOf, periodLabel, ratioText, sumRowMwh, uncoveredReasonText,
} from './monthsModel'

describe('monthsModel 显示函数', () => {
  it('mwhText：未知为「未知」，有值原样（不补 0）', () => {
    expect(mwhText(null)).toBe('未知')
    expect(mwhText(undefined)).toBe('未知')
    expect(mwhText('1234.5')).toBe('1234.5')
    expect(mwhText('0')).toBe('0')
  })

  it('ratioText：有值换百分数；无值按 status 给中文原因，不出现 0（HM-02/HW-04）', () => {
    expect(ratioText({ value: '0.85', status: 'OK' })).toBe('85%')
    expect(ratioText({ value: '1', status: 'OK' })).toBe('100%')
    expect(ratioText({ value: '0.855', status: 'OK' })).toBe('85.5%')
    expect(ratioText({ value: null, status: 'NOT_COMPUTABLE' })).toBe('不可计算')
    expect(ratioText({ value: null, status: 'INCOMPLETE_COVERAGE' })).toContain('部分场站缺基准')
    expect(ratioText({ value: null, status: 'MECHANISM_INCOMPLETE' })).toContain('机制电量未知')
    const forbidden = ratioText({ value: null, status: 'FORBIDDEN' })
    expect(forbidden).toContain('无权限查看中长期持仓')
    expect(forbidden).not.toContain('0')
  })

  it('percentOf：十进制字符串换百分数不经浮点', () => {
    expect(percentOf('0.85')).toBe('85%')
    expect(percentOf('1')).toBe('100%')
    expect(percentOf('0.005')).toBe('0.5%')
    expect(percentOf('0.085')).toBe('8.5%')
  })

  it('assessmentText：未评估必须带原因（HM-04）；已判级给 level 标签', () => {
    expect(assessmentText({ metric: 'MONTH_BASELINE', tier: 'INTRA_MONTH', level: 'NOT_ASSESSED', reason: 'NO_ACTIVE_SCHEME', hints: [], basis: 'WITH_MECHANISM' }))
      .toBe('未评估：套保区间未配置')
    expect(assessmentText({ metric: null, tier: null, level: 'NOT_ASSESSED', reason: 'NON_STANDARD_WINDOW', hints: [], basis: null }))
      .toBe('未评估：非标准窗口')
    expect(assessmentText({ metric: 'FORWARD_BASELINE', tier: 'FORWARD', level: 'WITHIN', reason: null, hints: [], basis: 'WITH_MECHANISM' }))
      .toBe('区间内')
    expect(assessmentText({ metric: 'MONTH_INTERVAL', tier: 'INTRA_MONTH', level: 'OVER', reason: null, hints: [], basis: 'WITH_MECHANISM' }))
      .toBe('过保')
  })

  it('assessmentTierText / periodLabel：期限档与月份期限中文（HB-02）', () => {
    expect(assessmentTierText({ metric: 'MONTH_INTERVAL', tier: 'INTRA_MONTH', level: 'WITHIN', reason: null, hints: [], basis: 'WITH_MECHANISM' })).toBe('月内档')
    expect(assessmentTierText({ metric: null, tier: null, level: 'NOT_ASSESSED', reason: null, hints: [], basis: null })).toBeNull()
    expect(periodLabel('CURRENT')).toBe('当月')
    expect(periodLabel('FORWARD')).toBe('后续月份')
    expect(periodLabel('PAST')).toBe('已过去月份')
  })

  it('uncoveredReasonText：已知原因给标签，未知 code 原样，null 为「未知」', () => {
    expect(uncoveredReasonText('ACTUAL_MISSING')).toBe('实际缺失')
    expect(uncoveredReasonText('FORECAST_NOT_ARRIVED')).toBe('预测未到达')
    expect(uncoveredReasonText('SOMETHING_NEW')).toBe('SOMETHING_NEW')
    expect(uncoveredReasonText(null)).toBe('未知')
  })

  it('consistencyView：一致/不一致/含未知三态（HM-06），不一致必须带差值', () => {
    expect(consistencyView({ ok: true, partial: false })).toEqual({ text: '明细之和与合计一致', tone: 'ok' })
    const bad = consistencyView({ ok: false, partial: false, diff: '0.5' })
    expect(bad?.tone).toBe('danger')
    expect(bad?.text).toContain('0.5')
    expect(consistencyView(null)).toBeNull()
    const partial = consistencyView({ ok: null, partial: true, note: '无权限查看中长期持仓，未做守恒校验' })
    expect(partial?.tone).toBe('partial')
    expect(partial?.text).toContain('未做守恒校验')
  })

  it('sumRowMwh：十进制求和（HM-06 数值对照用），空为 0', () => {
    expect(sumRowMwh([{ quantityMwh: '1.1' }, { quantityMwh: '2.2' }, { quantityMwh: '0.3' }])).toBe('3.6')
    expect(sumRowMwh([])).toBe('0')
  })

  it('isNegativeDecimal：负值为真，零与正值为假，null 为假', () => {
    expect(isNegativeDecimal('-0.001')).toBe(true)
    expect(isNegativeDecimal('-5')).toBe(true)
    expect(isNegativeDecimal('0')).toBe(false)
    expect(isNegativeDecimal('0.00')).toBe(false)
    expect(isNegativeDecimal('12.5')).toBe(false)
    expect(isNegativeDecimal(null)).toBe(false)
  })

  describe('capRowView（HB-07）', () => {
    const base = { sourceNote: null } as const

    it('未登记：显示「核定上限未登记」，不算 0', () => {
      const view = capRowView({ subjectId: 3, status: 'NOT_REGISTERED', capMwh: null, lockedMwh: '100', remainingMwh: null, exceeded: null, ...base, note: null } as HedgeMonthCapRow)
      expect(view.statusText).toBe('核定上限未登记')
      expect(view.capMwh).toBe('—')
      expect(view.tone).toBe('muted')
    })

    it('超出：exceeded 或剩余为负都显示「超出核定上限」且状态为 danger', () => {
      const byFlag = capRowView({ subjectId: 1, status: 'REGISTERED', capMwh: '100', lockedMwh: '120', remainingMwh: null, exceeded: true, ...base, note: null } as HedgeMonthCapRow)
      expect(byFlag.statusText).toBe('超出核定上限')
      expect(byFlag.tone).toBe('danger')
      const byNegative = capRowView({ subjectId: 2, status: 'REGISTERED', capMwh: '100', lockedMwh: '150', remainingMwh: '-50', exceeded: false, ...base, note: null } as HedgeMonthCapRow)
      expect(byNegative.statusText).toBe('超出核定上限')
      expect(byNegative.tone).toBe('danger')
      expect(byNegative.exceeded).toBe(true)
    })

    it('已登记且未超：显示已登记与剩余可签', () => {
      const view = capRowView({ subjectId: 4, status: 'REGISTERED', capMwh: '200', lockedMwh: '150', remainingMwh: '50', exceeded: false, ...base, note: null } as HedgeMonthCapRow)
      expect(view.statusText).toBe('已登记')
      expect(view.remainingMwh).toBe('50')
      expect(view.tone).toBe('ok')
    })

    it('认知时点后被改：显示无法回放标签（HW-05）', () => {
      const view = capRowView({ subjectId: 5, status: 'MODIFIED_AFTER_AS_OF', capMwh: null, lockedMwh: '10', remainingMwh: null, exceeded: null, ...base, note: null } as HedgeMonthCapRow)
      expect(view.statusText).toContain('无法回放')
      expect(view.tone).toBe('warn')
    })
  })

  it('daysChartSeries：实际/预测分流、未覆盖日两侧皆 null、锁价 null 断开（HW-03/D8）', () => {
    const series = daysChartSeries([
      { date: '2026-09-01', lockedDecomposedMwh: '100', generation: { value: '300', source: 'ACTUAL', uncoveredReason: null, unknownStationIds: [] } },
      { date: '2026-09-02', lockedDecomposedMwh: null, generation: { value: '310', source: 'FORECAST', uncoveredReason: null, unknownStationIds: [] } },
      { date: '2026-09-03', lockedDecomposedMwh: '110', generation: { value: null, source: 'UNCOVERED', uncoveredReason: 'FORECAST_NOT_ARRIVED', unknownStationIds: [] } },
    ])
    expect(series.dates).toEqual(['01', '02', '03'])
    expect(series.actualGen).toEqual([300, null, null])
    expect(series.forecastGen).toEqual([null, 310, null])
    expect(series.locked).toEqual([100, null, 110])
  })
})
