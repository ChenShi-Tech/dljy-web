// 套保维护入口接口（openspec build-midlong-spot-hedging 任务 8.6，HW-10；ChenShi-Tech/dljy#3423）。
//
// 四个维护入口（区间方案、月度发电基准、场站机制参数、核定上限）的读写都从这里出，页签只依赖本文件。
// 形状以 dljy 后端 server/hedge/{bands,baselines,mechanism}-store-pg.mjs 为准：数值是十进制字符串、未知为 null、
// 时刻为 ISO 字符串、日期为 YYYY-MM-DD。
// - hedgeApi.ts 里已有的维护端点函数原地保留，这里只把返回值收窄成具体类型；缺的端点（方案清单、追加方案版本、
//   新建机制参数）用 hedgeApi 的 request 补齐。
// - 场站清单取公司场站（/api/company/stations，与机制参数写入校验的 company.stations 同源）；交易单元清单取中长期
//   交易单元（/api/v1/midlong/subjects）。
// - 写权限声明取中长期能力接口的 canWrite：它与套保写口用同一个公司上下文（requireCompanyContext 的 canWrite）判定。

import {
  activateBand, fetchBandActivation as fetchBandActivationRaw, fetchBandPresets as fetchBandPresetsRaw,
  fetchBaselines as fetchBaselinesRaw, fetchCaps as fetchCapsRaw, fetchMechanismParams as fetchMechanismParamsRaw,
  postMechanismVersion, putBaselines as putBaselinesRaw, putCaps as putCapsRaw, request, requestBandSchemeCreate,
} from './hedgeApi'
import { fetchStations } from '@/services/company/companyApi'
import { fetchCapabilities, fetchSubjects } from '@/services/midlong/midlongApi'
import { currentRegion } from '@/services/region/regionContext'
import type { BandBasis, BandTier } from './hedgeMaintenanceModel'

// ── 区间方案（HB-01..04）─────────────────────────────────────────────────────

export interface BandTierValue {
  lower: string | null
  upper: string | null
  /** 预置方案才有：数值效力（INFERENCE 等）、出处编号与说明。 */
  origin?: string
  sources?: string[]
  note?: string
}
export type BandTiers = Partial<Record<BandTier, BandTierValue | null>>

export interface BandPreset { key: string; label: string; basis: BandBasis; scenario: string; tiers: BandTiers }
export interface BandPresetList { rows: BandPreset[]; note?: string | null }

export interface BandSchemeVersion { versionNo: number; basis: BandBasis; tiers: BandTiers | null; note: string | null; recordedAt: string | null }
export interface BandScheme { schemeId: number; name: string; origin: 'PRESET' | 'CUSTOM'; presetKey: string | null; versions: BandSchemeVersion[] }

export interface BandActivationRow {
  activationId: number | null
  schemeId: number | null
  name: string
  versionNo: number
  effectiveFrom: string | null
  effectiveTo: string | null
  reason: string | null
  activatedBy: string | null
  activatedAt: string | null
  rowVersion: number | null
}
export interface BandActivationState {
  current: BandActivationRow | null
  asOf: string | null
  active: (BandActivationRow & { basis: BandBasis | null; tiers: BandTiers | null }) | null
  history: BandActivationRow[]
}

export async function fetchBandPresets(): Promise<BandPresetList> {
  return (await fetchBandPresetsRaw()) as unknown as BandPresetList
}

export function fetchBandSchemes() {
  return request<{ rows: BandScheme[] }>('GET', '/band/schemes')
}

/** 当前生效方案与切换历史（维护页只看当前视图，不带认知时点）。 */
export async function fetchBandActivation(): Promise<BandActivationState> {
  return (await fetchBandActivationRaw({})) as unknown as BandActivationState
}

export interface BandSchemeInput { name: string; origin: 'PRESET' | 'CUSTOM'; presetKey?: string; tiers?: Record<BandTier, BandTierValue>; basis?: BandBasis; note?: string }
export interface BandSchemeCreated { schemeId: number; name: string; origin: string; presetKey: string | null; versionNo: number; basis: BandBasis }

export async function createBandScheme(body: BandSchemeInput): Promise<BandSchemeCreated> {
  return (await requestBandSchemeCreate(body)) as unknown as BandSchemeCreated
}

export function addBandSchemeVersion(schemeId: number, body: { tiers: Record<BandTier, BandTierValue>; basis: BandBasis; note?: string; baseVersionNo: number }) {
  return request<{ schemeId: number; versionNo: number; basis: BandBasis }>('POST', `/band/schemes/${encodeURIComponent(String(schemeId))}/versions`, { body })
}

export interface BandActivationInput { schemeId: number; versionNo: number; reason: string; effectiveFrom?: string; rowVersion?: number }
export interface BandActivationResult { activationId: number; schemeId: number; versionNo: number; basis: BandBasis; name: string; effectiveFrom: string; rowVersion: number }

export async function switchBandActivation(body: BandActivationInput): Promise<BandActivationResult> {
  return (await activateBand(body)) as unknown as BandActivationResult
}

// ── 月度发电基准（HG-07）────────────────────────────────────────────────────

export interface BaselineRow {
  stationId: number
  month: string
  quantityMwh: string
  basisNote: string | null
  versionNo: number
  recordedBy: string | null
  recordedAt: string | null
}
export interface BaselineInput { stationId: number; month: string; quantityMwh: string; basisNote?: string; expectedVersionNo?: number }

export async function fetchBaselines(query: { fromMonth: string; toMonth: string }): Promise<{ rows: BaselineRow[] }> {
  return (await fetchBaselinesRaw(query)) as unknown as { rows: BaselineRow[] }
}

export async function putBaselines(items: BaselineInput[]): Promise<{ rows: BaselineRow[] }> {
  return (await putBaselinesRaw(items)) as unknown as { rows: BaselineRow[] }
}

// ── 场站机制参数（HC-03 / D4）───────────────────────────────────────────────

export type MechanismStatus = 'PENDING' | 'CONFIRMED' | 'RETIRED'
export interface MechanismParamRow {
  periodKey: string
  stationId: number
  versionNo: number
  effectiveFrom: string | null
  effectiveTo: string | null
  ratio: string
  mechanismPrice: string | null
  priceUnit: string
  projectClass: string
  referenceBasis: string
  sourceNote: string | null
  status: MechanismStatus
  endReason: string | null
  overrideNote: string | null
  recordedBy: string | null
  recordedAt: string | null
}
export interface MechanismFields {
  ratio: string
  mechanismPrice: string | null
  projectClass: string
  referenceBasis: string
  effectiveFrom: string | null
  effectiveTo: string | null
  sourceNote: string | null
}

export async function fetchMechanismParams(): Promise<{ rows: MechanismParamRow[] }> {
  return (await fetchMechanismParamsRaw({})) as unknown as { rows: MechanismParamRow[] }
}

/** 新建一个生效期：后端一律以 PENDING（待确认）起步。 */
export function createMechanismParam(body: MechanismFields & { stationId: number }) {
  return request<{ periodKey: string; stationId: number; versionNo: number; status: MechanismStatus }>('POST', '/mechanism-params', { body })
}

export type MechanismVersionInput =
  | ({ action: 'EDIT'; baseVersionNo: number } & MechanismFields)
  | { action: 'CONFIRM'; baseVersionNo: number; effectiveFrom: string; effectiveTo?: string; overrideNote?: string }
  | { action: 'END'; baseVersionNo: number; endReason: string }

export async function appendMechanismVersion(periodKey: string, body: MechanismVersionInput) {
  return (await postMechanismVersion(encodeURIComponent(periodKey), { ...body })) as unknown as { periodKey: string; versionNo: number; status: MechanismStatus }
}

// ── 核定上限（HB-07）────────────────────────────────────────────────────────

export interface CapRow {
  subjectId: number
  month: string
  capMwh: string
  sourceNote: string | null
  rowVersion: number
  /** 剩余可签量（上限减中长期锁价电量）：当前 GET /caps 不返回，接口给出时才展示，否则页面显示「未提供」。 */
  remainingMwh?: string | null
}
export interface CapInput { subjectId: number; month: string; capMwh: string; sourceNote?: string; rowVersion?: number }

export async function fetchCaps(query: { fromMonth: string; toMonth: string }): Promise<{ rows: CapRow[] }> {
  return (await fetchCapsRaw(query)) as unknown as { rows: CapRow[] }
}

export async function putCaps(items: CapInput[]): Promise<{ rows: CapRow[] }> {
  return (await putCapsRaw(items)) as unknown as { rows: CapRow[] }
}

// ── 维护用清单与写权限声明 ──────────────────────────────────────────────────

export interface MaintenanceStation { id: number; name: string }
export interface MaintenanceSubject { id: number; name: string; unitCode: string | null }

function sameRegion(regionId: string | null | undefined) {
  return !regionId || regionId === currentRegion.value.id
}

/** 本公司场站清单（当前地区；未标地区的场站保留）。 */
export async function fetchMaintenanceStations(): Promise<MaintenanceStation[]> {
  const rows = await fetchStations()
  return rows
    .filter((row) => sameRegion(row.regionId) && Number.isInteger(Number(row.id)))
    .map((row) => ({ id: Number(row.id), name: String(row.name ?? '').trim() || `场站 #${row.id}` }))
}

/** 本公司交易单元清单（中长期交易单元，当前地区）。 */
export async function fetchMaintenanceSubjects(): Promise<MaintenanceSubject[]> {
  const rows = await fetchSubjects()
  return rows
    .filter((row) => sameRegion(row.regionId))
    .map((row) => ({ id: Number(row.id), name: row.displayName || row.subjectKey || `交易单元 #${row.id}`, unitCode: row.unitCode ?? null }))
}

export interface MaintenanceWriteAccess { writable: boolean; reason: string | null }

/**
 * 写权限声明：中长期能力接口的 canWrite 与套保写口同一判定（公司上下文 canWrite）。
 * 中长期模块暂停或地区未开通时该声明不代表套保写权限，返回 null（未知，写入时以 403 为准）。
 */
export async function fetchMaintenanceWriteAccess(): Promise<MaintenanceWriteAccess | null> {
  const caps = await fetchCapabilities()
  if (!caps.enabled || !caps.regionSupported) return null
  return caps.canWrite
    ? { writable: true, reason: null }
    : { writable: false, reason: '当前账号在本公司没有写权限，或正处于集团汇总只读视图' }
}
