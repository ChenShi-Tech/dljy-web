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

import { fetchDataGaps, setSessionAutoApprove } from './piPocClient'
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
