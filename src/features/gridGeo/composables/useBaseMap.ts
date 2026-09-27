/**
 * 底图 composable（#2802 拆分 CesiumPlantMap）。
 *
 * 消费 `src/config/mapProviders.ts` 注册表：按优先级序列装配影像层，
 * 瓦片连续失败自动沿免费链降级；凭据未就位的源在菜单里置灰。
 * 切换期间的乱序竞态（ion 工厂 await 很慢）用单调请求 id + 最后意图队列兜住。
 */
import { ref } from 'vue'
import {
  Ion,
  IonImageryProvider,
  OpenStreetMapImageryProvider,
  RequestScheduler,
  UrlTemplateImageryProvider,
  type ImageryLayer,
  type ImageryProvider,
  type Viewer,
} from 'cesium'
import {
  BASE_MAP_PROVIDERS,
  TIANDITU_REQUESTS_PER_SERVER,
  isThrottledTileError,
  listBaseMapProviders,
  resolveBaseMapSequenceWithPreferred,
  resolvePreferredBaseMapId,
  shouldFallbackBaseMap,
  type BaseMapProviderConfig,
} from '../../../config/mapProviders'
import { resolveIonToken, resolveTiandituToken } from '../../../config/mapTokens'
import { TIANDITU_SUBDOMAINS, buildTiandituTemplateUrl } from '../flatmap/tiandituLayers'

/**
 * 该底图源的凭据是否已就位（决定它在底图菜单里可不可选）。
 *
 * 按 `tokenEnvKey` 分派而不是「除 ion 外一律 false」：新增一个需凭据的源时若忘了在这里
 * 加分支，它会在菜单里永远置灰——用户配好了 tk 也选不了，且没有任何提示说明为什么。
 * 天地图就踩过这一条（codex 审查发现）。
 */
export function baseMapCredentialReady(config: BaseMapProviderConfig) {
  if (!config.requiresToken) return true
  switch (config.tokenEnvKey) {
    case 'VITE_CESIUM_ION_TOKEN':
      return resolveIonToken().length > 0
    case 'VITE_TIANDITU_TOKEN':
      return resolveTiandituToken().length > 0
    default:
      return false
  }
}

/** 凭据缺失时的提示。天地图 tk 可在页面上配，指向 env 变量名会把人引到错的地方。 */
export function baseMapCredentialHint(config: BaseMapProviderConfig): string {
  if (config.tokenEnvKey === 'VITE_TIANDITU_TOKEN') return '需先配置天地图 tk（平面图左下角「底图」按钮，或构建期 VITE_TIANDITU_TOKEN）'
  return `需配置 ${config.tokenEnvKey}`
}

export function useBaseMap(options: {
  getViewer: () => Viewer | null
  liveMessage: { value: string }
  getHillshadeEnabled: () => boolean
  /** 切底图会销毁全部影像层（晕渲也在其中），收尾时按开关重建。 */
  rebuildHillshade: () => void
}) {
  const { getViewer, liveMessage, getHillshadeEnabled, rebuildHillshade } = options
  const baseMapStatus = ref<{
    state: 'loading' | 'ready' | 'degraded' | 'fallback'
    label: string
    message: string
  }>({ state: 'loading', label: '正在加载免费底图', message: '' })
  const baseMapOptions = listBaseMapProviders()
  const activeBaseMapId = ref(baseMapOptions[0]?.id ?? '')
  const baseMapMenuOpen = ref(false)
  let baseMapSequence: BaseMapProviderConfig[] = []
  let activeBaseMapIndex = -1
  let baseMapErrorCount = 0
  let baseMapRequestId = 0
  /** 切换进行中收到的最新意图；只保留最后一次，中间态没有展示价值。 */
  let pendingBaseMapRequest: { index: number; reason: string } | null = null
  let baseMapSwitching = false
  let removeBaseMapErrorListener: (() => void) | null = null

  /** 有排队请求则立即接上，返回是否已接管后续流程。 */
  function flushPendingBaseMap() {
    const next = pendingBaseMapRequest
    pendingBaseMapRequest = null
    if (!next || !getViewer()) return false
    void switchBaseMap(next.index, next.reason)
    return true
  }

  /** 把底图配置描述符翻译成 Cesium ImageryProvider；solid-color 由 globe.baseColor 承担。 */
  // ion 走异步工厂（fromAssetId 要先换 endpoint 凭据），故返回值可能是 Promise，
  // 由 switchBaseMap 统一 await。
  function createBaseImageryProvider(config: BaseMapProviderConfig): ImageryProvider | Promise<ImageryProvider> | null {
    if (config.kind === 'solid-color') return null
    if (config.kind === 'ion') {
      const token = resolveIonToken()
      if (!token) throw new Error(`${config.label} 需要 Cesium ion token`)
      Ion.defaultAccessToken = token
      return IonImageryProvider.fromAssetId(Number(config.ionAssetId))
    }
    if (config.kind === 'tianditu') {
      // tk 与二维平面图共用同一份运行时凭据；没配就抛错，交给外层的降级链换下一个源。
      const url = buildTiandituTemplateUrl(config.tiandituLayer ?? 'img', resolveTiandituToken())
      if (!url) throw new Error(`${config.label} 需要天地图 tk`)
      // 压低每子域并发：Cesium 默认 6，乘 8 个子域就是 48 路齐发，天地图的配额扛不住，
      // 表现为一开图就一片 429。调度器按 "host:port" 记账，逐个子域设。
      for (const subdomain of TIANDITU_SUBDOMAINS) {
        RequestScheduler.requestsByServer[`${subdomain}.tianditu.gov.cn:443`] = TIANDITU_REQUESTS_PER_SERVER
      }
      return new UrlTemplateImageryProvider({
        url,
        credit: config.credit,
        // 天地图开放 t0–t7 八个子域，分散浏览器对单域名的并发连接上限
        subdomains: [...TIANDITU_SUBDOMAINS],
        maximumLevel: 18,
      })
    }
    if (config.kind === 'url-template') {
      return new UrlTemplateImageryProvider({
        url: config.url,
        credit: config.credit,
        ...(config.subdomains ? { subdomains: config.subdomains } : {}),
      })
    }
    return new OpenStreetMapImageryProvider({ url: config.url, credit: config.credit })
  }

  function applyLayerAdjustment(layer: ImageryLayer, config: BaseMapProviderConfig) {
    layer.brightness = config.adjustment.brightness
    layer.contrast = config.adjustment.contrast
    layer.saturation = config.adjustment.saturation
    layer.gamma = config.adjustment.gamma
    if (config.adjustment.alpha !== undefined) layer.alpha = config.adjustment.alpha
  }

  // 本函数开头的 imageryLayers.removeAll(true) 会连 applyHillshade 加入的图层
  // 一起销毁，而 hillshadeEnabled prop 未变不触发 watcher 重建。重建必须收敛在这里，
  // 覆盖「用户手动切换」与「瓦片连续失败自动 fallback」两条路径。
  async function switchBaseMap(index: number, reason = '') {
    const viewer = getViewer()
    if (!viewer) return
    if (baseMapSwitching) {
      // ion 的 fromAssetId 可能慢到用户已经改主意。直接 return 会把这次选择丢掉，
      // 且旧请求完成后还会把它覆盖回去；改为记住最后一次意图，当前切换收尾时接上。
      pendingBaseMapRequest = { index, reason }
      return
    }
    const config = baseMapSequence[index] ?? baseMapSequence.at(-1)
    if (!config) return
    const configIndex = Math.max(0, baseMapSequence.indexOf(config))
    // ion 工厂是异步的：await 期间用户可能又切了一次、组件可能已卸载。用单调 id
    // 判定过期，避免旧请求把新选择覆盖回去（布尔闸只能防并发、防不了乱序回填）。
    const requestId = ++baseMapRequestId
    baseMapSwitching = true

    let provider: ImageryProvider | null
    try {
      provider = await createBaseImageryProvider(config)
    } catch {
      baseMapSwitching = false
      if (flushPendingBaseMap()) return
      if (!getViewer() || requestId !== baseMapRequestId) return
      void switchBaseMap(configIndex + 1, '底图初始化失败')
      return
    }
    // 先 await 再拆旧图层：否则 ion 换凭据这段时间里地球是空的。
    const current = getViewer()
    if (!current || requestId !== baseMapRequestId) {
      baseMapSwitching = false
      flushPendingBaseMap()
      return
    }
    // await 期间用户可能已另选底图；先接上它，别把旧结果装上去。
    if (pendingBaseMapRequest) {
      baseMapSwitching = false
      flushPendingBaseMap()
      return
    }
    removeBaseMapErrorListener?.()
    removeBaseMapErrorListener = null
    current.imageryLayers.removeAll(true)
    activeBaseMapIndex = configIndex
    // 菜单高亮跟随实际生效的 provider：env 指定了别的底图、或瓦片报错自动
    // fallback 时，都不能还高亮注册表第一项。
    activeBaseMapId.value = config.id
    baseMapErrorCount = 0
    if (!provider) {
      baseMapStatus.value = {
        state: 'fallback',
        label: config.label,
        message: '外部底图不可用，已切换内置地球底色；资产图元、选择与地形控制仍可使用。',
      }
      liveMessage.value = baseMapStatus.value.message
      baseMapSwitching = false
      if (flushPendingBaseMap()) return
      current.scene.requestRender()
      return
    }

    const layer = current.imageryLayers.addImageryProvider(provider)
    applyLayerAdjustment(layer, config)
    removeBaseMapErrorListener = provider.errorEvent.addEventListener((error) => {
      if (!getViewer() || baseMapSwitching || baseMapSequence[activeBaseMapIndex]?.id !== config.id) return
      // 429 是**限流**不是服务不可用。三维一帧要的瓦片数远多于二维，天地图这类有 QPS
      // 配额的源很容易撞到；把它计成故障会在瓦片最密的那几秒把底图换掉，用户看到的是
      // 「刚打开就掉到备用源」。Cesium 自己会重试这类瓦片，这里放行不计数。
      if (isThrottledTileError(error)) return
      baseMapErrorCount += 1
      baseMapStatus.value = {
        state: 'degraded',
        label: config.label,
        message: '底图瓦片响应异常，正在自动切换免费备用源。',
      }
      if (!shouldFallbackBaseMap(baseMapErrorCount)) return
      void switchBaseMap(activeBaseMapIndex + 1, '瓦片连续失败')
    })
    baseMapStatus.value = {
      state: index > 0 ? 'fallback' : 'ready',
      label: config.label,
      message: index > 0 ? `${reason || '首选源不可用'}，已切换免费备用底图。` : '',
    }
    if (index > 0) liveMessage.value = baseMapStatus.value.message
    baseMapSwitching = false
    if (flushPendingBaseMap()) return
    // 本函数开头 removeAll(true) 连山体阴影一起销毁；在此统一重建，手动切换与
    // 瓦片错误自动 fallback 两条路径都会经过这里。
    if (getHillshadeEnabled()) rebuildHillshade()
    current.scene.requestRender()
  }

  /** 切底图（影像 / 逻辑图）。 */
  function selectBaseMap(id: string) {
    const config = BASE_MAP_PROVIDERS[id]
    if (!config) return
    // 需 token 却没配的源点了必失败，菜单已禁用它；这里再挡一次，避免键盘/程序化调用绕过。
    if (config.requiresToken && !baseMapCredentialReady(config)) return
    baseMapMenuOpen.value = false
    activeBaseMapId.value = id
    const index = baseMapSequence.findIndex((item) => item.id === id)
    if (index >= 0) {
      void switchBaseMap(index, '用户切换底图')
      return
    }
    // 目标不在当前序列里，需 token 的源被排除在自动降级链外，显式 VITE_GRID_GEO_BASEMAP
    // 指向免费源时 ion 也不在链上。以它为首选重建序列，其后仍接完整免费降级链。
    baseMapSequence = resolveBaseMapSequenceWithPreferred(id)
    void switchBaseMap(0, '用户切换底图')
  }

  /** Viewer 创建前按当前凭据状态确定降级序列（原 createViewer 1481–1484）。 */
  function initSequence() {
    baseMapSequence = resolveBaseMapSequenceWithPreferred(resolvePreferredBaseMapId({
      explicitId: import.meta.env.VITE_GRID_GEO_BASEMAP,
      hasIonToken: resolveIonToken().length > 0,
    }))
  }

  /** Viewer 创建后首装底图（原 createViewer 1554）。 */
  function start() {
    void switchBaseMap(0)
  }

  /** token 变更后重算首选源 id（onMapTokenChange 用，读数逻辑与 initSequence 同源）。 */
  function preferredBaseMapId() {
    return resolvePreferredBaseMapId({
      explicitId: import.meta.env.VITE_GRID_GEO_BASEMAP,
      hasIonToken: resolveIonToken().length > 0,
    })
  }

  /** 解绑瓦片错误监听（对应原 1697）。 */
  function dispose() {
    removeBaseMapErrorListener?.()
    removeBaseMapErrorListener = null
  }

  return {
    baseMapStatus,
    baseMapOptions,
    activeBaseMapId,
    baseMapMenuOpen,
    selectBaseMap,
    baseMapCredentialReady,
    baseMapCredentialHint,
    initSequence,
    start,
    preferredBaseMapId,
    dispose,
  }
}
