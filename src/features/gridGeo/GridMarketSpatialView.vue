<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, shallowRef, watch } from 'vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { Activity, ArrowUpRight, BarChart3, CalendarDays, CircleAlert, Crosshair, Gauge, Layers3, Orbit, RefreshCw, TrendingUp, Zap } from 'lucide-vue-next'
import { onRegionChange } from '@/composables/useRegionReload'
import ProvinceFlatMap from './ProvinceFlatMap.vue'
import TerrainControlPanel from './TerrainControlPanel.vue'
import { useGridGeoViewPreference } from './useViewPreference'
// Cesium 约 4 MiB，切到 2D 视图用不到；改为异步加载，按需拉取。
const CesiumPlantMap = defineAsyncComponent(() => import('./CesiumPlantMap.vue'))
import GridOperatorProfileBanner from './GridOperatorProfileBanner.vue'
import { fetchGridGeoManifest, fetchGridGeoPlants } from './client'
import { loadGridMarketSpatialSnapshot, type GridMarketSpatialSnapshot } from './marketSpatial'
import type { GridGeoPlant, GridGeoSelection, GridGeoTerrainStatus, GridGeoViewMode, GridMarketLayer, GridMarketMetric, GridOperatorProfile } from './types'

const plants = shallowRef<GridGeoPlant[]>([])
const snapshot = shallowRef<GridMarketSpatialSnapshot | null>(null)
const loading = ref(true)
const error = ref('')
const date = ref('2026-05-01')
const layer = ref<GridMarketLayer>('priceSpread')
// 首次进入落三维地形，之后记住上次选择；平面地图仍可一键切回。
const { viewMode, terrainProvider, hillshadeEnabled, verticalExaggeration } =
  useGridGeoViewPreference('market', { verticalExaggeration: 1.35 })
const selectedPlantId = ref<string | null>(null)

// 浮动资产卡可拖动：地图上被卡片遮住的资产，不必先关卡片再看。
const cardOffset = ref<{ x: number; y: number } | null>(null)
let dragOrigin: { pointerX: number; pointerY: number; x: number; y: number } | null = null

function onCardDragStart(event: PointerEvent) {
  // 只在标题区起拖；按钮/链接上按下不劫持点击。
  if ((event.target as HTMLElement).closest('button, a')) return
  dragOrigin = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    x: cardOffset.value?.x ?? 0,
    y: cardOffset.value?.y ?? 0,
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function onCardDragMove(event: PointerEvent) {
  if (!dragOrigin) return
  cardOffset.value = {
    x: dragOrigin.x + (event.clientX - dragOrigin.pointerX),
    y: dragOrigin.y + (event.clientY - dragOrigin.pointerY),
  }
}

function onCardDragEnd(event: PointerEvent) {
  dragOrigin = null
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
}

/** 选中新资产时把卡片放回默认位置，避免上一次拖走后新卡片出现在视野外。 */
watch(selectedPlantId, () => { cardOffset.value = null })

const cardEl = ref<HTMLElement | null>(null)

/**
 * 位移按**地图容器与卡片的实际 rect** 夹取，不用 window 常量——.market-shell 是
 * overflow:hidden，按窗口算会让卡片被裁掉标题与拖动手柄，之后再也拖不回来。
 */
const cardStyle = computed(() => {
  const offset = cardOffset.value
  if (!offset) return undefined
  const card = cardEl.value
  const stage = card?.closest('.map-stage') as HTMLElement | null
  if (!card || !stage) return { transform: `translate(${offset.x}px, ${offset.y}px)` }
  const cardRect = card.getBoundingClientRect()
  const stageRect = stage.getBoundingClientRect()
  // 当前（未加本次位移的）静止位置
  const baseLeft = cardRect.left - offset.x
  const baseTop = cardRect.top - offset.y
  const minX = stageRect.left - baseLeft
  const maxX = stageRect.right - cardRect.width - baseLeft
  const minY = stageRect.top - baseTop
  const maxY = stageRect.bottom - cardRect.height - baseTop
  return {
    transform: `translate(${Math.max(minX, Math.min(maxX, offset.x))}px, ${Math.max(minY, Math.min(maxY, offset.y))}px)`,
  }
})
const operatorProfile = ref<GridOperatorProfile | null>(null)
const terrainStatus = ref<GridGeoTerrainStatus>({ kind: 'arcgis-terrain', status: 'loading', label: '正在加载地形' })
// 晕渲图层与 ArcGIS 影像同域，该域对部分出口 IP 整体 403；失败必须让面板可见。
const hillshadeAvailable = ref<boolean | null>(null)
let loadRequestId = 0

const selectedPlant = computed(() => plants.value.find((plant) => plant.plantId === selectedPlantId.value) ?? null)
const selectedMetric = computed(() => snapshot.value?.metrics.find((metric) => metric.plantId === selectedPlantId.value) ?? null)
/** 平面图下钻到的地市州（#1424）；id 集合由地图给出，这里不自行判定几何归属。 */
const focusedSubdivision = ref<{ adcode: string; name: string; plantIds: string[] } | null>(null)
const rankedMetrics = computed(() => {
  const allowed = focusedSubdivision.value ? new Set(focusedSubdivision.value.plantIds) : null
  return [...(snapshot.value?.metrics ?? [])]
    .filter((metric) => metricValue(metric) !== null && (!allowed || allowed.has(metric.plantId)))
    .sort((a, b) => Math.abs(Number(metricValue(b))) - Math.abs(Number(metricValue(a))))
})

function onSubdivisionSelect(selection: { adcode: string; name: string; plantIds: string[] } | null) {
  const changed = selection?.adcode !== focusedSubdivision.value?.adcode
  focusedSubdivision.value = selection
  // 换地州时清掉选中资产：它可能已不在范围内，浮动卡会与地图对不上。
  if (changed) selectedPlantId.value = null
}

// Cesium 没有地市州下钻；切过去平面图被卸载、不会再发事件，攥着旧范围会让排行一直按
// 某个地州过滤而地图已是全省视角。
watch(viewMode, (mode) => {
  if (mode !== '2d') focusedSubdivision.value = null
})

const layerOptions: Array<{ value: GridMarketLayer; label: string; unit: string; icon: typeof Zap; description: string }> = [
  { value: 'priceSpread', label: '实时-日前价差', unit: '元/MWh', icon: TrendingUp, description: '正值表示实时均价高于日前均价' },
  { value: 'outputDeviation', label: '出力偏差', unit: '%', icon: Activity, description: '实际均值相对计划/预测目标的偏差' },
  { value: 'risk', label: '综合关注', unit: '分', icon: Gauge, description: '价差与出力偏差的描述性关注指数' },
]

function metricValue(metric: GridMarketMetric) {
  if (layer.value === 'priceSpread') return metric.priceSpread
  if (layer.value === 'outputDeviation') return metric.outputDeviationPercent
  if (layer.value === 'risk') return metric.riskScore
  return null
}

function valueText(metric: GridMarketMetric | null) {
  const value = metric ? metricValue(metric) : null
  if (value === null) return '缺测'
  const prefix = layer.value !== 'risk' && value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)} ${layerOptions.find((item) => item.value === layer.value)?.unit ?? ''}`
}

function tone(metric: GridMarketMetric) {
  const value = metricValue(metric)
  if (value === null) return 'missing'
  if (layer.value === 'risk') return value >= 70 ? 'hot' : value >= 40 ? 'warm' : 'cool'
  const magnitude = Math.abs(value)
  return magnitude >= (layer.value === 'priceSpread' ? 80 : 15) ? 'hot' : magnitude >= (layer.value === 'priceSpread' ? 20 : 5) ? 'warm' : 'cool'
}

function plantFor(metric: GridMarketMetric) {
  return plants.value.find((plant) => plant.plantId === metric.plantId)
}

function onSelect(selection: GridGeoSelection | null) {
  selectedPlantId.value = selection?.plantId ?? null
}

async function load() {
  const requestId = ++loadRequestId
  const companyId = selectedCompanyId.value
  const regionId = currentRegion.value.id
  loading.value = true
  error.value = ''
  selectedPlantId.value = null
  try {
    const [plantResponse, manifest] = await Promise.all([fetchGridGeoPlants(), fetchGridGeoManifest()])
    if (requestId !== loadRequestId) return
    plants.value = plantResponse.data?.items ?? []
    operatorProfile.value = manifest.operatorProfile
    const nextSnapshot = await loadGridMarketSpatialSnapshot(plants.value, date.value, {
      companyId,
      regionId,
    })
    if (requestId !== loadRequestId) return
    snapshot.value = nextSnapshot
  } catch (cause) {
    if (requestId !== loadRequestId) return
    snapshot.value = null
    error.value = cause instanceof Error ? cause.message : '市场空间快照加载失败'
  } finally {
    if (requestId === loadRequestId) loading.value = false
  }
}

function resetMarketScope() {
  loadRequestId += 1
  plants.value = []
  snapshot.value = null
  selectedPlantId.value = null
  operatorProfile.value = null
  // 旧地州的 plantIds 会把新地区的排行全筛错。平面图切地区时也会发 null，
  // 但在 2.5D/3D 下它根本没挂载、发不出事件，所以这里必须自己兜住。
  focusedSubdivision.value = null
  error.value = ''
  loading.value = true
  void load()
}

onMounted(load)
onRegionChange(resetMarketScope)
watch(selectedCompanyId, resetMarketScope)
</script>

<template>
  <section class="market-shell">
    <GridOperatorProfileBanner compact @profile="operatorProfile = $event" />
    <header class="market-header">
      <div class="title"><span><Orbit :size="22" /></span><div><small>GRID MARKET SITUATION</small><h2>电力市场空间态势</h2></div></div>
      <div class="header-actions">
        <label><CalendarDays :size="14" /><input v-model="date" type="date" /></label>
        <button :disabled="loading" @click="load"><RefreshCw :size="14" :class="{ spin: loading }" /> 刷新快照</button>
      </div>
    </header>

    <main class="map-stage">
      <!--
        2D 走省级平面地图（轻量、按地区换省、可下钻地市州），2.5D/3D 走 Cesium 地球。
        两者 props/emits 契约一致，故此处只切组件、不改数据流。
      -->
      <component
        :is="viewMode === '2d' ? ProvinceFlatMap : CesiumPlantMap"
        :plants="plants"
        :view-mode="viewMode"
        :selected-plant-id="selectedPlantId"
        :terrain-provider="terrainProvider"
        :vertical-exaggeration="verticalExaggeration"
        :hillshade-enabled="hillshadeEnabled"
        weather-layer="none"
        :weather-items="[]"
        :default-camera="operatorProfile?.defaultCamera"
        :market-layer="layer"
        :market-metrics="snapshot?.metrics ?? []"
        @select="onSelect"
        @terrain="terrainStatus = $event"
        @hillshade="hillshadeAvailable = $event.available"
        @subdivision-select="onSubdivisionSelect"
      />

      <div class="mode-switch glass">
        <button v-for="mode in (['2d', '2.5d', '3d'] as GridGeoViewMode[])" :key="mode" :class="{ active: viewMode === mode }" @click="viewMode = mode"><Layers3 :size="13" /> {{ mode.toUpperCase() }}</button>
      </div>

      <div class="left-rail">
      <aside class="layer-panel glass">
        <small>MARKET LAYERS</small>
        <h3>态势图层</h3>
        <button v-for="option in layerOptions" :key="option.value" :class="{ active: layer === option.value }" @click="layer = option.value">
          <component :is="option.icon" :size="16" />
          <span><b>{{ option.label }}</b><small>{{ option.description }}</small></span>
        </button>
        <div class="legend">
          <span><i class="cool" />低关注 / 近零</span><span><i class="warm" />中等变化</span><span><i class="hot" />高变化</span><span><i class="missing" />缺测</span>
        </div>
        <p>{{ terrainStatus.label }} · {{ snapshot?.date ?? date }}</p>
      </aside>

      <TerrainControlPanel
        v-model:provider="terrainProvider"
        v-model:hillshade="hillshadeEnabled"
        v-model:exaggeration="verticalExaggeration"
        :status="terrainStatus"
        :view-mode="viewMode"
        :hillshade-available="hillshadeAvailable"
        @request-3d="viewMode = '3d'"
      />
      </div>

      <div class="stat-strip">
        <article><small>稳定映射</small><strong>{{ snapshot?.summary.mappedPlants ?? 0 }}</strong><em>座</em></article>
        <article><small>价格覆盖</small><strong>{{ snapshot?.summary.pricedPlants ?? 0 }}</strong><em>座</em></article>
        <article><small>出力覆盖</small><strong>{{ snapshot?.summary.outputPlants ?? 0 }}</strong><em>座</em></article>
        <article class="risk"><small>高关注</small><strong>{{ snapshot?.summary.highRiskPlants ?? 0 }}</strong><em>座</em></article>
      </div>

      <aside class="ranking-panel glass">
        <div class="ranking-head">
          <span><BarChart3 :size="15" /> 变化排序</span>
          <small>{{ focusedSubdivision ? `${focusedSubdivision.name} · ` : '' }}{{ rankedMetrics.length }} 个有效资产</small>
        </div>
        <button v-for="metric in rankedMetrics" :key="metric.plantId" :class="[tone(metric), { selected: selectedPlantId === metric.plantId }]" @click="selectedPlantId = metric.plantId">
          <span><b>{{ plantFor(metric)?.standardName ?? metric.plantId }}</b><small>{{ metric.nodeName || '节点未绑定' }}</small></span>
          <strong>{{ valueText(metric) }}</strong>
        </button>
        <p v-if="!rankedMetrics.length">当前日期没有可排序的精确资产指标。</p>
      </aside>

      <article v-if="selectedPlant" ref="cardEl" class="asset-card glass" :style="cardStyle">
        <button class="close" @click="selectedPlantId = null">×</button>
        <div class="drag-handle" title="拖动可移开卡片" @pointerdown="onCardDragStart" @pointermove="onCardDragMove" @pointerup="onCardDragEnd" @pointercancel="onCardDragEnd"><small>SELECTED ASSET</small></div>
        <h3>{{ selectedPlant.standardName }}</h3>
        <p><Crosshair :size="13" /> {{ selectedPlant.location.locationLabel }}</p>
        <div class="hero-metric" :class="selectedMetric ? tone(selectedMetric) : 'missing'"><span>{{ layerOptions.find((item) => item.value === layer)?.label }}</span><strong>{{ valueText(selectedMetric) }}</strong></div>
        <div class="metric-grid">
          <span><small>日前均价</small><b>{{ selectedMetric?.daAverage?.toFixed(1) ?? '—' }}</b></span>
          <span><small>实时均价</small><b>{{ selectedMetric?.rtAverage?.toFixed(1) ?? '—' }}</b></span>
          <span><small>出力偏差</small><b>{{ selectedMetric?.outputDeviationMw?.toFixed(1) ?? '—' }} MW</b></span>
          <span><small>关注时段</small><b>{{ selectedMetric?.anomalyCount ?? 0 }}</b></span>
        </div>
        <nav><RouterLink v-if="currentRegion.id === 'yunnan'" to="/xhjy/yunnan/node-price">节点电价 <ArrowUpRight :size="12" /></RouterLink><RouterLink :to="currentRegion.id === 'yunnan' ? '/xhjy/yunnan/spot-pnl' : '/xhjy/risk-center'">风险工作台 <ArrowUpRight :size="12" /></RouterLink></nav>
      </article>

      <div v-if="loading" class="state glass"><Orbit :size="30" class="spin" /><strong>正在汇聚空间市场快照…</strong></div>
      <div v-else-if="error" class="state error glass"><CircleAlert :size="24" /><strong>{{ error }}</strong><button @click="load">重试</button></div>

      <footer class="truth-bar glass">
        <span><Zap :size="13" /> 节点价格：{{ snapshot?.sources.nodePrice.status ?? '—' }} · {{ snapshot?.sources.nodePrice.sourceType || 'UNKNOWN' }} · mock={{ snapshot?.sources.nodePrice.mock ?? false }}</span>
        <span><Activity :size="13" /> 出力：{{ snapshot?.sources.output.status ?? '—' }} · {{ snapshot?.sources.output.sourceType || 'UNKNOWN' }} · mock={{ snapshot?.sources.output.mock ?? false }}</span>
        <span><CircleAlert :size="13" /> 关注指数为并列信号，不代表阻塞、潮流或因果归因</span>
      </footer>
    </main>

    <section v-if="snapshot" class="formula-note">
      <Gauge :size="17" /><div><strong>公开计算口径</strong><p>{{ snapshot.formula.priceContribution }}；{{ snapshot.formula.outputContribution }}；{{ snapshot.formula.riskScore }}。</p></div>
    </section>
  </section>
</template>

<style scoped>
.market-shell { --cyan:var(--primary); overflow:hidden; min-height:calc(100vh - 86px); color:var(--text); border:1px solid var(--line); border-radius:14px; background:var(--bg); }
.market-header { display:flex; height:68px; padding:0 18px; align-items:center; justify-content:space-between; border-bottom:1px solid var(--line); background:var(--panel); }
.title { display:flex; align-items:center; gap:11px; }.title>span{display:grid;width:39px;height:39px;place-items:center;color:var(--cyan);border-radius:11px;background:var(--primary-tint);box-shadow:none}
.title small,.layer-panel>small{color:var(--primary);font-size: var(--font-lg);letter-spacing:.16em}.title h2{margin:2px 0 0;font-size: var(--font-20)}
.header-actions{display:flex;gap:7px}.header-actions label,.header-actions button{display:flex;height:33px;padding:0 10px;align-items:center;gap:6px;color:var(--text-body);border:1px solid var(--line);border-radius:8px;background:var(--chip-bg,transparent);font-size: var(--font-lg)}.header-actions input{color:var(--text-body);border:0;outline:0;background:transparent;color-scheme:dark;font-size: var(--font-lg)}.header-actions button{cursor:pointer}
.map-stage{position:relative;height:calc(100vh - 192px);min-height:650px}.glass{border:1px solid var(--line);background:var(--panel);box-shadow:var(--shadow,0 18px 50px rgba(0,0,0,.18));backdrop-filter:blur(16px)}
.mode-switch{position:absolute;z-index:6;top:14px;right:14px;display:flex;padding:4px;border-radius:9px}.mode-switch button{display:flex;height:29px;padding:0 8px;align-items:center;gap:4px;color:var(--text-soft);border:0;border-radius:6px;background:transparent;font-size: var(--font-lg);cursor:pointer}.mode-switch button.active{color:var(--bg);background:var(--primary)}
.left-rail{position:absolute;z-index:6;top:14px;left:14px;display:flex;width:278px;max-height:calc(100% - 76px);flex-direction:column;gap:9px;overflow:auto}
.layer-panel{flex:0 0 auto;padding:13px;border-radius:13px}.layer-panel h3{margin:3px 0 10px;font-size: var(--font-16)}.layer-panel>button{display:flex;width:100%;padding:9px;align-items:center;gap:8px;color:var(--text-soft);border:1px solid transparent;border-radius:8px;background:transparent;text-align:left;cursor:pointer}.layer-panel>button span{display:flex;flex-direction:column;gap:2px}.layer-panel>button b{font-size: var(--font-lg)}.layer-panel>button small{color:var(--text-soft);font-size: var(--font-lg)}.layer-panel>button.active{color:var(--primary);border-color:var(--primary-tint-border);background:var(--primary-tint)}.layer-panel>button.active small{color:var(--primary)}
.legend{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;padding-top:9px;border-top:1px solid var(--line)}.legend span{display:flex;align-items:center;gap:5px;color:var(--text-soft);font-size: var(--font-lg)}.legend i{width:7px;height:7px;border-radius:50%}.cool{background:var(--success)}.warm{background:var(--warning)}.hot{background:var(--danger)}.missing{background:var(--muted)}.layer-panel>p{margin:9px 0 0;color:var(--text-soft);font-size: var(--font-lg)}
.stat-strip{position:absolute;z-index:5;top:14px;left:308px;display:flex;gap:7px}.stat-strip article{display:grid;min-width:92px;padding:8px 10px;grid-template-columns:auto auto;align-items:baseline;border:1px solid var(--line);border-radius:9px;background:var(--panel);backdrop-filter:blur(14px)}.stat-strip small{grid-column:1/-1;color:var(--text-soft);font-size: var(--font-lg)}.stat-strip strong{color:var(--primary);font-size: var(--font-21)}.stat-strip em{margin-left:3px;color:var(--text-soft);font-size: var(--font-lg);font-style:normal}.stat-strip .risk strong{color:var(--warning)}
.ranking-panel{position:absolute;z-index:6;top:75px;right:14px;width:285px;max-height:470px;padding:11px;border-radius:12px;overflow:auto}.ranking-head{display:flex;margin-bottom:7px;justify-content:space-between;color:var(--primary);font-size: var(--font-lg)}.ranking-head span{display:flex;align-items:center;gap:5px}.ranking-head small{color:var(--text-soft);font-size: var(--font-lg)}.ranking-panel>button{display:flex;width:100%;margin-top:5px;padding:8px;align-items:center;justify-content:space-between;gap:7px;color:var(--text-body);border:1px solid var(--line);border-radius:8px;background:var(--chip-bg,transparent);cursor:pointer}.ranking-panel>button.selected{border-color:var(--primary);box-shadow:inset 3px 0 var(--primary)}.ranking-panel button span{display:flex;min-width:0;flex-direction:column;text-align:left}.ranking-panel button b{overflow:hidden;max-width:155px;font-size: var(--font-lg);text-overflow:ellipsis;white-space:nowrap}.ranking-panel button small{color:var(--text-soft);font-size: var(--font-lg)}.ranking-panel button strong{font-size: var(--font-lg)}.ranking-panel button.hot strong{color:var(--danger)}.ranking-panel button.warm strong{color:var(--warning)}.ranking-panel button.cool strong{color:var(--success)}.ranking-panel>p{color:var(--text-soft);font-size: var(--font-lg);text-align:center}
.asset-card{position:absolute;z-index:8;bottom:55px;left:308px;width:355px;padding:14px;border-radius:13px}.asset-card .close{position:absolute;top:8px;right:8px;color:var(--text-soft);border:0;background:transparent;font-size: var(--font-21);cursor:pointer}.drag-handle{cursor:grab;touch-action:none;user-select:none}.drag-handle:active{cursor:grabbing}.asset-card>.drag-handle>small,.asset-card>small{color:var(--primary);font-size: var(--font-lg);letter-spacing:.14em}.asset-card h3{margin:4px 24px 4px 0;font-size: var(--font-16)}.asset-card>p{display:flex;margin:0;align-items:center;gap:5px;color:var(--text-soft);font-size: var(--font-lg)}.hero-metric{display:flex;margin-top:10px;padding:9px;align-items:center;justify-content:space-between;border-radius:8px;border:1px solid var(--primary-tint-border);background:var(--primary-tint)}.hero-metric span{color:var(--text-soft);font-size: var(--font-lg)}.hero-metric strong{color:var(--primary);font-size: var(--font-20);font-weight:700}.hero-metric.hot strong{color:var(--danger)}.hero-metric.warm strong{color:var(--warning)}.hero-metric.cool strong{color:var(--success)}.metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:7px}.metric-grid span{display:flex;padding:7px;flex-direction:column;gap:2px;border-radius:6px;border:1px solid var(--line);background:var(--panel-sub)}.metric-grid small{color:var(--text-soft);font-size: var(--font-lg)}.metric-grid b{color:var(--text);font-size: var(--font-16);font-weight:600}.asset-card nav{display:flex;gap:6px;margin-top:8px}.asset-card nav a{display:flex;padding:7px;align-items:center;gap:4px;color:var(--primary);border:1px solid var(--line);border-radius:6px;font-size: var(--font-lg);text-decoration:none}
.truth-bar{position:absolute;z-index:5;right:14px;bottom:10px;left:14px;display:flex;padding:9px 12px;gap:18px;border-radius:9px;color:var(--text-soft);font-size: var(--font-lg)}.truth-bar span{display:flex;align-items:center;gap:5px}.truth-bar span:last-child{margin-left:auto;color:var(--warning)}
.state{position:absolute;z-index:12;top:50%;left:50%;display:flex;padding:22px;align-items:center;gap:10px;transform:translate(-50%,-50%);border-radius:12px}.state strong{font-size: var(--font-15)}.state.error{color:var(--danger)}.state button{padding:6px 10px;color:var(--text-body);border:1px solid var(--line);border-radius:6px;background:var(--primary-tint)}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.formula-note{display:flex;padding:12px 18px;align-items:flex-start;gap:8px;color:var(--warning);border-top:1px solid var(--line);background:var(--panel)}.formula-note strong{font-size: var(--font-lg)}.formula-note p{margin:2px 0 0;color:var(--text-soft);font-size: var(--font-lg)}
@media(max-width:1050px){.ranking-panel{display:none}.stat-strip article:nth-child(n+3){display:none}.asset-card{right:14px;left:auto}.truth-bar span:nth-child(2){display:none}}
@media(max-width:700px){.market-header{padding:0 10px}.header-actions label{display:none}.map-stage{min-height:620px}.left-rail{top:55px;right:10px;left:10px;width:auto;max-height:none}.layer-panel{width:auto}.layer-panel>button small,.legend,.layer-panel>p{display:none}.layer-panel>button{display:inline-flex;width:32%;justify-content:center}.layer-panel>button span{display:none}.stat-strip{top:185px;left:10px}.mode-switch{top:10px;right:10px}.left-rail>.terrain-control{display:none}.asset-card{right:10px;bottom:58px;left:10px;width:auto}.truth-bar span:first-child{display:none}.formula-note{display:none}}
</style>
