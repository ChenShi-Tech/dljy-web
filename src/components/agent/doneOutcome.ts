// done 事件的终局解释（dljy-web#49）。
// 底座（pi，主仓 #2636 起）在模型/供应商失败时会先推 error 事件、终局 done.status=error；
// 旧底座/网络截断也可能只给一个 done error。面板不能把它当 idle 静默收场——
// 没有任何错误段时补一段可见文案，让用户知道「这轮是失败收场，不是模型没说话」。

export type DoneOutcome = {
  /** 会话状态：失败也回 idle（可继续对话），只有挂审批才是 awaiting_approval */
  sessionStatus: 'idle' | 'awaiting_approval'
  /** 需要补进消息流的错误文案；已有 error 段或非失败终局为 null */
  errorText: string | null
}

export const DONE_ERROR_FALLBACK_TEXT = '⚠️ 模型调用失败，本轮无输出（底座终局 done.status=error）'

export function resolveDoneOutcome(status: string, sawErrorThisRun: boolean): DoneOutcome {
  if (status === 'awaiting_approval') return { sessionStatus: 'awaiting_approval', errorText: null }
  if (status === 'error') {
    return { sessionStatus: 'idle', errorText: sawErrorThisRun ? null : DONE_ERROR_FALLBACK_TEXT }
  }
  return { sessionStatus: 'idle', errorText: null }
}
