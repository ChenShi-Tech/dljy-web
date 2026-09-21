// Price3DScene.component.spec.ts — 多日三维场景的资源纪律与交互（dljy#3007 任务 6.9）
// 守什么不变量：
//   ① echarts-gl 动态加载全模块只发生一次（模块级缓存，多实例/重建不重复加载）；
//   ② setOption 语义：每段一条 line3D、z 轴不设 min（负价原样）、不自动旋转、
//      日前/实时共用系列名（图例一键开关同阶段）；
//   ③ 点击数据点 → pointClick（date/timeOfDay 语义身份，不是下标）；
//   ④ 初始化抛错 → emit initError（父级降级热力），本组件不自行降级；
//   ⑤ 卸载 dispose 实例（释放 WebGL 上下文）；重置视角走 setOption。
// mock 边界：echarts（假实例，捕获 on/setOption/dispose）、echarts-gl（空模块 + 加载计数）。
// 说明：echarts-gl 动态加载失败的 reject 路径与初始化抛错路径汇入同一个 emit('initError')，
// vi.mock 工厂只执行一次无法在同一文件内切换成功/失败，这里只覆盖初始化抛错路径。
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Price3DScene from './Price3DScene.vue'
import type { PriceLine3D } from './priceProfileModel'

// ── 可控 mock 状态 ───────────────────────────────────────────────────────────────────────

type FakeChart = {
  el: unknown
  on: ReturnType<typeof vi.fn>
  setOption: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  isDisposed: () => boolean
}

const chartState = vi.hoisted(() => ({
  instances: [] as Array<{ setOption: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
  clickHandlers: [] as Array<(params: unknown) => void>,
}))

const glState = vi.hoisted(() => ({ loads: 0 }))

vi.mock('echarts', () => ({
  init: vi.fn((el: unknown) => {
    let disposed = false
    const instance: FakeChart = {
      el,
      on: vi.fn((event: string, cb: (params: unknown) => void) => {
        if (event === 'click') chartState.clickHandlers.push(cb)
      }),
      setOption: vi.fn(),
      dispose: vi.fn(() => {
        disposed = true
      }),
      resize: vi.fn(),
      isDisposed: () => disposed,
    }
    chartState.instances.push(instance)
    return instance
  }),
}))

vi.mock('echarts-gl', () => {
  glState.loads += 1
  return {}
})

// ── 夹具与挂载 ───────────────────────────────────────────────────────────────────────────

const TIME_POINTS = ['00:00', '00:15', '00:30']
const DATES = ['2026-09-10', '2026-09-11']

function makeLines(): PriceLine3D[] {
  return [
    {
      phase: 'day-ahead',
      date: '2026-09-10',
      // 缺测拆成两段（00:30 缺）
      segments: [
        [
          [0, 0, 210.5],
          [1, 0, 220],
        ],
        [[2, 0, 200]],
      ],
      color: '#2563eb',
    },
    {
      phase: 'real-time',
      date: '2026-09-10',
      segments: [
        [
          [0, 0, 205.25],
          [1, 0, -12.5],
          [2, 0, 145],
        ],
      ],
      color: '#f97316',
    },
  ]
}

// 同文件曾实测 vi.mock 模块会偶发破坏 '@/test/mount' 静态导入链（命名空间为空），
// 统一用动态 import 获取挂载助手（与 Price3DWorkspace.component.spec.ts 同款）。
async function mountScene(lines: PriceLine3D[] = makeLines()): Promise<VueWrapper<any>> {
  const { mount } = await import('@/test/mount')
  return mount(Price3DScene, {
    props: { lines, timePoints: TIME_POINTS, dates: DATES },
  })
}

function firstOption(instance: { setOption: ReturnType<typeof vi.fn> }): Record<string, any> {
  return instance.setOption.mock.calls[0]![0] as Record<string, any>
}

beforeEach(() => {
  chartState.instances.length = 0
  chartState.clickHandlers.length = 0
})

// ── 用例 ─────────────────────────────────────────────────────────────────────────────────

describe('Price3DScene', () => {
  it('挂载即初始化 echarts 并 setOption：每段一条 line3D，z 轴不设 min（负价原样），不自动旋转', async () => {
    await mountScene()
    await flushPromises()
    expect(chartState.instances).toHaveLength(1)
    const option = firstOption(chartState.instances[0]!)
    const series = option.series as Array<Record<string, unknown>>
    expect(series).toHaveLength(3) // 日前两段 + 实时一段
    expect(series.every((s) => s.type === 'line3D')).toBe(true)
    // 同阶段共用系列名：图例一键开关「日前/实时」
    expect(new Set(series.map((s) => s.name))).toEqual(new Set(['日前', '实时']))
    // z 轴不设 min：旧价格分析页 zAxis3D.min=0 会削平负价，不沿用
    expect(option.zAxis3D.min).toBeUndefined()
    expect(option.grid3D.viewControl.autoRotate).toBe(false)
    expect(option.xAxis3D.data).toEqual(TIME_POINTS)
    expect(option.yAxis3D.data).toEqual(DATES)
  })

  it('echarts-gl 全模块只加载一次：第二个场景实例不重复加载', async () => {
    const first = await mountScene()
    await flushPromises()
    expect(glState.loads).toBe(1)
    const second = await mountScene()
    await flushPromises()
    // 两个实例各自 init，但 echarts-gl 仍只加载一次（模块级缓存）
    expect(chartState.instances).toHaveLength(2)
    expect(glState.loads).toBe(1)
    first.unmount()
    second.unmount()
  })

  it('点击数据点 → emit pointClick（业务日 + 时点语义身份）', async () => {
    const wrapper = await mountScene()
    await flushPromises()
    expect(chartState.clickHandlers.length).toBeGreaterThan(0)
    chartState.clickHandlers.at(-1)!({ value: [2, 1, 300] })
    expect(wrapper.emitted('pointClick')).toEqual([[{ date: '2026-09-11', timeOfDay: '00:30' }]])
    wrapper.unmount()
  })

  it('初始化抛错（如创建 WebGL 上下文失败）→ emit initError，父级据此降级热力', async () => {
    const { init } = await import('echarts')
    vi.mocked(init).mockImplementationOnce(() => {
      throw new Error('webgl context creation failed')
    })
    const wrapper = await mountScene()
    await flushPromises()
    const errors = wrapper.emitted('initError')
    expect(errors).toBeTruthy()
    expect(errors![0]![0]).toContain('三维初始化失败')
    wrapper.unmount()
  })

  it('卸载 → dispose 实例（释放 WebGL 上下文）', async () => {
    const wrapper = await mountScene()
    await flushPromises()
    const instance = chartState.instances[0]!
    expect(instance.dispose).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(instance.dispose).toHaveBeenCalled()
  })

  it('重置视角（expose）→ setOption 回默认 viewControl；props 变化重设 option', async () => {
    const wrapper = await mountScene()
    await flushPromises()
    const instance = chartState.instances[0]!
    instance.setOption.mockClear()
    ;(wrapper.vm as unknown as { resetView: () => void }).resetView()
    expect(instance.setOption).toHaveBeenCalledTimes(1)
    const resetOption = instance.setOption.mock.calls[0]![0] as Record<string, any>
    expect(resetOption.grid3D.viewControl).toEqual({ alpha: 18, beta: 30, distance: 180, autoRotate: false })

    instance.setOption.mockClear()
    await wrapper.setProps({ lines: makeLines().filter((line) => line.phase === 'real-time') })
    expect(instance.setOption).toHaveBeenCalledTimes(1)
    const next = instance.setOption.mock.calls[0]![0] as Record<string, any>
    expect((next.series as Array<Record<string, unknown>>)).toHaveLength(1)
    wrapper.unmount()
  })
})
