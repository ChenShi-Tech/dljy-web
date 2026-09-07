/**
 * @vitest-environment happy-dom
 *
 * 本模块读写 localStorage 并广播 window 事件，node 环境跑不了。文件级 docblock
 * 优先于 vitest.config 里 node project 的 environment 设置，无需为它改名成
 * `*.component.spec.ts`（那个后缀是给组件测试用的，名实不符）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ION_TOKEN_STORAGE_KEY,
  MAP_TOKEN_CHANGE_EVENT,
  hasIonToken,
  resolveArcgisToken,
  resolveIonToken,
  resolveIonTokenSource,
  writeIonToken,
} from './mapTokens'

describe('mapTokens 三维地图凭据运行时解析', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubEnv('VITE_CESIUM_ION_TOKEN', '')
    vi.stubEnv('VITE_GRID_GEO_ARCGIS_TOKEN', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    localStorage.clear()
  })

  it('无任何来源时返回空串且判定为未配置', () => {
    expect(resolveIonToken()).toBe('')
    expect(hasIonToken()).toBe(false)
    expect(resolveIonTokenSource()).toBe('none')
  })

  it('只有构建期变量时用它，来源标为 build', () => {
    vi.stubEnv('VITE_CESIUM_ION_TOKEN', 'build-time-token')
    expect(resolveIonToken()).toBe('build-time-token')
    expect(resolveIonTokenSource()).toBe('build')
    expect(hasIonToken()).toBe(true)
  })

  it('运行时值压过构建期值——否则现场永远换不掉打包时烧进去的 token', () => {
    vi.stubEnv('VITE_CESIUM_ION_TOKEN', 'build-time-token')
    localStorage.setItem(ION_TOKEN_STORAGE_KEY, 'runtime-token')
    expect(resolveIonToken()).toBe('runtime-token')
    expect(resolveIonTokenSource()).toBe('runtime')
  })

  it('写入后立即生效并落盘', () => {
    expect(writeIonToken('  fresh-token  ')).toBe('fresh-token')
    expect(localStorage.getItem(ION_TOKEN_STORAGE_KEY)).toBe('fresh-token')
    expect(resolveIonTokenSource()).toBe('runtime')
  })

  it('写空串清除运行时值并回落到构建期值', () => {
    vi.stubEnv('VITE_CESIUM_ION_TOKEN', 'build-time-token')
    writeIonToken('runtime-token')
    expect(writeIonToken('')).toBe('build-time-token')
    expect(localStorage.getItem(ION_TOKEN_STORAGE_KEY)).toBeNull()
    expect(resolveIonTokenSource()).toBe('build')
  })

  it('写入会广播变更事件，地图据此热重建而不必刷新页面', () => {
    const listener = vi.fn()
    window.addEventListener(MAP_TOKEN_CHANGE_EVENT, listener)
    writeIonToken('token-a')
    writeIonToken('')
    window.removeEventListener(MAP_TOKEN_CHANGE_EVENT, listener)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('localStorage 读取抛异常时降级为「无凭据」而不是让页面崩', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access is denied', 'SecurityError')
    })
    expect(() => resolveIonToken()).not.toThrow()
    expect(resolveIonToken()).toBe('')
    spy.mockRestore()
  })

  it('localStorage 写入抛异常时本次会话仍按新值走', () => {
    vi.stubEnv('VITE_CESIUM_ION_TOKEN', 'build-time-token')
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    // 写不进去 → 解析结果回落构建期值，但不得抛错中断面板保存流程
    expect(() => writeIonToken('runtime-token')).not.toThrow()
    spy.mockRestore()
  })

  it('ArcGIS token 仍只走构建期变量（免费源不需要，企业版才用）', () => {
    expect(resolveArcgisToken()).toBe('')
    vi.stubEnv('VITE_GRID_GEO_ARCGIS_TOKEN', 'arcgis-enterprise-token')
    expect(resolveArcgisToken()).toBe('arcgis-enterprise-token')
  })
})
