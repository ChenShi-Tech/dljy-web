// 智能体监控：从 harness 后端拉真实运行态（会话 / 工具），供运营中枢「智能体」面展示。
// 替代原静态 mock 的 dataset.agents：反映 /api/agent 的真实能力面与活动。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'
import type { OpsMetric } from '@/services/operations'

export interface AgentToolRow {
  name: string
  category: string
  risk: string
  description: string
}

export interface AgentMonitorData {
  online: boolean
  metrics: OpsMetric[]
  tools: AgentToolRow[]
  chartRows: { name: string; value: number }[]
}

const OFFLINE: AgentMonitorData = {
  online: false,
  metrics: [
    { label: '活跃会话', value: 0, unit: '个', tone: 'blue' },
    { label: '可用工具', value: 0, unit: '个', tone: 'green' }
  ],
  tools: [],
  chartRows: []
}

const MONITOR_TIMEOUT_MS = 8000

export async function fetchAgentMonitor(): Promise<AgentMonitorData> {
  try {
    const [sessionsRaw, toolsRes] = await Promise.all([
      fetch(`${AGENT_API_BASE}/sessions`, {
        headers: identityHeaders(),
        signal: timeoutSignal(MONITOR_TIMEOUT_MS)
      }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${AGENT_API_BASE}/tools`, {
        headers: identityHeaders(),
        signal: timeoutSignal(MONITOR_TIMEOUT_MS)
      }).then((r) => (r.ok ? r.json() : { tools: [] }))
    ])
    const sessions: any[] = Array.isArray(sessionsRaw) ? sessionsRaw : []
    const tools: AgentToolRow[] = (toolsRes?.tools ?? []).map((t: any) => ({
      name: t.name,
      category: t.category,
      risk: t.risk,
      description: t.description ?? ''
    }))
    const pending = sessions.filter((s) => s.pending_approval).length
    const l2 = tools.filter((t) => t.risk === 'L2').length

    const byCat = new Map<string, number>()
    for (const t of tools) byCat.set(t.category, (byCat.get(t.category) ?? 0) + 1)

    const metrics: OpsMetric[] = [
      { label: '活跃会话', value: sessions.length, unit: '个', tone: 'blue' },
      { label: '待审批', value: pending, unit: '项', tone: 'orange' },
      { label: '可用工具', value: tools.length, unit: '个', tone: 'green' },
      { label: '需审批工具(L2)', value: l2, unit: '个', tone: 'purple' }
    ]
    return {
      online: true,
      metrics,
      tools,
      chartRows: [...byCat.entries()].map(([name, value]) => ({ name, value }))
    }
  } catch {
    return OFFLINE
  }
}
