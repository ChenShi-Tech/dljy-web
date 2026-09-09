import { describe, it, expect } from 'vitest'
import type { DeclarationOrder } from '@/services/declarations'
import type { SettlementReviewResult } from '@/services/quant/quantClient'
import { buildReviewEvidence, evidencePayload, evidenceReport, executionEvidence } from './reviewEvidence'
const scope = { company: 'a', region: 'yunnan', day: '2026-06-06', objectKey: 'order:one', objectLabel: '当天申报' }
function order(): DeclarationOrder { return { id: 'one', companyId: 'a', region: 'yunnan', targetDate: scope.day, mode: 'REHEARSAL', energyCurveMwh96: Array(96).fill(10), preflight: { forecast: { curveMwh96: Array(96).fill(8), writtenAt: '2026-06-05T08:00:00Z' } }, createdAt: '2026-06-05T08:00:00Z', riskCheck: { checks: [{ checkId: 'exposure', status: 'UNAVAILABLE', detail: 'secret_table.internal_field' }] } } as unknown as DeclarationOrder }
describe('同对象复盘取材', () => {
  it('阻断跨公司、跨日、不同单据资料混用', () => {
    for (const delta of [{ companyId: 'b' }, { targetDate: '2026-06-07' }, { region: 'shanxi' }, { id: 'two' }]) expect(() => buildReviewEvidence({ ...scope, order: { ...order(), ...delta } })).toThrow('范围不一致')
  })
  it('只比较本单留存预测，缺出清不补零，忽略公司结算', () => {
    const snapshot = buildReviewEvidence({ ...scope, order: order(), settlement: { summary: { totalFee: 999999 } } as SettlementReviewResult })
    expect(snapshot.intervals[0]).toMatchObject({ forecast: 8, declared: 10, adjustment: 2, cleared: null, difference: null })
    expect(snapshot.simulated).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain('999999')
    expect(JSON.stringify(evidencePayload(snapshot))).not.toContain('secret_table')
    expect(evidenceReport(snapshot, 'object')).toContain('模拟演练，不计入真实绩效')
  })
  it('生成后原始曲线更新不修改分析副本', () => {
    const source = order(), snapshot = buildReviewEvidence({ ...scope, order: source })
    source.energyCurveMwh96[0] = 999
    expect(snapshot.intervals[0].declared).toBe(10)
  })
  it('短预测曲线不用于差值，风险不足与无回执不写成已执行', () => {
    const source = order(); source.preflight!.forecast!.curveMwh96 = [8]
    const snapshot = buildReviewEvidence({ ...scope, order: source })
    expect(snapshot.intervals[0].adjustment).toBeNull()
    expect(executionEvidence(source).find(e => e.id === 'receipt')?.text).toBe('未留存回执。')
    expect(executionEvidence(source).find(e => e.id === 'risk')?.text).toContain('资料不足')
  })
  it('平台模拟性质传入报告，零电量保留', () => {
    const snapshot = buildReviewEvidence({ ...scope, objectKey: '', simulated: true, points: [{ slot: 0, label: '00:00', declared: 0, actual: null, cleared: null, delta: null, daPrice: -1, rtPrice: 0 }] })
    expect(snapshot.simulated).toBe(true); expect(snapshot.intervals[0]).toMatchObject({ declared: 0, rtPrice: 0 })
  })
})
