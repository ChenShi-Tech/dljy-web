// 现货节点价客户端回归：中广核云南私有路径的「真实只读」可信度守门 + 请求构造纪律。
// 守住的不变量：
//   1. privateYunnan 信封三重守门——mock:true / sourceType!=='REAL' / productionWrite:true
//      任一命中必须 throw（私有结算级数据混入合成值 = 数据事故）；坏掉的症状是
//      中广核页面展示了一页看似正常的假价。
//   2. 私有路径选中即绑定：URL 改写 /cgn-yunnan、剥 region 参数、删 x-company-id、
//      cache no-store；且 403/503 原样失败绝不回落公共端点。
//   3. buildQuery 序列化：undefined/null/空串丢弃，**0 保留**（limit=0 是合法分页语义）。
//   4. 错误文案优先级 message → detail(str) → detail.message → `请求失败: <status>`。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const identityState = vi.hoisted(() => ({
  headers: { authorization: 'Bearer t', 'x-company-id': 'comp-1', 'x-region-id': 'yunnan' } as Record<string, string>,
}))
const regionState = vi.hoisted(() => ({ id: 'yunnan' }))
const entitlementState = vi.hoisted(() => ({ on: true }))

vi.mock('@/services/agent/agentClient', () => ({
  identityHeaders: () => ({ ...identityState.headers }),
}))
vi.mock('@/services/api', () => ({
  AGENT_API_BASE_ROOT: '/agent-api',
  applyRegionHeaders: vi.fn(),
  timeoutSignal: () => new AbortController().signal,
}))
vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { get value() { return { id: regionState.id } } },
}))
vi.mock('@/services/market/cgnYunnanLivePrice', () => ({
  hasCgnYunnanPriceEntitlement: () => entitlementState.on,
}))

import { fetchDailySummary, fetchNodePriceSeries, fetchNodePriceSeriesWithMeta, fetchSpotRegions, searchSpotNodes } from '@/services/market/spotClient'

// 实现签名带 fetch 两参，让 vi.fn 推导出 [string, RequestInit] 元组（用例直接取 calls[0][1]）
function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

/** BaseResponse 信封（agent-backend common.py:40 契约：code/message/data + 可信度三元组）。 */
function envelope<T>(data: T, over: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ code: 200, message: 'ok', data, mock: false, sourceType: 'REAL', productionWrite: false, ...over }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}

const SERIES = { series: [{ time_point: '00:00', price: 300 }], points: 1 }

beforeEach(() => {
  regionState.id = 'yunnan'
  entitlementState.on = true
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('中广核云南私有路径改写', () => {
  it('私有命中：URL 走 /cgn-yunnan、剥 region 参数、删 x-company-id、cache no-store', async () => {
    const spy = mockFetch(async () => envelope(SERIES))
    const r = await fetchNodePriceSeriesWithMeta('2026-05-15', 'nodeA', 'da', '云南')
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/agent-api/v1/spot/cgn-yunnan/node-price/series?date=2026-05-15&node=nodeA&market=da')
    expect(url).not.toContain('region=')
    expect(init.headers).not.toHaveProperty('x-company-id')
    expect(init.headers).toMatchObject({ authorization: 'Bearer t', 'x-region-id': 'yunnan' })
    expect(init.cache).toBe('no-store')
    expect(r.data).toEqual(SERIES)
  })

  it('合规信封通过：可信度三元组原样透传归一', async () => {
    mockFetch(async () => envelope(SERIES))
    const r = await fetchNodePriceSeriesWithMeta('2026-05-15', 'nodeA', 'da')
    expect(r).toEqual({ data: SERIES, mock: false, sourceType: 'REAL', productionWrite: false })
  })

  it('sourceType=MOCK → throw（合成数据不得进私有展示）', async () => {
    mockFetch(async () => envelope(SERIES, { sourceType: 'MOCK', mock: true }))
    await expect(fetchNodePriceSeriesWithMeta('2026-05-15', 'nodeA', 'da'))
      .rejects.toThrow('可信度标注不符合真实只读契约')
  })

  it('仅 mock:true（sourceType 仍标 REAL 的自相矛盾信封）→ throw', async () => {
    mockFetch(async () => envelope(SERIES, { mock: true }))
    await expect(fetchNodePriceSeriesWithMeta('2026-05-15', 'nodeA', 'da')).rejects.toThrow('真实只读契约')
  })

  it('sourceType 缺失（undefined !== REAL）→ throw：可信度未标注等同不可信', async () => {
    mockFetch(async () => envelope(SERIES, { sourceType: undefined }))
    await expect(fetchNodePriceSeriesWithMeta('2026-05-15', 'nodeA', 'da')).rejects.toThrow('真实只读契约')
  })

  it('productionWrite:true → throw（私有路径只读，写标注即契约破坏）', async () => {
    mockFetch(async () => envelope(SERIES, { productionWrite: true }))
    await expect(fetchNodePriceSeriesWithMeta('2026-05-15', 'nodeA', 'da')).rejects.toThrow('真实只读契约')
  })

  it('私有路径 403 原样失败，绝不回落公共端点（回落 = 越权数据面）', async () => {
    const spy = mockFetch(async () => new Response(JSON.stringify({ detail: 'forbidden' }), { status: 403 }))
    await expect(fetchNodePriceSeriesWithMeta('2026-05-15', 'nodeA', 'da')).rejects.toThrow('forbidden')
    expect(spy).toHaveBeenCalledTimes(1) // 没有第二次「公共路径」请求
    expect((spy.mock.calls[0] as unknown[])[0]).toContain('/cgn-yunnan/')
  })
})

describe('非私有路径不受守门影响', () => {
  it('无中广核授权：走普通端点，mock 信封不抛、mock 标志如实透传', async () => {
    entitlementState.on = false
    const spy = mockFetch(async () => envelope(SERIES, { mock: true, sourceType: 'MOCK' }))
    const r = await fetchNodePriceSeriesWithMeta('2026-05-15', 'nodeA', 'da')
    expect((spy.mock.calls[0] as unknown[])[0]).toBe('/agent-api/v1/spot/node-price/series?date=2026-05-15&node=nodeA&market=da')
    expect(init_cache(spy)).toBe('default')
    expect(r.mock).toBe(true)
    expect(r.sourceType).toBe('MOCK')
  })

  it('/regions 不以 /node-price/ 开头：不改写路径', async () => {
    const spy = mockFetch(async () => envelope({ count: 1, regions: ['云南'] }))
    await fetchSpotRegions()
    expect((spy.mock.calls[0] as unknown[])[0]).toBe('/agent-api/v1/spot/regions')
  })

  it('非云南地区（有授权）：走普通端点', async () => {
    regionState.id = 'shanxi'
    const spy = mockFetch(async () => envelope(SERIES))
    await fetchNodePriceSeries('2026-05-15', 'nodeA', 'da', '山西')
    expect((spy.mock.calls[0] as unknown[])[0]).toBe('/agent-api/v1/spot/node-price/series?date=2026-05-15&node=nodeA&market=da&region=%E5%B1%B1%E8%A5%BF')
  })
})

describe('buildQuery 序列化', () => {
  it('undefined / 空串参数丢弃', async () => {
    const spy = mockFetch(async () => envelope(SERIES))
    await fetchNodePriceSeries('2026-05-15', 'nodeA', 'da') // region 缺省
    expect((spy.mock.calls[0] as unknown[])[0]).not.toContain('region=')
  })

  it('0 值保留（limit=0 是合法语义，不得丢）', async () => {
    entitlementState.on = false // 走公共路径，聚焦序列化本身
    const spy = mockFetch(async () => envelope({ count: 0, items: [] }))
    await fetchDailySummary('2026-05-15', 'da', 0)
    expect((spy.mock.calls[0] as unknown[])[0]).toContain('limit=0')

    await searchSpotNodes('kw', '', 0)
    expect((spy.mock.calls[1] as unknown[])[0]).toBe('/agent-api/v1/spot/node-price/nodes?q=kw&limit=0')
  })
})

describe('错误文案优先级', () => {
  function err(status: number, body: unknown) {
    mockFetch(async () => new Response(body === undefined ? '' : JSON.stringify(body), { status }))
  }

  it('顶层 message 优先', async () => {
    err(403, { message: '顶层消息', detail: '内层' })
    await expect(fetchSpotRegions()).rejects.toThrow('顶层消息')
  })

  it('无 message 时取 detail 字符串（FastAPI HTTPException）', async () => {
    err(503, { detail: 'pg down' })
    await expect(fetchSpotRegions()).rejects.toThrow('pg down')
  })

  it('detail 为对象时取其 message（嵌套结构化错误）', async () => {
    err(503, { detail: { code: 'backend_unavailable', message: '嵌套消息' } })
    await expect(fetchSpotRegions()).rejects.toThrow('嵌套消息')
  })

  it('body 不可读 → `请求失败: <status>` 兜底', async () => {
    mockFetch(async () => new Response('', { status: 502 }))
    await expect(fetchSpotRegions()).rejects.toThrow('请求失败: 502')
  })
})

function init_cache(spy: ReturnType<typeof mockFetch>): string | undefined {
  return (spy.mock.calls[0][1] as RequestInit).cache
}
