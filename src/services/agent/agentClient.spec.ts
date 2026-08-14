// @vitest-environment happy-dom
// ↑ 勿删：本文件不是 *.component.spec.ts，vitest node project 默认不给 DOM；
//   用例依赖 localStorage（身份头 / pi 会话路由登记），靠此 pragma 按文件切到 happy-dom。
//
// agentClient 契约回归（#1848 / STREAM-5/10 / #1631）：
//   1. identityHeaders 三元组（token+company+region）与 identityFingerprint 快照——
//      影子对拍靠指纹防「A 的首轮还在流式返回时换登录 B，影子拿 B 的凭证跑 A 的问题」。
//   2. pi 会话路由登记——服务端灰度命中的 pi 会话写 localStorage（刷新后仍路由正确）；
//      baseOverride 影子会话只进内存路由表（写 localStorage 会把真实会话路由表挤出前 50 条）。
//   3. SSE 流解析（核心）——CRLF/LF 双分隔、心跳帧静默跳过、seq 游标取 max、
//      尾帧无尾随分隔符仍消费（done 丢失 = 面板状态机悬挂，STREAM-5/10）、
//      无终态帧抛 AgentStreamDisconnectedError、abort 静默返回。
//   4. x-run-id 响应头 → 转 attachRunStream 续流。
//   5. getActiveRun 404 → null 不抛。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── 可变 hoisted 状态：mock 工厂引用，用例里改值 ──
const regionState = vi.hoisted(() => ({ id: 'yunnan' }))
const rolloutState = vi.hoisted(() => ({ base: '/agent-api/agent' }))
const comparableState = vi.hoisted(() => ({ comparable: false }))
const timeoutSignalState = vi.hoisted(() => ({ signal: new AbortController().signal }))

vi.mock('@/services/api', () => ({
  AGENT_API_BASE_ROOT: '/agent-api',
  timeoutSignal: () => timeoutSignalState.signal,
  // 聊天历史走 Node /api（本文件不测，提供形状防 undefined import）
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}))
vi.mock('@/services/agent/rollout', () => ({
  PI_AGENT_BASE: '/pi-api/agent',
  resolveServingBase: async () => rolloutState.base,
  isShadowScenario: async () => false,
}))
vi.mock('@/services/agent/shadowCompare', () => ({
  // hasExtraContext=false + comparable=false → sendAgentMessage 不挂观测器、不起影子，
  // 本文件聚焦传输层（影子对拍语义由 shadowCompare.spec.ts 守）
  splitTurnPayload: (payload: Record<string, unknown> | undefined) => ({ shadowPayload: payload, hasExtraContext: false }),
  isComparableTurn: () => comparableState.comparable,
  createTurnObserver: () => { throw new Error('本文件不应创建影子观测器') },
}))
vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { get value() { return { id: regionState.id } } },
}))

import {
  AGENT_API_BASE,
  AgentStreamDisconnectedError,
  AgentStreamHttpError,
  attachRunStream,
  createAgentSession,
  getActiveRun,
  identityFingerprint,
  identityHeaders,
  sendAgentMessage,
  type AgentEvent,
} from '@/services/agent/agentClient'

const PI_KEY = 'dljy.piPocSessionIds'
const PI_BASE = '/pi-api/agent'

function mockFetch(impl: (...args: unknown[]) => Promise<Response>) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

/** 手造 SSE 流响应：chunks 逐段 enqueue（可把一帧拆成多个 chunk 测跨块拼接）。 */
function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' }, ...init })
}

function jsonRes(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

/** 收集事件的回调 + 简化调用 attachRunStream。 */
async function collect(chunks: string[], opts: { cursor?: number } = {}) {
  const events: AgentEvent[] = []
  const cursors: number[] = []
  mockFetch(async () => sseResponse(chunks))
  const result = await attachRunStream('sess-sse', 'run-0', opts.cursor ?? -1, (e) => events.push(e), {
    onCursor: (c) => cursors.push(c),
  })
  return { events, cursors, result }
}

beforeEach(() => {
  localStorage.clear()
  regionState.id = 'yunnan'
  rolloutState.base = AGENT_API_BASE
  comparableState.comparable = false
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('identityHeaders / identityFingerprint', () => {
  it('三元组：token→authorization Bearer，company→x-company-id，region→x-region-id', () => {
    localStorage.setItem('dljy_restore_token', 'tok-1')
    localStorage.setItem('dljy.currentCompanyId', 'comp-1')
    expect(identityHeaders()).toEqual({
      authorization: 'Bearer tok-1',
      'x-company-id': 'comp-1',
      'x-region-id': 'yunnan',
    })
  })

  it('任一项缺失时只省略对应头，不带空值', () => {
    localStorage.setItem('dljy_restore_token', 'tok-1')
    const h = identityHeaders()
    expect(h).toEqual({ authorization: 'Bearer tok-1', 'x-region-id': 'yunnan' })
    expect(h).not.toHaveProperty('x-company-id')
  })

  it('指纹：同状态稳定相等；token/company/region 任一变化即变（DataScope 隔离前提）', () => {
    localStorage.setItem('dljy_restore_token', 'tok-1')
    localStorage.setItem('dljy.currentCompanyId', 'comp-1')
    const a = identityFingerprint()
    expect(identityFingerprint()).toBe(a)
    localStorage.setItem('dljy_restore_token', 'tok-2')
    expect(identityFingerprint()).not.toBe(a)
    localStorage.setItem('dljy_restore_token', 'tok-1')
    regionState.id = 'shanxi'
    expect(identityFingerprint()).not.toBe(a)
    regionState.id = 'yunnan'
    expect(identityFingerprint()).toBe(a)
  })
})

describe('createAgentSession 会话级路由登记', () => {
  it('灰度命中 pi：sessionId 写 localStorage dljy.piPocSessionIds（刷新后仍路由正确）', async () => {
    rolloutState.base = PI_BASE
    mockFetch(async () => jsonRes({ id: 'sess-pi', scenario: 'chat', title: '', status: 'idle' }))
    const info = await createAgentSession('chat')
    expect(info.id).toBe('sess-pi')
    expect(JSON.parse(localStorage.getItem(PI_KEY) || '[]')).toContain('sess-pi')
    // 后续请求经 baseForSession 路由到 pi（内存表优先）
    mockFetch(async () => jsonRes(null))
    await getActiveRun('sess-pi')
    const url = (vi.mocked(fetch).mock.calls.at(-1) as unknown as [string])[0]
    expect(url.startsWith(PI_BASE)).toBe(true)
  })

  it('pi 会话登记保留去重且上限 50 条不无限膨胀', async () => {
    rolloutState.base = PI_BASE
    localStorage.setItem(PI_KEY, JSON.stringify(Array.from({ length: 60 }, (_, i) => `old-${i}`)))
    mockFetch(async () => jsonRes({ id: 'sess-new', scenario: 'chat', title: '', status: 'idle' }))
    await createAgentSession('chat')
    const ids = JSON.parse(localStorage.getItem(PI_KEY) || '[]') as string[]
    expect(ids).toContain('sess-new')
    expect(ids).toHaveLength(50) // slice(-50) 截断
  })

  it('baseOverride 影子会话：不写 localStorage，只进内存路由表（对照测）', async () => {
    mockFetch(async () => jsonRes({ id: 'sess-eph', scenario: 'chat', title: '', status: 'idle' }))
    await createAgentSession('chat', '', { baseOverride: PI_BASE })
    // localStorage 不含影子会话 id（不污染真实会话路由表）
    const ids = JSON.parse(localStorage.getItem(PI_KEY) || '[]') as string[]
    expect(ids).not.toContain('sess-eph')
    // 但内存路由表生效：同 id 后续请求走 pi
    mockFetch(async () => jsonRes(null))
    await getActiveRun('sess-eph')
    const url = (vi.mocked(fetch).mock.calls.at(-1) as unknown as [string])[0]
    expect(url.startsWith(PI_BASE)).toBe(true)
    // 对照：未登记的会话仍走默认 base
    await getActiveRun('sess-unknown')
    const url2 = (vi.mocked(fetch).mock.calls.at(-1) as unknown as [string])[0]
    expect(url2.startsWith(AGENT_API_BASE)).toBe(true)
  })

  it('默认 legacy 会话不写 localStorage 路由表', async () => {
    mockFetch(async () => jsonRes({ id: 'sess-legacy', scenario: 'chat', title: '', status: 'idle' }))
    await createAgentSession('chat')
    expect(localStorage.getItem(PI_KEY)).toBeNull()
  })

  it('POST body 带 persist/prompt_key/page_key 默认值（persist 默认 false）', async () => {
    rolloutState.base = PI_BASE
    const spy = mockFetch(async () => jsonRes({ id: 'sess-body', scenario: 'chat', title: 't', status: 'idle' }))
    await createAgentSession('chat', 't', { persist: true, promptKey: 'desk', pageKey: 'cockpit' })
    const init = spy.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({
      scenario: 'chat', title: 't', persist: true, prompt_key: 'desk', page_key: 'cockpit',
    })
  })

  it('非 2xx：服务端 detail 优先透传，无 detail 落状态码兜底（#1631）', async () => {
    mockFetch(async () => new Response(JSON.stringify({ detail: '缺少 deepseek 的 API Key' }), { status: 424 }))
    await expect(createAgentSession('chat')).rejects.toThrow('缺少 deepseek 的 API Key')
    mockFetch(async () => new Response('oops', { status: 500 }))
    await expect(createAgentSession('chat')).rejects.toThrow('智能体后端未启动')
  })
})

describe('SSE 流解析', () => {
  it('CRLF 双换行分帧逐事件回调（sse-starlette 默认）', async () => {
    const { events, result } = await collect([
      'data: {"type":"token","content":"你"}\r\n\r\n',
      'data: {"type":"token","content":"好"}\r\n\r\n',
      'data: {"type":"done","status":"ok"}\r\n\r\n',
    ])
    expect(events.map((e) => (e as { content?: string }).content ?? e.type)).toEqual(['你', '好', 'done'])
    expect(result.terminal).toBe(true)
  })

  it('LF 双换行分帧同样解析（代理改写换行时）', async () => {
    const { events } = await collect([
      'data: {"type":"token","content":"a"}\n\n',
      'data: {"type":"done","status":"ok"}\n\n',
    ])
    expect(events).toHaveLength(2)
    expect(events[1].type).toBe('done')
  })

  it('心跳帧（冒号注释行 / 非 JSON data 行）静默跳过，不给上层', async () => {
    const { events } = await collect([
      ': ping\r\n\r\n',
      'data: {"type":"token","content":"x"}\r\n\r\n',
      'data: ping\r\n\r\n',
      'data: {"type":"done","status":"ok"}\r\n\r\n',
    ])
    expect(events.map((e) => e.type)).toEqual(['token', 'done'])
  })

  it('一帧跨多个 chunk 到达仍拼回完整 JSON', async () => {
    const { events } = await collect([
      'data: {"type":"tok',
      'en","content":"跨块"',
      '}\r\n\r\n',
      'data: {"type":"done","status":"ok"}\r\n\r\n',
    ])
    expect((events[0] as { content: string }).content).toBe('跨块')
    expect(events).toHaveLength(2)
  })

  it('seq 游标取 max（乱序到达不倒退），onCursor 逐次回调', async () => {
    const { cursors, result } = await collect([
      'data: {"type":"token","content":"a","seq":5}\r\n\r\n',
      'data: {"type":"token","content":"b","seq":3}\r\n\r\n',
      'data: {"type":"done","status":"ok","seq":6}\r\n\r\n',
    ])
    expect(cursors).toEqual([5, 5, 6]) // 乱序的 seq=3 不把游标拉回 3
    expect(result.cursor).toBe(6)
  })

  it('续传游标从 opts.cursor 起算（中断重连场景）', async () => {
    const { result } = await collect([
      'data: {"type":"token","content":"c","seq":2}\r\n\r\n',
      'data: {"type":"done","status":"ok","seq":3}\r\n\r\n',
    ], { cursor: 7 })
    expect(result.cursor).toBe(7) // max(7,3)：断点前的帧不把游标拉回
  })

  it('尾帧无尾随分隔符也消费（流提前关闭，done 滞留 buffer 不丢，STREAM-5/10）', async () => {
    const { events, result } = await collect([
      'data: {"type":"token","content":"a"}\r\n\r\n',
      'data: {"type":"done","status":"ok"}', // 无 \r\n\r\n 结尾
    ])
    expect(events.at(-1)?.type).toBe('done')
    expect(result.terminal).toBe(true)
  })

  it('流结束但无终态帧（done/error 均未到）→ AgentStreamDisconnectedError 带当前游标', async () => {
    const events: AgentEvent[] = []
    mockFetch(async () => sseResponse(['data: {"type":"token","content":"a","seq":4}\r\n\r\n']))
    await expect(
      attachRunStream('sess-disc', 'run-1', -1, (e) => events.push(e))
    ).rejects.toMatchObject({ name: 'AgentStreamDisconnectedError', cursor: 4 })
    expect(events).toHaveLength(1) // 断流前的事件仍送达
  })

  it('信号已 abort：静默返回当前游标，不抛（停止按钮是正常结束，不是错误）', async () => {
    const controller = new AbortController()
    controller.abort()
    mockFetch(async () => sseResponse(['data: {"type":"token","content":"a","seq":1}\r\n\r\n']))
    const result = await attachRunStream('sess-abort', 'run-2', -1, vi.fn(), { signal: controller.signal })
    expect(result).toMatchObject({ cursor: -1, terminal: false, runId: 'run-2' })
  })

  it('HTTP 非 2xx → AgentStreamHttpError 带状态码', async () => {
    mockFetch(async () => new Response('forbidden', { status: 403 }))
    await expect(attachRunStream('sess-403', 'run-3', -1, vi.fn())).rejects.toMatchObject({
      name: 'AgentStreamHttpError', status: 403,
    })
  })

  it('fetch 阶段网络错误 → AgentStreamDisconnectedError 而非裸 TypeError', async () => {
    mockFetch(async () => { throw new TypeError('fetch failed') })
    await expect(attachRunStream('sess-net', 'run-4', -1, vi.fn())).rejects.toBeInstanceOf(AgentStreamDisconnectedError)
  })
})

describe('sendAgentMessage', () => {
  it('x-run-id 响应头触发 attachRunStream 续流：POST body 释放，事件从 GET stream 读', async () => {
    const onRunId = vi.fn()
    const events: AgentEvent[] = []
    const spy = mockFetch(async () => {
      if (spy.mock.calls.length === 1) {
        return new Response('', { status: 200, headers: { 'x-run-id': 'run-9' } })
      }
      return sseResponse(['data: {"type":"done","status":"ok"}\r\n\r\n'])
    })
    const result = await sendAgentMessage('sess-run', '你好', (e) => events.push(e), { onRunId })
    expect(onRunId).toHaveBeenCalledWith('run-9')
    // 第二次请求是 GET stream 续流，带 run_id + cursor=-1
    const [url, init] = spy.mock.calls[1] as [string, RequestInit]
    expect(url).toContain('/sessions/sess-run/stream?')
    expect(url).toContain('run_id=run-9')
    expect(url).toContain('cursor=-1')
    expect(init.method).toBeUndefined() // GET（默认）
    expect(events.at(-1)?.type).toBe('done')
    expect(result).toMatchObject({ runId: 'run-9', terminal: true })
  })

  it('无 x-run-id：直接消费 POST 响应体的 SSE 流', async () => {
    const events: AgentEvent[] = []
    mockFetch(async () => sseResponse([
      'data: {"type":"token","content":"hi"}\r\n\r\n',
      'data: {"type":"done","status":"ok"}\r\n\r\n',
    ]))
    const result = await sendAgentMessage('sess-inline', '你好', (e) => events.push(e))
    expect(events).toHaveLength(2)
    expect(result.runId).toBeUndefined()
    expect(result.terminal).toBe(true)
  })

  it('POST body 带 content/scenario/prompt_key，headers 带登录身份（续聊重建会话依赖）', async () => {
    localStorage.setItem('dljy_restore_token', 'tok-9')
    localStorage.setItem('dljy.currentCompanyId', 'comp-9')
    const spy = mockFetch(async () => sseResponse(['data: {"type":"done","status":"ok"}\r\n\r\n']))
    // 注意 id 避开 createAgentSession 用例已登记进内存路由表的名字（模块级 Map 不随用例重置）
    await sendAgentMessage('sess-msg', '问', vi.fn(), { scenario: 'daily_review', promptKey: 'desk' })
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${AGENT_API_BASE}/sessions/sess-msg/messages`)
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer tok-9',
      'x-company-id': 'comp-9',
    })
    expect(JSON.parse(init.body as string)).toEqual({
      content: '问', payload: null, scenario: 'daily_review', prompt_key: 'desk',
    })
  })

  it('主动取消（AbortError）静默返回，不向上抛错误气泡', async () => {
    const controller = new AbortController()
    controller.abort()
    mockFetch(async () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    })
    const result = await sendAgentMessage('sess-cancel', '问', vi.fn(), { signal: controller.signal })
    expect(result).toEqual({ cursor: -1, terminal: false })
  })
})

describe('getActiveRun', () => {
  it('404 → null 不抛（无在途 run 是正常态）', async () => {
    mockFetch(async () => new Response('not found', { status: 404 }))
    await expect(getActiveRun('sess-a')).resolves.toBeNull()
  })

  it('200 → 返回活动 run 对象', async () => {
    mockFetch(async () => jsonRes({ run_id: 'r1', status: 'running', last_seq: 12 }))
    await expect(getActiveRun('sess-a')).resolves.toMatchObject({ run_id: 'r1', status: 'running' })
  })

  it('其它非 2xx → AgentStreamHttpError', async () => {
    mockFetch(async () => new Response('oops', { status: 502 }))
    await expect(getActiveRun('sess-a')).rejects.toBeInstanceOf(AgentStreamHttpError)
  })
})
