import { apiGet, apiPatch, apiPost, ApiError } from '@/services/api'
import type { TopicAnalysisResult, ComparisonBasis, AnalysisThresholds } from './topicAnalysis'
import { topicAnalysisRequest } from './topicAnalysis'
import type { ReviewEvidenceSnapshot } from './reviewEvidence'

export type WorkpaperScope = { region: string; view: 'generator' | 'retail' | 'storage'; objectId: string; objectLabel: string; startDate: string; endDate: string }
export type ReportBlock = { id: string; kind: 'text' | 'chart' | 'reason' | 'question' | 'action'; title: string; text: string; evidenceId?: string; evidenceRole?: 'primary' | 'comparison'; state?: 'pending' | 'confirmed'; supports?: string; refutes?: string }
export type ReportEvidence = {
  id: string; region: string; authorId: string; createdAt: string; sourceKind: string; contentHash: string
  content: { topic?: 'energy' | 'price'; labels: [string, string]; capturedAt: string; sourceNotice: string; input: { scope: { objectId: string }; period: { date: string } }; result: TopicAnalysisResult & { periods: { current: { start: string; end: string } } } }
}
export type Workpaper = { id: string; title: string; scope: WorkpaperScope; authorId: string; revision: number; blocks: ReportBlock[]; summary: string; updatedAt: string; canEdit?: boolean; evidence?: ReportEvidence[] }
export type ReportComment = { id: string; authorId: string; revision: number; blockId: string | null; body: string; createdAt: string }
export type Publication = { id: string; draftId: string; revision: number; contentHash: string; createdAt: string; content: { title: string; scope: WorkpaperScope; authorId: string; blocks: ReportBlock[]; summary: string; evidence: ReportEvidence[]; notice: string; publishedAt: string } }
export type Page<T> = { rows: T[]; hasMore: boolean; offset: number }
const base = '/api/v1/review'
function options(company: string, region: string) { return { headers: { 'x-company-id': company, 'x-tenant-id': company, 'x-region-id': region }, timeoutMs: 20000 } }
function unwrap<T>(response: { data?: T }): T { if (response.data === undefined) throw new Error('报告响应不完整'); return response.data }
export async function listWorkpapers(company: string, region: string, offset = 0) { return unwrap(await apiGet<Page<Workpaper>>(`${base}/workpapers`, { offset }, options(company, region))) }
export async function getWorkpaper(company: string, region: string, id: string) { return unwrap(await apiGet<Workpaper>(`${base}/workpapers/${encodeURIComponent(id)}`, undefined, options(company, region))) }
export async function createWorkpaper(company: string, scope: WorkpaperScope, id: string, title: string) { return unwrap(await apiPost<Workpaper>(`${base}/workpapers`, { id, title, scope }, options(company, scope.region))) }
export async function saveWorkpaper(company: string, draft: Workpaper) { return unwrap(await apiPatch<Workpaper>(`${base}/workpapers/${encodeURIComponent(draft.id)}`, { title: draft.title, blocks: draft.blocks, summary: draft.summary, revision: draft.revision }, options(company, draft.scope.region))) }
export async function publishWorkpaper(company: string, draft: Workpaper) { return unwrap(await apiPost<Publication>(`${base}/workpapers/${encodeURIComponent(draft.id)}/publish`, { revision: draft.revision, confirmed: true }, options(company, draft.scope.region))) }
export async function listReportPublications(company: string, region: string, draftId: string, offset = 0) { return unwrap(await apiGet<Page<Pick<Publication, 'id' | 'draftId' | 'revision' | 'createdAt'> & { title: string }>>(`${base}/publications`, { draftId, offset }, options(company, region))) }
export async function getReportPublication(company: string, region: string, id: string) { return unwrap(await apiGet<Publication>(`${base}/publications/${encodeURIComponent(id)}`, undefined, options(company, region))) }
export async function captureReportEvidence(snapshot: ReviewEvidenceSnapshot, basis: ComparisonBasis, selections?: string[], thresholds?: AnalysisThresholds, topic: 'energy' | 'price' = 'energy') {
  return unwrap(await apiPost<ReportEvidence>(`${base}/evidence`, { ...topicAnalysisRequest(snapshot, basis, selections, thresholds), basis, topic }, options(snapshot.scope.company, snapshot.scope.region)))
}
export async function listReportComments(company: string, region: string, id: string, offset = 0) { return unwrap(await apiGet<Page<ReportComment>>(`${base}/workpapers/${encodeURIComponent(id)}/comments`, { offset }, options(company, region))) }
export async function addReportComment(company: string, draft: Workpaper, id: string, body: string, blockId: string | null) { return unwrap(await apiPost<ReportComment>(`${base}/workpapers/${encodeURIComponent(draft.id)}/comments`, { id, body, blockId, revision: draft.revision }, options(company, draft.scope.region))) }
export function workpaperError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 409) return '底稿已有更新或请求发生冲突。当前文字已保留，请复制未保存内容并重新读取后合并。'
    if (error.code === 403) return '当前账号不能修改这份报告。主笔可编辑发布，同事可添加批注。'
    if (error.code === 404) return '当前公司和地区内没有找到这份报告或资料。'
    if (error.code === 400) return '内容尚未通过校验，请核对标题、材料范围和原因状态。'
  }
  return '报告服务暂不可用。当前编辑已保留，请勿关闭页面，稍后重试。'
}
