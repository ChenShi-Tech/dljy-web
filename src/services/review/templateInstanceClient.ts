// 模板实例通道 · 传输层（Epic #2033 · M1；契约见 docs/review-system/review-system-design.md §3.2/3.3）
// ---------------------------------------------------------------------------
// GET   /agent-api/agent/review/template-instances      —— 列表（#2037/#2039 已上线：
//       触发引擎按周期生成分母，待办箱据此出真数；端点未部署时探针 404，前端诚实降级）
// PATCH /agent-api/agent/review/template-instances/{id} —— 草稿保存/提交（幂等键防双击双写）
// 会话内 TTL 缓存（5 分钟，按地区）：避免每个消费组件（待办箱/徽标）重复请求；
// 可 force 刷新。注意：刻意不消费地区响应头（applyRegionHeaders）——失败态不该驱动
// RegionDataBanner。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { currentRegion } from '@/services/region/regionContext'
import { timeoutSignal } from '@/services/api'
import { classifyInstanceError, classifyInstanceResponse, type TemplateInstanceFeed } from './templateInstanceApi'

const BASE = `${AGENT_API_BASE}/review`
const PROBE_TIMEOUT_MS = 8000
const CACHE_TTL_MS = 5 * 60 * 1000

let cache: { regionId: string; at: number; feed: TemplateInstanceFeed } | null = null

/**
 * 实例列表。不带 status 过滤：待办视图（toTodoViews）要 pending + draft 两态——
 * draft 是人已动手填过的待办，只拉 pending 会把「填了一半」的实例从待办箱里丢掉。
 */
export async function fetchTemplateInstanceFeed(force = false): Promise<TemplateInstanceFeed> {
  const regionId = currentRegion.value.id
  if (!force && cache && cache.regionId === regionId && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.feed
  }
  let feed: TemplateInstanceFeed
  try {
    const res = await fetch(`${BASE}/template-instances`, {
      method: 'GET',
      headers: { 'x-region-id': regionId, ...identityHeaders() },
      signal: timeoutSignal(PROBE_TIMEOUT_MS)
    })
    const body: unknown = res.status === 204 ? [] : await res.json().catch(() => null)
    feed = classifyInstanceResponse(res.status, body)
  } catch (e) {
    feed = classifyInstanceError(e)
  }
  cache = { regionId, at: Date.now(), feed }
  return feed
}

/** 作废会话缓存（提交/触发后供消费组件强制重取真数）。 */
export function invalidateTemplateInstanceCache(): void {
  cache = null
}

/** 幂等键：crypto.randomUUID 需安全上下文，现场 http 部署没有——降级到时间戳+随机数。 */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export type InstancePatch = {
  /** 人工字段草稿（human 字段 + 已采纳的 ai 建议值，按 field key） */
  payload?: Record<string, unknown>
  /** 状态迁移：draft（存草稿）/ submitted（提交锁定）/ reviewed（提权复核） */
  status?: 'draft' | 'submitted' | 'reviewed'
}

/**
 * PATCH 实例（存草稿/提交/复核）。服务端校验状态机（409）与提权（403），错误信封
 * {code,msg} 直接抛 Error(msg)——表单如实展示，不静默吞。
 */
export async function patchTemplateInstance(instanceId: string, patch: InstancePatch): Promise<void> {
  const res = await fetch(`${BASE}/template-instances/${encodeURIComponent(instanceId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...identityHeaders(), 'idempotency-key': newIdempotencyKey() },
    body: JSON.stringify(patch),
    signal: timeoutSignal(PROBE_TIMEOUT_MS)
  })
  if (res.status >= 200 && res.status < 300) {
    invalidateTemplateInstanceCache()
    return
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  const msg = typeof body?.msg === 'string' && body.msg ? body.msg : `实例更新失败（HTTP ${res.status}）`
  throw new Error(msg)
}
