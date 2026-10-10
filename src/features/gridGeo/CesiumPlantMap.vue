<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Viewer } from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { Crosshair, Layers } from 'lucide-vue-next'
import type {
  GridGeoMapSelection,
  GridGeoNode,
  GridGeoPlant,
  GridGeoRuntimeStatus,
  GridGeoSelection,
  GridGeoTerrainProvider,
  GridGeoTerrainStatus,
  GridGeoViewMode,
  GridGeoWeatherLayer,
  GridGeoWeatherSnapshot,
  GridMarketLayer,
  GridMarketMetric,
  GridOperatorProfile,
  GridTopologyFeature,
} from './types'
import type { TopologyViewportQuery } from './topology/topologyViewportLoader'
import { selectedRegionId } from '@/services/region/regionContext'
import { useCesiumViewer, type CesiumViewerAssembleHooks } from './composables/useCesiumViewer'
import { useBaseMap } from './composables/useBaseMap'
import { useTerrain } from './composables/useTerrain'
import { useMapEntities } from './composables/useMapEntities'
import { useWeatherEntities } from './composables/useWeatherEntities'
import { useTopologyLayer } from './composables/useTopologyLayer'
import { useRegionBoundary } from './composables/useRegionBoundary'
import { useMapCamera } from './composables/useMapCamera'
import { useMapPicking, type MapHoverState } from './composables/useMapPicking'

const props = defineProps<{
  plants: GridGeoPlant[]
  viewMode: GridGeoViewMode
  selectedPlantId?: string | null
  terrainProvider: GridGeoTerrainProvider
  verticalExaggeration: number
  hillshadeEnabled: boolean
  weatherLayer: GridGeoWeatherLayer
  weatherItems: GridGeoWeatherSnapshot[]
  defaultCamera?: GridOperatorProfile['defaultCamera']
  marketLayer?: GridMarketLayer
  marketMetrics?: GridMarketMetric[]
  nodes?: GridGeoNode[]
  selectedNodeId?: string | null
  showLocatedNodes?: boolean
  topologyFeatures?: GridTopologyFeature[]
  selectedTopologyFeatureId?: string | null
  showTopology?: boolean
  topologyGridOperator?: 'csg' | 'sgcc'
  ariaLabel?: string
  ariaDescribedby?: string
}>()

const emit = defineEmits<{
  select: [selection: GridGeoSelection | null]
  'asset-select': [selection: GridGeoMapSelection | null]
  terrain: [status: GridGeoTerrainStatus]
  hillshade: [status: { available: boolean; error?: string }]
  runtime: [status: GridGeoRuntimeStatus]
  'topology-select': [selection: { featureId: string; x: number; y: number } | null]
  'topology-viewport': [viewport: TopologyViewportQuery]
}>()

const container = shallowRef<HTMLDivElement | null>(null)
const hoverState = ref<MapHoverState | null>(null)
const liveMessage = ref('地图已就绪。方向键浏览场站，Enter 选择，Escape 清除选择。')

// —— 关注点装配：viewer 生命周期在最底层，其余层经 getViewer 惰性取用 ——
const viewerState = useCesiumViewer({
  container,
  onRuntime: (status) => emit('runtime', status),
  onMapTokenChange: () => onMapTokenChange(),
  getInitialViewMode: () => props.viewMode,
})
const { viewer, initializationError } = viewerState
const getViewer = () => viewer.value

const terrain = useTerrain({
  getViewer,
  getProps: () => props,
  emitTerrain: (status) => emit('terrain', status),
  emitHillshade: (status) => emit('hillshade', status),
})
const weather = useWeatherEntities({ getViewer, isWeakNetwork: viewerState.isWeakNetwork, getProps: () => props })
const entities = useMapEntities({
  getViewer,
  isReduceMotion: viewerState.isReduceMotion,
  isCoarsePointer: viewerState.isCoarsePointer,
  getProps: () => props,
})
const topology = useTopologyLayer({
  getViewer,
  isWeakNetwork: viewerState.isWeakNetwork,
  getProps: () => props,
  emitTopologyViewport: (viewport) => emit('topology-viewport', viewport),
})
const boundary = useRegionBoundary({ getViewer })
const baseMap = useBaseMap({
  getViewer,
  liveMessage,
  getHillshadeEnabled: () => props.hillshadeEnabled,
  // 切底图的 removeAll(true) 连晕渲一起销毁，收尾统一按开关重建（见 useBaseMap.switchBaseMap）。
  rebuildHillshade: () => void terrain.applyHillshade(true),
})
const camera = useMapCamera({
  getViewer,
  container,
  isReduceMotion: viewerState.isReduceMotion,
  getProps: () => props,
  getBoundaryRectangle: boundary.getBoundaryRectangle,
  rebuildClouds: weather.rebuildClouds,
  applyLighting: terrain.applyLighting,
  liveMessage,
})
const picking = useMapPicking({
  getViewer,
  container,
  isCoarsePointer: viewerState.isCoarsePointer,
  hoverState,
  liveMessage,
  getProps: () => props,
  clusterPlantIds: entities.clusterPlantIds,
  topologyFeatureIdFromEntity: topology.featureIdFromEntity,
  onSelect: (selection) => emit('select', selection),
  onAssetSelect: (selection) => emit('asset-select', selection),
  onTopologySelect: (selection) => emit('topology-select', selection),
  focusPlantCluster: camera.focusPlantCluster,
  focusPlant: camera.focusPlant,
  resetView: () => camera.resetView(),
})
const {
  baseMapStatus, baseMapOptions, activeBaseMapId, baseMapMenuOpen,
  selectBaseMap, baseMapCredentialReady, baseMapCredentialHint,
} = baseMap
const { onMapKeydown } = picking
const { resetView } = camera

// Viewer 创建后订阅 resize 与相机 moveEnd（原 createViewer 1611–1616）。
let resizeObserver: ResizeObserver | null = null
let removeCameraMoveEnd: (() => void) | null = null
function attachResizeAndCameraTracking(target: Viewer) {
  resizeObserver = new ResizeObserver(() => target.resize())
  resizeObserver.observe(container.value!)
  removeCameraMoveEnd = target.camera.moveEnd.addEventListener(() => {
    entities.renderPlantEntities()
    topology.emitViewport()
  })
}

/** 装配钩子：执行点与拆分前 createViewer 的行序一一对应（见 useCesiumViewer.mount）。 */
const assembleHooks: CesiumViewerAssembleHooks = {
  beforeCreate: () => baseMap.initSequence(),
  onViewCreated: (created) => {
    topology.attachViewer(created)
    terrain.attachScene(created, props.viewMode)
  },
  onViewCreatedLate: (created) => weather.attachClouds(created),
  startLayers: () => {
    baseMap.start()
    void boundary.syncRegionBoundary()
  },
  attachInteraction: (created) => {
    picking.attach(created)
    attachResizeAndCameraTracking(created)
  },
  renderAll: () => {
    entities.renderPlantEntities()
    entities.renderNodeEntities()
    weather.renderWeatherEntities()
    topology.renderTopologyEntities()
  },
  applyShading: () => void terrain.applyHillshade(props.hillshadeEnabled),
  applyTerrain: () => terrain.applyTerrain(props.terrainProvider),
  initialCamera: () => {
    if (props.viewMode === '3d') camera.resetView(0)
    else camera.applyViewMode(props.viewMode)
  },
}

/**
 * ion token 在面板里被改过：底图与地形都可能因此从「不可用」变成「可用」，
 * 两者都要重建。不重建的话用户填完 token 得刷新页面才看得到效果。
 */
function onMapTokenChange() {
  if (!getViewer()) return
  const preferredId = baseMap.preferredBaseMapId()
  if (preferredId !== activeBaseMapId.value) selectBaseMap(preferredId)
  void terrain.applyTerrain(props.terrainProvider)
}

watch(() => props.plants, () => {
  entities.renderPlantEntities()
  weather.renderWeatherEntities()
}, { deep: false })
watch(() => props.nodes, entities.renderNodeEntities, { deep: false })
watch(() => props.showLocatedNodes, entities.renderNodeEntities)
watch(() => props.weatherItems, weather.renderWeatherEntities, { deep: false })
watch(() => props.weatherLayer, weather.renderWeatherEntities)
watch(() => props.marketMetrics, entities.renderPlantEntities, { deep: false })
watch(() => props.marketLayer, entities.renderPlantEntities)
watch(() => props.viewMode, (mode) => {
  camera.applyViewMode(mode)
  topology.renderTopologyEntities()
})
watch(() => props.selectedPlantId, entities.updateSelectionStyle)
watch(() => props.selectedNodeId, entities.updateNodeSelectionStyle)
watch(() => props.topologyFeatures, topology.renderTopologyEntities, { deep: false })
watch(() => props.selectedTopologyFeatureId, topology.renderTopologyEntities)
watch(() => props.showTopology, () => {
  topology.renderTopologyEntities()
  topology.emitViewport()
})
watch(() => props.topologyGridOperator, topology.renderTopologyEntities)
watch(() => props.terrainProvider, (kind) => void terrain.applyTerrain(kind))
watch(() => props.hillshadeEnabled, (enabled) => void terrain.applyHillshade(enabled))
watch(() => props.verticalExaggeration, (value) => {
  const current = getViewer()
  if (!current) return
  current.scene.verticalExaggeration = value
  current.scene.requestRender()
})
watch(() => props.defaultCamera, () => camera.resetView(0.8), { deep: true })
watch(selectedRegionId, () => void boundary.syncRegionBoundary())

onMounted(() => {
  viewerState.bootstrap(assembleHooks, (message) => {
    emit('terrain', {
      kind: 'ellipsoid',
      status: 'error',
      label: '地图初始化失败，未加载地形',
      error: message,
      fallbackFrom: props.terrainProvider,
    })
  })
})
onBeforeUnmount(() => {
  // 清理顺序与拆分前 onBeforeUnmount 一致：先撤挂起的飞行，再解各层监听，
  // 最后销毁 viewer 并归位各层状态。
  camera.disposeFlight()
  resizeObserver?.disconnect()
  viewerState.detachContext()
  baseMap.dispose()
  removeCameraMoveEnd?.()
  terrain.dispose()
  picking.dispose()
  viewerState.destroyViewer()
  weather.dispose()
  topology.dispose()
  entities.clearAll()
  boundary.dispose()
  resizeObserver = null
  removeCameraMoveEnd = null
})

defineExpose({
  focusPlant: camera.focusPlant,
  focusNode: camera.focusNode,
  resetView: camera.resetView,
  flyTerrainTour: camera.flyTerrainTour,
})
</script>

<template>
  <div
    ref="container"
    class="cesium-plant-map"
    role="region"
    tabindex="0"
    :aria-label="props.ariaLabel || '电厂三维地理空间地图'"
    :aria-describedby="props.ariaDescribedby ? `${props.ariaDescribedby} grid-geo-map-help` : 'grid-geo-map-help'"
    @keydown="onMapKeydown"
  >
    <span id="grid-geo-map-help" class="sr-only">方向键逐个浏览场站，Enter 或空格聚焦，Escape 清除选择，Home 恢复全景。</span>
    <span class="sr-only" aria-live="polite">{{ liveMessage }}</span>

    <div class="map-tools">
      <button type="button" class="map-tool" title="回到本省范围" @click="resetView()">
        <Crosshair :size="16" /> 复位
      </button>
      <div class="map-tool-group">
        <button type="button" class="map-tool" title="切换底图" @click="baseMapMenuOpen = !baseMapMenuOpen">
          <Layers :size="16" /> 底图
        </button>
        <ul v-if="baseMapMenuOpen" class="basemap-menu">
          <li v-for="option in baseMapOptions" :key="option.id">
            <button
              type="button"
              :class="{ active: option.id === activeBaseMapId }"
              :disabled="!baseMapCredentialReady(option)"
              :title="baseMapCredentialReady(option) ? undefined : baseMapCredentialHint(option)"
              @click="selectBaseMap(option.id)"
            >
              {{ option.label }}{{ baseMapCredentialReady(option) ? '' : ' · 未配置 token' }}
            </button>
          </li>
        </ul>
      </div>
    </div>
    <div
      v-if="baseMapStatus.state === 'degraded' || baseMapStatus.state === 'fallback'"
      class="provider-fallback"
      :class="baseMapStatus.state"
      role="status"
    >
      <strong>{{ baseMapStatus.label }}</strong>
      <span>{{ baseMapStatus.message }}</span>
    </div>
    <div
      v-if="hoverState"
      class="map-hover-card"
      :style="{ left: `${hoverState.x}px`, top: `${hoverState.y}px` }"
      aria-hidden="true"
    >
      <strong>{{ hoverState.title }}</strong>
      <span>{{ hoverState.detail }}</span>
    </div>
    <div v-if="initializationError" class="map-fallback" role="alert">
      <strong>三维地图暂不可用</strong>
      <span>{{ initializationError }}</span>
    </div>
  </div>
</template>

<style scoped>
.map-tools{position:absolute;z-index:9;right:12px;bottom:14px;display:flex;gap:8px;align-items:flex-end}
.map-tool-group{position:relative}
.map-tool{display:flex;align-items:center;gap:6px;padding:7px 12px;font-size: var(--font-lg);cursor:pointer;color:var(--text-body);border:1px solid var(--line);border-radius:8px;background:var(--panel)}
.map-tool:hover{color:var(--primary);border-color:var(--primary)}
.basemap-menu{position:absolute;right:0;bottom:calc(100% + 6px);min-width:190px;margin:0;padding:5px;list-style:none;border:1px solid var(--line);border-radius:9px;background:var(--panel);box-shadow:var(--shadow,0 12px 32px rgba(0,0,0,.14))}
.basemap-menu button{display:block;width:100%;padding:8px 10px;font-size: var(--font-lg);text-align:left;cursor:pointer;color:var(--text-body);border:0;border-radius:6px;background:transparent}
.basemap-menu button:disabled{cursor:not-allowed;opacity:.42}
.basemap-menu button:hover{background:var(--surface-hover)}
.basemap-menu button.active{color:var(--primary);background:var(--primary-tint)}
.cesium-plant-map {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 55% 40%, rgba(25, 117, 173, 0.2), transparent 42%),
    #020811;
  touch-action: none;
}

.cesium-plant-map:focus-visible {
  outline: 2px solid #31d9ff;
  outline-offset: -4px;
}

.map-fallback {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 8px;
  padding: 24px;
  color: #d7eef5;
  text-align: center;
  background: radial-gradient(circle at 50% 35%, rgba(44, 158, 188, 0.18), transparent 36%), #020811;
}

.map-fallback span { max-width: 520px; color: #7fa2af; font-size: var(--font-sm); }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.provider-fallback {
  position: absolute;
  z-index: 18;
  right: 14px;
  bottom: 38px;
  display: flex;
  max-width: min(360px, calc(100% - 28px));
  padding: 9px 11px;
  flex-direction: column;
  gap: 3px;
  color: #f7d88c;
  border: 1px solid rgba(235, 181, 72, .38);
  border-radius: 10px;
  background: rgba(42, 29, 8, .88);
  box-shadow: 0 12px 34px rgba(0, 0, 0, .32);
  pointer-events: none;
  backdrop-filter: blur(12px);
}

.provider-fallback strong { font-size: var(--font-xs); }
.provider-fallback span { color: #c8aa69; font-size: var(--font-9); line-height: 1.45; }

.map-hover-card {
  position: absolute;
  z-index: 17;
  display: flex;
  width: 230px;
  padding: 10px 11px;
  transform: translateY(-100%);
  flex-direction: column;
  gap: 3px;
  color: #e7fbff;
  border: 1px solid rgba(90, 220, 247, .35);
  border-radius: 10px;
  background: rgba(3, 20, 34, .92);
  box-shadow: 0 16px 38px rgba(0, 5, 14, .44);
  pointer-events: none;
  backdrop-filter: blur(14px);
}

.map-hover-card strong { overflow: hidden; font-size: var(--font-xs); text-overflow: ellipsis; white-space: nowrap; }
.map-hover-card span { overflow: hidden; color: #82afbd; font-size: var(--font-9); text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 620px), (pointer: coarse) {
  .map-hover-card { display: none; }
  .provider-fallback { right: 10px; bottom: 30px; left: 10px; max-width: none; }
}

:deep(.cesium-viewer),
:deep(.cesium-viewer-cesiumWidgetContainer),
:deep(.cesium-widget),
:deep(.cesium-widget canvas) {
  width: 100%;
  height: 100%;
}

:deep(.cesium-viewer-bottom) {
  right: 8px;
  bottom: 5px;
  left: auto;
  color: rgba(219, 239, 255, 0.72);
  font-size: var(--font-10);
  text-shadow: 0 1px 2px #000;
}
</style>
