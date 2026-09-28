// ingestClient 契约单测（#1406 / #1408 / dljy#3251）。
//
// 守三条曾经出过事的不变量：
// ① POST /v1/ingest/:kind 必须携带 idempotency-key，网关对全部 /api/v1 写请求强制该头，
// 缺失直接 428，导致「一键生效」与手动触发 100% 失败。
// ② 幂等键必须由 (kind, params) 确定性派生，不能是随机 UUID，服务端
// buildDedupKey(actor, kind, idempotencyKey || contentHash) 在客户端键存在时优先用客户端键，
// 随机键会让原本基于 contentHash 的双击去重全部失效。
// ③ 请求 URL 必须经 dataServicePath() 改写为 /data-svc/api/v1/ingest/:kind——摄取端点只在
// data-service :8190 注册，裸打 /api/v1/ingest 落平台 BFF 恒 404（dljy#3251），摄取从未真正发出。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ingestIdempotencyKey, ingestResultBasis, triggerIngest } from './ingestClient'

vi.mock('@/services/api', () => ({
  requestHeaders: () => ({ 'x-request-id': 'REQ-test', 'x-region-id': 'yunnan' }),
}))

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

function errResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body } as unknown as Response
}

describe('ingestIdempotencyKey', () => {
  it('对同一 (kind, params) 稳定复现', () => {
    const a = ingestIdempotencyKey('weather-export', { synthetic: false, region: 'yunnan' })
    const b = ingestIdempotencyKey('weather-export', { synthetic: false, region: 'yunnan' })
    expect(a).toBe(b)
  })

  it('忽略 params 的 key 顺序（与服务端 stableStringify 同口径）', () => {
    const a = ingestIdempotencyKey('weather-export', { synthetic: false, region: 'yunnan' })
    const b = ingestIdempotencyKey('weather-export', { region: 'yunnan', synthetic: false })
    expect(a).toBe(b)
  })

  it('params 不同则键不同', () => {
    const a = ingestIdempotencyKey('weather-export', { region: 'yunnan' })
    const b = ingestIdempotencyKey('weather-export', { region: 'shanxi' })
    expect(a).not.toBe(b)
  })

  it('kind 不同则键不同', () => {
    expect(ingestIdempotencyKey('spot-ingest', {})).not.toBe(ingestIdempotencyKey('forecast-etl', {}))
  })

  it('嵌套对象与数组也参与派生', () => {
    const a = ingestIdempotencyKey('spot-export', { filters: { months: ['2026-06'] } })
    const b = ingestIdempotencyKey('spot-export', { filters: { months: ['2026-07'] } })
    expect(a).not.toBe(b)
  })
})

describe('triggerIngest', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('请求 URL 经 dataServicePath 改写为 /data-svc/api/v1/ingest/:kind（裸 /api/v1/ingest 恒 404，dljy#3251）', async () => {
    fetchMock.mockResolvedValue(okResponse({ code: 200, ok: true, kind: 'weather-export' }))

    await triggerIngest('weather-export', { synthetic: false })

    const [url] = fetchMock.mock.calls[0]
    // 修复前这里是裸 /api/v1/ingest/weather-export，命中平台 BFF 的 404 兜底。
    expect(url).toBe('/data-svc/api/v1/ingest/weather-export')
    expect(url).not.toMatch(/^\/api\//)
  })

  it('改写对全部 IngestKind 生效（无一落在裸 /api 路径）', async () => {
    fetchMock.mockResolvedValue(okResponse({ code: 200, ok: true, kind: 'x' }))
    const kinds = [
      'spot-export',
      'weather-export',
      'market-export',
      'spot-ingest',
      'forecast-etl',
      'cgn-yunnan-prices',
      'cgn-yunnan-market',
    ] as const

    for (const kind of kinds) {
      await triggerIngest(kind)
    }

    expect(fetchMock.mock.calls).toHaveLength(kinds.length)
    for (const [callIndex, kind] of kinds.entries()) {
      const [url] = fetchMock.mock.calls[callIndex]
      expect(url).toBe(`/data-svc/api/v1/ingest/${kind}`)
    }
  })

  it('请求头携带 idempotency-key（缺失会被网关 428 拦下）', async () => {
    fetchMock.mockResolvedValue(okResponse({ code: 200, ok: true, kind: 'weather-export' }))

    await triggerIngest('weather-export', { synthetic: false })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/data-svc/api/v1/ingest/weather-export')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['idempotency-key']).toBe(ingestIdempotencyKey('weather-export', { synthetic: false }))
    expect(headers['idempotency-key']).toBeTruthy()
  })

  it('保留 requestHeaders() 注入的统一身份/地区头', async () => {
    fetchMock.mockResolvedValue(okResponse({ code: 200, ok: true, kind: 'spot-ingest' }))

    await triggerIngest('spot-ingest')

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers['x-region-id']).toBe('yunnan')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('两次同 params 调用发出同一个幂等键（服务端据此去重，不重复 spawn ETL）', async () => {
    fetchMock.mockResolvedValue(okResponse({ code: 200, ok: true, kind: 'forecast-etl' }))

    await triggerIngest('forecast-etl', { write: true })
    await triggerIngest('forecast-etl', { write: true })

    const first = (fetchMock.mock.calls[0][1].headers as Record<string, string>)['idempotency-key']
    const second = (fetchMock.mock.calls[1][1].headers as Record<string, string>)['idempotency-key']
    expect(first).toBe(second)
  })

  it('网关错误体（msg 形态）能透出服务端原因', async () => {
    fetchMock.mockResolvedValue(errResponse(428, { code: 428, msg: '写入类 /api/v1 请求必须携带 Idempotency-Key。', traceId: 'REQ-x' }))

    await expect(triggerIngest('weather-export')).rejects.toThrow('写入类 /api/v1 请求必须携带 Idempotency-Key。')
  })

  it('模块错误体（error 别名形态）仍能透出原因', async () => {
    fetchMock.mockResolvedValue(errResponse(403, { code: 403, error: '角色 QUANT 无权触发数据摄取' }))

    await expect(triggerIngest('weather-export')).rejects.toThrow('角色 QUANT 无权触发数据摄取')
  })

  it('两者皆缺时回落 stderr，再回落 HTTP 状态', async () => {
    fetchMock.mockResolvedValue(errResponse(500, { code: 500, stderr: 'ETL 崩了' }))
    await expect(triggerIngest('weather-export')).rejects.toThrow('ETL 崩了')

    fetchMock.mockResolvedValue(errResponse(502, {}))
    await expect(triggerIngest('weather-export')).rejects.toThrow('摄取失败（HTTP 502）')
  })
})

describe('ingestResultBasis', () => {
  // 气象合成兜底会正常退出（exitCode 0），只能靠输出里的 MOCK/synthetic/合成 标记识别，漏判就会把合成数据标成可决策。
  it('输出含合成标记（stdout 或 stderr，大小写不敏感）→ synthetic', () => {
    expect(ingestResultBasis({ stdout: 'sourceType=MOCK', stderr: '' })).toBe('synthetic')
    expect(ingestResultBasis({ stdout: '', stderr: 'fallback: Synthetic series' })).toBe('synthetic')
    expect(ingestResultBasis({ stdout: '(--synthetic 合成)', stderr: '' })).toBe('synthetic')
  })

  it('无合成标记 → captured', () => {
    expect(ingestResultBasis({ stdout: 'wrote 96 rows to yn_meteo', stderr: '' })).toBe('captured')
  })
})
