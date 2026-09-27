/**
 * 相机镜头 composable（#2802 拆分 CesiumPlantMap）。
 *
 * 复位（优先省界包围盒）、聚焦场站/节点、2D/3D morph 与变形后的重新框选、
 * 地形巡视镜头。所有飞行时长都受「减少动效」偏好收敛为 0。
 */
import { BoundingSphere, Cartesian3, HeadingPitchRange, Rectangle, SceneMode, type Entity, type Viewer } from 'cesium'
import type { GridGeoNode, GridGeoPlant, GridGeoViewMode, GridOperatorProfile } from '../types'
import type { shallowRefCompat } from './useCesiumViewer'

export function useMapCamera(options: {
  getViewer: () => Viewer | null
  container: shallowRefCompat<HTMLDivElement | null>
  isReduceMotion: () => boolean
  getProps: () => {
    plants: GridGeoPlant[]
    nodes?: GridGeoNode[]
    viewMode: GridGeoViewMode
    defaultCamera?: GridOperatorProfile['defaultCamera']
  }
  /** 省界包围盒：有省界时「复位」飞省域而不是运营商全景。 */
  getBoundaryRectangle: () => Rectangle | null
  /** 2D/3D morph 会重建云层朝向与光照，由组件接 terrain/weather 两层。 */
  rebuildClouds: () => void
  applyLighting: (mode: GridGeoViewMode) => void
  liveMessage: { value: string }
}) {
  const { getViewer, container, isReduceMotion, getProps, getBoundaryRectangle, rebuildClouds, applyLighting, liveMessage } = options
  let viewResetTimer: number | null = null
  /** morphComplete 的取消订阅句柄；切换过快时要先撤掉上一次的。 */
  let morphCompleteHandle: (() => void) | null = null

  /** 清掉挂起的变形兜底定时器与 morphComplete 订阅（聚焦前、卸载时都要调）。 */
  function clearFlightTimers() {
    if (viewResetTimer !== null) {
      window.clearTimeout(viewResetTimer)
      viewResetTimer = null
    }
  }

  function resetView(duration = 1.2) {
    const viewer = getViewer()
    if (!viewer) return
    const effectiveDuration = isReduceMotion() ? 0 : duration
    // 优先飞到当前省的实际范围；没有省界时才退回运营商全景镜头（它可能落在很远的
    // 区域中心，正是「一复位就跑飞」的来源）。
    const boundaryRectangle = getBoundaryRectangle()
    if (boundaryRectangle) {
      viewer.camera.flyTo({ destination: boundaryRectangle, duration: effectiveDuration })
      return
    }
    const camera = getProps().defaultCamera ?? { longitude: 102.15, latitude: 24.85, heightM: 2_450_000 }
    const aspect = Math.max(0.2, (container.value?.clientWidth ?? 1200) / Math.max(1, container.value?.clientHeight ?? 800))
    const narrowViewportFactor = aspect < 0.75 ? Math.min(1.8, 0.75 / aspect) : 1
    if (getProps().viewMode === '3d') {
      viewer.camera.flyToBoundingSphere(
        new BoundingSphere(Cartesian3.fromDegrees(camera.longitude, camera.latitude, 1800), camera.heightM * 0.2),
        { duration: effectiveDuration, offset: new HeadingPitchRange(-0.12, -0.64, camera.heightM * 0.48 * narrowViewportFactor) }
      )
      return
    }
    const longitudeSpan = Math.min(22, Math.max(5, camera.heightM / 250_000) * narrowViewportFactor)
    const latitudeSpan = longitudeSpan * 0.62
    viewer.camera.flyTo({
      destination: Rectangle.fromDegrees(camera.longitude - longitudeSpan / 2, camera.latitude - latitudeSpan / 2, camera.longitude + longitudeSpan / 2, camera.latitude + latitudeSpan / 2),
      duration: effectiveDuration,
    })
  }

  function focusPlant(plantId: string) {
    const viewer = getViewer()
    if (!viewer) return
    clearFlightTimers()
    const entity = viewer.entities.getById(`plant:${plantId}`)
    const plant = getProps().plants.find((item) => item.plantId === plantId)
    if (!entity && !plant) return
    const range = getProps().viewMode === '2d' ? 520000 : 190000
    if (!entity && plant) {
      viewer.camera.flyToBoundingSphere(
        new BoundingSphere(Cartesian3.fromDegrees(plant.location.longitude, plant.location.latitude), 2_000),
        {
          duration: isReduceMotion() ? 0 : 1.15,
          offset: new HeadingPitchRange(0, getProps().viewMode === '2d' ? -Math.PI / 2 : -0.62, range),
        },
      )
      return
    }
    if (!entity) return
    void viewer.flyTo(entity as Entity, {
      duration: isReduceMotion() ? 0 : 1.15,
      offset: new HeadingPitchRange(0, getProps().viewMode === '2d' ? -Math.PI / 2 : -0.62, range),
    })
  }

  function focusNode(nodeId: string) {
    const viewer = getViewer()
    if (!viewer) return
    clearFlightTimers()
    const node = (getProps().nodes ?? []).find((item) => item.nodeId === nodeId)
    const entity = node ? viewer.entities.getById(`node:${node.assetId || node.nodeId}`) : null
    if (!entity) return
    const range = getProps().viewMode === '2d' ? 420000 : 150000
    void viewer.flyTo(entity, {
      duration: isReduceMotion() ? 0 : 1.05,
      offset: new HeadingPitchRange(0, getProps().viewMode === '2d' ? -Math.PI / 2 : -0.62, range),
    })
  }

  function applyViewMode(mode: GridGeoViewMode) {
    const viewer = getViewer()
    if (!viewer) return
    clearFlightTimers()
    if (viewer.scene.mode === SceneMode.MORPHING) viewer.scene.completeMorph()
    const duration = isReduceMotion() ? 0 : 0.85
    if (mode === '2d') viewer.scene.morphTo2D(duration)
    else viewer.scene.morphTo3D(duration)
    applyLighting(mode)
    viewer.scene.fog.enabled = mode !== '2d'
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = mode === '3d'
    if (viewer.scene.sun) viewer.scene.sun.show = mode === '3d'
    rebuildClouds()
    if (isReduceMotion()) {
      resetView(0)
      return
    }
    // morphTo2D/3D 会把相机拉到全球视角，必须在变形结束后重新框住省域，否则用户点一下
    // 2D/3D 就看见整个地球。此前用 900ms 定时器兜——morph 本身 0.85s，两者卡在边缘，
    // 变形尚未结束时发出的 flyTo 会被丢弃，于是相机就停在全球视角上。
    // 改由 morphComplete 驱动；定时器保留为兜底（该事件在某些降级路径下不触发）。
    if (morphCompleteHandle) {
      morphCompleteHandle()
      morphCompleteHandle = null
    }
    const scene = viewer.scene
    morphCompleteHandle = scene.morphComplete.addEventListener(() => {
      if (morphCompleteHandle) {
        morphCompleteHandle()
        morphCompleteHandle = null
      }
      clearFlightTimers()
      resetView(0.7)
    })
    viewResetTimer = window.setTimeout(() => {
      viewResetTimer = null
      if (morphCompleteHandle) {
        morphCompleteHandle()
        morphCompleteHandle = null
      }
      resetView(0.7)
    }, 1600)
  }

  /**
   * 地形巡视镜头：飞到本次可见资产里高差最大的一段，用贴近地表的低视角看地形。
   *
   * 省域默认镜头在 245 万米高、俯角 -37°，云南 6000m 的高差在这个视距下只有约 0.7%
   * 的凹凸——地形加载得再对，肉眼也读不出立体感。「地形是不是真的生效了」这个问题
   * 不该靠用户自己拖拽找角度来回答，给一个按钮直接把镜头放到能看见山的地方。
   */
  function flyTerrainTour() {
    const viewer = getViewer()
    if (!viewer) return
    clearFlightTimers()
    const { plants } = getProps()
    const located = plants.filter((plant) => Number.isFinite(plant.location.longitude) && Number.isFinite(plant.location.latitude))
    const camera = getProps().defaultCamera ?? { longitude: 102.15, latitude: 24.85, heightM: 2_450_000 }
    // 优先挑海拔最高的场站——它周边一定是山区，是最能体现地形的取景点。
    const peak = located.reduce<GridGeoPlant | null>((best, plant) => {
      const elevation = Number(plant.location.elevationM ?? Number.NaN)
      if (!Number.isFinite(elevation)) return best
      const bestElevation = Number(best?.location.elevationM ?? Number.NEGATIVE_INFINITY)
      return elevation > bestElevation ? plant : best
    }, null)
    const target = peak
      ? Cartesian3.fromDegrees(peak.location.longitude, peak.location.latitude, Number(peak.location.elevationM ?? 0))
      : Cartesian3.fromDegrees(camera.longitude, camera.latitude, 1800)
    viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 12_000), {
      duration: isReduceMotion() ? 0 : 1.6,
      // 俯角 -26°、视距 120km：实测 78km 时山体占满整屏、一个场站图标都露不出来，
      // 「巡视」得同时看得见地形和资产才算数。再平就只剩天际线，再远又退回看不出起伏。
      offset: new HeadingPitchRange(-0.42, -0.46, 120_000),
    })
  }

  /** 展开聚合：飞到聚合成员的包围球并同步无障碍播报。 */
  function focusPlantCluster(plantIds: string[]) {
    const viewer = getViewer()
    if (!viewer) return
    const positions = plantIds
      .map((plantId) => getProps().plants.find((plant) => plant.plantId === plantId))
      .filter((plant): plant is GridGeoPlant => Boolean(plant))
      .map((plant) => Cartesian3.fromDegrees(plant.location.longitude, plant.location.latitude))
    if (!positions.length) return
    viewer.camera.flyToBoundingSphere(BoundingSphere.fromPoints(positions), {
      duration: isReduceMotion() ? 0 : 0.9,
      offset: new HeadingPitchRange(0, -0.72, Math.max(120_000, BoundingSphere.fromPoints(positions).radius * 5.2)),
    })
    liveMessage.value = `已展开 ${positions.length} 座场站聚合。`
  }

  /** 卸载第一段：撤掉挂起的变形定时器与订阅（对应原 1689–1691，必须在 viewer.destroy 前）。 */
  function disposeFlight() {
    clearFlightTimers()
    if (morphCompleteHandle) { morphCompleteHandle(); morphCompleteHandle = null }
  }

  return { resetView, focusPlant, focusNode, applyViewMode, flyTerrainTour, focusPlantCluster, disposeFlight }
}
