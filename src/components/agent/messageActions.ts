// 对话消息级操作的纯函数（统一 AI 侧边栏 SH-05）：复制整条回复、重新提问。
// 从 AgentChatPanel 抽出便于单测；只读消息模型，不改状态。

type SegLike = { kind: string; chunks?: string[] }
type MsgLike = { role: 'user' | 'assistant'; text?: string; segs?: SegLike[] }

/** 助手回复的完整正文：按顺序拼接所有文本段（工具卡、图表、审批卡等非文本段不计入）。 */
export function assistantPlainText(msg: MsgLike): string {
  return (msg.segs ?? [])
    .filter((s) => s.kind === 'text')
    .map((s) => (s.chunks ?? []).join(''))
    .filter((t) => t.trim().length > 0)
    .join('\n\n')
}

/** 某条助手回复对应的用户问题：它之前最近的一条用户消息；没有返回 null。 */
export function previousUserText(messages: MsgLike[], assistantIndex: number): string | null {
  for (let i = assistantIndex - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user') return m.text?.trim() || null
  }
  return null
}
