<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { routeLocationKey } from 'vue-router'
import { Activity, ArrowRight, ArrowDownUp, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, FileText, Filter, Gauge, Layers3, MapPinned, RadioTower, RefreshCw, Search, ShieldCheck, Wind, X, Zap } from 'lucide-vue-next'
import { currentRegion } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { todayBeijing } from '@/utils/beijingDate'
import { isRealCalendarDate } from '@/utils/calendarDate'
import { disclosureEventWindow, disclosureMinuteText as minuteText, parseDisclosureTime } from './disclosureTime'
import { getGridDataset } from 'shared/schema/grid-dataset-catalog.mjs'
import { fetchGridDisclosureEvents, fetchGridDisclosureGroups, fetchGridDisclosureOverview, fetchGridDisclosureProviders } from './client'
import { DISCLOSURE_DESK_METRICS, DISCLOSURE_DESK_THEMES, getDisclosureDeskMetric, findDisclosureDeskPointAt, loadDisclosureDeskSeries, loadDisclosureDeskThemeAvailability, summarizeDisclosureDeskSeries, type DeskDataResult, type DeskThemeId, type DeskThemeAvailability } from './disclosureDeskData'
import type { GridDisclosureCategory, GridDisclosureEvent, GridDisclosureGroup, GridDisclosureOverview, GridDisclosureProvider } from './types'
import DisclosureDeskChart from './DisclosureDeskChart.vue'
import DisclosureMetricPicker from './DisclosureMetricPicker.vue'
import DisclosureEvidencePanel from './DisclosureEvidencePanel.vue'
import DisclosureRegionContext from './DisclosureRegionContext.vue'
import DisclosureDeskInsights from './DisclosureDeskInsights.vue'
import DisclosureUnitRoster from './DisclosureUnitRoster.vue'
import type { DeskInsight } from './disclosureDeskInsights'
import type { UnitRosterEntry } from './disclosureUnitRoster'
import DisclosureMaintenanceTools from './DisclosureMaintenanceTools.vue'
import DisclosureMaintenanceList from './DisclosureMaintenanceList.vue'
import DisclosureEventGroups from './DisclosureEventGroups.vue'
import { createDefaultMaintenanceFilters, hasMaintenanceFilters, type MaintenanceFilters } from './disclosureMaintenance'
import { queryText, validObjectDate } from './objectNavigation'
import { useGridObjectContext } from './useGridObjectContext'
import GridObjectContextBar from './GridObjectContextBar.vue'
import GridObjectDrawer from './GridObjectDrawer.vue'
import type { GridObjectReference } from './objectNavigation'

const objectContext = useGridObjectContext()
const objectDrawerOpen = ref(false)
const objectTarget = shallowRef<GridObjectReference | null>(null)
const objectQuery = computed((): Record<string, string> => objectContext.reference.value ? { objectKind: objectContext.reference.value.kind, objectId: objectContext.reference.value.id } : {})
const objectQueryKey = computed(() => JSON.stringify([objectContext.hasContext.value, objectQuery.value]))
const objectBlocked = computed(() => objectContext.hasContext.value && !objectContext.reference.value)
// 洞察电网边界页深链（dljy#3106 D6.1）：通道/断面名经 keyword 预填披露检索，输电主题
// 按名过滤，业务日期经 objectDate 落到洞察窗口末日。只认合法单值（非空字符串、无控制
// 字符、检索词 ≤120 字；日期必须是真实日历日），其余按缺省处理；对象上下文
//（objectKind/objectId）仍走 useGridObjectContext，两组键互不占用。
const deskRoute = inject(routeLocationKey, null)
const date = ref(objectContext.hasContext.value ? objectContext.date.value : todayBeijing())
const mode = ref<'day' | 'week'>('day')
const themeId = ref<DeskThemeId>('price')
const metricId = ref('price')
const channel = ref('')
const preferredChannels = new Map<string, string>()
const searchText = ref('')
const keyword = ref('')
const categoryFilter = ref<'' | GridDisclosureCategory>('')
const maintenanceFilters = ref<MaintenanceFilters>(createDefaultMaintenanceFilters())
const appliedMaintenanceFilters = ref<MaintenanceFilters>(createDefaultMaintenanceFilters())
const eventLayout = ref<'groups' | 'list' | 'cards'>('groups')
const selection = ref<{ from: string; to: string } | null>(null)
const timePrecision = ref<'all' | 'timed'>('all')
const hoveredAt = ref<string | null>(null)
const selected = shallowRef<GridDisclosureEvent | null>(null)
const smallScreen = ref(false)
const railOpen = ref(false)
const railElement = ref<HTMLElement | null>(null)
const railToggle = ref<HTMLButtonElement | null>(null)
let railMedia: MediaQueryList | null = null
const eventFocusToken = ref(0)
let pendingSingleEvent = false
const feedMode = ref<'events' | 'metrics'>('events')
const refreshKey = ref(0)
const railOverview = shallowRef<GridDisclosureOverview | null>(null)
const filteredOverview = shallowRef<GridDisclosureOverview | null>(null)
const events = shallowRef<GridDisclosureEvent[]>([])
const eventGroups = shallowRef<GridDisclosureGroup[]>([])
const groupTotal = ref(0)
const groupLoadKey = ref(0)
const focusGroupKey = ref<string | null>(null)
const curve = shallowRef<DeskDataResult | null>(null)
const providers = shallowRef<GridDisclosureProvider[]>([])
const themeAvailability = shallowRef<DeskThemeAvailability>({})
const eventTotal = ref(0)
const page = ref(1)
const pageSize = 18
const groupPageSize = 12
const overviewLoading = ref(false)
const railLoading = ref(false)
const eventsLoading = ref(false)
const curveLoading = ref(false)
const overviewError = ref('')
const railError = ref('')
const eventsError = ref('')
const curveError = ref('')
const availability = ref<{ status: string; reason: string } | null>(null)
let overviewRequest = 0
let railRequest = 0
let eventRequest = 0
let curveRequest = 0
let providerRequest = 0
let themeAvailabilityRequest = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined
let maintenanceSearchTimer: ReturnType<typeof setTimeout> | undefined
let overviewAbort: AbortController | null = null
let railAbort: AbortController | null = null
let eventsAbort: AbortController | null = null
let pointerStartedInChart = false
const scopeKey = computed(() => `${currentRegion.value.id}:${selectedCompanyId.value ?? ''}`)
const cacheContext = computed(() => ({ scopeKey: scopeKey.value, refreshKey: refreshKey.value }))
const maintenanceMode = computed(() => themeId.value === 'maintenance')
const hasEventTools = computed(() => themeId.value === 'price' || maintenanceMode.value)
const eventFilterQuery = computed(() => hasEventTools.value ? {
  ...(appliedMaintenanceFilters.value.equipmentKeyword.trim() ? { equipmentKeyword: appliedMaintenanceFilters.value.equipmentKeyword.trim() } : {}),
  ...(appliedMaintenanceFilters.value.reasonKeyword.trim() ? { reasonKeyword: appliedMaintenanceFilters.value.reasonKeyword.trim() } : {}),
  ...(appliedMaintenanceFilters.value.timingFilter !== 'all' ? { timingFilter: appliedMaintenanceFilters.value.timingFilter } : {}),
} : {})
const eventSort = computed(() => hasEventTools.value ? appliedMaintenanceFilters.value.sort : 'default')
const needsFilteredOverview = computed(() => Boolean(selection.value) || timePrecision.value !== 'all' || Object.keys(eventFilterQuery.value).length > 0)
const overview = computed(() => needsFilteredOverview.value ? filteredOverview.value : railOverview.value)
const dateFrom = computed(() => mode.value === 'day' ? date.value : shiftDate(date.value, -6))
const dateTo = computed(() => date.value)
const currentTheme = computed(() => DISCLOSURE_DESK_THEMES.find((theme) => theme.id === themeId.value)!)
const eventContextLabel = computed(() => themeId.value === 'price' ? '全部披露' : currentTheme.value.label)
const currentMetric = computed(() => getDisclosureDeskMetric(metricId.value)!)
const metricScope = computed(() => getGridDataset('csg', currentMetric.value.sources[0].catalog)?.regionScope ?? '按所选对象范围')
const metricGroups = DISCLOSURE_DESK_THEMES.map((theme) => ({ ...theme, metrics: DISCLOSURE_DESK_METRICS.filter((metric) => metric.themeId === theme.id) })).filter((group) => group.metrics.length)
const themeMetrics = computed(() => DISCLOSURE_DESK_METRICS.filter((metric) => metric.themeId === themeId.value))
const channelLabels: Record<string, string> = { transmission: '联络线通道', 'transmission-plan': '区外联络线', 'channel-capacity': '输电通道', 'section-load': '输电断面', 'key-channel': '关键通道', 'key-line-transformer': '线路或变压器', 'section-constraint': '输电断面', 'interprov-forecast': '送受电通道', 'priority-limit': '优先送电通道' }
const channelLabel = computed(() => channelLabels[metricId.value] ?? '地区或类型')
const channelPlaceholder = computed(() => curveLoading.value ? '正在读取可用对象…' : curve.value?.channels.length ? `请选择${channelLabel.value}（${curve.value.channels.length} 个可用）` : `当前日期暂无可选${channelLabel.value}`)
const curveEmptyTitle = computed(() => curveLoading.value ? '正在读取指标' : curve.value?.status === 'selection-required' ? `请先选择${channelLabel.value}` : curve.value?.status === 'not-configured' ? '当前指标尚未接入' : curve.value?.status === 'unauthorized' ? '当前账号无读取权限' : curveError.value || curve.value?.status === 'error' ? '指标读取失败' : undefined)
const activeCategories = computed(() => categoryFilter.value ? [categoryFilter.value] : currentTheme.value.categories)
const categoryOptions = computed(() => currentTheme.value.categories.length ? currentTheme.value.categories : Object.keys(categoryLabels) as GridDisclosureCategory[])
const validDate = computed(() => isRealCalendarDate(date.value))
const visibleThemes = DISCLOSURE_DESK_THEMES.filter((theme) => theme.id !== 'price')
const totalPages = computed(() => Math.max(1, Math.ceil(eventLayout.value === 'groups' ? groupTotal.value / groupPageSize : eventTotal.value / pageSize)))
const activeProvider = computed(() => providers.value.find((provider) => provider.regionIds.includes(currentRegion.value.id)))
const busy = computed(() => railLoading.value || overviewLoading.value || eventsLoading.value || curveLoading.value)
const selectedSummary = computed(() => (curve.value?.series ?? []).map((series) => summarizeDisclosureDeskSeries(series, selection.value?.from, selection.value?.to)))
const availablePoints = computed(() => selectedSummary.value.reduce((sum, series) => sum + series.validPoints, 0))
const hoverValues = computed(() => hoveredAt.value ? (curve.value?.series ?? []).map((series) => ({ ...series, point: findDisclosureDeskPointAt(series, hoveredAt.value!) })) : [])
const visibleFacts = computed(() => (curve.value?.facts ?? []).filter((fact) => !selection.value || (fact.time >= minuteText(selection.value.from).slice(0, 10) && fact.time <= minuteText(selection.value.to).slice(0, 10))))
const dailyCards = computed(() => (currentMetric.value.dailyFacts ? [] : curve.value?.series ?? []).flatMap((series) => [...new Set(series.points.map((point) => point.time.slice(0, 10)))].map((day) => ({ ...summarizeDisclosureDeskSeries(series, `${day} 00:00`, `${day} 23:59`), date: day }))))
const selectedEventWindow = computed(() => disclosureEventWindow(selected.value))
const eventCards = computed(() => events.value.map((event) => ({ event, timing: eventTiming(event) })))
const eventGroupQuery = computed(() => ({ ...baseQuery(), ...(activeCategories.value.length ? { category: activeCategories.value.join(',') } : {}), ...(eventSort.value !== 'default' ? { sort: eventSort.value } : {}) }))
const hasEventRows = computed(() => eventLayout.value === 'groups' ? eventGroups.value.length > 0 : events.value.length > 0)
// The rail remains a full-date, all-category overview; the feed and facts keep their selected-window query.
const chartOverview = computed(() => railOverview.value)
const focusLabel = computed(() => selection.value ? `${shortTime(selection.value.from)} — ${shortTime(selection.value.to)}` : mode.value === 'day' ? `${date.value} 全天` : `${dateFrom.value} — ${dateTo.value}`)
const categoryLabels: Record<GridDisclosureCategory, string> = { maintenance: '检修计划', outage: '非计划停运', intervention: '人工干预', congestion: '断面阻塞', constraint: '输电约束' }
const themeIcons = { load: Activity, 'new-energy': Wind, reserve: Gauge, maintenance: Layers3, transmission: RadioTower, intervention: ShieldCheck }
const themeDescriptions = { load: '负荷 / 非市场化电源', 'new-energy': '新能源 / 水电出力', reserve: '备用 / 调峰 / 必开必停', maintenance: '检修计划 / 非计划停运', transmission: '送受电 / 潮流 / 断面限值', intervention: '干预记录 / 生效时段' }
const statusLabels: Record<string, string> = { available: '数据可用', partial: '部分缺测', missing: '暂无数据', 'not-configured': '尚未接入', error: '读取失败', unauthorized: '权限受限', 'selection-required': '待选对象' }

function shiftDate(value: string, days: number) { const time = Date.parse(`${value}T00:00:00Z`); return Number.isFinite(time) ? new Date(time + days * 86_400_000).toISOString().slice(0, 10) : value }
function shortTime(value: string | null | undefined) { return value ? minuteText(value).slice(5) : '未提供' }
function numberText(value: number | null | undefined) { return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) }
function categoryCount(categories: GridDisclosureCategory[]) { return categories.reduce((sum, category) => sum + (overview.value?.countsByCategory[category] ?? 0), 0) }
function baseQuery() {
  return { region: currentRegion.value.id, from: selection.value?.from ?? `${dateFrom.value}T00:00:00+08:00`, to: selection.value?.to ?? `${dateTo.value}T23:59:59+08:00`, windowMode: 'overlap',
    timePrecision: hasEventTools.value && appliedMaintenanceFilters.value.timingFilter === 'incomplete' ? 'all' : timePrecision.value,
    ...(keyword.value ? { keyword: keyword.value } : {}), ...eventFilterQuery.value, ...objectQuery.value }
}
function openSelectedObject() {
  if (!selected.value) return
  objectTarget.value = { kind: 'disclosure', id: selected.value.eventId, regionId: currentRegion.value.id }
  objectDrawerOpen.value = true
}
function updateMaintenanceFilters(value: MaintenanceFilters) {
  maintenanceFilters.value = { ...value }
  if (maintenanceSearchTimer) clearTimeout(maintenanceSearchTimer)
  const apply = () => {
    appliedMaintenanceFilters.value = { ...value }
    if (value.timingFilter === 'incomplete') timePrecision.value = 'all'
  }
  if (value.equipmentKeyword !== appliedMaintenanceFilters.value.equipmentKeyword || value.reasonKeyword !== appliedMaintenanceFilters.value.reasonKeyword) maintenanceSearchTimer = setTimeout(apply, 260)
  else apply()
}
function clearMaintenanceFilters() {
  if (maintenanceSearchTimer) clearTimeout(maintenanceSearchTimer)
  maintenanceFilters.value = createDefaultMaintenanceFilters(); appliedMaintenanceFilters.value = createDefaultMaintenanceFilters(); categoryFilter.value = ''
}
function eventDate(event: GridDisclosureEvent) { return event.businessDate ?? (event.effectiveAt ? minuteText(event.effectiveAt).slice(0, 10) : '日期未知') }
function eventTiming(event: GridDisclosureEvent) {
  const equipment = event.category === 'maintenance' || event.category === 'outage'
  const sourceTime = event.timeQuality?.effective !== 'business-date' && event.timeQuality?.effective !== 'unknown'
  const timestamp = (value: string | null | undefined) => sourceTime && value && parseDisclosureTime(value) !== null ? minuteText(value) : '未提供'
  const start = timestamp(event.effectiveAt), end = timestamp(event.expiresAt)
  const basis = sourceTime ? event.timeQuality?.intervalBasis : undefined
  const prefix = basis === 'actual' ? '实际' : basis === 'planned' ? '计划' : ''
  const sourceStart = event.source.time?.startField ?? ''
  // “干预时刻”等单点不等于停电时刻；日期和入库时间也不能补成停复电时间。
  const point = basis === 'point' && start !== '未提供'
  const pointPrefix = /实际停电/.test(sourceStart) ? '实际' : /计划停电/.test(sourceStart) ? '计划' : ''
  const startLabel = equipment
    ? point && !/停电/.test(sourceStart) ? '已知时点' : `${prefix || pointPrefix}停电时间`
    : `${prefix}生效时间`
  const endLabel = equipment ? `${prefix}复电时间` : `${prefix}结束时间`
  const note = start === '未提供' ? '时间未提供'
    : end === '未提供' ? '仅有单点，持续区间未知'
      : prefix ? `${prefix}${equipment ? '停复电' : '有效'}区间` : '来源有效区间'
  return { startLabel, endLabel, start, end, note }
}
function showRail() { railOpen.value = true; void nextTick(() => { if (railElement.value) railElement.value.scrollTop = 0; if (smallScreen.value) railElement.value?.querySelector<HTMLButtonElement>('.close-insights')?.focus() }) }
function hideRail() { railOpen.value = false; if (smallScreen.value) void nextTick(() => railToggle.value?.focus()) }
function openEvent(event: GridDisclosureEvent) { selected.value = event; showRail() }
function updateFavorite(update: { eventId: string; favorite: boolean }) {
  events.value = events.value.map((event) => event.eventId === update.eventId && event.personalFavorite !== update.favorite ? { ...event, personalFavorite: update.favorite } : event)
  if (selected.value?.eventId === update.eventId && selected.value.personalFavorite !== update.favorite) selected.value = { ...selected.value, personalFavorite: update.favorite }
}
function syncRailMedia() { smallScreen.value = railMedia?.matches ?? false; if (!smallScreen.value) railOpen.value = false }
function trapRailFocus(event: KeyboardEvent) {
  if (!smallScreen.value || !railOpen.value) return
  if (event.key === 'Escape') { event.preventDefault(); hideRail(); return }
  if (event.key !== 'Tab') return
  const focusable = Array.from(railElement.value?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') ?? [])
  const first = focusable[0], last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
async function loadOverview() {
  const request = ++overviewRequest
  overviewAbort?.abort(); overviewAbort = new AbortController()
  if (!validDate.value || !needsFilteredOverview.value || objectBlocked.value) { filteredOverview.value = null; overviewError.value = ''; overviewLoading.value = false; return }
  overviewLoading.value = true; overviewError.value = ''
  try { const result = await fetchGridDisclosureOverview({ ...baseQuery(), bucket: mode.value === 'day' ? 'hour' : 'day' }, { signal: overviewAbort.signal }); if (request === overviewRequest) filteredOverview.value = result }
  catch (cause) { if (request === overviewRequest) { filteredOverview.value = null; overviewError.value = cause instanceof Error ? cause.message : '披露聚合读取失败' } }
  finally { if (request === overviewRequest) overviewLoading.value = false }
}
async function loadRailOverview() {
  const request = ++railRequest
  railAbort?.abort(); railAbort = new AbortController()
  if (!validDate.value || objectBlocked.value) { railOverview.value = null; railLoading.value = false; return }
  railLoading.value = true; railError.value = ''
  try {
    const result = await fetchGridDisclosureOverview({ region: currentRegion.value.id, from: `${dateFrom.value}T00:00:00+08:00`, to: `${dateTo.value}T23:59:59+08:00`, windowMode: 'overlap', timePrecision: 'all', bucket: mode.value === 'day' ? 'hour' : 'day', ...(keyword.value ? { keyword: keyword.value } : {}), ...objectQuery.value }, { signal: railAbort.signal })
    if (request === railRequest) railOverview.value = result
  } catch (cause) { if (request === railRequest) { railOverview.value = null; railError.value = cause instanceof Error ? cause.message : '披露轨道读取失败' } }
  finally { if (request === railRequest) railLoading.value = false }
}
async function loadEvents() {
  const request = ++eventRequest
  const openSingle = pendingSingleEvent
  const grouped = eventLayout.value === 'groups'
  const query = { ...eventGroupQuery.value }
  pendingSingleEvent = false
  groupLoadKey.value += 1; focusGroupKey.value = null
  eventsAbort?.abort(); eventsAbort = new AbortController()
  if (!validDate.value || objectBlocked.value) { events.value = []; eventGroups.value = []; groupTotal.value = 0; eventTotal.value = 0; eventsLoading.value = false; return }
  eventsLoading.value = true; eventsError.value = ''; selected.value = null
  try {
    if (grouped) {
      const result = await fetchGridDisclosureGroups({ ...query, page: page.value, pageSize: groupPageSize }, { signal: eventsAbort.signal })
      if (request !== eventRequest) return
      eventGroups.value = result.items; groupTotal.value = result.groupTotal; eventTotal.value = result.total; availability.value = result.dataAvailability
      if (openSingle && result.total === 1 && result.items.length === 1) {
        const single = await fetchGridDisclosureEvents({ ...query, groupKey: result.items[0].groupKey, page: 1, pageSize: 1 }, { signal: eventsAbort.signal })
        if (request !== eventRequest) return
        if (single.total === 1 && single.items.length === 1) { focusGroupKey.value = result.items[0].groupKey; openEvent(single.items[0]) }
      }
    } else {
      const result = await fetchGridDisclosureEvents({ ...query, page: page.value, pageSize }, { signal: eventsAbort.signal })
      if (request !== eventRequest) return
      events.value = result.items; eventTotal.value = result.total; availability.value = result.dataAvailability
      if (openSingle && result.total === 1 && result.items.length === 1) openEvent(result.items[0])
    }
  } catch (cause) { if (request === eventRequest) { events.value = []; eventGroups.value = []; groupTotal.value = 0; eventTotal.value = 0; eventsError.value = cause instanceof Error ? cause.message : '披露事件读取失败' } }
  finally { if (request === eventRequest) eventsLoading.value = false }
}
async function loadCurve() {
  const request = ++curveRequest
  if (!validDate.value || objectContext.hasContext.value && !objectContext.detail.value) { curve.value = null; curveLoading.value = false; return }
  curveLoading.value = true; curveError.value = ''
  const boundChannel = objectContext.detail.value?.metricRefs?.find(item => item.metricId === metricId.value)?.channel
  const query = { regionId: currentRegion.value.id, metricId: metricId.value, dateFrom: dateFrom.value, dateTo: dateTo.value, ...cacheContext.value, preferredChannel: preferredChannels.get(`${scopeKey.value}:${metricId.value}`), ...(boundChannel || channel.value ? { channel: boundChannel || channel.value } : {}) }
  try {
    const result = await loadDisclosureDeskSeries(query)
    if (request !== curveRequest) return
    curve.value = boundChannel && result.selectedChannel !== boundChannel ? { ...result, series: [], summary: [], facts: [], selectedChannel: boundChannel, status: 'missing', reason: '该日期没有当前关联对象的指标，不展示其他通道替代。' } : result
    if (currentMetric.value.requiresChannel) channel.value = boundChannel ?? result.selectedChannel ?? ''
  } catch (cause) { if (request === curveRequest) { curve.value = null; curveError.value = cause instanceof Error ? cause.message : '指标曲线读取失败' } }
  finally { if (request === curveRequest) curveLoading.value = false }
}
function changeChannel() {
  if (channel.value) preferredChannels.set(`${scopeKey.value}:${metricId.value}`, channel.value)
  curve.value = null; void loadCurve()
}
async function loadProviders() { const request = ++providerRequest; try { const result = await fetchGridDisclosureProviders(); if (request === providerRequest) providers.value = result.providers } catch { if (request === providerRequest) providers.value = [] } }
async function loadThemeAvailability() {
  const request = ++themeAvailabilityRequest
  themeAvailability.value = {}
  if (!validDate.value) return
  try { const result = await loadDisclosureDeskThemeAvailability(currentRegion.value.id, dateFrom.value, dateTo.value, cacheContext.value); if (request === themeAvailabilityRequest) themeAvailability.value = result }
  catch { if (request === themeAvailabilityRequest) themeAvailability.value = {} }
}
function chooseTheme(id: DeskThemeId) { const theme = DISCLOSURE_DESK_THEMES.find((item) => item.id === id)!; selected.value = null; pendingSingleEvent = false; categoryFilter.value = ''; themeId.value = id; metricId.value = theme.metricId; feedMode.value = theme.categories.length || id === 'price' ? 'events' : 'metrics' }
function toggleTheme(id: DeskThemeId) { chooseTheme(themeId.value === id ? 'price' : id) }
function chooseMetric() { categoryFilter.value = ''; if (!['intervention', 'maintenance'].includes(themeId.value) || metricId.value !== 'price') themeId.value = currentMetric.value.themeId }
function pickMetric(id: string) { metricId.value = id; chooseMetric(); feedMode.value = 'metrics' }
function focusInsight(insight: DeskInsight) {
  pickMetric(insight.metricId); lockSelection(insight)
  if (smallScreen.value) hideRail()
  void nextTick(() => document.querySelector('.trend-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
}
function focusUnit(entry: UnitRosterEntry) {
  if (entry.date < dateFrom.value || entry.date > dateTo.value) { mode.value = 'day'; date.value = entry.date; clearSelection() }
  else selectMetricDay(entry.date)
}
function lockSelection(range: { from: string; to: string }) {
  const rawFrom = Date.parse(range.from), rawTo = Date.parse(range.to)
  if (!Number.isFinite(rawFrom) || !Number.isFinite(rawTo) || rawTo < rawFrom) return
  const interval = (currentMetric.value.nativeMinutes ?? 60) * 60_000
  const base = Date.parse(`${dateFrom.value}T00:00:00+08:00`)
  const bound = Date.parse(`${dateTo.value}T23:59:59.999+08:00`)
  const from = Math.max(base, base + Math.floor((rawFrom - base) / interval) * interval)
  const to = Math.min(bound, base + (Math.floor((rawTo - base) / interval) + 1) * interval - 1)
  const format = (value: number) => `${new Date(value + 8 * 3600_000).toISOString().slice(0, 23)}+08:00`
  selection.value = { from: format(from), to: format(to) }; timePrecision.value = mode.value === 'day' && !(hasEventTools.value && appliedMaintenanceFilters.value.timingFilter === 'incomplete') ? 'timed' : 'all'; hoveredAt.value = null
}
function selectMetricDay(day: string) { selection.value = { from: `${day}T00:00:00+08:00`, to: `${day}T23:59:59.999+08:00` }; timePrecision.value = 'all'; hoveredAt.value = null }
function focusEvent(payload: { from: string; to: string; category: GridDisclosureCategory; count: number }) {
  const from = Math.max(Date.parse(payload.from), Date.parse(`${dateFrom.value}T00:00:00+08:00`))
  const to = Math.min(Date.parse(payload.to), Date.parse(`${dateTo.value}T23:59:59.999+08:00`))
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return
  focusEventCategory(payload.category)
  // Event buckets are hours/days even when the current metric samples every 15 minutes.
  const format = (value: number) => `${new Date(value + 8 * 3600_000).toISOString().slice(0, 23)}+08:00`
  selection.value = { from: format(from), to: format(to) }; timePrecision.value = mode.value === 'day' ? 'timed' : 'all'; hoveredAt.value = null
  pendingSingleEvent = payload.count === 1
  eventFocusToken.value += 1
}
function focusEventCategory(category: GridDisclosureCategory) {
  clearMaintenanceFilters()
  chooseTheme(category === 'maintenance' || category === 'outage' ? 'maintenance' : category === 'intervention' ? 'intervention' : 'transmission')
  categoryFilter.value = category; feedMode.value = 'events'
}
function clearSelection() { selection.value = null; timePrecision.value = 'all'; selected.value = null; pendingSingleEvent = false; hoveredAt.value = null }
function onTrendPointerDown(event: PointerEvent) { pointerStartedInChart = event.target instanceof Element && Boolean(event.target.closest('.desk-chart-wrap')) }
function onTrendPanelClick(event: MouseEvent) {
  if (event.button !== 0 || event.defaultPrevented || pointerStartedInChart) return
  const target = event.target
  if (!(target instanceof Element) || target.closest('.desk-chart-wrap, .metric-picker, button, input, select, textarea, label, a, summary, [role="button"], [role="application"]')) return
  if (window.getSelection()?.toString()) return
  clearSelection()
}
function changePage(next: number) { if (next > 0 && next <= totalPages.value && next !== page.value) { page.value = next; void loadEvents() } }
function refresh() { refreshKey.value += 1; void Promise.all([loadRailOverview(), loadOverview(), loadEvents(), loadCurve(), loadProviders(), loadThemeAvailability()]) }
function resetFilters() { searchText.value = ''; keyword.value = ''; clearMaintenanceFilters(); chooseTheme('price'); clearSelection() }
watch(searchText, (value) => { if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(() => { keyword.value = value.trim() }, 260) })
// 深链承接要在保活复用时也生效：AppLayout 对路由页保活，setup 只跑一次——再次带
// keyword/objectDate 深链进入（实例未销毁）不会重跑 setup，必须按路由查询签名应用。
// 只认洞察电网边界页的深链（from=insight-grid-boundaries 或带 keyword）：grid-geo 对象
// 上下文链接（objectKind/objectId/objectDate，无 keyword/from）不是通道深链，不得被
// 错当成深链而强行切到「联络线与断面」主题。接受新签名时同步重置时间范围（单日盯盘、
// 清时段锁定与已知时刻筛选）——缓存页遗留的近七日模式或旧选区不能套在新词上；
// 同一签名再次进入保留本地编辑；不带深链键的普通导航不覆盖现场（keep-alive 既有语义）；
// 对象上下文键仍走 useGridObjectContext，两组键互不占用。
const DEEP_LINK_ORIGIN = 'insight-grid-boundaries'
let appliedDeepLink = ''
watch(
  () => [objectContext.active.value, JSON.stringify(deskRoute?.query ?? {})] as const,
  ([active]) => {
    if (!active) return
    const query = deskRoute?.query ?? {}
    const rawKeyword = queryText(query.keyword).trim()
    const rawDate = queryText(query.objectDate)
    if (!rawKeyword && !rawDate) return
    // 通道/断面深链的来源标记：对象上下文链接也带 objectDate 但没有这个 from、没有 keyword
    if (queryText(query.from) !== DEEP_LINK_ORIGIN && !rawKeyword) return
    const signature = JSON.stringify([rawKeyword, validObjectDate(rawDate) ? rawDate : ''])
    if (signature === appliedDeepLink) return
    appliedDeepLink = signature
    chooseTheme('transmission')
    mode.value = 'day'
    selection.value = null
    timePrecision.value = 'all'
    const linkKeyword = rawKeyword && rawKeyword.length <= 120 && !/[\u0000-\u001f]/.test(rawKeyword) ? rawKeyword : ''
    searchText.value = linkKeyword
    keyword.value = linkKeyword
    if (validObjectDate(rawDate) && !objectContext.hasContext.value) date.value = rawDate
  },
  { immediate: true }
)
watch(() => [dateFrom.value, dateTo.value, scopeKey.value], () => { clearSelection(); hoveredAt.value = null })
watch(scopeKey, clearMaintenanceFilters)
watch([dateFrom, dateTo, scopeKey, keyword, objectQueryKey], () => { railOverview.value = null; void loadRailOverview() }, { immediate: true })
watch([dateFrom, dateTo, scopeKey, keyword, objectQueryKey, () => selection.value?.from, () => selection.value?.to, timePrecision, () => JSON.stringify(eventFilterQuery.value)], () => { filteredOverview.value = null; void loadOverview() }, { immediate: true })
watch([dateFrom, dateTo, scopeKey, keyword, objectQueryKey, themeId, categoryFilter, () => selection.value?.from, () => selection.value?.to, timePrecision, eventFocusToken, () => JSON.stringify(eventFilterQuery.value), eventSort, () => eventLayout.value === 'groups'], () => { page.value = 1; events.value = []; eventGroups.value = []; groupTotal.value = 0; eventTotal.value = 0; availability.value = null; void loadEvents() }, { immediate: true })
watch(() => [dateFrom.value, dateTo.value, scopeKey.value, metricId.value, objectQueryKey.value], () => { channel.value = ''; curve.value = null; void loadCurve() }, { immediate: true })
watch(scopeKey, () => { providers.value = []; void loadProviders() }, { immediate: true })
watch(() => [dateFrom.value, dateTo.value, scopeKey.value], loadThemeAvailability, { immediate: true })
let appliedObjectContext = ''
watch(() => [objectContext.active.value, objectQueryKey.value, objectContext.date.value, JSON.stringify(objectContext.timeWindow.value)], async () => {
  if (!objectContext.active.value) return
  if (!objectContext.reference.value) { appliedObjectContext = ''; return }
  const signature = JSON.stringify([objectQueryKey.value, objectContext.date.value, objectContext.timeWindow.value, scopeKey.value])
  if (signature === appliedObjectContext) return
  appliedObjectContext = signature
  date.value = objectContext.date.value; mode.value = 'day'; clearMaintenanceFilters(); searchText.value = ''; keyword.value = ''; categoryFilter.value = ''
  const window = objectContext.timeWindow.value
  await nextTick()
  if (objectContext.active.value && appliedObjectContext === signature) selection.value = window
}, { immediate: true })
let appliedMetricObject = ''
watch(() => objectContext.detail.value, (detail) => {
  if (!objectContext.active.value || !detail) return
  const key = JSON.stringify([detail.reference, scopeKey.value])
  if (key === appliedMetricObject) return
  appliedMetricObject = key
  const binding = detail.metricRefs?.[0]
  const metric = getDisclosureDeskMetric(binding?.metricId ?? 'price')
  if (metric) { metricId.value = metric.id; themeId.value = metric.themeId; channel.value = binding?.channel ?? ''; void loadCurve() }
})
onMounted(() => { railMedia = window.matchMedia?.('(max-width: 1100px)') ?? null; syncRailMedia(); railMedia?.addEventListener?.('change', syncRailMedia) })
onBeforeUnmount(() => { overviewRequest += 1; railRequest += 1; eventRequest += 1; curveRequest += 1; providerRequest += 1; themeAvailabilityRequest += 1; overviewAbort?.abort(); railAbort?.abort(); eventsAbort?.abort(); railMedia?.removeEventListener?.('change', syncRailMedia); if (searchTimer) clearTimeout(searchTimer); if (maintenanceSearchTimer) clearTimeout(maintenanceSearchTimer) })
</script>

<template>
  <section class="disclosure-desk" data-testid="disclosure-desk">
    <GridObjectContextBar :date="date" :from="selection?.from" :to="selection?.to" />
    <div v-if="objectContext.hasContext.value" class="object-scope-note">披露按当前对象精确关联；电价与供需指标保留其标明的地区口径。</div>
    <GridObjectDrawer v-model="objectDrawerOpen" :object="objectTarget" :date="date" :from="selection?.from" :to="selection?.to" />
    <header class="desk-header"><div class="desk-brand"><span class="brand-icon"><Zap :size="20" /></span><div><h1>公开披露<span>交易观察台</span></h1><small>日前研判 · 日内跟踪</small></div></div><div class="region-chip"><MapPinned :size="14" />{{ currentRegion.shortName }}<span>当前地区</span></div><div class="header-context"><i :class="{ muted: activeProvider?.dataAvailability.status !== 'available' }" />{{ activeProvider?.name ?? '披露来源待确认' }}</div><button class="refresh" type="button" data-testid="desk-refresh" :disabled="busy" aria-label="刷新披露与指标" @click="refresh"><RefreshCw :size="15" :class="{ spinning: busy }" /><span>刷新</span></button></header>
    <div class="desk-toolbar"><div class="period-group"><button type="button" data-testid="desk-mode-day" :aria-pressed="mode === 'day'" @click="mode = 'day'">单日盯盘</button><button type="button" data-testid="desk-mode-week" :aria-pressed="mode === 'week'" @click="mode = 'week'">近 7 日</button></div><div class="date-control"><button type="button" aria-label="前一天" @click="date = shiftDate(date, -1)"><ChevronLeft :size="14" /></button><label><CalendarDays :size="14" /><input v-model="date" type="date" aria-label="交易日期" data-testid="desk-date" /></label><button type="button" aria-label="后一天" @click="date = shiftDate(date, 1)"><ChevronRight :size="14" /></button></div><button class="text-button" type="button" @click="date = todayBeijing()">今天</button><button class="text-button" type="button" @click="date = shiftDate(todayBeijing(), 1)">明天</button><label class="search-box"><Search :size="15" /><input v-model="searchText" data-testid="desk-search" aria-label="搜索披露事件" placeholder="设备、电厂、断面、原因…" /><button v-if="searchText" type="button" aria-label="清除关键词" @click="searchText = ''"><X :size="13" /></button></label></div>
    <div class="desk-workspace"><main class="desk-main">
      <section class="trend-panel" aria-label="指标与披露趋势" @pointerdown="onTrendPointerDown" @click="onTrendPanelClick"><div class="trend-header"><div><div class="section-kicker">市场与披露 · 同一时间窗口</div><DisclosureMetricPicker v-model="metricId" :groups="metricGroups" @change="chooseMetric" /></div><div class="trend-values"><template v-if="hoveredAt"><div v-for="item in hoverValues.slice(0, 2)" :key="item.id"><small>{{ item.label }}</small><strong>{{ numberText(item.point?.value) }}<em>{{ item.unit }}</em></strong></div></template><template v-else><div v-for="item in selectedSummary.slice(0, 2)" :key="item.id"><small>{{ item.label }} · 末值</small><strong>{{ numberText(item.latest) }}<em>{{ item.unit }}</em></strong></div></template><span v-if="!selectedSummary.length" class="waiting-value">{{ curveLoading ? '读取指标…' : '等待可用数据' }}</span></div></div>
        <div class="trend-context"><span v-if="date !== todayBeijing()" class="date-mode-badge">{{ date.localeCompare(todayBeijing()) === -1 ? '数据回看' : '未来交易日 · 数据可能尚未发布' }}</span><span><Clock3 :size="12" />{{ hoveredAt ? `悬停 ${shortTime(hoveredAt)}` : focusLabel }}</span><span>{{ currentMetric.nativeMinutes ? `${currentMetric.nativeMinutes} 分钟原生粒度` : '日级原始记录' }} · 北京时间</span><span v-if="curve" :class="['source-state', curve.status]">{{ statusLabels[curve.status] }}</span></div>
        <nav v-if="themeMetrics.length > 1" class="metric-subnav" aria-label="当前主题子指标"><button v-for="metric in themeMetrics" :key="metric.id" type="button" :aria-pressed="metricId === metric.id" @click="pickMetric(metric.id)">{{ metric.label }}</button></nav><div v-if="currentMetric.requiresChannel" class="channel-control"><Filter :size="14" /><label>{{ channelLabel }}<select v-model="channel" aria-label="指标地区或通道" :disabled="curveLoading || !curve?.channels.length" @change="changeChannel"><option value="" disabled>{{ channelPlaceholder }}</option><option v-for="item in curve?.channels ?? []" :key="item" :value="item">{{ item }}</option></select></label><small>{{ metricScope }}</small></div><p v-if="metricId === 'section-constraint'" class="metric-direction-note">正向、反向限值分别保留来源数值与符号。</p><div v-if="railError" class="inline-error" role="alert">披露轨道加载失败：{{ railError }}<button type="button" @click="loadRailOverview">重试</button></div><div v-if="overviewError" class="inline-error" role="alert">选区统计加载失败：{{ overviewError }}<button type="button" @click="loadOverview">重试</button></div>
        <DisclosureDeskChart v-if="validDate" :event-window="selectedEventWindow" :text-facts="currentMetric.textValue ? curve?.facts : undefined" :series="curve?.series ?? []" :overview="chartOverview" :date-from="dateFrom" :date-to="dateTo" :selection="selection" :empty-title="curveEmptyTitle" :empty-reason="curveError || curve?.reason || (curveLoading ? '正在读取当前地区指标…' : undefined)" @hover="hoveredAt = $event" @select="lockSelection" @event-focus="focusEvent" @clear="clearSelection" />
      </section>
      <div class="theme-period">主题统计 · {{ focusLabel }} · 随搜索与时间条件筛选</div><nav class="theme-grid" aria-label="交易驱动主题"><button v-for="theme in visibleThemes" :key="theme.id" type="button" :data-testid="`desk-theme-${theme.id}`" :aria-pressed="themeId === theme.id" :class="['theme-card', theme.id]" @click="toggleTheme(theme.id)"><component :is="themeIcons[theme.id as keyof typeof themeIcons]" :size="19" /><span><strong>{{ theme.label }}</strong><small>{{ themeDescriptions[theme.id as keyof typeof themeDescriptions] }}</small></span><b v-if="theme.categories.length">{{ overview ? numberText(categoryCount(theme.categories)) : '—' }}<small>条</small></b><b v-else class="theme-availability" title="当前日期窗口内有覆盖登记的指标数量；不保证每个时段都有样本">{{ themeAvailability[theme.id] ? `${themeAvailability[theme.id]!.available}/${themeAvailability[theme.id]!.total}` : '—' }}<small>{{ themeAvailability[theme.id] ? '有覆盖' : '待确认' }}</small></b></button></nav>
      <button ref="railToggle" type="button" class="mobile-insights" data-testid="desk-open-insights" :aria-expanded="railOpen" aria-controls="disclosure-insights" @click="showRail"><Activity :size="16" />查看时段解读 / 详情<ArrowRight :size="14" /></button><DisclosureUnitRoster v-if="themeId === 'reserve'" :region-id="currentRegion.id" :date-from="selection ? minuteText(selection.from).slice(0, 10) : dateFrom" :date-to="selection ? minuteText(selection.to).slice(0, 10) : dateTo" :scope-key="scopeKey" :refresh-key="refreshKey" @select="focusUnit" /><section class="feed-panel"><header class="feed-header"><div class="feed-tabs"><button type="button" :aria-pressed="feedMode === 'events'" @click="feedMode = 'events'"><FileText :size="14" />关联披露 <b>{{ numberText(eventTotal) }}</b></button><button type="button" :aria-pressed="feedMode === 'metrics'" @click="feedMode = 'metrics'"><ArrowDownUp :size="14" />指标读数</button></div><button v-if="themeId !== 'price' || keyword || categoryFilter || selection || timePrecision !== 'all' || (hasEventTools && hasMaintenanceFilters(maintenanceFilters))" class="text-button" type="button" @click="resetFilters">重置筛选</button></header><DisclosureMaintenanceTools v-if="hasEventTools && feedMode === 'events'" :generic="!maintenanceMode" :categories="categoryOptions" :model-value="maintenanceFilters" :category="categoryFilter" :window-label="focusLabel" @update:model-value="updateMaintenanceFilters" @update:category="categoryFilter = $event" @clear="clearMaintenanceFilters" /><div v-else class="category-filter"><label>披露类别<select v-model="categoryFilter" aria-label="披露类别"><option value="">当前主题全部类别</option><option v-for="category in categoryOptions" :key="category" :value="category">{{ categoryLabels[category] }}</option></select></label></div><div v-if="feedMode === 'events'" class="event-layout-switch" :aria-label="maintenanceMode ? '检修信息展示方式' : '披露信息展示方式'"><span>共 {{ numberText(eventTotal) }} 条匹配记录<template v-if="eventLayout === 'groups'"> · {{ numberText(groupTotal) }} 组</template></span><button type="button" :aria-pressed="eventLayout === 'groups'" @click="eventLayout = 'groups'">按电厂 / 对象</button><button type="button" :aria-pressed="eventLayout === 'list'" @click="eventLayout = 'list'">紧凑列表</button><button type="button" :aria-pressed="eventLayout === 'cards'" @click="eventLayout = 'cards'">信息卡片</button></div><div class="focus-strip"><span><Filter :size="12" />{{ eventContextLabel }} · {{ focusLabel }}{{ timePrecision === 'timed' ? ' · 已知时刻' : '' }}</span><button v-if="selection || timePrecision !== 'all'" type="button" data-testid="desk-clear-selection" @click="clearSelection">解除时段锁定<X :size="12" /></button></div>
        <template v-if="feedMode === 'events'"><div v-if="eventsError" class="inline-error" role="alert">{{ eventsError }}<button type="button" @click="loadEvents">重试</button></div><div v-else-if="eventsLoading" class="feed-state" role="status"><RefreshCw :size="21" class="spinning" />正在读取所选范围披露…</div><div v-else-if="!hasEventRows" class="feed-state" data-testid="desk-events-empty"><FileText :size="28" /><strong>所选范围暂无披露记录</strong><p>{{ availability?.reason || '可切换日期、主题或清除关键词查看其他已接入记录。' }}</p><button v-if="overview?.coverage.to && date !== overview.coverage.to.slice(0, 10)" type="button" @click="date = overview.coverage.to.slice(0, 10)">最近披露日 {{ overview.coverage.to.slice(0, 10) }}</button></div>
          <DisclosureEventGroups v-else-if="eventLayout === 'groups'" :key="groupLoadKey" :groups="eventGroups" :query="eventGroupQuery" :scope-key="scopeKey" :selected-id="selected?.eventId" :selected-event="selected" :focus-group-key="focusGroupKey" :event-timing="eventTiming" @select="openEvent" /><DisclosureMaintenanceList v-else-if="eventLayout === 'list'" :generic="!maintenanceMode" :rows="eventCards" :selected-id="selected?.eventId" @select="openEvent" /><div v-else class="event-grid" data-testid="desk-events"><button v-for="{ event, timing } in eventCards" :key="event.eventId" type="button" :class="['event-card', event.category, { selected: selected?.eventId === event.eventId }]" :aria-pressed="selected?.eventId === event.eventId" @click="openEvent(event)"><div class="event-card-meta"><i /><span>{{ categoryLabels[event.category] }}</span><time>{{ eventDate(event) }}</time></div><h3>{{ event.title }}</h3><p>{{ event.summary }}</p><dl class="event-time-fields"><div><dt>{{ timing.startLabel }}</dt><dd>{{ timing.start }}</dd></div><div><dt>{{ timing.endLabel }}</dt><dd>{{ timing.end }}</dd></div></dl><div class="event-foot"><span><MapPinned :size="12" />{{ event.spatialBinding.label }}</span></div><div class="event-source"><span :title="event.source.file">{{ activeProvider?.name ?? event.source.file }}</span><small :class="{ watched: event.personalFavorite }">{{ event.personalFavorite ? '已收藏' : '未收藏' }}</small></div><div class="event-time"><span>{{ timing.note }}</span><span>{{ selected?.eventId === event.eventId ? '正在查看' : '查看证据' }}<ArrowRight :size="12" /></span></div></button></div>
          <footer v-if="totalPages > 1" class="pager"><button type="button" :disabled="page === 1" :aria-label="eventLayout === 'groups' ? '上一页分组' : '上一页披露'" @click="changePage(page - 1)"><ChevronLeft :size="15" />上一页</button><span>{{ page }} / {{ totalPages }} 页 · 共 {{ eventLayout === 'groups' ? `${numberText(groupTotal)} 组` : `${numberText(eventTotal)} 条` }}</span><button type="button" :disabled="page === totalPages" :aria-label="eventLayout === 'groups' ? '下一页分组' : '下一页披露'" @click="changePage(page + 1)">下一页<ChevronRight :size="15" /></button></footer>
        </template>
        <div v-else class="metric-grid" data-testid="desk-metric-cards"><button v-for="item in dailyCards" :key="`${item.date}:${item.id}`" type="button" class="metric-card" :aria-label="`查看 ${item.date} ${item.label}`" @click="selectMetricDay(item.date)"><small>{{ item.date }} · {{ item.label }}</small><strong>{{ numberText(item.latest) }}<em>{{ item.unit }}</em></strong><dl><div><dt>低值</dt><dd>{{ numberText(item.min) }}</dd></div><div><dt>高值</dt><dd>{{ numberText(item.max) }}</dd></div><div><dt>高值时点</dt><dd>{{ item.maxAt?.slice(5) ?? '—' }}</dd></div><div><dt>有效样本</dt><dd>{{ item.validPoints }} / {{ item.expectedPoints }}</dd></div></dl><p>该日原生时点 · 点击定位主图</p></button><article v-for="fact in visibleFacts" :key="`${fact.time}:${fact.label}`" class="metric-card"><small>{{ fact.time }} · {{ fact.label }}</small><strong v-if="fact.unit">{{ fact.value }}<em>{{ fact.unit }}</em></strong><p v-else class="text-fact">{{ fact.value }}</p><p v-if="fact.reason">原因：{{ fact.reason }}</p><details v-if="fact.sourceFile || fact.sourceTable" class="fact-source"><summary>查看来源</summary><p>{{ fact.sourceTable }}</p><p>{{ fact.sourceFile }}</p></details><p>{{ fact.unit ? '日级电量要求，未扩展为全天功率曲线。' : '源记录文字披露，未转换为数值曲线。' }}</p></article><div v-if="!dailyCards.length && !visibleFacts.length" class="feed-state"><Gauge :size="25" /><strong>暂无可统计的指标读数</strong><p>{{ curveError || curve?.reason || '请选择已接入指标与日期。' }}</p></div></div>
      </section>
    </main>
    <button v-if="smallScreen && railOpen" type="button" class="insights-scrim" tabindex="-1" aria-label="关闭时段解读" @click="hideRail" /><aside id="disclosure-insights" ref="railElement" class="analysis-rail" :class="{ 'mobile-open': railOpen }" :role="smallScreen ? 'dialog' : undefined" :aria-modal="smallScreen && railOpen ? true : undefined" aria-label="时段事实与事件分析" @keydown="trapRailFocus"><div class="analysis-title"><span><Activity :size="16" />时段观察</span><small>随图表选择联动</small><button type="button" class="close-insights" aria-label="关闭时段解读" @click="hideRail"><X :size="17" /></button></div><section class="focus-summary"><div class="section-kicker">{{ selection ? '已锁定时段' : '当前观察窗口' }}</div><h2>{{ focusLabel }}</h2><p>{{ currentRegion.shortName }} · {{ dateFrom === dateTo ? dateFrom : `${dateFrom} — ${dateTo}` }} · {{ eventContextLabel }}</p><p v-if="currentMetric.requiresChannel">指标对象：{{ channel || '未选择' }} · {{ metricScope }}</p><div class="summary-numbers"><div><strong>{{ numberText(eventTotal) }}</strong><span>相关披露</span></div><div><strong>{{ numberText(availablePoints) }}</strong><span>有效指标点</span></div></div></section>
      <DisclosureEvidencePanel v-if="selected" :key="`${scopeKey}:${selected.eventId}`" :event="selected" :scope-key="scopeKey" @favorite-change="updateFavorite" @open-object="openSelectedObject" @close="selected = null" /><section class="facts-section"><h3><Check :size="15" />可确认的事实</h3><ul><li v-for="item in selectedSummary.filter((item) => item.validPoints > 0).slice(0, 3)" :key="item.id"><span>{{ item.label }}</span><strong>{{ numberText(item.min) }} — {{ numberText(item.max) }} <small>{{ item.unit }}</small></strong><p>高值 {{ item.maxAt?.slice(5) ?? '—' }} · {{ item.validPoints }} / {{ item.expectedPoints }} 时点</p></li><li v-for="fact in visibleFacts.slice(0, 3)" :key="`${fact.time}:${fact.label}`" class="text-fact"><span>{{ fact.time }} · {{ fact.label }}</span><p>{{ fact.value }}<span v-if="fact.unit"> {{ fact.unit }}</span></p><p v-if="fact.reason">原因：{{ fact.reason }}</p></li><li v-if="!availablePoints && !visibleFacts.length"><span>{{ curveLoading ? '指标正在读取' : '指标暂无有效样本' }}</span><p>{{ curveError || curve?.reason || '披露和指标分别确认可用性。' }}</p></li></ul><p class="fact-note">同一时间窗内共同观察，不将时间重合视为价格变化的原因。</p></section>
      <DisclosureDeskInsights :region-id="currentRegion.id" :date-from="dateFrom" :date-to="dateTo" :scope-key="scopeKey" :selection="selection" :refresh-key="refreshKey" @focus="focusInsight" />
      <template v-if="!selected"><section class="select-hint"><FileText :size="22" /><strong>选一条披露，查看证据</strong><p>查看事件时间、来源与关注笔记，主图保留当前观察窗口。</p></section></template><DisclosureRegionContext :region-id="currentRegion.id" :region-label="currentRegion.shortName" :scope-key="scopeKey" :event-scope="selected?.spatialBinding.label" />
    </aside></div>
  </section>
</template>

<style scoped src="./disclosureDesk.css"></style>

<style scoped>
.object-scope-note{margin:8px 0 12px;color:var(--muted);font-size:var(--font-sm);line-height:1.5}
</style>
