<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ApiError } from '@/services/api'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { parseGridNodeName } from '@/services/gridGeo/nodeNameParser'
import { Clock3, Crosshair, History, LocateFixed, MapPinned, Pencil, Plus, RefreshCw, RotateCcw, Search, Waypoints, X } from 'lucide-vue-next'
import GridOperatorProfileBanner from './GridOperatorProfileBanner.vue'
import GridGeoNodeTable from './GridGeoNodeTable.vue'
import GridGeoStationTable from './GridGeoStationTable.vue'
import GridObjectDrawer from './GridObjectDrawer.vue'
import GridObjectContextBar from './GridObjectContextBar.vue'
import { useGridObjectContext } from './useGridObjectContext'
import { nodeListStatistics } from './nodeTable'
import {
  createGridGeoNode, fetchGridGeoManifest, fetchGridGeoNodeRevisions, fetchGridGeoNodes,
  revertGridGeoNode, updateGridGeoNode,
} from './client'
import type { GridGeoLocationStatus, GridGeoNode, GridGeoNodeKind, GridGeoNodeListResponse, GridGeoNodeStationGroup, GridGeoRevision, GridGeoVisibility, GridOperatorProfile } from './types'

const loading = ref(false)
const objectContext = useGridObjectContext()
const saving = ref(false)
const nodes = shallowRef<GridGeoNode[]>([])
const stationGroups = shallowRef<GridGeoNodeStationGroup[]>([])
const totalStations = ref<number | null>(null)
const canWrite = ref(false)
const error = ref('')
const historyError = ref('')
const historyLoading = ref(false)
const listSource = ref('')
const dataMissing = ref(false)
const listSummary = ref<GridGeoNodeListResponse['data']['summary'] | null>(null)
const layout = ref<'table' | 'cards'>('table')
const grouped = ref(true)
const stationMode = computed(() => layout.value === 'table' && grouped.value)
const detailOpen = ref(false)
const detailNode = ref<GridGeoNode | null>(null)
const detailObject = computed(() => detailNode.value ? { kind: 'node' as const, id: detailNode.value.nodeId, regionId: detailNode.value.regionId, gridOperator: detailNode.value.gridOperator } : null)
const scopeKey = computed(() => `${currentRegion.value.id}:${selectedCompanyId.value ?? ''}`)
const operatorProfile = ref<GridOperatorProfile | null>(null)
const keyword = ref('')
const kindFilter = ref<'all' | GridGeoNodeKind>('all')
const locationFilter = ref<'all' | GridGeoLocationStatus>('all')
const editorOpen = ref(false)
const historyOpen = ref(false)
const editing = ref<GridGeoNode | null>(null)
const history = shallowRef<GridGeoRevision<GridGeoNode>[]>([])
const historyNode = ref<GridGeoNode | null>(null)
const page = ref(1)
const pageSize = computed(() => stationMode.value ? 20 : 60)
const total = ref<number | null>(null)
const totalPages = ref(1)
let filterTimer: ReturnType<typeof setTimeout> | null = null
let loadRequestId = 0
let detailRequestId = 0
let writeRequestId = 0
let active = true

const kinds = computed<Array<{ value: GridGeoNodeKind; label: string }>>(() => [
  { value: 'pricing', label: operatorProfile.value?.terminology.pricingNode ?? '定价节点' }, { value: 'bus', label: '母线节点' },
  { value: 'substation', label: '变电站' }, { value: 'boundary', label: '边界节点' }, { value: 'other', label: '其他' },
])
const locationStates: Array<{ value: GridGeoLocationStatus; label: string; tip: string }> = [
  { value: 'located', label: '已定位', tip: '有经核验坐标' },
  { value: 'approximate', label: '近似位置', tip: '仅表示区域级分布' },
  { value: 'unresolved', label: '未定位', tip: '保留资产身份，不伪造坐标' },
]

const form = reactive({
  nodeId: '', nodeName: '', aliasesText: '', nodeKind: 'pricing' as GridGeoNodeKind,
  voltageLevelKv: null as number | null, status: 'active', visibility: 'company' as GridGeoVisibility,
  locationStatus: 'unresolved' as GridGeoLocationStatus, longitude: null as number | null,
  latitude: null as number | null, locationLabel: '', accuracyLevel: 'approximate',
  confidence: 'unverified', uncertaintyMeters: 10000, evidenceTitle: '', evidenceUrl: '',
  marketFamily: '', reason: '', note: '',
})

// 节点名结构化解析建议（#1439 第①项）：只建议不自动写入，补录的每个字段都进版本
// 历史与审计链，静默改写用户输入会让「谁填的这个值」不可追溯。用户点「用解析值」才应用。
const parsedName = computed(() => parseGridNodeName(form.nodeName))
const nameHint = computed(() => {
  if (!form.nodeName.trim()) return null
  const parsed = parsedName.value
  const station = parsed.stationName ? `站名「${parsed.stationName}」` : '站名无法从名称判定'
  if (parsed.basis === 'unresolved') return { text: `${station}；名称中未写明电压等级，请人工确认后填写`, canApply: false }
  const source = parsed.basis === 'node-segment'
    ? '取自节点段（该节点自身电压）'
    : `取自站段前缀（站级电压，该节点实际电压可能更低）`
  const conflict = parsed.stationVoltageKv !== null && parsed.stationVoltageKv !== parsed.voltageLevelKv
    ? `；所属站为 ${parsed.stationVoltageKv} kV`
    : ''
  return { text: `${station}；电压 ${parsed.voltageLevelKv} kV ${source}${conflict}`, canApply: true }
})
const applyParsedVoltage = () => {
  const parsed = parsedName.value
  if (parsed.voltageLevelKv === null) return
  form.voltageLevelKv = parsed.voltageLevelKv
  ElMessage.success(`已填入 ${parsed.voltageLevelKv} kV，提交前请核对`)
}

const filtered = computed(() => nodes.value)
const nodeQuery = computed((): Record<string, string | number> => {
  const query: Record<string, string | number> = {}
  const object = objectContext.reference.value
  if (object) { query.objectKind = object.kind; query.objectId = object.id }
  if (keyword.value.trim()) query.keyword = keyword.value.trim()
  if (kindFilter.value !== 'all') query.nodeKind = kindFilter.value
  if (locationFilter.value !== 'all') query.locationStatus = locationFilter.value
  return query
})
const stationScopeKey = computed(() => JSON.stringify([scopeKey.value, nodeQuery.value]))
const hasRows = computed(() => stationMode.value ? stationGroups.value.length > 0 : filtered.value.length > 0)
const pageNodeCount = computed(() => stationMode.value ? stationGroups.value.reduce((sum, group) => sum + group.nodeCount, 0) : filtered.value.length)
const summary = computed(() => nodeListStatistics(listSummary.value, total.value))
const formatCount = (value: number | null) => value === null ? '未提供' : value.toLocaleString('zh-CN')

function kindLabel(value: GridGeoNodeKind) { return kinds.value.find((item) => item.value === value)?.label ?? value }
function statusLabel(value: GridGeoLocationStatus) { return locationStates.find((item) => item.value === value)?.label ?? value }
function formatTime(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return '未提供'
  return new Date(value).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}

async function load() {
  if (filterTimer) { clearTimeout(filterTimer); filterTimer = null }
  const requestId = ++loadRequestId
  const requestScope = scopeKey.value
  loading.value = true
  error.value = ''
  nodes.value = []
  stationGroups.value = []
  totalStations.value = null
  listSummary.value = null
  total.value = null
  listSource.value = ''
  dataMissing.value = false
  const object = objectContext.reference.value
  if (objectContext.hasContext.value && !object) {
    error.value = '对象关联与当前公司或地区不一致，请清除关联后查看。'
    canWrite.value = false
    loading.value = false
    return
  }
  try {
    const [list, manifest] = await Promise.all([fetchGridGeoNodes({
      ...nodeQuery.value, page: page.value, pageSize: pageSize.value,
      ...(stationMode.value ? { groupBy: 'station' } : {}),
    }), fetchGridGeoManifest().catch(() => null)])
    if (!active || requestId !== loadRequestId || requestScope !== scopeKey.value) return
    if (stationMode.value && !Array.isArray(list.data?.groups)) throw new Error('尚未取得完整站级分组，请重试读取。')
    nodes.value = list.data?.items ?? []
    stationGroups.value = list.data?.groups ?? []
    total.value = stationMode.value ? list.data?.totalNodes ?? null : list.data?.pagination?.total ?? list.total ?? null
    totalStations.value = stationMode.value ? list.data?.pagination?.total ?? null : null
    listSummary.value = list.data?.summary ?? null
    listSource.value = list.mock ? '模拟数据' : list.sourceType === 'DB' ? '资产资料' : '来源未确认'
    dataMissing.value = list.data?.dataAvailability?.status === 'missing'
    totalPages.value = list.data?.pagination?.totalPages ?? 1
    canWrite.value = Boolean(manifest?.capabilities.canWrite)
  } catch (cause) {
    if (!active || requestId !== loadRequestId || requestScope !== scopeKey.value) return
    canWrite.value = false
    error.value = cause instanceof ApiError && cause.status === 403 ? '当前公司或地区无节点资产查看权限' : cause instanceof Error ? cause.message : '节点资产加载失败'
  } finally { if (active && requestId === loadRequestId && requestScope === scopeKey.value) loading.value = false }
}

function openDetail(node: GridGeoNode) { detailNode.value = node; detailOpen.value = true }

function resetForm() {
  Object.assign(form, {
    nodeId: '', nodeName: '', aliasesText: '', nodeKind: 'pricing', voltageLevelKv: null,
    status: 'active', visibility: 'company', locationStatus: 'unresolved', longitude: null,
    latitude: null, locationLabel: '', accuracyLevel: 'approximate', confidence: 'unverified',
    uncertaintyMeters: 10000, evidenceTitle: '', evidenceUrl: '', marketFamily: '', reason: '', note: '',
  })
}

function openCreate() { if (!canWrite.value) return; editing.value = null; resetForm(); editorOpen.value = true }
function openEdit(node: GridGeoNode) {
  if (!canWrite.value) return
  editing.value = node
  Object.assign(form, {
    nodeId: node.nodeId, nodeName: node.nodeName, aliasesText: node.aliases.join('、'), nodeKind: node.nodeKind,
    voltageLevelKv: node.voltageLevelKv, status: node.status, visibility: node.visibility,
    locationStatus: node.locationStatus, longitude: node.location?.longitude ?? null, latitude: node.location?.latitude ?? null,
    locationLabel: node.location?.locationLabel ?? '', accuracyLevel: node.location?.accuracyLevel ?? 'approximate',
    confidence: node.location?.confidence ?? 'unverified', uncertaintyMeters: node.location?.uncertaintyMeters ?? 10000,
    evidenceTitle: node.location?.evidence?.[0]?.title ?? '', evidenceUrl: node.location?.evidence?.[0]?.url ?? '',
    marketFamily: String(node.marketRefs?.nodePriceFamily ?? ''), reason: '', note: node.dataMeta.note ?? '',
  })
  editorOpen.value = true
}

function pickCoordinate(event: MouseEvent) {
  if (form.locationStatus === 'unresolved') return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  form.longitude = Number((73 + ((event.clientX - rect.left) / rect.width) * 63).toFixed(5))
  form.latitude = Number((54 - ((event.clientY - rect.top) / rect.height) * 51).toFixed(5))
}

function locationPayload() {
  if (form.locationStatus === 'unresolved') return null
  return {
    longitude: Number(form.longitude), latitude: Number(form.latitude), coordinateSystem: 'WGS84',
    locationLabel: form.locationLabel.trim(), accuracyLevel: form.accuracyLevel, confidence: form.confidence,
    uncertaintyMeters: Number(form.uncertaintyMeters), displayPolicy: form.accuracyLevel === 'site' ? 'exact-marker' : 'uncertainty-halo',
    coordinateSource: null,
    evidence: form.evidenceTitle.trim() && form.evidenceUrl.trim() ? [{ title: form.evidenceTitle.trim(), url: form.evidenceUrl.trim() }] : [],
  }
}

async function save() {
  if (!canWrite.value || saving.value) return
  if (!form.nodeName.trim()) return ElMessage.warning('请填写节点名称')
  if (!editing.value && !/^[a-z0-9][a-z0-9-]{2,80}$/.test(form.nodeId)) return ElMessage.warning('ID 请使用 3-81 位小写字母、数字或连字符')
  if (form.locationStatus !== 'unresolved' && (!Number.isFinite(Number(form.longitude)) || !Number.isFinite(Number(form.latitude)))) return ElMessage.warning('请在空间拾取区点选坐标')
  if (!form.reason.trim()) return ElMessage.warning('请填写本次变更原因')
  saving.value = true
  const requestId = ++writeRequestId
  const requestScope = scopeKey.value
  const aliases = form.aliasesText.split(/[、,\n]/).map((item) => item.trim()).filter(Boolean)
  const location = locationPayload()
  const base = {
    nodeName: form.nodeName.trim(), standardName: form.nodeName.trim(), aliases, nodeKind: form.nodeKind,
    voltageLevelKv: form.voltageLevelKv, status: form.status.trim(), locationStatus: form.locationStatus,
    marketRefs: form.marketFamily ? { nodePriceFamily: form.marketFamily.trim() } : {},
    dataMeta: { note: form.note.trim() },
  }
  try {
    if (editing.value) {
      const changes = { ...base, ...(location ? { location } : {}) }
      await updateGridGeoNode(editing.value.nodeId, { expectedVersion: editing.value.version, changes, reason: form.reason.trim(), evidence: location?.evidence ?? [] })
      if (!active || requestId !== writeRequestId || requestScope !== scopeKey.value) return
      ElMessage.success('节点资产已更新')
    } else {
      await createGridGeoNode({ nodeId: form.nodeId, ...base, location, visibility: form.visibility, reason: form.reason.trim(), evidence: location?.evidence ?? [] })
      if (!active || requestId !== writeRequestId || requestScope !== scopeKey.value) return
      ElMessage.success('节点资产已创建')
    }
    editorOpen.value = false
    detailOpen.value = false
    detailNode.value = null
    await load()
  } catch (cause) {
    if (!active || requestId !== writeRequestId || requestScope !== scopeKey.value) return
    if (cause instanceof ApiError && cause.status === 409) {
      ElMessage.warning('资产版本已变化，已刷新最新数据，请重新确认后保存')
      editorOpen.value = false
      detailOpen.value = false
      detailNode.value = null
      await load()
    } else ElMessage.error(cause instanceof Error ? cause.message : '保存失败')
  } finally { if (active && requestId === writeRequestId && requestScope === scopeKey.value) saving.value = false }
}

async function openHistory(node: GridGeoNode) {
  const requestId = ++detailRequestId
  const requestScope = scopeKey.value
  historyNode.value = node; historyOpen.value = true; history.value = []
  historyLoading.value = true
  historyError.value = ''
  try {
    const rows = (await fetchGridGeoNodeRevisions(node.nodeId)).rows
    if (active && requestId === detailRequestId && requestScope === scopeKey.value) history.value = rows
  }
  catch (cause) { if (active && requestId === detailRequestId && requestScope === scopeKey.value) historyError.value = cause instanceof Error ? cause.message : '历史加载失败' }
  finally { if (active && requestId === detailRequestId && requestScope === scopeKey.value) historyLoading.value = false }
}

async function revert(revision: GridGeoRevision<GridGeoNode>) {
  if (!canWrite.value || !historyNode.value || !revision.before) return
  const targetNode = historyNode.value
  const targetScope = scopeKey.value
  const requestId = ++writeRequestId
  const reason = await ElMessageBox.prompt('请说明回退原因，操作将形成新版本。', `回退至 v${revision.assetVersion - 1}`, { inputPattern: /\S+/, inputErrorMessage: '回退原因不能为空', confirmButtonText: '确认回退', cancelButtonText: '取消' }).catch(() => null)
  if (!reason) return
  if (!active || targetScope !== scopeKey.value || requestId !== writeRequestId) {
    if (active) ElMessage.warning('公司或地区已切换，本次回退已取消')
    return
  }
  try {
    await revertGridGeoNode(targetNode.nodeId, revision.revisionId, targetNode.version, reason.value)
    if (!active || targetScope !== scopeKey.value || requestId !== writeRequestId) return
    ElMessage.success('已生成回退版本')
    historyOpen.value = false
    detailOpen.value = false
    detailNode.value = null
    await load()
  } catch (cause) {
    if (!active || targetScope !== scopeKey.value || requestId !== writeRequestId) return
    if (cause instanceof ApiError && cause.status === 409) {
      ElMessage.warning('资产版本已变化，请查看最新历史后重新确认')
      historyOpen.value = false
      detailOpen.value = false
      detailNode.value = null
      await load()
    } else ElMessage.error(cause instanceof Error ? cause.message : '回退失败')
  }
}

const contextStamp = () => JSON.stringify([scopeKey.value, objectContext.hasContext.value, objectContext.reference.value])
let lastContextStamp = ''
onMounted(() => { lastContextStamp = contextStamp(); void load() })
function resetScope() {
  if (filterTimer) { clearTimeout(filterTimer); filterTimer = null }
  loadRequestId += 1
  detailRequestId += 1
  writeRequestId += 1
  nodes.value = []
  stationGroups.value = []
  totalStations.value = null
  listSummary.value = null
  total.value = null
  totalPages.value = 1
  page.value = 1
  editing.value = null
  editorOpen.value = false
  historyOpen.value = false
  historyNode.value = null
  history.value = []
  historyError.value = ''
  historyLoading.value = false
  detailOpen.value = false
  detailNode.value = null
  saving.value = false
  canWrite.value = false
  void load()
}
watch([scopeKey, () => objectContext.active.value, () => objectContext.hasContext.value, () => JSON.stringify(objectContext.reference.value)], () => {
  if (!objectContext.active.value) {
    loadRequestId += 1; detailRequestId += 1; writeRequestId += 1
    if (filterTimer) { clearTimeout(filterTimer); filterTimer = null }
    detailOpen.value = false; editorOpen.value = false; historyOpen.value = false; saving.value = false
    return
  }
  const nextContextStamp = contextStamp()
  if (nextContextStamp === lastContextStamp) { if (loading.value) void load(); return }
  lastContextStamp = nextContextStamp
  resetScope()
})
watch(stationMode, () => { page.value = 1; detailOpen.value = false; detailNode.value = null; void load() })
watch([keyword, kindFilter, locationFilter], () => {
  loadRequestId += 1
  nodes.value = []
  stationGroups.value = []
  totalStations.value = null
  total.value = null
  listSummary.value = null
  error.value = ''
  loading.value = true
  detailOpen.value = false
  detailNode.value = null
  page.value = 1
  if (filterTimer) clearTimeout(filterTimer)
  filterTimer = setTimeout(load, 250)
})
onUnmounted(() => { active = false; loadRequestId += 1; detailRequestId += 1; writeRequestId += 1; if (filterTimer) clearTimeout(filterTimer) })

function changePage(next: number) {
  if (loading.value || next < 1 || next > totalPages.value || next === page.value) return
  page.value = next
  void load()
}
</script>

<template>
  <section class="node-page">
    <GridOperatorProfileBanner compact @profile="operatorProfile = $event" />
    <header class="hero">
      <div><h1>{{ operatorProfile?.terminology.pricingNode ?? '节点' }}空间资产</h1><p>{{ currentRegion.shortName }} · 按站与电压查阅节点，打开详情查看关联信息或维护资料。</p></div>
      <div class="hero-actions"><button :disabled="loading" @click="load"><RefreshCw :size="15" />刷新</button><button class="primary" :disabled="!canWrite" @click="openCreate"><Plus :size="16" />新建节点</button></div>
    </header>
    <GridObjectContextBar />

    <div class="metrics" aria-label="完整筛选范围统计" :aria-busy="loading">
      <article><Waypoints :size="19" /><span><small>匹配节点</small><strong>{{ loading ? '…' : formatCount(summary.total) }}</strong></span></article>
      <article class="located"><LocateFixed :size="19" /><span><small>已定位</small><strong>{{ loading ? '…' : formatCount(summary.located) }}</strong></span></article>
      <article class="approx"><MapPinned :size="19" /><span><small>近似位置</small><strong>{{ loading ? '…' : formatCount(summary.approximate) }}</strong></span></article>
      <article class="unresolved"><Crosshair :size="19" /><span><small>未定位</small><strong>{{ loading ? '…' : formatCount(summary.unresolved) }}</strong></span></article>
    </div>
    <p class="statistics-note">完整筛选范围统计 · 位置状态仅反映定位资料，未定位不代表停运。<span v-if="!loading && !error && summary.located === null"> 位置统计暂未提供。</span></p>

    <div class="toolbar">
      <label class="search"><Search :size="16" /><input v-model="keyword" aria-label="搜索节点名称、所属站、别名或 ID" placeholder="搜索节点名称、所属站、别名或 ID" /></label>
      <select v-model="kindFilter" aria-label="节点类型"><option value="all">全部类型</option><option v-for="item in kinds" :key="item.value" :value="item.value">{{ item.label }}</option></select>
      <select v-model="locationFilter" aria-label="节点位置状态"><option value="all">全部位置状态</option><option v-for="item in locationStates" :key="item.value" :value="item.value">{{ item.label }}</option></select>
      <span v-if="listSource" class="truth" :class="{ simulated: listSource === '模拟数据' }">{{ listSource }}</span>
    </div>

    <div class="view-tools">
      <div role="group" aria-label="节点展示方式"><button :aria-pressed="layout === 'table'" @click="layout = 'table'">紧凑表格</button><button :aria-pressed="layout === 'cards'" @click="layout = 'cards'">资产卡片</button></div>
      <label v-if="layout === 'table'" class="group-switch"><input v-model="grouped" type="checkbox" />同站节点合并</label>
      <span>{{ stationMode ? '默认一站一行，点击展开节点；筛选后只汇总匹配节点。' : '所属站及标注“名称解析”的电压来自名称，仅供查阅。' }}</span>
    </div>

    <div v-if="error" class="load-error" role="alert"><strong>节点资产读取失败</strong><span>{{ error }}</span><button @click="load">重试</button></div>
    <div v-else-if="loading" class="empty" role="status">正在读取节点资产…</div>
    <div v-else-if="!hasRows" class="empty"><Crosshair :size="28" /><strong>{{ dataMissing ? '当前范围的节点资产尚未接入' : objectContext.hasContext.value ? '当前对象没有匹配的关联节点' : '没有匹配的节点资产' }}</strong><span>{{ dataMissing ? '节点资料可用后再查阅，暂不显示其他范围的数据。' : '可调整名称、类型或位置状态筛选。' }}{{ objectContext.hasContext.value ? '清除对象关联后可查看完整目录。' : '' }}</span></div>
    <GridGeoStationTable v-else-if="stationMode" :groups="stationGroups" :query="nodeQuery" :scope-key="stationScopeKey" :selected-id="detailOpen ? detailNode?.nodeId : null" @select="openDetail" />
    <GridGeoNodeTable v-else-if="layout === 'table'" :nodes="filtered" :grouped="grouped" :selected-id="detailOpen ? detailNode?.nodeId : null" @select="openDetail" />
    <div v-else class="node-grid">
      <article v-for="node in filtered" :key="node.nodeId" class="node-card" :class="node.locationStatus">
        <div class="card-glow" />
        <header><span class="node-icon"><Waypoints :size="19" /></span><div><small>{{ kindLabel(node.nodeKind) }} · {{ node.voltageLevelKv ? `${node.voltageLevelKv} kV` : '电压待补' }}</small><h3>{{ node.nodeName }}</h3></div><span class="location-badge">{{ statusLabel(node.locationStatus) }}</span></header>
        <div class="location-line"><MapPinned :size="15" /><span v-if="node.location"><strong>{{ node.location.locationLabel || '已定位' }}</strong><small>{{ node.location.longitude.toFixed(5) }}, {{ node.location.latitude.toFixed(5) }}</small></span><span v-else><strong>坐标待治理</strong><small>可先与价格、披露字段绑定</small></span></div>
        <footer><button class="primary" :aria-label="`查看${node.nodeName}详情`" @click="openDetail(node)">查看详情</button></footer>
      </article>
      <div v-if="!loading && !filtered.length" class="empty"><Crosshair :size="34" /><strong>没有匹配的节点资产</strong><span>可调整筛选，或创建一个未定位节点后逐步补录。</span></div>
    </div>
    <footer v-if="!error && total !== null" class="pager"><button :disabled="loading || page <= 1" aria-label="上一页节点" @click="changePage(page - 1)">上一页</button><span>第 {{ page }} / {{ totalPages }} 页 · <template v-if="stationMode">本页 {{ stationGroups.length }} 个站组（{{ pageNodeCount }} 个匹配节点） / 共 {{ formatCount(totalStations) }} 个站组</template><template v-else>本页 {{ filtered.length }} 条 / 共 {{ formatCount(total) }} 个节点</template></span><button :disabled="loading || page >= totalPages" aria-label="下一页节点" @click="changePage(page + 1)">下一页</button></footer>

    <GridObjectDrawer v-model="detailOpen" :object="detailObject" :date="objectContext.date.value" :from="objectContext.timeWindow.value?.from" :to="objectContext.timeWindow.value?.to">
      <template #management>
        <section v-if="detailNode" class="node-management">
          <h3>资产资料维护</h3>
          <p v-if="!canWrite">当前账号可查阅资料和历史；编辑需相应权限。</p>
          <dl><div><dt>节点 ID</dt><dd>{{ detailNode.nodeId }}</dd></div><div><dt>当前版本</dt><dd>v{{ detailNode.version }}</dd></div><div><dt>可见范围</dt><dd>{{ { company: '公司', user: '个人', public: '公共' }[detailNode.visibility] }}</dd></div><div><dt>更新日期</dt><dd>{{ formatTime(detailNode.storageMeta.updatedAt) }}</dd></div></dl>
          <div><button @click="openHistory(detailNode)"><History :size="14" />版本历史</button><button :disabled="!canWrite" class="primary" @click="openEdit(detailNode)"><Pencil :size="14" />编辑资料</button></div>
        </section>
      </template>
    </GridObjectDrawer>

    <el-drawer v-model="editorOpen" size="min(580px, 96vw)" append-to-body :with-header="false">
      <div class="editor">
        <header><div><small>{{ editing ? `MANAGED ASSET · v${editing.version}` : 'NEW SPATIAL NODE' }}</small><h2>{{ editing ? '编辑节点卡片' : '新建节点资产' }}</h2></div><button class="icon-btn" @click="editorOpen = false"><X /></button></header>
        <div class="form-grid">
          <label v-if="!editing" class="wide"><span>节点 ID</span><input v-model="form.nodeId" placeholder="yn-node-example" /></label>
          <label class="wide"><span>节点名称</span><input v-model="form.nodeName" placeholder="如：昆明.220kVⅠ母" /></label>
          <p v-if="nameHint" class="name-hint wide">
            <span>{{ nameHint.text }}</span>
            <button v-if="nameHint.canApply" type="button" @click="applyParsedVoltage">用解析值填电压</button>
          </p>
          <label class="wide"><span>别名（逗号/顿号分隔）</span><input v-model="form.aliasesText" /></label>
          <label><span>节点类型</span><select v-model="form.nodeKind"><option v-for="item in kinds" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
          <label><span>电压等级 kV</span><input v-model.number="form.voltageLevelKv" type="number" min="0" max="1000" /></label>
          <label><span>运行状态</span><input v-model="form.status" /></label>
          <label v-if="!editing"><span>可见范围</span><select v-model="form.visibility"><option value="company">公司</option><option value="user">个人</option><option value="public">公共（平台管理员）</option></select></label>
          <label class="wide"><span>定位状态</span><div class="state-switch"><button v-for="item in locationStates" :key="item.value" type="button" :class="{ active: form.locationStatus === item.value }" @click="form.locationStatus = item.value">{{ item.label }}<small>{{ item.tip }}</small></button></div></label>
        </div>
        <section v-if="form.locationStatus !== 'unresolved'" class="coordinate-panel">
          <div class="coordinate-map" @click="pickCoordinate"><div class="grid-lines" /><span v-if="form.longitude !== null && form.latitude !== null" class="picked" :style="{ left: `${((form.longitude - 73) / 63) * 100}%`, top: `${((54 - form.latitude) / 51) * 100}%` }"><LocateFixed /></span><p>点击拾取 WGS84 参考坐标</p></div>
          <div class="form-grid"><label><span>经度</span><input v-model.number="form.longitude" type="number" step="0.00001" /></label><label><span>纬度</span><input v-model.number="form.latitude" type="number" step="0.00001" /></label><label class="wide"><span>位置标签</span><input v-model="form.locationLabel" /></label><label><span>精度</span><select v-model="form.accuracyLevel"><option value="site">场址级</option><option value="township">乡镇级</option><option value="county">县域级</option><option value="approximate">近似</option></select></label><label><span>可信度</span><select v-model="form.confidence"><option value="verified">已核验</option><option value="probable">待复核</option><option value="unverified">未核验</option></select></label><label><span>不确定性（米）</span><input v-model.number="form.uncertaintyMeters" type="number" min="1" /></label><label><span>证据标题</span><input v-model="form.evidenceTitle" /></label><label class="wide"><span>证据 HTTPS URL</span><input v-model="form.evidenceUrl" placeholder="https://..." /></label></div>
        </section>
        <div class="form-grid lower"><label class="wide"><span>节点价数据族接口</span><input v-model="form.marketFamily" placeholder="yn_node_price" /></label><label class="wide"><span>数据说明</span><textarea v-model="form.note" rows="2" /></label><label class="wide required"><span>变更原因</span><textarea v-model="form.reason" rows="2" placeholder="必填，将记入审计历史" /></label></div>
        <footer><button @click="editorOpen = false">取消</button><button class="primary" :disabled="saving" @click="save">{{ saving ? '正在保存…' : '保存并生成新版本' }}</button></footer>
      </div>
    </el-drawer>

    <el-drawer v-model="historyOpen" size="min(520px, 96vw)" append-to-body :with-header="false">
      <div class="history-panel"><header><div><small>资产变更记录</small><h2>版本历史</h2><p>{{ historyNode?.nodeName }} · 当前 v{{ historyNode?.version }}</p></div><button class="icon-btn" aria-label="关闭版本历史" @click="historyOpen = false"><X /></button></header><p v-if="historyLoading" role="status">正在读取历史…</p><p v-else-if="historyError" role="alert">{{ historyError }}</p><p v-else-if="!history.length">暂无版本历史</p><div v-else class="timeline"><article v-for="revision in history" :key="revision.revisionId"><span class="dot"><Clock3 /></span><div><header><strong>v{{ revision.assetVersion }} · {{ revision.operation }}</strong><time>{{ formatTime(revision.createdAt) }}</time></header><p>{{ revision.reason || '系统建档' }}</p><small>{{ revision.actor.userId }} · {{ revision.actor.role }}</small><button v-if="revision.before && revision.operation !== 'REVERT' && canWrite" @click="revert(revision)"><RotateCcw :size="13" />回退到本次变更前</button></div></article></div></div>
    </el-drawer>
  </section>
</template>

<style scoped>
.node-page { min-height: calc(100vh - 72px); padding: 22px; color: var(--text, #172431); background: radial-gradient(circle at 85% 0, rgba(27, 180, 214, .12), transparent 30%), linear-gradient(150deg, #f5fafc, #eef5f8); }
.hero { display: flex; align-items: end; justify-content: space-between; padding: 26px 28px; border: 1px solid rgba(81, 157, 181, .18); border-radius: 20px; color: #e9fbff; background: radial-gradient(circle at 78% 8%, rgba(43, 218, 239, .2), transparent 28%), linear-gradient(135deg, #071b2c, #062436 58%, #0b3444); box-shadow: 0 20px 55px rgba(15, 53, 72, .18); }
.eyebrow,.editor header small,.history-panel header small { color: #48d7ed; font-size: var(--font-10); font-weight: 700; letter-spacing: .18em; }.hero h1 { margin: 6px 0; font-size: var(--font-27); }.hero p { max-width: 760px; margin: 0; color: #91bac8; font-size: var(--font-md); line-height: 1.7; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 13px; border: 1px solid #cadbe2; border-radius: 9px; color: #31505e; background: #fff; cursor: pointer; }button:disabled { opacity: .45; cursor: not-allowed; }.primary { color: #fff; border-color: #109bbb; background: linear-gradient(135deg, #13b9d7, #087f9e); box-shadow: 0 8px 20px rgba(16, 155, 187, .2); }.hero-actions { display: flex; gap: 9px; }
.metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 15px 0; }.metrics article { display: flex; align-items: center; gap: 13px; padding: 16px 18px; border: 1px solid #dce8ed; border-radius: 15px; color: #1a91ac; background: rgba(255,255,255,.86); box-shadow: 0 8px 24px rgba(25, 73, 91, .05); }.metrics article span { display: flex; flex-direction: column; }.metrics small { color: #7b929d; }.metrics strong { color: #153746; font-size: var(--font-22); }.metrics .located { color: #0eaf88; }.metrics .approx { color: #e69a23; }.metrics .unresolved { color: #8e78c9; }
.toolbar { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid #dce8ed; border-radius: 14px; background: rgba(255,255,255,.8); }.search { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 230px; padding: 0 10px; border: 1px solid #d3e2e8; border-radius: 9px; background: #fff; }.search input { width: 100%; border: 0; outline: 0; }.toolbar select,input,textarea,.form-grid select { padding: 9px 10px; border: 1px solid #d3e2e8; border-radius: 8px; color: #274755; background: #fff; outline: 0; }.truth { display: flex; align-items: center; gap: 5px; color: #75909b; font-size: var(--font-xs); }
.node-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(315px, 1fr)); gap: 14px; min-height: 260px; margin-top: 15px; }.node-card { position: relative; overflow: hidden; padding: 17px; border: 1px solid #d9e7ec; border-radius: 16px; background: rgba(255,255,255,.93); box-shadow: 0 12px 32px rgba(23, 64, 80, .07); transition: .2s; }.node-card:hover { transform: translateY(-3px); box-shadow: 0 18px 38px rgba(23,64,80,.12); }.card-glow { position: absolute; top: -50px; right: -35px; width: 120px; height: 120px; border-radius: 50%; background: rgba(25,187,216,.1); filter: blur(2px); }.node-card.approximate .card-glow { background: rgba(235,164,54,.12); }.node-card.unresolved .card-glow { background: rgba(133,104,200,.13); }.node-card>header { position: relative; display: flex; align-items: center; gap: 11px; }.node-icon { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 12px; color: #10a9c5; background: #e7f8fb; }.node-card header div { min-width: 0; flex: 1; }.node-card header small { color: #76909b; }.node-card h3 { overflow: hidden; margin: 3px 0 0; font-size: var(--font-15); text-overflow: ellipsis; white-space: nowrap; }.location-badge { padding: 4px 7px; border-radius: 20px; color: #098d70; background: #e7f8f2; font-size: var(--font-10); }.approximate .location-badge { color: #b77716; background: #fff5df; }.unresolved .location-badge { color: #745ab1; background: #f1ecfb; }.id { margin: 12px 0 9px; color: #8aa0a9; font: 11px ui-monospace, monospace; }.location-line { display: flex; align-items: center; gap: 9px; padding: 11px; border-radius: 10px; background: #f4f8fa; }.location-line span { display: flex; min-width: 0; flex-direction: column; }.location-line strong { font-size: var(--font-sm); }.location-line small { margin-top: 2px; color: #8498a0; }.chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 11px 0; }.chips span { padding: 4px 7px; border: 1px solid #dce8ec; border-radius: 6px; color: #67808b; font-size: var(--font-10); }.node-card footer { display: flex; justify-content: flex-end; gap: 7px; }.empty { display: flex; grid-column: 1/-1; min-height: 240px; align-items: center; justify-content: center; flex-direction: column; gap: 8px; color: #78909a; }
.editor,.history-panel { min-height: 100%; padding: 22px; color: #25404c; background: #f5f9fb; }.editor>header,.history-panel>header { display: flex; align-items: start; justify-content: space-between; padding: 20px; border-radius: 15px; color: #e6faff; background: linear-gradient(135deg, #071b2c, #0a3446); }.editor h2,.history-panel h2 { margin: 4px 0; }.icon-btn { width: 34px; height: 34px; padding: 0; color: #9bc4d1; border-color: rgba(255,255,255,.15); background: rgba(255,255,255,.06); }.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }.form-grid label { display: flex; min-width: 0; flex-direction: column; gap: 5px; }.form-grid label>span { color: #5e7782; font-size: var(--font-xs); }.form-grid input,.form-grid select,.form-grid textarea { width: 100%; box-sizing: border-box; }.wide { grid-column: 1/-1; }.required>span::after { color: #e45454; content: ' *'; }.name-hint { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: -4px 0 0; padding: 8px 10px; border: 1px dashed #bcd9e2; border-radius: 9px; color: #5e7782; background: #f0f9fc; font-size: var(--font-xs); }.name-hint button { flex: none; padding: 5px 9px; color: #087f9e; border: 1px solid #9fd6e4; border-radius: 7px; background: #fff; font-size: var(--font-xs); cursor: pointer; }.state-switch { display: grid; grid-template-columns: repeat(3,1fr); gap: 7px; }.state-switch button { align-items: start; flex-direction: column; text-align: left; }.state-switch button small { color: #8ca0a8; font-size: var(--font-9); }.state-switch .active { color: #087f9e; border-color: #21b6d3; background: #e8f9fc; }.coordinate-panel { margin-top: 15px; padding: 13px; border: 1px solid #d8e7ec; border-radius: 13px; background: #fff; }.coordinate-map { position: relative; overflow: hidden; height: 150px; border-radius: 10px; background: radial-gradient(circle at 70% 35%, rgba(53,214,213,.2), transparent 28%), linear-gradient(145deg,#09283a,#0b4052); cursor: crosshair; }.grid-lines { position: absolute; inset: 0; opacity: .24; background-image: linear-gradient(rgba(116,226,239,.4) 1px,transparent 1px),linear-gradient(90deg,rgba(116,226,239,.4) 1px,transparent 1px); background-size: 30px 30px; }.coordinate-map p { position: absolute; bottom: 8px; left: 12px; margin: 0; color: #93c5d0; font-size: var(--font-10); }.picked { position: absolute; z-index: 2; color: #49edda; transform: translate(-50%,-50%); filter: drop-shadow(0 0 7px #49edda); }.lower { padding-bottom: 90px; }.editor>footer { position: sticky; bottom: 0; display: flex; justify-content: flex-end; gap: 8px; padding: 14px 0; background: linear-gradient(transparent,#f5f9fb 22%); }
.history-panel>header p { margin: 0; color: #8cb8c5; font-size: var(--font-xs); }.timeline { padding: 20px 4px; }.timeline article { display: grid; grid-template-columns: 32px 1fr; gap: 10px; }.timeline article:not(:last-child)>div { padding-bottom: 24px; }.dot { position: relative; z-index: 1; display: grid; width: 28px; height: 28px; place-items: center; border-radius: 50%; color: #0ca2bd; background: #e2f6fa; }.dot :deep(svg) { width: 13px; }.timeline article:not(:last-child) .dot::after { position: absolute; top: 28px; bottom: -80px; left: 13px; width: 1px; content: ''; background: #d4e5ea; }.timeline article>div>header { display:flex; justify-content:space-between; }.timeline time { color:#8ba0a9;font-size: var(--font-15); }.timeline p { margin:7px 0;color:#516c77;font-size: var(--font-15); }.timeline article>div>small { color:#8da0a8; }.timeline article button { margin-top:9px;padding:6px 9px;font-size: var(--font-15); }
.pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 18px 0 4px; color: #6f8994; font-size: var(--font-xs); }
@media (max-width: 900px) { .node-page { padding: 12px; }.hero { align-items: start; flex-direction: column; gap: 16px; }.metrics { grid-template-columns: 1fr 1fr; }.toolbar { align-items: stretch; flex-direction: column; }.truth { padding: 4px; } }
@media (max-width: 560px) { .metrics { grid-template-columns: 1fr; }.form-grid { grid-template-columns: 1fr; }.wide { grid-column: auto; }.state-switch { grid-template-columns: 1fr; } }
.node-page { padding: 16px 20px; background: var(--surface-muted, #f3f6f8); }
.hero { align-items: center; padding: 14px 18px; border-radius: 12px; box-shadow: none; background: #103943; }.hero h1 { margin: 0 0 4px; font-size: var(--font-22, 22px); }.hero p { color: #c2dce1; font-size: var(--font-sm, 14px); }
.metrics { gap: 10px; margin: 12px 0 6px; }.metrics article { gap: 10px; padding: 9px 14px; border-radius: 9px; box-shadow: none; }.metrics article span { flex: 1; flex-direction: row; align-items: center; justify-content: space-between; gap: 10px; }.metrics small { color: #607681; }.metrics strong { font-size: var(--font-20, 20px); }.statistics-note { margin: 0 0 10px; color: #617984; font-size: var(--font-xs, 12px); line-height: 1.5; }
.toolbar { padding: 9px 10px; border-radius: 9px; }.view-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 12px 0; color: #627985; font-size: var(--font-xs, 12px); }.view-tools [role="group"] { display: flex; gap: 4px; }.view-tools button { padding: 6px 11px; }.view-tools button[aria-pressed="true"] { color: #087f79; border-color: #65b2a5; background: #e9f7f2; }.group-switch { display: flex; align-items: center; gap: 6px; }.group-switch input { accent-color: #087f79; }
.load-error { display: flex; min-height: 170px; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 16px; border: 1px solid #e5c9c1; border-radius: 10px; background: #fff6f2; color: #9a452b; }.empty { min-height: 170px; padding: 15px; text-align: center; }.simulated { color: #9a6617; font-weight: 600; }.pager { flex-wrap: wrap; }.node-card footer { margin-top: 12px; }
.node-management { padding: 16px; border: 1px solid #d8e4e9; border-radius: 10px; color: #294550; }.node-management h3 { margin: 0 0 12px; }.node-management p { color: #617985; font-size: var(--font-xs, 12px); }.node-management dl > div { display: grid; grid-template-columns: 90px 1fr; gap: 10px; margin: 10px 0; }.node-management dt { color: #617985; }.node-management dd { margin: 0; overflow-wrap: anywhere; }.node-management > div { display: flex; flex-wrap: wrap; gap: 8px; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #148b8c; outline-offset: 3px; }
@media (max-width: 900px) { .node-page { padding: 10px; }.hero { align-items: stretch; gap: 10px; }.hero-actions { justify-content: flex-end; }.toolbar { gap: 8px; }.metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }.metrics article { padding: 9px; }.view-tools > span { flex-basis: 100%; }.search { min-width: 0; } }
@media (max-width: 420px) { .metrics article > svg { display: none; }.metrics article span { align-items: flex-start; flex-direction: column; gap: 3px; }.hero h1 { font-size: var(--font-20, 20px); } }
</style>
