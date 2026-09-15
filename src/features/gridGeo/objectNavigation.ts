import type { GridGeoPlant, GridGeoNode, GridDisclosureOverlay } from './types'

export type GridObjectReference = {
  kind: 'plant' | 'node' | 'disclosure'
  id: string
  regionId: string
  gridOperator?: string
}
export type GridObjectDetail = {
  reference: GridObjectReference
  name: string
  objectType: string
  capacityMw: number | null
  voltageLevelKv: number | null
  stationName: string | null
  location: { label: string; longitude: number | null; latitude: number | null; status: string }
  relations: {
    plants: Array<{ id: string; name: string; regionId: string }>
    nodes: Array<{ id: string; name: string; regionId: string }>
  }
  disclosureFilter: { objectKind: string; objectId: string }
  metricRefs?: Array<{ metricId: string; channel: string }>
  overlays: Array<Omit<GridDisclosureOverlay, 'eventId'> & { eventId?: string }>
  source: { label: string; updatedAt: string | null; updatedAtBasis?: 'asset-updated' | 'source-imported'; evidence: Array<{ title: string; url: string }> }
  plant?: GridGeoPlant
  node?: GridGeoNode
}
export type GridObjectNavigationContext = {
  companyId: string; date?: string; from?: string; to?: string; returnTo?: string
}
type Query = Record<string, unknown>
const objectKeys = ['objectKind', 'objectId', 'objectRegion', 'objectCompany', 'objectDate', 'objectFrom', 'objectTo', 'returnTo']
export function queryText(value: unknown): string { return typeof value === 'string' ? value : '' }
export function validObjectDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}
export function hasGridObjectQuery(query: Query) { return objectKeys.slice(0, 4).some(key => query[key] !== undefined) }
export function readGridObjectQuery(query: Query, scope: { regionId: string; companyId: string | null | undefined }): GridObjectReference | null {
  const kind = queryText(query.objectKind), id = queryText(query.objectId)
  if (!['plant', 'node', 'disclosure'].includes(kind) || !id || id.length > 240 || /[\u0000-\u001f]/.test(id)) return null
  if (!scope.companyId || query.objectRegion !== scope.regionId || query.objectCompany !== scope.companyId) return null
  return { kind: kind as GridObjectReference['kind'], id, regionId: scope.regionId }
}
export function readGridObjectWindow(query: Query) {
  const from = queryText(query.objectFrom), to = queryText(query.objectTo)
  // Only explicit instants can be carried between pages. A date alone is not a timed interval.
  const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/
  if (!instant.test(from) || !instant.test(to) || !validObjectDate(from.slice(0, 10)) || !validObjectDate(to.slice(0, 10)) || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) > Date.parse(to)) return null
  return { from, to }
}
export function safeGridReturnPath(value: unknown): string | undefined {
  const path = queryText(value)
  if (!/^\/grid-assets\/(command|nodes|topology|disclosures|market|weather-impact)(?:\?|$)/.test(path) || /[\\\u0000-\u001f]/.test(path) || path.length > 4000) return undefined
  return path
}
export function clearGridObjectQuery(query: Query) {
  return Object.fromEntries(Object.entries(query).filter(([key]) => !objectKeys.includes(key)))
}
export function buildGridObjectLocation(path: string, reference: GridObjectReference, context: GridObjectNavigationContext) {
  const query: Record<string, string> = {
    objectKind: reference.kind, objectId: reference.id, objectRegion: reference.regionId, objectCompany: context.companyId,
  }
  if (validObjectDate(context.date)) query.objectDate = context.date
  const window = readGridObjectWindow({ objectFrom: context.from, objectTo: context.to })
  if (window) { query.objectFrom = window.from; query.objectTo = window.to }
  const returnTo = safeGridReturnPath(context.returnTo)
  if (returnTo) query.returnTo = returnTo
  return { path, query }
}
