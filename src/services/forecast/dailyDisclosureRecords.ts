// 当日文本披露：复用统一身份请求，独立于模型预测和数据库事件摘要。
import { apiGet, type ApiRequestOptions } from '@/services/api'
import { selectedCompanyId } from '@/services/company/companyContext'
import { companyRegionId } from '@/services/region/regionCompany'

const BASE = '/api/v1/grid/geo-assets/disclosures/daily-records'

export interface DisclosureRecordDataset {
  id: string
  title: string
  category: string
  description: string
}
export interface DisclosureRecordCatalog {
  regionId: string
  datasets: DisclosureRecordDataset[]
  limitations?: string[]
}
export interface DisclosureRecordPage {
  regionId: string
  date: string
  datasetId: string
  title: string
  category: string
  columns: string[]
  items: Record<string, string>[]
  total: number
  page: number
  pageSize: number
  scopeCounts: Record<string, number>
  sourceRowCount: number
  excludedRegionCount: number
  coverage: { from: string | null; to: string | null }
  dataAvailability: { status: 'available' | 'empty' | 'missing'; reason: string; fallback: false }
  source: { sourceTable: string; sourceFiles: string[]; license: string; originalUrl: null }
}

function scopedQuery(region: string) {
  if (region !== 'yunnan') throw new Error('文本披露当前仅接入云南及明确标注的南网全网记录')
  const company = selectedCompanyId.value.trim()
  if (!company) throw new Error('请先选择当前地区的授权公司')
  const companyRegion = companyRegionId(company)
  if (companyRegion && companyRegion !== region) throw new Error('当前公司不属于所选地区')
  return { region, company }
}

function realData<T>(value: unknown): T {
  const response = value as { code?: number; data?: T; sourceType?: string; mock?: boolean; productionWrite?: boolean }
  if (response?.code !== 200 || response.sourceType !== 'IMPORT' || response.mock !== false || response.productionWrite !== false || !response.data) {
    throw new Error('披露接口未返回已导入的真实记录，已拒绝展示')
  }
  return response.data
}

function validCount(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 }
function stringList(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string') }
function validMetadata(result: DisclosureRecordPage, requestedPage: number) {
  return result.page === requestedPage && result.pageSize === 20
    && validCount(result.sourceRowCount) && validCount(result.excludedRegionCount)
    && result.scopeCounts && typeof result.scopeCounts === 'object' && !Array.isArray(result.scopeCounts)
    && Object.values(result.scopeCounts).every(validCount)
    && result.coverage && ['from', 'to'].every((key) => {
      const value = result.coverage[key as 'from' | 'to']
      return value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
    }) && result.source && typeof result.source.sourceTable === 'string'
    && typeof result.source.license === 'string' && stringList(result.source.sourceFiles)
    && result.source.originalUrl === null && typeof result.dataAvailability?.reason === 'string'
}

export async function loadDisclosureRecordCatalog(region: string, options?: ApiRequestOptions): Promise<DisclosureRecordCatalog> {
  const result = realData<DisclosureRecordCatalog>(await apiGet(BASE + '/catalog', scopedQuery(region), options))
  if (result.regionId !== region || !Array.isArray(result.datasets)
    || result.datasets.some((item) => !item || !item.id || typeof item.title !== 'string' || typeof item.description !== 'string')
    || new Set(result.datasets.map((item) => item.id)).size !== result.datasets.length
    || (result.limitations !== undefined && !stringList(result.limitations))) {
    throw new Error('文本来源目录或地区不匹配')
  }
  return result
}

export async function loadDisclosureRecordPage(
  region: string, date: string, dataset: string,
  query: { page?: number; keyword?: string } = {}, options?: ApiRequestOptions,
): Promise<DisclosureRecordPage> {
  const parsedDate = new Date(date + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error('请选择有效的记录日期')
  }
  const result = realData<DisclosureRecordPage>(await apiGet(BASE, {
    ...scopedQuery(region), date, dataset, page: query.page ?? 1, pageSize: 20, keyword: query.keyword?.trim() || '',
  }, options))
  if (result.regionId !== region || result.date !== date || result.datasetId !== dataset || !Array.isArray(result.items)
    || !stringList(result.columns) || !validCount(result.total) || !validMetadata(result, query.page ?? 1)
    || !['available', 'empty', 'missing'].includes(result.dataAvailability?.status) || result.dataAvailability.fallback !== false
    || result.items.some((row) => !row || typeof row !== 'object' || Object.values(row).some((value) => typeof value !== 'string')
      || row.operate_date !== date || !['云南省内', '南网全网（未分省）'].includes(row['统计范围'] ?? ''))) {
    throw new Error('披露记录的日期、范围或数据状态不匹配，已拒绝展示')
  }
  return result
}
