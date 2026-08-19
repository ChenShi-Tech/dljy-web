// 云南真实数据重组回归（父 Issue #477：市场洞察页云南一年真实数据）。
// 守住的不变量：
// 1. 96→24 聚合，每小时 x 值 = 该小时 4 个 15min 的均值（手算对拍）；不满 4 点按
// 现有点均值（缺测不外推、不补 0）。
// 2. 诚实 null，某小时 x 或 price 任一缺失 → p{h} = null（绝不造 [x,0] 或半对）。
// 3. 地区偏好，优先 region='yn' 行；仅当一条 yn 行都没有才回落全量（不臆造）。
// 4. 日期窗口，xd 恰为 [runDate-days+1, runDate] 本地日期升序；dateFrom/dateTo
// 闭区间传给 fetchCaptured（整年长表载荷级过滤，防 30MB 全量下载回潮）。
// 坏掉的症状：散点 x 轴数值系统性偏移（聚合错）、图中出现 (x,0) 假点（诚实 null 丢失）、
// 切别的省数据串进云南页（地区回落丢）、切页卡死数十秒（窗口过滤丢、整年下载）。
import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchCaptured = vi.hoisted(() => vi.fn())
vi.mock('@/services/captured', () => ({ fetchCaptured }))

import { buildRealtimeScatter } from '@/services/market/yunnanRealtime'

type Row = { operateDate: string; timePoint: string; region: string; value: number | null }

function quarterRows(date: string, hour: number, vals: number[], region = 'yn'): Row[] {
  return vals.map((value, i) => ({
    operateDate: date,
    timePoint: `${String(hour).padStart(2, '0')}:${String(i * 15).padStart(2, '0')}`,
    region,
    value,
  }))
}

function hourRows(date: string, hour: number, val: number, region = 'yn'): Row[] {
  return [{ operateDate: date, timePoint: `${String(hour).padStart(2, '0')}:00`, region, value: val }]
}

/** 按 datasetKey 分桶应答：x 指标默认给足 96 点形态的最小集，价格给 24 点形态。 */
function mockCapture(byKey: Record<string, Row[]>) {
  fetchCaptured.mockImplementation(async (_family: string, key: string) => ({ data: byKey[key] ?? [] }))
}

afterEach(() => {
  fetchCaptured.mockReset()
})

describe('buildRealtimeScatter · 96→24 聚合与诚实 null', () => {
  it('每小时 x = 4 个 15min 均值（手算对拍），散点为 [x, price]', async () => {
    mockCapture({
      new_energy_actual: [
        ...quarterRows('2026-05-15', 0, [100, 200, 300, 500]), // 均值 275
        ...quarterRows('2026-05-15', 3, [40, 80]), // 只来 2 点 → 均值 60（不外推）
      ],
      da_user_price: [
        ...hourRows('2026-05-15', 0, 0.35),
        ...hourRows('2026-05-15', 3, 0.42),
      ],
    })

    const { xd, xnyzd, xnyg, xnygd } = await buildRealtimeScatter({
      runDate: '2026-05-15', days: 1, xMetric: 'new_energy_actual', priceMode: 'rq',
    })

    expect(xd).toHaveLength(1)
    const day = xd[0]
    expect(day.date).toBe('2026-05-15')
    expect(day.p1).toEqual([275, 0.35]) // (100+200+300+500)/4 手算
    expect(day.p4).toEqual([60, 0.42])  // (40+80)/2：缺测按现有点均值
    expect(day.p2).toBeNull()           // 无数据的小时诚实 null
    expect(day.p24).toBeNull()
    expect(xnyzd).toEqual([])           // 云南无竖线维度，视图对空容错
    expect(xnyg).toEqual([])
    expect(xnygd).toEqual([])
  })

  it('x 与 price 任一缺失 → 该小时 null（绝不出现 [x,0] 或半对假点）', async () => {
    mockCapture({
      load_actual: [
        ...quarterRows('2026-05-15', 5, [10, 20, 30, 40]), // x 在、价缺
        ...quarterRows('2026-05-15', 6, [1, 2, 3, 4]),     // 两边都在（对照）
      ],
      rt_user_price: [
        ...hourRows('2026-05-15', 4, 0.5), // 价在、x 缺
        ...hourRows('2026-05-15', 6, 0.5),
      ],
    })

    const { xd } = await buildRealtimeScatter({
      runDate: '2026-05-15', days: 1, xMetric: 'load_actual', priceMode: 'ss',
    })

    expect(xd[0].p6).toBeNull() // x 有价无 → null（hour5 只有负荷）
    expect(xd[0].p5).toBeNull() // 价有 x 无 → null（hour4 只有价）
    expect(xd[0].p7).toEqual([2.5, 0.5]) // 两边都在才成点（hour6：x=(1+2+3+4)/4）
  })

  it('脏行跳过：value null / timePoint 非法 / 窗口外日期不计入聚合', async () => {
    mockCapture({
      new_energy_actual: [
        ...quarterRows('2026-05-15', 1, [4, 4, 4, 4]),
        { operateDate: '2026-05-15', timePoint: '02:xx', region: 'yn', value: 999 }, // 非法时点
        { operateDate: '2026-05-15', timePoint: '02:30', region: 'yn', value: null }, // 缺测
        { operateDate: '2020-01-01', timePoint: '01:15', region: 'yn', value: 8888 }, // 窗口外
      ],
      da_user_price: [...hourRows('2026-05-15', 1, 0.3)],
    })

    const { xd } = await buildRealtimeScatter({
      runDate: '2026-05-15', days: 1, xMetric: 'new_energy_actual', priceMode: 'rq',
    })

    expect(xd[0].p2).toEqual([4, 0.3]) // 脏行全部被跳过，均值不被 999/8888 污染
  })
})

describe('buildRealtimeScatter · 窗口与地区', () => {
  it('xd 为 [runDate-days+1, runDate] 本地日期升序，dateFrom/dateTo 闭区间下传', async () => {
    mockCapture({})
    await buildRealtimeScatter({ runDate: '2026-03-01', days: 3, xMetric: 'load_actual', priceMode: 'rq' })

    expect(fetchCaptured).toHaveBeenCalledWith('yn_system_forecast', 'load_actual',
      { dateFrom: '2026-02-27', dateTo: '2026-03-01', region: undefined })
    expect(fetchCaptured).toHaveBeenCalledWith('yn_system_forecast', 'da_user_price',
      { dateFrom: '2026-02-27', dateTo: '2026-03-01', region: undefined })
  })

  it('dates 含跨月借位（2026-03-01 往前 3 天 = 02-27，本地日期不回退一天）', async () => {
    const { xd } = await buildRealtimeScatter({
      runDate: '2026-03-01', days: 3, xMetric: 'load_actual', priceMode: 'rq',
    })
    expect(xd.map((d) => d.date)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01'])
  })

  it('priceMode 路由：rq→da_user_price（日前）、ss→rt_user_price（实时）', async () => {
    mockCapture({})
    await buildRealtimeScatter({ runDate: '2026-05-15', days: 1, xMetric: 'load_actual', priceMode: 'rq' })
    await buildRealtimeScatter({ runDate: '2026-05-15', days: 1, xMetric: 'load_actual', priceMode: 'ss' })
    const keys = fetchCaptured.mock.calls.map((c) => c[1])
    expect(keys).toContain('da_user_price')
    expect(keys).toContain('rt_user_price')
  })

  it('地区偏好：有 yn 行只取 yn（他省数据不串页）；一条 yn 都没有才回落全量', async () => {
    // 桶 1：混着 gd 与 yn，只应取 yn 的均值（gd 的 9000 不得污染）
    fetchCaptured.mockImplementation(async (_f: string, key: string) => ({
      data: key === 'new_energy_actual'
        ? [...quarterRows('2026-05-15', 0, [8, 8, 8, 8]), ...quarterRows('2026-05-15', 0, [9000], 'gd')]
        : [...hourRows('2026-05-15', 0, 0.4), ...hourRows('2026-05-15', 0, 0.4, 'gd')],
    }))

    const a = await buildRealtimeScatter({ runDate: '2026-05-15', days: 1, xMetric: 'new_energy_actual', priceMode: 'rq' })
    expect(a.xd[0].p1).toEqual([8, 0.4]) // gd 行被过滤

    // 桶 2：只有 gd 行，回落全量（不臆造、不静默全空）
    fetchCaptured.mockImplementation(async (_f: string, key: string) => ({
      data: key === 'new_energy_actual'
        ? quarterRows('2026-05-15', 0, [1, 2, 3, 4], 'gd')
        : hourRows('2026-05-15', 0, 0.4, 'gd'),
    }))
    const b = await buildRealtimeScatter({ runDate: '2026-05-15', days: 1, xMetric: 'new_energy_actual', priceMode: 'rq' })
    expect(b.xd[0].p1).toEqual([2.5, 0.4])
  })
})
