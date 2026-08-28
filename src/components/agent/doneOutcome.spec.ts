import { describe, expect, it } from 'vitest'

import { DONE_ERROR_FALLBACK_TEXT, resolveDoneOutcome } from './doneOutcome'

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
