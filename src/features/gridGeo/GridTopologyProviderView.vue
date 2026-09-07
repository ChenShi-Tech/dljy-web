<script setup lang="ts">
import { computed, inject, onMounted, ref, shallowRef, watch } from 'vue'
import { routerKey } from 'vue-router'
import {
  Activity,
  ArrowRight,
  Building2,
  CheckCircle2,
  CircleDotDashed,
  Database,
  GitBranch,
  Layers3,
  Lock,
  MapPinned,
  Network,
  RefreshCw,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Waypoints,
} from 'lucide-vue-next'
import { getCurrentUser } from '@/services/auth'
import { ApiError } from '@/services/api'
import { currentCompany, selectedCompanyId } from '@/services/company/companyContext'
import { isAdminLevelRole } from '@/services/governance'
import { onRegionChange } from '@/composables/useRegionReload'
import CesiumPlantMap from './CesiumPlantMap.vue'
import TerrainControlPanel from './TerrainControlPanel.vue'
import { useGridGeoViewPreference } from './useViewPreference'
import GridOperatorProfileBanner from './GridOperatorProfileBanner.vue'
import { fetchGridGeoPlants, fetchGridTopologyEvidence, fetchGridTopologyManifest } from './client'
import type { GridTopologyEvidenceResult } from './topology/gridEvidence'
import {
  evidenceReasonLabel,
  evidenceToTopologyFeatures,
  findEvidenceFeature,
  preferredEvidenceSourceId,
} from './topology/gridEvidenceVisual'
import type {
  GridGeoPlant,
  GridGeoSelection,
  GridGeoRuntimeStatus,
  GridGeoTerrainStatus,
  GridGeoViewMode,
  GridOperatorProfile,
  GridTopologyManifest,
  GridTopologyReadinessItem,
} from './types'

type MapExpose = { flyTerrainTour?: () => void }
const mapRef = ref<MapExpose | null>(null)

const loading = ref(true)
const error = ref('')
const plants = shallowRef<GridGeoPlant[]>([])
const topology = ref<GridTopologyManifest | null>(null)
const topologySourceType = ref<'CONFIG' | 'DB' | 'IMPORT'>('CONFIG')
const evidenceSources = shallowRef<GridTopologyEvidenceResult[]>([])
const selectedEvidenceSourceId = ref<string | null>(null)
const selectedTopologyFeatureId = ref<string | null>(null)
const accessDenied = ref(false)
const operatorProfile = ref<GridOperatorProfile | null>(null)
const selectedPlantId = ref<string | null>(null)
const { viewMode, terrainProvider, hillshadeEnabled, verticalExaggeration } =
  useGridGeoViewPreference('topology', { verticalExaggeration: 1.25 })
const terrainStatus = ref<GridGeoTerrainStatus>({ kind: terrainProvider.value, status: 'loading', label: '正在加载高程地形' })
// 晕渲图层与 ArcGIS 影像同域，该域对部分出口 IP 整体 403；失败必须让面板可见。
const hillshadeAvailable = ref<boolean | null>(null)
const runtimeStatus = ref<GridGeoRuntimeStatus | null>(null)
let loadRequestId = 0
const appRouter = inject(routerKey, null)

const currentUser = getCurrentUser()
const canConfigure = computed(() => isAdminLevelRole(currentUser.roleCode) && topology.value?.provider.configurationVisible === true)
const hasWorkbenchRouter = computed(() => Boolean(appRouter))
const selectedPlant = computed(() => plants.value.find((plant) => plant.plantId === selectedPlantId.value) ?? null)
const selectedEvidenceResult = computed(() => (
  evidenceSources.value.find((item) => item.sourceId === selectedEvidenceSourceId.value) ?? null
))
const evidenceFeatures = computed(() => evidenceToTopologyFeatures(selectedEvidenceResult.value, {
  // manifest 降级为 null 时改用 evidence 自带作用域（#1348）：
  // 否则空字符串作用域会让已成功返回的公开证据层因 scope 不完整而无法绘制。
  regionId: topology.value?.regionId ?? selectedEvidenceResult.value?.regionId ?? '',
  gridOperator: topology.value?.gridOperator ?? selectedEvidenceResult.value?.gridOperator ?? '',
  ownerCompanyId: selectedCompanyId.value,
}))
const selectedEvidenceFeature = computed(() => (
  findEvidenceFeature(selectedEvidenceResult.value, selectedTopologyFeatureId.value)
))
const evidenceAvailable = computed(() => (
  selectedEvidenceResult.value?.availability === 'available' && evidenceFeatures.value.length > 0
))
const readiness = computed<GridTopologyReadinessItem[]>(() => topology.value?.readiness ?? [])
const readyCount = computed(() => readiness.value.filter((item) => item.status === 'ready').length)
const totalFeatures = computed(() => {
  const counts = topology.value?.featureCounts ?? {}
  if (Number.isFinite(Number(counts.total))) return Number(counts.total)
  return Object.entries(counts).filter(([key]) => key !== 'total').reduce((sum, [, count]) => sum + Number(count || 0), 0)
})
const profileStyle = computed(() => operatorProfile.value ? {
  '--topology-accent': operatorProfile.value.visual.accent,
  '--topology-secondary': operatorProfile.value.visual.secondary,
  '--topology-surface': operatorProfile.value.visual.surface,
} : {})
const mapLabel = computed(() => {
  const region = operatorProfile.value?.region.label ?? topology.value?.regionId ?? '当前地区'
  if (evidenceAvailable.value) {
    return `${region}授权网架证据地图；当前绘制 ${evidenceFeatures.value.length} 个 ODbL 点线要素，未定位项不补画`
  }
  return `${region}授权网架证据地图；当前来源 unavailable，未绘制任何猜测拓扑`
})
const availabilityReason = computed(() => {
  if (loading.value) return '正在读取当前用户、公司与地区范围内的授权证据…'
  if (accessDenied.value) return '当前会话或 DataScope 无权读取授权拓扑契约；系统未请求任何敏感 snapshot。'
  if (error.value) return error.value
  if (selectedEvidenceResult.value) return evidenceReasonLabel(selectedEvidenceResult.value)
  return topology.value?.dataAvailability.reason ?? '当前范围尚未返回拓扑 Provider 状态。'
})
const providerStatusLabel = computed(() => {
  if (accessDenied.value) return '无查看权限'
  if (selectedEvidenceResult.value?.status === 'revoked') return '版本已撤销'
  if (selectedEvidenceResult.value?.status === 'blocked') return '来源未授权'
  if (evidenceAvailable.value) return '授权证据可用'
  const status = topology.value?.dataAvailability.status
  if (status === 'available') return '已接入'
  if (status === 'degraded') return '降级可用'
  if (status === 'missing') return '当前范围缺少数据'
  if (status === 'unauthorized') return '无查看权限'
  if (status === 'error') return 'Provider 异常'
  return '未配置'
})
const stageStatus = computed(() => {
  if (loading.value) return 'loading'
  if (accessDenied.value) return 'unauthorized'
  if (error.value) return 'error'
  if (evidenceAvailable.value) return 'available'
  return topology.value?.dataAvailability.status ?? 'not-configured'
})
const dockHeadline = computed(() => {
  if (accessDenied.value) return '授权拓扑受控 · 当前作用域不可见'
  if (evidenceAvailable.value) return 'ODbL 授权点线已加载 · 零推测连接'
  if (selectedEvidenceResult.value) return '当前证据来源 unavailable · 可见性归零'
  return topology.value?.dataAvailability.status === 'available'
    ? '权威拓扑 Provider 已就绪 · 当前仍零推测连线'
    : '授权拓扑未加载 · 零推测连线'
})

const modeOptions: Array<{ value: GridGeoViewMode; label: string }> = [
  { value: '2d', label: '2D' },
  { value: '2.5d', label: '2.5D' },
  { value: '3d', label: '3D' },
]

function readinessIcon(id: string) {
  const normalized = id.toLowerCase()
  if (normalized.includes('station')) return Building2
  if (normalized.includes('bus') || normalized.includes('node')) return Waypoints
  if (normalized.includes('section')) return Layers3
  if (normalized.includes('intertie') || normalized.includes('corridor')) return Route
  if (normalized.includes('line') || normalized.includes('edge')) return GitBranch
  if (normalized.includes('coordinate') || normalized.includes('geometry')) return MapPinned
  return Database
}

function onMapSelect(selection: GridGeoSelection | null) {
  selectedPlantId.value = selection?.plantId ?? null
  if (selection) selectedTopologyFeatureId.value = null
}

function onTopologySelect(selection: { featureId: string } | null) {
  selectedTopologyFeatureId.value = selection?.featureId ?? null
  if (selection) selectedPlantId.value = null
}

function navigateTo(path: string) {
  if (appRouter) {
    void appRouter.push(path)
    return
  }
  window.location.assign(path)
}

async function load() {
  const requestId = ++loadRequestId
  loading.value = true
  error.value = ''
  accessDenied.value = false
  topology.value = null
  topologySourceType.value = 'CONFIG'
  evidenceSources.value = []
  plants.value = []
  selectedPlantId.value = null
  selectedTopologyFeatureId.value = null
  try {
    // 公开证据层与私有 Provider 并行、互不拖垮（#1348 两方向）：
    // manifest 与 evidence 各自 .catch 独立降级，503/瞬断只清空自己那层；
    // 401/403 必须继续抛出进外层 catch 走 accessDenied 受控空态，不得吞成「未配置」。
    const degradeNonAuth = (cause: unknown) => {
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) throw cause
      return null
    }
    const [manifestResponse, evidenceResponse, plantResponse] = await Promise.all([
      fetchGridTopologyManifest().catch(degradeNonAuth),
      fetchGridTopologyEvidence().catch(degradeNonAuth),
      fetchGridGeoPlants().catch(() => null),
    ])
    if (requestId !== loadRequestId) return
    topology.value = manifestResponse?.data ?? null
    topologySourceType.value = manifestResponse?.sourceType ?? 'CONFIG'
    evidenceSources.value = evidenceResponse?.data?.items ?? []
    selectedEvidenceSourceId.value = preferredEvidenceSourceId(
      evidenceSources.value,
      selectedEvidenceSourceId.value,
    )
    plants.value = plantResponse?.data?.items ?? []
  } catch (cause) {
    if (requestId !== loadRequestId) return
    topology.value = null
    evidenceSources.value = []
    plants.value = []
    accessDenied.value = cause instanceof ApiError && (cause.status === 401 || cause.status === 403)
    error.value = accessDenied.value ? '' : cause instanceof Error ? cause.message : '拓扑 Provider 状态暂不可用，请稍后重试。'
  } finally {
    if (requestId === loadRequestId) loading.value = false
  }
}

onMounted(load)
onRegionChange(() => load())
watch(selectedCompanyId, () => { void load() })
watch(selectedEvidenceSourceId, () => {
  selectedTopologyFeatureId.value = null
})
</script>

<template>
  <section class="topology-page" :style="profileStyle">
    <GridOperatorProfileBanner compact @profile="operatorProfile = $event" />

    <header class="topology-header">
      <div class="topology-title">
        <span class="title-mark"><Network :size="23" aria-hidden="true" /></span>
        <div>
          <span class="eyebrow">CONTROLLED TOPOLOGY PROVIDER</span>
          <h1>授权网架接入舱</h1>
          <p>只消费证据闸门输出的稳定 ID、版本与 WGS84 几何；未授权、撤销或未定位一律不补画。</p>
        </div>
      </div>
      <button class="refresh-button" type="button" :disabled="loading" aria-label="刷新拓扑 Provider 状态" @click="load">
        <RefreshCw :size="15" :class="{ spinning: loading }" aria-hidden="true" />
        {{ loading ? '读取中…' : '刷新状态' }}
      </button>
    </header>

    <div class="topology-stage" :aria-busy="loading">
      <CesiumPlantMap
        ref="mapRef"
        :plants="plants"
        :view-mode="viewMode"
        :selected-plant-id="selectedPlantId"
        :terrain-provider="terrainProvider"
        :vertical-exaggeration="verticalExaggeration"
        :hillshade-enabled="hillshadeEnabled"
        weather-layer="none"
        :weather-items="[]"
        :default-camera="operatorProfile?.defaultCamera"
        :topology-features="evidenceFeatures"
        :selected-topology-feature-id="selectedTopologyFeatureId"
        :show-topology="evidenceAvailable"
        :topology-grid-operator="topology?.gridOperator"
        :aria-label="mapLabel"
        aria-describedby="topology-map-description"
        @select="onMapSelect"
        @topology-select="onTopologySelect"
        @terrain="terrainStatus = $event"
        @hillshade="hillshadeAvailable = $event.available"
        @runtime="runtimeStatus = $event"
      />
      <TerrainControlPanel
        v-model:provider="terrainProvider"
        v-model:hillshade="hillshadeEnabled"
        v-model:exaggeration="verticalExaggeration"
        class="terrain-dock"
        :status="terrainStatus"
        :view-mode="viewMode"
        :hillshade-available="hillshadeAvailable"
        @request-3d="viewMode = '3d'"
        @request-terrain-tour="mapRef?.flyTerrainTour?.()"
      />
      <div class="stage-vignette" aria-hidden="true" />
      <div class="stage-grid" aria-hidden="true" />
      <p id="topology-map-description" class="visually-hidden">地图只绘制授权证据契约返回的变电站点与线路几何。母线、断面、联络线、未定位要素和潮流方向均不绘制，也不按相邻位置推断连接。</p>

      <div class="stage-content">
        <div class="stage-topbar">
          <div class="view-switcher" role="group" aria-label="地图视图模式">
            <button
              v-for="option in modeOptions"
              :key="option.value"
              type="button"
              :aria-pressed="viewMode === option.value"
              :class="{ active: viewMode === option.value }"
              @click="viewMode = option.value"
            >{{ option.label }}</button>
          </div>
          <div class="runtime-pills" aria-live="polite">
            <span :class="terrainStatus.status"><MapPinned :size="13" aria-hidden="true" />{{ terrainStatus.status === 'ready' ? '真实地形' : terrainStatus.status === 'loading' ? '地形加载中' : '地形已降级' }}</span>
            <span><Database :size="13" aria-hidden="true" />{{ evidenceFeatures.length }} 个授权点线要素</span>
            <span v-if="runtimeStatus"><Activity :size="13" aria-hidden="true" />{{ runtimeStatus.network === 'weak' ? '弱网 LOD' : '标准 LOD' }}</span>
          </div>
        </div>

        <article class="provider-dock" :class="[stageStatus, { 'evidence-layer': selectedEvidenceResult }]" aria-labelledby="topology-provider-title">
          <div class="dock-orbit" aria-hidden="true"><i /><i /><i /></div>
          <span class="status-glyph">
            <Network v-if="evidenceAvailable" :size="28" aria-hidden="true" />
            <Lock v-else :size="28" aria-hidden="true" />
          </span>
          <div class="status-line" role="status" aria-live="polite"><CircleDotDashed :size="13" aria-hidden="true" />{{ providerStatusLabel }}</div>
          <h2 id="topology-provider-title">{{ dockHeadline }}</h2>
          <p>{{ availabilityReason }}</p>

          <label v-if="evidenceSources.length" class="version-picker">
            <span>证据版本 / 回滚演示</span>
            <select v-model="selectedEvidenceSourceId" aria-label="切换授权网架证据版本">
              <option v-for="item in evidenceSources" :key="item.sourceId ?? item.reason" :value="item.sourceId">
                {{ item.sourceRef ?? item.sourceId ?? '无效登记项' }} · {{ item.status ?? 'invalid' }}
              </option>
            </select>
          </label>

          <div class="contract-chips">
            <span><ShieldCheck :size="13" aria-hidden="true" />{{ selectedEvidenceResult?.status === 'authorized' ? `public / ${selectedEvidenceResult.license ?? 'licensed'}` : selectedEvidenceResult?.status === 'revoked' ? 'revoked / 零可见' : selectedEvidenceResult?.status === 'blocked' ? 'restricted / blocked' : topology?.classification ?? '受控数据' }}</span>
            <span><Database :size="13" aria-hidden="true" />{{ selectedEvidenceResult ? 'EVIDENCE' : topologySourceType }} · mock=false</span>
            <span><MapPinned :size="13" aria-hidden="true" />{{ selectedEvidenceResult?.crs ?? topology?.crs ?? 'WGS84' }}</span>
            <span><Network :size="13" aria-hidden="true" />physics=false</span>
          </div>

          <dl v-if="selectedEvidenceResult" class="provider-facts">
            <div><dt>sourceRef</dt><dd>{{ selectedEvidenceResult.sourceRef ?? selectedEvidenceResult.sourceId ?? '无版本' }}</dd></div>
            <div><dt>asOf / 状态</dt><dd>{{ selectedEvidenceResult.asOf ?? '—' }} · {{ selectedEvidenceResult.status ?? 'invalid' }}</dd></div>
            <div><dt>地区 / 电网</dt><dd>{{ selectedEvidenceResult.regionId ?? '—' }} · {{ selectedEvidenceResult.gridOperator?.toUpperCase() ?? '—' }}</dd></div>
            <div><dt>已定位 / 未定位</dt><dd>{{ evidenceFeatures.length }} / {{ selectedEvidenceResult.unresolvedFeatureIds.length }}</dd></div>
          </dl>
          <dl v-else class="provider-facts">
            <div><dt>Provider</dt><dd>{{ topology?.provider.label ?? '等待 Provider 契约' }}</dd></div>
            <div><dt>地区 / 电网</dt><dd>{{ operatorProfile?.region.label ?? topology?.regionId ?? '—' }} · {{ topology?.gridOperator?.toUpperCase() ?? operatorProfile?.visual.glyph ?? '—' }}</dd></div>
            <div><dt>公司数据域</dt><dd>{{ currentCompany.name || topology?.ownerCompanyId || '未选择公司' }}</dd></div>
            <div><dt>拓扑版本</dt><dd>{{ topology?.topologyVersion ?? '未发布' }}</dd></div>
          </dl>

          <div v-if="selectedEvidenceResult" class="evidence-audit">
            <p>
              <strong>许可</strong>
              <a v-if="selectedEvidenceResult.licenseUrl" :href="selectedEvidenceResult.licenseUrl" target="_blank" rel="noopener noreferrer">
                {{ selectedEvidenceResult.license ?? '许可详情' }}
              </a>
              <span v-else>{{ selectedEvidenceResult.license ?? '当前状态不下发许可' }}</span>
            </p>
            <p class="attribution"><strong>署名</strong><span>{{ selectedEvidenceResult.attribution ?? '当前无可绘制数据，未携带署名' }}</span></p>
            <details>
              <summary>未定位清单（{{ selectedEvidenceResult.unresolvedFeatureIds.length }}）</summary>
              <p v-if="!selectedEvidenceResult.unresolvedFeatureIds.length">当前版本无未定位要素。</p>
              <ul v-else>
                <li v-for="id in selectedEvidenceResult.unresolvedFeatureIds" :key="id">{{ id }}</li>
              </ul>
            </details>
          </div>

          <div v-else class="dock-actions">
            <button v-if="canConfigure && hasWorkbenchRouter" class="primary-action" type="button" @click="navigateTo('/data-source-settings?section=grid-topology')">
              <SlidersHorizontal :size="15" aria-hidden="true" />配置拓扑 Provider<ArrowRight :size="13" aria-hidden="true" />
            </button>
            <button v-else-if="hasWorkbenchRouter" class="primary-action readonly-action" type="button" @click="navigateTo('/grid-assets/operator-profile')">
              <ShieldCheck :size="15" aria-hidden="true" />查看接入规范<ArrowRight :size="13" aria-hidden="true" />
            </button>
            <button v-else class="primary-action readonly-action" type="button" disabled>
              <ShieldCheck :size="15" aria-hidden="true" />独立模式受控只读
            </button>
            <button v-if="hasWorkbenchRouter" class="secondary-action" type="button" @click="navigateTo('/grid-assets/nodes')"><Waypoints :size="15" aria-hidden="true" />查看节点目录</button>
          </div>
          <small class="permission-note">{{ selectedEvidenceResult ? '版本切换仅展示登记状态；revoked / blocked 始终零要素，不触发抓取或回退。' : !hasWorkbenchRouter ? '独立模式只读取当前作用域的 Provider 状态；配置请回到 dljy 主工作台。' : canConfigure ? '当前 ADMIN/BOSS 可进入数据源设置；保存仍由服务端权限校验。' : '当前为只读视角；请联系管理员完成授权源、许可与字段映射。' }}</small>
        </article>

        <div class="stage-bottom">
          <section v-if="selectedEvidenceResult" class="readiness-panel evidence-summary" aria-labelledby="topology-readiness-title">
            <header>
              <div><span>RESOLVED EVIDENCE</span><h2 id="topology-readiness-title">授权视觉层摘要</h2></div>
              <strong>{{ evidenceFeatures.length }}</strong>
            </header>
            <div class="readiness-grid">
              <article class="ready"><Building2 :size="17" /><div><strong>变电站</strong><small>仅合法 Point</small></div><span>{{ evidenceFeatures.filter(item => item.kind === 'substation').length }} 个</span></article>
              <article class="ready"><GitBranch :size="17" /><div><strong>线路</strong><small>仅合法 LineString</small></div><span>{{ evidenceFeatures.filter(item => item.kind === 'branch').length }} 条</span></article>
              <article :class="{ ready: !selectedEvidenceResult.unresolvedFeatureIds.length }"><MapPinned :size="17" /><div><strong>未定位</strong><small>绝不猜测补画</small></div><span>{{ selectedEvidenceResult.unresolvedFeatureIds.length }} 个</span></article>
            </div>
          </section>
          <section v-else class="readiness-panel" aria-labelledby="topology-readiness-title">
            <header>
              <div><span>INGESTION READINESS</span><h2 id="topology-readiness-title">网架要素就绪矩阵</h2></div>
              <strong>{{ readyCount }} / {{ readiness.length || 0 }}</strong>
            </header>
            <div v-if="readiness.length" class="readiness-grid">
              <article v-for="item in readiness" :key="item.id" :class="item.status">
                <component :is="readinessIcon(item.id)" :size="17" aria-hidden="true" />
                <div><strong>{{ item.label }}</strong><small>{{ item.required ? '授权必需' : '可选增强' }}</small></div>
                <span><CheckCircle2 v-if="item.status === 'ready'" :size="14" aria-hidden="true" />{{ item.status === 'ready' ? '已就绪' : '等待来源' }}</span>
              </article>
            </div>
            <p v-else class="readiness-empty">{{ loading ? '正在读取要素契约…' : 'Provider 尚未返回要素就绪清单。' }}</p>
          </section>

          <aside class="safety-panel" aria-labelledby="topology-safety-title">
            <header><ShieldCheck :size="18" aria-hidden="true" /><div><span>FAIL-CLOSED</span><h2 id="topology-safety-title">安全边界</h2></div></header>
            <ul>
              <li><CheckCircle2 :size="14" aria-hidden="true" />跨网、跨地区、跨公司不回退</li>
              <li><CheckCircle2 :size="14" aria-hidden="true" />无权时不请求敏感 snapshot</li>
              <li><CheckCircle2 :size="14" aria-hidden="true" />缺少精确几何时不生成连线</li>
              <li><CheckCircle2 :size="14" aria-hidden="true" />当前不运行潮流、断面或 N-1 计算</li>
            </ul>
            <div class="safety-handoff">
              <small>NEXT AUTHORIZED HANDOFF</small>
              <span><i>01</i>授权编号、许可与数据分级</span>
              <span><i>02</i>拓扑版本、有效期与状态字典</span>
              <span><i>03</i>稳定设备 ID、权威几何与 ACL</span>
            </div>
            <div class="safety-foot"><Lock :size="13" aria-hidden="true" />{{ selectedEvidenceResult?.sourceRef ?? topology?.contractVersion ?? 'contract pending' }} · {{ evidenceFeatures.length || totalFeatures }} 个授权拓扑要素</div>
          </aside>
        </div>
      </div>

      <div v-if="selectedPlant" class="reference-card" aria-live="polite">
        <MapPinned :size="16" aria-hidden="true" />
        <span><small>空间参考资产 · 非拓扑节点</small><strong>{{ selectedPlant.standardName }}</strong></span>
        <button type="button" aria-label="关闭空间参考资产卡片" @click="selectedPlantId = null">×</button>
      </div>
      <article v-if="selectedEvidenceFeature" class="evidence-feature-card" aria-live="polite">
        <button type="button" aria-label="关闭网架证据要素卡片" @click="selectedTopologyFeatureId = null">×</button>
        <small>AUTHORIZED EVIDENCE · {{ selectedEvidenceFeature.kind === 'line' ? '线路' : '变电站' }}</small>
        <h2>{{ selectedEvidenceFeature.name ?? (selectedEvidenceFeature.kind === 'line' ? '未命名授权线路' : '未命名授权变电站') }}</h2>
        <dl>
          <div><dt>稳定 ID</dt><dd>{{ selectedEvidenceFeature.stableId }}</dd></div>
          <div><dt>sourceRef</dt><dd>{{ selectedEvidenceFeature.sourceRef }}</dd></div>
          <div><dt>原始识别键</dt><dd>{{ selectedEvidenceFeature.originKey }}</dd></div>
          <div><dt>电压标记</dt><dd>{{ selectedEvidenceFeature.voltage ?? '未提供' }}</dd></div>
        </dl>
        <p>只读 WGS84 几何；不表示母线连接、潮流、负载率、断面或 N-1 关系。</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.topology-page {
  --topology-accent: #22d3ee;
  --topology-secondary: #2dd4bf;
  --topology-surface: #071b29;
  min-height: calc(100vh - 100px);
  color: #dff6ff;
}

.topology-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 12px;
  padding: 13px 17px;
  border: 1px solid color-mix(in srgb, var(--topology-accent) 25%, transparent);
  border-radius: 17px;
  background: linear-gradient(105deg, color-mix(in srgb, var(--topology-surface) 92%, transparent), rgba(4, 13, 25, .96));
  box-shadow: inset 3px 0 var(--topology-accent), 0 14px 38px rgba(0, 5, 15, .3);
}
.topology-title { display: flex; min-width: 0; align-items: center; gap: 13px; }
.title-mark { display: grid; width: 44px; height: 44px; flex: 0 0 auto; place-items: center; color: var(--topology-accent); border: 1px solid color-mix(in srgb, var(--topology-accent) 42%, transparent); border-radius: 13px; background: color-mix(in srgb, var(--topology-accent) 10%, transparent); box-shadow: 0 0 28px color-mix(in srgb, var(--topology-accent) 12%, transparent); }
.eyebrow { display: block; color: var(--topology-accent); font-size: var(--font-9); font-weight: 800; letter-spacing: .17em; }
.topology-title h1 { margin: 3px 0 2px; font-size: var(--font-19); text-wrap: balance; }
.topology-title p { margin: 0; color: #7896a8; font-size: var(--font-10); line-height: 1.45; }
.refresh-button { display: inline-flex; height: 36px; flex: 0 0 auto; align-items: center; gap: 7px; padding: 0 12px; color: #a6d7e8; border: 1px solid rgba(92, 188, 220, .24); border-radius: 10px; background: rgba(6, 26, 42, .82); cursor: pointer; }
.refresh-button:disabled { opacity: .58; cursor: wait; }
.spinning { animation: spin 1s linear infinite; }

.topology-stage { position: relative; min-height: 720px; overflow: hidden; border: 1px solid rgba(87, 182, 220, .22); border-radius: 20px; background: #020811; box-shadow: 0 24px 72px rgba(0, 5, 16, .42); isolation: isolate; }
/* 暗角：纯装饰。原值把地图四周压到近黑，与「看清地形起伏」直接冲突——
   卫星影像 + 山体阴影的明暗差本来就细，再罩一层暗角等于把刚找回来的立体感抹掉一圈。
   保留氛围但让强度退到不吃画面（不透明度砍半、扩散收窄）。 */
.stage-vignette { position: absolute; z-index: 1; inset: 0; pointer-events: none; box-shadow: inset 0 0 104px rgba(0, 4, 15, .34); }
.stage-grid { position: absolute; z-index: 2; inset: 0; pointer-events: none; opacity: .11; background-image: linear-gradient(rgba(93, 206, 232, .26) 1px, transparent 1px), linear-gradient(90deg, rgba(93, 206, 232, .26) 1px, transparent 1px); background-size: 52px 52px; mask-image: radial-gradient(circle at center, #000, transparent 79%); }
.stage-content { position: relative; z-index: 4; display: grid; min-height: 720px; grid-template-rows: auto 1fr auto; gap: 16px; padding: 17px; pointer-events: none; }
.stage-topbar, .provider-dock, .stage-bottom { pointer-events: auto; }
.stage-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
/* evidence 状态下 .provider-dock.evidence-layer 落在内容区右上（justify-self:end），
   故地形面板固定在左侧同高度错开；两者在 ≥1050px 下不会相交。 */
.terrain-dock { position: absolute; z-index: 5; top: 76px; left: 17px; width: 214px; pointer-events: auto; }
.view-switcher { display: flex; padding: 4px; border: 1px solid rgba(104, 194, 225, .2); border-radius: 11px; background: rgba(3, 17, 29, .8); backdrop-filter: blur(14px); }
.view-switcher button { min-width: 47px; height: 30px; padding: 0 8px; color: #789cad; border: 0; border-radius: 7px; background: transparent; cursor: pointer; }
.view-switcher button.active { color: #03131c; background: linear-gradient(135deg, var(--topology-accent), var(--topology-secondary)); box-shadow: 0 7px 20px color-mix(in srgb, var(--topology-accent) 25%, transparent); }
.runtime-pills { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.runtime-pills span { display: inline-flex; align-items: center; gap: 5px; padding: 6px 8px; color: #8caebd; border: 1px solid rgba(96, 180, 213, .17); border-radius: 999px; background: rgba(3, 17, 29, .72); font-size: var(--font-9); backdrop-filter: blur(12px); }
.runtime-pills span.ready { color: #79ddba; }
.runtime-pills span.fallback, .runtime-pills span.error { color: #eac16e; }

.provider-dock { position: relative; width: min(680px, calc(100% - 28px)); align-self: center; justify-self: center; overflow: hidden; padding: 24px; text-align: center; border: 1px solid color-mix(in srgb, var(--topology-accent) 34%, transparent); border-radius: 23px; background: radial-gradient(circle at 50% -25%, color-mix(in srgb, var(--topology-accent) 20%, transparent), transparent 47%), linear-gradient(145deg, rgba(5, 28, 45, .95), rgba(2, 12, 24, .94)); box-shadow: 0 32px 90px rgba(0, 3, 12, .65), inset 0 1px rgba(255, 255, 255, .05); backdrop-filter: blur(22px) saturate(1.15); }
.provider-dock.evidence-layer { width: min(520px, calc(100% - 28px)); align-self: start; justify-self: end; padding: 18px; text-align: left; }
.provider-dock.evidence-layer .status-glyph { margin-left: 0; }
.provider-dock.evidence-layer .contract-chips, .provider-dock.evidence-layer .dock-actions { justify-content: flex-start; }
.provider-dock.evidence-layer > p { margin-left: 0; }
.provider-dock::before { position: absolute; top: 0; right: 18%; left: 18%; height: 1px; content: ''; background: linear-gradient(90deg, transparent, var(--topology-accent), transparent); }
.dock-orbit { position: absolute; top: -80px; left: 50%; width: 260px; height: 260px; transform: translateX(-50%); pointer-events: none; opacity: .27; }
.dock-orbit i { position: absolute; inset: 0; border: 1px dashed color-mix(in srgb, var(--topology-accent) 45%, transparent); border-radius: 50%; animation: orbit 22s linear infinite; }
.dock-orbit i:nth-child(2) { inset: 28px; animation-direction: reverse; }
.dock-orbit i:nth-child(3) { inset: 56px; }
.status-glyph { position: relative; display: grid; width: 54px; height: 54px; margin: 0 auto 10px; place-items: center; color: #f1c972; border: 1px solid rgba(239, 190, 86, .36); border-radius: 16px; background: rgba(130, 88, 20, .19); box-shadow: 0 0 34px rgba(235, 175, 67, .11); }
.status-line { position: relative; display: inline-flex; align-items: center; gap: 5px; padding: 5px 8px; color: #e9c36d; border-radius: 999px; background: rgba(162, 108, 21, .14); font-size: var(--font-9); font-weight: 700; letter-spacing: .05em; }
.provider-dock.available .status-glyph, .provider-dock.available .status-line { color: #67e8bb; border-color: rgba(87, 219, 169, .35); background: rgba(31, 126, 91, .16); }
.provider-dock h2 { position: relative; margin: 10px 0 7px; font-size: clamp(22px, 3vw, 31px); letter-spacing: -.035em; text-wrap: balance; }
.provider-dock h2 em { color: var(--topology-accent); font-style: normal; }
.provider-dock > p { position: relative; max-width: 570px; margin: 0 auto; color: #83a2b2; font-size: var(--font-xs); line-height: 1.65; text-wrap: pretty; }
.contract-chips { position: relative; display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 13px; }
.contract-chips span { display: inline-flex; align-items: center; gap: 5px; padding: 5px 8px; color: #89afbe; border: 1px solid rgba(91, 177, 210, .15); border-radius: 8px; background: rgba(9, 41, 58, .37); font-size: var(--font-8-5); }
.provider-facts { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin: 14px 0 0; text-align: left; }
.provider-facts div { min-width: 0; padding: 9px 10px; border: 1px solid rgba(102, 185, 216, .11); border-radius: 9px; background: rgba(1, 10, 19, .32); }
.provider-facts dt { color: #617f8e; font-size: var(--font-8); }
.provider-facts dd { overflow: hidden; margin: 3px 0 0; color: #cae4ed; font-size: var(--font-10); text-overflow: ellipsis; white-space: nowrap; }
.dock-actions { position: relative; display: flex; justify-content: center; gap: 8px; margin-top: 14px; }
.dock-actions button { display: inline-flex; min-height: 36px; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; border: 0; border-radius: 10px; font-size: var(--font-10); font-weight: 650; cursor: pointer; }
.dock-actions button:disabled { opacity: .72; cursor: not-allowed; }
.primary-action { color: #03131c; background: linear-gradient(135deg, var(--topology-accent), var(--topology-secondary)); box-shadow: 0 9px 24px color-mix(in srgb, var(--topology-accent) 19%, transparent); }
.readonly-action { color: #d6f3fa; border: 1px solid color-mix(in srgb, var(--topology-accent) 37%, transparent); background: color-mix(in srgb, var(--topology-accent) 12%, rgba(5, 22, 35, .9)); }
.secondary-action { color: #91b4c3; border: 1px solid rgba(99, 186, 217, .2); background: rgba(3, 18, 31, .66); }
.permission-note { position: relative; display: block; margin-top: 9px; color: #5f7f8e; font-size: var(--font-8); }
.version-picker { position: relative; display: grid; gap: 5px; margin-top: 12px; }
.version-picker span { color: #668898; font-size: var(--font-8); font-weight: 700; letter-spacing: .08em; }
.version-picker select { width: 100%; min-height: 36px; padding: 0 10px; color: #d5eef4; border: 1px solid rgba(94, 193, 218, .25); border-radius: 9px; outline: 0; background: #041522; font-size: var(--font-10); }
.version-picker select:focus-visible { border-color: var(--topology-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--topology-accent) 18%, transparent); }
.evidence-audit { position: relative; display: grid; gap: 6px; margin-top: 10px; padding: 10px; border: 1px solid rgba(96, 187, 219, .14); border-radius: 10px; background: rgba(1, 10, 19, .38); }
.evidence-audit p { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 8px; margin: 0; color: #88a6b4; font-size: var(--font-9); line-height: 1.45; }
.evidence-audit strong { color: #628392; }
.evidence-audit a { color: #77ddc0; }
.evidence-audit .attribution span { overflow-wrap: anywhere; }
.evidence-audit details { color: #7f9daa; font-size: var(--font-9); }
.evidence-audit summary { cursor: pointer; }
.evidence-audit ul { max-height: 76px; overflow: auto; margin: 6px 0 0; padding-left: 17px; }
.evidence-audit li { margin: 3px 0; overflow-wrap: anywhere; }

.stage-bottom { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(280px, .85fr); gap: 10px; }
.readiness-panel, .safety-panel { border: 1px solid rgba(96, 187, 219, .18); border-radius: 15px; background: linear-gradient(145deg, rgba(5, 24, 40, .89), rgba(2, 13, 25, .79)); box-shadow: 0 18px 45px rgba(0, 5, 15, .37); backdrop-filter: blur(16px); }
.readiness-panel { padding: 12px; }
.readiness-panel > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
.readiness-panel header span, .safety-panel header span { color: var(--topology-accent); font-size: var(--font-7-5); font-weight: 750; letter-spacing: .15em; }
.readiness-panel h2, .safety-panel h2 { margin: 2px 0 0; font-size: var(--font-sm); }
.readiness-panel > header > strong { color: #7ddfc0; font-size: var(--font-xl); font-variant-numeric: tabular-nums; }
.readiness-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.readiness-grid article { display: grid; min-width: 0; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 7px; padding: 8px; color: #8ca7b6; border: 1px solid rgba(103, 180, 210, .11); border-radius: 9px; background: rgba(2, 13, 23, .34); }
.readiness-grid article > svg { color: #7a92a0; }
.readiness-grid article > div { min-width: 0; }
.readiness-grid strong, .readiness-grid small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.readiness-grid strong { color: #c5dee7; font-size: var(--font-10); }
.readiness-grid small { margin-top: 2px; color: #587482; font-size: var(--font-8-5); }
.readiness-grid article > span { grid-column: 1 / -1; display: flex; align-items: center; gap: 4px; color: #d2ae62; font-size: var(--font-8-5); }
.readiness-grid article.ready { border-color: rgba(77, 208, 157, .2); }
.readiness-grid article.ready > svg, .readiness-grid article.ready > span { color: #64dbb1; }
.readiness-empty { min-height: 72px; margin: 0; display: grid; place-items: center; color: #64818f; font-size: var(--font-9); }
.safety-panel { padding: 12px; }
.safety-panel > header { display: flex; align-items: center; gap: 8px; color: #6de1ba; }
.safety-panel ul { display: grid; gap: 6px; margin: 10px 0; padding: 0; list-style: none; }
.safety-panel li { display: flex; align-items: flex-start; gap: 6px; color: #88a6b4; font-size: var(--font-9-5); line-height: 1.4; }
.safety-panel li svg { flex: 0 0 auto; color: #5fd4ad; }
.safety-handoff { display: grid; gap: 5px; margin: 11px 0; padding: 10px; border: 1px solid rgba(101, 180, 208, .1); border-radius: 9px; background: rgba(2, 12, 22, .28); }
.safety-handoff > small { margin-bottom: 2px; color: var(--topology-accent); font-size: var(--font-7-5); font-weight: 750; letter-spacing: .12em; }
.safety-handoff > span { display: flex; align-items: center; gap: 7px; color: #7896a4; font-size: var(--font-8-5); }
.safety-handoff i { display: grid; width: 21px; height: 21px; flex: 0 0 auto; place-items: center; color: #58d2ae; border: 1px solid rgba(88, 210, 174, .18); border-radius: 6px; font-size: var(--font-7); font-style: normal; }
.safety-foot { display: flex; align-items: center; gap: 5px; padding-top: 8px; color: #587482; border-top: 1px solid rgba(101, 180, 208, .1); font-size: var(--font-7-5); font-variant-numeric: tabular-nums; }
.reference-card { position: absolute; z-index: 8; top: 66px; left: 17px; display: flex; max-width: min(330px, calc(100% - 34px)); align-items: center; gap: 8px; padding: 9px 10px; color: var(--topology-accent); border: 1px solid color-mix(in srgb, var(--topology-accent) 30%, transparent); border-radius: 11px; background: rgba(3, 19, 32, .91); box-shadow: 0 16px 38px rgba(0, 5, 15, .42); backdrop-filter: blur(14px); }
.reference-card span { min-width: 0; flex: 1; }
.reference-card small, .reference-card strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reference-card small { color: #668898; font-size: var(--font-7-5); }
.reference-card strong { margin-top: 2px; color: #d7edf4; font-size: var(--font-10); }
.reference-card button { display: grid; width: 26px; height: 26px; place-items: center; color: #8ba8b5; border: 0; border-radius: 7px; background: rgba(86, 142, 164, .11); cursor: pointer; }
.evidence-feature-card { position: absolute; z-index: 12; right: 18px; bottom: 18px; width: min(440px, calc(100% - 36px)); padding: 15px; color: #d9f1f5; border: 1px solid rgba(90, 222, 191, .28); border-radius: 15px; background: linear-gradient(145deg, rgba(4, 31, 37, .96), rgba(3, 17, 29, .95)); box-shadow: 0 24px 65px rgba(0, 0, 0, .55); backdrop-filter: blur(18px); }
.evidence-feature-card > button { position: absolute; top: 9px; right: 9px; display: grid; width: 28px; height: 28px; place-items: center; color: #8ba8b5; border: 0; border-radius: 7px; background: rgba(86, 142, 164, .11); cursor: pointer; }
.evidence-feature-card > small { color: #6ee7c0; font-size: var(--font-8); font-weight: 800; letter-spacing: .12em; }
.evidence-feature-card h2 { margin: 5px 32px 9px 0; font-size: var(--font-16); }
.evidence-feature-card dl { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 0; }
.evidence-feature-card dl div { min-width: 0; padding: 8px; border-radius: 8px; background: rgba(2, 15, 24, .58); }
.evidence-feature-card dt { color: #63818d; font-size: var(--font-8); }
.evidence-feature-card dd { overflow: hidden; margin: 3px 0 0; color: #cce4e9; font-size: var(--font-9); text-overflow: ellipsis; white-space: nowrap; }
.evidence-feature-card p { margin: 9px 0 0; color: #75919c; font-size: var(--font-8-5); line-height: 1.5; }

.refresh-button:hover:not(:disabled), .view-switcher button:hover, .secondary-action:hover, .readonly-action:hover, .reference-card button:hover { color: #effcff; border-color: color-mix(in srgb, var(--topology-accent) 48%, transparent); }
.refresh-button:focus-visible, .view-switcher button:focus-visible, .dock-actions button:focus-visible, .reference-card button:focus-visible { outline: 2px solid var(--topology-accent); outline-offset: 3px; }
.visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes orbit { to { transform: rotate(360deg); } }

@media (max-width: 1050px) {
  /* 此宽度下 provider-dock 接近占满，绝对定位的地形面板必然压住它。 */
  .terrain-dock { display: none; }
  .topology-stage, .stage-content { min-height: 880px; }
  .stage-bottom { grid-template-columns: 1fr; }
  .safety-panel ul { grid-template-columns: 1fr 1fr; }
}

@media (max-width: 720px) {
  .topology-header { align-items: flex-start; }
  .topology-title p { display: none; }
  .refresh-button { width: 36px; padding: 0; font-size: 0; }
  .topology-stage, .stage-content { min-height: 1020px; }
  .stage-content { padding: 10px; }
  .stage-topbar { align-items: flex-start; }
  .runtime-pills span:nth-child(n + 2) { display: none; }
  .provider-dock { width: calc(100% - 4px); padding: 20px 14px; }
  .provider-dock.evidence-layer { width: calc(100% - 4px); justify-self: center; }
  .provider-facts { grid-template-columns: 1fr; }
  .dock-actions { flex-direction: column; }
  .dock-actions button { min-height: 42px; }
  .readiness-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .safety-panel ul { grid-template-columns: 1fr; }
  .reference-card { top: 58px; left: 10px; }
  .evidence-feature-card { right: 10px; bottom: 10px; left: 10px; width: auto; }
  .evidence-feature-card dl { grid-template-columns: 1fr; }
}

@media (max-width: 430px) {
  .title-mark { display: none; }
  .topology-title h1 { font-size: var(--font-16); }
  .topology-stage, .stage-content { min-height: 980px; }
  .readiness-grid strong { min-height: 2.5em; white-space: normal; line-height: 1.25; }
  .provider-dock h2 { font-size: var(--font-22); }
  .contract-chips span:nth-child(n + 3) { display: none; }
}

@media (max-width: 340px) {
  .readiness-grid { grid-template-columns: 1fr; }
}

@media (prefers-reduced-motion: reduce) {
  .spinning, .dock-orbit i { animation: none; }
  .refresh-button, .view-switcher button, .dock-actions button, .reference-card button { transition: none; }
}
</style>
