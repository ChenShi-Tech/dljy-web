// useInsightSelection.spec.ts — 图表语义选区回归（dljy#2996 任务 5.8，design DE10）
// 守什么不变量：
//   ① 选区只含业务身份（对象 / 时段 / 来源 / 阶段 / 结果版本引用），任何位置键
//      （dataIndex/seriesIndex/pixel/x/y）都不得出现——下标会随数据更新漂移；
//   ② 事件先经 isSelectionCurrent 比对：地区 / 公司 / 代次 / 结果版本任一不同直接丢弃
//      （迟到事件、A→B→A 切换期间的旧事件）；
//   ③ 同一选区（规范化后相同）不重复上抛——图表↔表格联动的第二跳在这里被吞掉；
//   ④ 框选多点合并成连续时段（不是每格一段）；时段必须带时区（北京时间）；
//   ⑤ 无对象维度或中文对象名（契约对象标识只收 ASCII）不导致选区报废，时段仍承载选区。
// 坏掉的症状：点旧图上的点把新页面的选区改掉；联动死循环。
import { describe, expect, it } from 'vitest'
import { useInsightSelection, type InsightSelectionCurrent } from './useInsightSelection'
import { insightResult, loadSeries, nodePriceSeries, nodePriceResult, RESULT_VERSION } from '../insightFixtures'

const PRICE = nodePriceSeries()
const LOAD = loadSeries()

/** 与夹具 result 匹配的当前上下文（可变，模拟页面切换）。 */
function currentOf(overrides: Partial<InsightSelectionCurrent> = {}): InsightSelectionCurrent {
  return { regionId: 'yunnan', companyId: 'c1', contextVersion: 3, resultVersion: RESULT_VERSION, ...overrides }
}

function hit(series = PRICE, ts: number, end: string) {
  return { series, point: { ts, end } }
}

const TS_0000 = Date.parse('2026-09-10T00:00:00+08:00')
const TS_0015 = Date.parse('2026-09-10T00:15:00+08:00')
const TS_0030 = Date.parse('2026-09-10T00:30:00+08:00')

describe('语义身份', () => {
  it('单点选区携带对象、时段、来源、阶段与结果版本引用，且无任何位置键', () => {
    const current = currentOf()
    const { build } = useInsightSelection(() => current)

    const selection = build(nodePriceResult(['300']), [hit(PRICE, TS_0000, '2026-09-10T00:15:00+08:00')])

    expect(selection).not.toBeNull()
    expect(selection!.schemaVersion).toBe('insight-selection/v1')
    expect(selection!.resultRef).toMatchObject({ queryId: 'q-test-1', resultVersion: RESULT_VERSION })
    expect(selection!.regionId).toBe('yunnan')
    expect(selection!.objectRefs).toEqual([{ type: 'object', id: 'YN.KM.01' }])
    expect(selection!.sourceIds).toEqual(['yn.price.node.public.day-ahead'])
    expect(selection!.marketPhase).toBe('day-ahead')
    expect(selection!.priceObject).toBe('public-node')
    expect(selection!.contextVersion).toBe(3)

    // 位置键扫描：图形坐标与数组下标不是业务身份。
    const serialized = JSON.stringify(selection)
    for (const forbidden of ['dataIndex', 'seriesIndex', 'pixel', '"x"', '"y"', '"index"']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('时段带北京时间时区，且相邻格点合并为连续区间', () => {
    const current = currentOf()
    const { build } = useInsightSelection(() => current)

    const selection = build(nodePriceResult(['300', '301']), [
      hit(PRICE, TS_0000, '2026-09-10T00:15:00+08:00'),
      hit(PRICE, TS_0015, '2026-09-10T00:30:00+08:00'),
    ])

    expect(selection!.timeIntervals).toEqual([{ start: '2026-09-10T00:00:00+08:00', end: '2026-09-10T00:30:00+08:00' }])
  })

  it('不相邻的格点是两段时段，不硬并成一段', () => {
    const current = currentOf()
    const { build } = useInsightSelection(() => current)

    const selection = build(nodePriceResult(['300', null, '301']), [
      hit(PRICE, TS_0000, '2026-09-10T00:15:00+08:00'),
      hit(PRICE, TS_0030, '2026-09-10T00:45:00+08:00'),
    ])

    expect(selection!.timeIntervals).toHaveLength(2)
  })

  it('无对象维度的序列（统调负荷）：objectRefs 空，时段承载选区不报废', () => {
    const result = insightResult({
      sourceRefs: [{ sourceId: 'yn.system.load.actual', accessScope: 'public' }],
      data: {
        schemaVersion: 'insight-result-data/v1',
        dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'intervalStart', kind: 'time' }, { id: 'intervalEnd', kind: 'time' }],
        measures: [{ id: 'value', unit: 'by-series' }],
        rows: [{ seriesId: LOAD.seriesId, intervalStart: '2026-09-10T00:00:00+08:00', intervalEnd: '2026-09-10T00:15:00+08:00', value: '12000' }],
        series: [LOAD],
      },
    })
    const current = currentOf()
    const { build } = useInsightSelection(() => current)

    const selection = build(result, [hit(LOAD, TS_0000, '2026-09-10T00:15:00+08:00')])

    expect(selection).not.toBeNull()
    expect(selection!.objectRefs).toEqual([])
    expect(selection!.timeIntervals).toHaveLength(1)
  })

  it('中文对象名不是契约对象标识：不进 objectRefs，选区仍成立（时段承载）', () => {
    const chinese = nodePriceSeries({ dimensions: { nodeName: '昆明节点' } })
    const result = insightResult({
      data: {
        schemaVersion: 'insight-result-data/v1',
        dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'intervalStart', kind: 'time' }, { id: 'intervalEnd', kind: 'time' }],
        measures: [{ id: 'value', unit: 'by-series' }],
        rows: [{ seriesId: chinese.seriesId, intervalStart: '2026-09-10T00:00:00+08:00', intervalEnd: '2026-09-10T00:15:00+08:00', value: '300' }],
        series: [chinese],
      },
    })
    const current = currentOf()
    const { build } = useInsightSelection(() => current)

    const selection = build(result, [hit(chinese, TS_0000, '2026-09-10T00:15:00+08:00')])

    expect(selection).not.toBeNull()
    expect(selection!.objectRefs).toEqual([])
    expect(selection!.timeIntervals).toHaveLength(1)
  })
})

describe('迟到与上下文切换守卫', () => {
  it('contextVersion 不一致（页面上下文已前进）：事件直接丢弃', () => {
    const current = currentOf({ contextVersion: 4 })
    const { build } = useInsightSelection(() => current)

    const selection = build(nodePriceResult(['300']), [hit(PRICE, TS_0000, '2026-09-10T00:15:00+08:00')])

    expect(selection).toBeNull()
  })

  it('结果版本不一致（事件来自旧结果）：丢弃', () => {
    const current = currentOf({ resultVersion: `rv1:${'c'.repeat(64)}` })
    const { build } = useInsightSelection(() => current)

    expect(build(nodePriceResult(['300']), [hit(PRICE, TS_0000, '2026-09-10T00:15:00+08:00')])).toBeNull()
  })

  it('地区切换期间（A→B→A 的 B 段）：旧地区事件丢弃', () => {
    const current = currentOf({ regionId: 'guangdong' })
    const { build } = useInsightSelection(() => current)

    expect(build(nodePriceResult(['300']), [hit(PRICE, TS_0000, '2026-09-10T00:15:00+08:00')])).toBeNull()
  })
})

describe('防回环（同一选区不重复上抛）', () => {
  it('同一选区连续构建两次，第二次返回 null', () => {
    const current = currentOf()
    const { build } = useInsightSelection(() => current)
    const result = nodePriceResult(['300'])

    expect(build(result, [hit(PRICE, TS_0000, '2026-09-10T00:15:00+08:00')])).not.toBeNull()
    expect(build(result, [hit(PRICE, TS_0000, '2026-09-10T00:15:00+08:00')])).toBeNull()
  })

  it('reset 后同一点可重新选中（用户换个时段再选回来的自由）', () => {
    const current = currentOf()
    const { build, reset } = useInsightSelection(() => current)
    const result = nodePriceResult(['300'])

    build(result, [hit(PRICE, TS_0000, '2026-09-10T00:15:00+08:00')])
    reset()

    expect(build(result, [hit(PRICE, TS_0000, '2026-09-10T00:15:00+08:00')])).not.toBeNull()
  })
})
