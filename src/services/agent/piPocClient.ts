// pi-poc 专用端点的服务层收编（#1526/#1527 PoC 页取数出口统一）。
// 页面原先直接 fetch('/pi-api/...')，违反「取数只经 services 层」纪律（DEVELOPMENT.md §3.1），
// 散落的取数无法统一治理，/pi-api 代理在本仓被移除后两个页面静默 404 即其症状。
// 收编后统一：走 agentClient 单一定义的 PI_AGENT_BASE、带 identityHeaders、有 10s 超时
// （与 agentClient 的 AGENT_REQUEST_TIMEOUT_MS 同档）。GET 补身份头为兼容增益，行为不变。
import { identityHeaders, PI_AGENT_BASE } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'

const PI_POC_TIMEOUT_MS = 10000

// 数据缺口清单（#1782）：聚合 Markdown，用户复制转发给后端负责人。
// 服务未启动/失败由调用方（工作台的战略问答入口挂件 StrategicQaGaps）给出友好提示。
export async function fetchDataGaps(): Promise<string> {
  const res = await fetch(`${PI_AGENT_BASE}/data-gaps`, {
    headers: identityHeaders(),
    signal: timeoutSignal(PI_POC_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return ((await res.json()) as { markdown?: string }).markdown || ''
}

// 自动执行授权开关（#1527）：按会话生效、服务重启失效（授权不持久红线）。
// 返回服务端生效后的最终态，开关 UI 以此为准，失败时由调用方回滚显示。
export async function setSessionAutoApprove(sessionId: string, enabled: boolean): Promise<boolean> {
  const res = await fetch(`${PI_AGENT_BASE}/sessions/${encodeURIComponent(sessionId)}/auto-approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identityHeaders() },
    body: JSON.stringify({ enabled }),
    signal: timeoutSignal(PI_POC_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return ((await res.json()) as { auto_approve?: boolean }).auto_approve === true
}
