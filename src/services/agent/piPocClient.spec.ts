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

  it('重试等待期间用户又重新开启了授权：旧的撤销放弃，不关掉新的授权（dljy-web#121 第四轮审查 P2）', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: 'x' }, 502)) // 撤销第一次失败
      .mockResolvedValueOnce(jsonResponse({ auto_approve: true })) // 用户重新开启成功
    const sleep = vi.fn(async (_ms: number) => {
      await expect(setSessionAutoApprove('s_regrant', true)).resolves.toBe(true)
    })
    await expect(revokeSessionAutoApprove('s_regrant', { sleep, delaysMs: [10, 20] })).resolves.toBe(false)
    const disables = fetchMock.mock.calls.filter((c) => JSON.parse((c as [string, RequestInit])[1].body as string).enabled === false)
    expect(disables).toHaveLength(1) // 只有最初失败的那一次
  })

  it('撤销请求已发出、尚未落地时用户重新开启：开启排在撤销之后发出，旧的关闭压不过新的开启（dljy-web#122 审查 P2）', async () => {
    vi.stubGlobal('fetch', fetchMock)
    let finishRevoke: (r: Response) => void = () => {}
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((r) => { finishRevoke = r }))
      .mockResolvedValueOnce(jsonResponse({ auto_approve: true }))
    const revoking = revokeSessionAutoApprove('s_race', { sleep: async () => {}, delaysMs: [] })
    const enabling = setSessionAutoApprove('s_race', true)
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1) // 开启还在排队
    finishRevoke(jsonResponse({ auto_approve: false }))
    await expect(enabling).resolves.toBe(true)
    await revoking
    const order = fetchMock.mock.calls.map((c) => JSON.parse((c as [string, RequestInit])[1].body as string).enabled)
    expect(order).toEqual([false, true])
  })

  it('先后两次撤销请求都在途时开启：等全部落地才发出开启，先发出的那次也压不过新的开启（dljy-web#122 审查 P2）', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const finishers: Array<(r: Response) => void> = []
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((r) => { finishers.push(r) }))
      .mockImplementationOnce(() => new Promise<Response>((r) => { finishers.push(r) }))
      .mockResolvedValueOnce(jsonResponse({ auto_approve: true }))
    const first = revokeSessionAutoApprove('s_twice', { sleep: async () => {}, delaysMs: [] })
    const second = revokeSessionAutoApprove('s_twice', { sleep: async () => {}, delaysMs: [] })
    const enabling = setSessionAutoApprove('s_twice', true)
    await Promise.resolve()
    finishers[1](jsonResponse({ auto_approve: false })) // 后发出的先落地
    await second
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(2) // 先发出的还没落地，开启继续排队
    finishers[0](jsonResponse({ auto_approve: false }))
    await expect(enabling).resolves.toBe(true)
    await first
    const order = fetchMock.mock.calls.map((c) => JSON.parse((c as [string, RequestInit])[1].body as string).enabled)
    expect(order).toEqual([false, false, true])
  })

  it('开启请求失败或结果不明：重新发起撤销，并把错误照常抛给调用方（dljy#2962）', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock
      .mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError')) // 开启超时：服务端是否生效未知
      .mockResolvedValueOnce(jsonResponse({ auto_approve: false })) // 恢复的撤销
    await expect(setSessionAutoApprove('s_ambiguous', true)).rejects.toThrow('timeout')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c as [string, RequestInit])[1].body as string).enabled)
    expect(bodies).toEqual([true, false])
  })

  it('旧的开启还在途时又发起了新的开启：旧的开启随后失败，不清理、不关掉新的授权', async () => {
    vi.stubGlobal('fetch', fetchMock)
    let failOld: (e: Error) => void = () => {}
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((_r, reject) => { failOld = reject }))
      .mockResolvedValueOnce(jsonResponse({ auto_approve: true }))
    const older = setSessionAutoApprove('s_twice_grant', true)
    await Promise.resolve()
    await Promise.resolve()
    await expect(setSessionAutoApprove('s_twice_grant', true)).resolves.toBe(true)
    failOld(new TypeError('network'))
    await expect(older).rejects.toThrow('network')
    await new Promise((r) => setTimeout(r, 0))
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c as [string, RequestInit])[1].body as string).enabled)
    expect(bodies).toEqual([true, true])
  })

  it('开启请求刚发起、还没返回时，待重试的撤销醒来即放弃（世代在发起时推进）', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: 'x' }, 502)) // 撤销第一次失败
      .mockImplementationOnce(() => new Promise<Response>(() => {})) // 开启请求一直在途
    const sleep = vi.fn(async (_ms: number) => { void setSessionAutoApprove('s_pending', true) })
    await expect(revokeSessionAutoApprove('s_pending', { sleep, delaysMs: [10] })).resolves.toBe(false)
    const disables = fetchMock.mock.calls.filter((c) => JSON.parse((c as [string, RequestInit])[1].body as string).enabled === false)
    expect(disables).toHaveLength(1)
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
