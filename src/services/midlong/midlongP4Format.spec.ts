// 中长期售电 P4 展示口径（dljy#3014，MT-02..06 / MA-01..05）。
// 守什么：登记事实不称「平台已受理」；待核对/未知不显示 0；减少差量带负号原样展示；
//        可调余额逐月「请求/可调」、并发同基线引导重对基线；独立价款单列不进均价；禁用词不出现。
// 坏掉的症状：预成交被展示成已入账；超量减少只报一条笼统错误；转让价款混进售电均价；方向被从「买入」字样猜出来。
import { describe, expect, it } from 'vitest'
import {
  adjustmentFailureText, adjustmentStatusTag, directionLabel, executionFailureText, executionResultTag,
  impactMonthLine, linkKindText, pendingReviewText, priceLines, signedDeltaLabel,
} from './midlongP4Format'
import { ADJUSTMENT_TYPE_LABELS, ADJUSTMENT_NOTICES, EXECUTION_NOTICES, FORBIDDEN_ADJUSTMENT_TERMS, FORBIDDEN_EXECUTION_TERMS } from './midlongP4Types'

describe('执行确认展示口径', () => {
  it('结果状态标签：预成交/确认成交/外部撤销三态可区分，未知状态不编造', () => {
    expect(executionResultTag('PRE_CLEARED')).toMatchObject({ label: '预成交', type: 'warning' })
    expect(executionResultTag('CLEARED')).toMatchObject({ label: '确认成交', type: 'success' })
    expect(executionResultTag('WITHDRAWN').label).toContain('已冲正')
    expect(executionResultTag(null).label).toBe('未知')
  })

  it('固定文案守住占用口径红线（与后端 rules 测试同锚点）', () => {
    // FORBIDDEN_EXECUTION_TERMS 禁的是「把负占用当事实陈述」；固定提示里的否定用法（不产生负占用）是允许的，
    // 因此按后端口径锚定关键句，而不是对共享文案做子串排除（否则「不产生负占用」会被误伤）。
    expect(FORBIDDEN_EXECUTION_TERMS).toContain('负占用')
    expect(EXECUTION_NOTICES.revokeReversal).toContain('不因冲正')
    expect(EXECUTION_NOTICES.preClearedNotFormal).toContain('不增加正式持仓')
    expect(EXECUTION_NOTICES.occupationFloor).toContain('下限为 0')
    expect(EXECUTION_NOTICES.duplicateReplay).toContain('不重复发生')
    expect(EXECUTION_NOTICES.linkNoDoubleCount).toContain('不新增同一义务')
  })

  it('待核对展示来源产品原文；未关联/关联不双计文本可区分', () => {
    expect(pendingReviewText('月内合约转让-X99')).toBe('待核对（来源产品原文：月内合约转让-X99）')
    expect(pendingReviewText(null)).toBe('待核对')
    expect(linkKindText('EXISTING_LINKED')).toContain('持仓不双计')
    expect(linkKindText(null)).toBe('未关联')
  })

  it('主体不一致：提示归属核对并给出候选合同，不共享成交或持仓', () => {
    const text = executionFailureText('SUBJECT_MISMATCH', '交易主体不一致', { reason: 'SUBJECT_MISMATCH', contractIds: [7, 9] })
    expect(text).toContain('拒绝自动关联')
    expect(text).toContain('7、9')
    expect(text).toContain('不共享成交或持仓')
  })

  it('同号不同内容：引导走修订版本而不是重复入账', () => {
    const text = executionFailureText('DUPLICATE_CONFIRMATION_CONTENT', '同号不同内容', { confirmationId: 12, currentRevisionNo: 3 })
    expect(text).toContain('修订版本')
    expect(text).toContain('#12')
    expect(text).toContain('v3')
  })

  it('已释放占用：不再扣减的固定口径', () => {
    expect(executionFailureText('OCCUPATION_ALREADY_RELEASED', 'x', { months: ['2026-10'] })).toContain('不得再次扣减')
  })

  it('缺失依据列出缺什么；其余错误回落服务端消息', () => {
    expect(executionFailureText('INCOMPLETE_BASIS', 'x', { missing: ['确认单依据文件'] })).toContain('确认单依据文件')
    expect(executionFailureText('OTHER', '服务端原文', null)).toBe('服务端原文')
  })
})

describe('合同调整展示口径', () => {
  it('状态与方向：待核对态明确「方向未确认」；文案不出现禁用词', () => {
    expect(adjustmentStatusTag('PENDING_VERIFICATION').label).toContain('待核对')
    expect(adjustmentStatusTag('EFFECTIVE')).toMatchObject({ label: '已生效', type: 'success' })
    expect(directionLabel(null)).toContain('方向未确认')
    expect(directionLabel('OBLIGATION_DECREASE')).toBe('我方义务减少')
    const all = [...Object.values(ADJUSTMENT_NOTICES), ...Object.values(ADJUSTMENT_TYPE_LABELS)] as string[]
    for (const text of all) for (const term of FORBIDDEN_ADJUSTMENT_TERMS) expect(text).not.toContain(term)
  })

  it('差量带符号：减少为负、增加为正、未知显示未知', () => {
    expect(signedDeltaLabel('-200')).toBe('-200 MWh')
    expect(signedDeltaLabel('200')).toBe('+200 MWh')
    expect(signedDeltaLabel(null)).toBe('未知')
  })

  it('独立价款单列：转让价款/补偿/手续费各自一行，不与售电价合并', () => {
    const lines = priceLines({
      transferPrice: { amount: '50000', currency: 'CNY', taxBasis: 'TAX_INCLUDED', note: null },
      compensation: { amount: '3000', currency: 'CNY', taxBasis: 'UNKNOWN', note: '违约补偿' },
    })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('转让价款：50,000 CNY（含税）')
    expect(lines[1]).toContain('补偿价款：3,000 CNY（含税口径未知 · 违约补偿）')
    expect(priceLines(null)).toEqual([])
  })

  it('逐月对比：before → after（方向未核对时 after 显示待核对），delta 带符号', () => {
    expect(impactMonthLine({ deliveryMonth: '2026-10', before: '1000', after: '800', delta: '-200' })).toBe('2026-10：1,000 → 800（-200 MWh）')
    expect(impactMonthLine({ deliveryMonth: '2026-11', before: '500', after: null, delta: null })).toContain('待核对（方向未确认）')
  })

  it('超量减少：逐月「请求 X / 可调 Y」并附固定口径', () => {
    const text = adjustmentFailureText('ADJUSTABLE_BALANCE_EXCEEDED', '超量', {
      months: [
        { deliveryMonth: '2026-10', requested: '120', adjustable: '100' },
        { deliveryMonth: '2026-11', requested: '50', adjustable: '40' },
      ],
    })
    expect(text).toContain('2026-10 请求 120 / 可调 100')
    expect(text).toContain('2026-11 请求 50 / 可调 40')
    expect(text).toContain('不得超过该片段当前有效义务')
  })

  it('并发同基线：提示基线已移动并引导修订重对基线', () => {
    const text = adjustmentFailureText('VERSION_CONFLICT', '版本冲突', { reason: 'BASE_REVISION_MOVED', baseRevisionNo: 3, currentRevisionNo: 5 })
    expect(text).toContain('已被他人变更')
    expect(text).toContain('v5')
    expect(text).toContain('重新对准最新基线')
  })

  it('方向未核验阻止生效；更正通道收到业务变更引导到调整入口', () => {
    expect(adjustmentFailureText('INCOMPLETE_BASIS', 'x', { pendingReason: 'NO_DIRECTION' })).toContain('方向')
    expect(adjustmentFailureText('ADJUSTMENT_CHANNEL_REQUIRED', 'x', null)).toContain('合同调整')
    expect(adjustmentFailureText('BUSINESS_KEY_CONFLICT', 'x', null)).toContain('修订版本')
  })
})
