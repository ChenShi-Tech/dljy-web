// 长期记忆管理：对接 agent-backend /api/agent/memory（按登录用户隔离 namespace）。
// 列出/删除/清空当前用户在对话中沉淀的跨会话记忆。identityHeaders 带 Authorization，
// 后端据此解析 username 确定记忆 namespace（未登录 401）。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'

const BASE = `${AGENT_API_BASE}/memory`
const TIMEOUT_MS = 10000

export type MemoryItem = {
  key: string
  content?: string
  topic?: string
  created_at?: string
}

async function errDetail(res: Response): Promise<string> {
  try {
    return (await res.json())?.detail ?? ''
  } catch {
    return ''
  }
}

export async function listMemories(
  limit = 50
): Promise<{ username: string; count: number; memories: MemoryItem[] }> {
  const res = await fetch(`${BASE}?limit=${limit}`, {
    headers: identityHeaders(),
    signal: timeoutSignal(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `HTTP ${res.status}`)
  return await res.json()
}

export async function deleteMemory(key: string): Promise<boolean> {
  const res = await fetch(`${BASE}/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: identityHeaders(),
    signal: timeoutSignal(TIMEOUT_MS)
  })
  return res.ok
}

export async function clearMemories(): Promise<boolean> {
  const res = await fetch(BASE, {
    method: 'DELETE',
    headers: identityHeaders(),
    signal: timeoutSignal(TIMEOUT_MS)
  })
  return res.ok
}
