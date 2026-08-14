// @vitest-environment happy-dom
// ↑ 勿删：本文件不是 *.component.spec.ts，vitest node project 默认不给 DOM；
//   fetchMarketInsightBundle 用 new URL(base, window.location.origin) 拼绝对地址，
//   依赖 window.location，靠此 pragma 按文件切到 happy-dom。
//
// 市场洞察 bundle 客户端回归。守住的不变量：
//   1. URL 参数构造——date 必带；region/region_name/market 是可选维度，缺省**不进 query**
//      （后端按缺省走默认地区，前端塞空串会让后端地区匹配失败）。
//   2. readJson 错误文案必须含状态码 + 响应体前 180 字——驾驶舱预检失败时排障靠这截
//      响应体定位（哪块数据缺、哪个服务 5xx）；坏掉的症状是只剩一个「预检失败」裸文案。

import { afterEach, describe, expect, it, vi } from 'vitest'

const identityState = vi.hoisted(() => ({
  headers: { authorization: 'Bearer t' } as Record<string, string>,
}))
const signalState = vi.hoisted(() => ({ signal: new AbortController().signal }))

vi.mock('@/services/agent/agentClient', () => ({
  identityHeaders: () => identityState.headers,
}))
vi.mock('@/services/api', () => ({
  AGENT_API_BASE_ROOT: '/agent-api',
  applyRegionHeaders: vi.fn(),
  timeoutSignal: () => signalState.signal,
}))

import { fetchMarketInsightBundle } from '@/services/market/marketInsightClient'

// 实现签名带 fetch 两参，让 vi.fn 推导出 [string, RequestInit] 元组（用例直接取 calls[0][1]）
function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

function bundleRes(): Response {
  return new Response(JSON.stringify({
    meta: { schema_version: 1, date: '2026-05-15', region: 'yunnan', region_name: '云南', market: 'da', generated_at: 't' },
    basis: 'captured', sourceType: 'REAL', mock: false, productionWrite: false,
    data_availability: [], blocks: {
      snapshot: {}, elasticity: {}, spread: {}, node_price: {}, forecast_band: {}, anomalies: [],
    },
    narrative: null, gaps: [], assumptions: {}, ui: { components: [] },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('URL 参数构造', () => {
  it('date 必带；可选维度缺省不进 query', async () => {
    const spy = mockFetch(async () => bundleRes())
    await fetchMarketInsightBundle({ date: '2026-05-15' })
    const [url] = spy.mock.calls[0]
    expect(url).toBe(`${window.location.origin}/agent-api/v1/market-insight/bundle?date=2026-05-15`)
  })

  it('可选维度显式传入时全量下传', async () => {
    const spy = mockFetch(async () => bundleRes())
    await fetchMarketInsightBundle({ date: '2026-05-15', region: 'yunnan', region_name: '云南', market: 'da' })
    const [url] = spy.mock.calls[0]
    expect(url).toBe(`${window.location.origin}/agent-api/v1/market-insight/bundle?date=2026-05-15&region=yunnan&region_name=%E4%BA%91%E5%8D%97&market=da`)
  })

  it('headers 带登录身份、signal 传入', async () => {
    const spy = mockFetch(async () => bundleRes())
    await fetchMarketInsightBundle({ date: '2026-05-15' })
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.headers).toEqual({ authorization: 'Bearer t' })
    expect(init.signal).toBe(signalState.signal)
  })
})

describe('readJson 错误文案', () => {
  it('非 2xx：文案含 fallback 前缀 + 状态码 + 响应体原文', async () => {
    mockFetch(async () => new Response('node_price 数据源 503', { status: 503 }))
    await expect(fetchMarketInsightBundle({ date: '2026-05-15' })).rejects.toThrow(
      '市场洞察数据预检失败: 503 node_price 数据源 503'
    )
  })

  it('超长响应体截断到前 180 字（错误气泡不爆屏）', async () => {
    const long = 'x'.repeat(300) + 'TAIL-NEVER-SEEN'
    mockFetch(async () => new Response(long, { status: 500 }))
    const err: string = await fetchMarketInsightBundle({ date: '2026-05-15' }).then(
      () => '',
      (e: Error) => e.message,
    )
    expect(err).toContain('市场洞察数据预检失败: 500')
    expect(err).toContain('x'.repeat(180))
    expect(err).not.toContain('TAIL-NEVER-SEEN')
    expect(err.length).toBeLessThan('市场洞察数据预检失败: 500 '.length + 200)
  })

  it('空响应体 → 无尾缀，只剩前缀 + 状态码', async () => {
    mockFetch(async () => new Response('', { status: 502 }))
    await expect(fetchMarketInsightBundle({ date: '2026-05-15' })).rejects.toThrow('市场洞察数据预检失败: 502')
  })

  it('body 读取本身抛错（流已释放）→ 静默落空串，仍报状态码', async () => {
    const res = new Response('{"a":1}', { status: 500 })
    await res.text() // 先把 body 读完，再次 text() 会抛
    mockFetch(async () => res)
    await expect(fetchMarketInsightBundle({ date: '2026-05-15' })).rejects.toThrow('市场洞察数据预检失败: 500')
  })
})
