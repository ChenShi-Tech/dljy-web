// @vitest-environment happy-dom
// ↑ 勿删：本文件不是 *.component.spec.ts，vitest node project 默认不给 DOM；
// 用例依赖 localStorage（身份头三元组），靠此 pragma 按文件切到 happy-dom。
//
// agentClient 契约回归（STREAM-5/10 / #1631 / #2958）：
// 1. identityHeaders 三元组（token+company+region）。
// 2. pi 会话路由：建会话恒走 pi 底座（双栈退场后无第二个 base）；会话生命周期请求
// （续聊/回放/在途 run/停止/审批）不再查本地登记表——未在本浏览器建过的会话
// （换浏览器、清存储、登记表溢出）同样落到 pi，不会回退 legacy 404。
// 2b. 产物（artifacts）与 data_ref（refs）例外：由 agent-runtime（agent-backend）提供，
// 固定走 AGENT_API_BASE——pi-poc 没有这两类端点（未匹配一律 404），即便会话是
// createAgentSession 建在 pi 上的，产物/refs 请求也必须落 agent-backend（#2958 返工）。
// 3. SSE 流解析（核心），CRLF/LF 双分隔、心跳帧静默跳过、seq 游标取 max、
// 尾帧无尾随分隔符仍消费（done 丢失 = 面板状态机悬挂，STREAM-5/10）、
// 无终态帧抛 AgentStreamDisconnectedError、abort 静默返回。
// 4. x-run-id 响应头 → 转 attachRunStream 续流。
// 5. getActiveRun 404 → null 不抛。
// 6. 探活三态（probeAgentService）：2xx→online；超时拒绝（TimeoutError/AbortError，
// AbortSignal.timeout 的规范拒绝原因）→timeout；否定答复（vite 代理对已宕 upstream 固定
// 回 502、404 旧后端、TypeError 网络层）→unreachable。申报工作台横幅按 timeout/unreachable
// 分流文案，并据 timeout 识别「同步重训占住后端」的探活假阳性（DEVELOPMENT.md §4）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 可变 hoisted 状态：mock 工厂引用，用例里改值
const regionState = vi.hoisted(() => ({ id: 'yunnan' }))
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
vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { get value() { return { id: regionState.id } } },
}))

import {
  AGENT_API_BASE,
  AgentStreamDisconnectedError,
  AgentStreamHttpError,
  attachRunStream,
  createAgentSession,
  fetchAgentRef,
  getActiveRun,
  identityHeaders,
  listAgentArtifacts,
  listRuns,
  pingAgentService,
  probeAgentService,
  sendAgentMessage,
  type AgentEvent,
} from '@/services/agent/agentClient'

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
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('identityHeaders', () => {
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
})

describe('createAgentSession 会话路由', () => {
  it('建会话恒走 pi：POST 打 pi 基址，后续续聊请求同样路由到 pi', async () => {
    mockFetch(async () => jsonRes({ id: 'sess-pi', scenario: 'chat', title: '', status: 'idle' }))
    const info = await createAgentSession('chat')
    expect(info.id).toBe('sess-pi')
    // 后续请求路由到 pi（不再依赖本地登记表）
    mockFetch(async () => jsonRes(null))
    await getActiveRun('sess-pi')
    const url = (vi.mocked(fetch).mock.calls.at(-1) as unknown as [string])[0]
    expect(url.startsWith(PI_BASE)).toBe(true)
  })

  it('未登记会话仍走 pi（#2958）：换浏览器/清存储/登记表溢出后，续接在途 run 不再回退 legacy', async () => {
    // 登记表已删除：localStorage 为空（beforeEach 已 clear）也必须落到 pi
    mockFetch(async () => jsonRes(null))
    await getActiveRun('sess-unknown')
    const url = (vi.mocked(fetch).mock.calls.at(-1) as unknown as [string])[0]
    expect(url.startsWith(PI_BASE)).toBe(true)
    expect(url.startsWith('/agent-api')).toBe(false)
  })

  it('POST body 带 persist/prompt_key/page_key 默认值（persist 默认 false）', async () => {
    const spy = mockFetch(async () => jsonRes({ id: 'sess-body', scenario: 'chat', title: 't', status: 'idle' }))
    await createAgentSession('chat', 't', { persist: true, promptKey: 'desk', pageKey: 'cockpit' })
    const init = spy.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({
      scenario: 'chat', title: 't', persist: true, prompt_key: 'desk', page_key: 'cockpit',
    })
  })

  it('非 2xx：服务端 detail 优先透传，无 detail 落状态码兜底（#1631）', async () => {
    mockFetch(async () => new Response(JSON.stringify({ detail: '缺少 vendor-a 的 API Key' }), { status: 424 }))
    await expect(createAgentSession('chat')).rejects.toThrow('缺少 vendor-a 的 API Key')
    mockFetch(async () => new Response('oops', { status: 500 }))
    await expect(createAgentSession('chat')).rejects.toThrow('智能体后端未启动')
  })
})

describe('会话产物与 data_ref 固定走 agent-backend（#2958 返工）', () => {
  // artifacts 列表 / refs 明细由 agent-runtime（api/routes.py）提供：pi-poc 会话子路由
  // 只有 ""、messages、stream、active-run、stop、approvals、auto-approve，没有
  // artifacts/refs——恒打 pi 只会 404。会话即便建在 pi 上，这两类请求也必须落
  // AGENT_API_BASE（对 pi 会话走历史库 owner 校验放行）。

  it('listAgentArtifacts：URL 以 AGENT_API_BASE 开头，不以 pi 基址开头', async () => {
    // 先建一个 pi 会话（createAgentSession 恒打 pi），产物请求仍不得跟随 pi 基址
    mockFetch(async () => jsonRes({ id: 'sess-art', scenario: 'chat', title: '', status: 'idle' }))
    const info = await createAgentSession('chat')
    mockFetch(async () => jsonRes({ session_id: info.id, files: [{ path: 'charts/a.json', bytes: 12 }] }))
    const files = await listAgentArtifacts(info.id)
    expect(files).toEqual([{ path: 'charts/a.json', bytes: 12 }])
    const url = (vi.mocked(fetch).mock.calls.at(-1) as unknown as [string])[0]
    expect(url).toBe(`${AGENT_API_BASE}/sessions/sess-art/artifacts`)
    expect(url.startsWith(AGENT_API_BASE)).toBe(true)
    expect(url.startsWith(PI_BASE)).toBe(false)
  })

  it('listAgentArtifacts 非 2xx → 空数组（产物面板空态，不抛）', async () => {
    mockFetch(async () => new Response('not found', { status: 404 }))
    await expect(listAgentArtifacts('sess-404')).resolves.toEqual([])
  })

  it('fetchAgentRef：URL 以 AGENT_API_BASE 开头（pi 建的会话同样落 agent-backend）', async () => {
    mockFetch(async () => jsonRes({ id: 'sess-ref', scenario: 'chat', title: '', status: 'idle' }))
    await createAgentSession('chat')
    mockFetch(async () => jsonRes({ data: { series: [{ x: 1, y: 2 }] } }))
    const data = await fetchAgentRef<{ series: unknown[] }>('sess-ref', 'ref-1')
    expect(data).toEqual({ series: [{ x: 1, y: 2 }] })
    const url = (vi.mocked(fetch).mock.calls.at(-1) as unknown as [string])[0]
    expect(url).toBe(`${AGENT_API_BASE}/refs/sess-ref/ref-1`)
    expect(url.startsWith(AGENT_API_BASE)).toBe(true)
    expect(url.startsWith(PI_BASE)).toBe(false)
  })

  it('fetchAgentRef 非 2xx → throw（图表明细缺失必须可见，不能静默空图）', async () => {
    mockFetch(async () => new Response('gone', { status: 410 }))
    await expect(fetchAgentRef('sess-x', 'ref-2')).rejects.toThrow('data_ref 获取失败: 410')
  })
})

describe('listRuns 运行中列表（统一 AI 侧边栏 SS-07）', () => {
  const run = (sessionId: string) => ({
    run_id: `r-${sessionId}`, session_id: sessionId, turn_seq: 1, status: 'running',
    created_at: 1, updated_at: 1, last_seq: 3, session_title: '在跑', page_key: 'ai_center', scenario: 'chat'
  })

  it('走 pi 底座；别处建的会话不做登记也能切换、停止、回放（恒路由 pi）', async () => {
    const spy = mockFetch(async () => jsonRes([run('sess-run-elsewhere')]))
    const runs = await listRuns('running')
    expect(runs.map((r) => r.session_id)).toEqual(['sess-run-elsewhere'])
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe(`${PI_BASE}/runs?status=running`)

    mockFetch(async () => jsonRes(null))
    await getActiveRun('sess-run-elsewhere')
    const url = (vi.mocked(fetch).mock.calls.at(-1) as unknown as [string])[0]
    expect(url.startsWith(PI_BASE)).toBe(true)
  })

  it('未登录 / 无权限 / 端点不存在 → 空列表；其它失败抛错（由侧边栏隐藏数量）', async () => {
    for (const status of [401, 403, 404]) {
      mockFetch(async () => jsonRes({ detail: 'x' }, { status }))
      expect(await listRuns('running')).toEqual([])
    }
    mockFetch(async () => jsonRes({ detail: 'x' }, { status: 500 }))
    await expect(listRuns('running')).rejects.toBeInstanceOf(AgentStreamHttpError)
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
    await sendAgentMessage('sess-msg', '问', vi.fn(), { scenario: 'daily_review', promptKey: 'desk' })
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${PI_BASE}/sessions/sess-msg/messages`)
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

describe('probeAgentService 探活三态', () => {
  it('2xx → online；pingAgentService 包装为 true', async () => {
    mockFetch(async () => new Response('[]', { status: 200 }))
    await expect(probeAgentService()).resolves.toBe('online')
    mockFetch(async () => new Response('[]', { status: 200 }))
    await expect(pingAgentService()).resolves.toBe(true)
  })

  it('502 → unreachable 不抛错（vite 代理对已宕 upstream 固定回 502，「没起」走这条路）', async () => {
    mockFetch(async () => new Response('Internal Server Error', { status: 502 }))
    await expect(probeAgentService()).resolves.toBe('unreachable')
    mockFetch(async () => new Response('Bad Gateway', { status: 502 }))
    await expect(pingAgentService()).resolves.toBe(false)
  })

  it('404 → unreachable（后端版本过旧没有该路由，同样不是 timeout）', async () => {
    mockFetch(async () => new Response('not found', { status: 404 }))
    await expect(probeAgentService()).resolves.toBe('unreachable')
  })

  it('TimeoutError/AbortError 拒绝 → timeout（服务在但被同步重训占住，2.5s 内未应答）', async () => {
    mockFetch(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    })
    await expect(probeAgentService()).resolves.toBe('timeout')
    mockFetch(async () => {
      throw new DOMException('The user aborted a request.', 'AbortError')
    })
    await expect(probeAgentService()).resolves.toBe('timeout')
    mockFetch(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    })
    await expect(pingAgentService()).resolves.toBe(false)
  })

  it('TypeError（网络层失败）→ unreachable', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(probeAgentService()).resolves.toBe('unreachable')
    await expect(pingAgentService()).resolves.toBe(false)
  })
})
