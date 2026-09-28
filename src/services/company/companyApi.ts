import { apiDelete, apiGet, apiPatch, apiPost } from '@/services/api'
import { selectedCompanyId, setCompanyOptions, type CompanyOption } from '@/services/company/companyContext'
import { companyRegionId } from '@/services/region/regionCompany'
import { selectedRegionId } from '@/services/region/regionContext'
import type { Infer } from 'shared/schema/define.mjs'
import type { LegacyMidlongManagement } from '@/services/midlong/midlongTypes'
import {
  stationSchema, unitSchema, unitOutputSchema, tradeSchema, profileSchema,
  contractSchema, contractDetailSchema, MARKET_TYPES, TRADE_MODES, CONTRACT_STATUSES
} from 'shared/schema/entities/company.mjs'

// server 托管字段（落库后由后端补全，不在可编辑 schema 中）。
type ServerManaged = { id: number; companyId: string; source: 'IMPORT' | 'MANUAL' | 'CAPTURE'; createdAt?: string; updatedAt?: string }

// 公司专属业务数据前端服务层。所有请求带 company 维度（=当前公司上下文），
// 后端 /api/company/* 以会话解析的 companyId 为权威并经下属公司白名单校验。
// 公共电网数据走 captured.ts/fetchCaptured，不经此层。

// 实体类型由 shared/schema 的运行时 schema 单一来源派生（mart 字段）+ server 托管字段。
// 增删字段只需改 shared/schema/entities/company.mjs，前后端同步、无重复定义。
export type CompanyStation = Infer<typeof stationSchema> & ServerManaged
export type CompanyUnit = Infer<typeof unitSchema> & ServerManaged
export type CompanyUnitOutput = Infer<typeof unitOutputSchema> & ServerManaged & {
  timePoint?: string
  granularity?: 'PT1H' | 'PT15M' | string
  sourceType?: string
  mock?: boolean
  productionWrite?: boolean
  dataType?: string
  plant?: string
}
export type CompanyTrade = Infer<typeof tradeSchema> & ServerManaged
export type CompanyProfile = Infer<typeof profileSchema> & { companyId: string }
export type CompanyContract = Infer<typeof contractSchema> & ServerManaged & {
  // 执行跟踪派生字段：后端按 contractCode 关联 company_trades 聚合已成交电量（只读，不入库）
  executedVolume?: number
  tradeCount?: number
  contractType?: string
  ownerDomain?: 'market-trading' | 'retail-settlement' | 'unknown'
  blocked?: boolean
  contractId?: number | null
  // dljy#2938：已纳入中长期售电底账的合同，旧列表补充纳管状态；此类合同在旧入口只读，编辑走新页面。
  midlong?: LegacyMidlongManagement
}
export type CompanyContractDetail = Infer<typeof contractDetailSchema> & { id: number; companyId: string; contractId: number; createdAt?: string; updatedAt?: string }
// 创建/编辑合同时可随主体附带交易明细数组（后端整体替换该合同明细）。
export type CompanyContractPayload = Partial<CompanyContract> & { details?: Partial<CompanyContractDetail>[] }

// 合同枚举（值来自 shared/schema 单一来源）与中文标签映射。
export { MARKET_TYPES, TRADE_MODES, CONTRACT_STATUSES }
export const MARKET_TYPE_LABELS: Record<string, string> = {
  annual_bilateral: '年度双边直接交易',
  annual_centralized: '年度集中直接交易',
  monthly_bilateral: '月度双边',
  monthly_centralized: '月度集中竞价',
  intraday_matching: '日内撮合',
  day_ahead: '日前市场',
  real_time: '实时市场',
  provincial_green_annual: '省内绿电(年度)',
  provincial_green_monthly: '省内绿电(月度)',
  cross_provincial_green_annual: '跨省绿电(年度)',
  cross_provincial_green_monthly: '跨省绿电(月度)'
}
export const TRADE_MODE_LABELS: Record<string, string> = {
  bilateral: '双边协商', centralized: '集中交易', listing: '挂牌交易', matching: '撮合交易'
}
export const CONTRACT_STATUS_LABELS: Record<string, string> = {
  draft: '草稿', active: '执行中', expired: '已过期', cancelled: '已取消'
}

type RowsResponse<T> = { rows?: T[] }
type DataResponse<T> = { data?: T }
type CompanyWriteOptions = { idempotencyKey?: string }

function companyWriteOptions(options?: CompanyWriteOptions) {
  return options?.idempotencyKey ? { headers: { 'Idempotency-Key': options.idempotencyKey } } : undefined
}

// 空态守卫（#668 规则 4job355+job361）：「请选择公司」空态下不得发单公司请求
// 空 company 会被后端回退到会话主公司，造成 UI 空态提示与实际读写数据不一致的静默访问。
// 读写分治：读请求空态短路返回空结果（页面既有 selectedCompanyId watch 触发 reload 拿到
// 空数据即清空上一家公司的旧数据；若抛错，页面 catch 只提示、旧数据残留与空态提示并存）；
// 写请求 fail-fast 抛错（宁断不写错租户）。例外：显式 scope='group' 的集团汇总读不依赖
// 单公司选择，空态放行且省略 company 参数（服务端按会话 home + scope=group 计算授权范围）。
// 「无效」= 空态，或已选公司是其它地区的专属公司：currentCompanyId
// 先从 localStorage 恢复，部分页面在 refreshCompanyOptions() 校准前就发请求，竞态窗口内
// 带 stale 跨地区公司会造成串读/误写，故与空态同等对待（GROUP 等无地区归属公司视为有效）。
export function companyUnselected(): boolean {
  const company = selectedCompanyId.value
  if (!company) return true
  const region = companyRegionId(company)
  return region !== null && region !== selectedRegionId.value
}

function requireSelectedCompany(): string {
  const company = selectedCompanyId.value
  if (companyUnselected()) {
    throw new Error('当前地区尚未选择有效公司，请先在公司切换器中选择本地区公司后再访问公司数据')
  }
  return company
}

// 写请求（POST/PATCH/DELETE）把 company 拼到 path query，确保切换公司时定向正确（GET 走 query 参数）。
function withCompany(path: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ company: requireSelectedCompany(), ...extra })
  return `${path}?${params.toString()}`
}

function listQuery(extra: Record<string, string | number | undefined> = {}) {
  // 无效上下文（空态/跨地区 stale）仅 scope=group 读路径可达（单公司读已在各 fetch 短路）：
  // 省略 company，服务端按登录会话 home company + scope=group 计算授权范围。
  return companyUnselected() ? { ...extra } : { company: selectedCompanyId.value, ...extra }
}

// ---- 可见公司列表（切换下拉）----
export async function fetchCompanies(): Promise<CompanyOption[]> {
  const res = await apiGet<RowsResponse<CompanyOption>>('/company/list')
  return res.rows ?? []
}

// 请求序号守卫（#3403）：并发刷新时先发后到的旧响应不得覆盖新结果——开通练习空间前
// 在途的旧列表回来会触发 setCompanyOptions 四规则协调，把刚切到的练习公司顶掉。
let refreshCompanyOptionsSeq = 0

export async function refreshCompanyOptions(): Promise<CompanyOption[]> {
  const seq = ++refreshCompanyOptionsSeq
  const options = await fetchCompanies()
  if (seq !== refreshCompanyOptionsSeq) return options
  setCompanyOptions(options)
  return options
}

// ---- 公司注册立场（#2193 立场体系） ----
// 立场授权的服务端权威在 companies.subject_types；读走可见公司列表（含 subjectTypes 字段），
// 写走平台管理员端点（requireAdminSession，非管理员 403）。
export async function fetchCompanySubjectTypes(companyId: string | null | undefined): Promise<string[]> {
  if (!companyId) return []
  const rows = await fetchCompanies()
  return rows.find((row) => row.companyId === companyId)?.subjectTypes ?? []
}

export async function saveCompanySubjectTypes(companyId: string, subjectTypes: string[]): Promise<void> {
  await apiPatch(`/company/companies/${encodeURIComponent(companyId)}`, { subjectTypes })
}

// ---- 场站 ----
export async function fetchStations(scope?: 'group'): Promise<CompanyStation[]> {
  if (companyUnselected() && scope !== 'group') return []
  const res = await apiGet<RowsResponse<CompanyStation>>('/company/stations', listQuery(scope ? { scope } : {}))
  return res.rows ?? []
}
export async function createStation(body: Partial<CompanyStation>, options?: CompanyWriteOptions) {
  return apiPost<DataResponse<CompanyStation>>(withCompany('/company/stations'), body, companyWriteOptions(options))
}
export async function updateStation(id: number, patch: Partial<CompanyStation>, options?: CompanyWriteOptions) {
  return apiPatch<DataResponse<CompanyStation>>(withCompany(`/company/stations/${id}`), patch, companyWriteOptions(options))
}
export async function deleteStation(id: number, options?: CompanyWriteOptions) {
  return apiDelete(withCompany(`/company/stations/${id}`), companyWriteOptions(options))
}
export async function importStations(rows: Partial<CompanyStation>[], options?: CompanyWriteOptions) {
  return apiPost(withCompany('/company/stations/import'), { rows }, companyWriteOptions(options))
}

// ---- 机组 ----
export async function fetchUnits(scope?: 'group'): Promise<CompanyUnit[]> {
  if (companyUnselected() && scope !== 'group') return []
  const res = await apiGet<RowsResponse<CompanyUnit>>('/company/units', listQuery(scope ? { scope } : {}))
  return res.rows ?? []
}
export async function createUnit(body: Partial<CompanyUnit>, options?: CompanyWriteOptions) {
  return apiPost<DataResponse<CompanyUnit>>(withCompany('/company/units'), body, companyWriteOptions(options))
}
export async function updateUnit(id: number, patch: Partial<CompanyUnit>, options?: CompanyWriteOptions) {
  return apiPatch<DataResponse<CompanyUnit>>(withCompany(`/company/units/${id}`), patch, companyWriteOptions(options))
}
export async function deleteUnit(id: number, options?: CompanyWriteOptions) {
  return apiDelete(withCompany(`/company/units/${id}`), companyWriteOptions(options))
}

// ---- 机组出力 ----
export async function fetchUnitOutput(query: { unitId?: number; date?: string } = {}): Promise<CompanyUnitOutput[]> {
  if (companyUnselected()) return []
  const res = await apiGet<RowsResponse<CompanyUnitOutput>>('/company/unit-output', listQuery(query))
  return res.rows ?? []
}
export async function saveUnitOutput(rows: Partial<CompanyUnitOutput>[], options?: CompanyWriteOptions) {
  return apiPost<{ data?: { count: number } }>(withCompany('/company/unit-output'), { rows }, companyWriteOptions(options))
}
export async function importUnitOutput(rows: Partial<CompanyUnitOutput>[], options?: CompanyWriteOptions) {
  return apiPost<{ data?: { count: number } }>(withCompany('/company/unit-output/import'), { rows }, companyWriteOptions(options))
}

// ---- 历史交易 ----
export async function fetchTrades(query: { type?: string } = {}, scope?: 'group'): Promise<CompanyTrade[]> {
  if (companyUnselected() && scope !== 'group') return []
  const res = await apiGet<RowsResponse<CompanyTrade>>('/company/trades', listQuery(scope ? { ...query, scope } : query))
  return res.rows ?? []
}
export async function createTrade(body: Partial<CompanyTrade>) {
  return apiPost<DataResponse<CompanyTrade>>(withCompany('/company/trades'), body)
}
export async function updateTrade(id: number, patch: Partial<CompanyTrade>) {
  return apiPatch<DataResponse<CompanyTrade>>(withCompany(`/company/trades/${id}`), patch)
}
export async function deleteTrade(id: number) {
  return apiDelete(withCompany(`/company/trades/${id}`))
}
export async function importTrades(rows: Partial<CompanyTrade>[]) {
  return apiPost(withCompany('/company/trades/import'), { rows })
}

// ---- 按厂站画像生成的预测数据（公司隔离，模拟数据 sourceType=MOCK）----
// 「预测数据」模块(新能源出力预测1/2、公司负荷预测)按 {地区·公司·厂站} profile 取数。
// 行的字段口径与前端 FORECAST_CFGS 一致(zxztqa: riqi/type；zgnrx: yxrq/sjlx；gsfhyc: date)。
export type StationForecastKind = 'zxztqa' | 'zgnrx' | 'gsfhyc'

export type StationForecastResponse = {
  rows?: Record<string, unknown>[]
  mock?: boolean
  sourceType?: string
  stationId?: number
  station?: { id: number; name: string; type: string; capacity?: number; regionId?: string | null; province?: string }
}

export async function fetchStationForecast(kind: StationForecastKind, stationId: number, days?: number): Promise<StationForecastResponse> {
  if (companyUnselected()) return { rows: [] }
  return apiGet<StationForecastResponse>('/company/forecast', listQuery({ kind, stationId, ...(days ? { days } : {}) }))
}

// ---- 合同（中长期全生命周期）----
export async function fetchContracts(
  query: { stationId?: number; year?: number; marketType?: string; status?: string; search?: string } = {},
  scope?: 'group'
): Promise<CompanyContract[]> {
  if (companyUnselected() && scope !== 'group') return []
  const res = await apiGet<RowsResponse<CompanyContract>>('/company/contracts', listQuery(scope ? { ...query, scope } : query))
  return res.rows ?? []
}
export async function createContract(body: CompanyContractPayload) {
  return apiPost<DataResponse<CompanyContract>>(withCompany('/company/contracts'), body)
}
export async function updateContract(id: number, patch: CompanyContractPayload) {
  return apiPatch<DataResponse<CompanyContract>>(withCompany(`/company/contracts/${id}`), patch)
}
export async function deleteContract(id: number) {
  return apiDelete(withCompany(`/company/contracts/${id}`))
}
export async function importContracts(rows: Partial<CompanyContract>[]) {
  return apiPost(withCompany('/company/contracts/import'), { rows })
}
export async function fetchContractDetails(id: number): Promise<CompanyContractDetail[]> {
  if (companyUnselected()) return []
  const res = await apiGet<RowsResponse<CompanyContractDetail>>(`/company/contracts/${id}/details`, listQuery())
  return res.rows ?? []
}

// ---- 公司档案 ----
export async function fetchProfile(): Promise<CompanyProfile | null> {
  if (companyUnselected()) return null
  const res = await apiGet<DataResponse<CompanyProfile>>('/company/profile', listQuery())
  return res.data ?? null
}
export async function saveProfile(patch: Partial<CompanyProfile>) {
  return apiPost<DataResponse<CompanyProfile>>(withCompany('/company/profile'), patch)
}

// ---- 经营总览大屏（/gsgl/overview）：发电/交易/装机/KPI 跨时间尺度聚合 ----
// 数据由后端 company_daily_generation(种子合成近1年) + company_trades 聚合，source='demo-seed'。
export type DashboardPeriod = 'day' | 'week' | 'dekad' | 'month' | 'year'

export interface CompanyDashboardKpis {
  totalCapacityMw: number
  generationCapacityMw: number
  storageCapacityMw: number
  totalGenerationMwh: number
  renewableRatioPct: number
  utilizationHours: number
  totalTradeVolume: number
  avgTradePrice: number
  totalTradeAmountWan: number
  sellRevenueWan: number
  buyCostWan: number
  avgSellPrice: number
  avgBuyPrice: number
  unitMarginYuanPerKwh: number
}

export interface CompanyDashboard {
  period: DashboardPeriod
  from: string
  to: string
  generation: { buckets: string[]; byType: Record<string, number[]>; total: number[] }
  trading: { buckets: string[]; volume: number[]; amount: number[]; sellVolume: number[]; buyVolume: number[]; avgPrice: number[] }
  capacity: Record<string, number>
  kpis: CompanyDashboardKpis
  source: string
}

export async function fetchCompanyDashboard(
  query: { period?: DashboardPeriod; from?: string; to?: string; scope?: 'group' } = {}
): Promise<CompanyDashboard | null> {
  if (companyUnselected() && query.scope !== 'group') return null
  const res = await apiGet<DataResponse<CompanyDashboard>>('/company/dashboard', listQuery(query))
  return res.data ?? null
}
