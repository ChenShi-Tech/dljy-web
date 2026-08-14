// 中广核云南专属 PostgreSQL 实时价格客户端（#1768）。
// 固定调用 /api/v1/spot/cgn-yunnan；集团公司由服务端 token 反查，查询主体由服务端固定，客户端不传
// company/subject/station，也不在失败时回落公共现货、capture 或 Mock。
import { identityHeaders } from '@/services/agent/agentClient'
import { AGENT_API_BASE_ROOT, applyRegionHeaders, timeoutSignal } from '@/services/api'
import { getCurrentUser } from '@/services/auth'
import { selectedCompanyId } from '@/services/company/companyContext'

const BASE = `${AGENT_API_BASE_ROOT}/v1/spot/cgn-yunnan`
const REQUEST_TIMEOUT_MS = 20000
export const CGN_YUNNAN_PRICE_COMPANY_ID = 'comp-cgn-yunnan'

export function isCgnYunnanPriceCompany(companyId: string | null | undefined): boolean {
  return companyId === CGN_YUNNAN_PRICE_COMPANY_ID
}

/**
 * 判据是**当前选中的公司**，不是账号的归属公司。
 *
 * 改动前用 `getCurrentUser().companyId`（登录账号的 home 公司），后果是平台超管永远进不来：
 * 它的 home 是演示集团，即使在公司切换器里切到中广核云南，页面仍然认为"你不属于中广核"，
 * 于是不发请求、直接显示提示，配置和排障都无从做起。
 *
 * 改用选中公司之后**不需要给超管开任何后门**——能不能选中广核，本来就由授权公司集合
 * （`listAuthorizedCompanyIds`：ADMIN 全部 ∪ 层级后代链 ∪ 显式授权）决定：
 *   - 中广核账号：home 即中广核，选中的就是它，行为与改动前完全一致
 *   - 平台超管：可切到中广核 → 放行；切回演示集团 → 自动回到公共数据路由
 *   - 山西/四川账号：授权集合里根本没有中广核，切换器里选不到 → 依旧拦住
 * 越权判定仍在服务端（`requireCompanyContext` 校验 requested ∈ allowed），前端只是不再
 * 用一个比服务端更严的判据把合法用户挡在门外。
 */
export function hasCgnYunnanPriceEntitlement(): boolean {
  return isCgnYunnanPriceCompany(selectedCompanyId.value || getCurrentUser().companyId)
}

export type CgnPriceAvailability = 'complete' | 'partial' | 'unavailable'
export type CgnPriceFreshness = 'fresh' | 'stale' | 'unavailable'

export type CgnPricePoint = {
  time: string
  time_point: string
  price: number | null
  nodeCount: number
  interval: '15m' | '1h' | string
  observedAt: string | null
  ingestedAt: string | null
}

export type CgnNodeSnapshot = {
  market: 'da' | 'rt'
  upstreamNodeId: string
  nodeName: string
  price: number | null
  interval: string
  ts: string
  observedAt: string | null
  ingestedAt: string | null
}

export type CgnPlantPriceSnapshot = {
  market: 'da' | 'rt'
  stationId: number
  plantName: string
  subjectId: 'GENERATOR-YN-CGN'
  upstreamNodeId: string
  nodeName: string
  price: number | null
  ts: string
  observedAt: string | null
  ingestedAt: string | null
}

export type CgnMonitorPoint = { time: string; da: number; rt: number; spread: number }
export type CgnMonitorAlert = { time: string; spread: number; direction: string }

export type CgnYunnanPriceBundle = {
  date: string
  unit: 'CNY/MWh'
  availability: CgnPriceAvailability
  freshness: CgnPriceFreshness
  latestAt: string | null
  ageSeconds: number | null
  staleAfterSeconds: number
  source: {
    sourceInstanceId: 'cgn-yunnan-data-api-v1'
    displayName: string
    ownerGroupId: 'comp-cgn-yunnan'
    companyId: 'comp-cgn-yunnan'
    regionId: 'yunnan'
    subjectId: 'GENERATOR-YN-CGN'
    officialGridApi: false
    transport: string
    updatedAt: string | null
  }
  node: {
    dayAhead: CgnPricePoint[]
    realTime: CgnPricePoint[]
    snapshots: { total: number; limited: number; items: CgnNodeSnapshot[] }
  }
  plants: { total: number; items: CgnPlantPriceSnapshot[] }
  monitor: {
    spreadThreshold: number
    series: CgnMonitorPoint[]
    alerts: CgnMonitorAlert[]
    peakValley: {
      avg_price: { peak: number | null; flat: number | null; valley: number | null }
      peak_valley_spread: number | null
      spread_ratio: number | null
    }
  }
}

type BaseResponse<T> = {
  code: number
  message?: string
  data: T
  mock?: boolean
  sourceType?: string
  productionWrite?: boolean
}

export class CgnYunnanPriceHttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'CgnYunnanPriceHttpError'
    this.status = status
    this.code = code
  }
}

function buildQuery(params: Record<string, string | number>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) search.set(key, String(value))
  return search.toString()
}

async function errorDetail(res: Response): Promise<{ code: string; message: string }> {
  const payload = await res.json().catch(() => null) as any
  const detail = payload?.detail
  if (detail && typeof detail === 'object') {
    return {
      code: String(detail.code ?? 'request_failed'),
      message: String(detail.message ?? `请求失败: ${res.status}`)
    }
  }
  return {
    code: 'request_failed',
    message: String(detail ?? payload?.message ?? `请求失败: ${res.status}`)
  }
}

async function get<T>(path: string, params: Record<string, string | number>): Promise<T> {
  // 前端闸门不是安全边界（服务端仍会再次按 token home company 校验），作用是让
  // 共用页面中的其他集团账号不向中广核专属端点制造必然 403，也不误把公司切换器
  // 当成 source entitlement。普通 user_companies 授权同样不会改变 home company。
  if (!hasCgnYunnanPriceEntitlement()) {
    throw new CgnYunnanPriceHttpError(
      403,
      'company_not_entitled',
      '当前账号不属于中广核云南集团，中广核厂侧专属价格链路不可用'
    )
  }
  const headers = identityHeaders()
  // identityHeaders 为通用客户端携带当前 UI company；专属数据链路不接受客户端公司选择，
  // 这里只保留 token + region，实际 company/subject 由服务端反查。
  delete headers['x-company-id']
  const res = await fetch(`${BASE}${path}?${buildQuery(params)}`, {
    method: 'GET',
    headers,
    signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    cache: 'no-store'
  })
  if (!res.ok) {
    const detail = await errorDetail(res)
    throw new CgnYunnanPriceHttpError(res.status, detail.code, detail.message)
  }
  applyRegionHeaders(res)
  const body = await res.json() as BaseResponse<T>
  if (body.mock === true || body.sourceType !== 'REAL' || body.productionWrite === true) {
    throw new CgnYunnanPriceHttpError(502, 'untrusted_envelope', '中广核云南价格响应可信度标注不符合真实只读契约')
  }
  return body.data
}

export function fetchCgnYunnanPriceBundle(
  date: string,
  spreadThreshold = 80
): Promise<CgnYunnanPriceBundle> {
  return get<CgnYunnanPriceBundle>('/prices', { date, spread_threshold: spreadThreshold })
    .then((bundle) => {
      if (
        bundle.source.sourceInstanceId !== 'cgn-yunnan-data-api-v1'
        || bundle.source.ownerGroupId !== 'comp-cgn-yunnan'
        || bundle.source.companyId !== 'comp-cgn-yunnan'
        || bundle.source.regionId !== 'yunnan'
        || bundle.source.subjectId !== 'GENERATOR-YN-CGN'
        || bundle.source.officialGridApi !== false
      ) {
        throw new CgnYunnanPriceHttpError(502, 'source_scope_mismatch', '实时价格来源或中广核云南绑定不符合契约')
      }
      return bundle
    })
}
