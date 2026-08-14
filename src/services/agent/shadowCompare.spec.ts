// 影子对拍口径单测（#1848 第二部分）。
// 这里守的是「对拍数字可信」——阈值在服务端，但**喂进阈值的布尔值对不对**在这一层。
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

describe('compareObservations 三维度', () => {
  const base: TurnObservation = { shape: ['token', 'done'], effects: [], ok: true, textLength: 12 }

  it('完全一致时三维度全 true', () => {
    expect(compareObservations(base, { ...base })).toEqual({
      eventShapeMatch: true, effectsMatch: true, availabilityMatch: true,
    })
  })

  it('形状不同只影响 eventShapeMatch', () => {
    const pi = { ...base, shape: ['token', 'tool_call', 'tool_result', 'token', 'done'] }
    expect(compareObservations(base, pi)).toEqual({
      eventShapeMatch: false, effectsMatch: true, availabilityMatch: true,
    })
  })

  it('一侧请求了写动作、另一侧没有 → 落库内容不一致（零容忍维度）', () => {
    const pi = { ...base, effects: ['submit_declaration'] }
    expect(compareObservations(base, pi).effectsMatch).toBe(false)
  })

  it('一侧答出内容、另一侧空 → 可用性不一致', () => {
    expect(compareObservations(base, { ...base, textLength: 0 }).availabilityMatch).toBe(false)
  })

  it('两侧都没走完 → 可用性判为一致：一致地坏不是回归，记成差异会误封升级闸', () => {
    const legacy = { ...base, ok: false, textLength: 0 }
    const pi = { ...base, ok: false, textLength: 0 }
    expect(compareObservations(legacy, pi).availabilityMatch).toBe(true)
  })

  it('产出长度不同但都非空 → 仍算可用性一致（措辞长短不是可用性差异）', () => {
    expect(compareObservations(base, { ...base, textLength: 999 }).availabilityMatch).toBe(true)
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
  const ok = {
    isFirstTurn: true, scenario: 'chat', scenarioDeclared: true,
    isShadowSession: false, hasExtraContext: false,
  }

  it('五条件全满足才够格', () => {
    expect(isComparableTurn(ok)).toBe(true)
  })

  it('未显式声明场景的调用不对拍：工作室自定义图不传 scenario，缺省 chat 会污染 chat 报告', () => {
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
