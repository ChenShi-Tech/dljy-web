<script setup lang="ts">
import { computed, defineAsyncComponent, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Component, nextTick} from 'vue'
import { routerKey } from 'vue-router'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CloudRain,
  Database,
  FileSearch,
  Gauge,
  GitBranch,
  Layers3,
  MapPinned,
  Network,
  Orbit,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Waypoints,
  Wind,
  X,
  Zap,
} from 'lucide-vue-next'
import { onRegionChange } from '@/composables/useRegionReload'
import { currentCompany, selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import ProvinceFlatMap from './ProvinceFlatMap.vue'
import PlantCatalogPanel from './PlantCatalogPanel.vue'
import PlantDetailDrawer from './PlantDetailDrawer.vue'
import PlantAssetGovernance from './PlantAssetGovernance.vue'
import { clampCardOffset, drawerAvoidanceShift } from './draggableCard'
import TerrainControlPanel from './TerrainControlPanel.vue'
import { useGridGeoViewPreference } from './useViewPreference'
// Cesium 约 4 MiB；切到 2D 时用不到，按需拉取。
const CesiumPlantMap = defineAsyncComponent(() => import('./CesiumPlantMap.vue'))
import {
  fetchGridDisclosureEvents,
  fetchGridGeoNodes,
  fetchGridGeoManifest,
  fetchGridGeoPlants,
  fetchGridGeoWeather,
  fetchGridOperatorProfile,
  fetchGridTopologyManifest,
  fetchGridTopologySnapshotPage,
} from './client'
import TopologyFeatureCard from './topology/TopologyFeatureCard.vue'
import TopologyLayerStatus from './topology/TopologyLayerStatus.vue'
import {
  createTopologyViewportLoader,
  type TopologyTransportMeta,
  type TopologyViewportQuery,
} from './topology/topologyViewportLoader'
import { topologyFeatureLabel } from './topology/topologyStyle'
import { loadGridMarketSpatialSnapshot, type GridMarketSpatialSnapshot } from './marketSpatial'
import {
  GRID_MARKET_LAYER_OPTIONS,
  gridMarketLayerOption,
  gridMarketTone,
  gridMarketValueText,
  rankGridMarketMetrics,
} from './marketSpatialLayers'
import {
  COMMAND_MARKET_REPLAY_DATE,
  COMMAND_NODE_PAGE_SIZE,
  commandNodesFromResponse,
  commandWeatherItems,
  disclosureCategoryLabel,
  trustedMarketMetrics,
  type SpatialCommandScene,
  type SpatialLayerState,
} from './spatialCommand'
import type {
  GridDisclosureEvent,
  GridGeoMapSelection,
  GridGeoNode,
  GridGeoPlant,
  GridGeoRuntimeStatus,
  GridGeoTerrainStatus,
  GridGeoViewMode,
  GridGeoWeatherLayer,
  GridGeoWeatherResponse,
  GridGeoWeatherSnapshot,
  GridMarketLayer,
  GridMarketMetric,
  GridOperatorProfile,
  GridTopologyFeature,
  GridTopologyManifest,
} from './types'

type MapExpose = { focusPlant: (plantId: string) => void; focusNode: (nodeId: string) => void; resetView: () => void; flyTerrainTour?: () => void }

const appRouter = inject(routerKey, null)
const mapRef = ref<MapExpose | null>(null)
const baseLoading = ref(true)
const baseError = ref('')
const plants = shallowRef<GridGeoPlant[]>([])
const nodes = shallowRef<GridGeoNode[]>([])
const nodeTotal = ref(0)
const nodeTruncated = ref(false)
const nodeExcludedInvalid = ref(0)
const weatherItems = shallowRef<GridGeoWeatherSnapshot[]>([])
const weatherResponse = shallowRef<GridGeoWeatherResponse | null>(null)
const marketSnapshot = shallowRef<GridMarketSpatialSnapshot | null>(null)
const disclosures = shallowRef<GridDisclosureEvent[]>([])
const disclosureTotal = ref(0)
const topology = shallowRef<GridTopologyManifest | null>(null)
const topologySourceType = ref<'CONFIG' | 'DB' | 'IMPORT'>('CONFIG')
const topologyFeatures = shallowRef<GridTopologyFeature[]>([])
const topologyTotal = ref(0)
const topologyLod = ref<0 | 1 | 2>(0)
const topologyTruncated = ref(false)
const topologyTransport = shallowRef<TopologyTransportMeta | null>(null)
const operatorProfile = shallowRef<GridOperatorProfile | null>(null)
const plantSource = ref({ sourceType: 'DB', mock: false, productionWrite: false })
const scene = ref<SpatialCommandScene>('overview')
// 首次进入落三维地形（山川河流是这页的信息量所在），之后记住用户上次选的模式；
// 平面省图仍是一等公民，只是不再无条件顶掉三维。
const { viewMode, terrainProvider, hillshadeEnabled, verticalExaggeration } =
  useGridGeoViewPreference('command', { verticalExaggeration: 1.3 })
const topologyViewNotice = ref('')
const weatherLayer = ref<GridGeoWeatherLayer>('wind')
// 「电厂地理空间」并入后新增的一组状态：目录筛选结果、完整信息抽屉、治理弹窗与写权限。
// catalogFiltered 单独存一份而不是直接用 plants，是因为地图上要绘制的点必须与目录里
// 列出的一致——否则会出现「列表里搜到了、图上找不到」。
// 选中卡片的拖动与让位。锚点取自实际 CSS 而非写死值：窄屏断点会改 .selection-card 的
// right/bottom，用桌面端数值算钳制范围会把卡片允许拖到不可见处。computed style 读到的
// 是声明值（不含 transform），正是我们要的「默认位置」。常量只作为读不到时的兜底。
const SELECTION_CARD_RIGHT_FALLBACK = 382
const SELECTION_CARD_BOTTOM_FALLBACK = 58
const DETAIL_DRAWER_WIDTH = 580

function selectionCardAnchors(element: HTMLElement | null) {
  if (!element) return { right: SELECTION_CARD_RIGHT_FALLBACK, bottom: SELECTION_CARD_BOTTOM_FALLBACK }
  const style = getComputedStyle(element)
  const right = Number.parseFloat(style.right)
  const bottom = Number.parseFloat(style.bottom)
  return {
    right: Number.isFinite(right) ? right : SELECTION_CARD_RIGHT_FALLBACK,
    bottom: Number.isFinite(bottom) ? bottom : SELECTION_CARD_BOTTOM_FALLBACK,
  }
}

const stageRef = ref<HTMLElement | null>(null)
const selectionCardRef = ref<HTMLElement | null>(null)
const cardOffset = ref({ x: 0, y: 0 })
let cardDragStart: { pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null = null

const catalogFiltered = ref<GridGeoPlant[]>([])
const detailOpen = ref(false)
const governanceOpen = ref(false)
const governanceMode = ref<'edit' | 'history'>('edit')
const canWrite = ref(false)
const catalogStats = ref<{ locatedPlantCount: number; totalPlantCountInCurrentDim: number; unresolvedPlantCount: number | null } | null>(null)

const marketLayer = ref<GridMarketLayer>('risk')
const marketDate = ref(COMMAND_MARKET_REPLAY_DATE)
const selectedPlantId = ref<string | null>(null)
const selectedNodeId = ref<string | null>(null)
const selectedEventId = ref<string | null>(null)
const selectedTopologyFeatureId = ref<string | null>(null)
/**
 * 平面图当前下钻到的地市州（#1424）；3D 无地州下钻，切到 Cesium 时由 watch 清空。
 * 范围内的 id 集合由地图给出，边界几何只在地图侧，宿主不自行判定归属。
 */
const focusedSubdivision = ref<{
  adcode: string
  name: string
  plantIds: string[]
  nodeIds: string[]
  topologyFeatureIds: string[]
} | null>(null)
const dockOpen = ref(true)
const terrainStatus = ref<GridGeoTerrainStatus>({ kind: 'arcgis-terrain', status: 'loading', label: '正在加载真实地形' })
// 晕渲图层与 ArcGIS 影像同域，该域对部分出口 IP 整体 403；失败必须让面板可见。
const hillshadeAvailable = ref<boolean | null>(null)
const runtimeStatus = ref<GridGeoRuntimeStatus | null>(null)
const layerStates = ref<Record<SpatialCommandScene, SpatialLayerState>>(initialLayerStates())
let scopeRequestId = 0
let layerRequestId = 0
let baseController: AbortController | null = null
let layerController: AbortController | null = null
let compactViewport: MediaQueryList | null = null
const topologyLoader = createTopologyViewportLoader(fetchGridTopologySnapshotPage)
let lastTopologyViewport: TopologyViewportQuery = { lod: 0, limit: 900 }
let loadedTopologyQueryKey = ''

const sceneOptions: Array<{ id: SpatialCommandScene; label: string; short: string; icon: Component }> = [
  { id: 'overview', label: '空间总览', short: '电厂资产底图', icon: Orbit },
  { id: 'nodes', label: '已定位节点', short: '仅 WGS84 权威点位', icon: Waypoints },
  { id: 'weather', label: '实时天气', short: 'Open-Meteo 格点实况', icon: CloudRain },
  { id: 'market', label: '市场回放', short: '精确映射并列信号', icon: Radar },
  { id: 'disclosure', label: '披露时间轴', short: '无坐标不落点', icon: FileSearch },
  { id: 'topology', label: '授权网架', short: 'Provider 准备度', icon: GitBranch },
]

const weatherOptions: Array<{ value: GridGeoWeatherLayer; label: string; icon: Component }> = [
  { value: 'wind', label: '风场', icon: Wind },
  { value: 'temperature', label: '温度', icon: Thermometer },
  { value: 'precipitation', label: '降水', icon: CloudRain },
  { value: 'irradiance', label: '辐照', icon: Sparkles },
  { value: 'cloud', label: '云层', icon: Layers3 },
]

const profileStyle = computed(() => operatorProfile.value ? {
  '--command-accent': operatorProfile.value.visual.accent,
  '--command-secondary': operatorProfile.value.visual.secondary,
  '--command-surface': operatorProfile.value.visual.surface,
} : {})
const currentScene = computed(() => sceneOptions.find((item) => item.id === scene.value) ?? sceneOptions[0])
const selectedPlant = computed(() => plants.value.find((item) => item.plantId === selectedPlantId.value) ?? null)
const selectedNode = computed(() => nodes.value.find((item) => item.nodeId === selectedNodeId.value) ?? null)
const selectedEvent = computed(() => disclosures.value.find((item) => item.eventId === selectedEventId.value) ?? null)
const selectedTopologyFeature = computed(() => topologyFeatures.value.find((item) => item.featureId === selectedTopologyFeatureId.value) ?? null)
const selectedWeather = computed(() => weatherItems.value.find((item) => item.plantId === selectedPlantId.value) ?? null)
const trustedMetrics = computed(() => trustedMarketMetrics(marketSnapshot.value))
const selectedMarket = computed(() => trustedMetrics.value.find((item) => item.plantId === selectedPlantId.value) ?? null)
const visibleWeatherItems = computed(() => scene.value === 'weather' ? commandWeatherItems(weatherItems.value, weatherLayer.value) : [])
const visibleMarketMetrics = computed(() => scene.value === 'market' ? trustedMetrics.value : [])
const visibleNodes = computed(() => scene.value === 'nodes' ? nodes.value : [])
const topologyReady = computed(() => topology.value?.readiness.filter((item) => item.status === 'ready').length ?? 0)
const topologyRequired = computed(() => topology.value?.readiness.length ?? 0)
// 下钻范围：地图给出 id 集合，侧栏的键盘等价清单按同一子集收窄
// 不这样做的话，地图上只剩某地州的点，而侧栏仍列全省，键盘用户等于没有下钻能力。
const scopedPlants = computed(() => {
  const scope = focusedSubdivision.value
  if (!scope) return plants.value
  const allowed = new Set(scope.plantIds)
  return plants.value.filter((plant) => allowed.has(plant.plantId))
})
const scopedNodes = computed(() => {
  const scope = focusedSubdivision.value
  if (!scope) return nodes.value
  const allowed = new Set(scope.nodeIds)
  return nodes.value.filter((node) => allowed.has(node.nodeId))
})
const scopedTopologyFeatures = computed(() => {
  const scope = focusedSubdivision.value
  if (!scope) return topologyFeatures.value
  const allowed = new Set(scope.topologyFeatureIds)
  return topologyFeatures.value.filter((feature) => allowed.has(feature.featureId))
})
/** 下钻态里的断面/联络线/线路条数，地州视图最想看的就是这个。 */
const scopedChannelCount = computed(() =>
  scopedTopologyFeatures.value.filter((feature) => ['section', 'intertie', 'branch'].includes(feature.kind)).length,
)
const topologyKeyboardFeatures = computed(() => scopedTopologyFeatures.value.slice(0, 120))
const locatedPlantCapacity = computed(() => scopedPlants.value.reduce((sum, plant) => sum + (Number(plant.capacityMw) || 0), 0))
const activeLayerState = computed(() => layerStates.value[scene.value])
const stageLoading = computed(() => baseLoading.value || activeLayerState.value.status === 'loading')
const activeSourceSummary = computed(() => {
  if (scene.value === 'overview') return `${plantSource.value.sourceType} · mock=${plantSource.value.mock} · productionWrite=${plantSource.value.productionWrite}`
  if (scene.value === 'nodes') return layerSettled('nodes') ? 'DB · 非模拟数据 · 不写生产' : '节点 DB · 等待按需加载'
  if (scene.value === 'weather') return weatherResponse.value
    ? `${weatherResponse.value.sourceType} · ${weatherResponse.value.provider?.name ?? 'Open-Meteo'} · mock=${weatherResponse.value.mock} · productionWrite=${weatherResponse.value.productionWrite}`
    : '天气 API · 等待按需加载'
  if (scene.value === 'market') return marketSnapshot.value
    ? `节点价 ${marketSnapshot.value.sources.nodePrice.sourceType}/${marketSnapshot.value.sources.nodePrice.status} · 出力 ${marketSnapshot.value.sources.output.sourceType || '未连接'}/${marketSnapshot.value.sources.output.status} · mock=${marketSnapshot.value.sources.nodePrice.mock || marketSnapshot.value.sources.output.mock}`
    : '市场时序 · 等待按需加载'
  if (scene.value === 'disclosure') return disclosures.value.length
    ? `${disclosures.value[0].source.sourceType} · 非模拟数据 · 不写生产`
    : '披露导入层 · 等待或当前为空'
  return topologyTransport.value
    ? `${topologySourceType.value} · ${topology.value?.topologyVersion ?? '版本缺失'} · ${topologyFeatures.value.length}/${topologyTotal.value} · 预算：${topologyTransport.value.budgetStatus ?? '—'} · 非模拟数据`
    : `${topologySourceType.value} · 非模拟数据 · 不写生产 · snapshot 未请求`
})
const marketRank = computed(() =>
  rankGridMarketMetrics(visibleMarketMetrics.value, marketLayer.value, focusedSubdivision.value?.plantIds))
/** 当前图层的口径说明。指标名（「综合关注」）本身不解释它是怎么算的。 */
const marketLayerHint = computed(() => gridMarketLayerOption(marketLayer.value)?.description ?? '')
const disclosureCategoryCounts = computed(() => disclosures.value.reduce<Record<string, number>>((counts, event) => {
  counts[event.category] = (counts[event.category] ?? 0) + 1
  return counts
}, {}))
const mapLabel = computed(() => {
  const drill = focusedSubdivision.value ? `已下钻到${focusedSubdivision.value.name}，仅含该范围内的要素；` : ''
  const topologyPart = scene.value === 'topology' && scopedTopologyFeatures.value.length
    ? `当前绘制 ${scopedTopologyFeatures.value.length} 个授权网架要素`
    : '当前未绘制任何推测网架连线'
  return `${currentRegion.value.name}${currentScene.value.label}地图。${drill}仅绘制有权威 WGS84 坐标的资产；${topologyPart}。`
})
const selectionAnnouncement = computed(() => selectedPlant.value
  ? `已选择电厂 ${selectedPlant.value.standardName}`
  : selectedNode.value
    ? `已选择节点 ${selectedNode.value.nodeName}`
    : selectedTopologyFeature.value
      ? `已选择网架要素 ${selectedTopologyFeature.value.name}`
      : selectedEvent.value
      ? `已选择披露事件 ${selectedEvent.value.title}`
      : '当前未选择空间对象')

function initialLayerStates(): Record<SpatialCommandScene, SpatialLayerState> {
  return {
    overview: { status: 'idle', reason: '等待加载授权空间资产' },
    nodes: { status: 'idle', reason: '按需加载已定位节点' },
    weather: { status: 'idle', reason: '按需加载当前格点天气' },
    market: { status: 'idle', reason: '按需加载 2026-05-01 历史回放' },
    disclosure: { status: 'idle', reason: '按需加载公开披露时间轴' },
    topology: { status: 'idle', reason: '等待读取授权 Provider 状态' },
  }
}

function setLayerState(id: SpatialCommandScene, state: SpatialLayerState) {
  layerStates.value = { ...layerStates.value, [id]: state }
}

/** 抽屉一开就把卡片让开，否则用户刚点的那个电厂正好被抽屉压住。 */
const cardAvoidShift = computed(() => drawerAvoidanceShift(
  detailOpen.value,
  DETAIL_DRAWER_WIDTH,
  // 依赖 cardAnchorRight 而非常量：窄屏下卡片本就更靠右/更靠边，让位量随之不同
  cardAnchorRight.value,
))
/** 卡片当前的 CSS 锚点。窗口尺寸变化会跨断点改写它，故随 resize 重算。 */
const cardAnchorRight = ref(SELECTION_CARD_RIGHT_FALLBACK)

const selectionCardStyle = computed(() => ({
  transform: `translate(${-(cardOffset.value.x + cardAvoidShift.value)}px, ${-cardOffset.value.y}px)`,
}))

function onCardPointerDown(event: PointerEvent) {
  // 卡片里的按钮和链接要能正常点，不能被拖动吞掉
  if ((event.target as HTMLElement | null)?.closest('button, a, input, select')) return
  cardDragStart = { pointerX: event.clientX, pointerY: event.clientY, offsetX: cardOffset.value.x, offsetY: cardOffset.value.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onCardPointerMove(event: PointerEvent) {
  if (!cardDragStart) return
  const stage = stageRef.value?.getBoundingClientRect()
  const card = selectionCardRef.value?.getBoundingClientRect()
  if (!stage || !card) return
  const anchors = selectionCardAnchors(selectionCardRef.value)
  cardOffset.value = clampCardOffset(
    {
      // 向左/向上为正，与 CSS 的右下角锚定一致
      x: cardDragStart.offsetX + (cardDragStart.pointerX - event.clientX),
      y: cardDragStart.offsetY + (cardDragStart.pointerY - event.clientY),
    },
    { width: card.width, height: card.height },
    { width: stage.width, height: stage.height },
    anchors.right,
    anchors.bottom,
  )
}

function onCardPointerUp(event: PointerEvent) {
  if (!cardDragStart) return
  cardDragStart = null
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
}

function onPlantSaved(plant: GridGeoPlant) {
  plants.value = plants.value.map((item) => item.plantId === plant.plantId ? plant : item)
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

// 取值、格式化与分档口径统一在 `marketSpatialLayers.ts`——原先驾驶舱与「电力市场空间
// 态势」页各写一份，同一个电厂在两处可能显示成不同的档位颜色。
function marketValueText(metric: GridMarketMetric | null) {
  return gridMarketValueText(metric, marketLayer.value)
}

function marketTone(metric: GridMarketMetric) {
  return gridMarketTone(metric, marketLayer.value)
}

function weatherValue(item: GridGeoWeatherSnapshot | null) {
  if (!item) return '缺测'
  if (weatherLayer.value === 'wind') return Number.isFinite(item.windSpeedMs) ? `${Number(item.windSpeedMs).toFixed(1)} m/s` : '缺测'
  if (weatherLayer.value === 'temperature') return Number.isFinite(item.temperatureC) ? `${Number(item.temperatureC).toFixed(1)} °C` : '缺测'
  if (weatherLayer.value === 'precipitation') return Number.isFinite(item.precipitationMm) ? `${Number(item.precipitationMm).toFixed(1)} mm` : '缺测'
  if (weatherLayer.value === 'irradiance') return Number.isFinite(item.shortwaveRadiationWm2) ? `${Math.round(Number(item.shortwaveRadiationWm2))} W/m²` : '缺测'
  return Number.isFinite(item.cloudCoverPercent) ? `${Math.round(Number(item.cloudCoverPercent))}%` : '缺测'
}

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return '时间缺失'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', withTime
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
    : { year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed)
}

function clearSelection() {
  selectedPlantId.value = null
  selectedNodeId.value = null
  selectedEventId.value = null
  selectedTopologyFeatureId.value = null
}

function clearScopeData() {
  baseController?.abort()
  layerController?.abort()
  baseController = null
  layerController = null
  plants.value = []
  nodes.value = []
  nodeTotal.value = 0
  nodeTruncated.value = false
  nodeExcludedInvalid.value = 0
  weatherItems.value = []
  weatherResponse.value = null
  marketSnapshot.value = null
  disclosures.value = []
  disclosureTotal.value = 0
  topology.value = null
  topologyLoader.cancel()
  topologyFeatures.value = []
  topologyTotal.value = 0
  topologyLod.value = 0
  topologyTruncated.value = false
  topologyTransport.value = null
  loadedTopologyQueryKey = ''
  topologySourceType.value = 'CONFIG'
  operatorProfile.value = null
  layerStates.value = initialLayerStates()
  // 换公司/地区后旧地州的 id 集合会把新范围全筛空；地图那侧也会自行复位下钻态。
  focusedSubdivision.value = null
  clearSelection()
}

async function loadBase() {
  const requestId = ++scopeRequestId
  baseController?.abort()
  baseController = new AbortController()
  baseLoading.value = true
  baseError.value = ''
  if (!selectedCompanyId.value) {
    clearScopeData()
    baseLoading.value = false
    baseError.value = '当前地区尚未选择授权公司；驾驶舱已保持空态。'
    return
  }
  setLayerState('overview', { status: 'loading', reason: '正在读取公司空间资产' })
  setLayerState('topology', { status: 'loading', reason: '正在读取 Provider 清单，不请求 snapshot' })
  const signal = baseController.signal
  const [profileResult, plantResult, topologyResult, manifestResult] = await Promise.allSettled([
    fetchGridOperatorProfile(currentRegion.value.id, { signal }),
    fetchGridGeoPlants({ signal }),
    fetchGridTopologyManifest({ signal }),
    // 目录的「已上屏 / 总数」与「编辑」按钮的可用性都来自 manifest；拿不到就退化成
    // 只读 + 用实际加载数当分母，不阻塞主图层。
    fetchGridGeoManifest({ signal }),
  ])
  if (requestId !== scopeRequestId || signal.aborted) return

  if (profileResult.status === 'fulfilled') operatorProfile.value = profileResult.value
  if (plantResult.status === 'fulfilled') {
    const response = plantResult.value
    if ((response as { mock?: boolean }).mock === true) {
      plants.value = []
      setLayerState('overview', { status: 'error', reason: 'Mock 空间资产被驾驶舱拒绝' })
      baseError.value = '空间资产返回了不允许进入驾驶舱的 Mock 数据。'
    } else {
      plants.value = response.data?.items ?? []
      catalogStats.value = response.data?.catalog ?? null
      plantSource.value = { sourceType: response.sourceType ?? 'DB', mock: Boolean(response.mock), productionWrite: Boolean(response.productionWrite) }
      setLayerState('overview', {
        status: plants.value.length ? 'available' : 'empty',
        reason: plants.value.length ? `已加载 ${plants.value.length} 个授权电厂位置` : '当前公司/地区没有可绘制电厂位置',
      })
    }
  } else if (!isAbort(plantResult.reason)) {
    plants.value = []
    setLayerState('overview', { status: 'error', reason: plantResult.reason instanceof Error ? plantResult.reason.message : '空间资产加载失败' })
    baseError.value = '空间资产主图层加载失败；其他受控图层仍可按需尝试。'
  }

  // 写权限来自 manifest，目录统计来自电厂接口自身的 catalog 字段——两者不同源。
  if (manifestResult.status === 'fulfilled') {
    canWrite.value = Boolean(manifestResult.value?.capabilities.canWrite)
  } else if (!isAbort(manifestResult.reason)) {
    canWrite.value = false
  }

  if (topologyResult.status === 'fulfilled') {
    topology.value = topologyResult.value.data
    topologySourceType.value = topologyResult.value.sourceType
    const status = topology.value.dataAvailability.status
    setLayerState('topology', {
      status: status === 'available' ? 'available' : status === 'degraded' ? 'degraded' : status === 'not-configured' ? 'not-configured' : status === 'missing' ? 'empty' : 'error',
      reason: topology.value.dataAvailability.reason,
      updatedAt: topology.value.updatedAt,
    })
  } else if (!isAbort(topologyResult.reason)) {
    setLayerState('topology', { status: 'error', reason: topologyResult.reason instanceof Error ? topologyResult.reason.message : 'Provider 状态读取失败' })
  }
  baseLoading.value = false
}

function beginLayerRequest(id: SpatialCommandScene) {
  layerController?.abort()
  layerController = new AbortController()
  const requestId = ++layerRequestId
  setLayerState(id, { status: 'loading', reason: `正在加载${sceneOptions.find((item) => item.id === id)?.label ?? '图层'}` })
  return { requestId, signal: layerController.signal, scopeId: scopeRequestId }
}

function layerRequestCurrent(requestId: number, scopeId: number, signal?: AbortSignal) {
  return requestId === layerRequestId && scopeId === scopeRequestId && !signal?.aborted
}

async function loadNodes(force = false) {
  if (!force && ['available', 'empty'].includes(layerStates.value.nodes.status)) return
  const request = beginLayerRequest('nodes')
  try {
    const response = await fetchGridGeoNodes({ locationStatus: 'located', page: 1, pageSize: COMMAND_NODE_PAGE_SIZE }, { signal: request.signal })
    if (!layerRequestCurrent(request.requestId, request.scopeId, request.signal)) return
    const result = commandNodesFromResponse(response)
    nodes.value = result.mock ? [] : result.nodes
    nodeTotal.value = result.total
    nodeTruncated.value = result.truncatedByPage
    nodeExcludedInvalid.value = result.excludedInvalidCoordinates
    setLayerState('nodes', {
      status: nodes.value.length ? 'available' : 'empty',
      reason: result.mock
        ? 'Mock 节点被驾驶舱拒绝'
        : nodes.value.length
          ? `绘制 ${nodes.value.length}/${result.total} 个权威 WGS84 节点${result.truncatedByPage ? '（分页性能预算截断）' : ''}${result.excludedInvalidCoordinates ? `；剔除 ${result.excludedInvalidCoordinates} 个无效坐标` : ''}`
          : '当前范围没有已定位节点；未定位身份不会生成坐标',
    })
  } catch (cause) {
    if (!isAbort(cause) && layerRequestCurrent(request.requestId, request.scopeId)) setLayerState('nodes', { status: 'error', reason: cause instanceof Error ? cause.message : '节点加载失败' })
  }
}

async function loadWeather(force = false) {
  if (!force && ['available', 'degraded', 'empty'].includes(layerStates.value.weather.status)) return
  const request = beginLayerRequest('weather')
  try {
    const response = await fetchGridGeoWeather(undefined, { signal: request.signal })
    if (!layerRequestCurrent(request.requestId, request.scopeId, request.signal)) return
    weatherResponse.value = response
    weatherItems.value = (response as { mock?: boolean }).mock === true ? [] : response.data.items
    const availability = response.data.dataAvailability
    const degraded = availability.status === 'stale' || availability.fallback
    setLayerState('weather', {
      status: degraded ? 'degraded' : weatherItems.value.length ? 'available' : 'empty',
      reason: (response as { mock?: boolean }).mock === true
        ? 'Mock 天气被驾驶舱拒绝'
        : availability.reason || (degraded ? '天气缓存已标记过期/降级' : `已加载 ${weatherItems.value.length} 个当前格点`),
      updatedAt: response.data.fetchedAt,
    })
  } catch (cause) {
    if (!isAbort(cause) && layerRequestCurrent(request.requestId, request.scopeId)) setLayerState('weather', { status: 'error', reason: cause instanceof Error ? cause.message : '天气图层加载失败' })
  }
}

async function loadMarket(force = false) {
  if (currentRegion.value.id !== 'yunnan') {
    marketSnapshot.value = null
    setLayerState('market', { status: 'not-configured', reason: '当前复合市场回放只登记云南 exact-only 数据链；未跨地区回退' })
    return
  }
  if (!force && ['available', 'degraded', 'empty'].includes(layerStates.value.market.status)) return
  const request = beginLayerRequest('market')
  try {
    const snapshot = await loadGridMarketSpatialSnapshot(plants.value, marketDate.value, {
      companyId: selectedCompanyId.value,
      regionId: currentRegion.value.id,
    })
    if (!layerRequestCurrent(request.requestId, request.scopeId)) return
    marketSnapshot.value = snapshot
    const metrics = trustedMarketMetrics(snapshot)
    const degraded = snapshot.sources.nodePrice.status === 'error' || ['error', 'not-configured'].includes(snapshot.sources.output.status)
    setLayerState('market', {
      status: degraded ? 'degraded' : metrics.some((item) => item.riskScore !== null) ? 'available' : 'empty',
      reason: snapshot.sources.nodePrice.mock || snapshot.sources.output.mock
        ? 'Mock 市场来源已从地图指标中剔除'
        : degraded
          ? snapshot.sources.output.reason ?? '部分市场来源失败；仅展示仍有证据的独立指标'
          : `历史回放 ${snapshot.date} · ${snapshot.summary.riskPlants} 个双信号资产`,
      updatedAt: snapshot.date,
    })
  } catch (cause) {
    if (!isAbort(cause) && layerRequestCurrent(request.requestId, request.scopeId)) setLayerState('market', { status: 'error', reason: cause instanceof Error ? cause.message : '市场回放加载失败' })
  }
}

async function loadDisclosures(force = false) {
  if (!force && ['available', 'empty', 'not-configured'].includes(layerStates.value.disclosure.status)) return
  const request = beginLayerRequest('disclosure')
  try {
    const response = await fetchGridDisclosureEvents({ page: 1, pageSize: 24 }, { signal: request.signal })
    if (!layerRequestCurrent(request.requestId, request.scopeId, request.signal)) return
    disclosures.value = response.items.filter((item) => item.source.mock === false)
    disclosureTotal.value = response.total
    const notConfigured = response.dataAvailability.status === 'not-configured'
    setLayerState('disclosure', {
      status: notConfigured ? 'not-configured' : disclosures.value.length ? 'available' : 'empty',
      reason: notConfigured ? response.dataAvailability.reason : disclosures.value.length ? `已加载 ${disclosures.value.length}/${response.total} 条证据级事件；仅进入地区/时间轴` : response.dataAvailability.reason,
    })
  } catch (cause) {
    if (!isAbort(cause) && layerRequestCurrent(request.requestId, request.scopeId)) setLayerState('disclosure', { status: 'error', reason: cause instanceof Error ? cause.message : '披露时间轴加载失败' })
  }
}

async function loadTopology(viewport = lastTopologyViewport, force = false) {
  lastTopologyViewport = viewport
  if (topology.value?.dataAvailability.status !== 'available') {
    topologyLoader.cancel()
    topologyFeatures.value = []
    topologyTotal.value = 0
    topologyTransport.value = null
    loadedTopologyQueryKey = ''
    return
  }
  const scopeKey = [selectedCompanyId.value, currentRegion.value.id, topology.value.gridOperator, topology.value.topologyVersion].join(':')
  const queryKey = `${scopeKey}:${viewport.bounds ?? 'all'}:${viewport.lod}:${viewport.limit}`
  if (!force && loadedTopologyQueryKey === queryKey) return
  setLayerState('topology', { status: 'loading', reason: '正在按当前视口读取授权 Provider 快照' })
  try {
    const weakNetwork = runtimeStatus.value?.network === 'weak'
    const result = await topologyLoader.load(
      { ...viewport, limit: weakNetwork ? Math.min(viewport.limit, 700) : viewport.limit },
      scopeKey,
      { maxPages: weakNetwork ? 1 : viewport.lod === 0 ? 1 : 2 },
    )
    if (!result) return
    if ((result.response as { mock?: boolean }).mock === true) throw new Error('Mock 网架快照被驾驶舱拒绝')
    const snapshot = result.response.data
    topology.value = snapshot
    topologySourceType.value = result.response.sourceType
    topologyFeatures.value = result.features
    topologyTotal.value = result.total
    topologyLod.value = viewport.lod
    topologyTruncated.value = result.truncated
    topologyTransport.value = result.transport
    loadedTopologyQueryKey = queryKey
    if (selectedTopologyFeatureId.value && !result.features.some((item) => item.featureId === selectedTopologyFeatureId.value)) {
      selectedTopologyFeatureId.value = null
    }
    setLayerState('topology', {
      status: result.features.length ? 'available' : 'empty',
      reason: result.features.length
        ? `当前视口绘制 ${result.features.length}/${result.total} 个授权要素${result.truncated ? '（分页性能预算截断）' : ''}`
        : '当前授权视口没有可绘制网架要素',
      updatedAt: snapshot.updatedAt,
    })
  } catch (cause) {
    if (isAbort(cause)) return
    topologyFeatures.value = []
    topologyTotal.value = 0
    topologyTransport.value = null
    loadedTopologyQueryKey = ''
    setLayerState('topology', { status: 'error', reason: cause instanceof Error ? cause.message : '授权网架快照加载失败' })
  }
}

function onTopologyViewport(viewport: TopologyViewportQuery) {
  lastTopologyViewport = viewport
  if (scene.value === 'topology' && topology.value?.dataAvailability.status === 'available') void loadTopology(viewport)
}

async function activateScene(next: SpatialCommandScene) {
  scene.value = next
  clearSelection()
  if (next === 'nodes') await loadNodes()
  else if (next === 'weather') await loadWeather()
  else if (next === 'market') await loadMarket()
  else if (next === 'disclosure') await loadDisclosures()
  else if (next === 'topology') await loadTopology(lastTopologyViewport)
}

async function refreshActive() {
  if (scene.value === 'overview') await loadBase()
  else if (scene.value === 'topology') {
    await loadBase()
    await loadTopology(lastTopologyViewport, true)
  }
  else if (scene.value === 'nodes') await loadNodes(true)
  else if (scene.value === 'weather') await loadWeather(true)
  else if (scene.value === 'market') await loadMarket(true)
  else if (scene.value === 'disclosure') await loadDisclosures(true)
}

function onAssetSelect(selection: GridGeoMapSelection | null) {
  clearSelection()
  if (selection?.kind === 'plant') selectedPlantId.value = selection.plantId
  if (selection?.kind === 'node') selectedNodeId.value = selection.nodeId
}

function selectTopologyFeature(feature: GridTopologyFeature) {
  selectedPlantId.value = null
  selectedNodeId.value = null
  selectedEventId.value = null
  selectedTopologyFeatureId.value = feature.featureId
}

/**
 * 平面图下钻态同步。地图自己已收窄视角与点层，这里只跟随更新侧栏清单与文案，
 * 不回写地图，避免两边互相驱动形成回环。
 */
function onSubdivisionSelect(selection: typeof focusedSubdivision.value) {
  const changed = selection?.adcode !== focusedSubdivision.value?.adcode
  focusedSubdivision.value = selection
  // 只在真正换地州时清选择：范围快照会随按需加载补发，那时清掉会把用户刚点开的详情卡关掉。
  if (changed) clearSelection()
}

function onTopologySelect(selection: { featureId: string } | null) {
  clearSelection()
  const feature = topologyFeatures.value.find((item) => item.featureId === selection?.featureId)
  if (feature) selectedTopologyFeatureId.value = feature.featureId
}

function selectPlant(plant: GridGeoPlant) {
  selectedNodeId.value = null
  selectedEventId.value = null
  selectedTopologyFeatureId.value = null
  selectedPlantId.value = plant.plantId
  mapRef.value?.focusPlant(plant.plantId)
}

function selectNode(node: GridGeoNode) {
  selectedPlantId.value = null
  selectedEventId.value = null
  selectedTopologyFeatureId.value = null
  selectedNodeId.value = node.nodeId
  mapRef.value?.focusNode(node.nodeId)
}

function selectEvent(event: GridDisclosureEvent) {
  selectedPlantId.value = null
  selectedNodeId.value = null
  selectedTopologyFeatureId.value = null
  selectedEventId.value = event.eventId
}

function selectPlantById(plantId: string) {
  const plant = plants.value.find((item) => item.plantId === plantId)
  if (plant) selectPlant(plant)
}

function navigate(event: MouseEvent, path: string) {
  if (!appRouter || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
  event.preventDefault()
  void appRouter.push(path)
}

function layerSettled(id: SpatialCommandScene) {
  return !['idle', 'loading'].includes(layerStates.value[id].status)
}

function onCompactViewportChange(event: MediaQueryListEvent) {
  dockOpen.value = !event.matches
}

function resetForScopeChange() {
  scopeRequestId += 1
  layerRequestId += 1
  clearScopeData()
  void loadBase()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') clearSelection()
}

watch(selectedCompanyId, resetForScopeChange)
watch(weatherLayer, () => { if (scene.value === 'weather') clearSelection() })
watch(marketLayer, () => { if (scene.value === 'market') clearSelection() })
// 换了选中对象就复位手动位移：新卡片带着上一次的偏移出现，看起来像是自己跳走了。
watch([selectedPlantId, selectedNodeId, selectedEventId], () => {
  cardOffset.value = { x: 0, y: 0 }
  void nextTick(() => { cardAnchorRight.value = selectionCardAnchors(selectionCardRef.value).right })
})
// 气象格点仍只有三维实现；停在 2D 会让侧栏报告图层已生效而地图纹丝不动，
// 故自动切到能画的视图并告知。
// 授权网架自 #1424 起平面图也绘制（断面/联络线走 lines、变电站走点层），不再强制切 3D
// 平面图还能按地市州下钻收窄视口，是看送出断面更直接的视图。
// 同时监听 viewMode：只看 scene 的话，进入气象后用户仍可手动切回 2D，
// 届时侧栏继续报告「已加载 N 个格点」而平面图什么都不画。
watch(
  () => [scene.value, viewMode.value] as const,
  ([next]) => {
    const threeDOnly = next === 'weather'
    if (threeDOnly && viewMode.value === '2d') {
      viewMode.value = '3d'
      topologyViewNotice.value = '气象图层为三维图层，已自动切换到 3D 视图。'
    } else if (!threeDOnly) {
      topologyViewNotice.value = ''
    }
  },
)
// Cesium 没有地市州下钻，切到 3D 时平面图被卸载、下钻态随之失效
// 不清空的话侧栏会继续显示「已下钻到某地州」而三维地图是全省视角。
watch(viewMode, (mode) => {
  if (mode !== '2d') focusedSubdivision.value = null
})

onRegionChange(resetForScopeChange)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  compactViewport = window.matchMedia('(max-width: 700px)')
  dockOpen.value = !compactViewport.matches
  compactViewport.addEventListener('change', onCompactViewportChange)
  void loadBase()
})

onBeforeUnmount(() => {
  scopeRequestId += 1
  layerRequestId += 1
  baseController?.abort()
  layerController?.abort()
  topologyLoader.cancel()
  compactViewport?.removeEventListener('change', onCompactViewportChange)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <section class="command-shell" :style="profileStyle">
    <header class="command-header">
      <div class="command-title">
        <span class="command-glyph"><Network :size="24" aria-hidden="true" /></span>
        <div>
          <small>GRID GEO · MULTI-LAYER COMMAND</small>
          <h1>电力空间联动驾驶舱</h1>
          <p>同一地形场景联动授权资产、节点、天气、市场与披露；无权威坐标时绝不落点或连线。</p>
        </div>
      </div>
      <div class="scope-summary">
        <span><ShieldCheck :size="14" aria-hidden="true" />{{ currentCompany.name || '未选择公司' }}</span>
        <span><MapPinned :size="14" aria-hidden="true" />{{ currentRegion.name }} · {{ operatorProfile?.visual.glyph ?? 'GRID' }}</span>
        <button type="button" :disabled="baseLoading || activeLayerState.status === 'loading'" aria-label="刷新当前空间图层" @click="refreshActive">
          <RefreshCw :size="15" :class="{ spin: baseLoading || activeLayerState.status === 'loading' }" aria-hidden="true" />刷新
        </button>
      </div>
    </header>

    <main ref="stageRef" class="command-stage" :aria-busy="stageLoading">
      <!--
        2D 走省级平面地图，3D 走 Cesium 地球；两者 props/emits 契约一致，
        故只切组件、数据流不动。授权网架只有三维实现，见下方 watch(scene) 强制切换。
      -->
      <component
        :is="viewMode === '2d' ? ProvinceFlatMap : CesiumPlantMap"
        ref="mapRef"
        :plants="scene === 'overview' ? catalogFiltered : plants"
        :nodes="visibleNodes"
        :show-located-nodes="scene === 'nodes'"
        :selected-plant-id="selectedPlantId"
        :selected-node-id="selectedNodeId"
        :view-mode="viewMode"
        :terrain-provider="terrainProvider"
        :vertical-exaggeration="verticalExaggeration"
        :hillshade-enabled="hillshadeEnabled"
        :weather-layer="scene === 'weather' ? weatherLayer : 'none'"
        :weather-items="visibleWeatherItems"
        :market-layer="scene === 'market' ? marketLayer : 'none'"
        :market-metrics="visibleMarketMetrics"
        :topology-features="topologyFeatures"
        :selected-topology-feature-id="selectedTopologyFeatureId"
        :show-topology="scene === 'topology' && topology?.dataAvailability.status === 'available'"
        :topology-grid-operator="topology?.gridOperator ?? operatorProfile?.id"
        :default-camera="operatorProfile?.defaultCamera"
        :aria-label="mapLabel"
        aria-describedby="command-map-description"
        @asset-select="onAssetSelect"
        @terrain="terrainStatus = $event"
        @hillshade="hillshadeAvailable = $event.available"
        @runtime="runtimeStatus = $event"
        @topology-select="onTopologySelect"
        @topology-viewport="onTopologyViewport"
        @subdivision-select="onSubdivisionSelect"
      />
      <p id="command-map-description" class="visually-hidden">当前地图只绘制已有权威 WGS84 坐标的电厂、节点和授权 Provider 返回的网架几何。公开披露只进入时间轴；授权网架未配置时不请求快照，也不生成任何线路。</p>
      <p v-if="topologyViewNotice" class="view-notice" role="status" aria-live="polite">{{ topologyViewNotice }}</p>
      <div class="map-vignette" aria-hidden="true" />
      <div class="map-scan" aria-hidden="true" />

      <nav class="scene-rail" aria-label="空间情景预设">
        <button
          v-for="item in sceneOptions"
          :key="item.id"
          type="button"
          :class="[item.id, layerStates[item.id].status, { active: scene === item.id }]"
          :aria-pressed="scene === item.id"
          :aria-label="`${item.label}：${item.short}；状态 ${layerStates[item.id].status}`"
          @click="activateScene(item.id)"
        >
          <component :is="item.icon" :size="18" aria-hidden="true" />
          <span><strong>{{ item.label }}</strong><small>{{ item.short }}</small></span>
          <i :title="layerStates[item.id].status" />
        </button>
      </nav>

      <div class="view-switch" role="group" aria-label="地图视图模式">
        <button v-for="mode in (['2d', '3d'] as GridGeoViewMode[])" :key="mode" type="button" :class="{ active: viewMode === mode }" :aria-pressed="viewMode === mode" @click="viewMode = mode">{{ mode.toUpperCase() }}</button>
      </div>

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

      <section class="signal-strip" aria-label="当前空间资产摘要">
        <article><MapPinned :size="15" aria-hidden="true" /><span><small>授权电厂</small><strong>{{ scopedPlants.length }}</strong></span></article>
        <article><Zap :size="15" aria-hidden="true" /><span><small>可见容量</small><strong>{{ locatedPlantCapacity.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) }} MW</strong></span></article>
        <article><Waypoints :size="15" aria-hidden="true" /><span><small>已定位节点</small><strong>{{ scopedNodes.length || "按需" }}</strong></span></article>
        <article><GitBranch :size="15" aria-hidden="true" /><span><small>网架准备度</small><strong>{{ topologyReady }}/{{ topologyRequired }}</strong></span></article>
      </section>

      <button class="dock-toggle" type="button" :aria-expanded="dockOpen" aria-controls="command-intel-dock" @click="dockOpen = !dockOpen">
        <Activity :size="15" aria-hidden="true" />{{ dockOpen ? '收起情报舱' : '展开情报舱' }}
      </button>

      <aside id="command-intel-dock" class="intel-dock" :class="{ open: dockOpen }" :aria-hidden="!dockOpen" :inert="!dockOpen">
        <header>
          <div><small>ACTIVE SCENE</small><h2>{{ currentScene.label }}</h2></div>
          <span :class="activeLayerState.status">{{ activeLayerState.status }}</span>
        </header>
        <p class="scene-reason" role="status" aria-live="polite">{{ activeLayerState.reason }}</p>
        <!--
          下钻状态只读展示：退出下钻的操作留在地图上的面包屑与 Esc，避免侧栏与地图各存一份
          下钻态、点了侧栏按钮而地图纹丝不动。
        -->
        <p v-if="focusedSubdivision" class="drill-scope" role="status" aria-live="polite">
          <MapPinned :size="13" aria-hidden="true" />
          已下钻到 <strong>{{ focusedSubdivision.name }}</strong>：资产 {{ scopedPlants.length }} · 节点 {{ scopedNodes.length }} · 通道 {{ scopedChannelCount }}。
          下方清单与地图同范围；按 Esc 或点地图面包屑返回省域。
        </p>
        <div class="source-ribbon"><Database :size="13" aria-hidden="true" /><span>{{ activeSourceSummary }}</span><time v-if="activeLayerState.updatedAt">{{ formatDate(activeLayerState.updatedAt, true) }}</time></div>

        <template v-if="scene === 'overview'">
          <div class="dock-kpis">
            <article><strong>{{ scopedPlants.length }}</strong><small>可绘制电厂</small></article>
            <article><strong>{{ scopedPlants.filter((item) => item.location.confidence === "verified").length }}</strong><small>范围已核验</small></article>
            <article><strong>{{ operatorProfile?.dataAvailability.weather.status ?? '—' }}</strong><small>天气能力</small></article>
          </div>
          <h3>场站目录</h3>
          <!--
            「电厂地理空间」并入后，这里从一份只读列表升级成带检索与筛选的场站目录。
            输入用 scopedPlants 而非全量：下钻到地市州后目录也应该只列该范围内的场站，
            否则会出现「图上只剩一个州、列表还是全省」。
          -->
          <PlantCatalogPanel
            variant="embedded"
            :plants="scopedPlants"
            :selected-plant-id="selectedPlantId"
            :total-count="catalogStats?.totalPlantCountInCurrentDim ?? null"
            :located-count="catalogStats?.locatedPlantCount ?? null"
            :unresolved-count="catalogStats?.unresolvedPlantCount ?? null"
            @select="selectPlant"
            @update:filtered="catalogFiltered = $event"
            @selection-filtered-out="clearSelection"
          />
        </template>

        <template v-else-if="scene === 'nodes'">
          <div class="dock-kpis">
            <article><strong>{{ layerSettled("nodes") ? scopedNodes.length : "—" }}</strong><small>本次绘制</small></article>
            <article><strong>{{ layerSettled('nodes') ? nodeTotal : '—' }}</strong><small>筛选总量</small></article>
            <article><strong>{{ layerSettled('nodes') ? (nodeTruncated ? '是' : '否') : '—' }}</strong><small>分页截断</small></article>
          </div>
          <div class="truth-callout"><ShieldCheck :size="15" aria-hidden="true" />只读取 locationStatus=located；unresolved 身份不会生成坐标。{{ nodeExcludedInvalid ? `另剔除 ${nodeExcludedInvalid} 个无效坐标。` : '' }}</div>
          <div class="asset-list">
            <button v-for="node in scopedNodes" :key="node.nodeId" type="button" :class="{ selected: selectedNodeId === node.nodeId }" @click="selectNode(node)">
              <Waypoints :size="15" aria-hidden="true" /><span><strong>{{ node.nodeName }}</strong><small>{{ node.voltageLevelKv ? `${node.voltageLevelKv} kV` : '电压待补' }} · {{ node.location?.locationLabel }}</small></span><ArrowRight :size="13" aria-hidden="true" />
            </button>
          </div>
        </template>

        <template v-else-if="scene === 'weather'">
          <div class="segmented-options" role="group" aria-label="天气视觉图层">
            <button v-for="option in weatherOptions" :key="option.value" type="button" :aria-pressed="weatherLayer === option.value" :class="{ active: weatherLayer === option.value }" @click="weatherLayer = option.value">
              <component :is="option.icon" :size="14" aria-hidden="true" />{{ option.label }}
            </button>
          </div>
          <div class="dock-kpis">
            <article><strong>{{ visibleWeatherItems.length }}/{{ weatherItems.length }}</strong><small>有效格点</small></article>
            <article><strong>{{ Number.isFinite(weatherResponse?.data.summary.averageTemperatureC) ? `${Number(weatherResponse?.data.summary.averageTemperatureC).toFixed(1)}°` : '—' }}</strong><small>平均气温</small></article>
            <article><strong>{{ weatherResponse ? (weatherResponse.data.summary.alertCount ?? '—') : '—' }}</strong><small>天气关注</small></article>
          </div>
          <div class="truth-callout"><CloudRain :size="15" aria-hidden="true" />Open-Meteo 格点实况，不是场站传感器；缺测值不补零。</div>
          <div class="asset-list">
            <button v-for="item in visibleWeatherItems" :key="item.plantId" type="button" :class="{ selected: selectedPlantId === item.plantId }" @click="selectPlantById(item.plantId)">
              <CloudRain :size="15" aria-hidden="true" /><span><strong>{{ plants.find((plant) => plant.plantId === item.plantId)?.standardName ?? item.plantId }}</strong><small>{{ weatherValue(item) }} · {{ item.weatherLabel }}</small></span><ArrowRight :size="13" aria-hidden="true" />
            </button>
          </div>
        </template>

        <template v-else-if="scene === 'market'">
          <div class="market-controls">
            <label><CalendarDays :size="14" aria-hidden="true" /><input v-model="marketDate" type="date" aria-label="市场回放日期" /></label>
            <button type="button" @click="loadMarket(true)">加载日期</button>
          </div>
          <div class="segmented-options market" role="group" aria-label="市场空间图层">
            <button v-for="option in GRID_MARKET_LAYER_OPTIONS" :key="option.value" type="button" :aria-pressed="marketLayer === option.value" :class="{ active: marketLayer === option.value }" @click="marketLayer = option.value">{{ option.label }}</button>
          </div>
          <p class="layer-hint">{{ marketLayerHint }}</p>
          <div class="dock-kpis">
            <article><strong>{{ marketSnapshot?.summary.pricedPlants ?? '—' }}</strong><small>价格覆盖</small></article>
            <article><strong>{{ marketSnapshot?.summary.outputPlants ?? '—' }}</strong><small>出力覆盖</small></article>
            <article><strong>{{ marketSnapshot?.summary.highRiskPlants ?? '—' }}</strong><small>高关注</small></article>
          </div>
          <div class="truth-callout warning"><AlertTriangle :size="15" aria-hidden="true" />历史市场回放不与当前天气合成“实时风险”，关注分也不是潮流或阻塞成因。</div>
          <div class="asset-list">
            <button v-for="metric in marketRank" :key="metric.plantId" type="button" :class="[`tone-${marketTone(metric)}`, { selected: selectedPlantId === metric.plantId }]" @click="selectPlantById(metric.plantId)">
              <Gauge :size="15" aria-hidden="true" /><span><strong>{{ plants.find((plant) => plant.plantId === metric.plantId)?.standardName ?? metric.plantId }}</strong><small>{{ metric.nodeName || '节点未绑定' }}</small></span><b>{{ marketValueText(metric) }}</b>
            </button>
          </div>
        </template>

        <template v-else-if="scene === 'disclosure'">
          <div class="dock-kpis">
            <article><strong>{{ disclosures.length }}</strong><small>本页事件</small></article>
            <article><strong>{{ disclosureTotal }}</strong><small>筛选总量</small></article>
            <article><strong>{{ Object.keys(disclosureCategoryCounts).length }}</strong><small>事件类别</small></article>
          </div>
          <div class="truth-callout"><FileSearch :size="15" aria-hidden="true" />源记录 coordinates=null；只进入地区和时间轴，地图不生成点或线。</div>
          <div class="timeline-list">
            <button v-for="event in disclosures" :key="event.eventId" type="button" :class="[event.category, { selected: selectedEventId === event.eventId }]" @click="selectEvent(event)">
              <i /><span><small>{{ formatDate(event.effectiveAt, true) }} · {{ disclosureCategoryLabel[event.category] }}</small><strong>{{ event.title }}</strong><em>{{ event.spatialBinding.label }}</em></span>
            </button>
          </div>
        </template>

        <template v-else>
          <div class="topology-status">
            <span class="topology-lock"><GitBranch :size="25" aria-hidden="true" /></span>
            <small>{{ topologySourceType }} · 非模拟数据</small>
            <strong>{{ topology?.provider.label ?? 'Provider 状态不可用' }}</strong>
            <p>{{ topology?.dataAvailability.reason ?? activeLayerState.reason }}</p>
          </div>
          <div class="readiness-mini">
            <span v-for="item in topology?.readiness ?? []" :key="item.id" :class="item.status"><CheckCircle2 :size="13" aria-hidden="true" />{{ item.label }}</span>
          </div>
          <TopologyLayerStatus
            v-if="topology && topology.dataAvailability.status === 'available'"
            :manifest="topology"
            :source-type="topologySourceType"
            :rendered="topologyFeatures.length"
            :total="topologyTotal"
            :lod="topologyLod"
            :truncated="topologyTruncated"
            :transport="topologyTransport"
          />
          <div class="truth-callout warning"><AlertTriangle :size="15" aria-hidden="true" />只在 Provider 可用时读取当前视口 snapshot；不推断线路，不展示潮流方向、负载率或阻塞成因。</div>
          <template v-if="topologyKeyboardFeatures.length">
            <h3>授权要素键盘列表</h3>
            <div class="asset-list">
              <button v-for="feature in topologyKeyboardFeatures" :key="feature.featureId" type="button" :class="{ selected: selectedTopologyFeatureId === feature.featureId }" @click="selectTopologyFeature(feature)">
                <Network :size="15" aria-hidden="true" /><span><strong>{{ feature.name }}</strong><small>{{ topologyFeatureLabel(feature.kind) }} · {{ feature.status }} · {{ feature.featureId }}</small></span><ArrowRight :size="13" aria-hidden="true" />
              </button>
            </div>
            <p v-if="topologyFeatures.length > topologyKeyboardFeatures.length" class="list-budget-note">键盘列表按性能预算展示前 {{ topologyKeyboardFeatures.length }} 条；地图仍保留当前视口全部 {{ topologyFeatures.length }} 个要素。</p>
          </template>
          <a class="deep-link" href="/grid-assets/topology" @click="navigate($event, '/grid-assets/topology')">进入授权网架接入舱<ArrowRight :size="14" aria-hidden="true" /></a>
        </template>
      </aside>

      <TopologyFeatureCard v-if="selectedTopologyFeature && topology" :feature="selectedTopologyFeature" :manifest="topology" :source-type="topologySourceType" @close="clearSelection" />

      <article v-else-if="selectedPlant" ref="selectionCardRef" class="selection-card" :style="selectionCardStyle" @pointerdown="onCardPointerDown" @pointermove="onCardPointerMove" @pointerup="onCardPointerUp" @pointercancel="onCardPointerUp">
        <button type="button" class="close" aria-label="关闭选择卡片" @click="clearSelection"><X :size="15" aria-hidden="true" /></button>
        <small>AUTHORIZED PLANT</small><h2>{{ selectedPlant.standardName }}</h2>
        <p><MapPinned :size="14" aria-hidden="true" />{{ selectedPlant.location.locationLabel }} · {{ selectedPlant.location.confidence }}</p>
        <div><span><small>装机容量</small><strong>{{ selectedPlant.capacityMw?.toLocaleString('zh-CN') ?? '缺测' }} MW</strong></span><span v-if="scene === 'weather'"><small>{{ weatherOptions.find((item) => item.value === weatherLayer)?.label }}</small><strong>{{ weatherValue(selectedWeather) }}</strong></span><span v-if="scene === 'market'"><small>{{ gridMarketLayerOption(marketLayer)?.label }}</small><strong>{{ marketValueText(selectedMarket) }}</strong></span></div>
        <button type="button" class="deep-link" @click="detailOpen = true">完整信息<ArrowRight :size="13" aria-hidden="true" /></button>
      </article>

      <article v-else-if="selectedNode" ref="selectionCardRef" class="selection-card" :style="selectionCardStyle" @pointerdown="onCardPointerDown" @pointermove="onCardPointerMove" @pointerup="onCardPointerUp" @pointercancel="onCardPointerUp">
        <button type="button" class="close" aria-label="关闭选择卡片" @click="clearSelection"><X :size="15" aria-hidden="true" /></button>
        <small>LOCATED NODE</small><h2>{{ selectedNode.nodeName }}</h2>
        <p><Waypoints :size="14" aria-hidden="true" />{{ selectedNode.location?.locationLabel }} · {{ selectedNode.locationStatus }}</p>
        <div><span><small>节点类型</small><strong>{{ selectedNode.nodeKind }}</strong></span><span><small>电压等级</small><strong>{{ selectedNode.voltageLevelKv ? `${selectedNode.voltageLevelKv} kV` : '待补' }}</strong></span></div>
        <a class="deep-link" href="/grid-assets/nodes" @click="navigate($event, '/grid-assets/nodes')">进入节点资产台<ArrowRight :size="13" aria-hidden="true" /></a>
      </article>

      <article v-else-if="selectedEvent" ref="selectionCardRef" class="selection-card event-card" :style="selectionCardStyle" @pointerdown="onCardPointerDown" @pointermove="onCardPointerMove" @pointerup="onCardPointerUp" @pointercancel="onCardPointerUp">
        <button type="button" class="close" aria-label="关闭选择卡片" @click="clearSelection"><X :size="15" aria-hidden="true" /></button>
        <small>{{ disclosureCategoryLabel[selectedEvent.category] }} · {{ formatDate(selectedEvent.effectiveAt, true) }}</small><h2>{{ selectedEvent.title }}</h2>
        <p><FileSearch :size="14" aria-hidden="true" />{{ selectedEvent.spatialBinding.label }} · 坐标未提供</p>
        <a class="deep-link" href="/grid-assets/disclosures" @click="navigate($event, '/grid-assets/disclosures')">查看证据与时间轴<ArrowRight :size="13" aria-hidden="true" /></a>
      </article>

      <footer class="truth-console">
        <span><Database :size="13" aria-hidden="true" />资产 {{ plantSource.sourceType }} · mock={{ plantSource.mock }}</span>
        <span><MapPinned :size="13" aria-hidden="true" />{{ terrainStatus.label }}</span>
        <span v-if="runtimeStatus"><Activity :size="13" aria-hidden="true" />{{ runtimeStatus.network === 'weak' ? '视觉精简，数据未缺失' : '标准视觉档' }} · {{ runtimeStatus.renderMode === 'on-demand' ? '按需渲染' : '连续渲染' }} · WebGL {{ runtimeStatus.webgl }}</span>
        <span><ShieldCheck :size="13" aria-hidden="true" />公司/地区/电网 fail-closed · 不写生产</span>
      </footer>

      <div v-if="baseLoading" class="stage-state" role="status"><Orbit :size="30" class="spin" aria-hidden="true" /><strong>正在建立当前作用域空间场景…</strong></div>
      <div v-else-if="baseError" class="stage-state error" role="alert"><AlertTriangle :size="24" aria-hidden="true" /><strong>{{ baseError }}</strong><button type="button" @click="loadBase">重试</button></div>
      <div class="visually-hidden" aria-live="polite">{{ selectionAnnouncement }}</div>
    </main>

    <!--
      「电厂地理空间」并入后的两块：完整信息抽屉与资产治理弹窗。都挂在 .command-stage
      之外——stage 有 `isolation: isolate`，放里面会被它的层叠上下文裁掉。
    -->
    <PlantDetailDrawer
      v-model:open="detailOpen"
      :plant="selectedPlant"
      :weather="selectedWeather"
      :can-write="canWrite"
      @governance="(mode) => { governanceMode = mode; governanceOpen = true }"
    />
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
.view-notice{position:absolute;z-index:10;top:14px;left:50%;transform:translateX(-50%);margin:0;padding:8px 14px;font-size: var(--font-lg);color:var(--text-body);border:1px solid var(--line);border-radius:8px;background:var(--panel);box-shadow:var(--shadow,0 8px 24px rgba(0,0,0,.18))}
.command-shell { --command-accent:#38d9f5; --command-secondary:#44d7b6; --command-surface:#071b29; min-height:calc(100vh - 92px); overflow:hidden; color:#dff7ff; border:1px solid rgba(76,181,214,.18); border-radius:18px; background:#020811; box-shadow:0 24px 70px rgba(0,4,14,.35); }
.command-header { display:flex; min-height:76px; align-items:center; justify-content:space-between; gap:18px; padding:12px 18px; border-bottom:1px solid rgba(79,181,214,.15); background:radial-gradient(circle at 78% 0,color-mix(in srgb,var(--command-accent) 10%,transparent),transparent 38%),linear-gradient(100deg,#071d30,#050f1b); }
.command-title { display:flex; min-width:0; align-items:center; gap:12px; }.command-glyph{display:grid;width:46px;height:46px;flex:0 0 auto;place-items:center;color:var(--command-accent);border:1px solid color-mix(in srgb,var(--command-accent) 38%,transparent);border-radius:14px;background:color-mix(in srgb,var(--command-accent) 9%,transparent);box-shadow:0 0 28px color-mix(in srgb,var(--command-accent) 13%,transparent)}
.command-title small,.intel-dock header small{color:var(--command-accent);font-size: var(--font-15);font-weight:800;letter-spacing:.16em}.command-title h1{margin:3px 0 2px;font-size: var(--font-24);text-wrap:balance}.command-title p{margin:0;color:#7898a8;font-size: var(--font-15);line-height:1.5}
.scope-summary{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px}.scope-summary span,.scope-summary button{display:inline-flex;min-height:34px;align-items:center;gap:6px;padding:0 10px;color:#91b5c3;border:1px solid rgba(91,184,214,.17);border-radius:9px;background:rgba(3,18,31,.62);font-size: var(--font-15)}.scope-summary button{color:#c9edf5;cursor:pointer}.scope-summary button:disabled{opacity:.55;cursor:wait}
.command-stage{position:relative;height:calc(100vh - 188px);min-height:720px;overflow:hidden;isolation:isolate}.map-vignette,.map-scan{position:absolute;z-index:2;inset:0;pointer-events:none}.map-vignette{box-shadow:inset 0 0 110px rgba(0,4,15,.34)}.map-scan{opacity:.045;background-image:linear-gradient(rgba(80,200,230,.22) 1px,transparent 1px),linear-gradient(90deg,rgba(80,200,230,.22) 1px,transparent 1px);background-size:58px 58px;mask-image:radial-gradient(circle at center,#000,transparent 80%)}
.scene-rail{position:absolute;z-index:7;top:18px;bottom:55px;left:16px;display:flex;width:224px;flex-direction:column;gap:7px;padding:9px;border:1px solid rgba(90,187,219,.17);border-radius:14px;background:rgba(3,17,29,.84);box-shadow:0 24px 58px rgba(0,5,16,.34);backdrop-filter:blur(18px)}
.scene-rail button{position:relative;display:grid;min-height:57px;grid-template-columns:26px minmax(0,1fr) 8px;align-items:center;gap:8px;padding:8px;color:#789baa;border:1px solid transparent;border-radius:10px;background:transparent;text-align:left;cursor:pointer}.scene-rail button:hover{color:#ccecf4;background:rgba(36,108,132,.12)}.scene-rail button.active{color:#defbff;border-color:color-mix(in srgb,var(--command-accent) 26%,transparent);background:linear-gradient(100deg,color-mix(in srgb,var(--command-accent) 16%,transparent),rgba(7,30,45,.38));box-shadow:inset 3px 0 var(--command-accent)}.scene-rail button>svg{color:var(--command-accent)}.scene-rail button span{display:flex;min-width:0;flex-direction:column;gap:2px}.scene-rail strong{font-size: var(--font-15)}.scene-rail small{overflow:hidden;color:#587a89;font-size: var(--font-15);text-overflow:ellipsis;white-space:nowrap}.scene-rail i{width:7px;height:7px;border-radius:50%;background:#516b77}.scene-rail .available i{background:#4ee0ad;box-shadow:0 0 10px rgba(78,224,173,.48)}.scene-rail .loading i{background:#51d8f4;animation:pulse 1.2s ease-in-out infinite}.scene-rail .degraded i,.scene-rail .not-configured i{background:#e9b952}.scene-rail .error i{background:#f07070}
.view-switch{position:absolute;z-index:8;top:18px;left:258px;display:flex;padding:4px;border:1px solid rgba(92,187,218,.18);border-radius:10px;background:rgba(3,17,29,.82);backdrop-filter:blur(14px)}.view-switch button{min-width:50px;height:32px;color:#7297a6;border:0;border-radius:7px;background:transparent;font-size: var(--font-15);cursor:pointer}.view-switch button.active{color:#03131c;background:linear-gradient(135deg,var(--command-accent),var(--command-secondary));box-shadow:0 8px 24px color-mix(in srgb,var(--command-accent) 24%,transparent)}
.terrain-dock{position:absolute;z-index:8;top:60px;left:258px;width:214px}
/* left 必须让开左侧 .terrain-dock（left:258 + width:214 = 472）。原值 430 时地形面板
   压着第一张 KPI 卡的左半边——面板 z-index 8 高于本条的 6，卡片数字被盖住。 */
.signal-strip{position:absolute;z-index:6;top:18px;right:382px;left:486px;display:flex;justify-content:center;gap:7px;pointer-events:none}.signal-strip article{display:flex;min-width:112px;align-items:center;gap:8px;padding:8px 10px;color:var(--command-accent);border:1px solid rgba(85,182,214,.15);border-radius:10px;background:rgba(3,17,29,.75);backdrop-filter:blur(14px)}.signal-strip span{display:flex;min-width:0;flex-direction:column}.signal-strip small{color:#688b99;font-size: var(--font-lg)}.signal-strip strong{overflow:hidden;color:#d9f4f9;font-size: var(--font-15);text-overflow:ellipsis;white-space:nowrap}
.dock-toggle{position:absolute;z-index:9;right:16px;bottom:57px;display:none;min-height:38px;align-items:center;gap:6px;padding:0 11px;color:#ccecf4;border:1px solid rgba(87,185,216,.2);border-radius:9px;background:rgba(3,17,29,.88)}
.intel-dock{position:absolute;z-index:8;top:18px;right:16px;bottom:55px;width:350px;overflow:auto;padding:15px;border:1px solid rgba(89,188,219,.19);border-radius:15px;background:linear-gradient(150deg,rgba(5,27,43,.94),rgba(2,13,25,.91));box-shadow:0 28px 70px rgba(0,4,14,.5);backdrop-filter:blur(22px)}.intel-dock>header{display:flex;align-items:center;justify-content:space-between;gap:12px}.intel-dock h2{margin:3px 0 0;font-size: var(--font-21)}.intel-dock>header>span{padding:5px 8px;color:#809eaa;border-radius:999px;background:rgba(93,143,159,.12);font-size: var(--font-15)}.intel-dock>header>span.available{color:#60dfb1;background:rgba(42,159,115,.14)}.intel-dock>header>span.degraded,.intel-dock>header>span.not-configured{color:#e9bd65;background:rgba(183,127,29,.13)}.intel-dock>header>span.error{color:#ee8d84;background:rgba(181,63,55,.13)}.scene-reason{margin:11px 0;color:#7899a7;font-size: var(--font-15);line-height:1.55}
.drill-scope{display:flex;flex-wrap:wrap;align-items:baseline;gap:5px;margin:0 0 11px;padding:8px 10px;color:#8cc6d8;border:1px solid rgba(84,177,207,.22);border-radius:8px;background:rgba(24,86,116,.18);font-size: var(--font-lg);line-height:1.5}.drill-scope svg{color:var(--command-accent)}.drill-scope strong{color:#d6ecf5}
.source-ribbon{display:flex;min-width:0;align-items:flex-start;gap:6px;padding:8px;color:#6e919e;border:1px solid rgba(84,177,207,.11);border-radius:8px;background:rgba(2,14,25,.32);font-size: var(--font-15);line-height:1.45}.source-ribbon svg{flex:0 0 auto;margin-top:1px;color:var(--command-accent)}.source-ribbon span{min-width:0;overflow-wrap:anywhere}.source-ribbon time{flex:0 0 auto;margin-left:auto;color:#8bb1bd;white-space:nowrap}
.dock-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:11px 0}.dock-kpis article{display:flex;min-width:0;padding:9px 7px;flex-direction:column;gap:3px;border:1px solid rgba(88,179,210,.12);border-radius:9px;background:rgba(2,14,25,.38)}.dock-kpis strong{overflow:hidden;color:#d8f3f8;font-size: var(--font-18);text-overflow:ellipsis;white-space:nowrap}.dock-kpis small{color:#6e919f;font-size: var(--font-15)}.intel-dock h3{margin:14px 0 7px;color:#a9d1dc;font-size: var(--font-15)}.asset-list,.timeline-list{display:grid;gap:6px}.asset-list>button{display:grid;width:100%;min-height:48px;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;gap:7px;padding:7px 8px;color:#7ba3b2;border:1px solid rgba(86,174,204,.1);border-radius:8px;background:rgba(2,14,25,.28);text-align:left;cursor:pointer;content-visibility:auto;contain-intrinsic-size:auto 48px}.asset-list>button:hover,.asset-list>button.selected{color:#d9f6fb;border-color:color-mix(in srgb,var(--command-accent) 30%,transparent);background:color-mix(in srgb,var(--command-accent) 9%,rgba(2,14,25,.45))}.asset-list button>svg{color:var(--command-accent)}.asset-list button span{display:flex;min-width:0;flex-direction:column;gap:2px}.asset-list button strong{overflow:hidden;font-size: var(--font-15);text-overflow:ellipsis;white-space:nowrap}.asset-list button small{overflow:hidden;color:#668995;font-size: var(--font-15);text-overflow:ellipsis;white-space:nowrap}.asset-list button>b{color:#e6c374;font-size: var(--font-15);text-align:right}.truth-callout{display:flex;margin:10px 0;padding:9px;align-items:flex-start;gap:7px;color:#91b7c2;border:1px solid rgba(78,194,169,.15);border-radius:8px;background:rgba(34,132,107,.08);font-size: var(--font-15);line-height:1.55}.truth-callout svg{flex:0 0 auto;color:#58d8ad}.truth-callout.warning{color:#ceb477;border-color:rgba(208,157,59,.16);background:rgba(161,105,21,.08)}.truth-callout.warning svg{color:#e2b757}
/* 市场排行的分档着色，口径来自 marketSpatialLayers.gridMarketTone。原「电力市场空间
   态势」页靠这层颜色一眼分出高关注资产，并入驾驶舱时一并带过来；色值取驾驶舱既有的
   告警/正常色，不引第三套。 */
.asset-list>button.tone-hot>b{color:#ef8f80}
.asset-list>button.tone-warm>b{color:#e6c374}
.asset-list>button.tone-cool>b{color:#58d8ad}
.asset-list>button.tone-missing>b{color:#6d8a95}
/* 图层口径说明：指标名本身不解释它是怎么算的，「综合关注」尤其如此。 */
.layer-hint{margin:7px 0 0;color:#6e919f;font-size:var(--font-15);line-height:1.5}
.segmented-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin:10px 0}.segmented-options button{display:flex;min-height:34px;align-items:center;justify-content:center;gap:5px;color:#779eac;border:1px solid rgba(89,179,209,.12);border-radius:7px;background:rgba(2,15,26,.34);font-size: var(--font-15);cursor:pointer}.segmented-options button.active{color:#03131c;border-color:transparent;background:linear-gradient(135deg,var(--command-accent),var(--command-secondary))}.segmented-options.market{grid-template-columns:1fr}.market-controls{display:flex;gap:6px;margin:10px 0}.market-controls label,.market-controls>button{display:flex;min-height:34px;align-items:center;gap:5px;padding:0 8px;color:#90b4c1;border:1px solid rgba(89,180,211,.14);border-radius:7px;background:rgba(2,14,25,.35);font-size: var(--font-15)}.market-controls label{flex:1}.market-controls input{width:100%;color:#bfe0e7;border:0;outline:0;background:transparent;color-scheme:dark}.market-controls>button{cursor:pointer}
.timeline-list button{display:grid;grid-template-columns:10px minmax(0,1fr);gap:7px;padding:8px;color:#83a4b1;border:1px solid rgba(87,172,201,.1);border-radius:8px;background:rgba(2,14,25,.28);text-align:left;cursor:pointer}.timeline-list button:hover,.timeline-list button.selected{border-color:rgba(88,207,229,.3);background:rgba(29,105,128,.12)}.timeline-list button>i{width:8px;height:8px;margin-top:5px;border-radius:50%;background:#5ed8f3}.timeline-list button.maintenance>i{background:#62dfb0}.timeline-list button.outage>i{background:#ef7a70}.timeline-list button.congestion>i,.timeline-list button.constraint>i{background:#eab65c}.timeline-list span{display:flex;min-width:0;flex-direction:column;gap:3px}.timeline-list small{color:#668995;font-size: var(--font-15)}.timeline-list strong{overflow:hidden;color:#cde5eb;font-size: var(--font-15);text-overflow:ellipsis;white-space:nowrap}.timeline-list em{color:#7897a2;font-size: var(--font-15);font-style:normal}
.topology-status{display:flex;margin:14px 0;padding:14px;flex-direction:column;align-items:center;text-align:center;border:1px solid rgba(208,161,62,.18);border-radius:12px;background:radial-gradient(circle at 50% 0,rgba(209,160,55,.12),transparent 58%),rgba(2,14,25,.35)}.topology-lock{display:grid;width:48px;height:48px;margin-bottom:9px;place-items:center;color:#e2bb68;border:1px solid rgba(220,174,74,.3);border-radius:14px;background:rgba(147,95,18,.13)}.topology-status>small{color:#8a744d;font-size: var(--font-lg)}.topology-status>strong{margin-top:4px;color:#e6d3a9;font-size: var(--font-16)}.topology-status>p{margin:6px 0 0;color:#85765b;font-size: var(--font-15);line-height:1.5}.readiness-mini{display:grid;grid-template-columns:1fr 1fr;gap:5px}.readiness-mini span{display:flex;min-height:33px;align-items:center;gap:5px;padding:6px;color:#728d99;border:1px solid rgba(87,172,201,.1);border-radius:7px;font-size: var(--font-lg)}.readiness-mini span.ready{color:#62dcb1}.list-budget-note{margin:7px 0;color:#718f9b;font-size: var(--font-lg);line-height:1.5}.deep-link{display:inline-flex;min-height:34px;align-items:center;justify-content:center;gap:6px;padding:0 10px;color:#06151d;border:0;border-radius:8px;background:linear-gradient(135deg,var(--command-accent),var(--command-secondary));font-size: var(--font-15);font-weight:750;text-decoration:none;cursor:pointer}.intel-dock>.deep-link{box-sizing:border-box;width:100%;margin-top:10px}
.selection-card{position:absolute;z-index:10;right:382px;bottom:58px;cursor:move;touch-action:none;transition:transform .22s ease;user-select:none;width:min(410px,calc(100% - 640px));padding:14px;border:1px solid color-mix(in srgb,var(--command-accent) 27%,transparent);border-radius:14px;background:linear-gradient(145deg,rgba(5,28,44,.95),rgba(2,14,25,.92));box-shadow:0 25px 65px rgba(0,4,14,.5);backdrop-filter:blur(20px)}.selection-card>.close{position:absolute;top:9px;right:9px;display:grid;width:28px;height:28px;place-items:center;color:#789ba8;border:0;border-radius:7px;background:rgba(75,130,149,.1);cursor:pointer}.selection-card>small{color:var(--command-accent);font-size: var(--font-lg);font-weight:800;letter-spacing:.13em}.selection-card h2{margin:4px 28px 4px 0;font-size: var(--font-20)}.selection-card>p{display:flex;margin:0;align-items:flex-start;gap:5px;color:#779aa8;font-size: var(--font-15);line-height:1.45}.selection-card>div{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:10px 0}.selection-card>div span{display:flex;padding:8px;flex-direction:column;gap:2px;border-radius:8px;background:rgba(2,14,25,.4)}.selection-card>div small{color:#5f808c;font-size: var(--font-lg)}.selection-card>div strong{overflow:hidden;color:#d6edf2;font-size: var(--font-15);text-overflow:ellipsis;white-space:nowrap}.selection-card.event-card{border-color:rgba(221,175,75,.25)}
/* 卡片内的文字仍可选中；只有空白区域用来拖 */
.selection-card h2,.selection-card>p,.selection-card>div strong{user-select:text}
.truth-console{position:absolute;z-index:7;right:16px;bottom:10px;left:16px;display:flex;min-height:35px;align-items:center;gap:16px;padding:7px 11px;color:#7399a6;border:1px solid rgba(84,176,207,.14);border-radius:9px;background:rgba(3,17,29,.82);font-size: var(--font-10-5);backdrop-filter:blur(14px)}.truth-console span{display:flex;align-items:center;gap:5px}.truth-console span:last-child{margin-left:auto;color:#69cbaa}
.command-stage :deep(.cesium-viewer-bottom){right:382px!important;bottom:56px!important;left:auto!important;z-index:9}
/* ProvinceFlatMap 的浮层安全区。子组件看不到宿主在它上面盖了什么，由这里按本视图
   的实际布局声明：左边 .scene-rail（16 + 224）、右边 .intel-dock（16 + 350 + 16）、
   底部状态条，三条边的数值与上面 .cesium-viewer-bottom 同源，改一处要一起改。
   不声明则子组件按「无遮挡」取 0——那正是另一个宿主 GridMarketSpatialView 要的。 */
.command-stage :deep(.province-flat-map){--map-safe-left:240px;--map-safe-right:382px;--map-safe-bottom:56px}
.stage-state{position:absolute;z-index:20;top:50%;left:50%;display:flex;min-width:280px;padding:22px;align-items:center;justify-content:center;gap:10px;transform:translate(-50%,-50%);color:#b9e3ec;border:1px solid rgba(83,187,219,.2);border-radius:14px;background:rgba(2,15,27,.88);box-shadow:0 30px 80px rgba(0,0,0,.5);backdrop-filter:blur(18px)}.stage-state.error{flex-wrap:wrap;color:#e99587}.stage-state button{padding:6px 10px;color:#d7f2f7;border:1px solid rgba(87,184,214,.2);border-radius:7px;background:rgba(16,67,84,.25);cursor:pointer}.spin{animation:spin 1s linear infinite}.visually-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
button:focus-visible,input:focus-visible{outline:2px solid var(--command-accent);outline-offset:3px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{50%{opacity:.38}}

@media(max-width:1320px){.signal-strip{display:none}}
@media(max-width:1180px){.scene-rail{width:205px}.view-switch{left:238px}.terrain-dock{left:238px}.selection-card{right:340px;width:min(360px,calc(100% - 580px))}.intel-dock{width:320px}}
@media(max-width:900px){.signal-strip{left:334px}.command-header{align-items:flex-start}.command-title p{display:none}.scope-summary span:first-child{display:none}.scene-rail{bottom:56px;width:72px}.scene-rail button{grid-template-columns:1fr;justify-items:center}.scene-rail button span{display:none}.view-switch{left:104px}.terrain-dock{left:104px}.intel-dock{width:330px}.selection-card{right:360px;left:104px;width:auto}.truth-console span:nth-child(-n+2){display:none}}
@media(max-width:700px){.command-shell{min-height:100dvh;border-radius:0}.command-header{min-height:86px;padding:10px}.command-glyph{display:none}.command-title h1{font-size: var(--font-21)}.command-title small{font-size: var(--font-lg)}.scope-summary span{display:none}.scope-summary button{width:36px;padding:0;justify-content:center;font-size:0}.command-stage{height:calc(100dvh - 86px);min-height:calc(100dvh - 86px)}.scene-rail{top:auto;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));left:10px;width:auto;height:58px;flex-direction:row;padding:5px}.scene-rail button{min-width:0;min-height:46px;flex:1;padding:5px}.scene-rail button>svg{width:17px}.view-switch{top:10px;left:10px}.terrain-dock{display:none}.dock-toggle{display:flex;top:10px;right:10px;bottom:auto}.intel-dock{top:58px;right:10px;bottom:calc(160px + env(safe-area-inset-bottom));left:10px;width:auto;overscroll-behavior:contain;transform:translateY(-112%);transition:transform .2s ease;pointer-events:none;background:rgba(4,22,36,.98);backdrop-filter:none}.intel-dock.open{transform:none;pointer-events:auto}.selection-card{right:10px;bottom:calc(166px + env(safe-area-inset-bottom));left:10px;width:auto}.truth-console{right:10px;bottom:calc(78px + env(safe-area-inset-bottom));left:10px;min-height:38px}.truth-console span{display:none!important}.truth-console span:last-child{display:flex!important;margin:0}.command-stage :deep(.cesium-viewer-bottom){right:10px!important;bottom:calc(126px + env(safe-area-inset-bottom))!important;left:auto!important}.dock-kpis strong{font-size: var(--font-16)}.asset-list button strong,.timeline-list strong{font-size: var(--font-15)}.asset-list button small,.timeline-list small,.timeline-list em{font-size: var(--font-15)}}
@media(prefers-reduced-motion:reduce){.spin,.scene-rail .loading i{animation:none}.intel-dock{transition:none}}
</style>
