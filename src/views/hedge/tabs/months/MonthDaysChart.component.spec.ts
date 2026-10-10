// 当月按日图表的 setOption 数据测试（HW-03/D8；openspec build-midlong-spot-hedging 任务 8.3，ChenShi-Tech/dljy#3421）。
//
// 守什么：实际/预测发电分段着色（各归各的 series）、未覆盖日两侧皆 null（无柱，不用 0 冒充）、
// 已分解锁价折线 null 断开（connectNulls:false）且不做平滑（smooth:false）。
// 坏掉的症状：图上未覆盖日画成 0 高度的柱、锁价线跨未知日连线、实际与预测混进同一条线。
// 这层错误不会报错，只会画出一张误导人的图，所以把 setOption 拦下来直接断言数据本身。
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { HedgeMonthView } from '@/services/hedge/hedgeMonthsApi'

const setOption = vi.fn()
vi.mock('@/composables/useEChart', () => ({
  useEChart: () => ({ setOption, resize: vi.fn(), instance: () => null }),
}))

import MonthDaysChart from './MonthDaysChart.vue'

type SeriesLike = { name?: string; data: Array<number | null>; stack?: string; smooth?: boolean; connectNulls?: boolean }

const days: HedgeMonthView['days'] = [
  { date: '2026-09-01', lockedDecomposedMwh: '100', generation: { value: '300', source: 'ACTUAL', uncoveredReason: null, unknownStationIds: [] } },
  { date: '2026-09-02', lockedDecomposedMwh: null, generation: { value: '310', source: 'FORECAST', uncoveredReason: null, unknownStationIds: [] } },
  { date: '2026-09-03', lockedDecomposedMwh: '110', generation: { value: null, source: 'UNCOVERED', uncoveredReason: 'FORECAST_NOT_ARRIVED', unknownStationIds: [] } },
  { date: '2026-09-04', lockedDecomposedMwh: '120', generation: { value: '320', source: 'ACTUAL', uncoveredReason: null, unknownStationIds: [] } },
]

async function render(props: { days: HedgeMonthView['days'] }) {
  setOption.mockClear()
  mount(MonthDaysChart, { props: props as never })
  await nextTick()
  expect(setOption).toHaveBeenCalled()
  const option = setOption.mock.calls[setOption.mock.calls.length - 1][0] as { series: SeriesLike[] }
  return option
}

const seriesNamed = (option: { series: SeriesLike[] }, name: string): SeriesLike => {
  const hit = option.series.find((s) => s.name === name)
  if (!hit) throw new Error(`series 未找到：${name}`)
  return hit
}

describe('MonthDaysChart（HW-03/D8）', () => {
  it('实际/预测各归各的 series：每天只有其来源一侧有值，未覆盖日两侧皆 null', async () => {
    const option = await render({ days })
    const actual = seriesNamed(option, '实际发电')
    const forecast = seriesNamed(option, '预测发电')
    expect(actual.data).toEqual([300, null, null, 320])
    expect(forecast.data).toEqual([null, 310, null, null])
    expect(actual.stack).toBe(forecast.stack) // 同 stack：两条柱共用同一位置，不会并排错位
  })

  it('已分解锁价：null 断开（connectNulls:false）且不做平滑（smooth:false）', async () => {
    const option = await render({ days })
    const locked = seriesNamed(option, '已分解锁价')
    expect(locked.data).toEqual([100, null, 110, 120])
    expect(locked.connectNulls).toBe(false)
    expect(locked.smooth).toBe(false)
  })

  it('全月无锁价（FORBIDDEN 或全未分解）时折线全 null：不画任何线段，也不冒充 0', async () => {
    const option = await render({
      days: days.map((day) => ({ ...day, lockedDecomposedMwh: null })),
    })
    expect(seriesNamed(option, '已分解锁价').data).toEqual([null, null, null, null])
  })
})
