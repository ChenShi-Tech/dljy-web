// ingestClient — 数据摄取 HTTP 客户端（PR-2 端点 POST /v1/ingest/:kind 的前端封装）。
// 摄取端点只在 data-service :8190 注册（#2169 P2-2a，/v1/ingest/ 已登记 dataServiceRoutes），
// 平台 BFF :4174 不再挂这条路由——URL 必须经 dataServicePath() 改写为 /data-svc/api/...（dljy#3251，
// 裸打 /api/v1/ingest 恒 404）。经 Vite /data-svc 代理 → data-service（ingestion-api.mjs，
// admin/service token 鉴权 + subprocess 触发 ETL）。
// 端点返回非标准 envelope（{code, ok, kind, ...}），故用 fetch + requestHeaders（不走 apiPost 的 envelope 解包，
// 也不能用 apiPost 的随机幂等键——见 ingestIdempotencyKey 的 #1406 注释）。
import { requestHeaders } from '@/services/api'
import { dataServicePath } from '@/services/dataServiceRoutes'
import type { DataSourceBasis } from '@/services/data/types'

// spot-ingest / forecast-etl：数据接入向导「一键生效」(#885)，T0/T1 模板投递后 UI 点按即跑 ETL，
// 与 import-hub DELIVERY_HINTS 同源命令。底层走 agent-python.mjs 桥（Python ETL），lockArgs 硬编码。
export type IngestKind =
  | 'spot-export'
  | 'weather-export'
  | 'spot-ingest'
  | 'forecast-etl'
  | 'cgn-yunnan-prices'
  | 'cgn-yunnan-market'

export interface IngestResult {
  code: number
  ok: boolean
  kind: string
  label: string
  actor: string
  isService: boolean
  exitCode: number
  timedOut: boolean
  stdout: string
  stderr: string
}

// 稳定序列化：对象按 key 排序后 stringify，消除 key 顺序差异。
// 与服务端 ingestion-api.mjs::stableStringify 同款口径，保证同一份 params 两端算出同一个键。
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`
}

// FNV-1a 32 位散列（同步、零依赖）。用途仅是把 (kind, params) 压成定长幂等键，
// 不做任何安全判定，故无需 crypto.subtle（后者是异步 API，不适合同步构造请求头）。
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 摄取幂等键：由 (kind, params) 确定性派生。
 *
 * ⚠️ 不能用随机 UUID（#1406）：服务端 `buildDedupKey(actor, kind, idempotencyKey || contentHash)`
 * 在客户端键存在时优先用客户端键，随机键会让原本基于 contentHash 的双击/重发去重全部失效
 * （每次点击都真 spawn 一次 ETL）。用确定性键即等价于服务端 contentHash 语义：
 * 同 params 连点命中 in-flight/completed 去重，不同 params 互不命中。
 */
export function ingestIdempotencyKey(kind: IngestKind, params: Record<string, unknown> = {}): string {
  return `ingest-${kind}-${fnv1a32(`${kind}::${stableStringify(params)}`)}`
}

/** 触发一次数据摄取。params 透传给 ETL CLI（如 weather-export 的 synthetic、spot-export 的 dir）。 */
export async function triggerIngest(kind: IngestKind, params: Record<string, unknown> = {}): Promise<IngestResult> {
  // /v1/ingest/ 归 data-service（dljy#3251）：经 dataServicePath 改写为 /data-svc/api/v1/ingest/:kind。
  // ?? 兜底仅在路由清单被摘掉该前缀时退回裸 /api/v1 路径（保持函数可用性，不吞错）。
  const path = `/api/v1/ingest/${kind}`
  const res = await fetch(dataServicePath(path) ?? path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...requestHeaders(),
      // 网关对全部 /api/v1 写请求强制幂等键，缺失直接 428（#1406）。requestHeaders() 不含该头
      // （它由 api.ts 内未导出的 idempotentRequestHeaders 添加，只有 apiPost/apiPut/... 走那条路径），
      // 因此这里必须自行携带。
      'idempotency-key': ingestIdempotencyKey(kind, params),
    },
    body: JSON.stringify(params),
  })
  const data = (await res.json().catch(() => ({}))) as Partial<IngestResult> & { error?: string; msg?: string }
  if (!res.ok) {
    // 错误体两种形态并存：模块层历史上用 `error`，网关层（428 缺幂等键 / 403 RBAC 拒绝）用统一的 `msg`。
    // 两者都读，否则网关拒绝时用户只能看到「摄取失败（HTTP 428）」而拿不到原因（#1408）。
    throw new Error(data?.msg || data?.error || data?.stderr?.slice(0, 200) || `摄取失败（HTTP ${res.status}）`)
  }
  return data as IngestResult
}

/**
 * 摄取结果真伪判定（避免把合成兜底误标为可决策）。
 *
 * commitFamily source=IMPORT 默认 captured（operational）；但 weather-export 在 Open-Meteo
 * 失败/超时时后端会走合成兜底正常退出（exitCode 0），此时 ETL stdout 会打印 sourceType=MOCK /
 * (--synthetic 合成)（见 import-weather-export.mjs）。保守嗅探 stdout/stderr：出现
 * MOCK/synthetic/合成 → synthetic（advisory_only），否则 captured（operational）。
 * 这是前端最大努力；正解是 ingest 端点回传 family 级真伪（后续）。
 */
export function ingestResultBasis(r: Pick<IngestResult, 'stdout' | 'stderr'>): DataSourceBasis {
  const blob = `${r.stdout}\n${r.stderr}`
  return /MOCK|synthetic|合成/i.test(blob) ? 'synthetic' : 'captured'
}
