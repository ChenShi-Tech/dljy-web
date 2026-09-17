// piPocClient 收编守卫（#1526/#1527）：pi-poc 两个 PoC 页的取数出口。
// 守的不变量：
// 1. 端点必须走 PI_AGENT_BASE（agentClient.ts 单一定义），页面不得再散落硬编码 '/pi-api/...'
// 本仓代理被误删时两页静默 404 的根因正是散落取数无人治理；
// 2. 请求必须带 identityHeaders 与超时 signal（与 agentClient 同档纪律）；
// 3. setSessionAutoApprove 的返回以服务端 auto_approve === true 为准（授权状态以服务端为
// 权威，前端开关只是意向）；失败抛 `HTTP <status>`，由页面回滚开关显示（不留假授权状态）。
import { afterEach, describe, expect, it, vi } from 'vitest'

const identityHeaders = vi.hoisted(() => vi.fn(() => ({ 'x-user-id': 'u1' })))
// PI_AGENT_BASE 与 identityHeaders 同源（双栈退场后基址常量落在 agentClient），mock 需一并提供，
// 否则被测模块拿到 undefined、断言会因「两边都是 undefined」而无区分力地通过。
vi.mock('@/services/agent/agentClient', () => ({ identityHeaders, PI_AGENT_BASE: '/pi-api/agent' }))
vi.mock('@/services/api', () => ({
  timeoutSignal: vi.fn(() => 'timeout-signal-stub'),
  AGENT_API_BASE_ROOT: '/agent-api'
}))

import { fetchDataGaps, fetchPiSessionMeta, revokeSessionAutoApprove, setSessionAutoApprove } from './piPocClient'
import { PI_AGENT_BASE } from './agentClient'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  fetchMock.mockReset()
  identityHeaders.mockClear()
  vi.unstubAllGlobals()
})

describe('fetchDataGaps', () => {
  it('走 PI_AGENT_BASE、带身份头与超时 signal，提取 markdown', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ markdown: '# 缺口\n- 云南日前价缺 3 天' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchDataGaps()).resolves.toBe('# 缺口\n- 云南日前价缺 3 天')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${PI_AGENT_BASE}/data-gaps`)
    expect(url.startsWith('/pi-api/agent')).toBe(true) // 基址若换实现，仍必须落在 pi 面
    expect(init.headers).toEqual({ 'x-user-id': 'u1' })
    expect(init.signal).toBe('timeout-signal-stub')
    expect(identityHeaders).toHaveBeenCalled()
  })

  it('markdown 字段缺失或空串诚实返回空串（不造数据）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    fetchMock.mockResolvedValueOnce(jsonResponse({ markdown: '' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchDataGaps()).resolves.toBe('')
    await expect(fetchDataGaps()).resolves.toBe('')
  })

  it('服务不可达/非 2xx 抛 HTTP <status>（页面据此提示「pi-poc 服务未启动？」）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'not found' }, 404))
    fetchMock.mockResolvedValueOnce(new Response('gateway html', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchDataGaps()).rejects.toThrow('HTTP 404')
    await expect(fetchDataGaps()).rejects.toThrow('HTTP 502')
  })
})

describe('fetchPiSessionMeta（统一 AI 侧边栏：重新打开会话找回专家入口与授权状态）', () => {
  it('显式走 PI_AGENT_BASE 的会话详情（sessionId 编码），带身份头，取解读角色与授权状态', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 's 1', scenario: 'chat', prompt_key: 'pre_submit_check', auto_approve: true }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchPiSessionMeta('s 1')).resolves.toEqual({ promptKey: 'pre_submit_check', autoApprove: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${PI_AGENT_BASE}/sessions/s%201`)
    expect(init.headers).toEqual({ 'x-user-id': 'u1' })
  })

  it('pi 不认识该会话（非 2xx）返回 null；旧版 pi 缺字段时解读角色为 null、授权按未开启', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'not found' }, 404))
    await expect(fetchPiSessionMeta('s_gone')).resolves.toBeNull()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 's_old', scenario: 'chat' }))
    await expect(fetchPiSessionMeta('s_old')).resolves.toEqual({ promptKey: null, autoApprove: false })
  })
})

describe('revokeSessionAutoApprove（切走会话/卸载时撤销授权，失败按退避重试）', () => {
  it('一次成功即返回 true，不等待', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ auto_approve: false }))
    vi.stubGlobal('fetch', fetchMock)
    const sleep = vi.fn(async (_ms: number) => {})
    await expect(revokeSessionAutoApprove('s1', { sleep })).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ enabled: false })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('网络或服务端失败时按退避重试，直到成功', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(jsonResponse({ detail: 'x' }, 502))
      .mockResolvedValueOnce(jsonResponse({ auto_approve: false }))
    vi.stubGlobal('fetch', fetchMock)
    const sleep = vi.fn(async (_ms: number) => {})
    await expect(revokeSessionAutoApprove('s1', { sleep, delaysMs: [10, 20, 30] })).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20])
  })

  it('重试用尽仍失败：返回 false（用户重新打开会话时按服务端状态仍能看到并关闭）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'x' }, 503))
    vi.stubGlobal('fetch', fetchMock)
    const sleep = vi.fn(async (_ms: number) => {})
    await expect(revokeSessionAutoApprove('s1', { sleep, delaysMs: [10, 20] })).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('setSessionAutoApprove', () => {
  it('POST 到会话端点：sessionId 编码、body 只含 enabled、带身份头与 content-type', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ auto_approve: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(setSessionAutoApprove('s/1 侵袭', true)).resolves.toBe(true)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${PI_AGENT_BASE}/sessions/${encodeURIComponent('s/1 侵袭')}/auto-approve`)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-user-id': 'u1' })
    expect(JSON.parse(init.body as string)).toEqual({ enabled: true })
  })

  it('返回以服务端 auto_approve === true 为准（前端意向不等于生效态）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ auto_approve: false }))
    fetchMock.mockResolvedValueOnce(jsonResponse({})) // 服务端未回显 → 视为未生效
    vi.stubGlobal('fetch', fetchMock)

    await expect(setSessionAutoApprove('s1', true)).resolves.toBe(false)
    await expect(setSessionAutoApprove('s1', true)).resolves.toBe(false)
  })

  it('非 2xx 抛 HTTP <status>——页面据此回滚开关，不留假授权显示', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'session gone' }, 410))
    vi.stubGlobal('fetch', fetchMock)

    await expect(setSessionAutoApprove('s1', true)).rejects.toThrow('HTTP 410')
  })
})
