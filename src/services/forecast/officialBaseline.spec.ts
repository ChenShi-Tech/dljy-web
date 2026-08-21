// 官方日前预测基线的取数与对齐（#2371 后续）。
//
// 最要命的一条是日期对齐：`operateDate` 是**发布日**、比交易日早一天，只按它认会整体错一天，
// 而且错得很隐蔽——曲线形状仍然像模像样。这里的断言必须能抓住这种错位。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchCaptured = vi.fn()
vi.mock('@/services/captured', () => ({ fetchCaptured }))

const { fetchOfficialBaseline, officialMae, hasOfficialBaseline } = await import('./officialBaseline')

const hhmm = (slot: number) =>
  `${String(Math.floor(slot * 15 / 60)).padStart(2, '0')}:${String((slot * 15) % 60).padStart(2, '0')}`

/** 造一天 96 点：targetDate 那天值 = base + slot，用值本身把日期编码进去便于断言 */
function dayRows(operateDate: string, targetDate: string, base: number, region = 'yn') {
  return Array.from({ length: 96 }, (_, slot) => ({
    operateDate, targetDate, region, timePoint: hhmm(slot), value: base + slot, metric: 'new_energy_forecast',
  }))
}

describe('官方日前预测基线', () => {
  beforeEach(() => fetchCaptured.mockReset())

  it('只有声明了数据源的地区+目标才认为有官方基线', () => {
    expect(hasOfficialBaseline('yunnan', 'renewable')).toBe(true)
    // 负荷的 targetDate 恒 null、口径反推不出，刻意不接
    expect(hasOfficialBaseline('yunnan', 'load')).toBe(false)
    // 云南平台不发布官方电价预测
    expect(hasOfficialBaseline('yunnan', 'price')).toBe(false)
    expect(hasOfficialBaseline('shanxi', 'renewable')).toBe(false)
  })

  it('按 targetDate 挑曲线，不被同批返回的他日预测带偏', async () => {
    // 回放层按 operateDate 切片，必然同时返回「D-1 发布(预测 D)」与「D 发布(预测 D+1)」两条
    fetchCaptured.mockResolvedValue({ rows: [
      ...dayRows('2026-08-19', '2026-08-20', 1000),   // 目标日的那条
      ...dayRows('2026-08-20', '2026-08-21', 9000),   // 次日的那条：只按 operateDate 认就会拿到它
    ] })

    const r = await fetchOfficialBaseline('yunnan', 'renewable', '2026-08-20')
    expect(r).not.toBeNull()
    expect(r!.targetDate).toBe('2026-08-20')
    // 值域断言直接暴露错位：拿错那条会是 9000+
    expect(r!.points[0]).toBe(1000)
    expect(r!.points[95]).toBe(1095)
  })

  it('过滤行内地区标记——南网全网(all)与云南省内(yn)量级不同，混进来就是两条曲线叠一起', async () => {
    fetchCaptured.mockResolvedValue({ rows: [
      ...dayRows('2026-08-19', '2026-08-20', 1000, 'all'),
      ...dayRows('2026-08-19', '2026-08-20', 2000, 'yn'),
    ] })
    const r = await fetchOfficialBaseline('yunnan', 'renewable', '2026-08-20')
    expect(r!.points[0]).toBe(2000)
  })

  it('点数不全整条丢弃，不画带缺口的线', async () => {
    fetchCaptured.mockResolvedValue({ rows: dayRows('2026-08-19', '2026-08-20', 1000).slice(0, 90) })
    expect(await fetchOfficialBaseline('yunnan', 'renewable', '2026-08-20')).toBeNull()
  })

  it('取数失败或无数据时返回 null，不抛错打断预测展示', async () => {
    fetchCaptured.mockRejectedValue(new Error('boom'))
    expect(await fetchOfficialBaseline('yunnan', 'renewable', '2026-08-20')).toBeNull()
    fetchCaptured.mockResolvedValue({ rows: [] })
    expect(await fetchOfficialBaseline('yunnan', 'renewable', '2026-08-20')).toBeNull()
  })

  it('无目标日期时不发请求', async () => {
    expect(await fetchOfficialBaseline('yunnan', 'renewable', undefined)).toBeNull()
    expect(fetchCaptured).not.toHaveBeenCalled()
  })

  it('officialMae 在长度不一致或缺失时返回 null，不以 0 冒充「无误差」', () => {
    expect(officialMae([1, 2, 3], [1, 2, 3])).toBe(0)
    expect(officialMae([1, 2, 3], [2, 4, 6])).toBeCloseTo(2, 10)
    expect(officialMae([1, 2], [1, 2, 3])).toBeNull()
    expect(officialMae(undefined, [1])).toBeNull()
    expect(officialMae([1], undefined)).toBeNull()
  })
})
