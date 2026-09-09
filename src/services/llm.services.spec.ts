// 模型服务客户端（主仓 Epic #2661 · #2668 · #2701）：前端「选服务」面唯一的取数 / 写入出口。
// 守的不变量：
// 1. 请求只打 /llm/services、/llm/test 与 /llm/services/credential、/llm/services/usage、
//    /llm/services/search/test，且**除「保存凭据」这一次 PUT 外任何请求体里都没有密钥字段**——
//    密钥明文只在粘贴保存那一次直传服务端，之后任何请求都不再携带；
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
  deleteCredential,
  getCachedTiers,
  getServices,
  getServicesUsage,
  isLlmConfigured,
  putCredential,
  putServices,
  refreshLlmStatus,
  setAdminToken,
  testSearchService,
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

describe('putCredential / deleteCredential', () => {
  it('保存凭据打 PUT /llm/services/credential，body 只含 url / key，带管理令牌头', async () => {
    setAdminToken('tok-1')
    fetchMock.mockResolvedValueOnce(json({ ...SERVICES, available: true }))
    const r = await putCredential({ url: 'https://gw.example.internal/v1', key: 'sk-test-0000' })
    const c = lastCall()
    expect(c.url).toBe('/agent-api/agent/llm/services/credential')
    expect(c.init.method).toBe('PUT')
    expect(c.headers['x-admin-token']).toBe('tok-1')
    expect(c.headers['x-user-id']).toBe('u1')
    // body 只有两个字段：明文密钥只出现在这一次请求里
    expect(Object.keys(c.body).sort()).toEqual(['key', 'url'])
    expect(c.body).toEqual({ url: 'https://gw.example.internal/v1', key: 'sk-test-0000' })
    expect(r.ok).toBe(true)
    expect(r.services?.available).toBe(true)
  })

  it('保存成功用回传的 services 更新模块级缓存（档位与就绪位随之刷新）', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...SERVICES, tiers: SERVICES.tiers.map((t) => ({ ...t, enabled: true })) }))
    await putCredential({ key: 'sk-test-0000' })
    expect(getCachedTiers().every((t) => t.enabled)).toBe(true)
    expect(isLlmConfigured()).toBe(true)
    // 未传 url 时 body 里没有空串 url 字段
    expect(Object.keys(lastCall().body)).toEqual(['key'])
  })

  it('服务端拒绝（密钥错误）时把 detail 原样带回，页面据此在表单下方红字提示', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: '密钥校验失败：模型服务返回 401' }, 400))
    const r = await putCredential({ key: 'sk-bad' })
    expect(r).toEqual({ ok: false, msg: '密钥校验失败：模型服务返回 401' })
  })

  it('清除凭据走 DELETE 同一路径，成功回传最新 services 并刷新缓存', async () => {
    setAdminToken('tok-1')
    fetchMock.mockResolvedValueOnce(json({ ...SERVICES, available: false, credential: { configured: false, source: null, url: '', key_hint: '', updated_at: null } }))
    const r = await deleteCredential()
    const c = lastCall()
    expect(c.url).toBe('/agent-api/agent/llm/services/credential')
    expect(c.init.method).toBe('DELETE')
    expect(c.headers['x-admin-token']).toBe('tok-1')
    expect(c.init.body).toBeUndefined()
    expect(r.ok).toBe(true)
    expect(r.services?.credential?.configured).toBe(false)
    expect(isLlmConfigured()).toBe(false)
  })

  it('清除被拒（安装预置的凭据不允许界面清除）时带回原因', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: '安装预置的凭据不能在界面清除' }, 409))
    const r = await deleteCredential()
    expect(r).toEqual({ ok: false, msg: '安装预置的凭据不能在界面清除' })
  })
})

describe('getServicesUsage', () => {
  it('GET /llm/services/usage 解析额度，from/to 走查询参数', async () => {
    fetchMock.mockResolvedValueOnce(json({
      available: true,
      usage: {
        today: { day: '2026-09-03', requests: 12, total_tokens: 3456, usage_unknown: 1 },
        quota: { requests_per_day: 100, tokens_per_day: null },
        remaining: { requests: 88, tokens: null },
        resets_at: '2026-09-04T00:00:00+08:00',
        rows: [{ day: '2026-09-03', tier: 'dljy-standard', requests: 12, failed: 0, total_tokens: 3456 }]
      }
    }))
    const r = await getServicesUsage('2026-09-01', '2026-09-03')
    expect(lastCall().url).toBe('/agent-api/agent/llm/services/usage?from=2026-09-01&to=2026-09-03')
    expect(r.available).toBe(true)
    expect(r.usage?.today.requests).toBe(12)
    expect(r.usage?.quota.tokens_per_day).toBeNull()
    expect(r.usage?.rows[0].tier).toBe('dljy-standard')
  })

  it('available:false（服务端暂时给不出额度）时 reason 透传、usage 缺省', async () => {
    fetchMock.mockResolvedValueOnce(json({ available: false, reason: '凭据未配置，无法统计用量' }))
    const r = await getServicesUsage()
    expect(lastCall().url).toBe('/agent-api/agent/llm/services/usage')
    expect(r).toEqual({ available: false, reason: '凭据未配置，无法统计用量' })
  })
})

describe('testSearchService', () => {
  it('POST /llm/services/search/test，头同写请求，body 为空且不带任何供应商 / 密钥字段', async () => {
    setAdminToken('tok-1')
    fetchMock.mockResolvedValueOnce(json({ ok: true, msg: '联网搜索可用' }))
    const r = await testSearchService()
    const c = lastCall()
    expect(c.url).toBe('/agent-api/agent/llm/services/search/test')
    expect(c.init.method).toBe('POST')
    expect(c.headers['content-type']).toBe('application/json')
    expect(c.headers['x-admin-token']).toBe('tok-1')
    expect(c.body).toEqual({})
    expect(r).toEqual({ ok: true, msg: '联网搜索可用' })
  })

  it('失败时 detail / msg 原样带回（页面据此显示暂时不可用的原因）', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: false, detail: '搜索服务超时' }, 504))
    expect(await testSearchService()).toEqual({ ok: false, msg: '搜索服务超时' })
  })
})

describe('密钥字段不出现在凭据保存之外的请求里（不变量 1，#2701 收窄）', () => {
  it('遍历一次会话里的所有请求：除 PUT /services/credential 外，任何请求体都没有密钥字段', async () => {
    fetchMock
      .mockResolvedValueOnce(json(SERVICES))                    // getServices
      .mockResolvedValueOnce(json(SERVICES))                    // putServices
      .mockResolvedValueOnce(json({ ok: true, msg: '' }))       // testService
      .mockResolvedValueOnce(json({ ok: true, msg: '' }))       // testSearchService
      .mockResolvedValueOnce(json({ available: false }))        // getServicesUsage
      .mockResolvedValueOnce(json({ ...SERVICES, available: true })) // putCredential（唯一允许带密钥的）
    await getServices()
    await putServices({ enabled: ['dljy-standard'] })
    await testService('dljy-standard')
    await testSearchService()
    await getServicesUsage()
    await putCredential({ url: 'https://gw.example.internal/v1', key: 'sk-test-0000' })

    const offenders = fetchMock.mock.calls
      .map(([url, init]) => ({ url: String(url), init: (init ?? {}) as RequestInit }))
      .filter(({ url, init }) => {
        if (init.method === 'PUT' && url.endsWith('/llm/services/credential')) return false
        if (!init.body) return false
        const keys = Object.keys(JSON.parse(String(init.body)))
        return keys.some((k) => /key|secret|token|password/i.test(k))
      })
    expect(offenders).toEqual([])
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
