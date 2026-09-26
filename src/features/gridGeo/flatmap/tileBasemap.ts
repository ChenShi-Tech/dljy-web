/**
 * 天地图瓦片底图层（垫在 ECharts canvas 之下）
 * ------------------------------------------------------------------
 * 为什么自己画而不是引 Leaflet / OpenLayers / echarts-extension-*：
 *
 * - `echarts-extension-leaflet` 把 `echarts: ^5.5.0` 和 `leaflet` 列为
 *   **dependencies 而非 peerDependencies**，装它会拽进第二份 ECharts 5 与本仓的
 *   ECharts 6 并存，且扩展注册到的是它自己那份实例——等于两套 ECharts 各画各的。
 * - 引 Leaflet/OpenLayers 则要把现有 881 行覆盖物（场站、光圈、拓扑、下钻）全部
 *   从 ECharts 迁走，改造面远大于收益。
 *
 * 本层只做一件事：按 ECharts geo 当前视口，把 Mercator 瓦片贴成轴对齐矩形。
 * 前提是 geo 已切到 `MERCATOR_PROJECTION`（见 webMercator.ts），两者投影同源，
 * 所以贴图不需要任何变形，`drawImage` 即可。
 *
 * **降级是这一层的一等公民**：无 tk、瓦片连续失败、或宿主处于内网时，本层什么都
 * 不画并上报状态，ECharts geo 的政区填色图照常工作。交付现场是否有外网尚未确认，
 * 所以在线底图只能是增强项，不能成为地图可用性的前提。
 */
import {
  buildTiandituTileUrl,
  resolveTiandituLayer,
  type TiandituLayerId,
} from './tiandituLayers'
import { latitudeToTileY, longitudeToTileX, pickTileZoom, tileCount, tileXToLongitude, tileYToLatitude } from './webMercator'

export type TileBasemapState = 'off' | 'loading' | 'ready' | 'error'

export interface TileBasemapStatus {
  state: TileBasemapState
  /** off 时说明为什么关着；error 时是人读的失败原因。 */
  reason?: string
  /** ready 时本次实际贴了多少张。 */
  tiles?: number
}

export interface TileBasemapHost {
  container: HTMLElement
  /** 经纬度 → 容器内 CSS 像素；geo 未就绪时返回 null。 */
  toPixel: (lngLat: [number, number]) => [number, number] | null
  /** 容器内 CSS 像素 → 经纬度。 */
  toLngLat: (pixel: [number, number]) => [number, number] | null
}

export interface TileBasemapOptions {
  layerId?: TiandituLayerId
  /** 取 tk 的函数而非值：tk 可在面板里随时改，取值必须是每次渲染时的最新值。 */
  token: () => string
  showAnnotation?: boolean
  opacity?: number
  onStatus?: (status: TileBasemapStatus) => void
}

/** 亮底图层之上的暗色蒙版。取值以「地物仍可辨认、但不再压过覆盖物」为准。 */
const LIGHT_TONE_SCRIM = 'rgba(8, 20, 34, 0.46)'

/** 一屏最多贴多少张。超出说明层级选过头了，宁可降一级也不要发几百个请求。 */
const MAX_TILES_PER_FRAME = 160
/** 连续失败多少张就判定这条链路不通，停止请求并降级。 */
const FAILURE_THRESHOLD = 6

/**
 * 缓存的瓦片上限。roam 可以走遍任意经纬度与层级，不设上限的话每张走过的瓦片都会
 * 被这个 Map 一直引用到 reset/destroy——长时间平移缩放就是一路涨的内存。按 LRU
 * 淘汰，当前视口的瓦片刚被访问过，永远排在最新一端不会被误淘汰。
 * 320 ≈ 两屏（一屏上限 160 张，含注记层），够覆盖 roam 时的来回抖动。
 */
const MAX_CACHED_TILES = 320

/** 单张瓦片失败后多久允许重试。低于这个间隔重试等于把失败请求刷成风暴。 */
const TILE_RETRY_AFTER_MS = 8_000

type TileImage = {
  img: HTMLImageElement
  loaded: boolean
  failed: boolean
  /** 失败时刻，用于判断是否已过重试间隔。 */
  failedAt: number
}

export function createTileBasemap(host: TileBasemapHost, options: TileBasemapOptions) {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0'
  canvas.style.opacity = String(options.opacity ?? 1)
  // 垫在最底下：ECharts 自己的 canvas 由它插在容器里，晚于本 canvas 追加即在其上。
  host.container.insertBefore(canvas, host.container.firstChild)

  const cache = new Map<string, TileImage>()
  let consecutiveFailures = 0
  let disposed = false
  let rafId: number | null = null
  let lastStatus: TileBasemapStatus | null = null

  function report(status: TileBasemapStatus) {
    // 同状态不重复上报，否则 roam 期间每帧一次会把宿主的 watcher 打爆。
    if (lastStatus && lastStatus.state === status.state && lastStatus.reason === status.reason) return
    lastStatus = status
    options.onStatus?.(status)
  }

  function loadTile(url: string): TileImage {
    const cached = cache.get(url)
    if (cached) {
      // 单张瓦片偶发失败（网络抖动、服务端瞬时 5xx）不该让那块地方永远是个洞：
      // 过了重试间隔就重新发一次，而不是此后每帧都跳过它。
      if (!(cached.failed && Date.now() - cached.failedAt >= TILE_RETRY_AFTER_MS)) {
        // LRU：重新插到末尾，标记为最近使用。
        cache.delete(url)
        cache.set(url, cached)
        return cached
      }
      // 换新请求前先作废旧的：那一张失败时浏览器可能仍在重试或已排队响应，回调
      // 活着的话，迟到的 onload 会把 consecutiveFailures 清零，把「链路不通」的
      // 判定无限期推迟；迟到的 onerror 则会重复计数。
      discard(cached)
      cache.delete(url)
    }
    const img = new Image()
    const entry: TileImage = { img, loaded: false, failed: false, failedAt: 0 }
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      entry.loaded = true
      consecutiveFailures = 0
      schedule()
    }
    img.onerror = () => {
      entry.failed = true
      entry.failedAt = Date.now()
      consecutiveFailures += 1
      if (consecutiveFailures >= FAILURE_THRESHOLD) {
        // 不是抖动而是链路不通（内网、tk 失效、被墙）。停手比继续刷失败请求好。
        report({ state: 'error', reason: '天地图瓦片连续加载失败，已回退到本地政区图' })
        clear()
      }
    }
    img.src = url
    cache.set(url, entry)
    evictOverflow()
    return entry
  }

  /**
   * 断开一个条目的回调。凡是把条目移出 cache 的地方都必须先走这里——留着回调的
   * 在途请求回来后仍会改动 `consecutiveFailures`，而它对应的瓦片早已不在缓存里。
   */
  function discard(entry: TileImage) {
    entry.img.onload = null
    entry.img.onerror = null
  }

  /** 按插入顺序（= LRU 顺序）淘汰最久未用的条目。 */
  function evictOverflow() {
    while (cache.size > MAX_CACHED_TILES) {
      const oldest = cache.keys().next()
      if (oldest.done) return
      const entry = cache.get(oldest.value)
      if (entry) discard(entry)
      cache.delete(oldest.value)
    }
  }

  function clear() {
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  function draw() {
    rafId = null
    if (disposed) return

    const token = options.token()
    if (!token) {
      clear()
      report({ state: 'off', reason: '未配置天地图 tk' })
      return
    }
    if (lastStatus?.state === 'error') return

    const width = host.container.clientWidth
    const height = host.container.clientHeight
    if (!(width > 0) || !(height > 0)) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    // 视口经纬度范围：取容器左上与右下两角反投影。geo 未就绪时 toLngLat 返回 null。
    const topLeft = host.toLngLat([0, 0])
    const bottomRight = host.toLngLat([width, height])
    if (!topLeft || !bottomRight) return
    const west = Math.min(topLeft[0], bottomRight[0])
    const east = Math.max(topLeft[0], bottomRight[0])
    const north = Math.max(topLeft[1], bottomRight[1])
    const south = Math.min(topLeft[1], bottomRight[1])
    if (!Number.isFinite(west) || !Number.isFinite(east) || east <= west) return

    let zoom = pickTileZoom(east - west, width)
    let xFrom = Math.floor(longitudeToTileX(west, zoom))
    let xTo = Math.ceil(longitudeToTileX(east, zoom))
    let yFrom = Math.floor(latitudeToTileY(north, zoom))
    let yTo = Math.ceil(latitudeToTileY(south, zoom))
    // 层级选过头（视口很扁很长时会发生）：降级直到瓦片数落进预算。
    while (zoom > 1 && (xTo - xFrom) * (yTo - yFrom) > MAX_TILES_PER_FRAME) {
      zoom -= 1
      xFrom = Math.floor(longitudeToTileX(west, zoom))
      xTo = Math.ceil(longitudeToTileX(east, zoom))
      yFrom = Math.floor(latitudeToTileY(north, zoom))
      yTo = Math.ceil(latitudeToTileY(south, zoom))
    }

    const layer = resolveTiandituLayer(options.layerId)
    const codes = options.showAnnotation === false ? [layer.code] : [layer.code, layer.annotationCode]
    const limit = tileCount(zoom)
    let painted = 0
    let pending = 0

    for (const code of codes) {
      for (let x = xFrom; x < xTo; x += 1) {
        for (let y = yFrom; y < yTo; y += 1) {
          if (y < 0 || y >= limit) continue
          // 经度方向环绕：-1 列即东经末列，取模保证索引合法。
          const col = ((x % limit) + limit) % limit
          const url = buildTiandituTileUrl(code, zoom, col, y, token)
          if (!url) continue
          const tile = loadTile(url)
          if (tile.failed) continue
          if (!tile.loaded) { pending += 1; continue }

          const nw = host.toPixel([tileXToLongitude(x, zoom), tileYToLatitude(y, zoom)])
          const se = host.toPixel([tileXToLongitude(x + 1, zoom), tileYToLatitude(y + 1, zoom)])
          if (!nw || !se) continue
          const w = se[0] - nw[0]
          const h = se[1] - nw[1]
          if (!(w > 0) || !(h > 0)) continue
          // +1 消除相邻瓦片间的亚像素缝（不补的话缩放时会出现网格状白线）
          ctx.drawImage(tile.img, nw[0], nw[1], w + 1, h + 1)
          painted += 1
        }
      }
    }

    // 亮底图层（矢量政区 / 地形晕渲）必须压暗才能和深色驾驶舱主题共存：不压的话
    // 整块亮绿贴在深色 UI 里像开了个洞，覆盖物的浅色描边也会一起糊掉。draw 每次
    // 都是全量重绘（上面先 clearRect），所以这层蒙版不会随重绘次数越叠越黑。
    if (painted > 0 && layer.tone === 'light') {
      ctx.fillStyle = LIGHT_TONE_SCRIM
      ctx.fillRect(0, 0, width, height)
    }

    report(pending > 0 ? { state: 'loading' } : { state: 'ready', tiles: painted })
  }

  function schedule() {
    if (disposed || rafId !== null) return
    rafId = window.requestAnimationFrame(draw)
  }

  return {
    /** geo 视口变化后调用；内部按帧合并，roam 期间高频调用是安全的。 */
    render: schedule,
    /**
     * 面板改了图层/tk、或宿主换了地区后调用：清缓存与失败态，重新尝试。
     * 旧 tk 的在途请求必须一并作废——不作废的话它们的 onerror 会算到新 tk 头上，
     * 够 6 张就把刚换上的 tk 直接判成「链路不通」降级掉。
     */
    reset() {
      for (const entry of cache.values()) discard(entry)
      cache.clear()
      consecutiveFailures = 0
      lastStatus = null
      clear()
      schedule()
    },
    setOpacity(value: number) {
      canvas.style.opacity = String(value)
    },
    destroy() {
      disposed = true
      if (rafId !== null) window.cancelAnimationFrame(rafId)
      for (const entry of cache.values()) discard(entry)
      cache.clear()
      canvas.remove()
    },
  }
}
