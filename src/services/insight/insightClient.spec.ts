// @vitest-environment happy-dom
// ↑ 勿删：本文件不是 *.component.spec.ts，vitest node project 默认不给 DOM；被 mock 的
//   @/services/api 经 importOriginal 加载真身时，其顶层 regionContext 要读 window。
// insightClient.spec.ts — 洞察 HTTP 客户端回归（dljy#2996 D4）
// 守什么不变量：
//   ① 成功结果过契约校验后原样返回；请求经 apiGet/apiPost 走统一头（x-region-id 等）；
//   ② 形状不合规（缺结果版本等）按 422 UNPROCESSABLE 抛 InsightRequestError，不渲染口径不明的数据；
//   ③ 统一信封错误（ApiError）映射为 InsightRequestError{status, errorCode}：403 FORBIDDEN、
//      409 VERSION_CONFLICT 保留后端 message 与 details；
//   ④ 网络/未知异常一律 503 UNAVAILABLE，绝不吞成空结果；
//   ⑤ AbortError 原样上抛（取消不是失败，由请求代次层消化）。
// 坏掉的症状：403 显示成空图；版本冲突静默拿新数据替换用户正在看的旧版本。
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))
vi.mock('@/services/api', async (importOriginal) => ({ ...await importOriginal<typeof import('@/services/api')>(), apiGet, apiPost }))
import { ApiError } from '@/services/api'
import { fetchInsightCapabilities, fetchInsightCoverage, InsightRequestError, queryInsight } from './insightClient'
import { nodePriceResult, RESULT_VERSION } from '@/components/insight/insightFixtures'

const signal = new AbortController().signal

beforeEach(() => {
  vi.clearAllMocks()
})

describe('queryInsight · 成功与校验', () => {
  it('成功：契约合法的结果原样返回，body 与 signal 传给 apiPost', async () => {
    const result = nodePriceResult(['300.125', '301.5'])
    apiPost.mockResolvedValue({ data: result })

    const request = { analysisId: 'test.analysis', context: { regionId: 'yunnan', businessWindow: { start: '2026-09-10', end: '2026-09-10' } } }
    const returned = await queryInsight(request, { signal })

    expect(returned.resultVersion).toBe(RESULT_VERSION)
    expect(apiPost).toHaveBeenCalledWith('/api/v1/market-insight/query', request, { signal })
  })

  it('形状不合规：缺结果版本按 422 UNPROCESSABLE 折叠，不把数据交给页面', async () => {
    const broken = { ...nodePriceResult(['300']), resultVersion: 'not-a-version', readSetRef: 'rs1:short' }
    apiPost.mockResolvedValue({ data: broken })

    const caught = await queryInsight({ analysisId: 'test.analysis', context: { regionId: 'yunnan', businessWindow: { start: '2026-09-10', end: '2026-09-10' } } }).catch((error) => error)

    expect(caught).toBeInstanceOf(InsightRequestError)
    expect(caught).toMatchObject({ status: 422, errorCode: 'UNPROCESSABLE' })
  })
})

describe('错误信封映射', () => {
  const request = { analysisId: 'test.analysis', context: { regionId: 'yunnan', businessWindow: { start: '2026-09-10', end: '2026-09-10' } } }

  it('403：映射 FORBIDDEN 并保留后端说明', async () => {
    apiPost.mockRejectedValue(new ApiError('当前公司没有这类资料的查看权限', { status: 403, code: 403, payload: { code: 403, msg: 'forbidden', data: { errorCode: 'FORBIDDEN', details: { source: 'yn.price.node.public.day-ahead' } } } }))

    const caught = await queryInsight(request).catch((error) => error)

    expect(caught).toBeInstanceOf(InsightRequestError)
    expect(caught).toMatchObject({ status: 403, errorCode: 'FORBIDDEN', message: '当前公司没有这类资料的查看权限' })
    expect(caught.details).toEqual({ source: 'yn.price.node.public.day-ahead' })
  })

  it('409：版本冲突映射 VERSION_CONFLICT，页面据此提示刷新而非静默替换', async () => {
    apiPost.mockRejectedValue(new ApiError('资料已更新', { status: 409, code: 409, payload: { code: 409, msg: 'conflict', data: { errorCode: 'VERSION_CONFLICT' } } }))

    const caught = await queryInsight(request).catch((error) => error)

    expect(caught).toMatchObject({ status: 409, errorCode: 'VERSION_CONFLICT', message: '资料已更新' })
  })

  it('网络/未知异常一律 503 UNAVAILABLE，不吞成空结果', async () => {
    apiPost.mockRejectedValue(new TypeError('fetch failed'))

    const caught = await queryInsight(request).catch((error) => error)

    expect(caught).toMatchObject({ status: 503, errorCode: 'UNAVAILABLE' })
  })
})

describe('AbortError 透传', () => {
  it('取消不是失败：AbortError 原样上抛，不折叠成 503', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    apiPost.mockRejectedValue(abortError)

    const caught = await queryInsight({ analysisId: 'test.analysis', context: { regionId: 'yunnan', businessWindow: { start: '2026-09-10', end: '2026-09-10' } } }).catch((error) => error)

    expect(caught).toBe(abortError)
  })
})

describe('fetchInsightCapabilities / fetchInsightCoverage', () => {
  it('capabilities：目录合法原样返回；缺 analyses 数组按 422', async () => {
    const capabilities = { regionId: 'yunnan', registered: true, analyses: [], sources: [], endpoints: {}, mock: false, productionWrite: false }
    apiGet.mockResolvedValueOnce({ data: capabilities })
    await expect(fetchInsightCapabilities({ signal })).resolves.toBe(capabilities)

    apiGet.mockResolvedValueOnce({ data: { regionId: 'yunnan' } })
    const caught = await fetchInsightCapabilities().catch((error) => error)
    expect(caught).toMatchObject({ status: 422, errorCode: 'UNPROCESSABLE' })
  })

  it('coverage：candidates 形状合法返回；缺 candidates 按 422', async () => {
    const coverage = {
      schemaVersion: 'insight-coverage/v1',
      analysisId: 'test.analysis',
      regionId: 'yunnan',
      businessWindow: { start: '2026-09-10', end: '2026-09-10' },
      sources: [{ sourceId: 'yn.price.node.public.day-ahead', required: true, status: 'ok', seriesCount: 1, completeDates: ['2026-09-10'], partialDates: [], ranges: [] }],
      candidates: { dates: ['2026-09-10'], ranges: [], discrete: false },
      note: '',
      mock: false,
      productionWrite: false,
    }
    apiPost.mockResolvedValueOnce({ data: coverage })
    await expect(fetchInsightCoverage({ analysisId: 'test.analysis', context: { regionId: 'yunnan', businessWindow: { start: '2026-09-10', end: '2026-09-10' } } })).resolves.toBe(coverage)

    apiPost.mockResolvedValueOnce({ data: { ...coverage, candidates: undefined } })
    const caught = await fetchInsightCoverage({ analysisId: 'test.analysis', context: { regionId: 'yunnan', businessWindow: { start: '2026-09-10', end: '2026-09-10' } } }).catch((error) => error)
    expect(caught).toMatchObject({ status: 422, errorCode: 'UNPROCESSABLE' })
  })
})
