// @vitest-environment happy-dom
//
// 连续视图与「实际值替代预测」的数据组装（#2387）。
//
// 为什么必须是组件测试：这层逻辑的产物是喂给 ECharts 的 series 数组，错了不会报错，
// 只会画出一条位置不对的线——横轴偏移半天、或该断开的地方连成一片。看图能发现，
// 但没有任何自动信号，所以在这里把 setOption 拦下来直接断言数据本身。
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const setOption = vi.fn()
vi.mock('@/composables/useEChart', () => ({
  useEChart: () => ({ setOption, resize: vi.fn(), instance: () => null }),
}))

import UnifiedForecastChart from './UnifiedForecastChart.vue'
import type { UnifiedForecastResult } from '@/services/forecast/forecastProviders'

const N = 96
const seq = (base: number) => Array.from({ length: N }, (_, i) => base + i)

function result(over: Partial<UnifiedForecastResult> = {}): UnifiedForecastResult {
  return {
    points: seq(1000), unit: '元/MWh', basis: 'captured', granularity: 96,
    modelId: 'lightgbm', metrics: {}, ...over,
  } as UnifiedForecastResult
}

async function render(props: Record<string, unknown>): Promise<ChartOption> {
  setOption.mockClear()
  mount(UnifiedForecastChart, { props: props as never })
  await nextTick()
  expect(setOption).toHaveBeenCalled()
  return setOption.mock.calls[setOption.mock.calls.length - 1][0] as ChartOption
}

type SeriesLike = { name?: unknown; data: (number | null)[]; lineStyle?: { type?: string } }
type ChartOption = { xAxis: { data: string[] }; series: SeriesLike[] }

const seriesNamed = (opt: ChartOption, name: string): SeriesLike => {
  const hit = opt.series.find((s) => String(s.name ?? '').startsWith(name))
  if (!hit) throw new Error(`series 未找到：${name}`)
  return hit
}

describe('连续视图（过去实线 → 未来虚线）', () => {
  it('未来日：横轴翻倍，历史落在前半段、预测落在后半段', async () => {
    const opt = await render({
      results: [{ provider: 'LightGBM', result: result({ history: seq(500), evaluationMode: 'forecast' }) }],
      continuous: true,
    })
    expect(opt.xAxis.data).toHaveLength(N * 2)
    const hist = seriesNamed(opt, '实际值')
    const pred = seriesNamed(opt, 'LightGBM')
    // 历史只占前半段，后半段留空——否则会被画成「未来也有实测」
    expect(hist.data.slice(0, N)).toEqual(seq(500))
    expect(hist.data.slice(N).every((v: unknown) => v === null)).toBe(true)
    // 预测只占后半段：前半段留空，否则预测线会整体左移半天
    expect(pred.data.slice(0, N).every((v: unknown) => v === null)).toBe(true)
    expect(pred.data.slice(N)).toEqual(seq(1000))
  })

  it('未来日的预测线必须是虚线——它不是事实，线型上要与实际值区分', async () => {
    const opt = await render({
      results: [{ provider: 'LightGBM', result: result({ history: seq(500), evaluationMode: 'forecast' }) }],
      continuous: true,
    })
    expect(seriesNamed(opt, 'LightGBM').lineStyle.type).toBe('dashed')
    expect(seriesNamed(opt, '实际值').lineStyle.type).toBeUndefined()
  })

  it('没有历史段时退回单日视图，不留半屏空白', async () => {
    const opt = await render({
      results: [{ provider: 'LightGBM', result: result() }],
      continuous: true,
    })
    expect(opt.xAxis.data).toHaveLength(N)
  })

  it('未开连续视图时横轴与数据都不偏移', async () => {
    const opt = await render({
      results: [{ provider: 'LightGBM', result: result({ history: seq(500) }) }],
    })
    expect(opt.xAxis.data).toHaveLength(N)
    expect(seriesNamed(opt, 'LightGBM').data).toEqual(seq(1000))
  })
})

describe('实际值替代该时段预测', () => {
  it('开启后有真值的时段预测被裁掉（断开而非插值衔接）', async () => {
    const actual = seq(300)
    const opt = await render({
      results: [{ provider: 'LightGBM', result: result({ actual, evaluationMode: 'backtest' }) }],
      mergeActual: true,
    })
    expect(seriesNamed(opt, 'LightGBM').data.every((v: unknown) => v === null)).toBe(true)
    expect(seriesNamed(opt, '实际值').data).toEqual(actual)
  })

  it('关闭时两条线各画各的——建模工作台正是靠这个看模型贴不贴', async () => {
    const actual = seq(300)
    const opt = await render({
      results: [{ provider: 'LightGBM', result: result({ actual, evaluationMode: 'backtest' }) }],
      mergeActual: false,
    })
    expect(seriesNamed(opt, 'LightGBM').data).toEqual(seq(1000))
  })

  it('无真值日开启替代也不裁——没有真值可替代，裁了就整条线消失', async () => {
    const opt = await render({
      results: [{ provider: 'LightGBM', result: result({ evaluationMode: 'forecast' }) }],
      mergeActual: true,
    })
    expect(seriesNamed(opt, 'LightGBM').data).toEqual(seq(1000))
  })
})
