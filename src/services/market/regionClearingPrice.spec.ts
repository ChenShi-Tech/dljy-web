// 「该交易日的实际出清价」按地区取数（#2392）。
//
// 这里钉的是驾驶舱面板此前显示假数据的**真正根因**：它对所有地区统一走 sdpt_zcqxhdl，
// 而云南根本没有那个采集族（`/api/real-coverage` 对它返回 datasets: []），于是每次都
// 落到 synth96 合成——那条链路从一开始就不可能给云南画出真实数据。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchCaptured = vi.fn()
const loadClearingCurve = vi.fn()
vi.mock('@/services/captured', () => ({ fetchCaptured: (...a: unknown[]) => fetchCaptured(...a) }))
vi.mock('@/services/market/spotPrice', () => ({
  loadClearingCurve: (...a: unknown[]) => loadClearingCurve(...a),
}))

const { fetchClearingPrice } = await import('./regionClearingPrice')

const hourRows = (base: number, hours = 24) =>
  Array.from({ length: hours }, (_, h) => ({
    operateDate: '2026-08-18',
    timePoint: `${String(h).padStart(2, '0')}:00`,
    value: base + h,
  }))

beforeEach(() => {
  fetchCaptured.mockReset()
  loadClearingCurve.mockReset()
})

describe('云南走日前用户侧电价，不走 sdpt_zcqxhdl', () => {
  it('取的是 yn_system_forecast/da_user_price——云南没有 sdpt_zcqxhdl 这个族', async () => {
    fetchCaptured.mockResolvedValue({ data: hourRows(300) })
    const curve = await fetchClearingPrice('yunnan', '2026-08-18')

    expect(fetchCaptured).toHaveBeenCalledWith(
      'yn_system_forecast', 'da_user_price',
      { dateFrom: '2026-08-18', dateTo: '2026-08-18', region: 'yunnan' })
    expect(loadClearingCurve).not.toHaveBeenCalled()
    expect(curve.basis).toBe('captured')
    expect(curve.label).toBe('日前用户侧电价')
  })

  it('24 点小时价铺成 96 点阶梯，每小时 4 槽同值', async () => {
    fetchCaptured.mockResolvedValue({ data: hourRows(300) })
    const { points, hourly } = await fetchClearingPrice('yunnan', '2026-08-18')

    expect(points).toHaveLength(96)
    expect(hourly).toBe(true)
    expect(points.slice(0, 4).map((p) => p.value)).toEqual([300, 300, 300, 300])
    expect(points[4].value).toBe(301)
    expect(points[0].time).toBe('00:00')
    expect(points[95].time).toBe('23:45')
  })

  it('缺失的小时不产出点——塞 null 进曲线会要求每个消费方都记得过滤', async () => {
    fetchCaptured.mockResolvedValue({ data: hourRows(300, 12) })
    const { points } = await fetchClearingPrice('yunnan', '2026-08-18')
    expect(points).toHaveLength(48)
    expect(points.every((p) => Number.isFinite(p.value))).toBe(true)
  })

  it('取不到数据 → 空态，不合成', async () => {
    fetchCaptured.mockResolvedValue({ data: [] })
    expect(await fetchClearingPrice('yunnan', '2026-08-18')).toMatchObject({ points: [], basis: 'empty' })
  })

  it('取数抛错 → 空态，不让整个面板炸掉', async () => {
    fetchCaptured.mockRejectedValue(new Error('network'))
    expect(await fetchClearingPrice('yunnan', '2026-08-18')).toMatchObject({ points: [], basis: 'empty' })
  })
})

describe('其它地区走既有出清曲线，但合成兜底必须挡掉', () => {
  it('真实曲线原样返回', async () => {
    loadClearingCurve.mockResolvedValue({
      points: [{ time: '00:00', value: 400 }], basis: 'captured', isDemo: false, sourcePoints: 96,
    })
    const curve = await fetchClearingPrice('shanxi', '2026-08-18')
    expect(curve.basis).toBe('captured')
    expect(curve.points).toHaveLength(1)
    expect(curve.hourly).toBe(false)
  })

  it('synth96 合成的曲线一律当作没有数据——编造的价格比空面板危险得多', async () => {
    loadClearingCurve.mockResolvedValue({
      points: Array.from({ length: 96 }, (_, i) => ({ time: `t${i}`, value: 400 + i })),
      basis: 'synthetic', isDemo: true, sourcePoints: 96,
    })
    const curve = await fetchClearingPrice('shanxi', '2026-08-18')
    expect(curve.points).toEqual([])
    expect(curve.basis).toBe('empty')
  })

  it('小时级源粒度如实标注——不标会被读成 15 分钟分辨率', async () => {
    loadClearingCurve.mockResolvedValue({
      points: [{ time: '00:00', value: 400 }], basis: 'captured', isDemo: false, sourcePoints: 24,
    })
    expect((await fetchClearingPrice('shanxi', '2026-08-18')).hourly).toBe(true)
  })
})
