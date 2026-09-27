import { describe, expect, it, vi } from 'vitest'
import type { Viewer } from 'cesium'
import { BASE_MAP_PROVIDERS } from '../../../config/mapProviders'
import { baseMapCredentialReady, useBaseMap } from './useBaseMap'

/** 假 Viewer：只实现 switchBaseMap 用到的 imageryLayers 与 scene 面。 */
function createFakeViewer() {
  const providers: Array<{ errorEvent: { raiseEvent: (error: unknown) => void } }> = []
  const imageryLayers = {
    removeAll: vi.fn(),
    addImageryProvider: vi.fn((provider: { errorEvent: { raiseEvent: (error: unknown) => void } }) => {
      providers.push(provider)
      return { alpha: 1, brightness: 1, contrast: 1, saturation: 1, gamma: 1 }
    }),
  }
  const viewer = { imageryLayers, scene: { requestRender: vi.fn() } } as unknown as Viewer
  return { viewer, imageryLayers, providers }
}

function createHarness() {
  const { viewer, imageryLayers, providers } = createFakeViewer()
  const rebuildHillshade = vi.fn()
  const baseMap = useBaseMap({
    getViewer: () => viewer,
    liveMessage: { value: '' },
    getHillshadeEnabled: () => false,
    rebuildHillshade,
  })
  return { baseMap, imageryLayers, providers, rebuildHillshade }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('baseMapCredentialReady', () => {
  it('免 token 源恒可选，缺凭据的 ion/天地图源置灰', () => {
    expect(baseMapCredentialReady(BASE_MAP_PROVIDERS['arcgis-imagery'])).toBe(true)
    expect(baseMapCredentialReady(BASE_MAP_PROVIDERS['ion-aerial'])).toBe(false)
    expect(baseMapCredentialReady(BASE_MAP_PROVIDERS['tianditu-imagery'])).toBe(false)
  })
})

describe('useBaseMap 底图切换', () => {
  it('首装走降级序列首选源，上屏后状态 ready', async () => {
    const { baseMap, imageryLayers } = createHarness()
    baseMap.initSequence()
    baseMap.start()
    await vi.waitFor(() => expect(baseMap.baseMapStatus.value.state).toBe('ready'))
    expect(baseMap.activeBaseMapId.value).toBe('arcgis-imagery')
    expect(imageryLayers.removeAll).toHaveBeenCalledTimes(1)
    expect(imageryLayers.addImageryProvider).toHaveBeenCalledTimes(1)
  })

  it('selectBaseMap 切到序列内非首选源：拆旧层装新层（现状行为：横幅提示已切备用源）', async () => {
    const { baseMap, imageryLayers } = createHarness()
    baseMap.initSequence()
    baseMap.start()
    await vi.waitFor(() => expect(baseMap.baseMapStatus.value.state).toBe('ready'))

    baseMap.selectBaseMap('carto-dark')
    await vi.waitFor(() => expect(baseMap.activeBaseMapId.value).toBe('carto-dark'))
    // 序列内 index > 0 的源沿用「备用源」横幅语义（拆分前行为，保持不变）。
    expect(baseMap.baseMapStatus.value.state).toBe('fallback')
    expect(baseMap.baseMapStatus.value.message).toContain('用户切换底图')
    expect(imageryLayers.removeAll).toHaveBeenCalledTimes(2)
    expect(imageryLayers.addImageryProvider).toHaveBeenCalledTimes(2)
  })

  it('需 token 未配置的源被拒绝：菜单高亮与影像层都不动', async () => {
    const { baseMap, imageryLayers } = createHarness()
    baseMap.initSequence()
    baseMap.start()
    await vi.waitFor(() => expect(baseMap.activeBaseMapId.value).toBe('arcgis-imagery'))

    baseMap.selectBaseMap('ion-aerial')
    await flush()
    expect(baseMap.activeBaseMapId.value).toBe('arcgis-imagery')
    expect(imageryLayers.addImageryProvider).toHaveBeenCalledTimes(1)
  })

  it('瓦片连续失败达到阈值自动降级到下一免费源，状态标 fallback', async () => {
    const { baseMap, providers } = createHarness()
    baseMap.initSequence()
    baseMap.start()
    await vi.waitFor(() => expect(baseMap.activeBaseMapId.value).toBe('arcgis-imagery'))

    providers[0].errorEvent.raiseEvent({})
    await flush()
    expect(baseMap.baseMapStatus.value.state).toBe('degraded')

    providers[0].errorEvent.raiseEvent({})
    await vi.waitFor(() => expect(baseMap.activeBaseMapId.value).toBe('carto-voyager'))
    expect(baseMap.baseMapStatus.value.state).toBe('fallback')
    expect(baseMap.baseMapStatus.value.message).toContain('免费备用底图')
  })

  it('429/418 限流错误不计入故障，不触发降级', async () => {
    const { baseMap, providers } = createHarness()
    baseMap.initSequence()
    baseMap.start()
    await vi.waitFor(() => expect(baseMap.activeBaseMapId.value).toBe('arcgis-imagery'))

    for (let index = 0; index < 4; index += 1) {
      providers[0].errorEvent.raiseEvent({ statusCode: 429 })
    }
    await flush()
    expect(baseMap.activeBaseMapId.value).toBe('arcgis-imagery')
    expect(baseMap.baseMapStatus.value.state).toBe('ready')
  })

  it('dispose 后瓦片错误不再触发切换（销毁配对）', async () => {
    const { baseMap, providers } = createHarness()
    baseMap.initSequence()
    baseMap.start()
    await vi.waitFor(() => expect(baseMap.activeBaseMapId.value).toBe('arcgis-imagery'))

    baseMap.dispose()
    providers[0].errorEvent.raiseEvent({})
    providers[0].errorEvent.raiseEvent({})
    await flush()
    expect(baseMap.activeBaseMapId.value).toBe('arcgis-imagery')
    expect(baseMap.baseMapStatus.value.state).toBe('ready')
  })

  it('晕渲开启时底图收尾会重建晕渲层', async () => {
    const { viewer } = createFakeViewer()
    const rebuildHillshade = vi.fn()
    const baseMap = useBaseMap({
      getViewer: () => viewer,
      liveMessage: { value: '' },
      getHillshadeEnabled: () => true,
      rebuildHillshade,
    })
    baseMap.initSequence()
    baseMap.start()
    await vi.waitFor(() => expect(baseMap.baseMapStatus.value.state).toBe('ready'))
    expect(rebuildHillshade).toHaveBeenCalled()
  })
})
