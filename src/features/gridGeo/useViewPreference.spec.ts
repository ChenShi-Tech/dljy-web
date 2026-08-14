import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useGridGeoViewPreference, VERTICAL_EXAGGERATION_RANGE } from './useViewPreference'

const KEY = (scope: string) => `dljy.grid-geo.view-pref.${scope}`

/** 单测跑在 node 环境（无 jsdom），用内存版顶上，顺带能模拟存储抛错。 */
function memoryStorage(seed: Record<string, string> = {}) {
  const map = new globalThis.Map(Object.entries(seed))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    snapshot: () => Object.fromEntries(map),
  }
}

describe('useGridGeoViewPreference', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('首次进入落三维——#1427 把驾驶舱默认改成平面图后 3D 地形要手点才回得来', () => {
    expect(useGridGeoViewPreference('command').viewMode.value).toBe('3d')
  })

  it('记住上次选择：存过 2d 就不该被默认值顶回 3d', () => {
    vi.stubGlobal('localStorage', memoryStorage({ [KEY('market')]: JSON.stringify({ viewMode: '2d' }) }))
    expect(useGridGeoViewPreference('market').viewMode.value).toBe('2d')
  })

  it('按 scope 隔离：驾驶舱看惯平面图不该把气象专项页也拖成 2D', () => {
    vi.stubGlobal('localStorage', memoryStorage({ [KEY('command')]: JSON.stringify({ viewMode: '2d' }) }))
    expect(useGridGeoViewPreference('command').viewMode.value).toBe('2d')
    expect(useGridGeoViewPreference('weather').viewMode.value).toBe('3d')
  })

  it('切换后写回存储', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    const { viewMode, terrainProvider } = useGridGeoViewPreference('assets')
    viewMode.value = '2.5d'
    terrainProvider.value = 'ellipsoid'
    await nextTick()
    expect(JSON.parse(storage.snapshot()[KEY('assets')])).toMatchObject({
      viewMode: '2.5d',
      terrainProvider: 'ellipsoid',
    })
  })

  it('非法存量取值回默认，不把脏数据透给 Cesium', () => {
    vi.stubGlobal('localStorage', memoryStorage({
      [KEY('topology')]: JSON.stringify({ viewMode: '4d', terrainProvider: 'google-terrain', hillshadeEnabled: 'yes' }),
    }))
    const pref = useGridGeoViewPreference('topology')
    expect(pref.viewMode.value).toBe('3d')
    expect(pref.terrainProvider.value).toBe('arcgis-terrain')
    expect(pref.hillshadeEnabled.value).toBe(true)
  })

  it('存储内容不是 JSON 时按无历史处理', () => {
    vi.stubGlobal('localStorage', memoryStorage({ [KEY('command')]: '{不是 JSON' }))
    expect(useGridGeoViewPreference('command').viewMode.value).toBe('3d')
  })

  it('山地夸张夹取到滑块区间——存量越界值会让地形拉伸成尖刺', () => {
    vi.stubGlobal('localStorage', memoryStorage({ [KEY('assets')]: JSON.stringify({ verticalExaggeration: 9 }) }))
    expect(useGridGeoViewPreference('assets').verticalExaggeration.value).toBe(VERTICAL_EXAGGERATION_RANGE.max)

    vi.stubGlobal('localStorage', memoryStorage({ [KEY('market')]: JSON.stringify({ verticalExaggeration: -3 }) }))
    expect(useGridGeoViewPreference('market').verticalExaggeration.value).toBe(VERTICAL_EXAGGERATION_RANGE.min)
  })

  it('存储读写抛错时只丢记忆，不让页面崩', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('QuotaExceededError') },
    })
    const { viewMode } = useGridGeoViewPreference('weather')
    expect(viewMode.value).toBe('3d')
    viewMode.value = '2d'
    await expect(nextTick()).resolves.toBeUndefined()
  })

  it('无 localStorage 的运行环境同样回默认值', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(useGridGeoViewPreference('command').viewMode.value).toBe('3d')
  })
})
