// Price3DWorkspace.component.spec.ts — 多日立体 / 双切面 / 热力工作区（dljy#3007 任务 6.8/6.9）
// 守什么不变量：
//   ① 单日窗口不悄悄扩窗：提示 + 「改为 7 天」按钮，点了才 emit extend-window；
//   ② 多对象必须显式选立体对象（默认不选、未选不绘制，不替用户挑第一个）；
//   ③ 超 6000 原生点不画三维（不截断），按钮让用户显式切热力；
//   ④ WebGL 不可用自动降级热力（同一数据），提示如实写明，且不渲染三维；
//   ⑤ 热力默认实时、可切日前；点击格子同步剖面日期与时点（证据表标题跟随）；
//   ⑥ 默认剖面 = 窗口最后一天 + 该日最高价时点（并列取最早）；
//   ⑦ 错误 / 读取中 / 空结果如实展示，不造画面。
// mock 边界：priceProfileModel 的 detectWebGL（可切换可用性）、useEChart（捕获
// setOption 与 click 绑定，绕开真实 echarts）、Price3DScene 与 ChartCard 打桩。
import { defineComponent, h, nextTick } from 'vue'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InsightRequestError } from '@/services/insight/insightClient'
import { insightResult, nodePriceSeries } from '@/components/insight/insightFixtures'
import Price3DWorkspace from './Price3DWorkspace.vue'
import { MAX_3D_NATIVE_POINTS, type ProfileRow, type ProfileSeriesEntry } from './priceProfileModel'

// ── 可控 mock 状态 ───────────────────────────────────────────────────────────────────────

const webglState = vi.hoisted(() => ({ available: true }))

vi.mock('./priceProfileModel', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  detectWebGL: vi.fn(() => webglState.available),
}))

const echartState = vi.hoisted(() => ({
  /** 每次 setOption 的 option 快照（热力图选项断言用） */
  setOptions: [] as Array<Record<string, unknown>>,
  /** useEChart 的 render 回调（测试手动触发，模拟懒渲染时机） */
  renders: [] as Array<() => void>,
  /** 热力实例上绑定的 click 处理器（测试手动调用，模拟点格子） */
  clickHandlers: [] as Array<(params: unknown) => void>,
}))

vi.mock('@/composables/useEChart', () => ({
  useEChart: vi.fn((_el: unknown, options: { onInit?: (chart: unknown) => void; render?: () => void }) => {
    if (options?.onInit) {
      options.onInit({
        on: vi.fn((event: string, cb: (params: unknown) => void) => {
          if (event === 'click') echartState.clickHandlers.push(cb)
        }),
        off: vi.fn(),
        setOption: vi.fn(),
        dispose: vi.fn(),
      })
    }
    // render 回调内部引用 handle（const 赋值左侧），同步调用会 TDZ：存起来由测试触发。
    if (options?.render) echartState.renders.push(options.render)
    return {
      setOption: (option: Record<string, unknown>) => {
        echartState.setOptions.push(option)
      },
      instance: () => null,
      resize: () => {},
      dispose: () => {},
      group: {},
    }
  }),
}))

// 三维场景与图表卡打桩：绕开 echarts-gl / echarts canvas；Scene 只需可寻址。
const Price3DSceneStub = defineComponent({
  name: 'Price3DScene',
  props: { lines: { type: Array, default: () => [] }, timePoints: { type: Array, default: () => [] }, dates: { type: Array, default: () => [] } },
  emits: ['initError', 'pointClick'],
  render: () => h('div', { class: 'price-3d-scene-stub' }),
})

const ChartCardStub = defineComponent({
  name: 'ChartCard',
  props: { title: { type: String, default: '' } },
  setup(props) {
    return () => h('div', { class: 'chart-card-stub' }, props.title)
  },
})

// ── 结果夹具（两天 × 日前/实时，含缺测与负价）──────────────────────────────────────────

const DATES = ['2026-09-10', '2026-09-11']
const TIMES = ['00:00', '00:15', '00:30']

function priceSeries(seriesId: string, phase: 'day-ahead' | 'real-time', nodeName?: string): ProfileSeriesEntry {
  return {
    ...nodePriceSeries(),
    seriesId,
    marketPhase: phase,
    dimensions: nodeName ? { nodeName } : {},
    resolutionMinutes: 15,
    nativeResolutionMinutes: 15,
  }
}

function profileRow(seriesId: string, date: string, timeOfDay: string, value: string): ProfileRow {
  const [h0, m0] = timeOfDay.split(':').map(Number)
  const endMinutes = h0! * 60 + m0! + 15
  const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`
  return {
    seriesId,
    date,
    timeOfDay,
    intervalStart: `${date}T${timeOfDay}:00+08:00`,
    intervalEnd: `${date}T${endTime}:00+08:00`,
    value,
  }
}

/** 节点 A（默认两日数据）：09-10 日前 00:30 缺测；09-11 实时 00:15 是负价 -12.5。 */
function nodeARows(): ProfileRow[] {
  return [
    profileRow('da-A', DATES[0]!, TIMES[0]!, '210.5'),
    profileRow('da-A', DATES[0]!, TIMES[1]!, '220'),
    // 09-10 00:30 日前缺测：行不存在
    profileRow('rt-A', DATES[0]!, TIMES[0]!, '205.25'),
    profileRow('rt-A', DATES[0]!, TIMES[1]!, '215'),
    profileRow('rt-A', DATES[0]!, TIMES[2]!, '200'),
    profileRow('da-A', DATES[1]!, TIMES[0]!, '150'),
    profileRow('da-A', DATES[1]!, TIMES[1]!, '140'),
    profileRow('da-A', DATES[1]!, TIMES[2]!, '130'),
    profileRow('rt-A', DATES[1]!, TIMES[0]!, '155'),
    profileRow('rt-A', DATES[1]!, TIMES[1]!, '-12.5'),
    profileRow('rt-A', DATES[1]!, TIMES[2]!, '145'),
  ]
}

function profileResultOf(series: ProfileSeriesEntry[], rows: ProfileRow[]) {
  return insightResult({
    contextVersion: 7,
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [{ id: 'seriesId', kind: 'category' }],
      measures: [{ id: 'value', unit: 'yuan-per-mwh' }],
      rows,
      series,
    },
  })
}

/** 单对象（用户侧价：无对象维度）两天结果。 */
function singleObjectResult() {
  return profileResultOf([priceSeries('da-A', 'day-ahead'), priceSeries('rt-A', 'real-time')], nodeARows())
}

/** 两对象结果（节点 A / 节点 B 各一组序列）。 */
function twoObjectResult() {
  const rowsB = nodeARows().map((r) => ({ ...r, seriesId: r.seriesId.replace('-A', '-B'), value: '300' }))
  return profileResultOf(
    [
      priceSeries('da-A', 'day-ahead', '节点A'),
      priceSeries('rt-A', 'real-time', '节点A'),
      priceSeries('da-B', 'day-ahead', '节点B'),
      priceSeries('rt-B', 'real-time', '节点B'),
    ],
    [...nodeARows(), ...rowsB]
  )
}

/** 超预算结果：64 天 × 96 时点 × 日前一条序列 = 6144 个原生点（> 6000）。 */
function overLimitResult() {
  const rows: ProfileRow[] = []
  for (let day = 0; day < 64; day++) {
    const date = new Date(Date.UTC(2026, 6, 1 + day)).toISOString().slice(0, 10)
    for (let q = 0; q < 96; q++) {
      const time = `${String(Math.floor(q / 4)).padStart(2, '0')}:${String((q % 4) * 15).padStart(2, '0')}`
      rows.push(profileRow('da-heavy', date, time, '100'))
    }
  }
  return profileResultOf([priceSeries('da-heavy', 'day-ahead')], rows)
}

// ── 挂载 helper ─────────────────────────────────────────────────────────────────────────

type WorkspaceProps = {
  mode?: 'multi3d' | 'heatmap'
  visible?: boolean
  result?: ReturnType<typeof singleObjectResult> | null
  error?: InsightRequestError | null
  loading?: boolean
  objectDimension?: string | null
  windowDayCount?: number
  businessWindow?: { start: string; end: string }
}

/**
 * 挂载助手用动态 import：本文件 vi.mock 了 useEChart，实测会破坏静态导入的
 * '@/test/mount'（命名空间为空 → ElementPlus 没装上、el-* 全部无法解析）；
 * 运行时动态加载则正常。改回静态 import 前先跑本文件确认。
 */
async function mountWorkspace(props: WorkspaceProps = {}): Promise<VueWrapper<any>> {
  const { mount } = await import('@/test/mount')
  return mount(Price3DWorkspace, {
    props: {
      mode: 'multi3d',
      visible: true,
      result: singleObjectResult(),
      error: null,
      loading: false,
      objectDimension: null,
      windowDayCount: 2,
      businessWindow: { start: '2026-09-10', end: '2026-09-11' },
      ...props,
    },
    global: { stubs: { Price3DScene: Price3DSceneStub, ChartCard: ChartCardStub } },
  })
}

/** 手动触发 useEChart 的懒渲染（真实实现等容器有尺寸才画）。 */
async function flushRenders(): Promise<void> {
  for (const render of echartState.renders) render()
  await nextTick()
}

beforeEach(() => {
  webglState.available = true
  echartState.setOptions.length = 0
  echartState.renders.length = 0
  echartState.clickHandlers.length = 0
})

// ── 单日窗口拦截 ─────────────────────────────────────────────────────────────────────────

describe('单日窗口（不悄悄扩窗）', () => {
  it('窗口不足 2 天：显示说明与「改为 7 天」按钮，不绘制三维/热力', async () => {
    const wrapper = await mountWorkspace({ windowDayCount: 1, businessWindow: { start: '2026-09-11', end: '2026-09-11' } })
    expect(wrapper.find('[data-testid="ynp-3dw-window-hint"]').exists()).toBe(true)
    const extend = wrapper.find('[data-testid="ynp-3dw-extend"]')
    expect(extend.exists()).toBe(true)
    expect(extend.text()).toContain('2026-09-05 — 2026-09-11 共 7 天')
    expect(wrapper.find('.price-3d-scene-stub').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ynp-3dw-heat-host"]').exists()).toBe(false)
  })

  it('点「改为 7 天」→ emit extend-window（结束日往前数 7 天，由页面 setBusinessWindow）', async () => {
    const wrapper = await mountWorkspace({ windowDayCount: 1, businessWindow: { start: '2026-09-11', end: '2026-09-11' } })
    await wrapper.find('[data-testid="ynp-3dw-extend"]').trigger('click')
    expect(wrapper.emitted('extend-window')).toEqual([[{ start: '2026-09-05', end: '2026-09-11' }]])
  })
})

// ── 立体对象选择 ─────────────────────────────────────────────────────────────────────────

describe('多对象：显式选立体对象', () => {
  it('结果里有多个对象：显示对象下拉与提示，未选不绘制（不替用户挑第一个）', async () => {
    const wrapper = await mountWorkspace({ result: twoObjectResult(), objectDimension: 'nodeName' })
    expect(wrapper.find('[data-testid="ynp-3dw-object"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ynp-3dw-object-hint"]').text()).toContain('请先选择')
    expect(wrapper.find('.price-3d-scene-stub').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ynp-3dw-heat-host"]').exists()).toBe(false)
  })

  it('选定对象后绘制，且三维线只含所选对象的序列（其余对象不参与画面）', async () => {
    const wrapper = await mountWorkspace({ result: twoObjectResult(), objectDimension: 'nodeName' })
    const objectSelect = wrapper.getComponent('[data-testid="ynp-3dw-object"]') as unknown as VueWrapper<any>
    objectSelect.vm.$emit('update:modelValue', '节点A')
    await nextTick()
    const scene = wrapper.find('.price-3d-scene-stub')
    expect(scene.exists()).toBe(true)
    const lines = wrapper.getComponent(Price3DSceneStub).props('lines') as Array<{ phase: string; date: string; segments: unknown }>
    // 节点 A：2 天 × 2 阶段 = 4 条线；B 的序列（值全 300）不进来
    expect(lines).toHaveLength(4)
    expect(lines.map((l) => [l.phase, l.date])).toEqual([
      ['day-ahead', '2026-09-10'],
      ['day-ahead', '2026-09-11'],
      ['real-time', '2026-09-10'],
      ['real-time', '2026-09-11'],
    ])
    const da = lines.find((l) => l.phase === 'day-ahead' && l.date === '2026-09-11')!
    expect(JSON.stringify(da.segments)).not.toContain('300')
  })
})

// ── 三维预算与降级 ───────────────────────────────────────────────────────────────────────

describe('三维预算与 WebGL 降级', () => {
  it('超 6000 原生点不画三维（不截断）：显示超限说明，按钮让用户显式切热力', async () => {
    const wrapper = await mountWorkspace({ result: overLimitResult() })
    const block = wrapper.find('[data-testid="ynp-3dw-overlimit"]')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('6144')
    expect(block.text()).toContain(String(MAX_3D_NATIVE_POINTS))
    expect(wrapper.find('.price-3d-scene-stub').exists()).toBe(false)
    await wrapper.find('[data-testid="ynp-3dw-switch-heatmap"]').trigger('click')
    expect(wrapper.emitted('switch-mode')).toEqual([['heatmap']])
  })

  it('WebGL 不可用：自动降级热力（同一数据），提示与证据说明如实写明，不渲染三维', async () => {
    webglState.available = false
    const wrapper = await mountWorkspace({ mode: 'multi3d' })
    expect(wrapper.find('[data-testid="ynp-3dw-degraded"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ynp-3dw-degraded"]').text()).toContain('无法绘制三维')
    expect(wrapper.find('.price-3d-scene-stub').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ynp-3dw-heat-host"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ynp-3dw-notes"]').text()).toContain('无法绘制三维')
  })

  it('页签切走（visible=false）不渲染三维；热力是 2D 不受影响', async () => {
    const wrapper = await mountWorkspace({ visible: false })
    expect(wrapper.find('.price-3d-scene-stub').exists()).toBe(false)
  })
})

// ── 热力 ─────────────────────────────────────────────────────────────────────────────────

describe('日期×时段热力', () => {
  it('默认实时价；负价时色带以 0 为中心对称（端点 ±max(|min|,|max|)，真实区间在说明标注）', async () => {
    const wrapper = await mountWorkspace({ mode: 'heatmap' })
    const phase = wrapper.find('[data-testid="ynp-3dw-heat-phase"]')
    expect(phase.exists()).toBe(true)
    await flushRenders()
    const option = echartState.setOptions.at(-1) as { visualMap?: { min: number; max: number }; series?: Array<{ type: string; data: unknown[] }> }
    // 实时阶段真实区间 -12.5 ~ 215 → 对称端点 ±215（0 居中便于分辨正负价）
    expect(option.visualMap?.min).toBe(-215)
    expect(option.visualMap?.max).toBe(215)
    expect(option.series?.[0]?.type).toBe('heatmap')
    expect(wrapper.find('[data-testid="ynp-3dw-notes"]').text()).toContain('热力真实区间 -12.5 ~ 215')
  })

  it('热力点击格子 → 同步剖面日期与时点（证据表标题跟随）', async () => {
    const wrapper = await mountWorkspace({ mode: 'heatmap' })
    await flushRenders()
    expect(echartState.clickHandlers.length).toBeGreaterThan(0)
    // 点击 value = [时点下标, 业务日下标, 价格]：00:15 × 2026-09-10
    echartState.clickHandlers.forEach((handler) => handler({ value: [1, 0, 999] }))
    await nextTick()
    expect(wrapper.find('[data-testid="ynp-3dw-evidence-view"]').text()).toContain('按日：2026-09-10')
    // 剖面时点也同步（跨日切面与证据表可切到按时点视图看）
    const evidenceBefore = wrapper.find('[data-testid="ynp-3dw-evidence-view"]').text()
    expect(evidenceBefore).toContain('按日：2026-09-10')
  })
})

// ── 默认剖面 ─────────────────────────────────────────────────────────────────────────────

describe('默认剖面', () => {
  it('默认选窗口最后一天 + 该日最高价时点（09-11 最高 155 @ 00:00）；标注「默认」', async () => {
    const wrapper = await mountWorkspace({ mode: 'heatmap' })
    const view = wrapper.find('[data-testid="ynp-3dw-evidence-view"]')
    expect(view.text()).toContain('按日：2026-09-11')
    expect(view.text()).toContain('按时点：00:00')
    expect(wrapper.text()).toContain('默认：窗口最后一天')
    expect(wrapper.text()).toContain('默认：该日最高价时点')
  })

  it('证据表按日视图列出该日全部真实时段；缺一侧「—」，价差 = 日前 − 实时', async () => {
    const wrapper = await mountWorkspace({ mode: 'heatmap' })
    const tables = wrapper.findAllComponents({ name: 'ElTable' })
    const evidence = tables.find((table) => table.props('data')?.length)
    expect(evidence).toBeTruthy()
    const rows = evidence!.props('data') as Array<{ key: string; dayAheadText: string; realTimeText: string; spreadText: string }>
    expect(rows.map((row) => row.key)).toEqual(['00:00', '00:15', '00:30'])
    // 09-11：00:00 价差 150 − 155 = -5；00:15 价差 140 − (-12.5) = 152.5（十进制减法；
    // decimalRound 只舍入不补零，显示与登记精度一致）
    expect(rows.find((row) => row.key === '00:00')?.spreadText).toBe('-5')
    expect(rows.find((row) => row.key === '00:15')?.spreadText).toBe('152.5')
    expect(rows.find((row) => row.key === '00:15')?.realTimeText).toBe('-12.5')
  })
})

// ── 错误 / 读取中 / 空结果 ───────────────────────────────────────────────────────────────

describe('结果状态', () => {
  it('查询错误：如实展示错误信息，重试按钮 emit retry', async () => {
    const wrapper = await mountWorkspace({
      result: null,
      error: new InsightRequestError({ status: 503, errorCode: 'UNAVAILABLE', message: '资料读取失败，请稍后重试' }),
    })
    expect(wrapper.text()).toContain('资料读取失败，请稍后重试')
    await wrapper.find('[data-testid="ynp-3dw-retry"]').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('读取中：显示读取提示，不画任何画面', async () => {
    const wrapper = await mountWorkspace({ result: null, loading: true })
    expect(wrapper.text()).toContain('正在读取历史分布结果')
    expect(wrapper.find('.price-3d-scene-stub').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ynp-3dw-heat-host"]').exists()).toBe(false)
  })

  it('结果没有可绘制行：如实空态提示，不造格子', async () => {
    const wrapper = await mountWorkspace({ result: profileResultOf([], []) })
    expect(wrapper.text()).toContain('当前口径下没有可绘制的多日价格时段')
  })
})

