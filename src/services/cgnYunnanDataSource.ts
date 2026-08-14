import { apiDelete, apiGet, apiPost, apiPut } from './api'
import { selectedCompanyId } from '@/services/company/companyContext'

const ROOT = '/api/v1/data-sources/cgn-yunnan'

// 服务端闸门按**当前选中的公司**判定（见 server/cgn-yunnan-data-source-access.mjs），
// 而通用请求头里的 x-company-id 取的是账号 home 公司、不随切换器变化。平台超管切到
// 中广核后若不显式带上选中公司，服务端仍会按 home（演示集团）判定并 403。
// 这里显式附 `?company=`——服务端优先读它，并照旧校验它属于该账号的授权公司集合，
// 所以带上它不构成越权面（伪造一个未授权的公司 id 会被 requireCompanyContext 直接 403）。
function withCompany(path: string): string {
  const company = selectedCompanyId.value
  if (!company) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}company=${encodeURIComponent(company)}`
}

export type CgnYunnanSourceTest = {
  result: 'ok' | 'unconfigured' | 'invalidKey' | 'forbidden' | 'error' | 'stale'
  msg: string
  checkedAt?: string | null
  upstreamStatus?: number | null
  catalogResourceCount?: number | null
  upstreamRequestId?: string | null
}

export type CgnYunnanSourceStatus = {
  id: string
  name: string
  ownerGroupId: string
  ownerCompanyId: string
  regionId: string
  transport: 'HTTPS_POLLING'
  officialGridApi: false
  canManageSource: boolean
  configured: boolean
  connectionState: 'UNCONFIGURED' | 'CONFIGURED_UNVERIFIED' | 'CONNECTED'
  configSource: 'none' | 'runtime' | 'env'
  baseUrl: string | null
  maskedApiKey: string | null
  updatedAt: string | null
  updatedBy: string | null
  lastTest: CgnYunnanSourceTest | null
  liveIngestionEnabled: false
  productionWrite: false
  sourceType: 'EXTERNAL_API'
  mock: false
}

export type CgnYunnanPlantBinding = {
  stationId: number
  companyId: string
  subjectId: string | null
  standardPlantName: string
  apiPlantName: string
  regionId: string
  status: string
  bindingState: 'BOUND_BY_STANDARD_NAME'
}

export async function fetchCgnYunnanSourceStatus() {
  const envelope = await apiGet<CgnYunnanSourceStatus>(withCompany(ROOT))
  return envelope.data ?? null
}

export async function saveCgnYunnanSourceConfig(input: { baseUrl: string; apiKey: string }) {
  const envelope = await apiPut<CgnYunnanSourceStatus>(withCompany(ROOT), input)
  return envelope.data ?? null
}

export async function clearCgnYunnanSourceConfig() {
  const envelope = await apiDelete<CgnYunnanSourceStatus>(withCompany(ROOT))
  return envelope.data ?? null
}

export async function testCgnYunnanSource() {
  const envelope = await apiPost<CgnYunnanSourceTest>(withCompany(`${ROOT}/test`), {})
  return envelope.data ?? null
}

export async function fetchCgnYunnanPlantBindings() {
  const envelope = await apiGet<CgnYunnanPlantBinding[]>(withCompany(`${ROOT}/plant-bindings`))
  return envelope.rows ?? []
}
