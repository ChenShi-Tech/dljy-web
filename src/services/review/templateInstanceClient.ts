// 模板实例探针 · 传输层（Epic #2033 · M1；契约见 docs/review-system/review-system-design.md §3.2/3.3）
// ---------------------------------------------------------------------------
// GET /agent-api/agent/review/template-instances?status=pending
// 后端（#2039 触发引擎/#2037 服务端化）未上线 → 探针 404，前端诚实降级。
// 会话内 TTL 缓存（5 分钟，按地区）：避免每个消费组件（待办箱/徽标）重复打
// 无效端点；端点上线后同会话最多延迟 5 分钟出真数，可 force 刷新。
// 注意：探针刻意不消费地区响应头（applyRegionHeaders）——它不是数据接口，
// 失败态不该驱动 RegionDataBanner。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { currentRegion } from '@/services/region/regionContext'
import { timeoutSignal } from '@/services/api'
import { classifyInstanceError, classifyInstanceResponse, type TemplateInstanceFeed } from './templateInstanceApi'

const BASE = `${AGENT_API_BASE}/review`
const PROBE_TIMEOUT_MS = 8000
const CACHE_TTL_MS = 5 * 60 * 1000

let cache: { regionId: string; at: number; feed: TemplateInstanceFeed } | null = null

export async function fetchTemplateInstanceFeed(force = false): Promise<TemplateInstanceFeed> {
  const regionId = currentRegion.value.id
  if (!force && cache && cache.regionId === regionId && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.feed
  }
  let feed: TemplateInstanceFeed
  try {
    const res = await fetch(`${BASE}/template-instances?status=pending`, {
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
