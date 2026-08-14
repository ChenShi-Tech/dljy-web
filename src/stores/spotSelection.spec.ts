// @vitest-environment happy-dom
// ↑ 勿删：本文件不是 *.component.spec.ts，vitest node project 默认不给 DOM；store 经
//   regionContext 读/写 localStorage（切区 watch），靠此 pragma 按文件切到 happy-dom。
// ============================================================================
// stores/spotSelection.spec.ts — 现货面板共享选中态基座回归（Issue #449）
// ----------------------------------------------------------------------------
// 守什么不变量：
//   ① 初始默认值与导出常量对拍（默认日期/市场/全厂全机占位）——面板 F4-F7 首次挂载
//      依赖一套稳定的默认筛选，坏掉的症状是各面板初始条件漂移、对不齐口径。
//   ② setSelection 是局部 patch：未传字段保留现值、显式 undefined 不清空字段。
//   ③ snapshot()/setDateRange/selection 均为拷贝隔离——mutate 快照或入参数组不得
//      反写 store 内部（跨页共享态被一方 mutate 会串味到所有面板）。
//   ④ 切区 reset：云南严格真实数据与其它地区筛选上下文不得串味。
//
// 无 service 依赖（纯状态机）：plantOutputClient 只取 ALL_PLANTS/ALL_UNITS 常量对拍，
// regionContext 走真实模块——切区用真实 setCurrentRegionId 触发。
// ============================================================================
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { ALL_PLANTS, ALL_UNITS } from '../services/market/plantOutputClient'
import { setCurrentRegionId } from '../services/region/regionContext'
import {
  DEFAULT_SPOT_SELECTION_DATE,
  DEFAULT_SPOT_SELECTION_DATE_RANGE,
  DEFAULT_SPOT_SELECTION_MARKET,
  createDefaultSpotSelection,
  useSpotSelectionStore
} from './spotSelection'

describe('useSpotSelectionStore · 初始默认值', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setCurrentRegionId('yunnan') // 归位（上一用例可能已切区）
  })

  it('全字段对拍导出常量（默认日期/区间/全厂全机/空节点/日前市场）', () => {
    const store = useSpotSelectionStore()

    expect(store.date).toBe(DEFAULT_SPOT_SELECTION_DATE)
    expect(store.date).toBe('2026-05-01') // 常量锚：改默认日期必须连动改面板预期
    expect(store.dateRange).toEqual(DEFAULT_SPOT_SELECTION_DATE_RANGE)
    expect(store.dateRange).not.toBe(DEFAULT_SPOT_SELECTION_DATE_RANGE) // 内部已拷贝，mutate 模块常量不串进 store
    expect(store.plant).toBe(ALL_PLANTS)
    expect(store.plant).toBe('__all__')
    expect(store.unit).toBe(ALL_UNITS)
    expect(store.node).toBe('')
    expect(store.market).toBe(DEFAULT_SPOT_SELECTION_MARKET)
    expect(store.market).toBe('da')
  })
})

describe('useSpotSelectionStore · setter 与 setSelection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setCurrentRegionId('yunnan')
  })

  it('六个 setter 各自生效', () => {
    const store = useSpotSelectionStore()

    store.setDate('2026-06-02')
    store.setDateRange(['2026-06-01', '2026-06-30'])
    store.setPlant('plant-1')
    store.setUnit('unit-1')
    store.setNode('node-1')
    store.setMarket('rt')

    expect(store.snapshot()).toEqual({
      date: '2026-06-02',
      dateRange: ['2026-06-01', '2026-06-30'],
      plant: 'plant-1',
      unit: 'unit-1',
      node: 'node-1',
      market: 'rt'
    })
  })

  it('setDateRange 拷贝入参：之后 mutate 传入的数组不影响 store', () => {
    const store = useSpotSelectionStore()
    const input: [string, string] = ['2026-06-01', '2026-06-30']

    store.setDateRange(input)
    input[0] = '9999-99-99'

    expect(store.dateRange).toEqual(['2026-06-01', '2026-06-30'])
    expect(store.dateRange).not.toBe(input)
  })

  it('setSelection 局部 patch：未传字段保留现值', () => {
    const store = useSpotSelectionStore()
    store.setSelection({ date: '2026-06-01', market: 'rt' })

    store.setSelection({ plant: 'plant-9' }) // 只改 plant

    expect(store.plant).toBe('plant-9')
    expect(store.date).toBe('2026-06-01')
    expect(store.market).toBe('rt')
    expect(store.unit).toBe(ALL_UNITS)
    expect(store.node).toBe('')
  })

  it('setSelection 空 patch：状态不变', () => {
    const store = useSpotSelectionStore()
    store.setSelection({ date: '2026-06-01' })

    store.setSelection({})

    expect(store.date).toBe('2026-06-01')
  })

  it('setSelection 显式 undefined 字段被跳过，不清空现值', () => {
    const store = useSpotSelectionStore()
    store.setSelection({ date: '2026-06-01', plant: 'plant-1' })

    store.setSelection({ date: undefined, plant: undefined })

    expect(store.date).toBe('2026-06-01')
    expect(store.plant).toBe('plant-1')
  })
})

describe('useSpotSelectionStore · snapshot / selection 拷贝隔离', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setCurrentRegionId('yunnan')
  })

  it('snapshot() 是独立深拷贝：mutate 返回值不影响 store，两次调用互不为同一对象', () => {
    const store = useSpotSelectionStore()
    store.setDate('2026-06-15')
    store.setDateRange(['2026-06-01', '2026-06-30'])

    const snap1 = store.snapshot()
    expect(snap1.date).toBe('2026-06-15')
    snap1.date = '0000-00-00'
    snap1.dateRange[0] = '9999-99-99'

    expect(store.date).toBe('2026-06-15')
    expect(store.dateRange).toEqual(['2026-06-01', '2026-06-30'])

    const snap2 = store.snapshot()
    expect(snap2.dateRange).toEqual(['2026-06-01', '2026-06-30'])
    expect(snap2.dateRange).not.toBe(snap1.dateRange)
  })

  it('selection computed 随 setter 变化；外部 mutate 计算值不反写内部', async () => {
    const store = useSpotSelectionStore()
    expect(store.selection.plant).toBe(ALL_PLANTS)

    store.setPlant('plant-1')
    await nextTick()
    expect(store.selection.plant).toBe('plant-1')

    const view = store.selection
    view.dateRange[0] = '9999-99-99'
    view.plant = 'forged'

    expect(store.dateRange[0]).toBe(DEFAULT_SPOT_SELECTION_DATE) // 内部未被 mutate
    expect(store.plant).toBe('plant-1')
  })
})

describe('useSpotSelectionStore · reset 与切区', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setCurrentRegionId('yunnan')
  })

  it('resetSelection：改乱后一键回默认（与 createDefaultSpotSelection 对拍）', () => {
    const store = useSpotSelectionStore()
    store.setSelection({ date: '2026-07-01', dateRange: ['2026-07-01', '2026-07-31'], plant: 'p1', unit: 'u1', node: 'n1', market: 'rt' })

    store.resetSelection()

    expect(store.snapshot()).toEqual(createDefaultSpotSelection())
    expect(store.date).toBe(DEFAULT_SPOT_SELECTION_DATE)
    expect(store.market).toBe(DEFAULT_SPOT_SELECTION_MARKET)
  })

  it('切区 reset：切到其它地区后选中态回默认（防云南真实数据与它省筛选串味）', async () => {
    const store = useSpotSelectionStore()
    store.setSelection({ date: '2026-07-01', dateRange: ['2026-07-01', '2026-07-31'], plant: 'p1', unit: 'u1', node: 'n1', market: 'rt' })

    setCurrentRegionId('shanxi')
    await nextTick() // store 切区 watch flush

    expect(store.snapshot()).toEqual(createDefaultSpotSelection())
  })
})
