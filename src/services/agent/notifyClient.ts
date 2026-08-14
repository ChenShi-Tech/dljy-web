// 调度结果推送配置客户端（C2）：对接后端 /api/agent/notify + /api/agent/schedules/{id}/notify。
// 全局渠道凭证（webhook/smtp/feishu/wecom/dingtalk）+ 每任务推送开关（enabled/on_success/on_error/channels）。
// 写操作复用 LLM 同款 x-admin-token（adminHeaders）。scheduler._run_job 按任务配置 + 全局凭证推送。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'
import { getAdminToken } from '@/services/llm'

const BASE = AGENT_API_BASE
const TIMEOUT_MS = 15_000

export type ChannelKey = 'webhook' | 'smtp' | 'feishu' | 'wecom' | 'dingtalk'

export type ChannelConfigView = {
  key: ChannelKey
  enabled: boolean
  has_secret: boolean
  // 各渠道字段（视配置而定，宽松类型）
  [k: string]: unknown
}

export type ChannelsConfig = Record<ChannelKey, Record<string, unknown>>

export type TaskNotifyConfig = {
  enabled: boolean
  on_success: boolean
  on_error: boolean
  channels: ChannelKey[]
}

function adminHeaders(): Record<string, string> {
  const headers = identityHeaders()
  const t = getAdminToken()
  if (t) headers['x-admin-token'] = t
  return headers
}

function adminJsonHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', ...adminHeaders() }
}

async function errDetail(res: Response): Promise<string> {
  try {
    return (await res.json())?.detail ?? ''
  } catch {
    return ''
  }
}

const enc = encodeURIComponent

export async function listChannels(): Promise<ChannelConfigView[]> {
  const res = await fetch(`${BASE}/notify`, { headers: identityHeaders(), signal: timeoutSignal(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`获取推送渠道失败: ${res.status}`)
  return ((await res.json()).channels ?? []) as ChannelConfigView[]
}

export async function saveChannels(config: ChannelsConfig): Promise<void> {
  const res = await fetch(`${BASE}/notify`, {
    method: 'PUT',
    headers: adminJsonHeaders(),
    body: JSON.stringify(config),
    signal: timeoutSignal(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `保存失败: ${res.status}`)
}

export async function testChannel(channel: ChannelKey, subject = '推送通道测试', body = 'dljy 推送测试消息'): Promise<{ ok: boolean; msg?: string }> {
  const res = await fetch(`${BASE}/notify/test`, {
    method: 'POST',
    headers: adminJsonHeaders(),
    body: JSON.stringify({ channel, subject, body }),
    signal: timeoutSignal(30_000),
  })
  if (!res.ok) return { ok: false, msg: `HTTP ${res.status}` }
  return (await res.json()) as { ok: boolean; msg?: string }
}

export async function getTaskNotify(taskId: string): Promise<TaskNotifyConfig> {
  const res = await fetch(`${BASE}/schedules/${enc(taskId)}/notify`, { headers: identityHeaders(), signal: timeoutSignal(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`获取任务推送配置失败: ${res.status}`)
  return (await res.json()) as TaskNotifyConfig
}

export async function saveTaskNotify(taskId: string, cfg: TaskNotifyConfig): Promise<void> {
  const res = await fetch(`${BASE}/schedules/${enc(taskId)}/notify`, {
    method: 'PUT',
    headers: adminJsonHeaders(),
    body: JSON.stringify(cfg),
    signal: timeoutSignal(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `保存失败: ${res.status}`)
}

export async function deleteTaskNotify(taskId: string): Promise<void> {
  const res = await fetch(`${BASE}/schedules/${enc(taskId)}/notify`, {
    method: 'DELETE',
    headers: adminHeaders(),
    signal: timeoutSignal(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `删除失败: ${res.status}`)
}
