// 当日披露事件：只读取最新 grid.disclosure_events 规范化事件契约。
import { apiGet, type ApiRequestOptions } from '@/services/api'
import { selectedCompanyId } from '@/services/company/companyContext'
import { effectiveCompanyRegionId } from '@/services/company/practiceCompany'

const BASE = '/v1/grid/geo-assets/disclosures/events'
const PAGE_SIZE = 20

export type DisclosureEventCategory = 'maintenance' | 'outage' | 'intervention' | 'congestion' | 'constraint'

const CATEGORY_META: Record<DisclosureEventCategory, { title: string; description: string }> = {
  maintenance: { title: '检修计划', description: '已导入数据库的输变电设备及电网检修事件。' },
  outage: { title: '非计划停运', description: '已导入数据库的发电厂或机组非计划停运事件。' },
  intervention: { title: '人工干预', description: '已导入数据库的市场人工干预事件。' },
  congestion: { title: '断面阻塞', description: '已导入数据库的市场出清断面阻塞事件。' },
  constraint: { title: '断面约束', description: '已导入数据库的输电断面约束事件。' },
}

export interface DisclosureRecordDataset {
  id: DisclosureEventCategory
  title: string
  category: DisclosureEventCategory
  description: string
}

export interface DisclosureRecordCatalog {
  regionId: string
  datasets: DisclosureRecordDataset[]
  limitations?: string[]
}

export interface DisclosureRecordEvent {
  eventId: string
  providerId: string
  category: DisclosureEventCategory
  title: string
  summary: string
  regionId: string
  spatialBinding: {
    kind: 'region' | 'grid' | 'section'
    ref: string | null
    label: string
    coordinates: null
  }
  effectiveAt: string
  expiresAt: string | null
  publishedAt: string | null
  source: {
    file: string
    recordId: string
    url: string | null
    sourceTable: string
    sourceType: 'IMPORT'
    mock: false
    productionWrite: false
    dataAvailability: 'available'
    license: string
    originalLinkStatus: string
  }
  confidence: 'verified-source-row'
  importedAt: string
}

export interface DisclosureRecordPage {
  regionId: string
  date: string
  datasetId: DisclosureEventCategory
  title: string
  category: DisclosureEventCategory
  items: DisclosureRecordEvent[]
  total: number
  page: number
  pageSize: number
  dataAvailability: {
    status: 'available' | 'missing'
    reason: string
    fallback: false
    regionRequested: string
  }
  categories: DisclosureEventCategory[]
  storage: { sourceType: 'DB'; mock: false; productionWrite: false }
}

interface DisclosureEventResponse {
  items: DisclosureRecordEvent[]
  total: number
  page: number
  pageSize: number
  dataAvailability: DisclosureRecordPage['dataAvailability'] | {
    status: 'not-configured'
    reason: string
    fallback: false
    regionRequested: string
  }
  categories: DisclosureEventCategory[]
}

function scopedQuery(region: string) {
  if (region !== 'yunnan') throw new Error('披露事件当前仅接入云南及明确标注的南网全网记录')
  const company = selectedCompanyId.value.trim()
  if (!company) throw new Error('请先选择当前地区的授权公司')
  // 练习公司按上级公司的地区判断（#3403 · codex R1-02）
  const companyRegion = effectiveCompanyRegionId(company)
  if (companyRegion && companyRegion !== region) throw new Error('当前公司不属于所选地区')
  return { region, company }
}

function realDatabaseData<T>(value: unknown): T {
  const response = value as { code?: number; data?: T; sourceType?: string; mock?: boolean; productionWrite?: boolean }
  if (response?.code !== 200 || response.sourceType !== 'DB' || response.mock !== false
    || response.productionWrite !== false || !response.data) {
    throw new Error('披露接口未返回数据库中的真实事件，已拒绝展示')
  }
  return response.data
}

function validCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function validDate(date: string) {
  const parsed = new Date(date + 'T00:00:00Z')
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

function yunnanCalendarDate(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return new Date(parsed.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10)
}

function validOptionalTime(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && !Number.isNaN(new Date(value).getTime()))
}

function validSource(source: unknown): source is DisclosureRecordEvent['source'] {
  if (!source || typeof source !== 'object') return false
  const item = source as Partial<DisclosureRecordEvent['source']>
  return typeof item.file === 'string' && Boolean(item.file.trim())
    && typeof item.recordId === 'string' && Boolean(item.recordId.trim())
    && typeof item.sourceTable === 'string' && Boolean(item.sourceTable.trim())
    && item.sourceType === 'IMPORT' && item.mock === false && item.productionWrite === false
    && item.dataAvailability === 'available' && typeof item.license === 'string'
    && typeof item.originalLinkStatus === 'string'
    && (item.url === null || (typeof item.url === 'string' && /^https?:\/\//i.test(item.url)))
}

function validEvent(
  item: unknown,
  region: string,
  expectedCategory?: DisclosureEventCategory,
  expectedDate?: string,
): item is DisclosureRecordEvent {
  if (!item || typeof item !== 'object') return false
  const event = item as Partial<DisclosureRecordEvent>
  const binding = event.spatialBinding
  return typeof event.eventId === 'string' && Boolean(event.eventId.trim())
    && typeof event.providerId === 'string' && Boolean(event.providerId.trim())
    && typeof event.title === 'string' && Boolean(event.title.trim())
    && typeof event.summary === 'string'
    && typeof event.regionId === 'string' && [region, 'csg'].includes(event.regionId)
    && typeof event.category === 'string' && event.category in CATEGORY_META
    && (!expectedCategory || event.category === expectedCategory)
    && typeof event.effectiveAt === 'string' && !Number.isNaN(new Date(event.effectiveAt).getTime())
    && (!expectedDate || yunnanCalendarDate(event.effectiveAt) === expectedDate)
    && validOptionalTime(event.expiresAt) && validOptionalTime(event.publishedAt)
    && typeof event.importedAt === 'string' && !Number.isNaN(new Date(event.importedAt).getTime())
    && event.confidence === 'verified-source-row'
    && Boolean(binding) && ['region', 'grid', 'section'].includes(binding?.kind ?? '')
    && typeof binding?.label === 'string' && Boolean(binding.label.trim())
    && (binding.ref === null || typeof binding.ref === 'string') && binding.coordinates === null
    && validSource(event.source)
}

function validCategories(value: unknown): value is DisclosureEventCategory[] {
  return Array.isArray(value) && value.length > 0
    && value.every((item) => typeof item === 'string' && item in CATEGORY_META)
    && new Set(value).size === value.length
}

function validResponse(
  result: DisclosureEventResponse,
  region: string,
  requestedPage: number,
  requestedPageSize: number,
  category?: DisclosureEventCategory,
  date?: string,
) {
  const expectedStatus = result.total > 0 ? 'available' : 'missing'
  return Array.isArray(result.items) && validCount(result.total) && result.total >= result.items.length
    && result.page === requestedPage && result.pageSize === requestedPageSize
    && validCategories(result.categories)
    && result.dataAvailability?.status === expectedStatus
    && result.dataAvailability.fallback === false
    && result.dataAvailability.regionRequested === region
    && typeof result.dataAvailability.reason === 'string'
    && result.items.every((item) => validEvent(item, region, category, date))
}

export async function loadDisclosureRecordCatalog(region: string, options?: ApiRequestOptions): Promise<DisclosureRecordCatalog> {
  const result = realDatabaseData<DisclosureEventResponse>(await apiGet(BASE, {
    ...scopedQuery(region), page: 1, pageSize: 1,
  }, options))
  if (!validResponse(result, region, 1, 1)) throw new Error('披露事件类别或数据库响应不匹配')
  return {
    regionId: region,
    datasets: result.categories.map((id) => ({ id, category: id, ...CATEGORY_META[id] })),
    limitations: ['这里展示 PostgreSQL 中的规范化事件与溯源字段，不等同于原始 CSV 全字段；未入库字段不会推测或补齐。'],
  }
}

export async function loadDisclosureRecordPage(
  region: string,
  date: string,
  dataset: string,
  query: { page?: number; keyword?: string } = {},
  options?: ApiRequestOptions,
): Promise<DisclosureRecordPage> {
  if (!validDate(date)) throw new Error('请选择有效的记录日期')
  if (!(dataset in CATEGORY_META)) throw new Error('请选择有效的披露事件类别')
  const category = dataset as DisclosureEventCategory
  const page = query.page ?? 1
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('请选择有效的页码')
  const result = realDatabaseData<DisclosureEventResponse>(await apiGet(BASE, {
    ...scopedQuery(region), category, keyword: query.keyword?.trim() || '', page, pageSize: PAGE_SIZE,
    from: `${date}T00:00:00+08:00`, to: `${date}T23:59:59+08:00`,
  }, options))
  if (!validResponse(result, region, page, PAGE_SIZE, category, date)
    || result.dataAvailability.status === 'not-configured') {
    throw new Error('披露事件的日期、地区、类别或数据状态不匹配，已拒绝展示')
  }
  return {
    regionId: region,
    date,
    datasetId: category,
    title: CATEGORY_META[category].title,
    category,
    items: result.items,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    dataAvailability: result.dataAvailability,
    categories: result.categories,
    storage: { sourceType: 'DB', mock: false, productionWrite: false },
  }
}
