// @vitest-environment happy-dom
// 结算复核接口客户端（build-midlong-spot-hedging 任务 10.5，HR-02/03/06；ChenShi-Tech/dljy#3054）。
// 守的不变量：覆盖日历与复核走 /api/v1/hedge/settlement/coverage|review，fromDate/toDate/view/granularity 原样下传、
// 带 x-region-id；错误信封转成 HedgeApiError（errorCode + 后端文案），不吞成空数据。
// 坏掉的症状：路径或参数名错位后后端恒 422、暂结视角参数丢失后静默拿到正式数据、失败被当成「暂无数据」。
// （happy-dom pragma：hedgeApi.ts → api.ts → regionContext 模块级读 localStorage，请求 URL 依赖 window.location。）
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HedgeApiError } from './hedgeApi'
import { fetchSettlementCoverage, fetchSettlementReview } from './hedgeSettlementApi'

function stubFetch(status: number, payload: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('hedgeSettlementApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('覆盖日历：GET /settlement/coverage，区间与视角原样下传，返回 data', async () => {
    const data = { plants: ['甲'], calendar: { days: [], coveredDays: 0, totalDays: 0 }, status: 'NOT_REPORTED' }
    const fetchMock = stubFetch(200, { code: 200, msg: 'ok', data })
    const result = await fetchSettlementCoverage({ fromDate: '2025-10-01', toDate: '2026-09-29', view: 'PROVISIONAL' })
    expect(result).toEqual(data)
    const [url, init] = fetchMock.mock.calls[0]
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/api/v1/hedge/settlement/coverage')
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ fromDate: '2025-10-01', toDate: '2026-09-29', view: 'PROVISIONAL' })
    expect(init?.method).toBe('GET')
    expect((init?.headers as Record<string, string>)['x-region-id']).toBeTruthy()
  })

  it('复核：GET /settlement/review，带粒度与视角', async () => {
    const fetchMock = stubFetch(200, { code: 200, msg: 'ok', data: { status: 'OK', rows: [] } })
    await fetchSettlementReview({ fromDate: '2026-05-01', toDate: '2026-05-31', granularity: 'DAY', view: 'FORMAL' })
    const parsed = new URL(fetchMock.mock.calls[0][0])
    expect(parsed.pathname).toBe('/api/v1/hedge/settlement/review')
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ fromDate: '2026-05-01', toDate: '2026-05-31', granularity: 'DAY', view: 'FORMAL' })
  })

  it('错误信封转成 HedgeApiError（地区未开放 / 参数非法），不返回空数据', async () => {
    stubFetch(422, { code: 422, msg: '地区 shanxi 尚未开通结算复核（试点：云南）', data: { errorCode: 'UNSUPPORTED_REGION' } })
    const err = await fetchSettlementCoverage({ fromDate: '2026-05-01', toDate: '2026-05-31' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HedgeApiError)
    expect(err).toMatchObject({ status: 422, errorCode: 'UNSUPPORTED_REGION', message: '地区 shanxi 尚未开通结算复核（试点：云南）' })

    stubFetch(422, { code: 422, msg: '请提供合法的 fromDate/toDate', data: { errorCode: 'VALIDATION_FAILED', details: { field: 'fromDate' } } })
    await expect(fetchSettlementReview({ fromDate: '2026/05/01', toDate: '2026-05-31' })).rejects.toMatchObject({
      errorCode: 'VALIDATION_FAILED', details: { field: 'fromDate' },
    })
  })
})
