<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { todayBeijing } from '@/utils/beijingDate'
import { Activity, AlertTriangle, ArrowRight, CloudRain, Gauge, Orbit, RefreshCw, Wind, Zap } from 'lucide-vue-next'
import { onRegionChange } from '@/composables/useRegionReload'
import ProvinceFlatMap from './ProvinceFlatMap.vue'
import PlantCatalogPanel from './PlantCatalogPanel.vue'
import GridOperatorProfileBanner from './GridOperatorProfileBanner.vue'
import WeatherTrackTimeline from './WeatherTrackTimeline.vue'
import GridObjectContextBar from './GridObjectContextBar.vue'
import GridObjectDrawer from './GridObjectDrawer.vue'
import type { GridObjectReference } from './objectNavigation'
import { useGridObjectContext } from './useGridObjectContext'
import { fetchGridGeoManifest, fetchGridGeoPlants } from './client'
import { loadWeatherImpact, type WeatherImpactResult } from './weatherImpact'
import type { WeatherTrackId } from './weatherTracks'
import type { GridGeoPlant, GridGeoSelection, GridOperatorProfile } from './types'

type MapExpose = { flyTerrainTour?: () => void }
const mapRef = ref<MapExpose | null>(null)
const objectContext = useGridObjectContext()
const detailOpen = ref(false)

const plants = shallowRef<GridGeoPlant[]>([])
const selectedPlantId = ref('')
const date = ref(objectContext.hasContext.value ? objectContext.date.value : todayBeijing())
const selectedWindow = computed(() => date.value === objectContext.date.value ? objectContext.timeWindow.value : null)
const decisionHour = ref(12)
const result = shallowRef<WeatherImpactResult | null>(null)
const loading = ref(true)
const error = ref('')
const assetsLoading = ref(true)
// 本页只有平面图：2026-09-09 用户拍板取消三维。气象影响看的是「哪个场站、哪一小时」
// 的时序关系，地形起伏对这件事没有信息量，一套三维只是多一份加载与操作成本。
const catalogFiltered = ref<GridGeoPlant[]>([])
const catalogContextKey = ref(0)
const catalogStats = ref<{ locatedPlantCount: number; totalPlantCountInCurrentDim: number; unresolvedPlantCount: number | null } | null>(null)
const operatorProfile = ref<GridOperatorProfile | null>(null)
const selectedTrackId = ref<WeatherTrackId>('d1')
const cursorHour = ref(12)
const selectedPlant = computed(() => plants.value.find((plant) => plant.plantId === selectedPlantId.value) ?? null)
const selectedReference = computed<GridObjectReference | null>(() => selectedPlant.value ? { kind: 'plant', id: selectedPlant.value.plantId, regionId: selectedPlant.value.regionId, gridOperator: selectedPlant.value.gridOperator } : null)
const contextPlants = computed(() => {
  if (!objectContext.active.value) return []
  if (!objectContext.hasContext.value) return plants.value
  const reference = objectContext.reference.value, detail = objectContext.detail.value
  if (!reference || !detail) return []
  const ids = reference.kind === 'plant' ? [reference.id] : detail.relations.plants.filter((plant) => plant.regionId === currentRegion.value.id).map((plant) => plant.id)
  return plants.value.filter((plant) => ids.includes(plant.plantId))
})
const downstreamQuery = computed(() => ({ plantId: selectedPlantId.value, date: date.value, weatherTrack: selectedTrackId.value, hour: cursorHour.value, decisionHour: decisionHour.value }))
const riskPath = computed(() => currentRegion.value.id === 'yunnan' ? '/xhjy/yunnan/spot-pnl' : '/xhjy/risk-center')
let appliedObjectContext = ''
let loadRequestId = 0
let impactRequestId = 0

function correlationText(item: { value: number | null; samples: number }) {
  if (item.value === null) return `样本不足（${item.samples}/6）`
  const strength = Math.abs(item.value) >= .7 ? '强' : Math.abs(item.value) >= .4 ? '中' : '弱'
  return `${item.value >= 0 ? '正' : '负'}相关 ${item.value.toFixed(2)} · ${strength}`
}

async function loadImpact() {
  const requestId = ++impactRequestId
  result.value = null
  if (!selectedPlant.value || !contextPlants.value.some((plant) => plant.plantId === selectedPlantId.value)) { loading.value = false; return }
  const plant = selectedPlant.value
  const companyId = selectedCompanyId.value
  const regionId = currentRegion.value.id
  loading.value = true
  error.value = ''
  try {
    const nextResult = await loadWeatherImpact(plant, date.value, {
      companyId,
      regionId,
    }, decisionHour.value)
    if (requestId === impactRequestId) result.value = nextResult
  }
  catch (cause) {
    if (requestId !== impactRequestId) return
    result.value = null; error.value = cause instanceof Error ? cause.message : '气象影响数据加载失败'
  }
  finally { if (requestId === impactRequestId) loading.value = false }
}

async function syncObjectSelection() {
  if (!objectContext.active.value) return
  impactRequestId += 1; result.value = null
  if (objectContext.hasContext.value) {
    const reference = objectContext.reference.value
    const key = JSON.stringify([reference, objectContext.date.value, objectContext.timeWindow.value, selectedCompanyId.value])
    if (key !== appliedObjectContext) {
      appliedObjectContext = key
      catalogContextKey.value += 1
      selectedPlantId.value = ''
      if (reference) date.value = objectContext.date.value
      if (objectContext.timeWindow.value) cursorHour.value = new Date(Date.parse(objectContext.timeWindow.value.from) + 8 * 3600_000).getUTCHours()
    }
    if (assetsLoading.value || objectContext.loading.value) { loading.value = true; return }
    if (!contextPlants.value.length) { selectedPlantId.value = ''; loading.value = false; error.value = objectContext.error.value || '当前对象尚未关联本公司、本地区的场站，未加载其他场站数据。'; return }
  } else appliedObjectContext = ''
  if (!contextPlants.value.some((plant) => plant.plantId === selectedPlantId.value)) selectedPlantId.value = contextPlants.value[0]?.plantId ?? ''
  await loadImpact()
}

async function load() {
  const requestId = ++loadRequestId
  assetsLoading.value = true
  impactRequestId += 1; result.value = null
  loading.value = true
  error.value = ''
  try {
    const [response, manifest] = await Promise.all([fetchGridGeoPlants(), fetchGridGeoManifest()])
    if (requestId !== loadRequestId) return
    plants.value = response.data?.items ?? []
    catalogStats.value = response.data?.catalog ?? null
    operatorProfile.value = manifest.operatorProfile
    assetsLoading.value = false
    await syncObjectSelection()
  } catch (cause) {
    if (requestId !== loadRequestId) return
    error.value = cause instanceof Error ? cause.message : '空间资产加载失败'
    loading.value = false
  }
  finally { if (requestId === loadRequestId) assetsLoading.value = false }
}

function resetDataScope() {
  loadRequestId += 1
  impactRequestId += 1
  plants.value = []
  selectedPlantId.value = ''
  result.value = null
  operatorProfile.value = null
  void load()
}

function onMapSelect(selection: GridGeoSelection | null) {
  if (!selection || !contextPlants.value.some((plant) => plant.plantId === selection.plantId)) return
  selectedPlantId.value = selection.plantId
  void loadImpact()
}

onMounted(load)
onRegionChange(resetDataScope)
watch(selectedCompanyId, resetDataScope)
watch(() => [objectContext.hasContext.value, objectContext.reference.value, objectContext.detail.value, objectContext.loading.value, objectContext.date.value, objectContext.timeWindow.value, objectContext.active.value], syncObjectSelection)
onBeforeUnmount(() => { loadRequestId += 1; impactRequestId += 1 })
</script>

<template>
  <section class="impact-shell">
    <GridOperatorProfileBanner compact @profile="operatorProfile = $event" />
    <header>
      <div class="heading"><span><CloudRain :size="22" /></span><div><small>WEATHER × POWER × PRICE</small><h2>气象交易影响时序</h2></div></div>
      <div class="filters">
        <select v-model="selectedPlantId" :disabled="!contextPlants.length" aria-label="关联场站" @change="loadImpact"><option v-if="!contextPlants.length" value="">暂无已确认关联场站</option><option v-for="plant in contextPlants" :key="plant.plantId" :value="plant.plantId">{{ plant.standardName }}</option></select>
        <button :disabled="!selectedPlant" @click="detailOpen = true">完整信息</button>
        <input v-model="date" type="date" @change="loadImpact" />
        <label class="decision-hour">截止<select v-model.number="decisionHour" aria-label="决策截止小时"><option v-for="hour in 24" :key="hour - 1" :value="hour - 1">{{ String(hour - 1).padStart(2, '0') }}:00</option></select></label>
        <button :disabled="loading" @click="loadImpact"><RefreshCw :size="14" :class="{ spin: loading }" /> 更新</button>
      </div>
    </header>
    <GridObjectContextBar :date="date" />
    <GridObjectDrawer v-model="detailOpen" :object="selectedReference" :date="date" :from="selectedWindow?.from" :to="selectedWindow?.to" />

    <div class="asof-warning"><AlertTriangle :size="16" /><span><b>四轨遵循 as-of 边界</b>：预报轨只消费 weather_asof 中 forecastAt ≤ 决策截止 ＜ validAt 的真实版本；缺源显式空段，ERA5 实况永不回填预报。</span></div>
    <div class="causality-warning"><AlertTriangle :size="17" /><b>相关性 ≠ 因果</b><span>下方相关系数与事后偏差只描述同小时共变，不能证明天气导致出力、价格或风险变化，也不是结算依据。</span></div>

    <main>
      <div class="map-pane">
        <ProvinceFlatMap
          ref="mapRef"
          :plants="catalogFiltered" view-mode="2d" :selected-plant-id="selectedPlantId"
          weather-layer="none" :weather-items="[]"
          @select="onMapSelect"
        />
        <!-- 场站目录与驾驶舱同一个组件：这一页选场站原本只能在图上戳，35 个点里找一个很难 -->
        <PlantCatalogPanel
          :key="catalogContextKey"
          :plants="contextPlants"
          :selected-plant-id="selectedPlantId"
          :total-count="catalogStats?.totalPlantCountInCurrentDim ?? null"
          :located-count="catalogStats?.locatedPlantCount ?? null"
          :unresolved-count="catalogStats?.unresolvedPlantCount ?? null"
          @select="(plant) => onMapSelect({ plantId: plant.plantId } as GridGeoSelection)"
          @update:filtered="catalogFiltered = $event"
        />
        <div v-if="result" class="map-badge"><Orbit :size="14" /><span><b>{{ selectedPlant?.standardName }}</b><small>最近气象站 {{ result.stationId || '未匹配' }} · 节点 {{ result.nodeName || '未绑定' }}</small></span></div>
      </div>

      <div class="dashboard">
        <WeatherTrackTimeline
          v-if="result"
          v-model="selectedTrackId"
          v-model:hour="cursorHour"
          :tracks="result.tracks"
          :date="date"
          :driver-label="result.driverLabel"
          :actual-output="result.series.actualOutput"
          :target-output="result.series.targetOutput"
          :target-output-label="`${result.sources.output.targetKind === 'plan' ? '计划' : '预测'}出力 · ${result.sources.output.targetSource}`"
          :day-ahead-price="result.series.daPrice"
          :realtime-price="result.series.rtPrice"
          :risk-exposure="result.series.riskExposurePercent"
          :output-source="result.sources.output"
          :price-source="result.sources.price"
          :risk-source="result.sources.risk"
        />

        <section v-if="result" class="chain">
          <article><Wind :size="17" /><span><small>气象驱动</small><b>{{ result.driverLabel }}</b></span></article><ArrowRight :size="18" />
          <article><Activity :size="17" /><span><small>场站响应</small><b>实际出力</b></span></article><ArrowRight :size="18" />
          <article><Zap :size="17" /><span><small>市场并列信号</small><b>节点实时价</b></span></article><ArrowRight :size="18" />
          <article><Gauge :size="17" /><span><small>风险入口</small><b>偏差 / CVaR</b></span></article>
        </section>

        <section v-if="result" class="correlations">
          <article><small>气象 ↔ 出力</small><strong>{{ correlationText(result.correlations.weatherOutput) }}</strong><em>同小时 · n={{ result.correlations.weatherOutput.samples }}</em></article>
          <article><small>气象 ↔ 实时价</small><strong>{{ correlationText(result.correlations.weatherPrice) }}</strong><em>同小时 · n={{ result.correlations.weatherPrice.samples }}</em></article>
          <article><small>出力 ↔ 实时价</small><strong>{{ correlationText(result.correlations.outputPrice) }}</strong><em>同小时 · n={{ result.correlations.outputPrice.samples }}</em></article>
        </section>

        <section v-if="result" class="extremes">
          <div class="card-head"><span><AlertTriangle :size="14" /> 极端天气关注窗口</span><small>展示阈值，不重估结算金额</small></div>
          <div v-if="result.alerts.length" class="alert-list"><span v-for="alert in result.alerts" :key="alert.hour"><b>{{ String(alert.hour).padStart(2,'0') }}:00</b>{{ alert.items.join(' · ') }}</span></div>
          <p v-else>当日未触发：100m 风速≥20m/s、降水≥10mm/h、温度≥35°C、GHI≥900W/m²。</p>
        </section>

        <nav v-if="result"><RouterLink :to="{ path: '/ycsj/scoreboard', query: downstreamQuery }">预测记分牌</RouterLink><RouterLink :to="{ path: '/ycsj/decision-cockpit', query: downstreamQuery }">申报决策驾驶舱</RouterLink><RouterLink :to="{ path: riskPath, query: downstreamQuery }">偏差风险详情</RouterLink></nav>
        <div v-if="loading" class="state"><Orbit :size="28" class="spin" />正在对齐气象、出力与价格…</div>
        <div v-else-if="error" class="state error"><AlertTriangle :size="22" />{{ error }}</div>
      </div>
    </main>
  </section>
</template>

<style scoped>
.impact-shell{overflow:hidden;min-height:calc(100vh - 86px);color:var(--text-body);border:1px solid rgba(70,174,208,.18);border-radius:14px;background:#03101c}.impact-shell>header{display:flex;height:66px;padding:0 17px;align-items:center;justify-content:space-between;background:var(--panel);border-bottom:1px solid rgba(80,180,212,.15)}
.heading{display:flex;align-items:center;gap:10px}.heading>span{display:grid;width:39px;height:39px;place-items:center;color:#63dcff;border-radius:11px;background:rgba(62,194,232,.11)}.heading small{color:#55bddb;font-size: var(--font-lg);letter-spacing:.15em}.heading h2{margin:2px 0 0;font-size: var(--font-20)}.filters{display:flex;gap:6px}.filters select,.filters input,.filters button{height:32px;padding:0 9px;color:#a9ccd7;border:1px solid rgba(89,183,213,.18);border-radius:7px;background:#071b2b;color-scheme:dark;font-size: var(--font-lg)}.filters select{max-width:220px}.filters button{display:flex;align-items:center;gap:5px;cursor:pointer}.decision-hour{display:flex;height:32px;padding-left:8px;align-items:center;color:#6f98a5;border:1px solid rgba(89,183,213,.18);border-radius:7px;background:#071b2b;font-size: var(--font-lg)}.decision-hour select{border:0!important;background:transparent!important}.asof-warning,.causality-warning{display:flex;padding:9px 16px;align-items:center;gap:8px;font-size: var(--font-lg)}.asof-warning{color:#c8aa68;background:rgba(184,132,36,.09);border-bottom:1px solid rgba(184,132,36,.13)}.causality-warning{color:#ffd8df;background:linear-gradient(90deg,rgba(180,40,76,.2),rgba(180,40,76,.07));border-bottom:1px solid rgba(244,88,126,.2)}.causality-warning b{font-size: var(--font-15);color:#ff7f9c}.causality-warning span{color:#ba8f9a}
.impact-shell>main{display:grid;height:calc(100vh - 215px);min-height:680px;grid-template-columns:42% 58%}.map-pane{position:relative;min-height:500px}.mode{position:absolute;z-index:5;top:12px;right:12px;display:flex;padding:4px;border-radius:8px;background:var(--panel);backdrop-filter:blur(12px)}.mode button{height:27px;padding:0 8px;color:#7199a8;border:0;border-radius:5px;background:transparent;font-size: var(--font-lg)}.mode button.active{color:#03121b;background:#5fdcf5}.terrain-dock{position:absolute;z-index:5;top:50px;right:12px;width:208px}.map-badge{position:absolute;z-index:5;right:12px;bottom:12px;left:12px;display:flex;padding:10px;align-items:center;gap:7px;border:1px solid rgba(89,187,218,.17);border-radius:9px;background:var(--panel);backdrop-filter:blur(14px)}.map-badge span{display:flex;flex-direction:column}.map-badge b{font-size: var(--font-lg)}.map-badge small{color:#638a99;font-size: var(--font-lg)}
.dashboard{position:relative;overflow:auto;padding:12px;background:radial-gradient(circle at 80% 0,rgba(42,143,173,.1),transparent 35%),#051421}.chain{display:flex;align-items:center;justify-content:space-between;gap:6px}.chain>article{display:flex;min-width:0;padding:9px;flex:1;align-items:center;gap:7px;color:#5edbf5;border:1px solid rgba(82,182,214,.14);border-radius:8px;background:var(--panel)}.chain span{display:flex;min-width:0;flex-direction:column}.chain small{color:#638694;font-size: var(--font-lg)}.chain b{overflow:hidden;font-size: var(--font-lg);text-overflow:ellipsis;white-space:nowrap}.chain>svg{color:#4a7282;flex:0 0 auto}
.extremes,.correlations article{border:1px solid rgba(85,180,210,.13);border-radius:10px;background:var(--panel)}.card-head{display:flex;align-items:center;justify-content:space-between;color:#b3dce7;font-size: var(--font-lg)}.card-head>span{display:flex;align-items:center;gap:5px}.card-head small{color:#5c7e8b;font-size: var(--font-lg)}
.correlations{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:9px}.correlations article{display:flex;padding:9px;flex-direction:column;gap:3px}.correlations small{color:#618795;font-size: var(--font-lg)}.correlations strong{font-size: var(--font-15)}.correlations em{color:#536f7b;font-size: var(--font-lg);font-style:normal}.extremes{margin-top:9px;padding:10px}.extremes>p{margin:8px 0 0;color:#638895;font-size: var(--font-lg)}.alert-list{display:flex;margin-top:7px;flex-wrap:wrap;gap:5px}.alert-list span{padding:6px;color:#e8bc69;border-radius:6px;background:rgba(190,132,34,.1);font-size: var(--font-lg)}.alert-list b{margin-right:5px}
.dashboard>nav{display:flex;gap:6px;margin-top:9px}.dashboard>nav a{padding:7px 9px;color:#79ddf0;border:1px solid rgba(82,181,212,.15);border-radius:6px;background:var(--panel);font-size: var(--font-lg);text-decoration:none}.dashboard>nav a:focus-visible{outline:2px solid #69e2f7;outline-offset:2px}.state{position:absolute;z-index:9;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;color:#a5dce7;background:var(--panel);backdrop-filter:blur(5px);font-size: var(--font-15)}.state.error{color:#e79a82}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:950px){.impact-shell>main{height:auto;grid-template-columns:1fr}.map-pane{height:430px}.terrain-dock{display:none}.dashboard{min-height:560px}.filters select{display:none}}
@media(max-width:620px){.filters input{width:115px}.asof-warning,.causality-warning{align-items:flex-start}.decision-hour{display:none}.chain>svg,.chain article:nth-of-type(3),.chain article:nth-of-type(4){display:none}.correlations{grid-template-columns:1fr}.dashboard>nav{flex-wrap:wrap}}
@media(prefers-reduced-motion:reduce){.spin{animation:none}}
</style>
