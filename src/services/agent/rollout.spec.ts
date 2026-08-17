// 灰度命中查询单测（#1848 第二部分）。
// 守两件事：① 命中判定完全来自服务端（前端不复刻名单比对）② 任何读不到的情况都倒向旧图。
// 第②条是这层的安全底线——灰度查询失败时若默认走 pi，等于用一次网络抖动把用户送上未验证链路。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}
// api.ts 模块求值时会读 window/localStorage 初始化，须先 stub 再动态 import（node 环境无 window）
vi.stubGlobal('window', { localStorage: localStorageStub, location: { origin: 'http://localhost' } })
vi.stubGlobal('localStorage', localStorageStub)

const {
  LEGACY_AGENT_BASE, PI_AGENT_BASE,
  isRolloutScenario, isShadowScenario, loadRolloutEffective, resetRolloutCache, resolveServingBase,
} = await import('@/services/agent/rollout')

function envelope(effective: Record<string, unknown>) {
  return new Response(JSON.stringify({ code: 200, msg: 'ok', data: { effective } }), { status: 200 })
}

function mockFetch(impl: () => Promise<Response>) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

beforeEach(() => {
  store.clear()
  resetRolloutCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('window', { localStorage: localStorageStub, location: { origin: 'http://localhost' } })
  vi.stubGlobal('localStorage', localStorageStub)
})

describe('resolveServingBase 服务端权威', () => {
  it('默认全 off：灰度中的生产场景一律走旧图', async () => {
    mockFetch(async () => envelope({
      declaration_prep: { mode: 'off', serves: 'legacy', shadow: false },
      daily_review: { mode: 'off', serves: 'legacy', shadow: false },
      morning_brief: { mode: 'off', serves: 'legacy', shadow: false },
    }))
    expect(await resolveServingBase('declaration_prep')).toBe(LEGACY_AGENT_BASE)
    expect(await resolveServingBase('morning_brief')).toBe(LEGACY_AGENT_BASE)
  })

  it('serves=pi（primary 或 canary 命中）才路由到 pi', async () => {
    mockFetch(async () => envelope({
      declaration_prep: { mode: 'primary', serves: 'pi', shadow: false },
      daily_review: { mode: 'canary', serves: 'pi', shadow: false },
      morning_brief: { mode: 'canary', serves: 'legacy', shadow: false }, // 名单外
    }))
    expect(await resolveServingBase('declaration_prep')).toBe(PI_AGENT_BASE)
    expect(await resolveServingBase('daily_review')).toBe(PI_AGENT_BASE)
    // canary 名单外由服务端判成 legacy，前端照办——名单比对不在前端做
    expect(await resolveServingBase('morning_brief')).toBe(LEGACY_AGENT_BASE)
  })

  it('shadow 模式下用户侧仍是旧图（这正是影子的定义）', async () => {
    mockFetch(async () => envelope({ declaration_prep: { mode: 'shadow', serves: 'legacy', shadow: true } }))
    expect(await resolveServingBase('declaration_prep')).toBe(LEGACY_AGENT_BASE)
    expect(await isShadowScenario('declaration_prep')).toBe(true)
  })

  it('查询失败一律 fail-safe 回旧图', async () => {
    mockFetch(async () => new Response('boom', { status: 500 }))
    expect(await resolveServingBase('declaration_prep')).toBe(LEGACY_AGENT_BASE)
    expect(await isShadowScenario('declaration_prep')).toBe(false)
  })

  it('响应体读不懂时也回旧图，不抛到调用方（创建会话在用户主路径上）', async () => {
    mockFetch(async () => new Response('not json', { status: 200 }))
    await expect(resolveServingBase('declaration_prep')).resolves.toBe(LEGACY_AGENT_BASE)
  })

  it('非法 mode/serves 一律降到最保守值', async () => {
    mockFetch(async () => envelope({ declaration_prep: { mode: '已切流', serves: 'PI', shadow: true } }))
    const effective = await loadRolloutEffective()
    expect(effective.declaration_prep).toEqual({ mode: 'off', serves: 'legacy', shadow: false })
  })

  it('服务端漏回某场景时按 off 补齐', async () => {
    mockFetch(async () => envelope({ declaration_prep: { mode: 'primary', serves: 'pi', shadow: false } }))
    const effective = await loadRolloutEffective()
    expect(effective.morning_brief).toEqual({ mode: 'off', serves: 'legacy', shadow: false })
  })
})

describe('PoC 专属场景与非灰度场景', () => {
  it('strategic_qa / declaration_checkup 恒走 pi 且不查灰度表', async () => {
    const spy = mockFetch(async () => envelope({}))
    expect(await resolveServingBase('strategic_qa')).toBe(PI_AGENT_BASE)
    expect(await resolveServingBase('declaration_checkup')).toBe(PI_AGENT_BASE)
    expect(spy).not.toHaveBeenCalled()
  })

  it('不在灰度表里的场景走旧图且不查', async () => {
    const spy = mockFetch(async () => envelope({}))
    expect(await resolveServingBase('custom_graph')).toBe(LEGACY_AGENT_BASE)
    expect(await resolveServingBase(undefined)).toBe(LEGACY_AGENT_BASE)
    expect(await isShadowScenario('custom_graph')).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('isRolloutScenario 只认仍在灰度中的场景', () => {
    expect(isRolloutScenario('declaration_prep')).toBe(true)
    expect(isRolloutScenario('strategic_qa')).toBe(false)
    expect(isRolloutScenario(undefined)).toBe(false)
  })

  // #2158：chat 切流完成、旧 supervisor 路径已删，两侧不再并存。它必须像 PoC 场景一样
  // 恒定走 pi 且**完全不查灰度表**——留在表里的话，「查询失败 fail-safe 回旧图」这条
  // 规则会在一次网络抖动时把主对话入口路由到一个不再服务该场景的后端（建会话直接 400）。
  it('chat 已出灰度表：恒走 pi、不查表，且查询失败也不会倒向旧图', async () => {
    const spy = mockFetch(async () => new Response('boom', { status: 500 }))
    expect(await resolveServingBase('chat')).toBe(PI_AGENT_BASE)
    expect(await isShadowScenario('chat')).toBe(false)
    expect(isRolloutScenario('chat')).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('缓存与并发', () => {
  it('TTL 内复用缓存，不重复打接口', async () => {
    const spy = mockFetch(async () => envelope({ declaration_prep: { mode: 'primary', serves: 'pi', shadow: false } }))
    await resolveServingBase('declaration_prep')
    await resolveServingBase('daily_review')
    await isShadowScenario('declaration_prep')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('并发查询合流成一条请求', async () => {
    const spy = mockFetch(async () => envelope({ declaration_prep: { mode: 'shadow', serves: 'legacy', shadow: true } }))
    const [a, b, c] = await Promise.all([
      resolveServingBase('declaration_prep'), isShadowScenario('declaration_prep'), loadRolloutEffective(),
    ])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(a).toBe(LEGACY_AGENT_BASE)
    expect(b).toBe(true)
    expect(c.declaration_prep.mode).toBe('shadow')
  })

  it('换账号（令牌变化）作废缓存：canary 是按用户命中的，不能沿用上一个账号的结果', async () => {
    let serves = 'pi'
    const spy = mockFetch(async () => envelope({ declaration_prep: { mode: 'canary', serves, shadow: false } }))
    localStorage.setItem('dljy_restore_token', 'token-a')
    expect(await resolveServingBase('declaration_prep')).toBe(PI_AGENT_BASE)

    serves = 'legacy'
    localStorage.setItem('dljy_restore_token', 'token-b')
    expect(await resolveServingBase('declaration_prep')).toBe(LEGACY_AGENT_BASE)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('不同令牌的并发查询不合流：换号时不得沿用旧账号的在途结果', async () => {
    // 慢响应制造「A 的请求还没回来，用户已经换成 B」的窗口
    const spy = mockFetch(async () => {
      const token = localStorage.getItem('dljy_restore_token')
      await new Promise((r) => setTimeout(r, 20))
      return envelope({ declaration_prep: { mode: 'canary', serves: token === 'token-a' ? 'pi' : 'legacy', shadow: false } })
    })
    localStorage.setItem('dljy_restore_token', 'token-a')
    const pendingA = resolveServingBase('declaration_prep')
    localStorage.setItem('dljy_restore_token', 'token-b')
    const pendingB = resolveServingBase('declaration_prep')
    expect(await pendingA).toBe(PI_AGENT_BASE)
    // B 若复用了 A 的在途 promise，这里会拿到 pi —— 未命中账号被送进 pi 就是切流事故
    expect(await pendingB).toBe(LEGACY_AGENT_BASE)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('迟到的旧账号响应不占住缓存槽（否则新账号每次都要重查）', async () => {
    let delay = 40
    const spy = mockFetch(async () => {
      const token = localStorage.getItem('dljy_restore_token')
      const wait = delay
      delay = 0 // 只让第一条（token-a）慢
      await new Promise((r) => setTimeout(r, wait))
      return envelope({ declaration_prep: { mode: 'canary', serves: token === 'token-a' ? 'pi' : 'legacy', shadow: false } })
    })
    localStorage.setItem('dljy_restore_token', 'token-a')
    const slowA = resolveServingBase('declaration_prep')
    localStorage.setItem('dljy_restore_token', 'token-b')
    expect(await resolveServingBase('declaration_prep')).toBe(LEGACY_AGENT_BASE) // 第 2 条请求，缓存归 B
    await slowA
    // A 迟到的响应若写进单槽缓存就会把 B 那条挤掉，B 的下一次查询被迫回源（第 3 条）
    expect(await resolveServingBase('declaration_prep')).toBe(LEGACY_AGENT_BASE)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('force=true 强制回源', async () => {
    const spy = mockFetch(async () => envelope({ declaration_prep: { mode: 'off', serves: 'legacy', shadow: false } }))
    await loadRolloutEffective()
    await loadRolloutEffective(true)
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
