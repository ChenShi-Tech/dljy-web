/**
 * 地图拾取与键盘导航 composable（#2802 拆分 CesiumPlantMap）。
 *
 * 点击命中分流（聚合展开 → 拓扑要素 → 节点 → 场站，顺序与拆分前一致）、
 * 悬停卡片内容、无障碍键盘导航（方向键巡场站、Enter 聚焦、Escape 清除、Home 复位）。
 * 事件只经回调上抛，emit 权在组件。
 */
import { ScreenSpaceEventHandler, ScreenSpaceEventType, defined, type Cartesian2, type Entity, type Viewer } from 'cesium'
import type { Ref } from 'vue'
import type {
  GridGeoMapSelection,
  GridGeoNode,
  GridGeoPlant,
  GridGeoSelection,
  GridTopologyFeature,
} from '../types'
import type { shallowRefCompat } from './useCesiumViewer'

export interface MapHoverState { x: number; y: number; title: string; detail: string }

export function useMapPicking(options: {
  getViewer: () => Viewer | null
  container: shallowRefCompat<HTMLDivElement | null>
  isCoarsePointer: () => boolean
  hoverState: Ref<MapHoverState | null>
  liveMessage: { value: string }
  getProps: () => {
    plants: GridGeoPlant[]
    nodes?: GridGeoNode[]
    selectedPlantId?: string | null
    topologyFeatures?: GridTopologyFeature[]
  }
  /** 聚合 billboard 的成员场站 id（useMapEntities）。 */
  clusterPlantIds: (entity: Entity) => string[]
  /** 命中实体到拓扑要素 id 的映射（useTopologyLayer）。 */
  topologyFeatureIdFromEntity: (entity: Entity) => string | null
  onSelect: (selection: GridGeoSelection | null) => void
  onAssetSelect: (selection: GridGeoMapSelection | null) => void
  onTopologySelect: (selection: { featureId: string; x: number; y: number } | null) => void
  focusPlantCluster: (plantIds: string[]) => void
  focusPlant: (plantId: string) => void
  /** Home 键复位（无参调用，取默认时长）。 */
  resetView: () => void
}) {
  const {
    getViewer, container, isCoarsePointer, hoverState, liveMessage, getProps,
    clusterPlantIds, topologyFeatureIdFromEntity,
    onSelect, onAssetSelect, onTopologySelect,
    focusPlantCluster, focusPlant, resetView,
  } = options
  let clickHandler: ScreenSpaceEventHandler | null = null

  function describePickedEntity(entity: Entity) {
    const viewer = getViewer()
    if (!viewer) return null
    const clusterIds = clusterPlantIds(entity)
    if (clusterIds.length) {
      const capacity = clusterIds.reduce((sum, plantId) => {
        const plant = getProps().plants.find((item) => item.plantId === plantId)
        return sum + (Number(plant?.capacityMw) || 0)
      }, 0)
      return {
        title: `${clusterIds.length} 座场站`,
        detail: `点击展开 · 已知装机 ${capacity.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} MW`,
      }
    }
    const topologyFeatureId = topologyFeatureIdFromEntity(entity)
    if (topologyFeatureId) {
      const feature = getProps().topologyFeatures?.find((item) => item.featureId === topologyFeatureId)
      return {
        title: feature?.name ?? entity.name ?? '授权网架要素',
        detail: `${feature?.kind === 'branch' ? '线路' : '变电站'} · 点击查看稳定引用`,
      }
    }
    const nodeId = String(entity.properties?.nodeId?.getValue(viewer.clock.currentTime) ?? '')
    if (nodeId) {
      const node = (getProps().nodes ?? []).find((item) => item.nodeId === nodeId)
      return { title: node?.nodeName ?? entity.name ?? '空间节点', detail: '点击查看节点信息' }
    }
    const plantId = String(entity.properties?.plantId?.getValue(viewer.clock.currentTime) ?? '')
    if (plantId) {
      const plant = getProps().plants.find((item) => item.plantId === plantId)
      return {
        title: plant?.standardName ?? entity.name ?? '空间资产',
        detail: plant ? `${plant.location.locationLabel} · 点击查看信息卡` : '点击查看信息卡',
      }
    }
    return null
  }

  function selectPlantForKeyboard(index: number) {
    const plants = getProps().plants
    if (!plants.length) return
    const currentIndex = plants.findIndex((plant) => plant.plantId === getProps().selectedPlantId)
    const nextIndex = currentIndex < 0
      ? (index > 0 ? 0 : plants.length - 1)
      : (currentIndex + index + plants.length) % plants.length
    const plant = plants[nextIndex]
    const x = Math.round((container.value?.clientWidth ?? 800) / 2)
    const y = Math.round((container.value?.clientHeight ?? 600) / 2)
    onSelect({ plantId: plant.plantId, x, y })
    onAssetSelect({ kind: 'plant', assetId: plant.plantId, plantId: plant.plantId, x, y })
    liveMessage.value = `已选择 ${plant.standardName}，${nextIndex + 1} / ${plants.length}。`
    focusPlant(plant.plantId)
  }

  function onMapKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      selectPlantForKeyboard(1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      selectPlantForKeyboard(-1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const selectedPlantId = getProps().selectedPlantId
      if (selectedPlantId) focusPlant(selectedPlantId)
      else selectPlantForKeyboard(1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      hoverState.value = null
      onSelect(null)
      onAssetSelect(null)
      onTopologySelect(null)
      liveMessage.value = '已清除地图选择。'
    } else if (event.key === 'Home') {
      event.preventDefault()
      resetView()
      liveMessage.value = '已恢复区域全景。'
    }
  }

  /** Viewer 创建后接点击与悬停（原 createViewer 1557–1609）。 */
  function attach(viewer: Viewer) {
    clickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    clickHandler.setInputAction((movement: { position: Cartesian2 }) => {
      const current = getViewer()
      if (!current) return
      const picked = current.scene.pick(movement.position)
      if (!defined(picked) || !picked.id) {
        onSelect(null)
        onAssetSelect(null)
        onTopologySelect(null)
        return
      }
      const entity = picked.id as Entity
      const clusterIds = clusterPlantIds(entity)
      if (clusterIds.length) {
        focusPlantCluster(clusterIds)
        return
      }
      const topologyFeatureId = topologyFeatureIdFromEntity(entity)
      if (topologyFeatureId) {
        onTopologySelect({ featureId: topologyFeatureId, x: movement.position.x, y: movement.position.y })
        return
      }
      const nodeId = String(entity.properties?.nodeId?.getValue(current.clock.currentTime) ?? '')
      const assetId = String(entity.properties?.assetId?.getValue(current.clock.currentTime) ?? '')
      if (nodeId) {
        onTopologySelect(null)
        onAssetSelect({ kind: 'node', assetId: assetId || nodeId, nodeId, x: movement.position.x, y: movement.position.y })
        return
      }
      const plantId = String(entity.properties?.plantId?.getValue(current.clock.currentTime) ?? '')
      if (!plantId) {
        onSelect(null)
        onAssetSelect(null)
        return
      }
      const selection = { plantId, x: movement.position.x, y: movement.position.y }
      onTopologySelect(null)
      onSelect(selection)
      onAssetSelect({ kind: 'plant', assetId: plantId, ...selection })
    }, ScreenSpaceEventType.LEFT_CLICK)
    clickHandler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      const current = getViewer()
      if (!current || isCoarsePointer()) return
      const picked = current.scene.pick(movement.endPosition)
      const entity = defined(picked) && picked.id ? picked.id as Entity : null
      const description = entity ? describePickedEntity(entity) : null
      current.scene.canvas.style.cursor = description ? 'pointer' : 'grab'
      hoverState.value = description
        ? {
            x: Math.min(movement.endPosition.x + 16, Math.max(12, (container.value?.clientWidth ?? 0) - 250)),
            y: Math.max(64, movement.endPosition.y - 12),
            ...description,
          }
        : null
    }, ScreenSpaceEventType.MOUSE_MOVE)
  }

  /** 卸载时销毁拾取处理器（对应原 1703）。 */
  function dispose() {
    clickHandler?.destroy()
    clickHandler = null
  }

  return { attach, onMapKeydown, dispose }
}
