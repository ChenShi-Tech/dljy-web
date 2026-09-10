import { computed, ref, watch } from 'vue'
import { getCurrentUser } from '@/services/auth'
import type { GovernanceUser } from '@/services/governance'
import { isMockDemoUser } from '@/services/mock/session'
import { selectedRegionId } from '@/services/region/regionContext'
import { companyRegionId, regionHomeCompanyId } from '@/services/region/regionCompany'

// 公司（租户）上下文：仿 regionContext 的全局响应式当前公司。
// - 普通公司用户：currentCompanyId 锁定为自身公司，切换被拒。
// - 平台管理员(ADMIN)/集团或公司老板(BOSS)/集团(GROUP)：可切换查看下属公司。
// 公司专属数据请求据此带 company 维度（companyApi）；后端再经下属公司白名单校验，前端切换非授权。

const storageKey = 'dljy.currentCompanyId'
// 按地区键入「上次选择的公司」记忆（#668 规则 3）：切回某地区时优先复用用户在该地区的上次选择。
const memoryKeyPrefix = 'dljy.companyByRegion.'

export type CompanyOption = {
  companyId: string
  name: string
  shortName?: string | null
  tier?: 'GROUP' | 'COMPANY' | string
  parentCompanyId?: string | null
  status?: string
  /** 公司注册立场（#2193）：交易中心登记的市场主体类型集合，立场切换授权的服务端权威。 */
  subjectTypes?: string[]
}

const availableCompanies = ref<CompanyOption[]>([])

function homeCompanyId(): string {
  return getCurrentUser()?.companyId ?? 'dljy-demo'
}

function readInitialCompanyId(): string {
  const home = homeCompanyId()
  // 演示账号直接落自身演示公司：localStorage 可能残留真实账号的地区公司选择，
  // 而演示公司不在 COMPANY_REGION 真实登记内，走四规则会被误判清空（见 coordinate 注释）。
  if (isMockDemoUser(getCurrentUser())) return home
  const stored = window.localStorage.getItem(storageKey)
  // 仅当能切换且存储值有效时采用存储值，否则回退自身公司（防普通用户残留越权选择）。
  if (stored && canSwitchCompany(getCurrentUser())) return stored
  return home
}

const currentCompanyId = ref(readInitialCompanyId())

watch(currentCompanyId, (id) => {
  window.localStorage.setItem(storageKey, id)
})

export const selectedCompanyId = currentCompanyId
export const companyOptions = availableCompanies

// 当前地区可选公司集：地区专属公司须属当前地区，杜绝「云南地区 +
// 山西公司」的跨地区组合绕过空态隔离；GROUP 等无地区归属主体（dljy-demo）保留可选，
// 集团汇总视角合法。切换器下拉与 setCurrentCompanyId 共用本口径。
export const selectableCompanies = computed(() =>
  availableCompanies.value.filter((company) => {
    const region = companyRegionId(company.companyId)
    return region === null || region === selectedRegionId.value
  })
)

// 空态（#668 规则 4）：当前地区默认公司不在授权集合（或该地区无任何授权公司）时，
// 不自动选公司，置空待用户手动选择。currentCompanyId 为 '' 即空态；服务端 fail-closed 依旧兜底。
export const companySelectionEmpty = computed(() => !currentCompanyId.value)

export function canSwitchCompany(user: Pick<GovernanceUser, 'roleCode' | 'companyTier'> | null | undefined): boolean {
  if (!user) return false
  return user.roleCode === 'ADMIN' || user.roleCode === 'BOSS' || user.companyTier === 'GROUP'
}

export const currentCompany = computed<CompanyOption>(() => {
  return (
    availableCompanies.value.find((company) => company.companyId === currentCompanyId.value) ?? {
      companyId: currentCompanyId.value,
      name: getCurrentUser()?.companyName ?? currentCompanyId.value
    }
  )
})

// 记忆：当前地区上次选择的公司（#668 规则 3）。
function rememberCompanyForRegion(regionId: string, companyId: string) {
  if (regionId && companyId) window.localStorage.setItem(`${memoryKeyPrefix}${regionId}`, companyId)
}
function recalledCompanyForRegion(regionId: string): string | null {
  return regionId ? window.localStorage.getItem(`${memoryKeyPrefix}${regionId}`) : null
}

// #668 四规则联动判定（纯函数，便于推理/后续测试）：
// 返回切到 regionId 后应落入的公司 id；companyId=null 表示无可用授权公司 → 空态。
export type CompanyResolution = {
  companyId: string | null
  reason: 'keep' | 'single' | 'memory' | 'default' | 'empty'
}
export function resolveCompanyForRegion(args: {
  regionId: string
  currentCompanyId: string
  availableCompanies: CompanyOption[]
  rememberedCompanyId: string | null
}): CompanyResolution {
  const { regionId, currentCompanyId: current, availableCompanies: available, rememberedCompanyId: remembered } = args
  const regionAuthorized = available
    .map((company) => company.companyId)
    .filter((id) => companyRegionId(id) === regionId)

  // 规则 1：当前公司属新地区且有授权 → 保持用户选择不覆盖。
  if (current && companyRegionId(current) === regionId && regionAuthorized.includes(current)) {
    return { companyId: current, reason: 'keep' }
  }
  // 规则 2：该地区仅一家授权公司 → 自动切换。
  if (regionAuthorized.length === 1) {
    return { companyId: regionAuthorized[0], reason: 'single' }
  }
  if (regionAuthorized.length > 1) {
    // 规则 3：多家 → 优先用户在该地区的上次选择记忆。
    if (remembered && regionAuthorized.includes(remembered)) {
      return { companyId: remembered, reason: 'memory' }
    }
    // 规则 3 兜底：无记忆才落默认公司（若默认在授权集）。
    const home = regionHomeCompanyId(regionId)
    if (home && regionAuthorized.includes(home)) {
      return { companyId: home, reason: 'default' }
    }
    // 规则 4：默认公司不在授权集合 → 不自动切换，空态待选。
    return { companyId: null, reason: 'empty' }
  }
  // 该地区无任何授权公司 → 空态（规则 4）。
  return { companyId: null, reason: 'empty' }
}

// 把当前公司上下文协调到 regionId（切地区 / 授权集首次加载后调用）。
// 授权集未加载时跳过（待 setCompanyOptions 再协调），避免误清空。
function coordinateCompanyForRegion(regionId: string) {
  // 演示账号（PRD R1/R4）：合成公司集不在 COMPANY_REGION 真实登记内，四规则会把
  // 「演示集团 + 任意地区」判成「该地区无授权公司」并清空上下文，所有公司门控页面
  // （空间资产驾驶舱等）全部落空态。演示会话锁定本账号公司、任何地区都有公司上下文；
  // 真实账号不进此分支，治理行为零改动（R2/R3）。
  if (isMockDemoUser(getCurrentUser())) {
    const home = homeCompanyId()
    if (currentCompanyId.value !== home) currentCompanyId.value = home
    return
  }
  const user = getCurrentUser()
  if (!canSwitchCompany(user)) {
    // 不可切换用户锁定自身公司：残留他值（上一账号 localStorage 继承等）时强制归位，
    // 否则后续公司级请求带越权 company 全量 403 且无法自愈（ 回归）。
    const home = homeCompanyId()
    if (currentCompanyId.value !== home) currentCompanyId.value = home
    return
  }
  if (availableCompanies.value.length === 0) return
  const resolved = resolveCompanyForRegion({
    regionId,
    currentCompanyId: currentCompanyId.value,
    availableCompanies: availableCompanies.value,
    rememberedCompanyId: recalledCompanyForRegion(regionId)
  })
  if (resolved.companyId) {
    if (resolved.companyId !== currentCompanyId.value) {
      setCurrentCompanyId(resolved.companyId)
    }
  } else if (currentCompanyId.value) {
    clearCompanySelection()
  }
}

// 切换当前公司。仅当用户可切换且目标在可见公司列表内才生效（前端兜底，后端为权威）。
// 目标为地区专属公司时须属当前地区（，与 selectableCompanies 同口径）；
// 成功后按当前地区记录「上次选择」记忆（#668 规则 3）。
export function setCurrentCompanyId(id: string): boolean {
  const user = getCurrentUser()
  if (!canSwitchCompany(user)) return false
  if (!id) return false
  if (availableCompanies.value.length && !availableCompanies.value.some((company) => company.companyId === id)) {
    return false
  }
  const targetRegion = companyRegionId(id)
  if (targetRegion !== null && targetRegion !== selectedRegionId.value) return false
  currentCompanyId.value = id
  rememberCompanyForRegion(selectedRegionId.value, id)
  return true
}

// 由 companyApi.refreshCompanyOptions 填充授权公司集合。
// 仅当「当前公司仍属授权集 && 属当前地区」才保留用户选择；其余一律走四规则校准
// （job355）：① 越权（授权被收回）② 残留空态 ③ 跨地区专属公司残留
// （授权列表晚于切地区加载时 region-watch 被「列表未加载」放过）④ GROUP 等无地区归属
// 公司，与 resolveCompanyForRegion 规则 1（只保持「属该地区」的公司）语义对齐，
// 不把 null 地区归属当作任意地区兼容；集团汇总视角由各页面 scope=group 表达。
export function setCompanyOptions(options: CompanyOption[]) {
  availableCompanies.value = options
  const current = currentCompanyId.value
  if (
    current &&
    options.some((company) => company.companyId === current) &&
    companyRegionId(current) === selectedRegionId.value
  ) return
  coordinateCompanyForRegion(selectedRegionId.value)
}

// 登录/切换账号后重置为该用户自身公司。
export function resetCompanyContextToHome() {
  currentCompanyId.value = homeCompanyId()
}

// 空态：清空当前公司选择，等待用户手动选择（#668 规则 4）。服务端 fail-closed 兜底。
export function clearCompanySelection() {
  currentCompanyId.value = ''
}

// 地区切换联动公司（#668）：切到某地区时按四规则决定公司上下文
// 保持属该地区的当前授权公司 / 单家自动切 / 多家优先记忆后落默认 / 默认越权则空态。
// 普通公司用户锁定自身公司（canSwitchCompany=false），coordinate 内部再兜底。
watch(selectedRegionId, (regionId) => coordinateCompanyForRegion(regionId))
