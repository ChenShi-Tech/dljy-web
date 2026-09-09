<script setup lang="ts">
import { computed, defineAsyncComponent, onActivated, onMounted, ref, shallowRef, watch } from 'vue'
import {
  Aperture,
  Activity,
  Building2,
  CircleDotDashed,
  Cloud,
  CloudRain,
  Crosshair,
  Database,
  Droplets,
  ExternalLink,
  Factory,
  Focus,
  History,
  Map,
  Mountain,
  Orbit,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Sun,
  Thermometer,
  Wind,
  X,
} from 'lucide-vue-next'
import CesiumPlantMap from './CesiumPlantMap.vue'
import TerrainControlPanel from './TerrainControlPanel.vue'
import { useGridGeoViewPreference } from './useViewPreference'
import PlantAssetGovernance from './PlantAssetGovernance.vue'
import GridOperatorProfileBanner from './GridOperatorProfileBanner.vue'
import { onRegionChange } from '@/composables/useRegionReload'
import { selectedCompanyId } from '@/services/company/companyContext'
import { fetchGridGeoManifest, fetchGridGeoPlants, fetchGridGeoWeather } from './client'
import type {
  GridGeoConfidence,
  GridGeoPlant,
  GridGeoPlantType,
  GridGeoSelection,
  GridGeoRuntimeStatus,
  GridGeoTerrainStatus,
  GridGeoViewMode,
  GridGeoWeatherLayer,
  GridGeoWeatherResponse,
  GridGeoWeatherSnapshot,
  GridOperatorProfile,
} from './types'

type MapExpose = { focusPlant: (plantId: string) => void; resetView: () => void; flyTerrainTour?: () => void }

const PlantBusinessAttributes = defineAsyncComponent(() => import('./PlantBusinessAttributes.vue'))

const loading = ref(true)
const error = ref('')
const plants = shallowRef<GridGeoPlant[]>([])
const catalog = ref<{ locatedPlantCount: number; totalPlantCountInCurrentDim: number; unresolvedPlantCount: number | null } | null>(null)
const { viewMode, terrainProvider, hillshadeEnabled, verticalExaggeration } =
  useGridGeoViewPreference('assets', { verticalExaggeration: 1.35 })
const terrainStatus = ref<GridGeoTerrainStatus>({ kind: terrainProvider.value, status: 'loading', label: '正在加载高程地形' })
// 晕渲图层与 ArcGIS 影像同域，该域对部分出口 IP 整体 403；失败必须让面板可见。
const hillshadeAvailable = ref<boolean | null>(null)
const weatherLayer = ref<GridGeoWeatherLayer>('wind')
const weatherItems = shallowRef<GridGeoWeatherSnapshot[]>([])
const weatherLoading = ref(false)
const weatherError = ref('')
const weatherMeta = ref<Pick<GridGeoWeatherResponse, 'provider' | 'basis' | 'sourceType' | 'mock' | 'productionWrite'> | null>(null)
const weatherFetchedAt = ref('')
const weatherSummary = ref<GridGeoWeatherResponse['data']['summary'] | null>(null)
const keyword = ref('')
const typeFilter = ref<'all' | GridGeoPlantType>('all')
const confidenceFilter = ref<'all' | GridGeoConfidence>('all')
const selectedPlantId = ref<string | null>(null)
const cardPosition = ref({ x: 520, y: 260 })
const detailOpen = ref(false)
const governanceOpen = ref(false)
const governanceMode = ref<'edit' | 'history'>('edit')
const canWrite = ref(false)
const mapRef = ref<MapExpose | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const operatorProfile = ref<GridOperatorProfile | null>(null)
const runtimeStatus = ref<GridGeoRuntimeStatus | null>(null)
let loadRequestId = 0
let weatherRequestId = 0

const filteredPlants = computed(() => {
  const needle = keyword.value.trim().toLocaleLowerCase('zh-CN')
  return plants.value.filter((plant) => {
    if (typeFilter.value !== 'all' && plant.plantType !== typeFilter.value) return false
    if (confidenceFilter.value !== 'all' && plant.location.confidence !== confidenceFilter.value) return false
    if (!needle) return true
    return [plant.standardName, ...plant.aliases, plant.location.locationLabel, ...plant.nodeRefs.map((item) => item.nodeName)]
      .join(' ')
      .toLocaleLowerCase('zh-CN')
      .includes(needle)
  })
})

const selectedPlant = computed(() => plants.value.find((plant) => plant.plantId === selectedPlantId.value) ?? null)
const visibleCapacity = computed(() => filteredPlants.value.reduce((sum, item) => sum + (Number(item.capacityMw) || 0), 0))
const windCount = computed(() => filteredPlants.value.filter((item) => item.plantType === 'wind').length)
const solarCount = computed(() => filteredPlants.value.filter((item) => item.plantType === 'solar').length)
const weatherByPlantId = computed(() => new globalThis.Map(weatherItems.value.map((item) => [item.plantId, item])))
const selectedWeather = computed(() => selectedPlantId.value ? weatherByPlantId.value.get(selectedPlantId.value) ?? null : null)
const hasVisibleRain = computed(() => weatherLayer.value === 'precipitation' && weatherItems.value.some((item) => (item.precipitationMm ?? 0) > 0))

watch(filteredPlants, (items) => {
  if (selectedPlantId.value && !items.some((item) => item.plantId === selectedPlantId.value)) {
    selectedPlantId.value = null
  }
})

const modeOptions: Array<{ value: GridGeoViewMode; label: string; icon: typeof Map }> = [
  { value: '2d', label: '2D', icon: Map },
  { value: '3d', label: '3D', icon: Orbit },
]

const weatherLayerOptions: Array<{ value: GridGeoWeatherLayer; label: string; icon: typeof Wind }> = [
  { value: 'none', label: '关闭', icon: CircleDotDashed },
  { value: 'wind', label: '风场', icon: Wind },
  { value: 'temperature', label: '温度', icon: Thermometer },
  { value: 'precipitation', label: '降水', icon: CloudRain },
  { value: 'irradiance', label: '辐照', icon: Sun },
  { value: 'cloud', label: '云层', icon: Cloud },
]

const typeLabel: Record<GridGeoPlantType, string> = {
  wind: '风电', solar: '光伏', hydro: '水电', thermal: '火电', storage: '储能', other: '其他',
}

const accuracyLabel = {
  site: '厂址级', village: '村级参考点', township: '乡镇级参考点', county: '县域参考点', approximate: '近似位置',
}

const confidenceLabel = { verified: '范围已核验', probable: '待二次核验', unverified: '未核验' }

function typeIcon(plant: GridGeoPlant) {
  return plant.plantType === 'wind' ? Wind : plant.plantType === 'solar' ? Sun : Factory
}

function clampCard(position: GridGeoSelection) {
  const rect = stageRef.value?.getBoundingClientRect()
  const width = rect?.width ?? 1100
  const height = rect?.height ?? 700
  return {
    x: Math.min(Math.max(position.x + 24, 14), Math.max(14, width - 664)),
    y: Math.min(Math.max(position.y - 64, 16), Math.max(16, height - 470)),
  }
}

function onMapSelect(selection: GridGeoSelection | null) {
  if (!selection) {
    selectedPlantId.value = null
    return
  }
  selectedPlantId.value = selection.plantId
  cardPosition.value = clampCard(selection)
}

function selectFromList(plant: GridGeoPlant) {
  selectedPlantId.value = plant.plantId
  cardPosition.value = { x: Math.max(330, (stageRef.value?.clientWidth ?? 900) - 680), y: 124 }
  mapRef.value?.focusPlant(plant.plantId)
}

function focusSelected() {
  if (selectedPlantId.value) mapRef.value?.focusPlant(selectedPlantId.value)
}

function resetMap() {
  selectedPlantId.value = null
  mapRef.value?.resetView()
}

function formatCapacity(value: number | null) {
  return value === null ? '缺测' : `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} MW`
}

function formatWeatherValue(value: number | null | undefined, unit: string, digits = 1) {
  return Number.isFinite(value) ? `${Number(value).toFixed(digits)} ${unit}` : '暂不可用'
}

function formatWeatherTime(value: string) {
  if (!value) return '未更新'
  if (/Z$|[+-]\d{2}:\d{2}$/.test(value)) {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date).replaceAll('/', '-')
    }
  }
  return value.replace('T', ' ').slice(0, 16)
}

function weatherLayerHint() {
  if (weatherError.value) return weatherError.value
  if (weatherLoading.value) return '正在加载场站天气格点…'
  if (!weatherItems.value.length) return '当前没有可显示的天气格点'
  if (weatherLayer.value === 'wind') return '箭头表示风的去向，长度随风速变化'
  if (weatherLayer.value === 'temperature') return '冷色到暖色表示当前 2 米气温'
  if (weatherLayer.value === 'precipitation') return '蓝色范围表示当前格点降水强度'
  if (weatherLayer.value === 'irradiance') return '金色范围表示当前短波辐照'
  if (weatherLayer.value === 'cloud') return '三维积云密度近似表达格点云量'
  return '天气图层已关闭'
}

async function loadWeather() {
  const requestId = ++weatherRequestId
  weatherLoading.value = true
  weatherError.value = ''
  try {
    const response = await fetchGridGeoWeather()
    if (requestId !== weatherRequestId) return
    weatherItems.value = response.data?.items ?? []
    weatherSummary.value = response.data?.summary ?? null
    weatherFetchedAt.value = response.data?.fetchedAt ?? ''
    weatherMeta.value = {
      provider: response.provider,
      basis: response.basis,
      sourceType: response.sourceType,
      mock: response.mock,
      productionWrite: response.productionWrite,
    }
  } catch (cause) {
    if (requestId !== weatherRequestId) return
    weatherItems.value = []
    weatherSummary.value = null
    weatherError.value = cause instanceof Error ? cause.message : '场站天气暂不可用'
  } finally {
    if (requestId === weatherRequestId) weatherLoading.value = false
  }
}

async function load() {
  const requestId = ++loadRequestId
  loading.value = true
  error.value = ''
  try {
    const [response, manifest] = await Promise.all([fetchGridGeoPlants(), fetchGridGeoManifest().catch(() => null)])
    if (requestId !== loadRequestId) return
    plants.value = response.data?.items ?? []
    canWrite.value = Boolean(manifest?.capabilities.canWrite)
    catalog.value = response.data?.catalog ?? null
    void loadWeather()
  } catch (cause) {
    if (requestId !== loadRequestId) return
    error.value = cause instanceof Error ? cause.message : '空间资产加载失败'
  } finally {
    if (requestId === loadRequestId) loading.value = false
  }
}

function resetDataScope() {
  loadRequestId += 1
  weatherRequestId += 1
  loading.value = true
  error.value = ''
  weatherLoading.value = false
  weatherError.value = ''
  selectedPlantId.value = null
  detailOpen.value = false
  governanceOpen.value = false
  plants.value = []
  weatherItems.value = []
  weatherMeta.value = null
  weatherSummary.value = null
  weatherFetchedAt.value = ''
  catalog.value = null
  canWrite.value = false
  operatorProfile.value = null
  runtimeStatus.value = null
  void load()
}

function openGovernance(mode: 'edit' | 'history') {
  governanceMode.value = mode
  governanceOpen.value = true
}

function onPlantSaved(plant: GridGeoPlant) {
  plants.value = plants.value.map((item) => item.plantId === plant.plantId ? plant : item)
  void loadWeather()
}

onMounted(load)
onRegionChange(resetDataScope)
watch(selectedCompanyId, resetDataScope)
onActivated(() => window.dispatchEvent(new Event('resize')))
</script>

<template>
  <section class="grid-geo-shell">
    <GridOperatorProfileBanner compact @profile="operatorProfile = $event" />
    <header class="geo-header">
      <div class="header-title">
        <span class="title-orbit"><Orbit :size="22" /></span>
        <div>
          <div class="eyebrow">GRID GEO · {{ operatorProfile?.region.label?.toUpperCase() ?? 'REGION' }}</div>
          <h2>电厂地理空间资产</h2>
        </div>
      </div>
      <div class="header-pills">
        <span><Database :size="13" /> DB · 来源可追溯</span>
        <span :class="`terrain-${terrainStatus.status}`"><Mountain :size="13" /> {{ terrainStatus.label }}</span>
        <span :class="{ 'weather-warning': !!weatherError }"><Cloud :size="13" /> {{ weatherItems.length ? `${weatherItems.length} 个当前天气格点` : '天气待加载' }}</span>
        <span v-if="runtimeStatus" :class="{ 'weather-warning': runtimeStatus.network === 'weak' || runtimeStatus.webgl === 'lost' }">
          <Activity :size="13" /> {{ runtimeStatus.network === 'weak' ? '弱网 LOD' : '标准 LOD' }} · {{ runtimeStatus.renderMode === 'on-demand' ? '按需渲染' : '连续渲染' }} · WebGL {{ runtimeStatus.webgl }}
        </span>
        <span class="readonly"><CircleDotDashed :size="13" /> 版本化空间底座</span>
      </div>
    </header>

    <div ref="stageRef" class="geo-stage" :class="{ 'has-selection': !!selectedPlant }">
      <CesiumPlantMap
        v-if="!loading && !error"
        ref="mapRef"
        :plants="filteredPlants"
        :view-mode="viewMode"
        :selected-plant-id="selectedPlantId"
        :terrain-provider="terrainProvider"
        :vertical-exaggeration="verticalExaggeration"
        :hillshade-enabled="hillshadeEnabled"
        :weather-layer="weatherLayer"
        :weather-items="weatherItems"
        :default-camera="operatorProfile?.defaultCamera"
        @select="onMapSelect"
        @terrain="terrainStatus = $event"
        @hillshade="hillshadeAvailable = $event.available"
        @runtime="runtimeStatus = $event"
      />

      <div class="map-vignette" aria-hidden="true" />
      <div class="grid-overlay" aria-hidden="true" />
      <div v-if="hasVisibleRain" class="rain-overlay" aria-hidden="true" />

      <aside class="asset-panel glass-panel">
        <div class="panel-heading">
          <div>
            <small>ASSET CATALOG</small>
            <strong>场站目录</strong>
          </div>
          <span>{{ filteredPlants.length }} / {{ catalog?.totalPlantCountInCurrentDim ?? 35 }}</span>
        </div>

        <label class="search-box">
          <Search :size="15" />
          <input v-model="keyword" placeholder="搜索电厂、节点或区域" />
        </label>

        <div class="filter-row">
          <button :class="{ active: typeFilter === 'all' }" @click="typeFilter = 'all'">全部</button>
          <button :class="{ active: typeFilter === 'wind' }" @click="typeFilter = 'wind'"><Wind :size="13" /> 风电</button>
          <button :class="{ active: typeFilter === 'solar' }" @click="typeFilter = 'solar'"><Sun :size="13" /> 光伏</button>
        </div>

        <select v-model="confidenceFilter" class="confidence-select">
          <option value="all">全部定位置信度</option>
          <option value="verified">已核验公开范围</option>
          <option value="probable">待二次核验</option>
          <option value="unverified">未核验</option>
        </select>

        <div class="asset-list" aria-label="可定位场站列表">
          <button
            v-for="plant in filteredPlants"
            :key="plant.plantId"
            class="asset-item"
            :class="[{ active: plant.plantId === selectedPlantId }, `type-${plant.plantType}`]"
            :aria-current="plant.plantId === selectedPlantId ? 'true' : undefined"
            @click="selectFromList(plant)"
          >
            <span class="asset-icon"><component :is="typeIcon(plant)" :size="17" /></span>
            <span class="asset-copy">
              <strong>{{ plant.standardName }}</strong>
              <small>{{ plant.location.locationLabel }}</small>
            </span>
            <span class="capacity">{{ plant.capacityMw === null ? '—' : plant.capacityMw }}</span>
          </button>
          <div v-if="!filteredPlants.length" class="empty-list">没有符合筛选条件的空间资产</div>
        </div>

        <div class="coverage-note">
          <Aperture :size="15" />
          <span v-if="typeof catalog?.unresolvedPlantCount === 'number'">已上屏 {{ catalog.locatedPlantCount }} 个位置；其余 {{ catalog.unresolvedPlantCount }} 个已审计并明确标为坐标待核验，不从定价节点猜测位置。</span>
          <span v-else>受管空间目录已加载 {{ catalog?.locatedPlantCount ?? plants.length }} 个位置，人工订正保留来源与修订历史。</span>
        </div>
      </aside>

      <div class="hud-stats">
        <article><span>可见场站</span><strong>{{ filteredPlants.length }}</strong><small>座</small></article>
        <article><span>已知装机</span><strong>{{ visibleCapacity.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) }}</strong><small>MW</small></article>
        <article class="wind-stat"><span>风电</span><strong>{{ windCount }}</strong><small>座</small></article>
        <article class="solar-stat"><span>光伏</span><strong>{{ solarCount }}</strong><small>座</small></article>
      </div>

      <div class="mode-control glass-panel" aria-label="地图视图模式">
        <button
          v-for="option in modeOptions"
          :key="option.value"
          :class="{ active: viewMode === option.value }"
          :aria-pressed="viewMode === option.value"
          @click="viewMode = option.value"
        >
          <component :is="option.icon" :size="15" /> {{ option.label }}
        </button>
        <span class="control-divider" />
        <button title="恢复全省视角" @click="resetMap"><RotateCcw :size="15" /></button>
      </div>

      <div class="side-stack">
      <TerrainControlPanel
        v-model:provider="terrainProvider"
        v-model:hillshade="hillshadeEnabled"
        v-model:exaggeration="verticalExaggeration"
        class="environment-control"
        :status="terrainStatus"
        :view-mode="viewMode"
        :hillshade-available="hillshadeAvailable"
        @request-3d="viewMode = '3d'"
        @request-terrain-tour="mapRef?.flyTerrainTour?.()"
      />

      <div class="weather-control glass-panel">
        <div class="weather-head">
          <div>
            <small>WEATHER LAYERS · CURRENT GRID</small>
            <strong>地形天气</strong>
          </div>
          <button :class="{ spinning: weatherLoading }" title="刷新天气" @click="loadWeather"><RefreshCw :size="14" /></button>
        </div>
        <div class="weather-tabs">
          <button
            v-for="option in weatherLayerOptions"
            :key="option.value"
            :class="{ active: weatherLayer === option.value }"
            :aria-pressed="weatherLayer === option.value"
            @click="weatherLayer = option.value"
          >
            <component :is="option.icon" :size="13" /> {{ option.label }}
          </button>
        </div>
        <div class="weather-summary">
          <span><Thermometer :size="13" /><b>{{ weatherSummary?.averageTemperatureC?.toFixed(1) ?? '—' }}°</b><small>区域均温</small></span>
          <span><Wind :size="13" /><b>{{ weatherSummary?.averageWindSpeedMs?.toFixed(1) ?? '—' }}</b><small>m/s 均风</small></span>
          <span><Cloud :size="13" /><b>{{ weatherSummary?.averageCloudCoverPercent?.toFixed(0) ?? '—' }}%</b><small>平均云量</small></span>
        </div>
        <p :class="{ error: !!weatherError }">{{ weatherLayerHint() }}</p>
        <div class="weather-source">
          <span>{{ weatherMeta?.provider?.name ?? 'Open-Meteo' }} · {{ formatWeatherTime(weatherFetchedAt) }}</span>
          <span>接口来源 · 口径：真实 · 非场站实测</span>
        </div>
      </div>
      </div>

      <div class="legend glass-panel">
        <span><i class="wind-dot" /> 风电场</span>
        <span><i class="solar-dot" /> 光伏电站</span>
        <span><i class="range-ring" /> 公开位置不确定范围</span>
        <span v-if="weatherLayer !== 'none'"><i class="weather-ring" /> {{ weatherLayerOptions.find((item) => item.value === weatherLayer)?.label }}图层</span>
      </div>

      <div v-if="loading" class="stage-state glass-panel">
        <span class="loading-orbit"><Orbit :size="34" /></span>
        <strong>正在装载空间资产...</strong>
      </div>
      <div v-else-if="error" class="stage-state glass-panel error-state">
        <strong>空间资产暂不可用</strong>
        <span>{{ error }}</span>
        <button @click="load">重新加载</button>
      </div>

      <article
        v-if="selectedPlant"
        class="plant-float-card"
        :style="{ left: `${cardPosition.x}px`, top: `${cardPosition.y}px` }"
        role="dialog"
        :aria-label="`${selectedPlant.standardName} 空间资产信息卡`"
      >
        <button class="close-card" aria-label="关闭悬浮卡片" @click="selectedPlantId = null"><X :size="15" /></button>
        <div class="float-head">
          <span :class="['float-icon', `type-${selectedPlant.plantType}`]"><component :is="typeIcon(selectedPlant)" :size="20" /></span>
          <div>
            <small>{{ typeLabel[selectedPlant.plantType] }} · {{ selectedPlant.status === 'operating' ? '运行' : selectedPlant.status }}</small>
            <h3>{{ selectedPlant.standardName }}</h3>
          </div>
        </div>
        <div class="float-location">
          <Crosshair :size="15" />
          <div>
            <strong>{{ selectedPlant.location.locationLabel }}</strong>
            <small>{{ selectedPlant.location.longitude.toFixed(5) }}, {{ selectedPlant.location.latitude.toFixed(5) }} · WGS84</small>
          </div>
        </div>
        <div class="float-metrics">
          <span><small>装机容量</small><strong>{{ formatCapacity(selectedPlant.capacityMw) }}</strong></span>
          <span><small>定位精度</small><strong>{{ accuracyLabel[selectedPlant.location.accuracyLevel] }}</strong></span>
        </div>
        <div v-if="selectedWeather" class="float-weather">
          <div class="float-weather-title">
            <span><Cloud :size="14" /> {{ selectedWeather.weatherLabel }}</span>
            <small>{{ formatWeatherTime(selectedWeather.validAt) }}</small>
          </div>
          <div>
            <span><Thermometer :size="13" /> {{ formatWeatherValue(selectedWeather.temperatureC, '°C') }}</span>
            <span><Wind :size="13" /> {{ formatWeatherValue(selectedWeather.windSpeedMs, 'm/s') }}</span>
            <span><Droplets :size="13" /> {{ formatWeatherValue(selectedWeather.relativeHumidityPercent, '%', 0) }}</span>
            <span><Sun :size="13" /> {{ formatWeatherValue(selectedWeather.shortwaveRadiationWm2, 'W/m²', 0) }}</span>
          </div>
        </div>
        <div v-else class="float-weather unavailable"><Cloud :size="14" /> 当前场站天气格点暂不可用</div>
        <div class="node-line"><CircleDotDashed :size="14" /> {{ selectedPlant.nodeRefs[0]?.nodeName || '节点待绑定' }}</div>
        <div class="business-teaser"><Activity :size="14" /><span><b>市场业务属性</b><small>打开详情后按需加载价格、出力与结算</small></span></div>
        <div class="confidence-line" :class="selectedPlant.location.confidence">
          {{ confidenceLabel[selectedPlant.location.confidence] }} · 误差范围约 {{ Math.round(selectedPlant.location.uncertaintyMeters / 1000) }} km
        </div>
        <div class="float-actions">
          <button @click="focusSelected"><Focus :size="14" /> 聚焦</button>
          <button @click="openGovernance('history')"><History :size="14" /> 历史</button>
          <button :disabled="!canWrite" @click="openGovernance('edit')"><Pencil :size="14" /> 编辑</button>
          <button class="primary" @click="detailOpen = true"><Building2 :size="14" /> 完整信息</button>
        </div>
      </article>
    </div>

    <el-drawer v-model="detailOpen" size="580px" append-to-body class="grid-geo-drawer" :with-header="false">
      <div v-if="selectedPlant" class="drawer-content">
        <div class="drawer-hero">
          <span :class="['drawer-icon', `type-${selectedPlant.plantType}`]"><component :is="typeIcon(selectedPlant)" :size="28" /></span>
          <small>PLANT SPACE PROFILE</small>
          <h2>{{ selectedPlant.standardName }}</h2>
          <p>{{ selectedPlant.location.locationLabel }}</p>
          <div class="drawer-hero-actions">
            <button @click="openGovernance('history')"><History :size="14" /> 版本历史</button>
            <button :disabled="!canWrite" @click="openGovernance('edit')"><Pencil :size="14" /> 编辑卡片</button>
          </div>
        </div>

        <section>
          <h4>资产身份</h4>
          <dl>
            <div><dt>电厂 ID</dt><dd>{{ selectedPlant.plantId }}</dd></div>
            <div><dt>类型</dt><dd>{{ typeLabel[selectedPlant.plantType] }}</dd></div>
            <div><dt>装机</dt><dd>{{ formatCapacity(selectedPlant.capacityMw) }}</dd></div>
            <div><dt>所属公司</dt><dd>{{ selectedPlant.ownerCompanyId }}</dd></div>
            <div><dt>资产版本</dt><dd>v{{ selectedPlant.version }}</dd></div>
            <div><dt>来源 / 存储</dt><dd>{{ selectedPlant.dataMeta.sourceType }} / DB</dd></div>
            <div><dt>人工覆盖</dt><dd>{{ selectedPlant.overrideState.hasOverrides ? `${selectedPlant.overrideState.count} 个字段` : '无' }}</dd></div>
          </dl>
        </section>

        <section>
          <h4>位置可信度</h4>
          <dl>
            <div><dt>坐标系</dt><dd>{{ selectedPlant.location.coordinateSystem }}</dd></div>
            <div><dt>精度</dt><dd>{{ accuracyLabel[selectedPlant.location.accuracyLevel] }}</dd></div>
            <div><dt>状态</dt><dd>{{ confidenceLabel[selectedPlant.location.confidence] }}</dd></div>
            <div><dt>参考误差</dt><dd>约 {{ Math.round(selectedPlant.location.uncertaintyMeters / 1000) }} km</dd></div>
          </dl>
          <p class="honesty-note">{{ selectedPlant.dataMeta.note }}</p>
        </section>

        <section>
          <h4>当前天气格点</h4>
          <dl v-if="selectedWeather">
            <div><dt>天气</dt><dd>{{ selectedWeather.weatherLabel }}</dd></div>
            <div><dt>模型高程</dt><dd>{{ formatWeatherValue(selectedWeather.sampledLocation.elevationM, 'm', 0) }}</dd></div>
            <div><dt>温度</dt><dd>{{ formatWeatherValue(selectedWeather.temperatureC, '°C') }}</dd></div>
            <div><dt>湿度</dt><dd>{{ formatWeatherValue(selectedWeather.relativeHumidityPercent, '%', 0) }}</dd></div>
            <div><dt>风速 / 风向</dt><dd>{{ formatWeatherValue(selectedWeather.windSpeedMs, 'm/s') }} · {{ selectedWeather.windDirectionDeg?.toFixed(0) ?? '—' }}°</dd></div>
            <div><dt>降水 / 云量</dt><dd>{{ formatWeatherValue(selectedWeather.precipitationMm, 'mm') }} · {{ formatWeatherValue(selectedWeather.cloudCoverPercent, '%', 0) }}</dd></div>
            <div><dt>短波辐照</dt><dd>{{ formatWeatherValue(selectedWeather.shortwaveRadiationWm2, 'W/m²', 0) }}</dd></div>
            <div><dt>有效时点</dt><dd>{{ formatWeatherTime(selectedWeather.validAt) }}</dd></div>
          </dl>
          <p v-else class="weather-empty">当前没有可用天气值，不以合成值补位。</p>
          <p class="weather-basis">Open-Meteo best_match 数值天气格点 · 口径：真实 · 接口来源 · 非模拟数据 · 不是场站传感器实测。免费端点仅限非商用，生产需配置商业许可。</p>
        </section>

        <section>
          <h4>公开证据</h4>
          <a v-for="source in selectedPlant.location.evidence" :key="source.url" :href="source.url" target="_blank" rel="noreferrer">
            <span><strong>{{ source.title }}</strong><small>{{ source.publisher }} · 检索于 {{ source.accessedAt }}</small></span>
            <ExternalLink :size="15" />
          </a>
          <a v-if="selectedPlant.location.coordinateSource" :href="selectedPlant.location.coordinateSource.url" target="_blank" rel="noreferrer">
            <span><strong>坐标参考点</strong><small>{{ selectedPlant.location.coordinateSource.name }} · {{ selectedPlant.location.coordinateSource.license }}</small></span>
            <ExternalLink :size="15" />
          </a>
          <p v-else class="honesty-note">坐标由受管库人工录入，尚未绑定独立坐标服务来源。</p>
        </section>

        <PlantBusinessAttributes :plant="selectedPlant" />

        <section>
          <h4>集成契约</h4>
          <div class="integration-grid">
            <span>节点价格<small>{{ selectedPlant.integrationRefs.nodePriceFamily }}</small></span>
            <span>机组出力<small>{{ selectedPlant.integrationRefs.outputFamily }}</small></span>
            <span>发电预测<small>{{ selectedPlant.integrationRefs.forecastEndpoint || 'station-generation' }}</small></span>
            <span>结算分析<small>yn_spot_settlement · exact-only</small></span>
          </div>
        </section>
      </div>
    </el-drawer>
    <PlantAssetGovernance
      v-model:open="governanceOpen"
      :plant="selectedPlant"
      :can-write="canWrite"
      :start-mode="governanceMode"
      @saved="onPlantSaved"
    />
  </section>
</template>

<style scoped>
.grid-geo-shell {
  display: flex;
  width: 100%;
  max-width: 100%;
  height: calc(100vh - 100px);
  min-height: 680px;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(86, 173, 221, 0.23);
  border-radius: 18px;
  background: #020811;
  box-shadow: 0 22px 70px rgba(0, 6, 18, 0.38);
}

.grid-geo-shell,
.grid-geo-shell * { box-sizing: border-box; }

.geo-header {
  z-index: 20;
  display: flex;
  min-height: 72px;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 20px;
  color: #e9f8ff;
  border-bottom: 1px solid rgba(104, 193, 235, 0.16);
  background: linear-gradient(90deg, rgba(4, 16, 31, 0.98), rgba(5, 23, 43, 0.93));
}

.header-title { display: flex; align-items: center; gap: 13px; }
.title-orbit { display: grid; width: 42px; height: 42px; place-items: center; border: 1px solid rgba(49, 217, 255, .48); border-radius: 13px; color: #31d9ff; background: rgba(20, 133, 173, .12); box-shadow: inset 0 0 22px rgba(49, 217, 255, .12), 0 0 25px rgba(49, 217, 255, .1); }
.eyebrow { margin-bottom: 2px; color: #58c8e8; font-size: var(--font-9); font-weight: 700; letter-spacing: .22em; }
.geo-header h2 { margin: 0; font-size: var(--font-20); letter-spacing: .04em; }
.header-pills { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.header-pills span { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid rgba(108, 185, 220, .2); border-radius: 999px; color: #a8cad8; background: rgba(9, 38, 58, .55); font-size: var(--font-xs); }
.header-pills .readonly { color: #78eec5; border-color: rgba(85, 225, 176, .25); }
.header-pills .terrain-ready { color: #76e5c0; border-color: rgba(94, 227, 182, .28); }
.header-pills .terrain-loading { color: #7edfff; }
.header-pills .terrain-fallback, .header-pills .terrain-error, .header-pills .weather-warning { color: #efc873; border-color: rgba(239, 193, 95, .28); }

.geo-stage { position: relative; min-width: 0; min-height: 0; flex: 1; overflow: hidden; isolation: isolate; }
/* 暗角：纯装饰。原值把地图四周压到近黑，与「看清地形起伏」直接冲突——
   卫星影像 + 山体阴影的明暗差本来就细，再罩一层暗角等于把刚找回来的立体感抹掉一圈。
   保留氛围但让强度退到不吃画面（不透明度砍半、扩散收窄）。 */
.map-vignette { position: absolute; z-index: 2; inset: 0; pointer-events: none; box-shadow: inset 0 0 92px rgba(0, 5, 16, .34); }
/* 装饰网格：三维下会和地形纹理抢读数，压到几乎只剩氛围。 */
.grid-overlay { position: absolute; z-index: 2; inset: 0; pointer-events: none; opacity: .05; background-image: linear-gradient(rgba(83, 191, 225, .22) 1px, transparent 1px), linear-gradient(90deg, rgba(83, 191, 225, .22) 1px, transparent 1px); background-size: 48px 48px; mask-image: linear-gradient(90deg, #000, transparent 46%); }
.rain-overlay { position: absolute; z-index: 3; inset: -20%; pointer-events: none; opacity: .3; background-image: repeating-linear-gradient(108deg, transparent 0 17px, rgba(127, 201, 255, .42) 18px, transparent 20px 30px); background-size: 120px 160px; mask-image: linear-gradient(90deg, transparent 18%, #000 50%, #000 100%); animation: rain-drift .75s linear infinite; }
@keyframes rain-drift { to { transform: translate3d(-32px, 92px, 0); } }
.glass-panel { border: 1px solid rgba(109, 200, 239, .2); background: linear-gradient(145deg, rgba(5, 23, 40, .88), rgba(3, 14, 28, .72)); box-shadow: 0 18px 44px rgba(0, 7, 18, .38), inset 0 1px rgba(255, 255, 255, .04); backdrop-filter: blur(18px) saturate(1.2); }

.asset-panel { position: absolute; z-index: 6; top: 16px; bottom: 16px; left: 16px; display: flex; width: 296px; padding: 15px; flex-direction: column; border-radius: 16px; color: #dff5ff; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.panel-heading div { display: flex; flex-direction: column; gap: 2px; }
.panel-heading small { color: #4abbdc; font-size: var(--font-8); letter-spacing: .18em; }
.panel-heading strong { font-size: var(--font-xl); }
.panel-heading > span { padding: 4px 8px; border-radius: 999px; color: #7adcf6; background: rgba(42, 178, 218, .1); font-size: var(--font-10); }
.search-box { display: flex; height: 38px; align-items: center; gap: 8px; padding: 0 11px; border: 1px solid rgba(99, 190, 226, .18); border-radius: 10px; color: #68c8e4; background: rgba(4, 16, 31, .7); }
.search-box input { min-width: 0; flex: 1; color: #e7f8ff; border: 0; outline: 0; background: transparent; font-size: var(--font-sm); }
.search-box input::placeholder { color: #5f7e8e; }
.filter-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 9px; }
.filter-row button, .mode-control button, .float-actions button, .stage-state button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 1px solid rgba(112, 187, 218, .16); color: #8db7c9; background: rgba(5, 21, 38, .72); cursor: pointer; }
.filter-row button { height: 31px; border-radius: 8px; font-size: var(--font-xs); }
.filter-row button.active { color: #eafaff; border-color: rgba(48, 212, 255, .5); background: rgba(25, 135, 173, .22); box-shadow: inset 0 0 15px rgba(48, 212, 255, .08); }
.confidence-select { width: 100%; height: 32px; margin: 7px 0 9px; padding: 0 8px; border: 1px solid rgba(112, 187, 218, .16); border-radius: 8px; outline: 0; color: #9bc4d4; background: #081b2d; font-size: var(--font-xs); }

.asset-list { min-height: 0; flex: 1; overflow-y: auto; padding-right: 4px; scrollbar-color: rgba(72, 184, 220, .45) transparent; scrollbar-width: thin; }
.asset-item { display: grid; width: 100%; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 8px; margin-bottom: 5px; padding: 8px; text-align: left; border: 1px solid transparent; border-radius: 10px; color: #d6edf7; background: rgba(8, 28, 45, .54); cursor: pointer; transition: .18s ease; }
.asset-item:hover { transform: translateX(2px); border-color: rgba(91, 193, 226, .2); background: rgba(10, 42, 63, .72); }
.asset-item.active { border-color: rgba(255, 229, 138, .5); background: linear-gradient(90deg, rgba(112, 95, 26, .3), rgba(11, 42, 60, .7)); box-shadow: inset 3px 0 #ffe58a; }
.asset-icon { display: grid; width: 32px; height: 32px; place-items: center; border-radius: 9px; color: #31d9ff; background: rgba(49, 217, 255, .1); }
.asset-item.type-solar .asset-icon { color: #b49aff; background: rgba(164, 126, 255, .12); }
.asset-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.asset-copy strong { overflow: hidden; font-size: var(--font-11-5); text-overflow: ellipsis; white-space: nowrap; }
.asset-copy small { overflow: hidden; color: #6f96a8; font-size: var(--font-9-5); text-overflow: ellipsis; white-space: nowrap; }
.capacity { color: #8db6c7; font-size: var(--font-10); font-variant-numeric: tabular-nums; }
.empty-list { padding: 30px 8px; color: #7293a1; text-align: center; font-size: var(--font-xs); }
.coverage-note { display: flex; align-items: flex-start; gap: 8px; margin-top: 8px; padding: 9px; border-radius: 9px; color: #7ea8b8; background: rgba(25, 86, 107, .17); font-size: var(--font-9-5); line-height: 1.45; }

.hud-stats { position: absolute; z-index: 5; top: 17px; left: 330px; display: flex; gap: 8px; pointer-events: none; }
.hud-stats article { display: grid; min-width: 104px; grid-template-columns: auto auto; align-items: baseline; padding: 8px 11px; border: 1px solid rgba(76, 172, 209, .16); border-radius: 11px; color: #dff7ff; background: rgba(3, 18, 32, .72); box-shadow: 0 12px 30px rgba(0, 8, 18, .26); backdrop-filter: blur(14px); }
.hud-stats span { grid-column: 1 / -1; color: #719caf; font-size: var(--font-8-5); letter-spacing: .08em; }
.hud-stats strong { margin-top: 2px; color: #56ddff; font-size: var(--font-20); font-variant-numeric: tabular-nums; }
.hud-stats small { margin-left: 4px; color: #708f9e; font-size: var(--font-9); }
.hud-stats .solar-stat strong { color: #b89cff; }

.mode-control { position: absolute; z-index: 7; top: 17px; right: 16px; display: flex; padding: 5px; border-radius: 11px; }
.mode-control button { min-width: 47px; height: 31px; padding: 0 8px; border-color: transparent; border-radius: 7px; font-size: var(--font-10); }
.mode-control button:hover { color: #dff8ff; }
.mode-control button.active { color: #02121c; background: linear-gradient(135deg, #63e4ff, #3aaee1); box-shadow: 0 5px 18px rgba(58, 190, 235, .25); }
.control-divider { width: 1px; margin: 5px 3px; background: rgba(115, 190, 219, .16); }
/* 右侧控件纵向堆叠。
   原先地形面板 top:62px、天气面板 top:218px 各自绝对定位，等于给地形面板写死了
   156px 的净空——面板一旦多一行说明或多一个按钮就被天气卡片从下面盖住，而 DOM 里
   按钮还在、点得到，只是看不见。改成流式堆叠后谁高谁占位，以后加内容不会再互相压。 */
.side-stack { position: absolute; z-index: 7; top: 62px; right: 16px; display: flex; width: 268px; max-height: calc(100% - 92px); flex-direction: column; gap: 10px; overflow-y: auto; overscroll-behavior: contain; }
.environment-control { flex: none; }

.weather-control { flex: none; padding: 12px; border-radius: 13px; color: #d8f2fb; }
.weather-head { display: flex; align-items: center; justify-content: space-between; }
.weather-head > div { display: flex; flex-direction: column; gap: 2px; }
.weather-head small { color: #5ebfda; font-size: var(--font-7-5); letter-spacing: .12em; }
.weather-head strong { font-size: var(--font-md); }
.weather-head button { display: grid; width: 28px; height: 28px; place-items: center; color: #75cce4; border: 1px solid rgba(102, 190, 220, .18); border-radius: 8px; background: rgba(7, 29, 46, .66); cursor: pointer; }
.weather-head button.spinning svg { animation: orbit-spin 1s linear infinite; }
.weather-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 10px; }
.weather-tabs button { display: inline-flex; height: 27px; align-items: center; justify-content: center; gap: 4px; color: #7fabbc; border: 1px solid rgba(107, 194, 227, .13); border-radius: 7px; background: rgba(3, 17, 30, .52); font-size: var(--font-8-5); cursor: pointer; }
.weather-tabs button.active { color: #03131c; border-color: transparent; background: linear-gradient(135deg, #7ee8ff, #4fc8e8); box-shadow: 0 6px 18px rgba(61, 193, 229, .2); }
.weather-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 9px; }
.weather-summary span { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 4px; padding: 7px; border-radius: 8px; color: #70d9f1; background: rgba(12, 51, 70, .26); }
.weather-summary b { color: #e6f9ff; font-size: var(--font-10); }
.weather-summary small { grid-column: 1 / -1; color: #668d9e; font-size: var(--font-7-5); }
.weather-control > p { margin: 8px 0 0; color: #7fa9ba; font-size: var(--font-8-5); line-height: 1.35; }
.weather-control > p.error { color: #efae7b; }
.weather-source { display: flex; margin-top: 7px; justify-content: space-between; gap: 6px; color: #587c8c; font-size: var(--font-7); }
.weather-source span:last-child { color: #63bfa2; }
.legend { position: absolute; z-index: 5; right: 16px; bottom: 16px; display: flex; gap: 13px; padding: 9px 12px; border-radius: 10px; color: #8fb3c2; font-size: var(--font-9-5); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; box-shadow: 0 0 10px currentColor; }
.wind-dot { color: #31d9ff; background: #31d9ff; }
.solar-dot { color: #a88cff; background: #a88cff; }
.legend .range-ring { width: 11px; height: 11px; border: 1px solid #7facc0; background: transparent; box-shadow: none; }
.legend .weather-ring { width: 11px; height: 11px; border: 1px solid #ffd45b; background: rgba(255, 212, 91, .18); box-shadow: 0 0 10px rgba(255, 212, 91, .45); }

.stage-state { position: absolute; z-index: 10; top: 50%; left: 50%; display: flex; min-width: 260px; padding: 24px; align-items: center; justify-content: center; gap: 12px; transform: translate(-50%, -50%); border-radius: 14px; color: #ccecf8; }
.loading-orbit { color: #31d9ff; animation: orbit-spin 2.4s linear infinite; }
.error-state { flex-direction: column; text-align: center; }
.error-state span { color: #8fb1bf; font-size: var(--font-xs); }
.stage-state button { padding: 7px 13px; border-radius: 8px; }
@keyframes orbit-spin { to { transform: rotate(360deg); } }

.plant-float-card { position: absolute; z-index: 12; width: 324px; padding: 15px; color: #dff7ff; border: 1px solid rgba(96, 210, 246, .35); border-radius: 15px; background: linear-gradient(145deg, rgba(5, 27, 46, .96), rgba(3, 14, 28, .93)); box-shadow: 0 25px 70px rgba(0, 4, 14, .55), inset 0 1px rgba(255, 255, 255, .05), 0 0 32px rgba(41, 172, 219, .1); backdrop-filter: blur(20px); animation: card-in .2s ease-out; }
.plant-float-card::before { position: absolute; top: -1px; right: 48px; left: 48px; height: 1px; content: ''; background: linear-gradient(90deg, transparent, #5ddfff, transparent); }
@keyframes card-in { from { opacity: 0; transform: translateY(8px) scale(.98); } }
.close-card { position: absolute; top: 9px; right: 9px; display: grid; width: 26px; height: 26px; place-items: center; border: 0; border-radius: 7px; color: #769cad; background: rgba(30, 73, 92, .22); cursor: pointer; }
.float-head { display: flex; align-items: center; gap: 11px; padding-right: 26px; }
.float-icon, .drawer-icon { display: grid; place-items: center; color: #31d9ff; border: 1px solid rgba(49, 217, 255, .24); background: rgba(49, 217, 255, .1); }
.float-icon { width: 42px; height: 42px; border-radius: 12px; }
.float-icon.type-solar, .drawer-icon.type-solar { color: #b69cff; border-color: rgba(182, 156, 255, .24); background: rgba(182, 156, 255, .1); }
.float-head small { color: #6bbbd3; font-size: var(--font-9); letter-spacing: .06em; }
.float-head h3 { margin: 3px 0 0; font-size: var(--font-15); }
.float-location { display: flex; gap: 8px; margin: 13px 0 10px; padding: 9px; border-radius: 9px; color: #5dcde9; background: rgba(28, 97, 122, .12); }
.float-location div { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.float-location strong { overflow: hidden; color: #cdeaf5; font-size: var(--font-10-5); text-overflow: ellipsis; white-space: nowrap; }
.float-location small { color: #6e98a9; font-size: var(--font-8-5); font-variant-numeric: tabular-nums; }
.float-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.float-metrics span { display: flex; padding: 8px; flex-direction: column; gap: 3px; border: 1px solid rgba(103, 181, 212, .12); border-radius: 8px; background: rgba(2, 13, 25, .38); }
.float-metrics small { color: #6d92a2; font-size: var(--font-8-5); }
.float-metrics strong { color: #e5f8ff; font-size: var(--font-xs); }
.float-weather { margin-top: 9px; padding: 9px; border: 1px solid rgba(100, 195, 225, .13); border-radius: 9px; background: linear-gradient(135deg, rgba(19, 76, 96, .18), rgba(4, 19, 31, .46)); }
.float-weather-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; }
.float-weather-title span { display: inline-flex; align-items: center; gap: 5px; color: #7ee6ff; font-size: var(--font-9-5); font-weight: 600; }
.float-weather-title small { color: #668d9f; font-size: var(--font-7-5); }
.float-weather > div:last-child { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.float-weather > div:last-child span { display: inline-flex; align-items: center; gap: 4px; color: #a7c8d4; font-size: var(--font-8-5); }
.float-weather.unavailable { display: flex; align-items: center; gap: 6px; color: #728f9b; font-size: var(--font-8-5); }
.node-line { display: flex; align-items: center; gap: 6px; margin: 9px 0 6px; color: #8eb6c6; font-size: var(--font-9-5); }
.business-teaser { display: flex; margin: 8px 0; padding: 8px; align-items: center; gap: 7px; color: #63dfff; border: 1px solid rgba(77, 194, 229, .14); border-radius: 8px; background: rgba(31, 107, 131, .11); }
.business-teaser span { display: flex; flex-direction: column; gap: 2px; }
.business-teaser b { color: #bcecf7; font-size: var(--font-9); }
.business-teaser small { color: #668d9d; font-size: var(--font-7-5); }
.confidence-line { padding: 6px 8px; border-radius: 7px; color: #83dcbf; background: rgba(51, 170, 132, .09); font-size: var(--font-8-5); }
.confidence-line.probable { color: #e4c272; background: rgba(180, 131, 36, .1); }
.float-actions { display: grid; grid-template-columns: 1fr 1.35fr; gap: 8px; margin-top: 11px; }
.float-actions button { height: 32px; border-radius: 8px; font-size: var(--font-10); }
.float-actions button.primary { color: #02131d; border: 0; background: linear-gradient(135deg, #61e3ff, #3bb4e6); }

.drawer-content { min-height: 100%; padding: 20px; color: var(--text); background: var(--bg); }
.drawer-hero { padding: 24px; border-radius: 16px; color: #e8f9ff; background: radial-gradient(circle at 80% 0, rgba(55, 205, 244, .2), transparent 38%), linear-gradient(145deg, #071b2c, #05111e); }
.drawer-icon { width: 52px; height: 52px; margin-bottom: 14px; border-radius: 15px; }
.drawer-hero small { color: #56c5e5; font-size: var(--font-9); letter-spacing: .16em; }
.drawer-hero h2 { margin: 5px 0; font-size: var(--font-20); }
.drawer-hero p { margin: 0; color: #87aebd; font-size: var(--font-xs); }
.drawer-hero-actions { display: flex; gap: 7px; margin-top: 14px; }
.drawer-hero-actions button { display: inline-flex; align-items: center; gap: 5px; padding: 7px 9px; border: 1px solid rgba(86, 197, 229, .25); border-radius: 8px; color: #bdeaf5; background: rgba(38, 150, 181, .1); cursor: pointer; }
.drawer-hero-actions button:disabled, .float-actions button:disabled { opacity: .4; cursor: not-allowed; }
.drawer-content section { margin-top: 18px; padding: 15px; border: 1px solid var(--line); border-radius: 13px; background: var(--panel); }
.drawer-content h4 { margin: 0 0 11px; font-size: var(--font-md); }
.drawer-content dl { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin: 0; }
.drawer-content dl div { min-width: 0; padding: 8px; border-radius: 8px; background: var(--bg); }
.drawer-content dt { color: var(--muted); font-size: var(--font-9); }
.drawer-content dd { overflow-wrap: anywhere; margin: 3px 0 0; font-size: var(--font-10-5); }
.honesty-note { margin: 10px 0 0; padding: 9px; border-radius: 8px; color: #9a7a29; background: rgba(235, 180, 48, .1); font-size: var(--font-10); line-height: 1.5; }
.weather-empty { color: var(--muted); font-size: var(--font-10); }
.weather-basis { margin: 10px 0 0; padding: 9px; border-radius: 8px; color: #4d8f7a; background: rgba(66, 180, 140, .08); font-size: var(--font-9); line-height: 1.5; }
.drawer-content section > a { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 7px; padding: 9px; text-decoration: none; border: 1px solid var(--line); border-radius: 8px; color: var(--text); }
.drawer-content section > a span { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.drawer-content section > a strong { font-size: var(--font-10-5); }
.drawer-content section > a small { color: var(--muted); font-size: var(--font-8-5); }
.integration-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.integration-grid span { display: flex; padding: 9px; flex-direction: column; gap: 3px; border-radius: 8px; background: var(--bg); font-size: var(--font-10); }
.integration-grid small { overflow: hidden; color: var(--muted); font-size: var(--font-8); text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 1180px) {
  .hud-stats article:nth-child(n + 3) { display: none; }
  .weather-summary, .weather-source { display: none; }
}

@media (max-width: 900px) {
  .grid-geo-shell { height: calc(100dvh - 84px); min-height: 620px; border-radius: 10px; }
  .geo-header { padding: 10px 13px; }
  .header-pills span:not(.readonly) { display: none; }
  .asset-panel { top: auto; right: 12px; bottom: 12px; left: 12px; width: auto; height: 220px; }
  .asset-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
  .asset-item { margin: 0; }
  .coverage-note, .confidence-select { display: none; }
  .hud-stats { top: 12px; left: 12px; }
  .hud-stats article { min-width: 92px; }
  .mode-control { top: 12px; right: 12px; }
  .mode-control button { min-height: 40px; }
  .legend { display: none; }
  .side-stack { top: 68px; right: 12px; width: 230px; max-height: calc(100% - 96px); }
  .environment-control :deep(label), .environment-control :deep(.terrain-hint) { display: none; }
  .weather-control > p { display: none; }
  .geo-stage.has-selection .side-stack { display: none; }
  .plant-float-card {
    top: auto !important;
    right: 12px;
    bottom: 244px;
    left: auto !important;
    width: min(324px, calc(100% - 24px));
    max-height: min(360px, calc(100% - 320px));
    overflow-y: auto;
  }
  .asset-item { min-height: 46px; }
  .weather-tabs button { min-height: 36px; }
}

@media (max-width: 620px) {
  .grid-geo-shell { height: calc(100dvh - 66px); min-height: 600px; border-radius: 8px; }
  .geo-header { min-height: 58px; padding: 8px 10px; }
  .geo-header h2 { font-size: var(--font-15); }
  .title-orbit { width: 36px; height: 36px; }
  .header-pills { display: none; }
  .hud-stats { display: none; }
  .mode-control { top: 8px; right: 8px; }
  .mode-control button { min-width: 42px; height: 40px; padding: 0 6px; }
  .side-stack { top: 58px; right: 8px; left: 8px; width: auto; max-height: calc(100% - 74px); }
  .environment-control { display: none; }
  .weather-control { padding: 9px; }
  .weather-head small { display: none; }
  .weather-tabs { margin-top: 7px; }
  .geo-stage.has-selection .weather-control { display: none; }
  .plant-float-card {
    top: 64px !important;
    right: 8px;
    bottom: 190px;
    left: 8px !important;
    width: auto;
    max-height: none;
    overflow-y: auto;
    padding: 12px;
  }
  .float-weather > div:last-child { display: none; }
  .float-weather-title { margin-bottom: 0; }
  .business-teaser { display: none; }
  .float-location { margin: 9px 0 7px; }
  .float-actions button { min-height: 40px; }
  .asset-list { grid-template-columns: 1fr; }
  .asset-panel { right: 8px; bottom: 8px; left: 8px; height: 174px; padding: 10px; }
  .panel-heading, .filter-row { margin-bottom: 7px; }
  .search-box { display: none; }
  .filter-row button { min-height: 36px; }
}

@media (max-width: 420px) {
  .mode-control button { min-width: 39px; padding: 0 4px; }
  .control-divider { margin-inline: 1px; }
  .weather-tabs button { min-height: 38px; font-size: var(--font-9); }
  .float-head h3 { font-size: var(--font-lg); }
  .float-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
