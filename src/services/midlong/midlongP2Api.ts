// 中长期售电 P2 前端服务层（dljy#2971，后端契约 dljy#2970 `/api/v1/midlong/*` 的分时分解与场站分配部分）。
//
// 与 P1 服务层同一套约束（见 midlongApi.ts）：读请求带 `company`，未选公司不发请求；写请求幂等键由「动作 + 公司 + 提交内容」派生，
// 同一内容的重试 / 双击落到同一次执行；错误保留服务端错误码（VERSION_CONFLICT、PREVIEW_STALE、INCOMPLETE_BASIS 等）。
// 能力开关：页面按 `capabilities.modules.curves / stationAllocations` 决定是否出现入口，关闭时不调用本文件的接口。
import { apiGet, apiPost } from '@/services/api'
import { companyUnselected } from '@/services/company/companyApi'
import { selectedCompanyId } from '@/services/company/companyContext'
import { CompanyNotSelectedError, actionKey, contentFingerprint } from './midlongApi'
import type { MidlongCapabilities, MidlongCsvExport } from './midlongTypes'
import type {
  ContractCurvesOverview, ContractStationAllocationsOverview, CurveConfirmResult, CurveDraftInput, CurveDraftResult, CurveEstimateInput,
  CurveSetDetail, CurveTemplateFiles, IntervalPositionQuery, IntervalPositionReport, P2DiscardResult, StationAllocationConfirmResult,
  StationAllocationDraftInput, StationAllocationDraftResult, StationAllocationSetDetail, StationPositionQuery, StationPositionReport,
} from './midlongP2Types'

const BASE = '/api/v1/midlong'
type Query = Record<string, string | number | boolean | null | undefined>
type Envelope<T> = { data?: T }

function dataOf<T>(res: Envelope<T>): T {
  if (res.data === undefined || res.data === null) throw new Error('接口响应缺少数据')
  return res.data
}

function readQuery(extra: Query = {}): Query {
  if (companyUnselected()) throw new CompanyNotSelectedError()
  return { company: selectedCompanyId.value, ...extra }
}

function writePath(path: string): string {
  if (companyUnselected()) throw new CompanyNotSelectedError()
  return `${path}?${new URLSearchParams({ company: selectedCompanyId.value })}`
}

const withKey = (key: string) => ({ headers: { 'Idempotency-Key': key } })

/** 能力开关读取：P1 契约里的 modules 类型尚未列出 P2 两项，按名称读取，缺省视为未开通。 */
export function p2ModuleOn(caps: MidlongCapabilities | null | undefined, name: 'curves' | 'stationAllocations'): boolean {
  return Boolean(caps?.enabled && caps.regionSupported && (caps.modules as Record<string, boolean | undefined>)[name] === true)
}

/** 曲线草稿的幂等键：文件内容按长度 + 全文指纹参与，逐时段数据按规范 JSON 参与。 */
function curveDraftKey(contractId: number, input: CurveDraftInput): string {
  const files = (input.files ?? []).map((f) => [f.role, f.fileName, f.contentBase64.length, contentFingerprint(f.contentBase64)])
  return actionKey('curve-draft', [contractId, { ...input, files }])
}

// ── 分时分解 ─────────────────────────────────────────────────────────────────

export async function fetchCurveTemplate(format: 'xlsx' | 'csv'): Promise<CurveTemplateFiles> {
  return dataOf(await apiGet<Envelope<CurveTemplateFiles>>(`${BASE}/curves/template`, readQuery({ format })))
}

export async function fetchContractCurves(contractId: number): Promise<ContractCurvesOverview> {
  return dataOf(await apiGet<Envelope<ContractCurvesOverview>>(`${BASE}/contracts/${contractId}/curves`, readQuery()))
}

export async function createCurveDraft(contractId: number, input: CurveDraftInput): Promise<CurveDraftResult> {
  return dataOf(await apiPost<Envelope<CurveDraftResult>>(writePath(`${BASE}/contracts/${contractId}/curves`), input, withKey(curveDraftKey(contractId, input))))
}

export async function createCurveEstimate(contractId: number, input: CurveEstimateInput): Promise<CurveDraftResult> {
  return dataOf(await apiPost<Envelope<CurveDraftResult>>(writePath(`${BASE}/contracts/${contractId}/curves/estimate`), input, withKey(actionKey('curve-estimate', [contractId, input]))))
}

export async function fetchCurveSet(curveSetId: number, date?: string | null): Promise<CurveSetDetail> {
  return dataOf(await apiGet<Envelope<CurveSetDetail>>(`${BASE}/curves/${curveSetId}`, readQuery(date ? { date } : {})))
}

export async function confirmCurveSet(curveSetId: number, body: { evidenceIds?: number[]; note?: string }): Promise<CurveConfirmResult> {
  return dataOf(await apiPost<Envelope<CurveConfirmResult>>(writePath(`${BASE}/curves/${curveSetId}/confirm`), body, withKey(actionKey('curve-confirm', [curveSetId, body]))))
}

export async function discardCurveSet(curveSetId: number, reason: string): Promise<P2DiscardResult> {
  return dataOf(await apiPost<Envelope<P2DiscardResult>>(writePath(`${BASE}/curves/${curveSetId}/discard`), { reason }, withKey(actionKey('curve-discard', [curveSetId, reason]))))
}

// ── 场站分配 ─────────────────────────────────────────────────────────────────

export async function fetchContractStationAllocations(contractId: number): Promise<ContractStationAllocationsOverview> {
  return dataOf(await apiGet<Envelope<ContractStationAllocationsOverview>>(`${BASE}/contracts/${contractId}/station-allocations`, readQuery()))
}

export async function createStationAllocationDraft(contractId: number, input: StationAllocationDraftInput): Promise<StationAllocationDraftResult> {
  return dataOf(await apiPost<Envelope<StationAllocationDraftResult>>(writePath(`${BASE}/contracts/${contractId}/station-allocations`), input,
    withKey(actionKey('station-allocation-draft', [contractId, input]))))
}

export async function fetchStationAllocationSet(allocationSetId: number): Promise<StationAllocationSetDetail> {
  return dataOf(await apiGet<Envelope<StationAllocationSetDetail>>(`${BASE}/station-allocations/${allocationSetId}`, readQuery()))
}

export async function confirmStationAllocationSet(allocationSetId: number, body: { evidenceIds?: number[]; basisNote?: string }): Promise<StationAllocationConfirmResult> {
  return dataOf(await apiPost<Envelope<StationAllocationConfirmResult>>(writePath(`${BASE}/station-allocations/${allocationSetId}/confirm`), body,
    withKey(actionKey('station-allocation-confirm', [allocationSetId, body]))))
}

export async function discardStationAllocationSet(allocationSetId: number, reason: string): Promise<P2DiscardResult> {
  return dataOf(await apiPost<Envelope<P2DiscardResult>>(writePath(`${BASE}/station-allocations/${allocationSetId}/discard`), { reason },
    withKey(actionKey('station-allocation-discard', [allocationSetId, reason]))))
}

// ── 分时 / 场站持仓 ──────────────────────────────────────────────────────────

export async function fetchIntervalPositions(query: IntervalPositionQuery): Promise<IntervalPositionReport> {
  return dataOf(await apiGet<Envelope<IntervalPositionReport>>(`${BASE}/positions/intervals`, readQuery({ ...query } as Query)))
}

export async function exportIntervalPositions(query: IntervalPositionQuery): Promise<MidlongCsvExport> {
  return dataOf(await apiGet<Envelope<MidlongCsvExport>>(`${BASE}/positions/intervals/export`, readQuery({ ...query } as Query)))
}

export async function fetchStationPositions(query: StationPositionQuery): Promise<StationPositionReport> {
  return dataOf(await apiGet<Envelope<StationPositionReport>>(`${BASE}/positions/stations`, readQuery({ ...query } as Query)))
}

export async function exportStationPositions(query: StationPositionQuery): Promise<MidlongCsvExport> {
  return dataOf(await apiGet<Envelope<MidlongCsvExport>>(`${BASE}/positions/stations/export`, readQuery({ ...query } as Query)))
}
