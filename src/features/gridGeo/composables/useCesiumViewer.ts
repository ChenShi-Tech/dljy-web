/**
 * Cesium Viewer 生命周期 composable（#2802 拆分 CesiumPlantMap）。
 *
 * 负责：Viewer 构造参数与 scene 全局视觉参数、弱网/减少动效性能档位、
 * WebGL 上下文丢失与恢复、偏好与凭据变更监听、销毁清理。
 * 跨关注点的装配（底图首装、实体渲染、镜头初始化）经 hooks 由组件注入，
 * 执行顺序与拆分前的 createViewer 逐行对齐。
 */
import { ref, shallowRef } from 'vue'
import { Color, EllipsoidTerrainProvider, Viewer } from 'cesium'
import { MAP_TOKEN_CHANGE_EVENT } from '../../../config/mapTokens'
import type { GridGeoRuntimeStatus, GridGeoViewMode } from '../types'

/** 弱网/减少动效档位：requestRenderMode 与瓦片缓存随网络与系统偏好收敛。 */
export function runtimePerformanceProfile() {
  const connection = (navigator as Navigator & { connection?: EventTarget & { effectiveType?: string; saveData?: boolean } }).connection
  const weakNetwork = connection?.saveData === true || ['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '')
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  return {
    weakNetwork,
    reducedMotion,
    effectiveType: connection?.effectiveType ?? 'unknown',
    dataSaver: connection?.saveData === true,
    requestRenderMode: weakNetwork || reducedMotion,
    maximumScreenSpaceError: weakNetwork ? 4 : 2,
    tileCacheSize: weakNetwork ? 80 : 200,
  }
}

/** 性能档位变化时要联动重建的渲染面（由组件接各实体 composable）。 */
export interface CesiumViewerRenderHooks {
  rebuildClouds(): void
  renderPlantEntities(): void
  renderTopologyEntities(): void
}

/** Viewer 创建/首装期的装配钩子，执行点与拆分前 createViewer 的行序一一对应。 */
export interface CesiumViewerAssembleHooks {
  /** Viewer 构造前：底图降级序列要按当前 token 状态先算好。 */
  beforeCreate(): void
  /** Viewer 构造后立即：拓扑渲染器创建、地表方向光与 preRender 订阅。 */
  onViewCreated(viewer: Viewer): void
  /** scene 视觉参数与偏好监听就位后：云层原语挂载。 */
  onViewCreatedLate(viewer: Viewer): void
  /** 底图首装 + 省界同步（原 switchBaseMap(0) 与 syncRegionBoundary 调用点）。 */
  startLayers(): void
  /** 点击拾取、悬停、resize 与相机 moveEnd 订阅（原 1557–1616）。 */
  attachInteraction(viewer: Viewer): void
  /** 全量实体首渲染（原 renderEntities）。 */
  renderAll(): void
  /** 晕渲首装（原 applyHillshade(props.hillshadeEnabled)）。 */
  applyShading(): void
  /** 地形首装（原 applyTerrain(props.terrainProvider)）。 */
  applyTerrain(): Promise<void> | void
  /** 初始镜头：3d 复位 / 2d 走 morph。 */
  initialCamera(): void
}

export function useCesiumViewer(options: {
  container: shallowRefCompat<HTMLDivElement | null>
  onRuntime: (status: GridGeoRuntimeStatus) => void
  onMapTokenChange: () => void
  /** 拆分前 scene 视觉参数在 mount 时刻读 props.viewMode；以 getter 保持同一取值时机。 */
  getInitialViewMode: () => GridGeoViewMode
}) {
  const { container, onRuntime, onMapTokenChange } = options
  const viewer = shallowRef<Viewer | null>(null)
  const initializationError = ref('')
  let runtimeStatus: GridGeoRuntimeStatus | null = null
  let reduceMotionEnabled = false
  let coarsePointer = false
  let motionPreference: MediaQueryList | null = null
  let connectionPreference: (EventTarget & { effectiveType?: string; saveData?: boolean }) | null = null
  let renderHooks: CesiumViewerRenderHooks | null = null

  function isReduceMotion() {
    return reduceMotionEnabled
  }

  function isCoarsePointer() {
    return coarsePointer
  }

  /** rebuildClouds 等渲染联动按弱网档收敛，拓扑 LOD 也读它。 */
  function isWeakNetwork() {
    return runtimeStatus?.network === 'weak'
  }

  function setRenderHooks(hooks: CesiumViewerRenderHooks) {
    renderHooks = hooks
  }

  /** 档位变化：clock/渲染模式/globe 细节 + 云层与拓扑联动重建，最后对外广播。 */
  function applyRuntimePerformanceProfile() {
    const profile = runtimePerformanceProfile()
    reduceMotionEnabled = profile.reducedMotion
    runtimeStatus = {
      network: profile.weakNetwork ? 'weak' : 'normal',
      renderMode: profile.requestRenderMode ? 'on-demand' : 'continuous',
      webgl: runtimeStatus?.webgl ?? 'ready',
      tileCacheSize: profile.tileCacheSize,
      reducedMotion: profile.reducedMotion,
      effectiveType: profile.effectiveType,
      dataSaver: profile.dataSaver,
    }
    const current = viewer.value
    if (current) {
      current.clock.shouldAnimate = !profile.reducedMotion
      current.scene.requestRenderMode = profile.requestRenderMode
      current.scene.maximumRenderTimeChange = profile.requestRenderMode ? Number.POSITIVE_INFINITY : 0
      current.scene.globe.maximumScreenSpaceError = profile.maximumScreenSpaceError
      current.scene.globe.tileCacheSize = profile.tileCacheSize
      renderHooks?.rebuildClouds()
      renderHooks?.renderTopologyEntities()
      current.scene.requestRender()
    }
    onRuntime(runtimeStatus)
  }

  function onRuntimePreferenceChange() {
    applyRuntimePerformanceProfile()
  }

  function onWebglContextLost(event: Event) {
    event.preventDefault()
    if (!runtimeStatus) return
    runtimeStatus = { ...runtimeStatus, webgl: 'lost' }
    onRuntime(runtimeStatus)
  }

  function onWebglContextRestored() {
    if (!runtimeStatus) return
    runtimeStatus = { ...runtimeStatus, webgl: 'restored' }
    onRuntime(runtimeStatus)
    viewer.value?.scene.requestRender()
  }

  /**
   * 创建 Viewer 并按拆分前的装配顺序接齐各关注点。
   * 行序与原 createViewer 一致：钩子间穿插的全是 viewer 本体（scene 视觉、监听器）的配置。
   */
  async function mount(hooks: CesiumViewerAssembleHooks) {
    const target = container.value
    if (!target) return
    const performanceProfile = runtimePerformanceProfile()
    reduceMotionEnabled = performanceProfile.reducedMotion
    coarsePointer = window.matchMedia?.('(pointer: coarse)').matches === true
    hooks.beforeCreate()

    viewer.value = new Viewer(target, {
      baseLayer: false,
      terrainProvider: new EllipsoidTerrainProvider(),
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: !performanceProfile.reducedMotion,
      requestRenderMode: performanceProfile.requestRenderMode,
      maximumRenderTimeChange: performanceProfile.requestRenderMode ? Number.POSITIVE_INFINITY : 0,
    })
    const current = viewer.value
    hooks.onViewCreated(current)

    current.scene.backgroundColor = Color.fromCssColorString('#071523')
    // 地球基色决定「影像未加载处」的观感。原 #0a2233 过深，未贴图区域近乎纯黑，
    // 整个地球显脏；抬到中蓝后低层级瓦片与缝隙仍能看清轮廓。
    current.scene.globe.baseColor = Color.fromCssColorString('#16405f')
    current.scene.globe.dynamicAtmosphereLighting = false
    current.scene.globe.dynamicAtmosphereLightingFromSun = false
    current.scene.globe.atmosphereLightIntensity = 20
    current.scene.globe.depthTestAgainstTerrain = true
    current.scene.globe.maximumScreenSpaceError = performanceProfile.maximumScreenSpaceError
    current.scene.globe.tileCacheSize = performanceProfile.tileCacheSize
    applyRuntimePerformanceProfile()
    current.scene.canvas.addEventListener('webglcontextlost', onWebglContextLost)
    current.scene.canvas.addEventListener('webglcontextrestored', onWebglContextRestored)
    motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
    motionPreference?.addEventListener('change', onRuntimePreferenceChange)
    connectionPreference = (navigator as Navigator & { connection?: EventTarget & { effectiveType?: string; saveData?: boolean } }).connection ?? null
    connectionPreference?.addEventListener('change', onRuntimePreferenceChange)
    window.addEventListener(MAP_TOKEN_CHANGE_EVENT, onMapTokenChange)
    current.scene.fog.enabled = true
    current.scene.fog.density = 0.00015
    if (current.scene.skyAtmosphere) {
      current.scene.skyAtmosphere.show = options.getInitialViewMode() === '3d'
      current.scene.skyAtmosphere.hueShift = -0.02
      // 原来 saturationShift/brightnessShift 都是负值，等于主动把大气调暗调灰。
      // 改为正向微调，地球边缘亮起来，整体不再发闷。
      current.scene.skyAtmosphere.saturationShift = 0.05
      current.scene.skyAtmosphere.brightnessShift = 0.12
      current.scene.skyAtmosphere.atmosphereLightIntensity = 22
    }
    if (current.scene.sun) current.scene.sun.show = options.getInitialViewMode() === '3d'
    current.scene.sunBloom = options.getInitialViewMode() === '3d'
    current.scene.highDynamicRange = true
    current.scene.postProcessStages.fxaa.enabled = true

    // 清晰度
    // Cesium 默认 resolutionScale = 1，即按 CSS 像素渲染。Retina（devicePixelRatio=2）
    // 下等于用一半分辨率渲染再放大，这是「地图糊」的主因，与配色无关。
    // 按 dPR 渲染并封顶 2，避免 3x 屏上像素量翻 9 倍拖垮帧率。
    current.resolutionScale = Math.min(window.devicePixelRatio || 1, 2)
    // MSAA 是几何级抗锯齿，质量高于 fxaa 后处理；地形与线要素边缘明显更干净。
    if ('msaaSamples' in current.scene) current.scene.msaaSamples = 4
    hooks.onViewCreatedLate(current)
    hooks.startLayers()
    hooks.attachInteraction(current)
    hooks.renderAll()
    hooks.applyShading()
    await hooks.applyTerrain()
    hooks.initialCamera()
  }

  /** onMounted 的完整语义：清错误态、创建 Viewer；失败落错误横幅与 runtime/terrain 事件。 */
  function bootstrap(
    hooks: CesiumViewerAssembleHooks,
    onInitializationFailed: (message: string) => void,
  ) {
    initializationError.value = ''
    void mount(hooks).catch((cause) => {
      initializationError.value = cause instanceof Error ? cause.message : '当前设备无法初始化三维地图'
      onInitializationFailed(initializationError.value)
      runtimeStatus = {
        network: 'normal', renderMode: 'on-demand', webgl: 'unavailable', tileCacheSize: 0,
        reducedMotion: reduceMotionEnabled, effectiveType: 'unknown', dataSaver: false,
      }
      onRuntime(runtimeStatus)
    })
  }

  /** 销毁第一段：解绑 canvas 与偏好/token 监听（viewer 还活着，对应原 1693–1696、1702）。 */
  function detachContext() {
    viewer.value?.scene.canvas.removeEventListener('webglcontextlost', onWebglContextLost)
    viewer.value?.scene.canvas.removeEventListener('webglcontextrestored', onWebglContextRestored)
    motionPreference?.removeEventListener('change', onRuntimePreferenceChange)
    connectionPreference?.removeEventListener('change', onRuntimePreferenceChange)
    window.removeEventListener(MAP_TOKEN_CHANGE_EVENT, onMapTokenChange)
  }

  /** 销毁第二段：destroy viewer 并归位本层状态（对应原 1704–1710 的 viewer 部分）。 */
  function destroyViewer() {
    viewer.value?.destroy()
    viewer.value = null
    reduceMotionEnabled = false
    motionPreference = null
    connectionPreference = null
  }

  return {
    viewer,
    initializationError,
    isReduceMotion,
    isCoarsePointer,
    isWeakNetwork,
    setRenderHooks,
    applyRuntimePerformanceProfile,
    bootstrap,
    detachContext,
    destroyViewer,
  }
}

/** 组件里传 ShallowRef / Ref 都兼容的最小结构（只读 .value）。 */
type shallowRefCompat<T> = { readonly value: T }

export type { shallowRefCompat }
