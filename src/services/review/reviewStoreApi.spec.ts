// 复盘事件库/改进措施数据面纯逻辑测试（#2046/#2047/#2049 服务端接线）
import { describe, expect, it } from 'vitest'
import {
  broughtActionsViolations,
  classifyStoreResponse,
  coerceImprovementAction,
  coerceRiskEvent,
  extractRows,
  isOpenForCarry
} from './reviewStoreApi'

describe('coerceRiskEvent（行归一）', () => {
  it('camelCase/snake_case 双容忍，id 数字转 string', () => {
    const a = coerceRiskEvent({ id: 7, eventTime: '2026-08-20T09:00:00Z', eventType: 'price_anomaly', riskLevel: 'high', impactYuan: 1200, nearMiss: false })
    expect(a).toMatchObject({ id: '7', eventType: 'price_anomaly', riskLevel: 'high', impactYuan: 1200, nearMiss: false })
    const b = coerceRiskEvent({ id: '8', event_time: '2026-08-20T09:00:00Z', event_type: 'near_miss', near_miss: true, impact_yuan: 999 })
    expect(b).toMatchObject({ id: '8', eventType: 'near_miss', nearMiss: true })
  })

  it('near_miss 红线：impactYuan/impactCaliber 恒 null（服务端拒了前端再压一道）', () => {
    const ev = coerceRiskEvent({ id: 1, eventTime: 't', eventType: 'x', nearMiss: true, impactYuan: 999, impactCaliber: 'self-computed' })
    expect(ev?.impactYuan).toBeNull()
    expect(ev?.impactCaliber).toBeNull()
  })

  it('缺 id/eventTime/eventType → null（宁降级不误读）', () => {
    expect(coerceRiskEvent(null)).toBeNull()
    expect(coerceRiskEvent({ id: 1, eventType: 'x' })).toBeNull()
    expect(coerceRiskEvent({ eventTime: 't', eventType: 'x' })).toBeNull()
  })
})

describe('coerceImprovementAction / isOpenForCarry', () => {
  it('status 四态外拒收', () => {
    expect(coerceImprovementAction({ id: 1, action: 'a', status: 'done' })).toMatchObject({ status: 'done' })
    expect(coerceImprovementAction({ id: 1, action: 'a', status: 'weird' })).toBeNull()
  })

  it('未闭环=open+carried_over（纪要回查带入源）', () => {
    const mk = (status: string) => coerceImprovementAction({ id: status, action: 'a', status })!
    expect(isOpenForCarry(mk('open'))).toBe(true)
    expect(isOpenForCarry(mk('carried_over'))).toBe(true)
    expect(isOpenForCarry(mk('done'))).toBe(false)
    expect(isOpenForCarry(mk('dropped'))).toBe(false)
  })
})

describe('classifyStoreResponse / extractRows（探针降级口径）', () => {
  it('404/405/HTML 兜底 → endpoint-absent；401/403 → unauthorized；5xx → unreachable', () => {
    expect(classifyStoreResponse(404, null)).toEqual({ available: false, reason: 'endpoint-absent' })
    expect(classifyStoreResponse(405, null)).toEqual({ available: false, reason: 'endpoint-absent' })
    expect(classifyStoreResponse(200, '<html>')).toEqual({ available: false, reason: 'endpoint-absent' })
    expect(classifyStoreResponse(401, null)).toEqual({ available: false, reason: 'unauthorized' })
    expect(classifyStoreResponse(502, null)).toEqual({ available: false, reason: 'unreachable' })
    expect(classifyStoreResponse(200, { data: [] })).toEqual({ available: true })
  })

  it('extractRows 容忍裸数组与 {data:[…]} 信封', () => {
    expect(extractRows([])).toEqual([])
    expect(extractRows({ data: [1, 2] })).toEqual([1, 2])
    expect(extractRows({ msg: 'x' })).toBeNull()
  })
})

describe('broughtActionsViolations（#2049 验收断言：带入与未闭环清单一致）', () => {
  const open = [
    { id: '1', action: '关注晚高峰价格上限政策', owner: null, dueDate: null, status: 'open' as const, updatedAt: null },
    { id: '2', action: '补齐止损纪律复训', owner: null, dueDate: null, status: 'carried_over' as const, updatedAt: null }
  ]

  it('完全一致 → 无违规', () => {
    const brought = [
      { actionId: '1', action: '关注晚高峰价格上限政策', status: 'open' as const },
      { actionId: '2', action: '补齐止损纪律复训', status: 'carried_over' as const }
    ]
    expect(broughtActionsViolations(brought, open)).toEqual([])
  })

  it('漏带/多带/改文本/状态不符都算违规', () => {
    expect(broughtActionsViolations([{ actionId: '1', action: '关注晚高峰价格上限政策', status: 'open' }], open).length).toBe(1)
    expect(broughtActionsViolations([
      { actionId: '1', action: '关注晚高峰价格上限政策', status: 'open' },
      { actionId: '2', action: '补齐止损纪律复训', status: 'carried_over' },
      { actionId: '3', action: '多带的', status: 'open' as never }
    ], open).some((v) => v.includes('不在未闭环清单'))).toBe(true)
    expect(broughtActionsViolations([{ actionId: '1', action: '被篡改的文本', status: 'open' }], open).some((v) => v.includes('文本不一致'))).toBe(true)
    expect(broughtActionsViolations([{ actionId: '1', action: '关注晚高峰价格上限政策', status: 'carried_over' }], open).some((v) => v.includes('状态不一致'))).toBe(true)
  })
})
