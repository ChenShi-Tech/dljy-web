// #538 阶段 1 基座回归：15 个 agent/* 子客户端共用的 HTTP factory 契约。
// 守住的不变量：
// 1. 头集矩阵，get 是业务读端点不带 x-admin-token；写方法（getAdmin/post/put/
// patch/delete）必须带；postForm 绝不能手设 content-type（浏览器要自动生成
// multipart boundary，手动设会坏上传）。头集错一档 = 越权或上传全挂。
// 2. errDetail 兜底链，FastAPI {detail} 提取不到时必须落到 `HTTP <status>`，
// 否则用户看到的是空错误气泡。
// 3. tryPut/tryPost 软失败，配置保存场景非 2xx/网络错误不抛（整页不崩），
// 返回 {ok:false,msg}；坏掉的症状是保存失败却弹全局错误。
// 4. timeout signal 必须真传进 fetch，丢了就退化成无限悬挂请求。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 可变 hoisted 状态：mock 工厂引用它们，用例里改值以覆盖「有/无管理令牌」两档
const identityState = vi.hoisted(() => ({
  headers: {} as Record<string, string>,
}))
const adminTokenState = vi.hoisted(() => ({ token: '' }))
// 固定 signal 让「init.signal 存在」可直接断言；同时记录 timeoutMs 供透传断言
const timeoutState = vi.hoisted(() => {
  const controller = new AbortController()
  return { controller, calls: [] as number[] }
})

vi.mock('@/services/agent/agentClient', () => ({
  AGENT_API_BASE: '/agent-api/agent',
  identityHeaders: () => identityState.headers,
}))
vi.mock('@/services/llm', () => ({
  getAdminToken: () => adminTokenState.token,
}))
vi.mock('@/services/api', () => ({
  AGENT_API_BASE_ROOT: '/agent-api',
  timeoutSignal: (ms: number) => {
    timeoutState.calls.push(ms)
    return timeoutState.controller.signal
  },
}))

import { createAgentClient, errDetail, DEFAULT_AGENT_TIMEOUT_MS } from '@/services/agent/httpClient'

// 实现签名带 fetch 两参，让 vi.fn 推导出 [string, RequestInit] 元组（用例直接取 calls[0][1]）
function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

function ok(data: unknown = { ok: 1 }): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  identityState.headers = { authorization: 'Bearer tok', 'x-company-id': 'c1', 'x-region-id': 'r1' }
  adminTokenState.token = 'admin-secret'
  timeoutState.calls = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('base 派生', () => {
  it('默认从 AGENT_API_BASE 派生：/llm → /agent-api/agent/llm/...', async () => {
    const spy = mockFetch(async () => ok())
    const http = createAgentClient('/llm')
    await http.get('/params')
    expect(spy.mock.calls[0][0]).toBe('/agent-api/agent/llm/params')
  })

  it('rootBase=true 从 AGENT_API_BASE_ROOT 派生（非 /agent 路由）', async () => {
    const spy = mockFetch(async () => ok())
    const http = createAgentClient('/v1/x', { rootBase: true })
    await http.get('/items')
    expect(spy.mock.calls[0][0]).toBe('/agent-api/v1/x/items')
  })

  it('绝对 URL basePath 直通，不叠加前缀', async () => {
    const spy = mockFetch(async () => ok())
    const http = createAgentClient('http://127.0.0.1:8100/api')
    await http.get('/ping')
    expect(spy.mock.calls[0][0]).toBe('http://127.0.0.1:8100/api/ping')
  })
})

describe('头集矩阵', () => {
  it('get 只带 identityHeaders，即使本机存有管理令牌也不带 x-admin-token', async () => {
    const spy = mockFetch(async () => ok())
    await createAgentClient('/llm').get('/params')
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.headers).toMatchObject(identityState.headers)
    expect(init.headers).not.toHaveProperty('x-admin-token')
    expect(init.headers).not.toHaveProperty('content-type')
  })

  it('getAdmin 带 x-admin-token + identity（复用 writeHeaders，连带 content-type——现行为）', async () => {
    const spy = mockFetch(async () => ok())
    await createAgentClient('/llm').getAdmin('/params')
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['x-admin-token']).toBe('admin-secret')
    expect(headers.authorization).toBe('Bearer tok')
    // 源码 getAdmin 走 writeHeaders()：GET 管理读也带 content-type（多余但无害，记录现行为）
    expect(headers['content-type']).toBe('application/json')
  })

  it.each(['post', 'put', 'patch'] as const)('%s 带 content-type + identity + admin token', async (m) => {
    const spy = mockFetch(async () => ok())
    await createAgentClient('/llm')[m]('/params', { a: 1 })
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.method).toBe(m.toUpperCase())
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      'x-admin-token': 'admin-secret',
      authorization: 'Bearer tok',
    })
    expect(init.body).toBe(JSON.stringify({ a: 1 }))
  })

  it('delete 带 admin token、无 body', async () => {
    const spy = mockFetch(async () => ok())
    await createAgentClient('/llm').delete('/params')
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('DELETE')
    expect(init.headers).toMatchObject({ 'x-admin-token': 'admin-secret' })
    expect(init.body).toBeUndefined()
  })

  it('postForm 不设 content-type，FormData 实例原样传递（boundary 交给浏览器生成）', async () => {
    const spy = mockFetch(async () => ok())
    const form = new FormData()
    form.append('file', 'x')
    await createAgentClient('/llm').postForm('/upload', form)
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    // 契约核心：手动设 content-type 会毁掉 multipart boundary
    expect(init.headers).not.toHaveProperty('content-type')
    expect(init.headers).toMatchObject({ 'x-admin-token': 'admin-secret', authorization: 'Bearer tok' })
    expect(init.body).toBe(form)
  })

  it('无管理令牌（getAdminToken 返回空串）时写方法不产生空 x-admin-token 头', async () => {
    adminTokenState.token = ''
    const spy = mockFetch(async () => ok())
    await createAgentClient('/llm').put('/params', {})
    expect(spy.mock.calls[0][1].headers).not.toHaveProperty('x-admin-token')
  })
})

describe('errDetail', () => {
  it('提取 FastAPI HTTPException 的 {detail}', async () => {
    const res = new Response(JSON.stringify({ detail: '缺少 deepseek 的 API Key' }), { status: 424 })
    expect(await errDetail(res)).toBe('缺少 deepseek 的 API Key')
  })

  it('JSON 但无 detail 字段 → 空串（由调用方落 `HTTP <status>` 兜底）', async () => {
    const res = new Response(JSON.stringify({ message: 'boom' }), { status: 500 })
    expect(await errDetail(res)).toBe('')
  })

  it('非 JSON body（代理 502 错误页）→ 空串不抛', async () => {
    const res = new Response('<html>502 Bad Gateway</html>', { status: 502 })
    expect(await errDetail(res)).toBe('')
  })
})

describe('硬请求错误处理', () => {
  it('非 2xx 优先抛 detail，兜底 `HTTP <status>`', async () => {
    mockFetch(async () => new Response(JSON.stringify({ detail: '参数非法' }), { status: 422 }))
    await expect(createAgentClient('/llm').post('/params', {})).rejects.toThrow('参数非法')

    mockFetch(async () => new Response('nope', { status: 503 }))
    await expect(createAgentClient('/llm').post('/params', {})).rejects.toThrow('HTTP 503')
  })

  it('空 body 的 2xx → 返回 null 而非空串 JSON.parse 崩溃', async () => {
    mockFetch(async () => new Response('', { status: 200 }))
    await expect(createAgentClient('/llm').get('/params')).resolves.toBeNull()
  })

  it('网络错误原样 rethrow（硬请求不做软失败）', async () => {
    mockFetch(async () => { throw new TypeError('fetch failed') })
    await expect(createAgentClient('/llm').get('/params')).rejects.toThrow('fetch failed')
  })
})

describe('tryPut / tryPost 软失败', () => {
  it('成功 → {ok:true}，不抛', async () => {
    mockFetch(async () => ok())
    await expect(createAgentClient('/llm').tryPut('/params', { a: 1 })).resolves.toEqual({ ok: true })
    await expect(createAgentClient('/llm').tryPost('/params', { a: 1 })).resolves.toEqual({ ok: true })
  })

  it('非 2xx → {ok:false,msg=detail}，不抛', async () => {
    mockFetch(async () => new Response(JSON.stringify({ detail: '校验失败' }), { status: 422 }))
    await expect(createAgentClient('/llm').tryPut('/params', {})).resolves.toEqual({ ok: false, msg: '校验失败' })
  })

  it('非 2xx 无 detail → msg 落 `HTTP <status>` 兜底', async () => {
    mockFetch(async () => new Response('oops', { status: 500 }))
    await expect(createAgentClient('/llm').tryPost('/params', {})).resolves.toEqual({ ok: false, msg: 'HTTP 500' })
  })

  it('网络错误 → {ok:false,msg=错误消息}，不抛', async () => {
    mockFetch(async () => { throw new TypeError('fetch failed') })
    const r = await createAgentClient('/llm').tryPut('/params', {})
    expect(r.ok).toBe(false)
    expect(r.msg).toBe('fetch failed')
  })

  it('非 Error 抛出物 → msg 落「网络错误」中文兜底', async () => {
    mockFetch(async () => { throw 'boom' })
    const r = await createAgentClient('/llm').tryPut('/params', {})
    expect(r).toEqual({ ok: false, msg: '网络错误（后端未运行？）' })
  })
})

describe('timeout 透传', () => {
  it('每次请求都带 signal，且 timeoutMs 传给 timeoutSignal（默认 10s，可覆盖）', async () => {
    const spy = mockFetch(async () => ok())
    const http = createAgentClient('/llm')
    await http.get('/a')
    await http.get('/b')
    expect(timeoutState.calls).toEqual([DEFAULT_AGENT_TIMEOUT_MS, DEFAULT_AGENT_TIMEOUT_MS])
    for (const c of spy.mock.calls) {
      expect((c[1] as RequestInit).signal).toBe(timeoutState.controller.signal)
    }

    const custom = createAgentClient('/llm', { timeoutMs: 45_000 })
    await custom.get('/c')
    expect(timeoutState.calls.at(-1)).toBe(45_000)
  })
})
