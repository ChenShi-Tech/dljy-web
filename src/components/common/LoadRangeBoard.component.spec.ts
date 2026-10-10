// @vitest-environment happy-dom
// 逐日系统负荷·单源版面（dljy#3384）：指标行数字、主图区间带与日均线、峰谷差副图、数据时间取最后有数日。
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ActualLoadSourceViewModel } from '@/services/data/contracts'

type ChartOpt = {
  xAxis: { data: string[] }
  series: Array<Record<string, unknown>>
  tooltip: { formatter: (params: Array<{ dataIndex: number }>) => string }
}
type CardProps = { title: string; buildOption: () => ChartOpt; updatedAt?: string | null; empty?: boolean; group?: string }
const cards: CardProps[] = []
vi.mock('./ChartCard.vue', () => ({
  default: {
    name: 'ChartCard',
    props: ['title', 'height', 'buildOption', 'group', 'updatedAt', 'empty', 'pngExport', 'fullscreen'],
    setup(props: CardProps) { cards.push(props); return {} },
    template: '<div class="stub-card" :data-title="title" />'
  }
}))
import LoadRangeBoard from './LoadRangeBoard.vue'

function source(): ActualLoadSourceViewModel {
  return {
    key: 'system',
    label: '系统负荷实际值',
    nameList: ['8月16日', '8月17日', '8月18日'],
    years: ['2026年'],
    metrics: {
      average: [[30000, null, 31000]],
      min: [[25000, null, 26000]],
      max: [[34000, null, 35500]]
    }
  }
}

function mountBoard() {
  cards.length = 0
  return mount(LoadRangeBoard, {
    props: { source: source() },
    global: { stubs: { 'el-tooltip': { template: '<span><slot /></span>' } } }
  })
}

describe('LoadRangeBoard', () => {
  it('指标行：最近日均、区间最高/最低、覆盖天数（含缺口）', () => {
    const text = mountBoard().text()
    expect(text).toContain('最近日均负荷')
    expect(text).toContain('31,000')
    expect(text).toContain('2026-08-18')
    expect(text).toContain('35,500')
    expect(text).toContain('25,000')
    expect(text).toContain('2026-08-16 ~ 2026-08-18，其间缺 1 天')
  })

  it('主图：最小作底 + 峰谷差填充成区间带，日均值折线；缺数日为 null 不插值；数据时间取最后有数日', () => {
    mountBoard()
    const main = cards.find((c) => c.title.includes('日均值与日内区间'))!
    expect(main.updatedAt).toBe('2026-08-18T23:45:00+08:00')
    expect(main.empty).toBe(false)
    const opt = main.buildOption()
    expect(opt.xAxis.data).toEqual(['2026-08-16', '2026-08-17', '2026-08-18'])
    const [base, band, avg] = opt.series
    expect(base.stack).toBe('range')
    expect(base.data).toEqual([25000, null, 26000])
    expect(band.stack).toBe('range')
    expect(band.areaStyle).toBeTruthy()
    expect(band.data).toEqual([9000, null, 9500])
    expect(avg.data).toEqual([30000, null, 31000])
    expect(avg.smooth).toBe(false)
    expect(opt.tooltip.formatter([{ dataIndex: 1 }])).toContain('无数据')
  })

  it('副图：日内峰谷差柱图，与主图同组联动', () => {
    mountBoard()
    const spread = cards.find((c) => c.title.includes('峰谷差'))!
    const main = cards.find((c) => c.title.includes('日均值与日内区间'))!
    expect(spread.group).toBe(main.group)
    expect(spread.buildOption().series[0]).toMatchObject({ type: 'bar', data: [9000, null, 9500] })
  })
})
