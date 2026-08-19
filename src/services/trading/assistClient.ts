// AI 辅助填报客户端：对接 agent-backend 的 /agent/assist/suggest（结构化建议）。
//
// 用途边界（与后端一致的硬约束）：只服务需要人工经验判断的字段，偏差主因、方向、
// 预期价差、置信度、决策理由、补仓动作、概率分位。数据库能取的字段一律走确定性通道
// （fundamentalsClient / captured / storageAssetsClient），不经这里。
//
// 交互契约：AI 只出建议，不直接改任何表单值；用户点「采纳填入」才由前端写入。
import { AGENT_API_BASE } from '@/services/agent/agentClient'

/** 判断点标识，与后端 ASSIST_KINDS 的键一一对应（拼错会被后端 400 挡下）。 */
export type AssistKind = 'morning_review' | 'direction' | 'contract_gap' | 'decision_log'

export type AssistSuggestion = {
  kind: AssistKind
  /** 逐字段建议值；模型无法判断的字段为 null（不编造） */
  suggestion: Record<string, unknown>
  /** 逐字段依据：data=建立在注入的实际数据上 / assumption=模型的假设推断 */
  basis: Record<string, string>
  confidence: number
  rationale: string
  /** 模型自陈的不确定处与反对意见，不看这个就采纳等于放弃判断 */
  caveats: string[]
}

export async function requestAssist(kind: AssistKind, context: Record<string, unknown>): Promise<AssistSuggestion> {
  // AGENT_API_BASE 已含 /agent 后缀（= /agent-api/agent），此处只接 /assist/...
  const res = await fetch(`${AGENT_API_BASE}/assist/suggest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, context })
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string }
    throw new Error(body.detail || `辅助判断服务返回 ${res.status}（agent-backend 8000 在线？AI 设置里配了 Key？）`)
  }
  return (await res.json()) as AssistSuggestion
}

export const BASIS_LABEL: Record<string, string> = {
  data: '基于数据',
  assumption: '基于假设'
}
