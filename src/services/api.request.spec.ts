// api.ts 请求主体逻辑回归守卫（与 api.spec.ts 的 unwrap 地区头序号守卫 #1350 互补，不重复）：
// 覆盖 URL 构造（API_BASE 叠加与显式前缀分流）、统一身份/地区请求头（requestHeaders）、
// 写请求 content-type/idempotency-key、GET 指数退避重试（502/503/504 + 网络错/AbortError）、
// timeout/外部 signal 合并、unwrap 错误分类（ApiError 字段、网关 HTML 回落、204）、
// 401/403/423 全局副作用（登出/跳转/事件）、私有族无权限记账（mark/clear/reset）、
// applyRegionHeaders 状态机与切区清账。
// 坏掉的症状：请求打到错误前缀（/api/api/... 或 agent-api 被吞）、鉴权头丢失致后端 401、
// 瞬时 502/网络抖动直接把错误抛到页面、网关 HTML 错误页被当 JSON 解析报「无法解析」、
// 业务代理 401 误触发全局登出、401 未清登录态、混合面板无权限横幅被成功请求冲掉、
// 切区后旧地区的基线回退横幅粘滞。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

// node 环境无 DOM：api.ts（经 regionContext）模块求值即读 window.localStorage，
// 须先 stub window 再动态 import（沿用 api.spec.ts 的模式；这里额外补齐
// location/dispatchEvent，供 handleApiStatus 副作用断言）。
function createStorageStub() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => { map.set(key, String(value)) },
    removeItem: (key: string) => { map.delete(key) },
  }
}

function createWindowStub(overrides?: { pathname?: string; search?: string; hash?: string }) {
  const storage = createStorageStub()
  const location = {
    origin: 'http://localhost',
    pathname: overrides?.pathname ?? '/dashboard',
    search: overrides?.search ?? '',
    hash: overrides?.hash ?? '',
    assign: vi.fn(),
  }
  const win = { localStorage: storage, location, dispatchEvent: vi.fn() }
  return { win, storage, location }
}

const boot = createWindowStub()
vi.stubGlobal('window', boot.win)
vi.stubGlobal('localStorage', boot.storage)

const api = await import('@/services/api')
// 动态 import 的绑定不能在类型位置当命名空间用，类型经 import() 别名引入
type ApiError = import('@/services/api').ApiError
const { defaultRegionId } = await import('@/data/regions')
const { setCurrentRegionId } = await import('@/services/region/regionContext')

// 每用例干净的 window/localStorage；模块级单例 regionDataStatus/deniedCaptureFamilies
// 直接赋值重置（api.spec.ts 同款）。regionHeaderSeq/lastAppliedRegionSeq 为模块内 let，
// 本文件不直接断言其取值，只经行为验证，无需重置。
let win: ReturnType<typeof createWindowStub>

// window 与全局 localStorage 必须同源成对安装：regionContext 读 window.localStorage，
// 而 api.ts 的 requestHeaders/clearLocalAuthState 读裸全局 localStorage，只换一边会让
// 「写入」与「清除/读取」落在两个 store 上（用例内覆盖 location 时同样要走本函数）。
function reinstallWindow(overrides?: { pathname?: string; search?: string; hash?: string }) {
  win = createWindowStub(overrides)
  vi.stubGlobal('window', win.win)
  vi.stubGlobal('localStorage', win.storage)
}

beforeEach(() => {
  reinstallWindow()
  api.regionDataStatus.value = { requested: null, served: null, fallback: false, mock: false, visibility: null, accessDenied: null }
  api.deniedCaptureFamilies.value = []
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

type FetchMock = ReturnType<typeof vi.fn>

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), { status: 200, ...init })
}

function callUrl(fetchMock: FetchMock): string {
  return fetchMock.mock.calls[0]![0] as string
}

function callInit(fetchMock: FetchMock): RequestInit {
  return fetchMock.mock.calls[0]![1] as RequestInit
}

// 把 Promise 结局折叠成值，避免「应 reject 却 resolve」的用例只能靠 rejects 单点断言。
async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  return promise.then(
    () => { throw new Error('expected rejection, got resolution') },
    (error) => error as ApiError,
  )
}

describe('buildUrl/pathBase：API 前缀路由与 query 序列化（经 apiGet 断言 fetch 参）', () => {
  function stubFetchOk(): FetchMock {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('相对路径叠加默认 API_BASE（/api）', async () => {
    const fetchMock = stubFetchOk()
    await api.apiGet('/foo/bar')
    expect(callUrl(fetchMock)).toBe('http://localhost/api/foo/bar')
  })

  it('绝对 URL 原样透传，不叠加 API_BASE 也不改写', async () => {
    const fetchMock = stubFetchOk()
    await api.apiGet('http://example.test/upstream?q=1')
    expect(callUrl(fetchMock)).toBe('http://example.test/upstream?q=1')
  })

  it.each(['/api', '/api/foo', '/agent-api', '/agent-api/foo'])(
    '显式 API 前缀 %s 不再叠加 API_BASE',
    async (path) => {
      const fetchMock = stubFetchOk()
      await api.apiGet(path)
      expect(callUrl(fetchMock)).toBe(`http://localhost${path}`)
    },
  )

  it('query：null/undefined/空串丢弃，0 与 false 保留', async () => {
    const fetchMock = stubFetchOk()
    await api.apiGet('/q', { keep: 1, s: 'x', dropNull: null, dropUndefined: undefined, dropEmpty: '', zero: 0, flag: false })
    expect(callUrl(fetchMock)).toBe('http://localhost/api/q?keep=1&s=x&zero=0&flag=false')
  })

  it('无 query 时 URL 不带 ? 尾巴', async () => {
    const fetchMock = stubFetchOk()
    await api.apiGet('/plain')
    expect(callUrl(fetchMock)).toBe('http://localhost/api/plain')
  })
})

describe('requestHeaders：统一身份与地区请求头', () => {
  it('无 token/user：仅 x-request-id 与 x-region-id，无 authorization 与身份六头', () => {
    const headers = api.requestHeaders()
    expect(Object.keys(headers).sort()).toEqual(['x-region-id', 'x-request-id'])
    expect(headers['x-region-id']).toBe('yunnan')
  })

  it('x-region-id 跟随默认地区 defaultRegionId', () => {
    expect(api.requestHeaders()['x-region-id']).toBe(defaultRegionId)
    expect(defaultRegionId).toBe('yunnan')
  })

  it('x-request-id 格式 REQ-<base36 时间戳>-<8 位随机段>，每次调用生成新 id', () => {
    const first = api.requestHeaders()['x-request-id']
    const second = api.requestHeaders()['x-request-id']
    expect(first).toMatch(/^REQ-[a-z0-9]+-[a-z0-9]{8}$/)
    expect(second).toMatch(/^REQ-[a-z0-9]+-[a-z0-9]{8}$/)
    expect(first).not.toBe(second)
  })

  it('有 token → authorization: Bearer <token>', () => {
    win.storage.setItem('dljy_restore_token', 'tok-123')
    expect(api.requestHeaders().authorization).toBe('Bearer tok-123')
  })

  it('governance user 完整：下发身份六头 + x-company-id/x-tenant-id', () => {
    win.storage.setItem('dljy_governance_user', JSON.stringify({
      username: 'alice', userId: 'u1', roleCode: 'TRADER', areaCode: 'GD',
      subjectId: 'GEN-GD-002', subjectType: 'AGGREGATOR', companyId: 'cgc-yunnan',
    }))
    const headers = api.requestHeaders()
    expect(headers['x-user-id']).toBe('alice') // username 优先于 userId
    expect(headers['x-decision-role']).toBe('TRADER')
    expect(headers['x-area-code']).toBe('GD')
    expect(headers['x-subject-id']).toBe('GEN-GD-002')
    expect(headers['x-subject-type']).toBe('AGGREGATOR')
    expect(headers['x-company-id']).toBe('cgc-yunnan')
    expect(headers['x-tenant-id']).toBe('cgc-yunnan')
  })

  it('user 字段缺失时逐字段回落默认值；username 缺失回落 userId', () => {
    win.storage.setItem('dljy_governance_user', JSON.stringify({ userId: 'u9' }))
    expect(api.requestHeaders()['x-user-id']).toBe('u9')
    win.storage.setItem('dljy_governance_user', JSON.stringify({}))
    const headers = api.requestHeaders()
    expect(headers['x-user-id']).toBe('LOCAL-DEMO-USER')
    expect(headers['x-decision-role']).toBe('TRADE_LEAD')
    expect(headers['x-area-code']).toBe('YN')
    expect(headers['x-subject-id']).toBe('GEN-YN-001')
    expect(headers['x-subject-type']).toBe('GENERATOR')
  })

  it('x-company-id 与 x-tenant-id 恒相同（companyId ?? tenantId ?? dljy-demo）', () => {
    win.storage.setItem('dljy_governance_user', JSON.stringify({ tenantId: 't9' }))
    expect(api.requestHeaders()['x-company-id']).toBe('t9')
    expect(api.requestHeaders()['x-tenant-id']).toBe('t9')
    win.storage.setItem('dljy_governance_user', JSON.stringify({}))
    expect(api.requestHeaders()['x-company-id']).toBe('dljy-demo')
    expect(api.requestHeaders()['x-tenant-id']).toBe('dljy-demo')
  })

  it('脏 JSON / 非 object 的 user 按无 user 处理，不抛错', () => {
    win.storage.setItem('dljy_governance_user', 'not-json{')
    expect(api.requestHeaders()['x-user-id']).toBeUndefined()
    win.storage.setItem('dljy_governance_user', JSON.stringify(42))
    expect(api.requestHeaders()['x-user-id']).toBeUndefined()
  })
})

describe('写请求自动头：content-type 与 idempotency-key', () => {
  it.each([
    ['apiPost', 'POST'],
    ['apiPut', 'PUT'],
    ['apiPatch', 'PATCH'],
  ] as const)('%s：自动加 content-type: application/json 与 idempotency-key，body 为 JSON 字符串', async (name, method) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await api[name]('/write', { a: 1 })
    const init = callInit(fetchMock)
    expect(init.method).toBe(method)
    expect(init.body).toBe('{"a":1}')
    const headers = new Headers(init.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('idempotency-key')).toMatch(/^REQ-/)
  })

  it('调用方已传 content-type/idempotency-key 时不被覆盖（以 apiPost 为代表）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await api.apiPost('/write', {}, { headers: { 'content-type': 'text/csv', 'idempotency-key': 'client-key-1' } })
    const headers = new Headers(callInit(fetchMock).headers)
    expect(headers.get('content-type')).toBe('text/csv')
    expect(headers.get('idempotency-key')).toBe('client-key-1')
  })

  it('apiGet 不自动加 content-type/idempotency-key，但保留统一基础头', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await api.apiGet('/read')
    const headers = new Headers(callInit(fetchMock).headers)
    expect(headers.get('content-type')).toBeNull()
    expect(headers.get('idempotency-key')).toBeNull()
    expect(headers.get('x-request-id')).toMatch(/^REQ-/)
  })

  it('apiDelete：带 idempotency-key，不加 content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await api.apiDelete('/write/9')
    const init = callInit(fetchMock)
    expect(init.method).toBe('DELETE')
    const headers = new Headers(init.headers)
    expect(headers.get('idempotency-key')).toMatch(/^REQ-/)
    expect(headers.get('content-type')).toBeNull()
  })

  it('apiGet 合并调用方自定义头，同时统一头照常下发', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    win.storage.setItem('dljy_restore_token', 'tok-1')
    await api.apiGet('/read', undefined, { headers: { 'x-custom': 'c1' } })
    const headers = new Headers(callInit(fetchMock).headers)
    expect(headers.get('x-custom')).toBe('c1')
    expect(headers.get('authorization')).toBe('Bearer tok-1')
  })
})

describe('GET 退避重试（fetchGetWithRetry，经 apiGet）', () => {
  it.each([502, 503, 504])('网关 %s：退避 400ms→800ms 重试，第三次成功后正常返回（共 3 次 fetch）', async (status) => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
    const calledAt: number[] = []
    fetchMock.mockImplementation(() => {
      calledAt.push(Date.now())
      return Promise.resolve(
        calledAt.length < 3 ? new Response('{}', { status }) : jsonResponse({ code: 200, data: 'recovered' }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const outcome = api.apiGet('/flaky')
    await vi.advanceTimersByTimeAsync(400)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(800)
    const result = await outcome
    expect(result.code).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(calledAt[1]! - calledAt[0]!).toBe(400)
    expect(calledAt[2]! - calledAt[1]!).toBe(800)
  })

  it('三连 502：重试耗尽后照常把响应交给 unwrap（ApiError status/code=502）', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 502 })))
    vi.stubGlobal('fetch', fetchMock)
    const outcome = captureError(api.apiGet('/down'))
    await vi.advanceTimersByTimeAsync(1200)
    const err = await outcome
    expect(err).toBeInstanceOf(api.ApiError)
    expect(err.status).toBe(502)
    expect(err.code).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('502 后第二次即成功：共 2 次 fetch', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(new Response('{}', { status: 502 })))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({ code: 200, data: 1 })))
    vi.stubGlobal('fetch', fetchMock)
    const outcome = api.apiGet('/flaky')
    await vi.advanceTimersByTimeAsync(400)
    const result = await outcome
    expect(result.code).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('500 不在重试范围：单次调用即抛 ApiError', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 500 })))
    vi.stubGlobal('fetch', fetchMock)
    const err = await captureError(api.apiGet('/boom'))
    expect(err).toBeInstanceOf(api.ApiError)
    expect(err.code).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('404 不重试：单次调用即抛', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 404 })))
    vi.stubGlobal('fetch', fetchMock)
    const err = await captureError(api.apiGet('/missing'))
    expect(err.code).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('AbortError 立即向上抛，不进入重试', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    const fetchMock = vi.fn().mockRejectedValue(abortError)
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.apiGet('/aborted')).rejects.toBe(abortError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('网络错误（fetch 抛 TypeError）：退避重试 2 次后抛出原错误（3 次 fetch）', async () => {
    vi.useFakeTimers()
    const networkError = new TypeError('fetch failed')
    const fetchMock = vi.fn().mockRejectedValue(networkError)
    vi.stubGlobal('fetch', fetchMock)
    const outcome = api.apiGet('/offline').then(
      () => { throw new Error('expected rejection, got resolution') },
      (error) => error,
    )
    await vi.advanceTimersByTimeAsync(1200)
    const err = await outcome
    expect(err).toBe(networkError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('timeoutSignal 与请求 signal 合并（requestSignal/mergeAbortSignals 经 apiGet 行为测）', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('非正数/非有限值 %s → 不设置 signal', (value) => {
    expect(api.timeoutSignal(value)).toBeUndefined()
  })

  it('正数返回未中止的 AbortSignal，且每次新实例', () => {
    const first = api.timeoutSignal(1000)
    const second = api.timeoutSignal(1000)
    expect(first).toBeInstanceOf(AbortSignal)
    expect(first!.aborted).toBe(false)
    expect(first).not.toBe(second)
  })

  it('apiGet 不传 signal/timeout：fetch 收到 undefined signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await api.apiGet('/plain')
    expect(callInit(fetchMock).signal).toBeUndefined()
  })

  it('apiGet 仅传 options.signal：原 signal 透传给 fetch（单信号不包一层）', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await api.apiGet('/x', undefined, { signal: controller.signal })
    expect(callInit(fetchMock).signal).toBe(controller.signal)
  })

  it('apiGet 传 signal + timeout：合并 signal 转发外部 abort（任一 abort 即中止）', async () => {
    const controller = new AbortController()
    let captured: AbortSignal | undefined
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      captured = init?.signal ?? undefined
      return Promise.resolve(jsonResponse({ code: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    await api.apiGet('/x', undefined, { signal: controller.signal, timeout: 5000 })
    expect(captured).toBeDefined()
    expect(captured!.aborted).toBe(false)
    expect(captured).not.toBe(controller.signal) // 双信号经 mergeAbortSignals 合并的产物
    controller.abort()
    expect(captured!.aborted).toBe(true)
  })

  it('options.timeoutMs 与 options.timeout 均能启用超时 signal', async () => {
    const capturedTimeout: Array<AbortSignal | undefined> = []
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedTimeout.push(init?.signal ?? undefined)
      return Promise.resolve(jsonResponse({ code: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    await api.apiGet('/a', undefined, { timeoutMs: 5000 })
    await api.apiGet('/b', undefined, { timeout: 5000 })
    expect(capturedTimeout[0]).toBeDefined()
    expect(capturedTimeout[1]).toBeDefined()
  })
})

describe('unwrap 错误分类与 ApiError', () => {
  it('成功响应 payload 原样返回', async () => {
    const payload = await api.unwrap<{ data: number }>(jsonResponse({ code: 200, data: 7, msg: 'ok' }), '/ok')
    expect(payload.data).toBe(7)
    expect(payload.msg).toBe('ok')
  })

  it('payload.code ≥ 400 优先于 HTTP status：HTTP 200 + code 499 → ApiError status=200 code=499', async () => {
    const err = await captureError(api.unwrap(jsonResponse({ code: 499, msg: '业务拒绝' }, { status: 200 }), '/biz'))
    expect(err).toBeInstanceOf(api.ApiError)
    expect(err.status).toBe(200)
    expect(err.code).toBe(499)
    expect(err.message).toBe('业务拒绝')
  })

  it('payload.code 缺失时回落 HTTP status，msg 用兜底模板', async () => {
    const err = await captureError(api.unwrap(new Response('{}', { status: 502 }), '/biz'))
    expect(err.code).toBe(502)
    expect(err.message).toBe('API request failed: 502')
  })

  it('响应体非 JSON（网关 HTML 错误页）→ msg 回落 statusText', async () => {
    const html = new Response('<html>502 Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' })
    const err = await captureError(api.unwrap(html, '/gate'))
    expect(err.code).toBe(502)
    expect(err.message).toBe('Bad Gateway')
  })

  it('非 JSON 且无 statusText → 兜底文案「接口响应无法解析」', async () => {
    const html = new Response('<html></html>', { status: 502 })
    const err = await captureError(api.unwrap(html, '/gate'))
    expect(err.message).toBe('接口响应无法解析')
  })

  it('204 无 body：直接返回 {code:204}，不读响应体', async () => {
    const result = await api.unwrap(new Response(null, { status: 204 }), '/deleted')
    expect(result).toEqual({ code: 204 })
  })

  it('ApiError 实例字段与 lockedUntil/remainingAttempts getter', async () => {
    const err = await captureError(api.unwrap(
      jsonResponse({ code: 423, msg: '账号锁定', lockedUntil: '2026-09-01T00:00:00Z', remainingAttempts: 0 }, { status: 401 }),
      '/lock',
    ))
    expect(err.name).toBe('ApiError')
    expect(err).toBeInstanceOf(Error)
    expect(err.status).toBe(401)
    expect(err.code).toBe(423)
    expect(err.lockedUntil).toBe('2026-09-01T00:00:00Z')
    expect(err.remainingAttempts).toBe(0)
    expect(err.payload.msg).toBe('账号锁定')
  })
})

describe('handleApiStatus：401/403/423 全局副作用（经 unwrap 触发）', () => {
  function seedAuth() {
    win.storage.setItem('dljy_restore_token', 'tok-1')
    win.storage.setItem('dljy_governance_user', JSON.stringify({ username: 'alice' }))
  }

  function dispatchedEvents(): CustomEvent[] {
    return win.win.dispatchEvent.mock.calls.map(([event]) => event as CustomEvent)
  }

  it('401：清 token/user + 发 auth-expired 事件 + assign /login?redirect=<编码后的当前路径>', async () => {
    reinstallWindow({ pathname: '/dashboard', search: '?tab=2', hash: '#panel' })
    seedAuth()
    const err = await captureError(api.unwrap(jsonResponse({ code: 401, msg: '登录过期' }, { status: 401 }), '/data/x'))
    expect(err.code).toBe(401)
    expect(win.storage.getItem('dljy_restore_token')).toBeNull()
    expect(win.storage.getItem('dljy_governance_user')).toBeNull()
    const events = dispatchedEvents()
    expect(events.map((event) => event.type)).toEqual(['auth-expired'])
    expect(events[0]!.detail).toEqual({ path: '/data/x', message: '登录过期' })
    expect(win.location.assign).toHaveBeenCalledTimes(1)
    expect(win.location.assign).toHaveBeenCalledWith(`/login?redirect=${encodeURIComponent('/dashboard?tab=2#panel')}`)
  })

  it.each(['/auth/login', '/auth/login-options', '/qweather', '/csg/disclosure'])(
    '401 白名单 %s：不清登录态、不跳转、不发 auth-expired',
    async (path) => {
      seedAuth()
      await expect(api.unwrap(jsonResponse({ code: 401 }, { status: 401 }), path)).rejects.toBeInstanceOf(api.ApiError)
      expect(win.storage.getItem('dljy_restore_token')).toBe('tok-1')
      expect(win.storage.getItem('dljy_governance_user')).not.toBeNull()
      expect(win.win.dispatchEvent).not.toHaveBeenCalled()
      expect(win.location.assign).not.toHaveBeenCalled()
    },
  )

  it('401 时已在 /login 页：清态与事件仍发生，但不重复 assign', async () => {
    reinstallWindow({ pathname: '/login' })
    seedAuth()
    await expect(api.unwrap(jsonResponse({ code: 401 }, { status: 401 }), '/data/x')).rejects.toBeInstanceOf(api.ApiError)
    expect(win.storage.getItem('dljy_restore_token')).toBeNull()
    expect(dispatchedEvents().map((event) => event.type)).toEqual(['auth-expired'])
    expect(win.location.assign).not.toHaveBeenCalled()
  })

  it('403：发 auth-forbidden 事件（detail.path），不清登录态不跳转', async () => {
    seedAuth()
    const err = await captureError(api.unwrap(jsonResponse({ code: 403, msg: '无权限' }, { status: 403 }), '/private/x'))
    expect(err.code).toBe(403)
    expect(win.storage.getItem('dljy_restore_token')).toBe('tok-1')
    expect(win.location.assign).not.toHaveBeenCalled()
    const events = dispatchedEvents()
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('auth-forbidden')
    expect(events[0]!.detail).toEqual({ path: '/private/x', message: '无权限' })
  })

  it('423：发 auth-locked 事件携带 lockedUntil', async () => {
    await expect(api.unwrap(
      jsonResponse({ code: 423, lockedUntil: '2026-09-01T00:00:00Z' }, { status: 423 }),
      '/auth/login',
    )).rejects.toBeInstanceOf(api.ApiError)
    const events = dispatchedEvents()
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('auth-locked')
    expect((events[0]!.detail as Record<string, unknown>).lockedUntil).toBe('2026-09-01T00:00:00Z')
  })
})

describe('私有族无权限记账（markCaptureAccessDenied/clear/reset）', () => {
  it('mark 入账：写 accessDenied/visibility/requested，同 family 重复标记不重复入账', () => {
    api.markCaptureAccessDenied(403, 'company', 'settlement')
    expect(api.deniedCaptureFamilies.value).toEqual(['settlement'])
    expect(api.regionDataStatus.value.accessDenied).toBe(403)
    expect(api.regionDataStatus.value.visibility).toBe('company')
    expect(api.regionDataStatus.value.requested).toBe(defaultRegionId)
    api.markCaptureAccessDenied(403, 'company', 'settlement')
    expect(api.deniedCaptureFamilies.value).toEqual(['settlement'])
  })

  it('同 family 再次以另一状态 mark：账不重复，accessDenied 以最新为准（visibility 缺省回落 company）', () => {
    api.markCaptureAccessDenied(403, 'company', 'settlement')
    api.markCaptureAccessDenied(401, null, 'settlement')
    expect(api.deniedCaptureFamilies.value).toEqual(['settlement'])
    expect(api.regionDataStatus.value.accessDenied).toBe(401)
    expect(api.regionDataStatus.value.visibility).toBe('company')
  })

  it('多 family：逐个出账，账未清不熄 accessDenied，账清空才熄', () => {
    api.markCaptureAccessDenied(403, 'company', 'famA')
    api.markCaptureAccessDenied(403, 'company', 'famB')
    api.clearCaptureAccessDenied('famA')
    expect(api.deniedCaptureFamilies.value).toEqual(['famB'])
    expect(api.regionDataStatus.value.accessDenied).toBe(403)
    api.clearCaptureAccessDenied('famB')
    expect(api.deniedCaptureFamilies.value).toEqual([])
    expect(api.regionDataStatus.value.accessDenied).toBeNull()
  })

  it('clear 不在账的 family：no-op，不动现有状态', () => {
    api.markCaptureAccessDenied(403, 'company', 'famA')
    api.clearCaptureAccessDenied('not-marked')
    expect(api.deniedCaptureFamilies.value).toEqual(['famA'])
    expect(api.regionDataStatus.value.accessDenied).toBe(403)
  })

  it('reset 全清：family 账与 accessDenied 一并熄灭', () => {
    api.markCaptureAccessDenied(401, 'company', 'famA')
    api.resetCaptureAccessDenied()
    expect(api.deniedCaptureFamilies.value).toEqual([])
    expect(api.regionDataStatus.value.accessDenied).toBeNull()
  })
})

describe('applyRegionHeaders 与 regionDataStatus 状态机', () => {
  it('x-region-served/x-region-fallback：fallback 仅字面 true 为真', () => {
    api.applyRegionHeaders(new Response(null, { status: 200, headers: { 'x-region-served': 'shanxi', 'x-region-fallback': 'true' } }))
    expect(api.regionDataStatus.value).toMatchObject({ requested: 'yunnan', served: 'shanxi', fallback: true })
    api.applyRegionHeaders(new Response(null, { status: 200, headers: { 'x-region-fallback': 'false' } }))
    expect(api.regionDataStatus.value.fallback).toBe(false)
    api.applyRegionHeaders(new Response(null, { status: 200, headers: { 'x-region-fallback': '1' } }))
    expect(api.regionDataStatus.value.fallback).toBe(false)
  })

  it('x-data-mock：字面 true → mock=true，其余 false', () => {
    api.applyRegionHeaders(new Response(null, { status: 200, headers: { 'x-data-mock': 'true' } }))
    expect(api.regionDataStatus.value.mock).toBe(true)
    api.applyRegionHeaders(new Response(null, { status: 200, headers: { 'x-data-mock': 'false' } }))
    expect(api.regionDataStatus.value.mock).toBe(false)
  })

  it('x-data-visibility：只认 company/public，其它归 null', () => {
    api.applyRegionHeaders(new Response(null, { status: 200, headers: { 'x-data-visibility': 'company' } }))
    expect(api.regionDataStatus.value.visibility).toBe('company')
    api.applyRegionHeaders(new Response(null, { status: 200, headers: { 'x-data-visibility': 'public' } }))
    expect(api.regionDataStatus.value.visibility).toBe('public')
    api.applyRegionHeaders(new Response(null, { status: 200, headers: { 'x-data-visibility': 'internal' } }))
    expect(api.regionDataStatus.value.visibility).toBeNull()
  })

  it('不带任何地区头的响应不改状态', () => {
    api.regionDataStatus.value = { requested: 'yunnan', served: 'shanxi', fallback: true, mock: true, visibility: 'company', accessDenied: 403 }
    api.applyRegionHeaders(new Response(null, { status: 200 }))
    expect(api.regionDataStatus.value).toEqual({
      requested: 'yunnan', served: 'shanxi', fallback: true, mock: true, visibility: 'company', accessDenied: 403,
    })
  })

  it('成功响应（带地区头）不清 accessDenied（混合面板不变量）', async () => {
    api.markCaptureAccessDenied(403, 'company', 'famA')
    await api.unwrap(jsonResponse({ code: 200 }, { headers: { 'x-region-served': 'yunnan' } }), '/real')
    expect(api.regionDataStatus.value.served).toBe('yunnan')
    expect(api.regionDataStatus.value.accessDenied).toBe(403)
    expect(api.deniedCaptureFamilies.value).toEqual(['famA'])
  })

  it('切换地区：清空地区状态与无权限账，后续请求头带新地区', async () => {
    api.markCaptureAccessDenied(403, 'company', 'famA')
    api.regionDataStatus.value = { requested: 'yunnan', served: 'shanxi', fallback: true, mock: true, visibility: 'company', accessDenied: 403 }
    try {
      setCurrentRegionId('shanxi')
      await nextTick()
      expect(api.regionDataStatus.value).toEqual({ requested: 'shanxi', served: null, fallback: false, mock: false, visibility: null, accessDenied: null })
      expect(api.deniedCaptureFamilies.value).toEqual([])
      expect(api.requestHeaders()['x-region-id']).toBe('shanxi')
    } finally {
      setCurrentRegionId(defaultRegionId)
      await nextTick()
    }
  })
})

describe('idempotencyKeyOf（内容派生幂等键：重试同键可去重，异内容异键）', () => {
  it('同内容同键；内容或前缀变化换键；格式 prefix-8位hex', () => {
    const a = api.idempotencyKeyOf('re', { eventTime: '2026-08-27', level: 'high' })
    expect(api.idempotencyKeyOf('re', { eventTime: '2026-08-27', level: 'high' })).toBe(a)
    expect(api.idempotencyKeyOf('re', { eventTime: '2026-08-27', level: 'low' })).not.toBe(a)
    expect(api.idempotencyKeyOf('case', { eventTime: '2026-08-27', level: 'high' })).not.toBe(a)
    expect(a).toMatch(/^re-[0-9a-f]{8}$/)
  })
})
