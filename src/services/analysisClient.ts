// 数据分析用户产物客户端（Phase 6 PR-B）：对接 /api/v1/analysis/*（PR-A 后端）。
// 走 api.ts 通道 A（统一信封 + 地区头 x-region-id + 写请求自动 idempotency-key + 401 处理），
// 照抄 declarations.ts 模式——client 零样板，头/重试/鉴权全由 api.ts 处理。
// 不照抄 spotClient/quantClient（那是 agent 代理通道 B，自解 BaseResponse）。
import { apiGet, apiPost, apiPut, apiDelete } from '@/services/api'
import type {
  AnalysisView as ContractAnalysisView,
  AnalysisViewPageStateConfig,
} from '@dljy/contracts'

const BASE = '/api/v1/analysis'

/** 分析视图配置：DataAnalysisView 等分析页的可序列化页面状态（刷新/分享后可还原）。
 *  kind='page-state' 是判别式（对齐 dljy-contracts 1.12.0 analysis-view 的 AnalysisViewConfig 联合：
 *  page-state | chart | dashboard）；与 agent 图表/仪表盘快照 config（analysisViewsClient）区分，
 *  避免两套形状写同一存储后互相误读。 */
export type ViewConfig = AnalysisViewPageStateConfig
export type AnalysisView = Omit<ContractAnalysisView, 'config'> & { config: ViewConfig }

export type AnalysisSnapshot = {
  snapshotId: string
  ownerUsername: string
  companyId: string
  viewId: string | null
  routePath: string
  region: string
  data: Record<string, unknown>
  sourceBasis: string
  createdAt: string
  basis?: string
  sourceType?: string
  mock?: boolean
  productionWrite?: boolean
}

export type AnnotationTargetType = 'point' | 'range' | 'series'

export type AnalysisAnnotation = {
  annotationId: string
  ownerUsername: string
  companyId: string
  targetType: AnnotationTargetType
  targetRef: string
  content: string
  region: string
  createdAt: string
  basis?: string
  sourceType?: string
  mock?: boolean
  productionWrite?: boolean
}

// 信封解包：后端 envelope {code,msg,data:{rows,total}} 或 {code,msg,data:<对象>}；
// api.ts 已解 HTTP 层，这里再取 data 字段（兼容 data 在顶层 vs 嵌套两种形态）。
function rowsOf<T>(res: unknown): T[] {
  const d = (res as { data?: unknown })?.data ?? res
  return ((d as { rows?: T[] })?.rows) ?? []
}
function dataOf<T>(res: unknown): T {
  return ((res as { data?: T })?.data ?? res) as T
}

// ── views ─────────────────────────────────────────────────────────────────
export async function listViews(routePath?: string): Promise<AnalysisView[]> {
  const res = await apiGet(`${BASE}/views`, routePath ? { routePath } : undefined)
  return rowsOf<AnalysisView>(res)
}

export async function saveView(input: { name: string; routePath: string; config: ViewConfig }): Promise<AnalysisView> {
  return dataOf<AnalysisView>(await apiPost(`${BASE}/views`, input))
}

export async function getView(viewId: string): Promise<AnalysisView> {
  return dataOf<AnalysisView>(await apiGet(`${BASE}/views/${encodeURIComponent(viewId)}`))
}

export async function updateView(viewId: string, input: { name?: string; config?: ViewConfig }): Promise<AnalysisView> {
  return dataOf<AnalysisView>(await apiPut(`${BASE}/views/${encodeURIComponent(viewId)}`, input))
}

export async function deleteView(viewId: string): Promise<void> {
  await apiDelete(`${BASE}/views/${encodeURIComponent(viewId)}`)
}

// ── snapshots ───────────────────────────────────────────────────────────────
export async function listSnapshots(opts: { viewId?: string; routePath?: string } = {}): Promise<AnalysisSnapshot[]> {
  const query: Record<string, string> = {}
  if (opts.viewId) query.viewId = opts.viewId
  if (opts.routePath) query.routePath = opts.routePath
  const res = await apiGet(`${BASE}/snapshots`, Object.keys(query).length ? query : undefined)
  return rowsOf<AnalysisSnapshot>(res)
}

export async function saveSnapshot(input: {
  routePath: string
  viewId?: string
  data: Record<string, unknown>
}): Promise<AnalysisSnapshot> {
  return dataOf<AnalysisSnapshot>(await apiPost(`${BASE}/snapshots`, input))
}

export async function deleteSnapshot(snapshotId: string): Promise<void> {
  await apiDelete(`${BASE}/snapshots/${encodeURIComponent(snapshotId)}`)
}

// ── annotations ─────────────────────────────────────────────────────────────
export async function listAnnotations(opts: { targetType?: AnnotationTargetType; targetRef?: string } = {}): Promise<AnalysisAnnotation[]> {
  const query: Record<string, string> = {}
  if (opts.targetType) query.targetType = opts.targetType
  if (opts.targetRef) query.targetRef = opts.targetRef
  const res = await apiGet(`${BASE}/annotations`, Object.keys(query).length ? query : undefined)
  return rowsOf<AnalysisAnnotation>(res)
}

export async function saveAnnotation(input: {
  targetType: AnnotationTargetType
  targetRef: string
  content: string
}): Promise<AnalysisAnnotation> {
  return dataOf<AnalysisAnnotation>(await apiPost(`${BASE}/annotations`, input))
}

export async function deleteAnnotation(annotationId: string): Promise<void> {
  await apiDelete(`${BASE}/annotations/${encodeURIComponent(annotationId)}`)
}
