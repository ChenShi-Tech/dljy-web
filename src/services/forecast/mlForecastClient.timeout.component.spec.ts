// 预测请求超时（#3578）：浏览器原生 "signal timed out" 必须转成可读中文提示，后端 detail 等既有错误原样保留。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FORECAST_REQUEST_TIMEOUT_MS, FORECAST_TIMEOUT_MESSAGE, runForecastPredict, toForecastRequestError } from './mlForecastClient'

const req = { region_id: 'yunnan', target: 'price', model_type: 'lightgbm' } as unknown as Parameters<typeof runForecastPredict>[0]

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('预测请求超时', () => {
  it('超时上限放宽到 180s（迁移期南洋+本机混合）', () => {
    expect(FORECAST_REQUEST_TIMEOUT_MS).toBe(180000)
  })

  it('TimeoutError（AbortSignal.timeout）转成中文提示，不再暴露 signal timed out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('signal timed out', 'TimeoutError')))
    await expect(runForecastPredict(req)).rejects.toThrow(FORECAST_TIMEOUT_MESSAGE)
    await expect(runForecastPredict(req)).rejects.not.toThrow(/signal timed out/)
  })

  it('无 AbortSignal.timeout 的回退路径（AbortError）同样转中文提示', () => {
    const err = toForecastRequestError(new DOMException('signal is aborted without reason', 'AbortError'))
    expect((err as Error).message).toBe(FORECAST_TIMEOUT_MESSAGE)
    expect(FORECAST_TIMEOUT_MESSAGE).toContain('预测耗时过长已超时')
  })

  it('后端 detail 错误保持原样，不被误判为超时', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: 'target_date 不在可用数据范围内' }) }))
    await expect(runForecastPredict(req)).rejects.toThrow('target_date 不在可用数据范围内')
  })

  it('普通网络错误不改分类', () => {
    const e = new TypeError('Failed to fetch')
    expect(toForecastRequestError(e)).toBe(e)
  })
})
