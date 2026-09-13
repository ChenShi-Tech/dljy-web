// 守住披露总览的日期、范围、真实来源和非合成边界；坏掉会把次日预测或全网值当成本日云南。
// 本地用户请求：当日公开13数据集全部可见；以下仅为隔离测试数据，不是业务数据。
import { beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/services/captured', () => ({ fetchCaptured: api.fetch }))
import { DISCLOSURE_DATASETS, loadDailyDisclosure, normalizeDailyDisclosure } from './dailyDisclosure'

const date = '2026-06-25'
const getSpec = (id = 'load_forecast') => DISCLOSURE_DATASETS.find((s) => s.id === id)!
function row(extra: Record<string, unknown> = {}) {
  return { operateDate: date, timePoint: '00:00', region: 'yn', metric: 'load_forecast', value: 12345, targetDate: null, ...extra }
}
function envelope(rows: Record<string, unknown>[], id = 'load_forecast') {
  return { code: 200, data: rows, provenance: { sourceType: 'DB', realDataConnected: true, region: 'yunnan', datasetKey: id,
    family: getSpec(id).family, capturedAt: '2026-07-01T16:00:00Z', ingestedAt: '2026-08-31T01:54:00Z' } }
}
beforeEach(() => api.fetch.mockReset())

describe('披露日期与真实来源', () => {
  it('登记当前完整13集，价格24点/跨省24点，其他15分钟；不是模型能力目录', () => {
    expect(DISCLOSURE_DATASETS).toHaveLength(13)
    expect(new Set(DISCLOSURE_DATASETS.map((s) => s.id)).size).toBe(13)
    expect(getSpec('inter_provincial_forecast').slots).toBe(24)
    expect(getSpec('da_user_price').unit).toBe('元/MWh')
    expect(getSpec().unit).toBe('原始值')
  })
  it('当日披露保留D+1新能源目标，不移到前一天或覆盖成当天', () => {
    const id = 'new_energy_forecast_d1'
    const output = normalizeDailyDisclosure(getSpec(id), date, envelope([
      row({ targetDate: '2026-06-26' }), row({ operateDate: '2026-06-24', targetDate: date, value: 7 }),
    ], id))
    expect(output.rows).toHaveLength(1)
    expect(output.series[0].targetDate).toBe('2026-06-26')
    expect(output.series[0].points[0]).toBe(12345)
  })
  it('没有目标日期的真实负荷仍展示，但明确未知且没有按0.1缩放', () => {
    const output = normalizeDailyDisclosure(getSpec(), date, envelope([row()]))
    expect(output.series[0]).toMatchObject({ targetDate: null, scope: 'yn', scopeLabel: '云南省内', validPoints: 1 })
    expect(output.series[0].points[0]).toBe(12345)
    expect(output.warnings.join(' ')).toContain('预测目标日期未明确')
    expect(output.warnings.join(' ')).toContain('未缩放')
  })
  it.each([
    { mock: true }, { _mock: true }, { sourceType: 'MOCK' }, { _sourceType: 'SYNTHETIC' }, { accessDenied: true },
    { provenance: {} }, { provenance: { sourceType: 'DB', realDataConnected: true, region: 'shanxi' } },
    { provenance: { sourceType: 'DB', realDataConnected: true, region: 'yunnan', datasetKey: 'wrong' } },
  ])('合成/未知/越区/错误数据集信封不可展示：%j', (patch) => {
    const output = normalizeDailyDisclosure(getSpec(), date, { ...envelope([row()]), ...patch })
    expect(output.status).toBe('rejected')
    expect(output.rows).toEqual([]); expect(output.series).toEqual([])
  })
  it('省内与全网曲线分开；不同目标日期也不得合并', () => {
    const output = normalizeDailyDisclosure(getSpec(), date, envelope([
      row(), row({ region: 'all', value: 222222 }), row({ targetDate: '2026-06-26', value: 13 }),
    ]))
    expect(output.series).toHaveLength(3)
    expect(output.series.map((s) => s.scopeLabel)).toContain('南网全网')
    expect(output.series.map((s) => s.points[0])).toEqual([12345, 222222, 13])
  })
  it('价格all标记不偷换为云南省内或南网系统功率，且没有预测目标日', () => {
    const id = 'da_user_price'
    const output = normalizeDailyDisclosure(getSpec(id), date, envelope([row({ region: 'all', value: -15 })], id))
    expect(output.series[0].scopeLabel).toBe('用户侧统一口径（源标记 all）')
    expect(output.series[0].points[0]).toBe(-15)
    expect(output.series[0].targetDate).toBeNull()
    expect(output.series[0].points).toHaveLength(24)
  })
  it('空日不补历史、零线或模拟曲线', () => {
    const output = normalizeDailyDisclosure(getSpec(), date, envelope([row({ operateDate: '2026-06-24' })]))
    expect(output.status).toBe('empty'); expect(output.series).toEqual([])
    expect(normalizeDailyDisclosure(getSpec(), '2026-02-30', envelope([])).status).toBe('error')
  })
})

describe('时段与原始明细', () => {
  it('同值重复去重，冲突时段置空，之后第三条不得覆盖冲突；保留全部明细', () => {
    const output = normalizeDailyDisclosure(getSpec(), date, envelope([
      row(), row(), row({ value: 777 }), row(), row({ timePoint: '00:15', value: 0, valuePrev: 3 }),
    ]))
    expect(output.rows).toHaveLength(5)
    expect(output.series[0]).toMatchObject({ validPoints: 1, conflicts: 1 })
    expect(output.series[0].points.slice(0, 3)).toEqual([null, 0, null])
    expect(output.series[0].previous[1]).toBe(3)
    expect(output.status).toBe('partial')
  })
  it.each([null, '', ' ', true, false, NaN, Infinity, -Infinity, '0x10'])('无效值%j不可变成真实零', (value) => {
    const output = normalizeDailyDisclosure(getSpec(), date, envelope([row({ value })]))
    expect(output.series[0].validPoints).toBe(0)
    expect(output.series[0].points[0]).toBeNull()
  })
  it('非法时点保留明细但不移到00:00，24点价格也不接受15分钟槽', () => {
    const id = 'rt_user_price'
    const output = normalizeDailyDisclosure(getSpec(id), date, envelope([
      row({ timePoint: '25:00' }), row({ timePoint: '00:15' }), row({ timePoint: '01:00', value: '25.5' }),
    ], id))
    expect(output.rows).toHaveLength(3)
    expect(output.series[0].points.slice(0, 2)).toEqual([null, 25.5])
    expect(output.warnings.join()).toContain('2 条时点')
  })
  it('完整96点保持原生时间，截断信封即使有96点也不能标完整', () => {
    const rows = Array.from({ length: 96 }, (_, i) => row({ timePoint: `${String(Math.floor(i / 4)).padStart(2, '0')}:${String(i % 4 * 15).padStart(2, '0')}` }))
    const body = envelope(rows)
    const complete = normalizeDailyDisclosure(getSpec(), date, body)
    expect(complete.status).toBe('ready')
    expect(complete.series[0].labels.at(-1)).toBe('23:45')
    expect(normalizeDailyDisclosure(getSpec(), date, { ...body, _filter: { truncated: true } }).status).toBe('partial')
  })
  it('供需只绘非空字段，保留所有原字段，频率与功率原值量纲分开', () => {
    const id = 'yn_system_supply_demand'
    const output = normalizeDailyDisclosure(getSpec(id), date, envelope([
      { date, time: '00:00', area: '云南', loadMWh: 20, newEnergyMWh: 0, hydropowerMWh: null, price: null, frequencyHz: 50, extraField: '原字段' },
    ], id))
    expect(output.series.map((s) => s.label)).toEqual(['统调负荷', '新能源出力', '电网频率'])
    expect(output.series.map((s) => s.unit)).toEqual(['原始值', '原始值', 'Hz'])
    expect(output.rows[0].extraField).toBe('原字段')
    expect(output.series[0].scopeLabel).toBe('云南省内')
  })
})

describe('全量只读加载', () => {
  it('只查选定记录日，所有13集保留，单集失败不吞其他结果', async () => {
    api.fetch.mockImplementation(async (_family: string, id: string) => {
      if (id === 'load_forecast') throw new Error('读取失败样例')
      return envelope([], id)
    })
    const results = await loadDailyDisclosure('yunnan', date)
    expect(api.fetch).toHaveBeenCalledTimes(13)
    expect(api.fetch).toHaveBeenCalledWith('yn_system_forecast', 'new_energy_forecast_d1', { region: 'yunnan', dateFrom: date, dateTo: date, limit: 4096 })
    expect(results).toHaveLength(13)
    expect(results.find((r) => r.spec.id === 'load_forecast')).toMatchObject({ status: 'error', error: '读取失败样例' })
    expect(results.filter((r) => r.status === 'empty')).toHaveLength(12)
  })
  it('并发上限为3，顺序保持清单次序', async () => {
    let running = 0; let peak = 0
    api.fetch.mockImplementation(async (_family: string, id: string) => {
      peak = Math.max(peak, ++running)
      await new Promise((resolve) => setTimeout(resolve, 1))
      running--
      return envelope([], id)
    })
    const results = await loadDailyDisclosure('yunnan', date)
    expect(peak).toBe(3)
    expect(results.map((r) => r.spec.id)).toEqual(DISCLOSURE_DATASETS.map((s) => s.id))
  })
  it('其他地区和非法日期不发请求，不回退云南', async () => {
    await expect(loadDailyDisclosure('shanxi', date)).rejects.toThrow('仅接入云南')
    await expect(loadDailyDisclosure('yunnan', '2026-02-30')).rejects.toThrow('有效')
    expect(api.fetch).not.toHaveBeenCalled()
  })
})
