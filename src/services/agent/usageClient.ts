// LLM 用量统计客户端：对接 /api/agent/usage。后端按登录角色过滤：
// 管理员(ADMIN/BOSS) 全站 + 按公司分组，普通用户仅本公司（归属公司从 token 解析，
// 不信 x-company-id）。数据源 model_calls 表（audit.usage_summary）。
// 后端离线 / 未登录时返回 null（不回退全站，fail-closed）。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'

const BASE = `${AGENT_API_BASE}/usage`
const USAGE_TIMEOUT_MS = 10000

export type UsageRow = {
  provider: string
  model: string
  role: string
  calls: number
  input_tokens: number
  output_tokens: number
  avg_latency_ms: number
  company_id?: string
}

export type UsageSummary = {
  summary: UsageRow[]
  is_admin: boolean
  scope_company_id: string | null
}

// sinceHours: 统计窗口（小时），默认近 24 小时；传 168 = 近 7 天。
export async function fetchUsage(sinceHours = 24): Promise<UsageSummary | null> {
  try {
    const res = await fetch(`${BASE}?since_hours=${sinceHours}`, {
      headers: identityHeaders(),
      signal: timeoutSignal(USAGE_TIMEOUT_MS)
    })
    if (!res.ok) return null
    const data = (await res.json()) as Partial<UsageSummary>
    return {
      summary: data.summary ?? [],
      is_admin: !!data.is_admin,
      scope_company_id: data.scope_company_id ?? null
    }
  } catch {
    return null
  }
}
