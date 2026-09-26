/**
 * @vitest-environment happy-dom
 *
 * 本模块要往 DOM 插 canvas、要 `new Image()`、要 requestAnimationFrame，node 环境
 * 跑不了。文件级 docblock 优先于 vitest.config 里 node project 的设置（同
 * `src/config/mapTokens.spec.ts`）。
 *
 * happy-dom 没有 2D 上下文实现，`getContext('2d')` 返回 null——draw 会在那里提前
 * 返回，瓦片循环一行都跑不到。所以下面把 getContext 换成记账用的假上下文；这不是
 * 为了「让测试过」，而是因为要断言的东西（请求了哪些瓦片）本就在绘制之前决定。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTileBasemap } from './tileBasemap'

/** 云南全域视口，与实机一致：容器 1200×800，经度跨 97.4–106.3、纬度跨 21.0–29.4。 */
const FULL_PROVINCE = { west: 97.4, east: 106.3, south: 21.0, north: 29.4 }
const YUNNAN_VIEW = { ...FULL_PROVINCE }

let container: HTMLElement
let created: FakeImage[]

class FakeImage {
  crossOrigin = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  #src = ''
  constructor() { created.push(this) }
  set src(value: string) { this.#src = value }
  get src() { return this.#src }
}

function mount(overrides: Partial<Parameters<typeof createTileBasemap>[1]> = {}) {
  return createTileBasemap(
    {
      container,
      toPixel: ([lng, lat]) => [
        ((lng - YUNNAN_VIEW.west) / (YUNNAN_VIEW.east - YUNNAN_VIEW.west)) * 1200,
        ((YUNNAN_VIEW.north - lat) / (YUNNAN_VIEW.north - YUNNAN_VIEW.south)) * 800,
      ],
      toLngLat: ([px, py]) => [
        YUNNAN_VIEW.west + (px / 1200) * (YUNNAN_VIEW.east - YUNNAN_VIEW.west),
        YUNNAN_VIEW.north - (py / 800) * (YUNNAN_VIEW.north - YUNNAN_VIEW.south),
      ],
    },
    { token: () => 'TK', ...overrides },
  )
}

/** 同步跑掉挂起的那一帧。 */
function flush() {
  vi.advanceTimersByTime(32)
}

beforeEach(() => {
  Object.assign(YUNNAN_VIEW, FULL_PROVINCE)
  vi.useFakeTimers()
  created = []
  container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', { value: 1200, configurable: true })
  Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true })
  document.body.append(container)
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform() {}, clearRect() {}, drawImage() {}, fillRect() {}, fillStyle: '',
  } as unknown as CanvasRenderingContext2D)
})

afterEach(() => {
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('createTileBasemap 挂载', () => {
  it('canvas 垫在容器最底层，且不吃鼠标事件', () => {
    const echartsCanvas = document.createElement('canvas')
    container.append(echartsCanvas)
    mount()
    const first = container.firstElementChild as HTMLCanvasElement
    expect(first.tagName).toBe('CANVAS')
    expect(first).not.toBe(echartsCanvas)
    expect(first.style.pointerEvents).toBe('none')
    expect(first.style.zIndex).toBe('0')
  })
})

describe('无 tk 时的降级（现场无外网的兜底路径）', () => {
  it('立即报 off，且一个瓦片请求都不发', () => {
    const onStatus = vi.fn()
    mount({ token: () => '', onStatus }).render()
    flush()
    expect(onStatus).toHaveBeenCalledWith({ state: 'off', reason: '未配置天地图 tk' })
    expect(created).toHaveLength(0)
  })

  it('同一状态不重复上报，roam 期间不会把宿主 watcher 打爆', () => {
    const onStatus = vi.fn()
    const basemap = mount({ token: () => '', onStatus })
    for (let i = 0; i < 5; i += 1) { basemap.render(); flush() }
    expect(onStatus).toHaveBeenCalledTimes(1)
  })
})

describe('瓦片索引与层级', () => {
  /**
   * 这条是本模块最重要的护栏。实机踩过一次：坐标换算错位时瓦片**请求全部 200**、
   * 控制台零报错，只是算出的矩形落在视口外，一张都画不上——从任何日志都看不出问题。
   * 所以这里断的是手算出来的绝对值，不是拿被测代码自己算的期望值。
   *
   * 手算：视口宽 1200px / 256 = 4.6875 屏内瓦片，经度跨 8.9° →
   *   全球瓦片数 4.6875 × (360 / 8.9) ≈ 189.6 → zoom = round(log2 189.6) = 8。
   *   列 = (lng + 180) / 360 × 256：97.4°→197、106.3°→203。
   *   行按 Mercator：29.4°→106、21.0°→112。
   */
  it('云南全域 → z8、列 197–203、行 106–112，底图与注记各一套', () => {
    mount().render()
    flush()
    const urls = created.map((img) => new URL(img.src))
    expect(urls.length).toBeGreaterThan(0)

    const zooms = new Set(urls.map((u) => u.searchParams.get('TILEMATRIX')))
    expect([...zooms]).toEqual(['8'])

    const cols = urls.map((u) => Number(u.searchParams.get('TILECOL')))
    const rows = urls.map((u) => Number(u.searchParams.get('TILEROW')))
    expect(Math.min(...cols)).toBe(197)
    expect(Math.max(...cols)).toBe(203)
    expect(Math.min(...rows)).toBe(106)
    expect(Math.max(...rows)).toBe(112)

    // 影像底图 + 对应注记层，缺一层就是「有图无地名」或「有地名无图」
    expect(new Set(urls.map((u) => u.searchParams.get('LAYER')))).toEqual(new Set(['img', 'cia']))
  })

  /**
   * 上一条锁不住 pickTileZoom 本身：全省视口下层级算高一级会让瓦片数越过
   * MAX_TILES_PER_FRAME，draw 里的降级循环刚好把它减回 z8——变异被系统自身的保护
   * 吸收，断言看着绿其实空转（实测过）。这里换一个下钻量级的窄视口，瓦片数远低于
   * 上限、降级循环不介入，层级算错就直接现形。
   *
   * 手算：经度跨 1°，1200px / 256 = 4.6875 → 全球 4.6875 × 360 = 1687.5 张
   *   → zoom = round(log2 1687.5) = round(10.72) = 11。
   */
  it('下钻量级窄视口 → z11（此处降级循环不介入，锁的是层级算法本身）', () => {
    Object.assign(YUNNAN_VIEW, { west: 101.4, east: 102.4, south: 24.8, north: 25.5 })
    mount().render()
    flush()
    const zooms = new Set(created.map((img) => new URL(img.src).searchParams.get('TILEMATRIX')))
    expect([...zooms]).toEqual(['11'])
    expect(created.length).toBeLessThan(160)
  })

  it('瓦片数越过上限时降级到更低层级，绝不一帧发几百个请求', () => {
    // 整个中国：z 按经度算会给到 5，但瓦片数超限后必须自己降下来
    Object.assign(YUNNAN_VIEW, { west: 73, east: 135, south: 18, north: 53 })
    mount().render()
    flush()
    expect(created.length).toBeGreaterThan(0)
    // 底图 + 注记两套，各自不得超过上限
    expect(created.length / 2).toBeLessThanOrEqual(160)
  })

  it('关掉注记后只请求底图那一套', () => {
    mount({ showAnnotation: false }).render()
    flush()
    const layers = new Set(created.map((img) => new URL(img.src).searchParams.get('LAYER')))
    expect(layers).toEqual(new Set(['img']))
  })

  it('同一张瓦片只请求一次，roam 反复触发也走缓存', () => {
    const basemap = mount()
    basemap.render(); flush()
    const first = created.length
    basemap.render(); flush()
    expect(created).toHaveLength(first)
  })
})

describe('链路不通时停手', () => {
  it('连续 6 张失败 → 报 error 并停止后续请求', () => {
    const onStatus = vi.fn()
    const basemap = mount({ onStatus })
    basemap.render()
    flush()
    const before = created.length
    expect(before).toBeGreaterThanOrEqual(6)

    for (let i = 0; i < 6; i += 1) created[i].onerror?.()
    expect(onStatus).toHaveBeenCalledWith({
      state: 'error',
      reason: '天地图瓦片连续加载失败，已回退到本地政区图',
    })

    // 判定不通之后再怎么触发都不该继续刷失败请求
    basemap.render(); flush()
    expect(created).toHaveLength(before)
  })

  it('中途成功一张就重新计数，抖动不会被误判成链路不通', () => {
    const onStatus = vi.fn()
    const basemap = mount({ onStatus })
    basemap.render(); flush()
    for (let i = 0; i < 5; i += 1) created[i].onerror?.()
    created[5].onload?.()
    for (let i = 6; i < 10; i += 1) created[i].onerror?.()
    expect(onStatus).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'error' }))
  })
})

describe('换 tk / 换图层（reset）', () => {
  it('旧 tk 的在途请求被作废，其失败不算到新 tk 头上', () => {
    const basemap = mount()
    basemap.render(); flush()
    const stale = created.slice(0, 6)
    basemap.reset(); flush()
    // 回调被断开后，迟到的失败响应根本进不来——不断开的话这 6 张正好够
    // FAILURE_THRESHOLD，会把刚换上的 tk 直接判成「链路不通」降级掉。
    for (const img of stale) {
      expect(img.onerror).toBeNull()
      expect(img.onload).toBeNull()
    }
  })

  it('reset 后重新请求瓦片，不再吃旧缓存', () => {
    const basemap = mount()
    basemap.render(); flush()
    const before = created.length
    basemap.reset(); flush()
    expect(created.length).toBeGreaterThan(before)
  })
})

describe('单张瓦片失败后的重试', () => {
  it('重试间隔内不重发，避免把失败刷成风暴', () => {
    const basemap = mount()
    basemap.render(); flush()
    created[0].onerror?.()
    const before = created.length
    vi.advanceTimersByTime(3_000)
    basemap.render(); flush()
    expect(created).toHaveLength(before)
  })

  it('过了重试间隔重新发一次，那块地方不会永远是个洞', () => {
    const basemap = mount()
    basemap.render(); flush()
    const failedUrl = created[0].src
    created[0].onerror?.()
    const before = created.length
    vi.advanceTimersByTime(9_000)
    basemap.render(); flush()
    expect(created.length).toBeGreaterThan(before)
    expect(created.slice(before).map((img) => img.src)).toContain(failedUrl)
  })

  it('重试会作废上一次的请求，迟到的响应不再把失败计数清零', () => {
    const basemap = mount()
    basemap.render(); flush()
    const stale = created[0]
    stale.onerror?.()
    vi.advanceTimersByTime(9_000)
    basemap.render(); flush()
    expect(stale.onload).toBeNull()
    expect(stale.onerror).toBeNull()
  })
})

describe('缓存上限', () => {
  /**
   * roam 能走遍任意经纬度与层级，缓存不设上限就是一路涨的内存占用。这里以「走远
   * 之后回到起点，起点瓦片被重新请求」间接观察淘汰确实发生了——JS 里测不到内存
   * 本身。变异验证：把 MAX_CACHED_TILES 调到极大，本例即转红。
   */
  it('roam 走远后回到起点，被淘汰的瓦片会重新请求', () => {
    const basemap = mount()
    const home = { west: 101.4, east: 102.4, south: 24.8, north: 25.5 }
    Object.assign(YUNNAN_VIEW, home)
    basemap.render(); flush()
    const homeUrls = new Set(created.map((img) => img.src))
    expect(homeUrls.size).toBeGreaterThan(0)

    // 每站约 80 张（底图 + 注记），5 站足以越过 320 的上限
    for (let step = 1; step <= 5; step += 1) {
      Object.assign(YUNNAN_VIEW, { west: 101.4 + step * 3, east: 102.4 + step * 3, south: 24.8, north: 25.5 })
      basemap.render(); flush()
    }

    Object.assign(YUNNAN_VIEW, home)
    const before = created.length
    basemap.render(); flush()
    const refetched = created.slice(before).filter((img) => homeUrls.has(img.src))
    expect(refetched.length).toBeGreaterThan(0)
  })
})

describe('销毁', () => {
  it('destroy 后移除 canvas，且不再发新请求', () => {
    const basemap = mount()
    basemap.render(); flush()
    const before = created.length
    basemap.destroy()
    expect(container.querySelector('canvas')).toBeNull()
    basemap.render(); flush()
    expect(created).toHaveLength(before)
  })
})
