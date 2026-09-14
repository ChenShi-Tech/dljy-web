// 不变量：真实useEChart生命周期须等容器出现/有尺寸后交付数值配置；卸载须释放图表。
// 只替换绘图库边界，不替换useEChart。此处不是浏览器像素验收。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { DisclosureDatasetResult } from '@/services/forecast/dailyDisclosure'

const engine = vi.hoisted(() => ({ init: vi.fn(), instances: [] as Array<{ setOption: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; getDom: () => HTMLElement; isDisposed: () => boolean }> }))
vi.mock('echarts', () => ({ init: engine.init, connect: vi.fn(), registerTheme: vi.fn() }))
vi.mock('@/services/chart/echartsTheme', () => ({ activeChartTheme: () => undefined }))
vi.mock('@/services/theme', async () => {
  const { reactive } = await import('vue')
  return { themeState: reactive({ theme: 'classic' }) }
})

import DisclosureDatasetCard from './DisclosureDatasetCard.vue'

let wrapper: VueWrapper | undefined
let width = 600
let height = 288
let frames: FrameRequestCallback[] = []
let resized: () => void = () => {}
const disconnected = vi.fn()

function data(hasPoints = true): DisclosureDatasetResult {
  return {
    spec: { id: 'load_actual', family: 'yn_system_forecast', title: '统调负荷', group: 'actual', nature: 'actual', unit: '原始值', slots: 96 },
    date: '2026-06-25', status: hasPoints ? 'ready' : 'partial', rows: [{ value: 12 }], warnings: [], sourceLabel: '真实数据回放',
    series: hasPoints ? [{ id: '["yn",null,"load_actual"]', label: '统调负荷', scope: 'yn', scopeLabel: '云南省内', targetDate: null,
      unit: '原始值', labels: ['00:00', '00:15', '00:30'], points: [12, null, 18], previous: [null, null, null], validPoints: 2, expectedPoints: 96, conflicts: 0 }] : [],
  }
}

function render(hasPoints = true) {
  wrapper = mount(DisclosureDatasetCard, { props: { dataset: data(hasPoints) }, global: { stubs: {
    ElButton: { template: '<button><slot /></button>' }, ElDialog: { template: '<div />' },
  } } })
  return wrapper
}

beforeEach(() => {
  width = 600; height = 288; frames = []
  engine.instances.length = 0
  engine.init.mockReset()
  disconnected.mockReset()
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback }
    observe = vi.fn()
    disconnect = disconnected
  })
  engine.init.mockImplementation((dom: HTMLElement) => {
    let disposed = false
    const instance = { getDom: () => dom, isDisposed: () => disposed, setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(() => { disposed = true }) }
    engine.instances.push(instance)
    return instance
  })
})

afterEach(() => {
  wrapper?.unmount(); wrapper = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('DisclosureDatasetCard real lifecycle', () => {
  it('首次挂载向实际图表容器交付原始点值，卸载销毁', async () => {
    const card = render()
    await flushPromises()
    expect(engine.init).toHaveBeenCalledTimes(1)
    const instance = engine.instances[0]
    expect(instance.getDom()).toBe(card.find('.disclosure-card__chart').element)
    expect(instance.setOption.mock.calls.at(-1)?.[0].series[0].data).toEqual([12, null, 18])
    card.unmount(); wrapper = undefined
    expect(instance.dispose).toHaveBeenCalledTimes(1)
    expect(disconnected).toHaveBeenCalled()
  })

  it('隐藏容器不以零尺寸初始化，变为可见后恢复配置', async () => {
    width = 0; height = 0
    render()
    await flushPromises()
    expect(engine.init).not.toHaveBeenCalled()
    for (const frame of frames.splice(0)) frame(0)
    width = 600; height = 288
    resized()
    for (const frame of frames.splice(0)) frame(16)
    expect(engine.init).toHaveBeenCalledTimes(1)
    expect(engine.instances[0].setOption.mock.calls.at(-1)?.[0].series[0].data).toEqual([12, null, 18])
  })

  it('原始记录空态转有效曲线后绑定新容器并初始化', async () => {
    const card = render(false)
    await flushPromises()
    expect(engine.init).not.toHaveBeenCalled()
    expect(card.find('.disclosure-card__chart').exists()).toBe(false)
    await card.setProps({ dataset: data() })
    await flushPromises()
    expect(engine.init).toHaveBeenCalledTimes(1)
    expect(engine.instances[0].getDom()).toBe(card.find('.disclosure-card__chart').element)
  })
})
