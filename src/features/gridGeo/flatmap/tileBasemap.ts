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

type TileImage = { img: HTMLImageElement; loaded: boolean; failed: boolean }

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
    if (cached) return cached
    const img = new Image()
    const entry: TileImage = { img, loaded: false, failed: false }
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      entry.loaded = true
      consecutiveFailures = 0
      schedule()
    }
    img.onerror = () => {
      entry.failed = true
      consecutiveFailures += 1
      if (consecutiveFailures >= FAILURE_THRESHOLD) {
        // 不是抖动而是链路不通（内网、tk 失效、被墙）。停手比继续刷失败请求好。
        report({ state: 'error', reason: '天地图瓦片连续加载失败，已回退到本地政区图' })
        clear()
      }
    }
    img.src = url
    cache.set(url, entry)
    return entry
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
    /** 面板改了图层/tk 后调用：清缓存与失败态，重新尝试。 */
    reset() {
      cache.clear()
      consecutiveFailures = 0
      lastStatus = null
      schedule()
    },
    setOpacity(value: number) {
      canvas.style.opacity = String(value)
    },
    destroy() {
      disposed = true
      if (rafId !== null) window.cancelAnimationFrame(rafId)
      cache.clear()
      canvas.remove()
    },
  }
}
