/**
 * @vitest-environment happy-dom
 *
 * 本模块读写 localStorage 并广播 window 事件，node 环境跑不了。文件级 docblock
 * 优先于 vitest.config 里 node project 的 environment 设置，无需为它改名成
 * `*.component.spec.ts`（那个后缀是给组件测试用的，名实不符）。
 *
 * 模块持有会话级兜底状态（`sessionToken`），所以每个用例都要 `vi.resetModules()`
 * 后重新 import，否则上一条用例写进去的 token 会漏到下一条。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MapTokens = typeof import('./mapTokens')
let m: MapTokens

describe('mapTokens 三维地图凭据运行时解析', () => {
  beforeEach(async () => {
    vi.resetModules()
    localStorage.clear()
    vi.stubEnv('VITE_CESIUM_ION_TOKEN', '')
    vi.stubEnv('VITE_GRID_GEO_ARCGIS_TOKEN', '')
    m = await import('./mapTokens')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    localStorage.clear()
  })

  it('无任何来源时返回空串且判定为未配置', () => {
    expect(m.resolveIonToken()).toBe('')
    expect(m.hasIonToken()).toBe(false)
    expect(m.resolveIonTokenSource()).toBe('none')
  })

  it('只有构建期变量时用它，来源标为 build', () => {
    vi.stubEnv('VITE_CESIUM_ION_TOKEN', 'build-time-token')
    expect(m.resolveIonToken()).toBe('build-time-token')
    expect(m.resolveIonTokenSource()).toBe('build')
    expect(m.hasIonToken()).toBe(true)
  })

  it('运行时值压过构建期值——否则现场永远换不掉打包时烧进去的 token', () => {
    vi.stubEnv('VITE_CESIUM_ION_TOKEN', 'build-time-token')
    localStorage.setItem(m.ION_TOKEN_STORAGE_KEY, 'runtime-token')
    expect(m.resolveIonToken()).toBe('runtime-token')
    expect(m.resolveIonTokenSource()).toBe('runtime')
  })

  it('写入后立即生效并落盘', () => {
    expect(m.writeIonToken('  fresh-token  ')).toBe('fresh-token')
    expect(localStorage.getItem(m.ION_TOKEN_STORAGE_KEY)).toBe('fresh-token')
    expect(m.resolveIonToken()).toBe('fresh-token')
    expect(m.resolveIonTokenSource()).toBe('runtime')
  })

  it('写空串清除运行时值并回落到构建期值', () => {
    vi.stubEnv('VITE_CESIUM_ION_TOKEN', 'build-time-token')
    m.writeIonToken('runtime-token')
    expect(m.writeIonToken('')).toBe('build-time-token')
    expect(localStorage.getItem(m.ION_TOKEN_STORAGE_KEY)).toBeNull()
    expect(m.resolveIonTokenSource()).toBe('build')
  })

  it('写入会广播变更事件，地图据此热重建而不必刷新页面', () => {
    const listener = vi.fn()
    window.addEventListener(m.MAP_TOKEN_CHANGE_EVENT, listener)
    m.writeIonToken('token-a')
    m.writeIonToken('')
    window.removeEventListener(m.MAP_TOKEN_CHANGE_EVENT, listener)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  // 注意 spy 打在 localStorage **实例**上而不是 Storage.prototype：happy-dom 的
  // storage 实现不经原型链派发，prototype spy 装得上却拦不住，测试会在缺陷仍然
  // 存在时照样变绿。每条容错用例都补一句 `toHaveBeenCalled()` 钉死 mock 真的生效了。
  it('localStorage 读取抛异常时降级为「无凭据」而不是让页面崩', () => {
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Access is denied', 'SecurityError')
    })
    expect(() => m.resolveIonToken()).not.toThrow()
    expect(m.resolveIonToken()).toBe('')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  // 这条是 PR #80 codex P2 指出的缺陷的回归护栏：存储写不进去时（隐私模式、
  // 嵌入式部署、site data 被禁），writeIonToken 曾经 return resolveIonToken()
  // 重读存储、把刚填的 token 丢掉——而这正是那条容错分支唯一要服务的环境。
  // 原测试只断言 not.toThrow()，恰好在缺陷存在时也是绿的。
  it('localStorage 写入抛异常时，本次会话仍按新值走（不只是不抛错）', () => {
    vi.stubEnv('VITE_CESIUM_ION_TOKEN', 'build-time-token')
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    expect(m.writeIonToken('runtime-token')).toBe('runtime-token')
    expect(m.resolveIonToken()).toBe('runtime-token')
    expect(m.resolveIonTokenSource()).toBe('runtime')
    expect(m.hasIonToken()).toBe(true)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
    // 落盘确实失败了——本条兜的就是「存储没有、会话有」这个状态
    expect(localStorage.getItem(m.ION_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('清除也走会话兜底：removeItem 抛异常时不得把存储里的残留读回来', () => {
    vi.stubEnv('VITE_CESIUM_ION_TOKEN', 'build-time-token')
    localStorage.setItem(m.ION_TOKEN_STORAGE_KEY, 'stale-token')
    const spy = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new DOMException('Access is denied', 'SecurityError')
    })
    expect(m.writeIonToken('')).toBe('build-time-token')
    expect(m.resolveIonTokenSource()).toBe('build')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
    // 残留还在存储里，但会话已判定为「已清除」，不得把它读回来
    expect(localStorage.getItem(m.ION_TOKEN_STORAGE_KEY)).toBe('stale-token')
  })

  it('ArcGIS token 仍只走构建期变量（免费源不需要，企业版才用）', () => {
    expect(m.resolveArcgisToken()).toBe('')
    vi.stubEnv('VITE_GRID_GEO_ARCGIS_TOKEN', 'arcgis-enterprise-token')
    expect(m.resolveArcgisToken()).toBe('arcgis-enterprise-token')
  })
})
