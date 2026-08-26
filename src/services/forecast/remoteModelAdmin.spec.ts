// @vitest-environment happy-dom
// 管理代理客户端（dljy#2465）：裸 id 剥前缀、URL 落位、错误体 detail 透出、目录归一化。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bareModelId, fetchRemoteModels, setRemoteModelEnabled, activateRemoteVersion } from './remoteModelAdmin'

const calls: { url: string; method?: string }[] = []
function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method })
    return { ok: status < 400, status, json: async () => body } as Response
  }))
}
afterEach(() => { vi.unstubAllGlobals(); calls.length = 0 })

describe('remoteModelAdmin', () => {
  it('bareModelId 剥 remote: 前缀', () => {
    expect(bareModelId('remote:dlinear-yn-price')).toBe('dlinear-yn-price')
    expect(bareModelId('dlinear-yn-price')).toBe('dlinear-yn-price')
  })
  it('写操作打到 /v1/forecast/remote/models/<裸 id>/…', async () => {
    mockFetch(200, { ok: true })
    await setRemoteModelEnabled('remote:m-1', false)
    await activateRemoteVersion('remote:m-1', 'v2')
    expect(calls.map((c) => c.url.replace(/^.*\/v1\/forecast\/remote/, ''))).toEqual(['/models/m-1/disable', '/models/m-1/activate/v2'])
    expect(calls.every((c) => c.method === 'POST')).toBe(true)
  })
  it('错误体 detail 透出为 Error 信息（南洋拒权 502 的原因不能丢）', async () => {
    mockFetch(502, { detail: '推理服务拒绝平台凭据（HTTP 403）：平台对南洋没有管理权限' })
    await expect(setRemoteModelEnabled('remote:m-1', true)).rejects.toThrow('没有管理权限')
  })
  it('目录归一化：io/lineage 进 ForecastModel，坏条目丢弃', async () => {
    mockFetch(200, [
      { modelId: 'remote:a', target: 'price', regionId: 'yunnan', available: true, basisVersion: 'model-registry.v1',
        provenance: { basis: 'real', sourceType: 'REAL', mock: false, productionWrite: false },
        io: { intervalMinutes: 15, covariates: [], quantilesSupported: [] }, lineage: { activeVersion: 'v1' } },
      { target: 'price' },
    ])
    const ms = await fetchRemoteModels()
    expect(ms).toHaveLength(1)
    expect(ms[0].io?.intervalMinutes).toBe(15)
    expect(ms[0].lineage?.activeVersion).toBe('v1')
  })
})
