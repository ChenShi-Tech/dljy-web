// done 事件的终局解释（dljy-web#49）。
// 底座（pi，主仓 #2636 起）在模型/供应商失败时会先推 error 事件、终局 done.status=error；
// 旧底座/网络截断也可能只给一个 done error。面板不能把它当 idle 静默收场——
// 没有任何错误段时补一段可见文案，让用户知道「这轮是失败收场，不是模型没说话」。
//
// 空结果兜底（2026-09-04 实测补）：底座还可能把 provider 失败吞成**零事件正常收尾**——
// 运行 200ms 即 done(idle)，全程无 token/工具/错误事件（当时根因：LLM 接入凭据 401 失效）。
// 这种「看起来模型就是没说话」的轮次同样不能静默收场，补空结果说明并指向自助修复入口。

export type DoneOutcome = {
  /** 会话状态：失败也回 idle（可继续对话），只有挂审批才是 awaiting_approval */
  sessionStatus: 'idle' | 'awaiting_approval'
  /** 需要补进消息流的错误文案；已有 error 段或非失败终局为 null */
  errorText: string | null
}

export const DONE_ERROR_FALLBACK_TEXT = '⚠️ 模型调用失败，本轮无输出（底座终局 done.status=error）'

export const DONE_EMPTY_FALLBACK_TEXT =
  '⚠️ 本轮运行没有任何返回内容（智能体服务空结果）。常见原因：模型接入凭据失效——' +
  '可在「系统管理 → AI 工作室 · 模型服务」更新后重试；若持续出现，请联系维护者检查后端日志。'

export function resolveDoneOutcome(
  status: string,
  sawErrorThisRun: boolean,
  opts?: {
    /** 本轮是否出现过任何内容事件（token/工具/审批…）；缺省按有内容处理，不出空结果文案 */
    hasAssistantContent?: boolean
  }
): DoneOutcome {
  if (status === 'awaiting_approval') return { sessionStatus: 'awaiting_approval', errorText: null }
  if (status === 'error') {
    return { sessionStatus: 'idle', errorText: sawErrorThisRun ? null : DONE_ERROR_FALLBACK_TEXT }
  }
  // 正常终局（idle/completed 等）但全程零内容事件：底座吞错后的空收尾，补诚实说明。
  // cancelled 是用户主动中止，不提示。
  if (status !== 'cancelled' && opts?.hasAssistantContent === false) {
    return { sessionStatus: 'idle', errorText: DONE_EMPTY_FALLBACK_TEXT }
  }
  return { sessionStatus: 'idle', errorText: null }
}
