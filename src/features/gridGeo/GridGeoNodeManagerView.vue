<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ApiError } from '@/services/api'
import { selectedCompanyId } from '@/services/company/companyContext'
import { parseGridNodeName } from '@/services/gridGeo/nodeNameParser'
import { onRegionChange } from '@/composables/useRegionReload'
import { Clock3, Crosshair, Database, History, LocateFixed, MapPinned, Pencil, Plus, RefreshCw, RotateCcw, Search, Waypoints, X } from 'lucide-vue-next'
import GridOperatorProfileBanner from './GridOperatorProfileBanner.vue'
import {
  createGridGeoNode, fetchGridGeoManifest, fetchGridGeoNodeRevisions, fetchGridGeoNodes,
  revertGridGeoNode, updateGridGeoNode,
} from './client'
import type { GridGeoLocationStatus, GridGeoNode, GridGeoNodeKind, GridGeoRevision, GridGeoVisibility, GridOperatorProfile } from './types'

const loading = ref(false)
const saving = ref(false)
const nodes = shallowRef<GridGeoNode[]>([])
const canWrite = ref(false)
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
const pageSize = ref(60)
const total = ref(0)
const totalPages = ref(1)
let filterTimer: ReturnType<typeof setTimeout> | null = null
let loadRequestId = 0
let detailRequestId = 0

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
const summary = computed(() => ({
  total: total.value,
  located: filtered.value.filter((node) => node.locationStatus === 'located').length,
  approximate: filtered.value.filter((node) => node.locationStatus === 'approximate').length,
  unresolved: filtered.value.filter((node) => node.locationStatus === 'unresolved').length,
}))

function kindLabel(value: GridGeoNodeKind) { return kinds.value.find((item) => item.value === value)?.label ?? value }
function statusLabel(value: GridGeoLocationStatus) { return locationStates.find((item) => item.value === value)?.label ?? value }
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }

async function load() {
  const requestId = ++loadRequestId
  loading.value = true
  try {
    const [list, manifest] = await Promise.all([fetchGridGeoNodes({
      page: page.value, pageSize: pageSize.value,
      ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
      ...(kindFilter.value !== 'all' ? { nodeKind: kindFilter.value } : {}),
      ...(locationFilter.value !== 'all' ? { locationStatus: locationFilter.value } : {}),
    }), fetchGridGeoManifest().catch(() => null)])
    if (requestId !== loadRequestId) return
    nodes.value = list.data?.items ?? []
    total.value = list.data?.pagination?.total ?? list.total ?? 0
    totalPages.value = list.data?.pagination?.totalPages ?? 1
    canWrite.value = Boolean(manifest?.capabilities.canWrite)
  } catch (cause) {
    if (requestId !== loadRequestId) return
    ElMessage.error(cause instanceof Error ? cause.message : '节点资产加载失败')
  } finally { if (requestId === loadRequestId) loading.value = false }
}

function resetForm() {
  Object.assign(form, {
    nodeId: '', nodeName: '', aliasesText: '', nodeKind: 'pricing', voltageLevelKv: null,
    status: 'active', visibility: 'company', locationStatus: 'unresolved', longitude: null,
    latitude: null, locationLabel: '', accuracyLevel: 'approximate', confidence: 'unverified',
    uncertaintyMeters: 10000, evidenceTitle: '', evidenceUrl: '', marketFamily: '', reason: '', note: '',
  })
}

function openCreate() { editing.value = null; resetForm(); editorOpen.value = true }
function openEdit(node: GridGeoNode) {
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
  if (!form.nodeName.trim()) return ElMessage.warning('请填写节点名称')
  if (!editing.value && !/^[a-z0-9][a-z0-9-]{2,80}$/.test(form.nodeId)) return ElMessage.warning('ID 请使用 3-81 位小写字母、数字或连字符')
  if (form.locationStatus !== 'unresolved' && (!Number.isFinite(Number(form.longitude)) || !Number.isFinite(Number(form.latitude)))) return ElMessage.warning('请在空间拾取区点选坐标')
  if (!form.reason.trim()) return ElMessage.warning('请填写本次变更原因')
  saving.value = true
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
      ElMessage.success('节点资产已更新')
    } else {
      await createGridGeoNode({ nodeId: form.nodeId, ...base, location, visibility: form.visibility, reason: form.reason.trim(), evidence: location?.evidence ?? [] })
      ElMessage.success('节点资产已创建')
    }
    editorOpen.value = false
    await load()
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 409) {
      ElMessage.warning('资产版本已变化，已刷新最新数据，请重新确认后保存')
      editorOpen.value = false
      await load()
    } else ElMessage.error(cause instanceof Error ? cause.message : '保存失败')
  } finally { saving.value = false }
}

async function openHistory(node: GridGeoNode) {
  const requestId = ++detailRequestId
  historyNode.value = node; historyOpen.value = true; history.value = []
  try {
    const rows = (await fetchGridGeoNodeRevisions(node.nodeId)).rows
    if (requestId === detailRequestId) history.value = rows
  }
  catch (cause) { ElMessage.error(cause instanceof Error ? cause.message : '历史加载失败') }
}

async function revert(revision: GridGeoRevision<GridGeoNode>) {
  if (!historyNode.value || !revision.before) return
  const targetNode = historyNode.value
  const targetCompanyId = selectedCompanyId.value
  const reason = await ElMessageBox.prompt('请说明回退原因，操作将形成新版本。', `回退至 v${revision.assetVersion - 1}`, { inputPattern: /\S+/, inputErrorMessage: '回退原因不能为空', confirmButtonText: '确认回退', cancelButtonText: '取消' }).catch(() => null)
  if (!reason) return
  if (targetCompanyId !== selectedCompanyId.value) {
    ElMessage.warning('公司作用域已切换，本次回退已取消')
    return
  }
  try {
    await revertGridGeoNode(targetNode.nodeId, revision.revisionId, targetNode.version, reason.value)
    ElMessage.success('已生成回退版本')
    historyOpen.value = false
    await load()
  } catch (cause) { ElMessage.error(cause instanceof Error ? cause.message : '回退失败') }
}

onMounted(load)
onRegionChange(() => {
  loadRequestId += 1
  detailRequestId += 1
  nodes.value = []
  total.value = 0
  page.value = 1
  editing.value = null
  editorOpen.value = false
  historyOpen.value = false
  historyNode.value = null
  history.value = []
  return load()
})
watch(selectedCompanyId, () => {
  loadRequestId += 1
  detailRequestId += 1
  nodes.value = []
  total.value = 0
  page.value = 1
  editing.value = null
  editorOpen.value = false
  historyOpen.value = false
  historyNode.value = null
  history.value = []
  canWrite.value = false
  void load()
})
watch([keyword, kindFilter, locationFilter], () => {
  page.value = 1
  if (filterTimer) clearTimeout(filterTimer)
  filterTimer = setTimeout(load, 250)
})
onUnmounted(() => { if (filterTimer) clearTimeout(filterTimer) })

function changePage(next: number) {
  if (next < 1 || next > totalPages.value || next === page.value) return
  page.value = next
  void load()
}
</script>

<template>
  <section class="node-page">
    <GridOperatorProfileBanner compact @profile="operatorProfile = $event" />
    <header class="hero">
      <div><span class="eyebrow">GRID SPATIAL ASSET REGISTRY</span><h1>{{ operatorProfile?.terminology.pricingNode ?? '节点' }}空间资产台</h1><p>管理{{ operatorProfile?.terminology.pricingNode ?? '定价节点' }}、母线与变电站的物理位置；未定位资产保留身份，不以伪造坐标补位。</p></div>
      <div class="hero-actions"><button @click="load"><RefreshCw :size="15" />刷新</button><button class="primary" :disabled="!canWrite" @click="openCreate"><Plus :size="16" />新建节点</button></div>
    </header>

    <div class="metrics">
      <article><Waypoints /><span><small>可见节点</small><strong>{{ summary.total }}</strong></span></article>
      <article class="located"><LocateFixed /><span><small>本页已定位</small><strong>{{ summary.located }}</strong></span></article>
      <article class="approx"><MapPinned /><span><small>本页近似位置</small><strong>{{ summary.approximate }}</strong></span></article>
      <article class="unresolved"><Crosshair /><span><small>本页待补录</small><strong>{{ summary.unresolved }}</strong></span></article>
    </div>

    <div class="toolbar">
      <label class="search"><Search :size="16" /><input v-model="keyword" placeholder="搜索节点名称、别名或 ID" /></label>
      <select v-model="kindFilter"><option value="all">全部类型</option><option v-for="item in kinds" :key="item.value" :value="item.value">{{ item.label }}</option></select>
      <select v-model="locationFilter"><option value="all">全部位置状态</option><option v-for="item in locationStates" :key="item.value" :value="item.value">{{ item.label }}</option></select>
      <span class="truth"><Database :size="14" />DB 版本化资产 · 非模拟数据</span>
    </div>

    <div v-loading="loading" class="node-grid">
      <article v-for="node in filtered" :key="node.nodeId" class="node-card" :class="node.locationStatus">
        <div class="card-glow" />
        <header><span class="node-icon"><Waypoints :size="19" /></span><div><small>{{ kindLabel(node.nodeKind) }} · {{ node.voltageLevelKv ? `${node.voltageLevelKv} kV` : '电压待补' }}</small><h3>{{ node.nodeName }}</h3></div><span class="location-badge">{{ statusLabel(node.locationStatus) }}</span></header>
        <p class="id">{{ node.nodeId }}</p>
        <div class="location-line"><MapPinned :size="15" /><span v-if="node.location"><strong>{{ node.location.locationLabel || '已定位' }}</strong><small>{{ node.location.longitude.toFixed(5) }}, {{ node.location.latitude.toFixed(5) }}</small></span><span v-else><strong>坐标待治理</strong><small>可先与价格、披露字段绑定</small></span></div>
        <div class="chips"><span>{{ node.gridOperator.toUpperCase() }}</span><span>v{{ node.version }}</span><span v-if="node.overrideState.hasOverrides">已修订 {{ node.overrideState.count }}</span><span>{{ node.visibility }}</span></div>
        <footer><button @click="openHistory(node)"><History :size="14" />历史</button><button :disabled="!canWrite" class="primary" @click="openEdit(node)"><Pencil :size="14" />编辑卡片</button></footer>
      </article>
      <div v-if="!loading && !filtered.length" class="empty"><Crosshair :size="34" /><strong>没有匹配的节点资产</strong><span>可调整筛选，或创建一个未定位节点后逐步补录。</span></div>
    </div>
    <footer v-if="totalPages > 1" class="pager"><button :disabled="page <= 1" @click="changePage(page - 1)">上一页</button><span>第 {{ page }} / {{ totalPages }} 页 · {{ total.toLocaleString('zh-CN') }} 个节点</span><button :disabled="page >= totalPages" @click="changePage(page + 1)">下一页</button></footer>

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
      <div class="history-panel"><header><div><small>IMMUTABLE AUDIT TRAIL</small><h2>版本历史</h2><p>{{ historyNode?.nodeName }} · 当前 v{{ historyNode?.version }}</p></div><button class="icon-btn" @click="historyOpen = false"><X /></button></header><div class="timeline"><article v-for="revision in history" :key="revision.revisionId"><span class="dot"><Clock3 /></span><div><header><strong>v{{ revision.assetVersion }} · {{ revision.operation }}</strong><time>{{ formatTime(revision.createdAt) }}</time></header><p>{{ revision.reason || '系统建档' }}</p><small>{{ revision.actor.userId }} · {{ revision.actor.role }}</small><button v-if="revision.before && revision.operation !== 'REVERT' && canWrite" @click="revert(revision)"><RotateCcw :size="13" />回退到本次变更前</button></div></article></div></div>
    </el-drawer>
  </section>
</template>

<style scoped>
.node-page { min-height: calc(100vh - 72px); padding: 22px; color: var(--text, #172431); background: radial-gradient(circle at 85% 0, rgba(27, 180, 214, .12), transparent 30%), linear-gradient(150deg, #f5fafc, #eef5f8); }
.hero { display: flex; align-items: end; justify-content: space-between; padding: 26px 28px; border: 1px solid rgba(81, 157, 181, .18); border-radius: 20px; color: #e9fbff; background: radial-gradient(circle at 78% 8%, rgba(43, 218, 239, .2), transparent 28%), linear-gradient(135deg, #071b2c, #062436 58%, #0b3444); box-shadow: 0 20px 55px rgba(15, 53, 72, .18); }
.eyebrow,.editor header small,.history-panel header small { color: #48d7ed; font-size: 10px; font-weight: 700; letter-spacing: .18em; }.hero h1 { margin: 6px 0; font-size: 27px; }.hero p { max-width: 760px; margin: 0; color: #91bac8; font-size: 13px; line-height: 1.7; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 13px; border: 1px solid #cadbe2; border-radius: 9px; color: #31505e; background: #fff; cursor: pointer; }button:disabled { opacity: .45; cursor: not-allowed; }.primary { color: #fff; border-color: #109bbb; background: linear-gradient(135deg, #13b9d7, #087f9e); box-shadow: 0 8px 20px rgba(16, 155, 187, .2); }.hero-actions { display: flex; gap: 9px; }
.metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 15px 0; }.metrics article { display: flex; align-items: center; gap: 13px; padding: 16px 18px; border: 1px solid #dce8ed; border-radius: 15px; color: #1a91ac; background: rgba(255,255,255,.86); box-shadow: 0 8px 24px rgba(25, 73, 91, .05); }.metrics article span { display: flex; flex-direction: column; }.metrics small { color: #7b929d; }.metrics strong { color: #153746; font-size: 22px; }.metrics .located { color: #0eaf88; }.metrics .approx { color: #e69a23; }.metrics .unresolved { color: #8e78c9; }
.toolbar { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid #dce8ed; border-radius: 14px; background: rgba(255,255,255,.8); }.search { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 230px; padding: 0 10px; border: 1px solid #d3e2e8; border-radius: 9px; background: #fff; }.search input { width: 100%; border: 0; outline: 0; }.toolbar select,input,textarea,.form-grid select { padding: 9px 10px; border: 1px solid #d3e2e8; border-radius: 8px; color: #274755; background: #fff; outline: 0; }.truth { display: flex; align-items: center; gap: 5px; color: #75909b; font-size: 11px; }
.node-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(315px, 1fr)); gap: 14px; min-height: 260px; margin-top: 15px; }.node-card { position: relative; overflow: hidden; padding: 17px; border: 1px solid #d9e7ec; border-radius: 16px; background: rgba(255,255,255,.93); box-shadow: 0 12px 32px rgba(23, 64, 80, .07); transition: .2s; }.node-card:hover { transform: translateY(-3px); box-shadow: 0 18px 38px rgba(23,64,80,.12); }.card-glow { position: absolute; top: -50px; right: -35px; width: 120px; height: 120px; border-radius: 50%; background: rgba(25,187,216,.1); filter: blur(2px); }.node-card.approximate .card-glow { background: rgba(235,164,54,.12); }.node-card.unresolved .card-glow { background: rgba(133,104,200,.13); }.node-card>header { position: relative; display: flex; align-items: center; gap: 11px; }.node-icon { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 12px; color: #10a9c5; background: #e7f8fb; }.node-card header div { min-width: 0; flex: 1; }.node-card header small { color: #76909b; }.node-card h3 { overflow: hidden; margin: 3px 0 0; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }.location-badge { padding: 4px 7px; border-radius: 20px; color: #098d70; background: #e7f8f2; font-size: 10px; }.approximate .location-badge { color: #b77716; background: #fff5df; }.unresolved .location-badge { color: #745ab1; background: #f1ecfb; }.id { margin: 12px 0 9px; color: #8aa0a9; font: 11px ui-monospace, monospace; }.location-line { display: flex; align-items: center; gap: 9px; padding: 11px; border-radius: 10px; background: #f4f8fa; }.location-line span { display: flex; min-width: 0; flex-direction: column; }.location-line strong { font-size: 12px; }.location-line small { margin-top: 2px; color: #8498a0; }.chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 11px 0; }.chips span { padding: 4px 7px; border: 1px solid #dce8ec; border-radius: 6px; color: #67808b; font-size: 10px; }.node-card footer { display: flex; justify-content: flex-end; gap: 7px; }.empty { display: flex; grid-column: 1/-1; min-height: 240px; align-items: center; justify-content: center; flex-direction: column; gap: 8px; color: #78909a; }
.editor,.history-panel { min-height: 100%; padding: 22px; color: #25404c; background: #f5f9fb; }.editor>header,.history-panel>header { display: flex; align-items: start; justify-content: space-between; padding: 20px; border-radius: 15px; color: #e6faff; background: linear-gradient(135deg, #071b2c, #0a3446); }.editor h2,.history-panel h2 { margin: 4px 0; }.icon-btn { width: 34px; height: 34px; padding: 0; color: #9bc4d1; border-color: rgba(255,255,255,.15); background: rgba(255,255,255,.06); }.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }.form-grid label { display: flex; min-width: 0; flex-direction: column; gap: 5px; }.form-grid label>span { color: #5e7782; font-size: 11px; }.form-grid input,.form-grid select,.form-grid textarea { width: 100%; box-sizing: border-box; }.wide { grid-column: 1/-1; }.required>span::after { color: #e45454; content: ' *'; }.name-hint { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: -4px 0 0; padding: 8px 10px; border: 1px dashed #bcd9e2; border-radius: 9px; color: #5e7782; background: #f0f9fc; font-size: 11px; }.name-hint button { flex: none; padding: 5px 9px; color: #087f9e; border: 1px solid #9fd6e4; border-radius: 7px; background: #fff; font-size: 11px; cursor: pointer; }.state-switch { display: grid; grid-template-columns: repeat(3,1fr); gap: 7px; }.state-switch button { align-items: start; flex-direction: column; text-align: left; }.state-switch button small { color: #8ca0a8; font-size: 9px; }.state-switch .active { color: #087f9e; border-color: #21b6d3; background: #e8f9fc; }.coordinate-panel { margin-top: 15px; padding: 13px; border: 1px solid #d8e7ec; border-radius: 13px; background: #fff; }.coordinate-map { position: relative; overflow: hidden; height: 150px; border-radius: 10px; background: radial-gradient(circle at 70% 35%, rgba(53,214,213,.2), transparent 28%), linear-gradient(145deg,#09283a,#0b4052); cursor: crosshair; }.grid-lines { position: absolute; inset: 0; opacity: .24; background-image: linear-gradient(rgba(116,226,239,.4) 1px,transparent 1px),linear-gradient(90deg,rgba(116,226,239,.4) 1px,transparent 1px); background-size: 30px 30px; }.coordinate-map p { position: absolute; bottom: 8px; left: 12px; margin: 0; color: #93c5d0; font-size: 10px; }.picked { position: absolute; z-index: 2; color: #49edda; transform: translate(-50%,-50%); filter: drop-shadow(0 0 7px #49edda); }.lower { padding-bottom: 90px; }.editor>footer { position: sticky; bottom: 0; display: flex; justify-content: flex-end; gap: 8px; padding: 14px 0; background: linear-gradient(transparent,#f5f9fb 22%); }
.history-panel>header p { margin: 0; color: #8cb8c5; font-size: 11px; }.timeline { padding: 20px 4px; }.timeline article { display: grid; grid-template-columns: 32px 1fr; gap: 10px; }.timeline article:not(:last-child)>div { padding-bottom: 24px; }.dot { position: relative; z-index: 1; display: grid; width: 28px; height: 28px; place-items: center; border-radius: 50%; color: #0ca2bd; background: #e2f6fa; }.dot :deep(svg) { width: 13px; }.timeline article:not(:last-child) .dot::after { position: absolute; top: 28px; bottom: -80px; left: 13px; width: 1px; content: ''; background: #d4e5ea; }.timeline article>div>header { display:flex; justify-content:space-between; }.timeline time { color:#8ba0a9;font-size:15px; }.timeline p { margin:7px 0;color:#516c77;font-size:15px; }.timeline article>div>small { color:#8da0a8; }.timeline article button { margin-top:9px;padding:6px 9px;font-size:15px; }
.pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 18px 0 4px; color: #6f8994; font-size: 11px; }
@media (max-width: 900px) { .node-page { padding: 12px; }.hero { align-items: start; flex-direction: column; gap: 16px; }.metrics { grid-template-columns: 1fr 1fr; }.toolbar { align-items: stretch; flex-direction: column; }.truth { padding: 4px; } }
@media (max-width: 560px) { .metrics { grid-template-columns: 1fr; }.form-grid { grid-template-columns: 1fr; }.wide { grid-column: auto; }.state-switch { grid-template-columns: 1fr; } }
</style>
