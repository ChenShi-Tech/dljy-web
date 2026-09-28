import { computed, ref, watch } from 'vue'
import { getCurrentUser } from '@/services/auth'
import type { GovernanceUser } from '@/services/governance'
import { selectedRegionId } from '@/services/region/regionContext'
import { companyRegionId, regionHomeCompanyId } from '@/services/region/regionCompany'
import { effectiveCompanyRegionId, registerPracticeCompanies } from '@/services/company/practiceCompany'

// 公司（租户）上下文：仿 regionContext 的全局响应式当前公司。
// - 普通公司用户：currentCompanyId 锁定为自身公司，切换被拒。
// - 平台管理员(ADMIN)/老板(BOSS)：可切换查看授权范围内的公司（#2887：BOSS=自身公司树，
//   可见范围由后端授权集合收口，前端不自行放大）。
// 公司专属数据请求据此带 company 维度（companyApi）；后端再经下属公司白名单校验，前端切换非授权。

const storageKey = 'dljy.currentCompanyId'
// 按地区键入「上次选择的公司」记忆（#668 规则 3）：切回某地区时优先复用用户在该地区的上次选择。
const memoryKeyPrefix = 'dljy.companyByRegion.'
// 练习空间钉住（#3403）：进入练习空间后把公司上下文钉在练习公司上，地区协调与授权集
// 刷新都不得把用户切走，否则导引写的数据会落到错误公司。
const pinStorageKey = 'dljy.companyPin'

export type CompanyOption = {
  companyId: string
  name: string
  shortName?: string | null
  tier?: 'GROUP' | 'COMPANY' | string
  parentCompanyId?: string | null
  status?: string
  /** 公司来源/用途标记（#3403）：练习公司为 'PRACTICE'（shared/company/practice-space.mjs）。 */
  source?: string | null
  /** 公司注册立场（#2193）：交易中心登记的市场主体类型集合，立场切换授权的服务端权威。 */
  subjectTypes?: string[]
}

// 钉住记录：同用户 + 同练习公司 + 同地区才生效；originCompanyId 供「退出练习空间」切回来源。
export type CompanySelectionPin = {
  companyId: string
  username: string
  regionId: string
  originCompanyId: string
}

function readStoredPin(): CompanySelectionPin | null {
  try {
    const raw = window.localStorage.getItem(pinStorageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CompanySelectionPin>
    if (!parsed.companyId || !parsed.username || !parsed.regionId || !parsed.originCompanyId) return null
    return {
      companyId: parsed.companyId,
      username: parsed.username,
      regionId: parsed.regionId,
      originCompanyId: parsed.originCompanyId
    }
  } catch {
    // 损坏 JSON / localStorage 不可用 → 视同无钉住，不阻塞启动。
    return null
  }
}

const companyPinState = ref<CompanySelectionPin | null>(readStoredPin())

// 只读视图：练习空间入口（practiceSpace.ts）据此读取 originCompanyId 等信息。
export const companyPin = computed(() => companyPinState.value)

export function pinCompanySelection(pin: { companyId: string; regionId: string; originCompanyId: string }) {
  const value: CompanySelectionPin = {
    companyId: pin.companyId,
    username: getCurrentUser()?.username ?? '',
    regionId: pin.regionId,
    originCompanyId: pin.originCompanyId
  }
  companyPinState.value = value
  try {
    window.localStorage.setItem(pinStorageKey, JSON.stringify(value))
  } catch {
    // localStorage 写入失败（隐私模式/配额）不影响内存钉住。
  }
}

export function unpinCompanySelection() {
  companyPinState.value = null
  try {
    window.localStorage.removeItem(pinStorageKey)
  } catch {
    // 同上，内存态已清除即可。
  }
}

// 钉住是否「生效」：同用户 + 当前公司即钉住公司 + 当前地区即钉住地区。
// 用户手动切走公司后钉住保留但失效（供「回到练习空间继续」），不再拦截协调。
function pinnedCurrent(): boolean {
  const pin = companyPinState.value
  if (!pin) return false
  return (
    pin.username === (getCurrentUser()?.username ?? '') &&
    currentCompanyId.value === pin.companyId &&
    selectedRegionId.value === pin.regionId
  )
}

const availableCompanies = ref<CompanyOption[]>([])

function homeCompanyId(): string {
  return getCurrentUser()?.companyId ?? 'dljy-demo'
}

function readInitialCompanyId(): string {
  const home = homeCompanyId()
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
// 练习公司随上级公司的地区（#3403 · codex R1-02），只出现在上级所属地区的下拉里。
export const selectableCompanies = computed(() =>
  availableCompanies.value.filter((company) => {
    const region = effectiveCompanyRegionId(company.companyId)
    return region === null || region === selectedRegionId.value
  })
)

// 空态（#668 规则 4）：当前地区默认公司不在授权集合（或该地区无任何授权公司）时，
// 不自动选公司，置空待用户手动选择。currentCompanyId 为 '' 即空态；服务端 fail-closed 依旧兜底。
export const companySelectionEmpty = computed(() => !currentCompanyId.value)

// 切换器渲染判据（#2898 / Epic #2887 拍板）：提权只认角色不认层级——
// GROUP 公司下的非提权角色（TRADER/QUANT/RISK/SETTLEMENT/TRADE_LEAD 等）不再自动可切换，
// 与服务端 isElevatedForCompanyScope 同口径。BOSS 的可见范围是自身公司树，由后端
// requireCompanyContext 收口；本判据只是前端展示门，不是安全边界。
export function canSwitchCompany(user: Pick<GovernanceUser, 'roleCode'> | null | undefined): boolean {
  if (!user) return false
  return user.roleCode === 'ADMIN' || user.roleCode === 'BOSS'
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
  // 自动选择（规则 2/3）的候选只认静态地区表：练习公司不在表里，切地区时永远不会被自动选中。
  const regionAuthorized = available
    .map((company) => company.companyId)
    .filter((id) => companyRegionId(id) === regionId)

  // 规则 1：当前公司属新地区且有授权 → 保持用户选择不覆盖。「属新地区」按有效地区判断：
  // 用户手动选中的练习公司随上级地区保持（#3403 · codex R1-02），不因不在静态表里被切走。
  if (current && effectiveCompanyRegionId(current) === regionId && available.some((company) => company.companyId === current)) {
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
  const targetRegion = effectiveCompanyRegionId(id)
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
  // 先登记「练习公司 → 上级」对照，下面与各处的地区判定才认得出练习公司（#3403 · codex R1-02）。
  registerPracticeCompanies(options)
  availableCompanies.value = options
  // 练习空间钉住（#3403）：钉住生效且练习公司仍在授权集合 → 直接返回不协调，稳定停留在练习公司
  // （上级无地区归属时练习公司也无地区，下方「保持」条件不成立，靠钉住留住）。
  if (pinnedCurrent()) {
    const pin = companyPinState.value!
    if (options.some((company) => company.companyId === pin.companyId)) return
    // 钉住公司已不在授权集合（授权被收回）→ 解除钉住，走常规协调。
    unpinCompanySelection()
  }
  const current = currentCompanyId.value
  if (
    current &&
    options.some((company) => company.companyId === current) &&
    effectiveCompanyRegionId(current) === selectedRegionId.value
  ) return
  coordinateCompanyForRegion(selectedRegionId.value)
}

// 登录/切换账号后重置为该用户自身公司（同时解除练习空间钉住——新会话不应继承旧钉住）。
export function resetCompanyContextToHome() {
  unpinCompanySelection()
  currentCompanyId.value = homeCompanyId()
}

// 空态：清空当前公司选择，等待用户手动选择（#668 规则 4）。服务端 fail-closed 兜底。
export function clearCompanySelection() {
  currentCompanyId.value = ''
}

// 地区切换联动公司（#668）：切到某地区时按四规则决定公司上下文
// 保持属该地区的当前授权公司 / 单家自动切 / 多家优先记忆后落默认 / 默认越权则空态。
// 普通公司用户锁定自身公司（canSwitchCompany=false），coordinate 内部再兜底。
// 练习空间钉住（#3403）：切到钉住地区且当前仍是练习公司 → 不协调（练习公司不在静态
// 地区表，四规则必然把它顶掉）。
watch(selectedRegionId, (regionId) => {
  if (pinnedCurrent()) return
  coordinateCompanyForRegion(regionId)
})
