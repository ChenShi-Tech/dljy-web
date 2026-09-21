// 守护公开披露信息台的时段、单位与地区边界；错位会把缺测/他省数据当交易事实。#2897
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { fetchCaptured, apiGet, fetchCaptureCoverage } = vi.hoisted(() => ({ fetchCaptured: vi.fn(), apiGet: vi.fn(), fetchCaptureCoverage: vi.fn() }))
vi.mock('@/services/captured', () => ({ fetchCaptured }))
vi.mock('@/services/region/regionContext', () => ({ currentRegion: { value: { id: 'yunnan' } } }))
vi.mock('@/services/api', async (importOriginal) => ({ ...await importOriginal<typeof import('@/services/api')>(), apiGet }))
vi.mock('@/services/market/captureCoverage', () => ({ fetchCaptureCoverage }))
import { ApiError } from '@/services/api'
import { readDisclosureDeskCached } from './disclosureDeskCache'
import { DISCLOSURE_DESK_THEMES, buildDisclosureDeskSeries, findDisclosureDeskPointAt, getDisclosureDeskMetric, loadDisclosureDeskCoverage, loadDisclosureDeskSeries, loadDisclosureDeskThemeAvailability, summarizeDisclosureDeskSeries } from './disclosureDeskData'

const params = { regionId: 'yunnan', metricId: 'price', dateFrom: '2026-09-01', dateTo: '2026-09-01' }
const row = (value: unknown, timePoint = '00:00', extra: Record<string, unknown> = {}) => ({ operateDate: '2026-09-01', timePoint, value, region: 'yn', ...extra })
const real = (data: Record<string, unknown>[]) => ({ data, sourceType: 'IMPORT', mock: false })
const coverage = (datasets: Array<{ datasetKey: string; start: string | null; end: string | null }>, family = 'yn_system_forecast', region = 'yunnan') => ({ code: 200, data: { family, region, datasets } })
const apiError = (status: number, message: string) => new ApiError(message, { status, code: status, payload: { code: status, msg: message } })
beforeEach(() => { vi.clearAllMocks(); fetchCaptureCoverage.mockResolvedValue(null); apiGet.mockResolvedValue({ data: { datasets: [] } }); fetchCaptured.mockResolvedValue(real([])) })
afterEach(() => { vi.restoreAllMocks() })

describe('公开披露指标语义', () => {
  it('锁定六类主题和干预的价格上下文，不把全网总发电加入省级偏差', () => {
    expect(DISCLOSURE_DESK_THEMES.map((item) => item.id)).toEqual(['price', 'load', 'new-energy', 'reserve', 'maintenance', 'transmission', 'intervention'])
    expect(DISCLOSURE_DESK_THEMES.find((item) => item.id === 'intervention')).toMatchObject({ metricId: 'price', categories: ['intervention'] })
    expect(getDisclosureDeskMetric('total-generation')).toBeUndefined()
    expect(getDisclosureDeskMetric('section-load')).toMatchObject({ unit: '%', nativeMinutes: null })
    expect(getDisclosureDeskMetric('hydro')).toMatchObject({ unit: 'MW', nativeMinutes: 15 })
    expect(DISCLOSURE_DESK_THEMES.find((item) => item.id === 'maintenance')?.metricId).toBe('price')
  })

  it('小时价使用24原生时槽、阶梯线；保留0/负数，不把空串、null、非有限值转为0', () => {
    const metric = getDisclosureDeskMetric('price')!
    const series = buildDisclosureDeskSeries(metric, metric.sources[0], [row(0), row(-20, '01:00'), row('', '02:00'), row(null, '03:00'), row(NaN, '04:00'), row(Infinity, '05:00')], params)
    expect(series.step).toBe('end')
    expect(series.points).toHaveLength(24)
    expect(series.points.slice(0, 6).map((point) => point.value)).toEqual([0, -20, null, null, null, null])
    expect(summarizeDisclosureDeskSeries(series)).toMatchObject({ min: -20, minAt: '2026-09-01 01:00', max: 0, maxAt: '2026-09-01 00:00', mean: -10, latest: -20, validPoints: 2, expectedPoints: 24 })
    expect(summarizeDisclosureDeskSeries(series, '2026-09-01 02:00')).toMatchObject({ mean: null, validPoints: 0 })
  })

  it('负荷只配云南同口径，拒绝all与其他省；时点缺失不前移', async () => {
    fetchCaptured.mockImplementation(async (_family: string, dataset: string) => real(dataset === 'load_forecast'
      ? [row(100), row(50, '00:30'), row(2000, '00:15', { region: 'all' }), row(3000, '00:15', { region: 'gd' })]
      : [row(80), row(45, '00:30')]))
    const result = await loadDisclosureDeskSeries({ ...params, metricId: 'load' })
    expect(result.series[0].points).toHaveLength(96)
    expect(result.series[0].points.slice(0, 3).map((point) => point.value)).toEqual([100, null, 50])
    expect(result.series[2].points.slice(0, 3).map((point) => point.value)).toEqual([-20, null, -5])
    expect(result.series[2].label).toBe('实际－预测偏差')
  })

  it('非市场化预测实际按省域、指标与MW同口径对齐，缺测和真实0均保留', async () => {
    fetchCaptured.mockImplementation(async (_family: string, dataset: string) => real(dataset === 'non_market_forecast'
      ? [row(100, '00:00', { metric: dataset, unit: 'MW' }), row(0, '00:15', { metric: dataset }), row(40, '00:30', { metric: dataset }), row(50, '00:45', { metric: dataset })]
      : [row(120, '00:00', { metric: dataset, unit: 'MW' }), row(0, '00:15', { metric: dataset }), row(90, '00:30', { metric: dataset, region: 'all' }), row(90, '00:30', { metric: dataset, region: 'gd' }), row(90, '00:30', { metric: 'total_generation_actual' }), row(500, '00:45', { metric: dataset, unit: 'MWh' })]))
    const result = await loadDisclosureDeskSeries({ ...params, metricId: 'non-market' })
    expect(result.metric).toMatchObject({ unit: 'MW', nativeMinutes: 15, themeId: 'load' })
    expect(result.series.map((series) => series.id)).toEqual(['forecast', 'actual', 'deviation'])
    expect(result.series[2].points.slice(0, 4).map((point) => point.value)).toEqual([20, 0, null, null])
    expect(result.series[0].forecast).toBe(true)
    expect(result.series[2].forecast).toBe(false)
    expect(fetchCaptured).toHaveBeenCalledWith('yn_system_forecast', 'non_market_actual', expect.objectContaining({ region: 'yunnan' }))
  })

  it.each([
    ['key-channel', 'actual_key_channel_transmission'],
    ['key-line-transformer', 'actual_key_line_transformer_flow'],
  ])('%s 以明确对象选择原生96点，不按名称拼接别的设备或省份', async (metricId, dataset) => {
    fetchCaptured.mockResolvedValue(real([row(0, '00:00', { channelName: '对象甲', regionName: null }), row(80, '00:15', { channelName: '对象甲', regionName: null }), row(999, '00:00', { channelName: '对象乙', regionName: null }), row(777, '00:00', { channelName: '对象甲', regionName: '广东' })]))
    const first = await loadDisclosureDeskSeries({ ...params, metricId })
    expect(first).toMatchObject({ status: 'partial', channels: ['对象甲', '对象乙'], selectedChannel: '对象甲' })
    expect(first.series[0].points[0].value).toBe(0)
    const selected = await loadDisclosureDeskSeries({ ...params, metricId, channel: '对象甲' })
    expect(selected.series[0]).toMatchObject({ unit: 'MW', nativeMinutes: 15 })
    expect(selected.series[0].points).toHaveLength(96)
    expect(selected.series[0].points.slice(0, 3).map((point) => point.value)).toEqual([0, 80, null])
    expect(selected.series).toHaveLength(1)
    expect(fetchCaptured).toHaveBeenCalledWith('yn_disclosure_metric', dataset, expect.objectContaining({ region: 'yunnan' }))
  })

  it('断面正反向限值共用一次取数，按明确方向拆曲线且不改反向符号、不构造裕度', async () => {
    fetchCaptured.mockResolvedValue(real([
      row(4000, '00:00', { channelName: '断面甲', dataType: '正向限值' }),
      row(3000, '00:00', { channelName: '断面甲', dataType: '反向限值' }),
      row(-2000, '00:15', { channelName: '断面甲', dataType: '反向限值' }),
      row(0, '00:15', { channelName: '断面甲', dataType: '正向限值' }),
      row(9000, '00:00', { channelName: '断面乙', dataType: '正向限值' }),
      row(123, '00:30', { channelName: '断面甲', dataType: '未知方向' }),
    ]))
    const result = await loadDisclosureDeskSeries({ ...params, metricId: 'section-constraint', channel: '断面甲' })
    expect(result.channels).toEqual(['断面甲', '断面乙'])
    expect(result.series.map((series) => series.id)).toEqual(['forward-limit', 'reverse-limit'])
    expect(result.series[0].points.slice(0, 3).map((point) => point.value)).toEqual([4000, 0, null])
    expect(result.series[1].points.slice(0, 3).map((point) => point.value)).toEqual([3000, -2000, null])
    expect(result.metric.difference).toBeUndefined()
    expect(result.series.every((series) => series.nativeMinutes === 15 && series.unit === 'MW')).toBe(true)
    expect(fetchCaptured).toHaveBeenCalledTimes(1)
  })

  it('省间送受电预测选择源断面，按24小时原值展示且不把缺失受电补成0', async () => {
    fetchCaptured.mockResolvedValue(real([
      row(200, '00:00', { region: '云南总送出', metric: 'inter_provincial_send' }),
      row(0, '01:00', { region: '云南总送出', metric: 'inter_provincial_send' }),
      row(80, '00:00', { region: '广东受西电', metric: 'inter_provincial_receive' }),
      row(999, '00:00', { region: '海南受西电', metric: 'inter_provincial_send' }),
      row(999, '00:00', { region: 'yn', metric: 'inter_provincial_send' }),
      row(999, '00:00', { region: '云南总送出', metric: 'unknown' }),
    ]))
    const result = await loadDisclosureDeskSeries({ ...params, metricId: 'interprov-forecast', channel: '云南总送出' })
    expect(result.channels).toEqual(['广东受西电', '海南受西电', '云南总送出'])
    expect(result.metric).toMatchObject({ unit: 'MW', nativeMinutes: 60 })
    expect(result.series.map((series) => series.id)).toEqual(['send'])
    expect(result.series[0]).toMatchObject({ step: 'end', forecast: true })
    expect(result.series[0].points).toHaveLength(24)
    expect(result.series[0].points.slice(0, 3).map((point) => point.value)).toEqual([200, 0, null])
    expect(result.series.some((series) => series.id === 'receive')).toBe(false)
    expect(result.metric.difference).toBeUndefined()
    expect(fetchCaptured).toHaveBeenCalledTimes(1)
    expect(fetchCaptured).toHaveBeenCalledWith('yn_system_forecast', 'inter_provincial_forecast', expect.objectContaining({ region: 'yunnan' }))
  })

  it.each([['云南总送出', 'send'], ['广东受西电', 'receive']])('完整24点的%s仅按已披露%s方向确认覆盖', async (region, direction) => {
    const rows = Array.from({ length: 24 }, (_, hour) => row(hour, `${String(hour).padStart(2, '0')}:00`, { region, metric: `inter_provincial_${direction}` }))
    fetchCaptured.mockResolvedValue(real(rows))
    const result = await loadDisclosureDeskSeries({ ...params, metricId: 'interprov-forecast', channel: region })
    expect(result.status).toBe('available')
    expect(result.series.map((series) => series.id)).toEqual([direction])
    expect(result.summary[0]).toMatchObject({ validPoints: 24, expectedPoints: 24, min: 0 })
    // 已有相反方向的原始记录但值缺失时，仍要明确保留缺测。
    const opposite = direction === 'send' ? 'receive' : 'send'
    fetchCaptured.mockResolvedValue(real([...rows, row(null, '00:00', { region, metric: `inter_provincial_${opposite}` })]))
    const incomplete = await loadDisclosureDeskSeries({ ...params, metricId: 'interprov-forecast', channel: region })
    expect(incomplete.status).toBe('partial')
    expect(incomplete.series).toHaveLength(2)
  })

  it('优先送电电量下限按类别每日一值，MWh原因来源成事实卡而不扩展全天', async () => {
    fetchCaptured.mockImplementation(async (_family: string, _dataset: string, filter: { dateFrom: string }) => real([
      row(filter.dateFrom === params.dateFrom ? 0 : 232828, '', { operateDate: filter.dateFrom, categoryName: '云南省网送广东', metric: '送端电量下限', noteText: filter.dateFrom === params.dateFrom ? '空' : '按优先计划执行', sourceFile: `${filter.dateFrom}限值.xls`, sourceTable: 'forecast_interprov_priority_limit' }),
      row(999999, '', { operateDate: filter.dateFrom, categoryName: '其他送电类别', metric: '送端电量下限' }),
    ]))
    const result = await loadDisclosureDeskSeries({ ...params, metricId: 'priority-limit', dateTo: '2026-09-02', channel: '云南省网送广东' })
    expect(result.series[0]).toMatchObject({ unit: 'MWh', nativeMinutes: null, step: false })
    expect(result.series[0].points).toEqual([{ time: '2026-09-01 00:00', value: 0 }, { time: '2026-09-02 00:00', value: 232828 }])
    expect(result.facts).toEqual([
      { label: '省间优先送电电量下限', value: '0', time: '2026-09-01', unit: 'MWh', reason: '未提供', sourceTable: 'forecast_interprov_priority_limit', sourceFile: '2026-09-01限值.xls', objectName: '云南省网送广东' },
      { label: '省间优先送电电量下限', value: '232828', time: '2026-09-02', unit: 'MWh', reason: '按优先计划执行', sourceTable: 'forecast_interprov_priority_limit', sourceFile: '2026-09-02限值.xls', objectName: '云南省网送广东' },
    ])
    expect(findDisclosureDeskPointAt(result.series[0], '2026-09-01 12:00')).toBeUndefined()
  })

  it('同对象同日冲突电量不按返回顺序选版本，保留各自原因与来源供核验', async () => {
    fetchCaptured.mockResolvedValue(real([
      row(100, '', { categoryName: '类别甲', metric: '送端电量下限', noteText: '原因甲', sourceFile: '甲.xls' }),
      row(200, '', { categoryName: '类别甲', metric: '送端电量下限', noteText: '原因乙', sourceFile: '乙.xls' }),
    ]))
    const result = await loadDisclosureDeskSeries({ ...params, metricId: 'priority-limit', channel: '类别甲' })
    expect(result.series[0].points[0].value).toBeNull()
    expect(result.facts).toHaveLength(1)
    expect(result.facts![0].value).toContain('不一致')
    expect(result.facts![0].reason).toContain('原因甲')
    expect(result.facts![0].reason).toContain('原因乙')
    expect(result.facts![0].sourceFile).toContain('甲.xls')
    expect(result.facts![0].sourceFile).toContain('乙.xls')
  })

  it('新能源查询前一日并按targetDate对齐，不从operateDate猜缺失目标日', async () => {
    fetchCaptured.mockImplementation(async (_family: string, dataset: string) => real(dataset === 'new_energy_forecast_d1'
      ? [row(40, '00:00', { operateDate: '2026-08-31', targetDate: '2026-09-01' }), row(999, '00:15', { operateDate: '2026-08-31' })]
      : [row(50), row(30, '00:15')]))
    const result = await loadDisclosureDeskSeries({ ...params, metricId: 'new-energy' })
    expect(fetchCaptured).toHaveBeenCalledWith('yn_system_forecast', 'new_energy_forecast_d1', { region: 'yunnan', dateFrom: '2026-08-31', dateTo: '2026-08-31', limit: 12000 })
    expect(result.series[2].points.slice(0, 2).map((point) => point.value)).toEqual([10, null])
  })

  it('RT－DA手算并集断线，不让一侧缺价产生假价差', async () => {
    fetchCaptured.mockImplementation(async (_family: string, dataset: string) => real(dataset === 'da_user_price'
      ? [row(100), row(0, '01:00'), row(20, '02:00')]
      : [row(80), row(-5, '01:00'), row(30, '03:00')]))
    const result = await loadDisclosureDeskSeries(params)
    expect(result.series.map((series) => series.id)).toEqual(['da', 'rt', 'spread'])
    expect(result.series[2].points.slice(0, 4).map((point) => point.value)).toEqual([-20, -5, null, null])
    expect(result.status).toBe('partial')
    expect(result.latestAt).toBe('2026-09-01 03:00')
  })

  it('任意框选按原生时槽重叠统计，保留精确秒边界且不延续日标量', () => {
    const price = getDisclosureDeskMetric('price')!
    const series = buildDisclosureDeskSeries(price, price.sources[0], [row(100, '10:00'), row(200, '11:00')], params)
    expect(summarizeDisclosureDeskSeries(series, '2026-09-01T10:15:00+08:00', '2026-09-01T10:45:00+08:00')).toMatchObject({ mean: 100, validPoints: 1, expectedPoints: 1 })
    expect(summarizeDisclosureDeskSeries(series, '2026-09-01T10:59:59+08:00', '2026-09-01T11:00:00+08:00')).toMatchObject({ mean: 150, validPoints: 2 })
    expect(summarizeDisclosureDeskSeries(series, '2026-09-01 11:00', '2026-09-01 11:30')).toMatchObject({ mean: 200, validPoints: 1 })
    const load = getDisclosureDeskMetric('load')!
    const quarter = buildDisclosureDeskSeries(load, load.sources[0], [row(10, '10:00'), row(30, '10:15')], { ...params, metricId: 'load' })
    expect(summarizeDisclosureDeskSeries(quarter, '2026-09-01 10:07', '2026-09-01 10:20')).toMatchObject({ mean: 20, validPoints: 2 })
    const scalar = getDisclosureDeskMetric('maintenance-capacity')!
    const daily = buildDisclosureDeskSeries(scalar, scalar.sources[0], [row(300)], { ...params, metricId: scalar.id })
    expect(summarizeDisclosureDeskSeries(daily, '2026-09-01 10:00', '2026-09-01 11:00')).toMatchObject({ validPoints: 0, mean: null })
    expect(summarizeDisclosureDeskSeries(series, 'invalid', '2026-09-01 11:00').validPoints).toBe(0)
  })

  it('悬停匹配时槽，缺测/过尾/翌日不取旧价，未知日标量没有持续时长', () => {
    const price = getDisclosureDeskMetric('price')!
    const series = buildDisclosureDeskSeries(price, price.sources[0], [row(100, '10:00'), row(200, '23:00')], params)
    expect(findDisclosureDeskPointAt(series, '2026-09-01T10:59:59+08:00')?.value).toBe(100)
    expect(findDisclosureDeskPointAt(series, '2026-09-01T11:00:00+08:00')?.value).toBeNull()
    expect(findDisclosureDeskPointAt(series, '2026-09-01T23:59:59+08:00')?.value).toBe(200)
    expect(findDisclosureDeskPointAt(series, '2026-09-02T00:00:00+08:00')).toBeUndefined()
    expect(findDisclosureDeskPointAt(series, 'invalid')).toBeUndefined()
    const sparse = { ...series, points: [{ time: '2026-09-01 10:00', value: 100 }] }
    expect(findDisclosureDeskPointAt(sparse, '2026-09-01 11:00')).toBeUndefined()
    expect(findDisclosureDeskPointAt({ ...sparse, nativeMinutes: null }, '2026-09-01 10:00')?.value).toBe(100)
    expect(findDisclosureDeskPointAt({ ...sparse, nativeMinutes: null }, '2026-09-01 10:01')).toBeUndefined()
  })
})

describe('取数及诚实空态', () => {
  it('一次读取即自动选择有效本省通道并生成曲线，过期选择在当前日期内恢复', async () => {
    fetchCaptured.mockResolvedValue(real([row(100, '00:00', { channelName: '云南总送出', regionName: '云南' }), row(900, '00:00', { channelName: '别省', regionName: '广东' })]))
    const first = await loadDisclosureDeskSeries({ ...params, metricId: 'transmission' })
    expect(first).toMatchObject({ status: 'partial', channels: ['云南总送出 · 云南'], selectedChannel: '云南总送出 · 云南' })
    expect(first.series[0].points[0].value).toBe(100)
    expect(fetchCaptured).toHaveBeenCalledTimes(1)
    const stale = await loadDisclosureDeskSeries({ ...params, metricId: 'transmission', channel: '旧通道' })
    expect(stale.selectedChannel).toBe('云南总送出 · 云南')
    const chosen = await loadDisclosureDeskSeries({ ...params, metricId: 'transmission', channel: first.channels[0] })
    expect(chosen.series[0].points[0].value).toBe(100)
  })

  it('备用类型保持独立，日级标量不冒充96点', async () => {
    fetchCaptured.mockResolvedValue(real([row(100, '00:00', { regionName: '云南', dataType: '正备用' }), row(10, '00:00', { regionName: '云南', dataType: '负备用' })]))
    const reserve = await loadDisclosureDeskSeries({ ...params, metricId: 'reserve' })
    expect(reserve.channels).toEqual(expect.arrayContaining(['云南 · 正备用', '云南 · 负备用']))
    fetchCaptured.mockResolvedValue(real([row(0, '', { region: undefined })]))
    const scalar = await loadDisclosureDeskSeries({ ...params, metricId: 'maintenance-capacity' })
    expect(scalar.series[0]).toMatchObject({ nativeMinutes: null, step: false })
    expect(scalar.series[0].points).toEqual([{ time: '2026-09-01 00:00', value: 0 }])
  })

  it('调峰需求保留原文事项，不把是/否编码成连续功率', async () => {
    fetchCaptured.mockResolvedValue(real([row(null, '', { regionName: '云南', textValue: '否' })]))
    const choose = await loadDisclosureDeskSeries({ ...params, metricId: 'peak-regulation' })
    expect(choose).toMatchObject({ status: 'available', selectedChannel: '云南' })
    const result = await loadDisclosureDeskSeries({ ...params, metricId: 'peak-regulation', channel: '云南' })
    expect(result).toMatchObject({ status: 'available', series: [], facts: [{ label: '是否开展调峰', value: '否', time: '2026-09-01' }] })
  })

  it('未知指标和不支持地区不发请求，已支持地区也显式绑定请求地区', async () => {
    await expect(loadDisclosureDeskSeries({ ...params, metricId: 'legacy-unknown' })).rejects.toThrow('未登记')
    expect((await loadDisclosureDeskSeries({ ...params, regionId: 'shanxi' })).status).toBe('not-configured')
    expect((await loadDisclosureDeskSeries({ ...params, regionId: 'guangdong' })).status).toBe('not-configured')
    expect(fetchCaptured).not.toHaveBeenCalled()
    await loadDisclosureDeskSeries({ ...params, regionId: 'guangdong', metricId: 'load' })
    expect(fetchCaptured).toHaveBeenCalledWith('yn_system_forecast', 'load_actual', expect.objectContaining({ region: 'guangdong' }))
  })

  it.each([
    { mock: true, sourceType: 'MOCK' },
    { sourceType: 'IMPORT', region_served: 'shanxi' },
    { sourceType: 'IMPORT', region_fallback: true },
    { provenance: { sourceType: 'DB', realDataConnected: true, region: 'shanxi' } },
    { sourceType: 'IMPORT', productionWrite: true },
    {},
  ])('拒绝模拟、回退、来源不明和写入数据：%j', async (metadata) => {
    fetchCaptured.mockResolvedValue({ ...metadata, data: [row(123)] })
    const result = await loadDisclosureDeskSeries(params)
    expect(result.status).toBe('missing')
    expect(result.summary.every((item) => item.validPoints === 0)).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('拒绝、失败、无数据和截断各自显式保留', async () => {
    fetchCaptured.mockResolvedValue({ code: 403, accessDenied: true, data: [] })
    expect((await loadDisclosureDeskSeries(params)).status).toBe('unauthorized')
    fetchCaptured.mockRejectedValue(new Error('503'))
    expect((await loadDisclosureDeskSeries(params)).status).toBe('error')
    fetchCaptured.mockResolvedValue(real([]))
    expect((await loadDisclosureDeskSeries(params)).status).toBe('missing')
    fetchCaptured.mockResolvedValue({ ...real([row(10)]), _filter: { truncated: true } })
    expect((await loadDisclosureDeskSeries(params)).warnings.join('')).toContain('不完整')
  })

  it.each([
    [404, 'capture family not found: yn_disclosure_metric', 'not-configured', '当前地区尚未接入“省间联络线实际”数据'],
    [404, 'no captured file in yn_disclosure_metric matching "actual_interprov_tie_line"', 'missing', '所选日期暂无该口径数据'],
    [401, '未登录', 'unauthorized', '当前账号无读取权限'],
    [403, '禁止访问', 'unauthorized', '当前账号无读取权限'],
    [404, 'route not found', 'error', '数据读取失败'],
    [404, 'capture family not found: other_family', 'error', '数据读取失败'],
    [404, 'no captured file in yn_disclosure_metric matching "other_dataset"', 'error', '数据读取失败'],
    [500, 'capture family not found: yn_disclosure_metric', 'error', '数据读取失败'],
  ])('接口 %i %s 的空态为 %s，不把其他404或服务器失败当缺数', async (status, message, expectedStatus, reason) => {
    fetchCaptured.mockRejectedValue(apiError(status as number, message as string))
    const result = await loadDisclosureDeskSeries({ ...params, metricId: 'transmission' })
    expect(result.status).toBe(expectedStatus)
    expect(result.reason).toContain(reason)
    expect(result.summary.every((item) => item.validPoints === 0)).toBe(true)
    expect(result.channels).toEqual([])
    expect(fetchCaptured).toHaveBeenCalledTimes(1)
  })

  it('文本事项同样区分未接入、权限、失败与缺数据，不以无披露掩盖异常', async () => {
    const textParams = { ...params, metricId: 'peak-regulation' }
    fetchCaptured.mockRejectedValue(apiError(404, 'capture family not found: yn_disclosure_metric'))
    expect(await loadDisclosureDeskSeries(textParams)).toMatchObject({ status: 'not-configured', reason: '当前地区尚未接入“日前调峰需求”数据' })
    fetchCaptured.mockResolvedValue({ code: 403, accessDenied: true, data: [] })
    expect(await loadDisclosureDeskSeries(textParams)).toMatchObject({ status: 'unauthorized', reason: '当前账号无读取权限' })
    fetchCaptured.mockRejectedValue(apiError(500, 'database unavailable'))
    expect(await loadDisclosureDeskSeries(textParams)).toMatchObject({ status: 'error', reason: '数据读取失败，请重试' })
    fetchCaptured.mockResolvedValue(real([]))
    expect(await loadDisclosureDeskSeries(textParams)).toMatchObject({ status: 'missing', reason: '所选日期暂无调峰需求披露' })
  })

  it('部分日分片失败时保留真实样本，已知缺数不覆盖同范围的服务错误', async () => {
    fetchCaptured.mockRejectedValueOnce(apiError(404, 'capture family not found: yn_disclosure_metric'))
      .mockResolvedValueOnce(real([row(0, '00:00', { operateDate: '2026-09-02', channelName: '云南总送出' })]))
    const range = { ...params, metricId: 'transmission', dateTo: '2026-09-02', channel: '云南总送出' }
    const result = await loadDisclosureDeskSeries(range)
    expect(result.status).toBe('partial')
    expect(result.summary[0].validPoints).toBe(1)
    expect(result.series[0].points[0].value).toBeNull()
    expect(result.series[0].points.find((point) => point.time === '2026-09-02 00:00')?.value).toBe(0)
    fetchCaptured.mockRejectedValueOnce(apiError(404, 'capture family not found: yn_disclosure_metric'))
      .mockRejectedValueOnce(apiError(500, 'database unavailable'))
    expect((await loadDisclosureDeskSeries(range)).status).toBe('error')
  })

  it.each(['section-load', 'channel-capacity', 'reserve', 'peak-regulation'])('%s 单个有效对象自动选中，数值与原文都参与可用性判断', async (metricId) => {
    fetchCaptured.mockResolvedValue(real([row(100, '00:00', { channelName: '明确对象', regionName: '云南', textValue: '否' })]))
    expect(await loadDisclosureDeskSeries({ ...params, metricId })).toMatchObject({ selectedChannel: '明确对象 · 云南' })
    expect(fetchCaptured).toHaveBeenCalledTimes(1)
  })

  it('接受已核验的capture-db真实信封与统一用户价all行', async () => {
    fetchCaptured.mockResolvedValue({ code: 200, data: [row(150.148, '00:00', { region: 'all' })], provenance: { sourceType: 'DB', realDataConnected: true, region: 'yunnan' } })
    const result = await loadDisclosureDeskSeries(params)
    expect(result.sourceType).toBe('DB')
    expect(result.series[0].points[0].value).toBe(150.148)
  })

  it('一侧失败不隐藏另一侧，按日分片并拒绝超大或非法日期窗口', async () => {
    fetchCaptured.mockImplementation(async (_family: string, dataset: string) => { if (dataset === 'da_user_price') throw new Error('503'); return real([row(80)]) })
    const partial = await loadDisclosureDeskSeries(params)
    expect(partial.status).toBe('partial')
    expect(partial.series[1].points[0].value).toBe(80)
    expect(partial.series[2].points[0].value).toBeNull()
    vi.clearAllMocks()
    expect((await loadDisclosureDeskSeries({ ...params, dateFrom: '2026-02-30' })).status).toBe('error')
    expect((await loadDisclosureDeskSeries({ ...params, dateTo: '2026-12-31' })).reason).toContain('31 天')
    expect(fetchCaptured).not.toHaveBeenCalled()
  })
})

describe('指标可用日期', () => {
  it('价格只读一次动态family coverage，缺数不重复请求或使用旧固定日期', async () => {
    apiGet.mockResolvedValue(coverage(['da_user_price', 'rt_user_price'].map((datasetKey) => ({ datasetKey, start: '2026-07-17', end: '2026-09-03' }))))
    expect(await loadDisclosureDeskCoverage('yunnan')).toEqual({ start: '2026-07-17', end: '2026-09-03' })
    expect(apiGet).toHaveBeenCalledTimes(1)
    expect(fetchCaptureCoverage).not.toHaveBeenCalled()
    apiGet.mockResolvedValue(coverage([]))
    expect(await loadDisclosureDeskCoverage('yunnan')).toBeNull()
    expect(await loadDisclosureDeskCoverage('shanxi')).toBeNull()
    expect(await loadDisclosureDeskCoverage('yunnan', 'legacy')).toBeNull()
  })

  it('新能源覆盖区间按targetDate移日后与实际求交，备用读取自己的族', async () => {
    apiGet.mockResolvedValue(coverage([{ datasetKey: 'new_energy_forecast_d1', start: '2026-08-01', end: '2026-09-02' }, { datasetKey: 'new_energy_actual', start: '2026-08-01', end: '2026-09-03' }]))
    expect(await loadDisclosureDeskCoverage('yunnan', 'new-energy')).toEqual({ start: '2026-08-02', end: '2026-09-03' })
    apiGet.mockResolvedValue(coverage([{ datasetKey: 'forecast_reserve', start: '2026-08-01', end: '2026-09-06' }], 'yn_disclosure_metric'))
    expect(await loadDisclosureDeskCoverage('yunnan', 'reserve')).toEqual({ start: '2026-08-01', end: '2026-09-06' })
    expect(apiGet).toHaveBeenLastCalledWith('/api/real-coverage', { family: 'yn_disclosure_metric', region: 'yunnan' })
    apiGet.mockRejectedValue(new Error('503'))
    expect(await loadDisclosureDeskCoverage('yunnan', 'reserve')).toBeNull()
  })

  it('只有一侧价格数据也给最近可用日，并明确partial，不制造配对', async () => {
    apiGet.mockResolvedValue(coverage([{ datasetKey: 'rt_user_price', start: '2026-08-01', end: '2026-09-03' }]))
    expect(await loadDisclosureDeskCoverage('yunnan')).toMatchObject({ start: '2026-08-01', end: '2026-09-03', partial: true })
    apiGet.mockResolvedValue(coverage([{ datasetKey: 'load_forecast', start: '2026-08-01', end: '2026-08-15' }, { datasetKey: 'load_actual', start: '2026-09-01', end: '2026-09-03' }]))
    expect(await loadDisclosureDeskCoverage('yunnan', 'load')).toMatchObject({ start: '2026-09-01', end: '2026-09-03', partial: true })
  })
})

describe('主题覆盖登记数量', () => {
  it('每族只读一次元数据，窗口外与空族不冒充可用指标，价差不重复计数', async () => {
    apiGet.mockImplementation(async (_path: string, query: { family: string; region: string }) => ({ code: 200, data: { ...query, datasets: query.family === 'yn_system_forecast' ? [
      { datasetKey: 'da_user_price', start: '2026-07-01', end: '2026-07-02' },
      { datasetKey: 'rt_user_price', start: '2026-07-01', end: '2026-07-01' },
      { datasetKey: 'load_actual', start: '2026-06-01', end: '2026-06-30' },
      { datasetKey: 'hydro_actual', start: '2026-07-01', end: '2026-07-01' },
    ] : [] } }))
    expect(await loadDisclosureDeskThemeAvailability('yunnan', '2026-07-01', '2026-07-01')).toEqual({
      price: { available: 1, total: 1 }, load: { available: 0, total: 2 },
      'new-energy': { available: 1, total: 2 }, reserve: { available: 0, total: 3 },
      maintenance: { available: 0, total: 1 }, transmission: { available: 0, total: 9 }, intervention: { available: 0, total: 0 },
    })
    expect(apiGet).toHaveBeenCalledTimes(2)
    expect(apiGet).toHaveBeenCalledWith('/api/real-coverage', { family: 'yn_disclosure_metric', region: 'yunnan' })
    expect(fetchCaptured).not.toHaveBeenCalled()
    expect(fetchCaptureCoverage).not.toHaveBeenCalled()
  })

  it('D-1覆盖转到目标日，单侧登记可用；无效边界和零行登记不计数', async () => {
    apiGet.mockImplementation(async (_path: string, query: { family: string; region: string }) => ({ code: 200, data: { ...query, datasets: [
      { datasetKey: 'new_energy_forecast_d1', start: '2026-08-31', end: '2026-08-31' },
      { datasetKey: 'hydro_actual', start: '2026-09-02', end: '2026-09-01' },
      { datasetKey: 'load_actual', start: '2026-09-01', end: '2026-09-01', rows: 0 },
      { datasetKey: 'forecast_reserve', start: '2026-02-30', end: '2026-09-01' },
    ] } }))
    const result = await loadDisclosureDeskThemeAvailability('yunnan', '2026-09-01', '2026-09-01')
    expect(result['new-energy']).toEqual({ available: 1, total: 2 })
    expect(result.load?.available).toBe(0)
    expect(result.reserve?.available).toBe(0)
  })

  it('接口失败或返回地区/族不符保持未知，不报告零；非法输入不请求', async () => {
    apiGet.mockImplementation(async (_path: string, query: { family: string; region: string }) => {
      if (query.family === 'yn_system_forecast') throw new Error('503')
      return { code: 200, data: { ...query, region: 'guangdong', datasets: [] } }
    })
    const result = await loadDisclosureDeskThemeAvailability('yunnan', '2026-09-01', '2026-09-01')
    expect(result.price).toBeUndefined()
    expect(result.reserve).toBeUndefined()
    apiGet.mockResolvedValue({ code: 200, data: { family: 'wrong', region: 'yunnan', datasets: [] } })
    expect((await loadDisclosureDeskThemeAvailability('yunnan', '2026-09-01', '2026-09-01')).load).toBeUndefined()
    apiGet.mockClear()
    expect(await loadDisclosureDeskThemeAvailability('shanxi', '2026-09-01', '2026-09-01')).toEqual({})
    expect(await loadDisclosureDeskThemeAvailability('yunnan', '2026-02-30', '2026-09-01')).toEqual({})
    expect(await loadDisclosureDeskThemeAvailability('yunnan', '2026-09-02', '2026-09-01')).toEqual({})
    expect(apiGet).not.toHaveBeenCalled()
  })
})

let scopeSequence = 0
const context = () => ({ scopeKey: `desk-cache-test-${++scopeSequence}`, refreshKey: 0 })
describe('自动对象与公开数据短缓存', () => {
  it('保留有效指定对象、其次偏好和本省，排除空样本、冲突、异日与无效粒度，不换交易日', async () => {
    fetchCaptured.mockResolvedValue(real([
      row(99, '00:00', { channelName: '全网通道' }), row(0, '00:00', { channelName: '云南有效通道' }),
      row(null, '00:00', { channelName: '云南空对象' }), row(80, '00:07', { channelName: '云南错粒度' }),
      row(90, '00:00', { channelName: '云南历史对象', operateDate: '2026-08-31' }),
      row(90, '00:00', { channelName: '云南错单位', unit: 'MWh' }),
      row(100, '00:00', { channelName: '云南冲突' }), row(200, '00:00', { channelName: '云南冲突' }),
    ]))
    const query = { ...params, ...context(), metricId: 'transmission' }
    const first = await loadDisclosureDeskSeries(query)
    expect(first.channels).toEqual(['全网通道', '云南有效通道'])
    expect(first.selectedChannel).toBe('云南有效通道')
    expect(first.series[0].points[0].value).toBe(0)
    expect((await loadDisclosureDeskSeries({ ...query, channel: '全网通道', preferredChannel: '云南有效通道' })).selectedChannel).toBe('全网通道')
    expect((await loadDisclosureDeskSeries({ ...query, preferredChannel: '全网通道' })).selectedChannel).toBe('全网通道')
    expect((await loadDisclosureDeskSeries({ ...query, channel: '过期', preferredChannel: '也过期' })).selectedChannel).toBe('云南有效通道')
    expect(fetchCaptured).toHaveBeenCalledTimes(1)
    expect(apiGet).not.toHaveBeenCalled()
    expect(fetchCaptured).toHaveBeenCalledWith('yn_disclosure_metric', 'actual_interprov_tie_line', expect.objectContaining({ dateFrom: params.dateFrom, dateTo: params.dateTo }))
  })

  it('相同scope公开日期片合并并行请求，切换对象复用原始数据；没有scope不缓存', async () => {
    let resolve!: (body: ReturnType<typeof real>) => void
    fetchCaptured.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const query = { ...params, ...context(), metricId: 'transmission' }
    const first = loadDisclosureDeskSeries(query), second = loadDisclosureDeskSeries(query)
    expect(fetchCaptured).toHaveBeenCalledTimes(1)
    resolve(real([row(30, '00:00', { channelName: '甲' }), row(40, '00:00', { channelName: '乙' })]))
    await Promise.all([first, second])
    expect((await loadDisclosureDeskSeries({ ...query, channel: '乙' })).series[0].points[0].value).toBe(40)
    expect(fetchCaptured).toHaveBeenCalledTimes(1)
    await loadDisclosureDeskSeries({ ...query, scopeKey: undefined })
    await loadDisclosureDeskSeries({ ...query, scopeKey: undefined })
    expect(fetchCaptured).toHaveBeenCalledTimes(3)
  })

  it('scope、地区、日期、dataset独立；刷新强制重读且旧代完成不会污染新缓存', async () => {
    let resolveOld!: (body: ReturnType<typeof real>) => void
    fetchCaptured.mockImplementationOnce(() => new Promise((done) => { resolveOld = done }))
    const query = { ...params, ...context(), metricId: 'transmission' }
    const old = loadDisclosureDeskSeries(query)
    fetchCaptured.mockResolvedValue(real([row(7, '00:00', { channelName: '通道' })]))
    const fresh = { ...query, refreshKey: 1 }
    expect((await loadDisclosureDeskSeries(fresh)).series[0].points[0].value).toBe(7)
    resolveOld(real([row(999, '00:00', { channelName: '通道' })])); await old
    expect((await loadDisclosureDeskSeries(fresh)).series[0].points[0].value).toBe(7)
    expect(fetchCaptured).toHaveBeenCalledTimes(2)
    await loadDisclosureDeskSeries(query)
    await loadDisclosureDeskSeries(fresh)
    expect(fetchCaptured).toHaveBeenCalledTimes(3)
    await loadDisclosureDeskSeries({ ...fresh, scopeKey: `${fresh.scopeKey}-company-b` })
    await loadDisclosureDeskSeries({ ...fresh, regionId: 'guangdong' })
    await loadDisclosureDeskSeries({ ...fresh, dateFrom: '2026-09-02', dateTo: '2026-09-02' })
    await loadDisclosureDeskSeries({ ...fresh, metricId: 'key-channel' })
    expect(fetchCaptured).toHaveBeenCalledTimes(7)
  })

  it.each([
    { code: 403, accessDenied: true, data: [] },
    { code: 500, ...real([]) },
    { mock: true, sourceType: 'MOCK', data: [] },
    { sourceType: 'IMPORT', region_served: 'shanxi', data: [] },
    { sourceType: 'IMPORT', region_fallback: true, data: [] },
    { sourceType: 'IMPORT', productionWrite: true, data: [] },
    { provenance: { sourceType: 'DB', realDataConnected: false }, data: [] },
    { ...real([]), _filter: { truncated: true } },
    { data: [] },
  ])('权限、异常或未证实完整真实来源不留缓存：%j', async (body) => {
    const query = { ...params, ...context(), metricId: 'transmission' }
    fetchCaptured.mockResolvedValue(body)
    await loadDisclosureDeskSeries(query); await loadDisclosureDeskSeries(query)
    expect(fetchCaptured).toHaveBeenCalledTimes(2)
  })

  it('网络异常不缓存，成功后30秒内复用、TTL后重新读取', async () => {
    const query = { ...params, ...context(), metricId: 'transmission' }
    fetchCaptured.mockRejectedValueOnce(new Error('network')).mockResolvedValue(real([row(0, '00:00', { channelName: '通道' })]))
    const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    expect((await loadDisclosureDeskSeries(query)).status).toBe('error')
    expect((await loadDisclosureDeskSeries(query)).selectedChannel).toBe('通道')
    clock.mockReturnValue(now + 29_999)
    await loadDisclosureDeskSeries(query)
    expect(fetchCaptured).toHaveBeenCalledTimes(2)
    clock.mockReturnValue(now + 30_001)
    await loadDisclosureDeskSeries(query)
    expect(fetchCaptured).toHaveBeenCalledTimes(3)
  })

  it('价格coverage与所有主题在冷加载合并为两族请求，切日期复用元数据、刷新重读', async () => {
    const cache = context()
    apiGet.mockImplementation(async (_path: string, query: { family: string; region: string }) => coverage(['da_user_price', 'rt_user_price'].map((datasetKey) => ({ datasetKey, start: '2026-07-01', end: '2026-09-01' })), query.family, query.region))
    await Promise.all([loadDisclosureDeskCoverage('yunnan', 'price', cache), loadDisclosureDeskThemeAvailability('yunnan', params.dateFrom, params.dateTo, cache), loadDisclosureDeskCoverage('yunnan', 'load', cache)])
    expect(apiGet).toHaveBeenCalledTimes(2)
    await loadDisclosureDeskThemeAvailability('yunnan', '2026-08-01', '2026-08-07', cache)
    expect(apiGet).toHaveBeenCalledTimes(2)
    await Promise.all([loadDisclosureDeskCoverage('yunnan', 'price', { ...cache, refreshKey: 1 }), loadDisclosureDeskThemeAvailability('yunnan', params.dateFrom, params.dateTo, { ...cache, refreshKey: 1 })])
    expect(apiGet).toHaveBeenCalledTimes(4)
    expect(fetchCaptureCoverage).not.toHaveBeenCalled()
  })

  it('coverage失败和scope不符均不缓存、不显示错误地区范围', async () => {
    const cache = context()
    apiGet.mockRejectedValueOnce(new Error('network')).mockResolvedValue(coverage([], 'yn_system_forecast', 'guangdong'))
    expect(await loadDisclosureDeskCoverage('yunnan', 'price', cache)).toBeNull()
    expect(await loadDisclosureDeskCoverage('yunnan', 'price', cache)).toBeNull()
    expect(await loadDisclosureDeskCoverage('yunnan', 'price', cache)).toBeNull()
    expect(apiGet).toHaveBeenCalledTimes(3)
  })

  it('缓存有界，超出容量会淘汰旧条目而不是无限积累日期片', async () => {
    const cache = context(), read = vi.fn(async () => 1)
    for (let index = 0; index < 65; index += 1) await readDisclosureDeskCached('yunnan', cache, ['bound-test', String(index)], read, () => true)
    expect(read).toHaveBeenCalledTimes(65)
    await readDisclosureDeskCached('yunnan', cache, ['bound-test', '64'], read, () => true)
    expect(read).toHaveBeenCalledTimes(65)
    await readDisclosureDeskCached('yunnan', cache, ['bound-test', '0'], read, () => true)
    expect(read).toHaveBeenCalledTimes(66)
  })
})
