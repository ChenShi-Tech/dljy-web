// 套保维护入口纯函数单测（build-midlong-spot-hedging 任务 8.6，HW-10/HB-03/HG-07/HC-03；ChenShi-Tech/dljy#3423）。
//
// 守的不变量：月份范围默认「北京时间当月起 3 个月」且随日期变化（不写死）；百分数 ↔ 小数字符串换算不经浮点；
// 区间校验失败的 field 与后端 details.field 同形；比例高于上一年度且未填说明时判定为须拦截；失败提示区分 403/409/422。
// 坏掉的症状：月份又写死成固定三个月；85% 被提交成 0.8500000001；下限≥上限的方案被放行；比例上调不填说明也能确认；
// 409 只显示错误码、用户不知道要刷新。
import { describe, expect, it } from 'vitest'
import {
  activationToken, addMonths, beijingInputToInstant, buildSchemeTiers, defaultMonthRange, effectivePeriodError, emptyTierDraft,
  fieldLabel, formatBeijingTime, maintenanceFailureOf, mechanismRatioFromPercent, monthRangeError, monthsBetween,
  percentToRatio, previousYearRatio, ratioIncreaseNeedsNote, ratioToPercent, sameDecimal, tierDraftFrom,
} from './hedgeMaintenanceModel'

class FakeHedgeError extends Error {
  constructor(public status: number, public errorCode: string, message: string, public details: Record<string, unknown> | null = null) {
    super(message)
  }
}

describe('月份范围（HG-07/HB-07：不写死）', () => {
  it('默认取北京时间当月起 3 个月，跨年进位', () => {
    expect(defaultMonthRange('2026-09-29')).toEqual({ fromMonth: '2026-09', toMonth: '2026-11' })
    expect(defaultMonthRange('2026-11-30')).toEqual({ fromMonth: '2026-11', toMonth: '2027-01' })
    expect(defaultMonthRange('2027-05-01')).toEqual({ fromMonth: '2027-05', toMonth: '2027-07' })
  })

  it('addMonths / monthsBetween：正反向与倒置', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(monthsBetween('2026-03', '2026-01')).toEqual([])
    expect(monthsBetween('2026-13', '2027-01')).toEqual([])
  })

  it('范围校验：非法、倒置、超过 12 个月都给出原因', () => {
    expect(monthRangeError('2026-10', '2026-12')).toBeNull()
    expect(monthRangeError('', '2026-12')).toContain('起止月份')
    expect(monthRangeError('2026-12', '2026-10')).toContain('不能晚于')
    expect(monthRangeError('2026-01', '2027-01')).toContain('12 个月')
  })
})

describe('百分数 ↔ 小数字符串', () => {
  it('小数点左移两位，不经浮点', () => {
    expect(percentToRatio('85')).toBe('0.85')
    expect(percentToRatio('5')).toBe('0.05')
    expect(percentToRatio('100')).toBe('1')
    expect(percentToRatio('85.5')).toBe('0.855')
    expect(percentToRatio('200')).toBe('2')
    expect(percentToRatio('0')).toBe('0')
    expect(percentToRatio('007')).toBe('0.07')
    expect(percentToRatio('  ')).toBeNull()
    expect(percentToRatio('-5')).toBeUndefined()
    expect(percentToRatio('abc')).toBeUndefined()
    expect(percentToRatio('1e2')).toBeUndefined()
  })

  it('小数点右移两位，null 与非数字为空串', () => {
    expect(ratioToPercent('0.85')).toBe('85')
    expect(ratioToPercent('1.05')).toBe('105')
    expect(ratioToPercent('0.855')).toBe('85.5')
    expect(ratioToPercent('2')).toBe('200')
    expect(ratioToPercent(null)).toBe('')
    expect(ratioToPercent('NaN')).toBe('')
  })

  it('sameDecimal：数值相等即相等，非数字按原文', () => {
    expect(sameDecimal('1500', '1500.0')).toBe(true)
    expect(sameDecimal('1500', '1300')).toBe(false)
    expect(sameDecimal('abc', 'abc')).toBe(true)
    expect(sameDecimal('', null)).toBe(true)
  })
})

describe('自定义方案校验（HB-03）', () => {
  it('合法草稿换成小数字符串，未填一侧为 null', () => {
    const draft = emptyTierDraft()
    draft.DAY_AHEAD = { lower: '70', upper: '' }
    draft.INTRA_MONTH = { lower: '80', upper: '100' }
    const built = buildSchemeTiers(draft)
    expect(built).toEqual({
      ok: true,
      tiers: { DAY_AHEAD: { lower: '0.7', upper: null }, INTRA_MONTH: { lower: '0.8', upper: '1' }, FORWARD: { lower: null, upper: null } },
    })
  })

  it('下限不小于上限：定位到 tiers.<档>.lower，文案为「月内档下限必须小于上限」', () => {
    const draft = emptyTierDraft()
    draft.INTRA_MONTH = { lower: '90', upper: '80' }
    expect(buildSchemeTiers(draft)).toEqual({ ok: false, field: 'tiers.INTRA_MONTH.lower', message: '月内档下限必须小于上限' })
  })

  it('越界与非数字都定位到具体输入框', () => {
    const over = emptyTierDraft()
    over.FORWARD = { lower: '', upper: '250' }
    expect(buildSchemeTiers(over)).toMatchObject({ ok: false, field: 'tiers.FORWARD.upper', message: '远期档上限必须在 0 到 200% 之间' })
    const bad = emptyTierDraft()
    bad.DAY_AHEAD = { lower: 'x', upper: '' }
    expect(buildSchemeTiers(bad)).toMatchObject({ ok: false, field: 'tiers.DAY_AHEAD.lower' })
    // 下限越界且大于上限：先报越界（与后端逐侧检查的顺序一致）。
    const both = emptyTierDraft()
    both.DAY_AHEAD = { lower: '250', upper: '90' }
    expect(buildSchemeTiers(both)).toMatchObject({ ok: false, field: 'tiers.DAY_AHEAD.lower', message: '日前档下限必须在 0 到 200% 之间' })
  })

  it('一个界限都没设：拒绝', () => {
    expect(buildSchemeTiers(emptyTierDraft())).toMatchObject({ ok: false, field: null })
  })

  it('已有档位 → 草稿（百分数）', () => {
    expect(tierDraftFrom({ DAY_AHEAD: { lower: '0.85', upper: '1.05' } }).DAY_AHEAD).toEqual({ lower: '85', upper: '105' })
    expect(tierDraftFrom(null).FORWARD).toEqual({ lower: '', upper: '' })
  })
})

describe('机制参数（HC-03/D4）', () => {
  const rows = [
    { periodKey: 'p2025', stationId: 1, status: 'RETIRED', ratio: '0.5', effectiveFrom: '2025-06-01' },
    { periodKey: 'p2024', stationId: 1, status: 'CONFIRMED', ratio: '0.6', effectiveFrom: '2024-06-01' },
    { periodKey: 'other', stationId: 2, status: 'CONFIRMED', ratio: '0.2', effectiveFrom: '2025-06-01' },
    { periodKey: 'pending', stationId: 1, status: 'PENDING', ratio: '0.1', effectiveFrom: '2025-01-01' },
  ]
  const target = { periodKey: 'p2026', stationId: 1, status: 'PENDING', ratio: '0.55', effectiveFrom: null }

  it('上一年度 = 同场站已确认（含确认后结束）且起始不晚于本期的最近一期；待确认与别的场站不算', () => {
    expect(previousYearRatio(rows, target, '2026-06-01')).toBe('0.5')
    expect(previousYearRatio(rows, target, '2025-01-01')).toBe('0.6')
    expect(previousYearRatio(rows, target, '2024-01-01')).toBeNull()
    expect(previousYearRatio(rows, target, '')).toBeNull()
  })

  it('比例上调且未填说明才须拦截；填了说明或未上调都放行', () => {
    expect(ratioIncreaseNeedsNote(rows, target, '2026-06-01', '')).toEqual({ previous: '0.5' })
    expect(ratioIncreaseNeedsNote(rows, target, '2026-06-01', '  ')).toEqual({ previous: '0.5' })
    expect(ratioIncreaseNeedsNote(rows, target, '2026-06-01', '并网分档调整')).toBeNull()
    expect(ratioIncreaseNeedsNote(rows, { ...target, ratio: '0.5' }, '2026-06-01', '')).toBeNull()
    expect(ratioIncreaseNeedsNote(rows, target, '2025-01-01', '')).toBeNull()
  })

  it('比例按百分数录入：0—100、两位小数', () => {
    expect(mechanismRatioFromPercent('55')).toEqual({ ok: true, ratio: '0.55' })
    expect(mechanismRatioFromPercent('45.25')).toEqual({ ok: true, ratio: '0.4525' })
    expect(mechanismRatioFromPercent('')).toMatchObject({ ok: false, field: 'ratio' })
    expect(mechanismRatioFromPercent('101')).toMatchObject({ ok: false, field: 'ratio' })
    expect(mechanismRatioFromPercent('45.255')).toMatchObject({ ok: false, field: 'ratio' })
  })

  it('生效起止校验', () => {
    expect(effectivePeriodError('', '', { fromRequired: true })).toEqual({ field: 'effectiveFrom', message: '请填写生效起始日' })
    expect(effectivePeriodError('', '')).toBeNull()
    expect(effectivePeriodError('2026-02-30', '')).toMatchObject({ field: 'effectiveFrom' })
    expect(effectivePeriodError('2026-06-01', '2026-05-31')).toMatchObject({ field: 'effectiveTo' })
    expect(effectivePeriodError('2026-06-01', '2037-05-31')).toBeNull()
  })
})

describe('切换生效的乐观令牌（HB-04）', () => {
  it('取未关闭生效行的 activationId，而不是 GET 返回的 rowVersion 列', () => {
    const current = { activationId: 41, effectiveTo: null, rowVersion: 1 }
    expect(activationToken({ current, history: [current, { activationId: 40, effectiveTo: '2027-04-01T00:00:00Z', rowVersion: 1 }] })).toBe(41)
  })

  it('预约切换的过渡期：当前生效为空，令牌取尚未到期的新行', () => {
    const scheduled = { activationId: 45, effectiveTo: null }
    expect(activationToken({ current: null, history: [scheduled, { activationId: 44, effectiveTo: '2027-05-15T00:00:00Z' }] })).toBe(45)
  })

  it('从未配置：不带令牌', () => {
    expect(activationToken({ current: null, history: [] })).toBeUndefined()
    expect(activationToken(null)).toBeUndefined()
  })
})

describe('时刻', () => {
  it('预约生效时刻按北京时间带 +08:00；空为 null、格式错为 undefined', () => {
    expect(beijingInputToInstant('2026-10-01T08:30')).toBe('2026-10-01T08:30:00+08:00')
    expect(beijingInputToInstant('')).toBeNull()
    expect(beijingInputToInstant('2026-10-01')).toBeUndefined()
    expect(beijingInputToInstant('2026-10-01T25:00')).toBeUndefined()
  })

  it('ISO 时刻显示为北京时间', () => {
    expect(formatBeijingTime('2026-09-29T02:00:00.000Z')).toBe('2026-09-29 10:00')
    expect(formatBeijingTime(null)).toBe('—')
  })
})

describe('失败映射（HW-10）', () => {
  it('422 带 details.field：提示里写出字段名与中文名', () => {
    const failure = maintenanceFailureOf(new FakeHedgeError(422, 'BAND_TIER_INVALID', '远期档上限越界', { field: 'tiers.FORWARD.upper' }))
    expect(failure).toMatchObject({ status: 422, field: 'tiers.FORWARD.upper', index: null })
    expect(failure.text).toBe('422：远期档上限越界（字段 tiers.FORWARD.upper「远期档上限」）')
    expect(fieldLabel('overrideNote')).toBe('比例上调说明')
    expect(fieldLabel('unknownField')).toBeNull()
  })

  it('409 提示刷新后重试并带出批量行号；403 说明所需权限', () => {
    const conflict = maintenanceFailureOf(new FakeHedgeError(409, 'VERSION_CONFLICT', '基准已被他人更新', { field: 'items.expectedVersionNo', index: 2 }))
    expect(conflict.index).toBe(2)
    expect(conflict.text).toContain('409')
    expect(conflict.text).toContain('刷新后核对再重试')
    const forbidden = maintenanceFailureOf(new FakeHedgeError(403, 'FORBIDDEN', '当前角色无公司写权限'))
    expect(forbidden.text).toContain('当前角色无公司写权限')
    expect(forbidden.text).toContain('ADMIN / 本公司 BOSS')
  })

  it('非套保接口错误（网络/超时）不伪装成业务错误码', () => {
    expect(maintenanceFailureOf(new Error('timeout'))).toMatchObject({ status: 0, errorCode: 'NETWORK', text: '操作失败：timeout' })
    expect(maintenanceFailureOf('boom')).toMatchObject({ status: 0, text: '操作失败：请求失败' })
  })
})
