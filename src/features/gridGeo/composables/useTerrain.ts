/**
 * 地形、地表光照与晕渲（山体阴影）composable（#2802 拆分 CesiumPlantMap）。
 *
 * 三者都在「把地形立体感呈现出来」这一条链上：地形 provider 给几何、
 * 方向光给明暗、晕渲给免 token 档的视觉兜底，故合在一层管理。
 */
import {
  ArcGISTiledElevationTerrainProvider,
  ArcGisMapServerImageryProvider,
  Cartesian3,
  DirectionalLight,
  EllipsoidTerrainProvider,
  ImageryLayer,
  Ion,
  createWorldTerrainAsync,
  type TerrainProvider,
  type Viewer,
} from 'cesium'
import { resolveArcgisToken, resolveIonToken } from '../../../config/mapTokens'
import type { GridGeoTerrainProvider, GridGeoTerrainStatus, GridGeoViewMode } from '../types'

/**
 * 晕渲（山体阴影）源降级链。
 *
 * 原默认是 `services.arcgisonline.com/.../World_Hillshade_Dark`，实测该子域对本项目
 * 出口 IP 15s 超时无响应，于是「叠加多向地形晕渲」这个默认勾选的复选框长期恒失败——
 * 而它恰恰是免 token 档唯一能让人看出地形起伏的视觉线索（ArcGIS Terrain 3D 没有
 * 顶点法线，光照算不出山体明暗）。
 *
 * 换到可达的 `server.` 子域后实测：World_Hillshade 12 并发全 200、0.90–2.89s。
 * 保留第二档 World_Shaded_Relief（同域、更快、观感偏柔和）以防单个服务抖动。
 */
export const HILLSHADE_URL_FALLBACKS = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer',
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer',
] as const

export function useTerrain(options: {
  getViewer: () => Viewer | null
  getProps: () => { verticalExaggeration: number; hillshadeEnabled: boolean }
  emitTerrain: (status: GridGeoTerrainStatus) => void
  emitHillshade: (status: { available: boolean; error?: string }) => void
}) {
  const { getViewer, getProps, emitTerrain, emitHillshade } = options
  let terrainRequestId = 0
  let hillshadeRequestId = 0
  let hillshadeLayer: ImageryLayer | null = null
  let sceneLight: DirectionalLight | null = null
  let removePreRender: (() => void) | null = null
  const lightDirectionScratch = new Cartesian3()
  const lightOffsetScratch = new Cartesian3()

  /** 光相对相机的偏移：向右 0.45、向下 0.62，即光源位于相机左上方。 */
  const LIGHT_RIGHT_BIAS = 0.45
  const LIGHT_UP_BIAS = 0.62

  /**
   * 地表光照：跟随相机的偏移方向光。
   *
   * 【为什么不是关掉光照】历史上为治「地图太暗」把 `globe.enableLighting` 写死成 false。
   * 那确实治好了「夜半球全黑」，但同时把地形立体感一并砍掉了——Cesium 的地表明暗
   * 100% 来自光照对地表法线的着色，关掉之后无论加载的是多精细的地形，屏幕上都是一张
   * 平的贴图。「切了 3D 地形却看不出 3D」的第一根因就在这里。
   *
   * 【为什么不是直接打开】默认光源是 SunLight（跟真太阳走），打开就会把地球分昼夜，
   * 当地夜里进页面就是一片黑——正是当年关掉它的理由，不能原样退回去。
   *
   * 【本方案】改用 DirectionalLight，方向锁定在「相机的左上后方」并逐帧跟随相机：
   * 相机看到的地表永远在受光面（不会有夜半球），而地表法线随山坡朝向变化仍产生明暗，
   * 山脊亮、背坡暗，立体感回来了。偏移量是关键——若光方向正好等于相机朝向（headlight），
   * 各处入射角趋同，明暗被抹平，等于白开。
   */
  function updateSceneLight() {
    const viewer = getViewer()
    if (!viewer || !sceneLight) return
    const camera = viewer.camera
    const direction = Cartesian3.clone(camera.directionWC, lightDirectionScratch)
    Cartesian3.multiplyByScalar(camera.rightWC, LIGHT_RIGHT_BIAS, lightOffsetScratch)
    Cartesian3.add(direction, lightOffsetScratch, direction)
    Cartesian3.multiplyByScalar(camera.upWC, LIGHT_UP_BIAS, lightOffsetScratch)
    Cartesian3.subtract(direction, lightOffsetScratch, direction)
    Cartesian3.normalize(direction, direction)
    sceneLight.direction = Cartesian3.clone(direction, sceneLight.direction)
  }

  /**
   * 按视图模式与地形档位调光。
   *
   * 2D（平面地图）下地表法线全部朝向观察者，光照只会平白压暗底图，故关闭。
   * 三维下开启；`arcgis-terrain` 因为没有顶点法线拿不到山体明暗（阴影靠晕渲图层补），
   * 但开着光照仍有价值——地球曲率造成的边缘渐暗会让球体读起来更立体。
   */
  function applyLighting(mode: GridGeoViewMode) {
    const viewer = getViewer()
    if (!viewer) return
    const globe = viewer.scene.globe
    globe.enableLighting = mode !== '2d'
    // 提高漫反射系数、压低阴影下限，让山脊/背坡的明暗差拉开又不至于死黑。
    globe.lambertDiffuseMultiplier = 1.45
    globe.vertexShadowDarkness = 0.32
    updateSceneLight()
  }

  /** Viewer 创建时接方向光与 preRender 订阅（原 createViewer 1510–1514、1529）。 */
  function attachScene(viewer: Viewer, viewMode: GridGeoViewMode) {
    // 地表光照：用跟随相机的方向光取代太阳，既有山体明暗又不会出现夜半球（见 applyLighting）。
    sceneLight = new DirectionalLight({ direction: Cartesian3.clone(Cartesian3.UNIT_Z), intensity: 2.6 })
    viewer.scene.light = sceneLight
    applyLighting(viewMode)
    // 相机一动就要重算光向，否则转到另一侧时明暗关系会僵在原处。
    removePreRender = viewer.scene.preRender.addEventListener(updateSceneLight)
    viewer.scene.verticalExaggeration = getProps().verticalExaggeration
  }

  function terrainLabel(kind: GridGeoTerrainProvider) {
    if (kind === 'arcgis-terrain') return 'ArcGIS Terrain 3D'
    if (kind === 'cesium-world-terrain') return 'Cesium World Terrain'
    return 'Cesium 椭球地形'
  }

  async function createTerrainProvider(kind: GridGeoTerrainProvider): Promise<TerrainProvider> {
    if (kind === 'ellipsoid') return new EllipsoidTerrainProvider()
    if (kind === 'arcgis-terrain') {
      const url = String(import.meta.env.VITE_GRID_GEO_ARCGIS_TERRAIN_URL ?? 'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer').trim()
      const token = resolveArcgisToken()
      return ArcGISTiledElevationTerrainProvider.fromUrl(url, token ? { token } : undefined)
    }
    const token = resolveIonToken()
    if (!token) throw new Error('未配置 Cesium ion token')
    Ion.defaultAccessToken = token
    // 顶点法线是这一档存在的全部理由：只有它能让 globe 光照算出山体明暗。
    // ArcGIS Terrain 3D（LERC 高程）的 hasVertexNormals 在 Cesium 里恒为 false，
    // 几何起伏是真的、山坡阴影是没有的，靠晕渲图层补（见 applyHillshade）。
    return createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true })
  }

  async function applyTerrain(requested: GridGeoTerrainProvider) {
    const viewer = getViewer()
    if (!viewer) return
    const requestId = ++terrainRequestId
    emitTerrain({ kind: requested, status: 'loading', label: terrainLabel(requested) })
    try {
      const provider = await createTerrainProvider(requested)
      const current = getViewer()
      if (!current || requestId !== terrainRequestId) return
      current.terrainProvider = provider
      current.scene.globe.depthTestAgainstTerrain = requested !== 'ellipsoid'
      current.scene.verticalExaggeration = getProps().verticalExaggeration
      emitTerrain({ kind: requested, status: 'ready', label: terrainLabel(requested) })
      current.scene.requestRender()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const fallback: GridGeoTerrainProvider = requested === 'cesium-world-terrain' ? 'arcgis-terrain' : 'ellipsoid'
      console.warn(`[grid-geo] ${terrainLabel(requested)} 不可用，回退 ${terrainLabel(fallback)}`, error)
      try {
        const provider = await createTerrainProvider(fallback)
        const current = getViewer()
        if (!current || requestId !== terrainRequestId) return
        current.terrainProvider = provider
        current.scene.globe.depthTestAgainstTerrain = fallback !== 'ellipsoid'
        current.scene.verticalExaggeration = getProps().verticalExaggeration
        emitTerrain({ kind: fallback, status: 'fallback', label: terrainLabel(fallback), error: message, fallbackFrom: requested })
        current.scene.requestRender()
      } catch (fallbackError) {
        const current = getViewer()
        if (!current || requestId !== terrainRequestId) return
        current.terrainProvider = new EllipsoidTerrainProvider()
        current.scene.globe.depthTestAgainstTerrain = false
        emitTerrain({
          kind: 'ellipsoid',
          status: 'error',
          label: terrainLabel('ellipsoid'),
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          fallbackFrom: requested,
        })
      }
    }
  }

  async function applyHillshade(enabled: boolean) {
    const viewer = getViewer()
    if (!viewer) return
    const requestId = ++hillshadeRequestId
    if (hillshadeLayer) {
      viewer.imageryLayers.remove(hillshadeLayer, true)
      hillshadeLayer = null
    }
    if (!enabled) return
    const explicit = String(import.meta.env.VITE_GRID_GEO_HILLSHADE_URL ?? '').trim()
    const candidates = explicit ? [explicit] : [...HILLSHADE_URL_FALLBACKS]
    let lastError: unknown = null
    try {
      for (const url of candidates) {
        try {
          const provider = await ArcGisMapServerImageryProvider.fromUrl(url)
          const current = getViewer()
          if (!current || requestId !== hillshadeRequestId || !getProps().hillshadeEnabled) return
          hillshadeLayer = current.imageryLayers.addImageryProvider(provider)
          // 参数是配着卫星影像底图调的，实测过两个失败方向：
          //   alpha 0.28（原值，配矢量街道图）→ 山形几乎看不出来
          //   alpha 0.52 + contrast 1.28      → 灰度晕渲把影像洗成灰白，植被/裸岩的颜色全没了
          // 0.36 是「山脊河谷读得出、影像本色还在」的位置；brightness 略压让阴影侧沉下去，
          // 阴影本来就该是这一层的全部贡献。
          hillshadeLayer.alpha = 0.36
          hillshadeLayer.brightness = 0.94
          hillshadeLayer.contrast = 1.18
          current.scene.requestRender()
          emitHillshade({ available: true })
          return
        } catch (attemptError) {
          lastError = attemptError
          if (!getViewer() || requestId !== hillshadeRequestId) return
        }
      }
      throw lastError ?? new Error('晕渲源全部不可用')
    } catch (error) {
      // 只 console.warn 的话，面板上复选框还勾着、用户以为晕渲生效了。
      // 失败仍属可能（换域后实测可达，但外网抖动、企业代理仍会拦），必须让 UI 可见。
      const message = error instanceof Error ? error.message : String(error)
      console.warn('[grid-geo] ArcGIS World Hillshade 不可用，保留当前底图', error)
      emitHillshade({ available: false, error: message })
    }
  }

  /** 解绑 preRender、释放方向光与晕渲层引用（viewer 销毁前调用，对应原 1699–1701、1708）。 */
  function dispose() {
    removePreRender?.()
    removePreRender = null
    sceneLight = null
    hillshadeLayer = null
  }

  return { applyLighting, attachScene, applyTerrain, applyHillshade, terrainLabel, dispose }
}
