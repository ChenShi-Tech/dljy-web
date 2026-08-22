// @vitest-environment happy-dom
//
// 单日视图下真值与预测的数据组装（#2389）。
//
// 为什么必须是组件测试：这层逻辑的产物是喂给 ECharts 的 series 数组，错了不会报错，
// 只会画出一条位置不对的线——该断开的地方连成一片、或该保留的预测被整段裁掉。
// 看图能发现，但没有任何自动信号，所以在这里把 setOption 拦下来直接断言数据本身。
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
const CLEARED = 40      // 已出清的时段数（约到 10:00）
const seq = (base: number) => Array.from({ length: N }, (_, i) => base + i)
/** 部分出清日的真值：前 CLEARED 个时段有值，其余尚未发生。 */
const partialActual = (base: number): (number | null)[] =>
  Array.from({ length: N }, (_, i) => (i < CLEARED ? base + i : null))

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

describe('横轴恒为目标日一天', () => {
  it('无论有无真值，横轴都是 96 点——不把前一天铺进来占掉半屏', async () => {
    for (const over of [{}, { actual: seq(300), evaluationMode: 'backtest' as const },
      { evaluationMode: 'forecast' as const }]) {
      const opt = await render({ results: [{ provider: 'LightGBM', result: result(over) }] })
      expect(opt.xAxis.data).toHaveLength(N)
      expect(seriesNamed(opt, 'LightGBM').data).toHaveLength(N)
    }
  })

  it('预测线不发生任何位移——偏移一格整条线的时段归属就全错了', async () => {
    const opt = await render({
      results: [{ provider: 'LightGBM', result: result({ actual: seq(300) }) }],
    })
    expect(seriesNamed(opt, 'LightGBM').data).toEqual(seq(1000))
  })
})

describe('部分出清日：实线只覆盖已发生的时段', () => {
  it('真值原样透传，未出清的时段留 null 让实线自然断开', async () => {
    const actual = partialActual(300)
    const opt = await render({
      results: [{ provider: 'LightGBM', result: result({ actual, evaluationMode: 'partial' }) }],
    })
    const line = seriesNamed(opt, '实际值')
    expect(line.data).toEqual(actual)
    expect(line.data.slice(CLEARED).every((v) => v === null)).toBe(true)
  })

  it('开启「实际值替代」只裁掉已出清的那段，未出清的预测必须留下', async () => {
    const actual = partialActual(300)
    const opt = await render({
      results: [{ provider: 'LightGBM', result: result({ actual, evaluationMode: 'partial' }) }],
      mergeActual: true,
    })
    const pred = seriesNamed(opt, 'LightGBM').data
    expect(pred.slice(0, CLEARED).every((v) => v === null)).toBe(true)
    // 这条是整个 AEMO 形态的关键：按「数组有长度」判有真值会把未出清的时段一起裁掉，
    // 图上就只剩半天实线、右半边空白——恰好抹掉使用者唯一想看的那部分。
    expect(pred.slice(CLEARED)).toEqual(seq(1000).slice(CLEARED))
  })
})

describe('实际值替代该时段预测', () => {
  it('全出清日开启后预测被整条裁掉（断开而非插值衔接）', async () => {
    const actual = seq(300)
    const opt = await render({
      results: [{ provider: 'LightGBM', result: result({ actual, evaluationMode: 'backtest' }) }],
      mergeActual: true,
    })
    expect(seriesNamed(opt, 'LightGBM').data.every((v) => v === null)).toBe(true)
    expect(seriesNamed(opt, '实际值').data).toEqual(actual)
  })

  it('关闭时两条线各画各的——建模工作台正是靠这个看模型贴不贴', async () => {
    const opt = await render({
      results: [{ provider: 'LightGBM', result: result({ actual: seq(300), evaluationMode: 'backtest' }) }],
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

describe('切换开关必须重渲染', () => {
  it('勾选「实际值替代」后图立即更新——每次新 mount 的测试抓不到这条', async () => {
    setOption.mockClear()
    const props = {
      results: [{ provider: 'LightGBM', result: result({ actual: seq(300), evaluationMode: 'backtest' }) }],
      mergeActual: false,
    }
    const wrapper = mount(UnifiedForecastChart, { props: props as never })
    await nextTick()
    const before = setOption.mock.calls.length

    await wrapper.setProps({ mergeActual: true })
    await nextTick()
    await nextTick()      // render 走 nextTick，需多等一拍

    expect(setOption.mock.calls.length).toBeGreaterThan(before)
    const opt = setOption.mock.calls[setOption.mock.calls.length - 1][0] as ChartOption
    expect(seriesNamed(opt, 'LightGBM').data.every((v) => v === null)).toBe(true)
  })
})

describe('线型区分事实与预测', () => {
  it('未来日的预测线是虚线，实际值是实线', async () => {
    const opt = await render({
      results: [{ provider: 'LightGBM', result: result({ evaluationMode: 'forecast' }) }],
    })
    expect(seriesNamed(opt, 'LightGBM').lineStyle?.type).toBe('dashed')
  })

  it('有真值时实际值线不带虚线线型', async () => {
    const opt = await render({
      results: [{ provider: 'LightGBM', result: result({ actual: seq(300), evaluationMode: 'backtest' }) }],
    })
    expect(seriesNamed(opt, '实际值').lineStyle?.type).toBeUndefined()
  })
})
