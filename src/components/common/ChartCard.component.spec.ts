// ChartCard 生命周期委托 + option 透传保真（Epic #1702 P1）：图表卡片把 echarts 生命周期全托给 useEChart，
// 测试锁住 buildOption→setOption 透传不篡改（禁平滑/step 纪律的传输保真）、notMerge、brushStats 注入、
// loading/png/freshness 委托。永不真 init echarts（happy-dom 无 canvas）——vi.mock useEChart 拦截。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@/test/mount'
import ChartCard from './ChartCard.vue'

// vi.hoisted 持 spy（vi.mock 工厂提升到 import 前，须引用 hoisted 变量）。instance 返回 mock echarts 实例。
const chartSpies = vi.hoisted(() => {
  const getDataURL = vi.fn<(opts: unknown) => string>(() => 'data:image/png;base64,xxx')
  return {
    setOption: vi.fn(),
    instance: vi.fn(() => ({ getDataURL, getOption: vi.fn(() => ({})), on: vi.fn() })),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    _getDataURL: getDataURL
  }
})
vi.mock('@/composables/useEChart', () => ({ useEChart: () => chartSpies }))

function mountChart(props: Record<string, unknown>) {
  return mount(ChartCard, { props: { buildOption: () => ({}), ...props } })
}

describe('ChartCard（Epic #1702 P1）', () => {
  beforeEach(() => {
    // chartSpies 模块级共享（vi.hoisted），每用例清空 mock 调用记录，避免跨用例 calls 累积误判
    chartSpies.setOption.mockClear()
    chartSpies.showLoading.mockClear()
    chartSpies.hideLoading.mockClear()
    chartSpies.instance.mockClear()
    chartSpies._getDataURL.mockClear()
  })

  it('buildOption 输出原样透传 setOption，以 notMerge:true（不篡改 option）', async () => {
    const opt = { series: [{ type: 'line', step: true, smooth: false }] }
    mountChart({ buildOption: () => opt })
    await nextTick()
    expect(chartSpies.setOption).toHaveBeenCalled()
    const [passed, opts] = chartSpies.setOption.mock.calls[0]
    // 内容保真（非引用相等）：toBe(opt) 是平凡的 Object.is——paint 透传的是 buildOption() 返回值本体，
    // 引用恒等永远成立；若有人在 paint 内原地给 series[0].smooth=true / 删掉 step，同引用仍 true，
    // 抓不住「禁平滑/step 纪律」回归（正是本用例声称要锁的）。改用 toEqual 对比独立字面量，
    // 原地突变、增删字段都会失败。
    expect(passed).toEqual({ series: [{ type: 'line', step: true, smooth: false }] })
    expect(opts).toEqual({ notMerge: true })
  })

  it('brushStats 开 → setOption 收到的 option 含 brush 组件 + toolbox 框选工具', async () => {
    mountChart({ brushStats: true })
    await nextTick()
    const passed = chartSpies.setOption.mock.calls[0][0] as Record<string, unknown>
    expect(passed.brush).toBeDefined()
    expect((passed.toolbox as { feature: { brush?: unknown } }).feature.brush).toBeDefined()
  })

  it('loading 委托：true→showLoading / false→hideLoading', async () => {
    const wrapper = mountChart({ loading: false })
    await wrapper.setProps({ loading: true })
    expect(chartSpies.showLoading).toHaveBeenCalled()
    await wrapper.setProps({ loading: false })
    expect(chartSpies.hideLoading).toHaveBeenCalled()
  })

  it('pngExport 点击 → getDataURL(pixelRatio:2) + a 下载 .png', async () => {
    // 只 mock 'a' tag——全量 mock createElement 会让 Vue 内部建 DOM 节点崩
    const realCreateElement = document.createElement.bind(document)
    const clickSpy = vi.fn()
    const anchor = { click: clickSpy, href: '', download: '' } as any
    const createElSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => (tag === 'a' ? anchor : realCreateElement(tag as any) as any))
    const wrapper = mountChart({ pngExport: true, title: 'demo' })
    await wrapper.find('.chart-card__pngbtn').trigger('click')
    expect(chartSpies._getDataURL).toHaveBeenCalledTimes(1)
    expect(chartSpies._getDataURL.mock.calls[0][0]).toMatchObject({ pixelRatio: 2, type: 'png' })
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(anchor.download).toBe('demo.png')
    createElSpy.mockRestore()
  })

  it('freshness stale → stale 红点 + title「已过期」', () => {
    const wrapper = mountChart({ updatedAt: '2020-01-01', stale: true })
    expect(wrapper.find('.chart-card__dot').classes()).toContain('chart-card__dot--stale')
    expect(wrapper.find('.chart-card__updated').attributes('title')).toContain('已过期')
  })
})
