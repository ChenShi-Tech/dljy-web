// @vitest-environment happy-dom
// 守住日前盯盘接口出口（dljy#3484，规格 DW-10/DW-11/DW-12，设计 D7）：
// 请求体只有 {tradeDate, mode}、带幂等键与发起时刻的地区/公司；202 轮询到终态且 60 秒封顶；
// 404/409/422/428 映射成中文可读错误；评价只提交 itemId/verdict/可选备注。
// 坏掉的症状：页面关键词/分页混进研判请求、双击生成两个运行、运行中永远转圈、
// 冲突错误显示成“HTTP 409”无法理解、切公司后请求仍带旧公司。
// 需要 happy-dom：api.ts 经 regionContext 在模块求值时读 window.localStorage。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { liveTradeDate } from 'shared/schema/disclosure-watch-contract.mjs'
import {
  DisclosureWatchRequestError,
  awaitDisclosureWatchRun,
  fetchDisclosureWatchCapabilities,
  fetchDisclosureWatchRun,
  hasRunBody,
  runDisclosureWatch,
  startDisclosureWatchRun,
  submitDisclosureWatchFeedback,
} from './disclosureWatch'

const scope = { regionId: 'yunnan', companyId: 'company-a' }
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
function head(status: 'running' | 'failed' = 'running') {
  return { contractVersion: '1.0.0', runId: 'run-1', status, mode: 'live', tradeDate: liveTradeDate(), regionId: 'yunnan', asOf: '2026-09-29T08:00:00Z', createdAt: '2026-09-29T08:00:00Z', finishedAt: null, deadlineAt: '2026-09-29T08:00:45Z', scopeLabel: '云南', errors: [] }
}
function done() { return { ...head(), status: 'complete', items: [], summary: '本次资料未识别出重点事项' } }
function headers(call: number) { return new Headers(fetchMock.mock.calls[call][1]?.headers) }
function url(call: number) { return new URL(fetchMock.mock.calls[call][0]) }

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('日前盯盘请求', () => {
  it('能力查询带目标日、公司与发起时刻地区头', async () => {
    fetchMock.mockResolvedValue(json(200, { code: 200, data: { enabled: true, supportedRegion: true, modelReady: false, datasets: [] } }))
    const caps = await fetchDisclosureWatchCapabilities({ regionId: 'yunnan', companyId: 'company-b' }, '2026-09-30')
    expect(caps).toMatchObject({ enabled: true, modelReady: false })
    expect(url(0).pathname).toBe('/api/v1/grid/geo-assets/disclosures/watch-capabilities')
    expect(Object.fromEntries(url(0).searchParams)).toEqual({ tradeDate: '2026-09-30', company: 'company-b' })
    expect(headers(0).get('x-region-id')).toBe('yunnan')
  })

  it('运行请求体只有 tradeDate 与 mode，并带调用方给的 Idempotency-Key', async () => {
    fetchMock.mockResolvedValue(json(200, { code: 200, data: done() }))
    const result = await startDisclosureWatchRun(scope, { tradeDate: liveTradeDate(), mode: 'live', keyword: '小湾', page: 2 } as never, 'key-123')
    expect(hasRunBody(result)).toBe(true)
    const init = fetchMock.mock.calls[0][1]!
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ tradeDate: liveTradeDate(), mode: 'live' })
    expect(headers(0).get('idempotency-key')).toBe('key-123')
    expect(headers(0).get('x-region-id')).toBe('yunnan')
    expect(url(0).pathname).toBe('/api/v1/grid/geo-assets/disclosures/watch-runs')
    expect(url(0).searchParams.get('company')).toBe('company-a')
  })

  it('live 目标日不是北京时间次日时本地拒绝，不发请求', async () => {
    await expect(startDisclosureWatchRun(scope, { tradeDate: '2020-01-01', mode: 'live' }, 'k')).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(startDisclosureWatchRun(scope, { tradeDate: '2026-02-30', mode: 'review' }, 'k')).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(startDisclosureWatchRun({ regionId: 'yunnan', companyId: null }, { tradeDate: '2026-07-01', mode: 'review' }, 'k')).rejects.toMatchObject({ code: 'invalid-scope' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('202 运行头按 2 秒间隔轮询到终态', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(json(202, { code: 202, data: head() }))
      .mockResolvedValueOnce(json(200, { code: 200, data: head() }))
      .mockResolvedValueOnce(json(200, { code: 200, data: done() }))
    const onRunning = vi.fn()
    const pending = runDisclosureWatch(scope, { tradeDate: liveTradeDate(), mode: 'live' }, 'key-1', { onRunning })
    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(url(1).pathname).toBe('/api/v1/grid/geo-assets/disclosures/watch-runs/run-1')
    await vi.advanceTimersByTimeAsync(2_000)
    const outcome = await pending
    expect(outcome).toMatchObject({ settled: true, result: { status: 'complete' } })
    expect(onRunning).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('轮询 60 秒仍在运行则交回 runId，不无限等待', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async () => json(200, { code: 200, data: head() }))
    const pending = awaitDisclosureWatchRun(scope, 'run-1')
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(pending).resolves.toEqual({ settled: false, runId: 'run-1' })
    expect(fetchMock).toHaveBeenCalledTimes(30)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(30)
  })

  it('中止信号能打断轮询等待', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const pending = awaitDisclosureWatchRun(scope, 'run-1', { signal: controller.signal })
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await assertion
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('日前盯盘错误映射', () => {
  it.each([
    [409, { code: 409, msg: '幂等键已用于其他参数', errorCode: 'idempotency-conflict' }, 'idempotency-conflict', '同一请求标识已用于不同参数'],
    [409, { code: 409, msg: '功能开关关闭', errorCode: 'feature-disabled' }, 'feature-disabled', '日前盯盘功能未开通'],
    [422, { code: 422, msg: '地区不支持', errorCode: 'region-unsupported' }, 'region-unsupported', '当前地区不支持日前盯盘'],
    [422, { code: 422, msg: 'tradeDate 非法' }, 'invalid-request', '请求参数不合法'],
    [428, { code: 428, msg: '缺少幂等键' }, 'idempotency-key-required', '缺少请求标识'],
  ])('POST %i %j → %s', async (status, payload, code, text) => {
    fetchMock.mockResolvedValue(json(status, payload))
    const error = await startDisclosureWatchRun(scope, { tradeDate: '2026-07-01', mode: 'review' }, 'k').catch((cause) => cause)
    expect(error).toBeInstanceOf(DisclosureWatchRequestError)
    expect(error).toMatchObject({ code, status })
    expect(error.message).toContain(text)
    expect(error.retryable).toBe(false)
  })

  it('运行 404 映射为不存在或不属于本人', async () => {
    fetchMock.mockResolvedValue(json(404, { code: 404, msg: 'not found' }))
    await expect(fetchDisclosureWatchRun(scope, 'run-x')).rejects.toMatchObject({ code: 'run-not-found', status: 404 })
  })

  it('评价 404 按错误码区分运行与事项', async () => {
    fetchMock.mockResolvedValueOnce(json(404, { code: 404, msg: '', errorCode: 'run-not-found' })).mockResolvedValueOnce(json(404, { code: 404, msg: '' }))
    await expect(submitDisclosureWatchFeedback(scope, 'run-1', { itemId: 'item-1', verdict: 'useful' })).rejects.toMatchObject({ code: 'run-not-found' })
    await expect(submitDisclosureWatchFeedback(scope, 'run-1', { itemId: 'item-1', verdict: 'useful' })).rejects.toMatchObject({ code: 'item-not-found' })
  })

  it('5xx 与网络错误可沿用同一幂等键重试', async () => {
    fetchMock.mockResolvedValueOnce(json(500, { code: 500, msg: 'boom' }))
    const serverError = await startDisclosureWatchRun(scope, { tradeDate: '2026-07-01', mode: 'review' }, 'k').catch((cause) => cause)
    expect(serverError).toMatchObject({ code: 'internal-error', retryable: true })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const networkError = await startDisclosureWatchRun(scope, { tradeDate: '2026-07-01', mode: 'review' }, 'k').catch((cause) => cause)
    expect(networkError).toMatchObject({ code: 'network', retryable: true })
  })
})

describe('日前盯盘评价', () => {
  it('只提交 itemId、verdict 与非空备注', async () => {
    fetchMock.mockImplementation(async () => json(200, { code: 200, data: { feedbackId: 'fb-1' } }))
    await submitDisclosureWatchFeedback(scope, 'run-1', { itemId: 'item-1', verdict: 'needs-correction', note: '  复电时间已更正  ' })
    await submitDisclosureWatchFeedback(scope, 'run-1', { itemId: 'item-2', verdict: 'useful', note: '   ' })
    expect(url(0).pathname).toBe('/api/v1/grid/geo-assets/disclosures/watch-runs/run-1/feedback')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({ itemId: 'item-1', verdict: 'needs-correction', note: '复电时间已更正' })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]!.body))).toEqual({ itemId: 'item-2', verdict: 'useful' })
  })

  it('备注超过 200 字本地拒绝', async () => {
    await expect(submitDisclosureWatchFeedback(scope, 'run-1', { itemId: 'item-1', verdict: 'needs-correction', note: '字'.repeat(201) })).rejects.toMatchObject({ code: 'invalid-request' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
