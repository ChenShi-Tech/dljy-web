import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAP_TOKEN_CHANGE_EVENT } from '../../../config/mapTokens'
import { useCesiumViewer } from './useCesiumViewer'

const { FakeViewer } = vi.hoisted(() => {
  class FakeViewer {
    static instances: FakeViewer[] = []
    destroyed = false
    clock = { shouldAnimate: false }
    resolutionScale = 1
    scene = {
      msaaSamples: 0,
      backgroundColor: null as unknown,
      sunBloom: false,
      highDynamicRange: false,
      requestRender: vi.fn(),
      globe: {} as Record<string, unknown>,
      canvas: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      preRender: { addEventListener: vi.fn(() => vi.fn()) },
      postProcessStages: { fxaa: { enabled: false } },
      fog: {} as Record<string, unknown>,
      skyAtmosphere: null,
      sun: null,
    }
    constructor() {
      FakeViewer.instances.push(this)
    }
    destroy() {
      this.destroyed = true
    }
  }
  return { FakeViewer }
})

vi.mock('cesium', () => ({
  Viewer: FakeViewer,
  Color: { fromCssColorString: (css: string) => ({ css }) },
  EllipsoidTerrainProvider: class {},
}))

// node 环境无 window；stub 出带监听记账的假 window，偏好监听依赖它解绑。
const windowListeners = new Map<string, Set<(event?: unknown) => void>>()
vi.stubGlobal('window', {
  matchMedia: undefined,
  addEventListener: (type: string, cb: (event?: unknown) => void) => {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set())
    windowListeners.get(type)!.add(cb)
  },
  removeEventListener: (type: string, cb: (event?: unknown) => void) => {
    windowListeners.get(type)?.delete(cb)
  },
})

const ASSEMBLE_ORDER = [
  'beforeCreate',
  'onViewCreated',
  'onViewCreatedLate',
  'startLayers',
  'attachInteraction',
  'renderAll',
  'applyShading',
  'applyTerrain',
  'initialCamera',
] as const

function createHooks(overrides: Partial<Record<string, () => unknown>> = {}) {
  const order: string[] = []
  const track = (name: string) => vi.fn(() => { order.push(name) })
  const hooks = {
    beforeCreate: track('beforeCreate'),
    onViewCreated: track('onViewCreated'),
    onViewCreatedLate: track('onViewCreatedLate'),
    startLayers: track('startLayers'),
    attachInteraction: track('attachInteraction'),
    renderAll: track('renderAll'),
    applyShading: track('applyShading'),
    applyTerrain: vi.fn(async () => { order.push('applyTerrain') }),
    initialCamera: track('initialCamera'),
    ...overrides,
  }
  return { order, hooks }
}

function createHarness() {
  FakeViewer.instances.length = 0
  const onRuntime = vi.fn()
  const state = useCesiumViewer({
    container: { value: {} as HTMLDivElement },
    onRuntime,
    onMapTokenChange: vi.fn(),
    getInitialViewMode: () => '3d',
  })
  state.setRenderHooks({
    rebuildClouds: vi.fn(),
    renderPlantEntities: vi.fn(),
    renderTopologyEntities: vi.fn(),
  })
  return { state, onRuntime }
}

describe('useCesiumViewer', () => {
  beforeEach(() => {
    windowListeners.clear()
  })

  it('bootstrap 按拆分前的装配顺序执行全部钩子', async () => {
    const { state } = createHarness()
    const { order, hooks } = createHooks()
    state.bootstrap(hooks, vi.fn())
    await vi.waitFor(() => expect(order).toEqual([...ASSEMBLE_ORDER]))
    expect(FakeViewer.instances).toHaveLength(1)
    expect(state.initializationError.value).toBe('')
  })

  it('创建/销毁配对：destroyViewer 调用 Viewer.destroy 并置空引用，重复销毁安全', async () => {
    const { state } = createHarness()
    const { hooks } = createHooks()
    state.bootstrap(hooks, vi.fn())
    await vi.waitFor(() => expect(FakeViewer.instances).toHaveLength(1))
    const created = FakeViewer.instances[0]
    expect(state.viewer.value).toBe(created)

    state.destroyViewer()
    expect(created.destroyed).toBe(true)
    expect(state.viewer.value).toBeNull()

    // 组件卸载与重挂载竞态下 destroy 可能被调第二次，不允许抛错。
    expect(() => state.destroyViewer()).not.toThrow()
    expect(created.destroyed).toBe(true)
  })

  it('detachContext 解绑 WebGL 上下文与偏好/token 的 window 监听', async () => {
    const { state } = createHarness()
    const { hooks } = createHooks()
    state.bootstrap(hooks, vi.fn())
    await vi.waitFor(() => expect(FakeViewer.instances).toHaveLength(1))
    expect(windowListeners.get(MAP_TOKEN_CHANGE_EVENT)?.size).toBe(1)

    state.detachContext()
    expect(windowListeners.get(MAP_TOKEN_CHANGE_EVENT)?.size ?? 0).toBe(0)
    const canvas = FakeViewer.instances[0].scene.canvas
    expect(canvas.removeEventListener).toHaveBeenCalledWith('webglcontextlost', expect.any(Function))
    expect(canvas.removeEventListener).toHaveBeenCalledWith('webglcontextrestored', expect.any(Function))
  })

  it('初始化失败时回调错误消息并广播 runtime 不可用', async () => {
    const { state, onRuntime } = createHarness()
    const onInitializationFailed = vi.fn()
    const { hooks } = createHooks({
      applyTerrain: vi.fn(async () => { throw new Error('boom') }),
    })
    state.bootstrap(hooks, onInitializationFailed)
    await vi.waitFor(() => expect(onInitializationFailed).toHaveBeenCalledWith('boom'))
    expect(state.initializationError.value).toBe('boom')
    expect(onRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ webgl: 'unavailable' }))
  })

  it('性能档位应用时对外广播 runtime 状态并联动渲染钩子', async () => {
    const { state, onRuntime } = createHarness()
    const renderHooks = { rebuildClouds: vi.fn(), renderPlantEntities: vi.fn(), renderTopologyEntities: vi.fn() }
    state.setRenderHooks(renderHooks)
    state.applyRuntimePerformanceProfile()
    expect(onRuntime).toHaveBeenCalledWith(expect.objectContaining({
      network: 'normal',
      renderMode: 'continuous',
      webgl: 'ready',
    }))
  })
})
