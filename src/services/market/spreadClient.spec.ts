// 价差/弹性端点客户端回归（spread + elasticity 同构合一文件）。
// 守住的不变量：
// 1. 请求构造，URL 默认参数（window/threshold/segments）进 query、可选项缺省不进、
// 0 保留（threshold=0 是「关阈值」的合法语义）；x-region-id 必带。
// 2. 错误文案 message ?? detail 优先级，最终 `请求失败: <status>` 兜底
// 坏掉的症状是用户看到裸 502 而不知后端说了什么。
// 3. 返回 body.data 解包（调用方拿业务体，不是信封）。
// 4. timeout signal 传入 fetch。

import { afterEach, describe, expect, it, vi } from 'vitest'

const identityState = vi.hoisted(() => ({
  headers: {} as Record<string, string>,
}))
const regionState = vi.hoisted(() => ({ id: 'yunnan' }))
const signalState = vi.hoisted(() => ({ signal: new AbortController().signal }))

vi.mock('@/services/agent/agentClient', () => ({
  identityHeaders: () => identityState.headers,
}))
vi.mock('@/services/api', () => ({
  AGENT_API_BASE_ROOT: '/agent-api',
  applyRegionHeaders: vi.fn(),
  timeoutSignal: () => signalState.signal,
}))
vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { get value() { return { id: regionState.id } } },
}))

import { fetchSpread } from '@/services/market/spreadClient'
import { fetchElasticity } from '@/services/market/elasticityClient'

// 实现签名带 fetch 两参，让 vi.fn 推导出 [string, RequestInit] 元组（用例直接取 calls[0][1]）
function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ code: 200, data, mock: false, sourceType: 'REAL' }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}

function errorRes(status: number, body: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), { status })
}

const SPREAD_BODY = {
  date: '2026-05-15', region: '云南', available: true, reason: null, kind: '决策支持参考',
  spread_forecast: [], spread_actual: [], sign_hit_rate: null, sign_hit_count: 0,
  arbitrage: null, optimizer: null, train_days: 21, notes: [],
} as const

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchSpread 请求构造', () => {
  it('默认参数序列化：window=21、threshold=20 进 query，region 缺省不进', async () => {
    const spy = mockFetch(async () => envelope(SPREAD_BODY))
    await fetchSpread('2026-05-15')
    expect((spy.mock.calls[0] as unknown[])[0]).toBe('/agent-api/v1/spot/spread?date=2026-05-15&window=21&threshold=20')
  })

  it('显式参数全量下传：region 编码、0 值保留（threshold=0 不丢）', async () => {
    const spy = mockFetch(async () => envelope(SPREAD_BODY))
    await fetchSpread('2026-05-15', '云南', 7, 0)
    expect((spy.mock.calls[0] as unknown[])[0]).toBe('/agent-api/v1/spot/spread?date=2026-05-15&region=%E4%BA%91%E5%8D%97&window=7&threshold=0')
  })

  it('headers：x-region-id 按全局地区显式注入 + identityHeaders 合并 + signal 传入', async () => {
    identityState.headers = { authorization: 'Bearer t', 'x-company-id': 'c1' }
    const spy = mockFetch(async () => envelope(SPREAD_BODY))
    await fetchSpread('2026-05-15')
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.headers).toMatchObject({ 'x-region-id': 'yunnan', authorization: 'Bearer t', 'x-company-id': 'c1' })
    expect(init.signal).toBe(signalState.signal)
  })

  it('成功：返回 body.data 解包（拿到业务体而非信封）', async () => {
    mockFetch(async () => envelope(SPREAD_BODY))
    const r = await fetchSpread('2026-05-15')
    expect(r).toEqual(SPREAD_BODY)
    expect(r).not.toHaveProperty('code')
  })
})

describe('fetchSpread 错误文案优先级', () => {
  it('message 优先于 detail', async () => {
    mockFetch(async () => errorRes(503, { message: '顶层', detail: '内层' }))
    await expect(fetchSpread('2026-05-15')).rejects.toThrow('顶层')
  })

  it('无 message 时取 detail', async () => {
    mockFetch(async () => errorRes(503, { detail: 'pg down' }))
    await expect(fetchSpread('2026-05-15')).rejects.toThrow('pg down')
  })

  it('body 不可读 → `请求失败: <status>` 兜底', async () => {
    mockFetch(async () => errorRes(502, undefined))
    await expect(fetchSpread('2026-05-15')).rejects.toThrow('请求失败: 502')
  })

  it('message 空串时不回落 detail（?? 只滤 nullish——现行为记录，疑似应为 ||）', async () => {
    mockFetch(async () => errorRes(502, { message: '', detail: '实际原因' }))
    // message='' 非 nullish → 选中空串 → 最终落状态码兜底，detail 被吞
    await expect(fetchSpread('2026-05-15')).rejects.toThrow('请求失败: 502')
  })
})

describe('fetchElasticity 请求构造', () => {
  it('默认参数：market=da、segments=4、window=21，region 缺省不进', async () => {
    const spy = mockFetch(async () => envelope({ available: true }))
    await fetchElasticity('2026-05-15')
    expect((spy.mock.calls[0] as unknown[])[0]).toBe('/agent-api/v1/spot/elasticity?date=2026-05-15&market=da&segments=4&window=21')
  })

  it('显式参数全量下传', async () => {
    const spy = mockFetch(async () => envelope({ available: true }))
    await fetchElasticity('2026-05-15', 'rt', '广东', 6, 30)
    expect((spy.mock.calls[0] as unknown[])[0]).toBe('/agent-api/v1/spot/elasticity?date=2026-05-15&market=rt&region=%E5%B9%BF%E4%B8%9C&segments=6&window=30')
  })

  it('headers 同样显式注入 x-region-id；signal 传入', async () => {
    identityState.headers = {}
    const spy = mockFetch(async () => envelope({ available: true }))
    await fetchElasticity('2026-05-15')
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.headers).toMatchObject({ 'x-region-id': 'yunnan' })
    expect(init.signal).toBe(signalState.signal)
  })

  it('错误：message ?? detail 与状态码兜底同 spread 契约', async () => {
    mockFetch(async () => errorRes(500, { detail: '训练数据不足' }))
    await expect(fetchElasticity('2026-05-15')).rejects.toThrow('训练数据不足')
    mockFetch(async () => errorRes(500, undefined))
    await expect(fetchElasticity('2026-05-15')).rejects.toThrow('请求失败: 500')
  })

  it('成功：body.data 解包', async () => {
    mockFetch(async () => envelope({ available: false, reason: '缺真实数据' }))
    const r = await fetchElasticity('2026-05-15')
    expect(r).toEqual({ available: false, reason: '缺真实数据' })
  })
})
