import { computed, ref, watch } from 'vue'
import { currentRegion } from '@/services/region/regionContext'
import { selectedCompanyId, currentCompany } from '@/services/company/companyContext'
import { getCurrentUser } from '@/services/auth'
import { fetchStations, type CompanyStation } from '@/services/company/companyApi'

// 「预测数据」模块的 profile 上下文：把预测页面的数据源绑定到
// {登录地区(currentRegion) · 账号所属公司(companyContext) · 公司下属某个厂站}。
//
// 厂站选择优先级：会话已选(localStorage) > 账号绑定的默认厂站(user.forecastStationId)
// > 当前公司在当前地区下的首个厂站。仅当候选不在「当前公司·当前地区」场站列表时回退。
// 切换公司/地区时自动重新解析，保证始终落在合法范围。

const storageKey = 'dljy.currentForecastStationId'

// 当前公司的全部场站（companyApi 按 companyContext 注入 company 维度，后端再校验白名单）。
const allStations = ref<CompanyStation[]>([])
const loading = ref(false)
const loadError = ref('')
let everLoaded = false

function readStored(): number | null {
  const raw = window.localStorage.getItem(storageKey)
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) ? n : null
}

// 会话内用户手动选择的厂站 id（null = 未手动选择，走默认解析）。
const storedStationId = ref<number | null>(readStored())

watch(storedStationId, (id) => {
  if (id == null) window.localStorage.removeItem(storageKey)
  else window.localStorage.setItem(storageKey, String(id))
})

// 当前公司在当前地区下的场站：优先 regionId 精确匹配，旧库无 regionId 时回退按 province=地区简称匹配。
// 按 id 升序（创建顺序），使默认选中=最早创建的厂站，符合直觉。
export const forecastStations = computed<CompanyStation[]>(() => {
  const region = currentRegion.value
  return allStations.value
    .filter((s) => (s.regionId ? s.regionId === region.id : s.province === region.shortName))
    .slice()
    .sort((a, b) => a.id - b.id)
})

// 账号绑定的默认厂站 id（管理员可配置）。
function boundStationId(): number | null {
  const raw = getCurrentUser()?.forecastStationId
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) ? n : null
}

// 解析“应选中”的厂站 id。候选不在当前列表时逐级回退。
function resolveSelection(): number | null {
  const list = forecastStations.value
  if (!list.length) return null
  const inList = (id: number | null) => id != null && list.some((s) => s.id === id)
  if (inList(storedStationId.value)) return storedStationId.value
  if (inList(boundStationId())) return boundStationId()
  return list[0].id
}

export const currentForecastStationId = computed<number | null>(() => resolveSelection())

export const currentForecastStation = computed<CompanyStation | null>(() =>
  forecastStations.value.find((s) => s.id === currentForecastStationId.value) ?? null)

// 打包给页面/横幅展示的完整 profile。
export const forecastProfile = computed(() => ({
  region: currentRegion.value,
  company: currentCompany.value,
  station: currentForecastStation.value
}))

export const forecastStationsLoading = computed(() => loading.value)
export const forecastStationsError = computed(() => loadError.value)

// 用户手动选择厂站。仅当目标在当前列表内才生效（前端兜底，后端为权威）。
export function setForecastStationId(id: number | null): void {
  if (id != null && !forecastStations.value.some((s) => s.id === id)) return
  storedStationId.value = id
}

// 拉取当前公司场站。幂等：并发调用时复用进行中的请求结果。
let inflight: Promise<void> | null = null
export function loadForecastStations(force = false): Promise<void> {
  if (inflight) return inflight
  if (everLoaded && !force) return Promise.resolve()
  loading.value = true
  loadError.value = ''
  inflight = fetchStations()
    .then((rows) => { allStations.value = rows; everLoaded = true })
    .catch((e) => { loadError.value = e instanceof Error ? e.message : '场站加载失败'; allStations.value = [] })
    .finally(() => { loading.value = false; inflight = null })
  return inflight
}

// 切换公司：清空会话选择并重新拉取该公司场站，让默认重新解析到新公司绑定/首个厂站。
watch(selectedCompanyId, () => {
  storedStationId.value = null
  everLoaded = false
  void loadForecastStations(true)
})

// 当选中厂站（含地区/公司联动）变化时重载页面数据。首屏由页面 onMounted 负责。
export function onForecastChange(reload: () => void | Promise<void>): void {
  watch(() => currentForecastStationId.value, () => { void reload() })
}
