// @vitest-environment happy-dom
// ↑ 勿删：本文件不是 *.component.spec.ts，vitest node project 默认不给 DOM；
//   用例依赖 localStorage 等浏览器 API，靠此 pragma 按文件切到 happy-dom（合法机制）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authState = vi.hoisted(() => ({ companyId: 'comp-cgn-yunnan' }))
// 判据已从「账号 home 公司」改为「公司切换器当前选中的公司」，好让平台超管切到中广核后
// 能进来（越权仍由授权公司集合与服务端把关）。spec 里两者分开设置，正是为了能覆盖
// 「home 不是中广核但选中了中广核」这一新情形。
const companyState = vi.hoisted(() => ({ selected: 'comp-cgn-yunnan' }))

vi.mock('@/services/agent/agentClient', () => ({
  identityHeaders: () => ({
    authorization: 'Bearer cgn-token',
    'x-company-id': 'comp-forged',
    'x-region-id': 'yunnan'
  })
}))

vi.mock('@/services/api', () => ({
  AGENT_API_BASE_ROOT: '/agent-api',
  applyRegionHeaders: vi.fn(),
  timeoutSignal: () => undefined
}))

vi.mock('@/services/auth', () => ({
  getCurrentUser: () => ({ companyId: authState.companyId })
}))

vi.mock('@/services/company/companyContext', () => ({
  selectedCompanyId: { get value() { return companyState.selected } }
}))

import { fetchCgnYunnanPriceBundle } from './cgnYunnanLivePrice'

function bundle(sourceOverrides: Record<string, unknown> = {}) {
  return {
    date: '2026-08-05', unit: 'CNY/MWh', availability: 'complete', freshness: 'fresh',
    latestAt: '2026-08-05T04:00:00Z', ageSeconds: 10, staleAfterSeconds: 1800,
    source: {
      sourceInstanceId: 'cgn-yunnan-data-api-v1', displayName: '厂侧服务',
      ownerGroupId: 'comp-cgn-yunnan', companyId: 'comp-cgn-yunnan', regionId: 'yunnan',
      subjectId: 'GENERATOR-YN-CGN', officialGridApi: false, transport: 'ngrok', updatedAt: null,
      ...sourceOverrides
    },
    node: { dayAhead: [], realTime: [], snapshots: { total: 0, limited: 0, items: [] } },
    plants: { total: 0, items: [] },
    monitor: {
      spreadThreshold: 80, series: [], alerts: [],
      peakValley: { avg_price: { peak: null, flat: null, valley: null }, peak_valley_spread: null, spread_ratio: null }
    }
  }
}

function response(data = bundle()): Response {
  return new Response(JSON.stringify({
    code: 200, data, mock: false, sourceType: 'REAL', productionWrite: false
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('fetchCgnYunnanPriceBundle', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    authState.companyId = 'comp-cgn-yunnan'
    companyState.selected = 'comp-cgn-yunnan'
  })

  it('只发送 token+region，固定私有路径且禁用缓存', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response())
    vi.stubGlobal('fetch', fetchMock)
    await fetchCgnYunnanPriceBundle('2026-08-05', 66)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/agent-api/v1/spot/cgn-yunnan/prices?date=2026-08-05&spread_threshold=66')
    expect(init.cache).toBe('no-store')
    expect(init.headers).toMatchObject({ authorization: 'Bearer cgn-token', 'x-region-id': 'yunnan' })
    expect(init.headers).not.toHaveProperty('x-company-id')
  })

  it('来源绑定任一维度不匹配即拒绝，不发第二次回落请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(bundle({ subjectId: 'GENERATOR-OTHER' })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchCgnYunnanPriceBundle('2026-08-05')).rejects.toMatchObject({
      code: 'source_scope_mismatch'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('PG 503 原样失败，不请求公共价格', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: { code: 'backend_unavailable', message: 'pg down' }
    }), { status: 503, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchCgnYunnanPriceBundle('2026-08-05')).rejects.toEqual(
      expect.objectContaining({
        name: 'CgnYunnanPriceHttpError', status: 503, code: 'backend_unavailable', message: 'pg down'
      })
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('平台超管：home 非中广核但已切到中广核 → 正常请求私有端点', async () => {
    // 这正是改动前被误拦的人群：超管 home 是演示集团，切到中广核后仍被判定「不属于中广核」，
    // 于是连请求都不发，配置与排障无从做起。越权仍由授权公司集合把关（切换器里选不到的
    // 公司根本设不进来），服务端还会再校验一次。
    authState.companyId = 'dljy-demo'
    companyState.selected = 'comp-cgn-yunnan'
    const fetchMock = vi.fn().mockResolvedValue(response())
    vi.stubGlobal('fetch', fetchMock)
    await fetchCgnYunnanPriceBundle('2026-08-05')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('切回非中广核公司后立即停住，不再请求私有端点', async () => {
    // 「随切换公司，数据源跟着切」的反向一侧：切走即失效。
    authState.companyId = 'dljy-demo'
    companyState.selected = 'dljy-demo'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchCgnYunnanPriceBundle('2026-08-05')).rejects.toMatchObject({
      status: 403, code: 'company_not_entitled'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('其他集团账号在浏览器端即停住，不请求中广核私有端点', async () => {
    authState.companyId = 'comp-shanxi'
    companyState.selected = 'comp-shanxi'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchCgnYunnanPriceBundle('2026-08-05')).rejects.toMatchObject({
      status: 403,
      code: 'company_not_entitled'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
