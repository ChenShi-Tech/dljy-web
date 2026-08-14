import { apiGet, apiPatch, apiPost, apiPut, fetchRaw, type ApiRequestOptions } from '@/services/api'
import { selectedCompanyId } from '@/services/company/companyContext'
import { companyRegionId } from '@/services/region/regionCompany'
import { currentRegion, selectedRegionId } from '@/services/region/regionContext'
import type { GridDisclosureEvent, GridDisclosureOverlay, GridDisclosureProvider, GridGeoListResponse, GridGeoManifest, GridGeoNode, GridGeoNodeListResponse, GridGeoPlant, GridGeoPlantIntegrations, GridGeoPlantLocationRegistryItem, GridGeoRevision, GridGeoWeatherResponse, GridOperatorProfile, GridTopologyManifestResponse, GridTopologySnapshotResponse } from './types'
import type { GridTopologyEvidenceResponse } from './topology/gridEvidence'
import { buildGridGeoCacheScope, gridGeoCached, invalidateGridGeoCache } from './cache'

const BASE = '/v1/grid/geo-assets'

// 缓存键构造在 cache.ts（零依赖模块）单一实现，隔离门禁直接断言该生产函数。
function cacheScope() {
  return buildGridGeoCacheScope(currentRegion.value.id, selectedCompanyId.value)
}

function activeCompanyId() {
  const companyId = String(selectedCompanyId.value || '').trim()
  if (!companyId) throw new Error('请先选择当前地区的授权公司')
  const companyRegion = companyRegionId(companyId)
  if (companyRegion !== null && companyRegion !== selectedRegionId.value) {
    throw new Error('当前公司不属于所选地区，请先切换到本地区的授权公司')
  }
  return companyId
}

function scopedQuery(params: Record<string, string | number | boolean | null | undefined> = {}) {
  return { ...params, company: activeCompanyId() }
}

function scopedPath(path: string) {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}company=${encodeURIComponent(activeCompanyId())}`
}

export async function fetchGridGeoManifest(options?: ApiRequestOptions) {
  return gridGeoCached(`manifest:${cacheScope()}`, 300_000, async () => {
    const response = await apiGet<{ code: number; data: GridGeoManifest }>(`${BASE}/manifest`, scopedQuery(), options)
    return response.data
  })
}

export async function fetchGridOperatorProfile(region?: string, options?: ApiRequestOptions) {
  const response = await apiGet<{ code: number; data: GridOperatorProfile }>(`${BASE}/operator-profile`, scopedQuery(region ? { region } : {}), options)
  return response.data
}

export async function fetchGridGeoPlants(options?: ApiRequestOptions) {
  return gridGeoCached(`plants:${cacheScope()}`, 60_000, () => apiGet<GridGeoListResponse>(`${BASE}/plants`, scopedQuery(), options))
}

export async function fetchGridGeoPlant(plantId: string, options?: ApiRequestOptions) {
  const response = await apiGet<{ code: number; data: GridGeoPlant }>(`${BASE}/plants/${encodeURIComponent(plantId)}`, scopedQuery(), options)
  return response.data
}

export async function fetchGridGeoPlantIntegrations(plantId: string, options?: ApiRequestOptions) {
  return gridGeoCached(`integrations:${cacheScope()}:${plantId}`, 300_000, async () => {
    const response = await apiGet<{ code: number; data: GridGeoPlantIntegrations; sourceType: 'CONFIG'; mock: false; productionWrite: false }>(`${BASE}/plants/${encodeURIComponent(plantId)}/integrations`, scopedQuery(), options)
    return response.data
  })
}

export async function fetchGridGeoPlantLocationRegistry(options?: ApiRequestOptions) {
  const response = await apiGet<{ code: number; data: { items: GridGeoPlantLocationRegistryItem[]; summary: { total: number; verified: number; approximate: number; unresolved: number } }; sourceType: 'IMPORT'; mock: false; productionWrite: false }>(`${BASE}/plants/location-registry`, scopedQuery(), options)
  return response.data
}

export async function fetchGridGeoWeather(plantId?: string, options?: ApiRequestOptions) {
  return apiGet<GridGeoWeatherResponse>(
    `${BASE}/weather/current`,
    scopedQuery(plantId ? { plantId } : {}),
    options,
  )
}

type WriteResponse<T> = { code: number; data: { asset: T; revisionId: string; revertOf?: string | null; idempotent: boolean } }
type HistoryResponse<T> = { code: number; data: { rows: GridGeoRevision<T>[]; total: number; currentVersion: number } }

function writeOptions() {
  return { headers: { 'Idempotency-Key': globalThis.crypto?.randomUUID?.() ?? `grid-geo-${Date.now()}-${Math.random()}` } }
}

export async function updateGridGeoPlant(plantId: string, body: Record<string, unknown>) {
  const response = await apiPatch<WriteResponse<GridGeoPlant>>(scopedPath(`${BASE}/plants/${encodeURIComponent(plantId)}`), body, writeOptions())
  invalidateGridGeoCache()
  return response.data
}

export async function fetchGridGeoPlantRevisions(plantId: string, options?: ApiRequestOptions) {
  const response = await apiGet<HistoryResponse<GridGeoPlant>>(`${BASE}/plants/${encodeURIComponent(plantId)}/revisions`, scopedQuery(), options)
  return response.data
}

export async function revertGridGeoPlant(plantId: string, revisionId: string, expectedVersion: number, reason: string) {
  const response = await apiPost<WriteResponse<GridGeoPlant>>(scopedPath(`${BASE}/plants/${encodeURIComponent(plantId)}/revisions/${encodeURIComponent(revisionId)}/revert`), { expectedVersion, reason }, writeOptions())
  invalidateGridGeoCache()
  return response.data
}

export async function fetchGridGeoNodes(params: Record<string, string | number> = {}, options?: ApiRequestOptions) {
  return apiGet<GridGeoNodeListResponse>(`${BASE}/nodes`, scopedQuery(params), options)
}

export async function fetchGridTopologyManifest(options?: ApiRequestOptions) {
  return apiGet<GridTopologyManifestResponse>(`${BASE}/topology/manifest`, scopedQuery(), options)
}

export async function fetchGridTopologyEvidence(options?: ApiRequestOptions) {
  return apiGet<GridTopologyEvidenceResponse>(`${BASE}/topology/evidence`, scopedQuery(), options)
}

export async function fetchGridTopologySnapshot(params: Record<string, string | number> = {}, options?: ApiRequestOptions) {
  return apiGet<GridTopologySnapshotResponse>(`${BASE}/topology/snapshot`, scopedQuery(params), options)
}

function numericHeader(response: Response, name: string) {
  const value = response.headers.get(name)
  if (value === null || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function fetchGridTopologySnapshotPage(params: Record<string, string | number> = {}, options?: ApiRequestOptions) {
  const raw = await fetchRaw(`${BASE}/topology/snapshot`, scopedQuery(params), { signal: options?.signal })
  const response = await raw.json() as GridTopologySnapshotResponse & { msg?: string }
  if (!raw.ok || response.code >= 400 || !response.data) throw new Error(response.msg || `授权网架快照请求失败（${raw.status}）`)
  const budgetStatus: 'PASS' | 'REJECTED' | null = (() => {
    const value = raw.headers.get('x-grid-topology-budget-status')
    return value === 'PASS' || value === 'REJECTED' ? value : null
  })()
  const sloStatus: 'PASS' | 'SLOW' | null = (() => {
    const value = raw.headers.get('x-grid-topology-slo-status')
    return value === 'PASS' || value === 'SLOW' ? value : null
  })()
  return {
    response,
    transport: {
      durationMs: numericHeader(raw, 'x-grid-topology-duration-ms'),
      responseBytes: numericHeader(raw, 'x-grid-topology-response-bytes'),
      positionCount: numericHeader(raw, 'x-grid-topology-position-count'),
      budgetStatus,
      sloStatus,
    },
  }
}

export async function fetchGridGeoNode(nodeId: string, options?: ApiRequestOptions) {
  const response = await apiGet<{ code: number; data: GridGeoNode }>(`${BASE}/nodes/${encodeURIComponent(nodeId)}`, scopedQuery(), options)
  return response.data
}

export async function createGridGeoNode(body: Record<string, unknown>) {
  const response = await apiPost<WriteResponse<GridGeoNode>>(scopedPath(`${BASE}/nodes`), body, writeOptions())
  invalidateGridGeoCache()
  return response.data
}

export async function updateGridGeoNode(nodeId: string, body: Record<string, unknown>) {
  const response = await apiPatch<WriteResponse<GridGeoNode>>(scopedPath(`${BASE}/nodes/${encodeURIComponent(nodeId)}`), body, writeOptions())
  invalidateGridGeoCache()
  return response.data
}

export async function fetchGridGeoNodeRevisions(nodeId: string, options?: ApiRequestOptions) {
  const response = await apiGet<HistoryResponse<GridGeoNode>>(`${BASE}/nodes/${encodeURIComponent(nodeId)}/revisions`, scopedQuery(), options)
  return response.data
}

export async function revertGridGeoNode(nodeId: string, revisionId: string, expectedVersion: number, reason: string) {
  const response = await apiPost<WriteResponse<GridGeoNode>>(scopedPath(`${BASE}/nodes/${encodeURIComponent(nodeId)}/revisions/${encodeURIComponent(revisionId)}/revert`), { expectedVersion, reason }, writeOptions())
  invalidateGridGeoCache()
  return response.data
}

export async function fetchGridDisclosureProviders(options?: ApiRequestOptions) {
  const response = await apiGet<{ code: number; data: { providers: GridDisclosureProvider[]; contractVersion: string } }>(`${BASE}/disclosures/providers`, scopedQuery(), options)
  return response.data
}

export async function fetchGridDisclosureEvents(params: Record<string, string | number> = {}, options?: ApiRequestOptions) {
  const response = await apiGet<{ code: number; data: { items: GridDisclosureEvent[]; total: number; page: number; pageSize: number; categories: string[]; dataAvailability: { status: 'available' | 'missing' | 'not-configured'; reason: string; fallback: false } } }>(`${BASE}/disclosures/events`, scopedQuery(params), options)
  return response.data
}

export async function fetchGridDisclosureEvent(eventId: string, options?: ApiRequestOptions) {
  const response = await apiGet<{ code: number; data: { event: GridDisclosureEvent; overlays: GridDisclosureOverlay[] } }>(`${BASE}/disclosures/events/${encodeURIComponent(eventId)}`, scopedQuery(), options)
  return response.data
}

export async function saveGridDisclosureOverlay(eventId: string, body: { scope: 'company' | 'user'; favorite: boolean; note: string; tags: string[]; expectedVersion: number }) {
  const response = await apiPut<{ code: number; data: { overlay: GridDisclosureOverlay } }>(scopedPath(`${BASE}/disclosures/events/${encodeURIComponent(eventId)}/overlay`), body)
  return response.data.overlay
}
