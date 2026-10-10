// 盯盘哨兵告警客户端：对接 /api/agent/alerts/*。
// listAlerts 失败（网络/非 2xx/不可解析）**抛错**：告警链路不可用不得冒充「无告警」（风控页
// 会把空列表判成绿色安全）。需要静默降级的消费方（顶栏 AlertCenter）自行 catch。
// 阶段 A 起 scan/dismiss 走管理员鉴权（携 x-admin-token，与调度/密钥写操作同款）；
// list 仅需登录（authorization），保留 identityHeaders。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'
import { getAdminToken } from '@/services/llm'

const BASE = `${AGENT_API_BASE}/alerts`
const ALERT_TIMEOUT_MS = 10000

// 管理员鉴权头：identityHeaders（含 authorization + x-region-id）+ x-admin-token。
// 服务端未配 HARNESS_ADMIN_TOKEN 时返回空头，后端放行（单机/演示）。
function adminHeaders(): Record<string, string> {
  const headers = identityHeaders()
  const t = getAdminToken()
  if (t) headers['x-admin-token'] = t
  return headers
}

export type AlertSeverity = 'high' | 'medium' | 'low'
export type Alert = {
  id: string
  ts: number
  kind: string
  severity: AlertSeverity
  region_id: string
  region_name: string
  title: string
  detail: string
  basis: string
  status: string
}

export async function listAlerts(): Promise<{ alerts: Alert[]; open_count: number }> {
  // 失败抛错（见头注）；res.json() 对非 JSON 响应自然抛 SyntaxError，同样算失败。
  const res = await fetch(BASE, { headers: identityHeaders(), signal: timeoutSignal(ALERT_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`告警列表请求失败: HTTP ${res.status}`)
  return (await res.json()) as { alerts: Alert[]; open_count: number }
}

export async function scanAlerts(
  date: string,
  regionId: string,
  regionName: string,
  spreadThreshold = 120
): Promise<{ ok: boolean; created: number; msg?: string }> {
  try {
    const res = await fetch(`${BASE}/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ date, region_id: regionId, region_name: regionName, spread_threshold: spreadThreshold }),
      signal: timeoutSignal(ALERT_TIMEOUT_MS)
    })
    if (!res.ok) return { ok: false, created: 0, msg: `HTTP ${res.status}` }
    return (await res.json()) as { ok: boolean; created: number; msg?: string }
  } catch (e) {
    return { ok: false, created: 0, msg: e instanceof Error ? e.message : '网络错误（后端未运行？）' }
  }
}

export async function dismissAlert(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(id)}/dismiss`, {
      method: 'POST',
      headers: adminHeaders(),
      signal: timeoutSignal(ALERT_TIMEOUT_MS)
    })
    return res.ok
  } catch {
    return false
  }
}

// 清空告警（DELETE /api/agent/alerts，alerts.py:clear_alerts）。阶段 A 起需管理员鉴权 +
// #214 地区隔离（带 x-region-id 仅清当前地区）。携 x-admin-token（adminHeaders 内含 x-region-id）。
export async function clearAllAlerts(): Promise<boolean> {
  try {
    const res = await fetch(BASE, {
      method: 'DELETE',
      headers: adminHeaders(),
      signal: timeoutSignal(ALERT_TIMEOUT_MS)
    })
    return res.ok
  } catch {
    return false
  }
}
