import type { DailyEnergyAnalysis } from './dailyEnergy'
import { apiGet, apiPatch, apiPost, ApiError } from '@/services/api'
import type { TopicAnalysisResult, ComparisonBasis, AnalysisThresholds } from './topicAnalysis'
import { topicAnalysisRequest } from './topicAnalysis'
import type { ReviewEvidenceSnapshot } from './reviewEvidence'
import type { SettlementAnalysis, SettlementAnalysisInput } from './settlementAnalysis'
import type { DeclarationOrder } from '@/services/declarations'

export type WorkpaperScope = { region: string; view: 'generator' | 'retail' | 'storage'; objectId: string; objectLabel: string; startDate: string; endDate: string }
export type ReportBlock = { id: string; kind: 'text' | 'chart' | 'reason' | 'question' | 'action' | 'decision'; title: string; text: string; evidenceId?: string; evidenceRole?: 'primary' | 'comparison'; state?: 'pending' | 'confirmed'; supports?: string; refutes?: string; declarationId?: string; decisionVersion?: string; reference?: DecisionReference }
/**
 * 关联申报时服务端重读并冻结的副本。浏览器提交的副本一律被丢弃，已保存的引用也不会随
 * 说明文字改动而刷新——要换成新版本必须重新预览并新建一个关联块。
 */
export type DecisionReference = { declarationId: string; targetDate: string; simulated: boolean; version: string; capturedAt: string; snapshot: DeclarationOrder; notice: string }
/** 引用了同一笔申报的底稿与已发布版本；发布版本只回传标题与范围，没有正文块。 */
export type LinkedReview = { id: string; title: string; scope: WorkpaperScope; authorId: string; revision: number; createdAt: string; updatedAt: string; kind: 'draft' | 'publication' }
export type ReportEvidence = {
  id: string; region: string; authorId: string; createdAt: string; sourceKind: string; contentHash: string
  content: { labels: [string, string]; capturedAt: string; sourceNotice: string; objectLabel?: string; input: { scope: { objectId: string; companyId?: string; region?: string }; period: { date: string } } } & (
    { topic?: 'energy' | 'price'; result: TopicAnalysisResult & { periods: { current: { start: string; end: string } } } } |
    { topic: 'settlement'; result: SettlementAnalysis } |
    { topic: 'daily_energy'; result: DailyEnergyAnalysis }
  )
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
export async function listReportPublications(company: string, region: string, draftId?: string, offset = 0) { return unwrap(await apiGet<Page<Pick<Publication, 'id' | 'draftId' | 'revision' | 'createdAt'> & { title: string }>>(`${base}/publications`, { draftId, offset }, options(company, region))) }
export async function getReportPublication(company: string, region: string, id: string) { return unwrap(await apiGet<Publication>(`${base}/publications/${encodeURIComponent(id)}`, undefined, options(company, region))) }
export async function captureReportEvidence(snapshot: ReviewEvidenceSnapshot, basis: ComparisonBasis, selections?: string[], thresholds?: AnalysisThresholds, topic: 'energy' | 'price' = 'energy') {
  return unwrap(await apiPost<ReportEvidence>(`${base}/evidence`, { ...topicAnalysisRequest(snapshot, basis, selections, thresholds), basis, topic }, options(snapshot.scope.company, snapshot.scope.region)))
}
export async function captureSettlementReportEvidence(company: string, input: SettlementAnalysisInput) {
  return unwrap(await apiPost<ReportEvidence>(`${base}/evidence`, { kind: 'settlement', ...input }, options(company, input.region)))
}
export async function listReportComments(company: string, region: string, id: string, offset = 0) { return unwrap(await apiGet<Page<ReportComment>>(`${base}/workpapers/${encodeURIComponent(id)}/comments`, { offset }, options(company, region))) }
export async function addReportComment(company: string, draft: Workpaper, id: string, body: string, blockId: string | null) { return unwrap(await apiPost<ReportComment>(`${base}/workpapers/${encodeURIComponent(draft.id)}/comments`, { id, body, blockId, revision: draft.revision }, options(company, draft.scope.region))) }
/**
 * 关联前必须先预览：服务端按当前底稿版本核对主笔身份，重读这笔申报并返回关联当时的版本。
 * 预览结果只用于让交易员核对，真正的冻结副本在保存底稿时由服务端再次重读写入。
 */
export async function previewDecisionReference(company: string, draft: Workpaper, declarationId: string) {
  return unwrap(await apiPost<DecisionReference>(`${base}/workpapers/${encodeURIComponent(draft.id)}/decision-preview`, { declarationId, revision: draft.revision }, options(company, draft.scope.region)))
}
/** 从一笔申报回查引用了它的底稿与已发布版本；从底稿移除后，既有发布版本仍能查到。 */
export async function listDecisionReferences(company: string, region: string, declarationId: string, offset = 0) {
  return unwrap(await apiGet<Page<LinkedReview>>(`${base}/decision-references/${encodeURIComponent(declarationId)}`, { offset }, options(company, region)))
}
/**
 * 服务端给的业务文案，没有则空。
 *
 * `ApiError.message` 永远非空——网关或旧后端不返回 `msg` 时，api.ts 会兜一句英文传输错误。
 * 那不是业务文案，透传给交易员等于把 `API request failed: 404` 摆到页面上。
 */
function serverDetail(error: unknown) {
  if (!(error instanceof ApiError)) return ''
  const raw = error.message.trim()
  return raw && !/^API request failed:/i.test(raw) ? raw : ''
}
/**
 * 关联失败优先透传服务端文案：底稿版本冲突与申报版本冲突同为 409，但处置方式完全不同
 * （前者要重新读取底稿、后者要重新核对申报），统一成一句话会把交易员引向错误的动作。
 */
export function decisionLinkError(error: unknown) {
  return serverDetail(error) || '申报资料暂时无法读取，关联尚未建立。已填写的关联依据仍然保留，请稍后重试。'
}
export function workpaperError(error: unknown) {
  if (error instanceof ApiError) {
    // 服务端文案已是业务语言，且把 409 分成了底稿版本冲突、申报版本冲突与材料标识冲突三种，
    // 各自的处置动作不同，压成一句通用话会让交易员去做错的补救。但「内容没丢」这句安抚
    // 必须始终在场——只回一句「申报已经更新」，主笔会以为刚写的正文已经作废。
    const detail = serverDetail(error)
    if (error.code === 409) return `${detail ? (/[。！？]$/.test(detail) ? detail : `${detail}。`) : '底稿已有更新或请求发生冲突。'}当前文字已保留，请复制未保存内容并重新读取后合并。`
    if (detail) return detail
    if (error.code === 403) return '当前账号不能修改这份报告。主笔可编辑发布，同事可添加批注。'
    if (error.code === 404) return '当前公司和地区内没有找到这份报告或资料。'
    if (error.code === 400) return '内容尚未通过校验，请核对标题、材料范围和原因状态。'
  }
  return '报告服务暂不可用。当前编辑已保留，请勿关闭页面，稍后重试。'
}
