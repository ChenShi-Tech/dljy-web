// 影子对拍口径单测（#1848 第二部分）。
// 这里守的是「对拍数字可信」，阈值在服务端，但喂进阈值的布尔值对不对在这一层。
// 三条最容易错的：形状不能带工具名（否则永久假红）、副作用取自审批门（跨底座唯一可比的写动作口径）、
// 「都失败」也算可用性一致（一致地坏不是回归，把它记成差异会误封升级闸）。

import { describe, expect, it, vi } from 'vitest'

const localStorageStub = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
// shadowCompare → rollout → api.ts 链上模块求值期会读 window/localStorage（node 环境无 window）
vi.stubGlobal('window', { localStorage: localStorageStub, location: { origin: 'http://localhost' } })
vi.stubGlobal('localStorage', localStorageStub)

const {
  compareObservations,
  createTurnObserver,
  effectIdsFromApproval,
  isComparableTurn,
  splitTurnPayload,
} = await import('@/services/agent/shadowCompare')
const { packageRegionSummary } = await import('@/services/region/regionContext')
type TurnObservation = ReturnType<ReturnType<typeof createTurnObserver>['result']>

type AnyEvent = Parameters<ReturnType<typeof createTurnObserver>['observe']>[0]

function observe(events: AnyEvent[]): TurnObservation {
  const observer = createTurnObserver()
  for (const event of events) observer.observe(event)
  return observer.result()
}

describe('createTurnObserver 观测量', () => {
  it('形状合并连续同类事件，且不含工具名', () => {
    const obs = observe([
      { type: 'token', content: '你' },
      { type: 'token', content: '好' },
      { type: 'tool_call', name: 'fetch_series', args: {} },
      { type: 'tool_result', name: 'fetch_series', summary: 'ok' },
      { type: 'token', content: '结论' },
      { type: 'done', status: 'ok' },
    ] as AnyEvent[])
    expect(obs.shape).toEqual(['token', 'tool_call', 'tool_result', 'token', 'done'])
    expect(obs.shape.join(',')).not.toContain('fetch_series')
    expect(obs.textLength).toBe(4) // 你好 + 结论
    expect(obs.ok).toBe(true)
  })

  it('error 终态即视为未正常收尾', () => {
    const obs = observe([
      { type: 'token', content: 'x' },
      { type: 'error', message: '后端炸了' },
    ] as AnyEvent[])
    expect(obs.ok).toBe(false)
  })

  it('done 之后再来 error 仍判未正常收尾（以最后一次终态为准）', () => {
    const obs = observe([{ type: 'done', status: 'ok' }, { type: 'error', message: 'x' }] as AnyEvent[])
    expect(obs.ok).toBe(false)
  })

  it('审批请求记入副作用集合并置 approvalRequested', () => {
    const observer = createTurnObserver()
    observer.observe({
      type: 'approval_request',
      payload: { type: 'tool_approval', action_requests: [{ name: 'submit_declaration' }] },
    } as AnyEvent)
    expect(observer.approvalRequested).toBe(true)
    expect(observer.result().effects).toEqual(['submit_declaration'])
  })

  it('副作用集合去重并排序（顺序不同不该判成差异）', () => {
    const obs = observe([
      { type: 'approval_request', payload: { action_requests: [{ name: 'save_draft' }] } },
      { type: 'approval_request', payload: { action_requests: [{ name: 'submit_declaration' }] } },
      { type: 'approval_request', payload: { action_requests: [{ name: 'save_draft' }] } },
    ] as AnyEvent[])
    expect(obs.effects).toEqual(['save_draft', 'submit_declaration'])
  })
})

describe('effectIdsFromApproval 两侧 payload 形状', () => {
  it('pi 侧 action_requests[].name', () => {
    expect(effectIdsFromApproval({ type: 'tool_approval', action_requests: [{ name: 'submit_declaration' }] }))
      .toEqual(['submit_declaration'])
  })

  it('旧图 HITL 的 action 字段', () => {
    expect(effectIdsFromApproval({ action_requests: [{ action: 'submit_declaration' }] }))
      .toEqual(['submit_declaration'])
  })

  it('取不到动作名时回落 payload.type（宁可粗粒度也不要记成空）', () => {
    expect(effectIdsFromApproval({ type: 'declaration_approval', detail: {} }))
      .toEqual(['declaration_approval'])
  })

  it('完全认不出的 payload 返回空数组而不是抛', () => {
    expect(effectIdsFromApproval(null)).toEqual([])
    expect(effectIdsFromApproval({ action_requests: [{ label: '仅有标签' }] })).toEqual([])
  })
})

describe('compareObservations：判 pi 是否劣于 legacy，不判两侧是否相同', () => {
  const base: TurnObservation = { shape: ['token', 'done'], effects: [], ok: true, textLength: 12 }

  it('两侧都答出且 pi 无多余写动作 → 无回归', () => {
    const r = compareObservations(base, { ...base })
    expect(r.availabilityRegressed).toBe(false)
    expect(r.availabilityImproved).toBe(false)
    expect(r.unsafeEffects).toEqual([])
    expect(r.shapeMatch).toBe(true)
  })

  it('形状不同不再构成任何回归信号（只是观测项）', () => {
    const pi = { ...base, shape: ['token', 'tool_call', 'tool_result', 'token', 'done'] }
    const r = compareObservations(base, pi)
    expect(r.shapeMatch).toBe(false)
    expect(r.availabilityRegressed).toBe(false)
    expect(r.unsafeEffects).toEqual([])
  })

  it('pi 多做了 legacy 未做的写动作 → 记入 unsafeEffects（唯一保留的零容忍方向）', () => {
    const pi = { ...base, effects: ['submit_declaration'] }
    expect(compareObservations(base, pi).unsafeEffects).toEqual(['submit_declaration'])
  })

  it('legacy 做了而 pi 没做 → 不是回归，只记观测（pi 更克制）', () => {
    const legacy = { ...base, effects: ['generate_report'] }
    const r = compareObservations(legacy, base)
    expect(r.unsafeEffects).toEqual([])
    expect(r.legacyOnlyEffects).toEqual(['generate_report'])
  })

  it('legacy 答出而 pi 没答出 → 判 pi 回归', () => {
    const r = compareObservations(base, { ...base, textLength: 0 })
    expect(r.availabilityRegressed).toBe(true)
    expect(r.availabilityImproved).toBe(false)
  })

  it('pi 答出而 legacy 没答出 → 判 pi 改进，绝不算差异', () => {
    // 这正是改口径要解决的实测场景：旧图崩掉、pi 正常答出，
    // 旧口径把它记成「差异」推高差异率，反而把更好的一侧拦在门外。
    const legacy = { ...base, ok: false, textLength: 0 }
    const r = compareObservations(legacy, base)
    expect(r.availabilityImproved).toBe(true)
    expect(r.availabilityRegressed).toBe(false)
  })

  it('两侧都没走完 → 既不算回归也不算改进（一致地坏不是回归）', () => {
    const dead = { ...base, ok: false, textLength: 0 }
    const r = compareObservations(dead, { ...dead })
    expect(r.availabilityRegressed).toBe(false)
    expect(r.availabilityImproved).toBe(false)
  })

  it('产出长度不同但都非空 → 不算回归（措辞长短不是可用性差异）', () => {
    expect(compareObservations(base, { ...base, textLength: 999 }).availabilityRegressed).toBe(false)
  })
})

describe('splitTurnPayload 默认地区上下文 vs 其余上下文', () => {
  it('只带地区摘要（AgentChatPanel 每条消息的默认形状）→ 仍可对拍，且原样转发给影子侧', () => {
    const summary = packageRegionSummary() as unknown as Record<string, unknown>
    const { shadowPayload, hasExtraContext } = splitTurnPayload({ ...summary })
    expect(hasExtraContext).toBe(false)
    expect(shadowPayload).toEqual(summary)
  })

  it('带页面切片 → 判为不可对拍，且切片不转发给影子侧', () => {
    const summary = packageRegionSummary() as unknown as Record<string, unknown>
    const { shadowPayload, hasExtraContext } = splitTurnPayload({
      ...summary,
      untrusted_external_content: '页面正文切片',
    })
    expect(hasExtraContext).toBe(true)
    expect(shadowPayload).not.toHaveProperty('untrusted_external_content')
  })

  it('带调用方业务上下文（如申报约束）→ 判为不可对拍', () => {
    expect(splitTurnPayload({ declarationConstraints: { maxMw: 10 } }).hasExtraContext).toBe(true)
  })

  it('无 payload → 无上下文可转发也不影响可对拍', () => {
    expect(splitTurnPayload(null)).toEqual({ shadowPayload: null, hasExtraContext: false })
    expect(splitTurnPayload(undefined)).toEqual({ shadowPayload: null, hasExtraContext: false })
  })
})

describe('isComparableTurn 可对拍判定', () => {
  // 样例场景取仍在灰度中的 declaration_prep：chat 已随 #2158 出灰度表（切流完成、
  // 旧路径已删），isRolloutScenario('chat') 现在是 false，拿它当样例会永远不可对拍。
  const ok = {
    isFirstTurn: true, scenario: 'declaration_prep', scenarioDeclared: true,
    isShadowSession: false, hasExtraContext: false,
  }

  it('五条件全满足才够格', () => {
    expect(isComparableTurn(ok)).toBe(true)
  })

  it('未显式声明场景的调用不对拍：工作室自定义图不传 scenario，缺省值会污染对应场景的报告', () => {
    expect(isComparableTurn({ ...ok, scenarioDeclared: false })).toBe(false)
  })

  it('第二轮起不对拍：pi 侧无历史，上下文不对等', () => {
    expect(isComparableTurn({ ...ok, isFirstTurn: false })).toBe(false)
  })

  it('非灰度场景不对拍（PoC 场景没有旧图侧可比）', () => {
    expect(isComparableTurn({ ...ok, scenario: 'strategic_qa' })).toBe(false)
    expect(isComparableTurn({ ...ok, scenario: undefined })).toBe(false)
  })

  it('影子会话自身不对拍（否则自递归）', () => {
    expect(isComparableTurn({ ...ok, isShadowSession: true })).toBe(false)
  })

  it('带地区摘要之外的上下文才不对拍（只带地区摘要不算，否则四个生产场景一条影子都跑不起来）', () => {
    expect(isComparableTurn({ ...ok, hasExtraContext: true })).toBe(false)
  })
})
