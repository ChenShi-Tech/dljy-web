import { describe, expect, it } from 'vitest'

import { DONE_EMPTY_FALLBACK_TEXT, DONE_ERROR_FALLBACK_TEXT, resolveDoneOutcome } from './doneOutcome'

describe('resolveDoneOutcome（dljy-web#49）', () => {
  it('done error 且本轮没有 error 段：补可见错误文案，会话回 idle', () => {
    expect(resolveDoneOutcome('error', false)).toEqual({ sessionStatus: 'idle', errorText: DONE_ERROR_FALLBACK_TEXT })
  })

  it('done error 但 error 事件已渲染过：不重复补文案', () => {
    expect(resolveDoneOutcome('error', true)).toEqual({ sessionStatus: 'idle', errorText: null })
  })

  it('awaiting_approval 与 idle 不受影响', () => {
    expect(resolveDoneOutcome('awaiting_approval', false)).toEqual({ sessionStatus: 'awaiting_approval', errorText: null })
    expect(resolveDoneOutcome('idle', false)).toEqual({ sessionStatus: 'idle', errorText: null })
    expect(resolveDoneOutcome('cancelled', true)).toEqual({ sessionStatus: 'idle', errorText: null })
  })
})

// 空结果兜底（2026-09-04 实测）：底座把 provider 失败吞成零事件正常 done(idle)——
// 面板不能静默收场，补空结果说明；cancelled（用户主动中止）与有内容的轮次不提示。
describe('resolveDoneOutcome：空结果兜底', () => {
  it('done=idle 且本轮零内容事件：补空结果说明（指向模型服务自助修复）', () => {
    expect(resolveDoneOutcome('idle', false, { hasAssistantContent: false }).errorText).toBe(DONE_EMPTY_FALLBACK_TEXT)
    expect(resolveDoneOutcome('completed', false, { hasAssistantContent: false }).errorText).toBe(DONE_EMPTY_FALLBACK_TEXT)
  })

  it('有过任意内容事件（token/工具/审批）的正常轮次：不提示', () => {
    expect(resolveDoneOutcome('idle', false, { hasAssistantContent: true }).errorText).toBeNull()
  })

  it('cancelled（用户主动中止）不提示，即便零内容', () => {
    expect(resolveDoneOutcome('cancelled', false, { hasAssistantContent: false }).errorText).toBeNull()
  })

  it('缺省 opts（历史调用方）行为不变：不触发空结果文案', () => {
    expect(resolveDoneOutcome('idle', false).errorText).toBeNull()
  })
})
