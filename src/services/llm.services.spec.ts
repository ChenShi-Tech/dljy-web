// 模型服务客户端（主仓 Epic #2661 · #2668）：前端「选服务」面唯一的取数 / 写入出口。
// 守的不变量：
// 1. 请求只打 /llm/services 与 /llm/test，且**任何请求体里都没有密钥字段**——前端不持密钥；
// 2. 写请求带我方管理令牌头（存本机浏览器）；
// 3. 「大模型是否就绪」= 网关档位可用，或（未配网关的内部档）服务端任一供应商已有 key；
//    交付档下供应商端点 404 → 诚实 false，不伪造就绪。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/agent/agentClient', () => ({
  AGENT_API_BASE: '/agent-api/agent',
  identityHeaders: () => ({ 'x-user-id': 'u1' })
}))
vi.mock('@/services/api', () => ({ timeoutSignal: () => undefined }))

import {
  getCachedTiers,
  getServices,
  isLlmConfigured,
  putServices,
  refreshLlmStatus,
  setAdminToken,
  testService
} from './llm'

const fetchMock = vi.fn()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const SERVICES = {
  available: true,
  gateway: true,
  reason: null,
  tiers: [
    { id: 'dljy-standard', label: '标准', description: '日常', capabilities: ['tool_call'], context_window: 128000, available: true, enabled: true },
    { id: 'dljy-fast', label: '快速', description: '摘要', capabilities: ['tool_call'], context_window: null, available: true, enabled: false }
  ],
  roles: [{ role: 'market_analyst', default_tier: 'dljy-standard', tier: 'dljy-standard', override: false, requires: ['tool_call'] }]
}

const store = new Map<string, string>()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  })
})
afterEach(() => vi.unstubAllGlobals())

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, init, body: init?.body ? JSON.parse(String(init.body)) : null, headers: (init?.headers ?? {}) as Record<string, string> }
}

describe('getServices', () => {
  it('解析档位与角色，并缓存档位供同步读取', async () => {
    fetchMock.mockResolvedValueOnce(json(SERVICES))
    const s = await getServices()
    expect(lastCall().url).toBe('/agent-api/agent/llm/services')
    expect(s.tiers.map((t) => t.id)).toEqual(['dljy-standard', 'dljy-fast'])
    expect(s.roles[0].role).toBe('market_analyst')
    expect(getCachedTiers().map((t) => t.label)).toEqual(['标准', '快速'])
  })

  it('字段缺失时补空数组，不让页面拿到 undefined 去 map', async () => {
    fetchMock.mockResolvedValueOnce(json({ available: false, gateway: false, reason: '未配置模型服务网关' }))
    const s = await getServices()
    expect(s).toEqual({ available: false, gateway: false, reason: '未配置模型服务网关', tiers: [], roles: [] })
  })

  it('非 2xx 抛错（页面据此显示「无法连接」而不是空清单）', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'nope' }, 503))
    await expect(getServices()).rejects.toThrow('services 503')
  })
})

describe('putServices', () => {
  it('PUT 带管理令牌头与请求体，回传服务端最新状态', async () => {
    setAdminToken('tok-1')
    fetchMock.mockResolvedValueOnce(json({ ...SERVICES, tiers: SERVICES.tiers.map((t) => ({ ...t, enabled: true })) }))
    const r = await putServices({ enabled: ['dljy-standard', 'dljy-fast'], roles: { market_analyst: '' } })
    const c = lastCall()
    expect(c.url).toBe('/agent-api/agent/llm/services')
    expect(c.init.method).toBe('PUT')
    expect(c.headers['x-admin-token']).toBe('tok-1')
    expect(c.body).toEqual({ enabled: ['dljy-standard', 'dljy-fast'], roles: { market_analyst: '' } })
    expect(r.ok).toBe(true)
    expect(r.services?.tiers.every((t) => t.enabled)).toBe(true)
    expect(getCachedTiers().every((t) => t.enabled)).toBe(true)
  })

  it('服务端拒绝时把 detail 原样带回（页面据此提示，不吞成「未知错误」）', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: '档位 dljy-fast 未启用，角色只能路由到已启用档位' }, 400))
    const r = await putServices({ roles: { market_analyst: 'dljy-fast' } })
    expect(r).toEqual({ ok: false, msg: '档位 dljy-fast 未启用，角色只能路由到已启用档位' })
  })

  it('网络异常不抛，返回 ok:false', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const r = await putServices({ enabled: [] })
    expect(r.ok).toBe(false)
    expect(r.msg).toBe('fetch failed')
  })
})

describe('testService', () => {
  it('只发档位 id，请求体不含任何密钥 / 地址字段', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, msg: '连接成功（经模型服务网关）' }))
    const r = await testService('dljy-fast')
    const c = lastCall()
    expect(c.url).toBe('/agent-api/agent/llm/test')
    expect(c.body.model).toBe('dljy-fast')
    expect(Object.keys(c.body)).not.toContain('api_key')
    expect(Object.keys(c.body)).not.toContain('base_url')
    expect(r).toEqual({ ok: true, msg: '连接成功（经模型服务网关）' })
  })

  it('服务端非 2xx 且无 msg 时给出 HTTP 状态', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 502 }))
    expect(await testService('dljy-fast')).toEqual({ ok: false, msg: 'HTTP 502' })
  })
})

describe('refreshLlmStatus', () => {
  it('网关档位可用 → 就绪，且不再去问供应商端点', async () => {
    fetchMock.mockResolvedValueOnce(json(SERVICES))
    expect(await refreshLlmStatus()).toBe(true)
    expect(isLlmConfigured()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('未配网关的内部档：服务端任一供应商有 key 即就绪，只看 has_key 一位', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ available: false, gateway: false, reason: '未配置模型服务网关', tiers: [], roles: [] }))
      .mockResolvedValueOnce(json({ providers: [{ has_key: false }, { has_key: true }] }))
    expect(await refreshLlmStatus()).toBe(true)
    expect(lastCall().url).toBe('/agent-api/agent/llm/providers')
  })

  it('交付档下供应商端点 404 → 诚实未就绪', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ available: false, gateway: false, reason: null, tiers: [], roles: [] }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
    expect(await refreshLlmStatus()).toBe(false)
    expect(isLlmConfigured()).toBe(false)
  })

  it('网关模式但目录为空（网关不可达）→ 未就绪，不回退去问供应商', async () => {
    fetchMock.mockResolvedValueOnce(json({ available: false, gateway: true, reason: '网关不可达', tiers: [], roles: [] }))
    expect(await refreshLlmStatus()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('后端未运行 → 未就绪，不抛', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await refreshLlmStatus()).toBe(false)
  })
})
