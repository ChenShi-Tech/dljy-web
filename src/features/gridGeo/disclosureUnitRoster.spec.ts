import { beforeEach, describe, expect, it, vi } from 'vitest'
const { fetchCaptured, apiGet } = vi.hoisted(() => ({ fetchCaptured: vi.fn(), apiGet: vi.fn() }))
vi.mock('@/services/captured', () => ({ fetchCaptured }))
vi.mock('@/services/region/regionContext', () => ({ currentRegion: { value: { id: 'yunnan' } } }))
vi.mock('@/services/api', async (original) => ({ ...await original<typeof import('@/services/api')>(), apiGet }))
import { compareUnitRosterDays, loadDisclosureUnitRoster, normalizeUnitRosterRows, UNIT_ROSTER_DATASET, unitRosterDates } from './disclosureUnitRoster'

const params = { regionId: 'yunnan', dateFrom: '2026-07-01', dateTo: '2026-07-01' }
const row = (extra: Record<string, unknown> = {}) => ({ operateDate: '2026-07-01', regionName: '云南', plantName: '宣威电厂', unitName: '#1', textValue: '必开', sourceFile: '20260701必开必停机组名单.xls', ...extra })
const real = (data: Record<string, unknown>[]) => ({ sourceType: 'IMPORT', mock: false, data })
function coverage(start = '2026-06-01', end = '2026-07-01') { return { code: 200, data: { family: 'yn_disclosure_metric', region: 'yunnan', datasets: [{ datasetKey: UNIT_ROSTER_DATASET, start, end }] } } }
function day(date: string, rows: Record<string, unknown>[]) { return normalizeUnitRosterRows(rows.map((item) => row({ ...item, operateDate: date })), { ...params, dateFrom: date, dateTo: date }).days[0] }
beforeEach(() => { vi.resetAllMocks(); apiGet.mockResolvedValue(coverage()); fetchCaptured.mockResolvedValue(real([row()])) })

describe('必开必停日级名单', () => {
  it('从真实日期查前一可用日，跨过日期缺口，不把空天当作上一名单', async () => {
    fetchCaptured.mockImplementation(async (_family, _dataset, filter) => real(filter.dateTo === '2026-07-01' ? [row()] : [row({ operateDate: '2026-06-27', textValue: '必停' })]))
    const result = await loadDisclosureUnitRoster(params)
    expect(result.baseline?.date).toBe('2026-06-27')
    expect(fetchCaptured).toHaveBeenNthCalledWith(2, 'yn_disclosure_metric', UNIT_ROSTER_DATASET, { region: 'yunnan', dateFrom: '2026-06-01', dateTo: '2026-06-30', limit: 12000 })
    expect(compareUnitRosterDays(result.days[0], result.baseline).changes).toMatchObject([{ kind: 'changed', previous: { state: '必停' }, entry: { state: '必开' } }])
  })
  it('当前月没有旧名单时继续查覆盖范围，不能硬设固定一天或一个月', async () => {
    apiGet.mockResolvedValue(coverage('2026-04-01'))
    fetchCaptured.mockImplementation(async (_family, _dataset, filter) => real(filter.dateTo === '2026-07-01' ? [row()] : filter.dateFrom <= '2026-05-20' ? [row({ operateDate: '2026-05-20' })] : []))
    const result = await loadDisclosureUnitRoster(params)
    expect(result.baseline?.date).toBe('2026-05-20')
    expect(fetchCaptured).toHaveBeenCalledTimes(3)
  })
  it('不同电厂的同名机组分别比较，状态改变不重复计新增和移除', () => {
    const comparison = compareUnitRosterDays(day('2026-07-01', [{}, { plantName: '曲靖电厂' }, { unitName: '#2' }]), day('2026-06-27', [{ textValue: '必停' }, { plantName: '曲靖电厂' }, { unitName: '#3' }]))
    expect(comparison.changes.map((change) => change.kind).sort()).toEqual(['added', 'changed', 'removed'])
    expect(comparison.changes.find((change) => change.kind === 'changed')?.entry.plantName).toBe('宣威电厂')
  })
  it('当前或上一名单缺失时不把全员算新增或移除', () => {
    expect(compareUnitRosterDays(day('2026-07-01', [{}]), null)).toMatchObject({ available: false, changes: [] })
    expect(compareUnitRosterDays(null, day('2026-06-27', [{}]))).toMatchObject({ available: false, changes: [] })
  })
  it('同机组必开必停双方保留，明确拒绝冲突日变化计算', () => {
    const current = day('2026-07-01', [{}, { textValue: '必停' }])
    expect(current.entries).toHaveLength(2)
    expect(new Set(current.entries.map((entry) => entry.key)).size).toBe(2)
    expect(compareUnitRosterDays(current, day('2026-06-27', [{}]))).toMatchObject({ available: false, changes: [], reason: '同一机组存在多个状态，暂不计算名单变化' })
    expect(compareUnitRosterDays(day('2026-07-01', [{}]), day('2026-06-27', [{ qualityFlags: ['conflicting-status'] }]))).toMatchObject({ available: false, changes: [] })
  })
  it('过滤他省与范围外行，缺字段标不完整；源导入时刻不冒充发布时间', () => {
    const data = normalizeUnitRosterRows([row({ sourceRecordId: 11, sourceImportedAt: '2026-09-10 08:00:00' }), row({ regionName: '广东' }), row({ operateDate: '2026-06-30' }), row({ unitName: '' })], params)
    expect(data.incomplete).toBe(true)
    expect(data.days[0].entries).toHaveLength(1)
    expect(data.days[0].entries[0]).toMatchObject({ publishedAt: '', importedAt: '2026-09-10 08:00:00', sourceRecordId: '11', reason: '' })
  })
  it('覆盖只提供首尾日期；最早可用日没有基线时不生成变化', async () => {
    apiGet.mockResolvedValue(coverage('2026-07-01'))
    const result = await loadDisclosureUnitRoster(params)
    expect(result).toMatchObject({ status: 'available', baseline: null, comparisonStatus: 'missing' })
    expect(fetchCaptured).toHaveBeenCalledTimes(1)
  })
  it('部分当前返回仍可查看但不使用不完整名单做比较', async () => {
    fetchCaptured.mockResolvedValue({ ...real([row()]), _filter: { truncated: true } })
    const result = await loadDisclosureUnitRoster(params)
    expect(result.status).toBe('partial')
    expect(result.baseline).toBeNull()
    expect(result.days[0].entries).toHaveLength(1)
    expect(fetchCaptured).toHaveBeenCalledTimes(1)
  })
  it('历史读取失败不能当作无基线的新增', async () => {
    fetchCaptured.mockResolvedValueOnce(real([row()])).mockRejectedValueOnce(new Error('timeout'))
    const result = await loadDisclosureUnitRoster(params)
    expect(result.status).toBe('available')
    expect(result.comparisonStatus).toBe('error')
    expect(result.baseline).toBeNull()
  })
  it('覆盖失败或异地区覆盖不用于寻找上一日，当前真实名单仍可读', async () => {
    apiGet.mockRejectedValueOnce(new Error('timeout'))
    expect(await loadDisclosureUnitRoster(params)).toMatchObject({ status: 'available', comparisonStatus: 'error', baseline: null })
    apiGet.mockResolvedValueOnce({ ...coverage(), data: { ...coverage().data, region: 'guangdong' } })
    expect(await loadDisclosureUnitRoster(params)).toMatchObject({ status: 'available', comparisonStatus: 'error', baseline: null })
  })
  it('拒绝未授权、模拟、异地区和来源不明的返回', async () => {
    for (const body of [{ accessDenied: true }, { ...real([row()]), mock: true }, { ...real([row()]), sourceType: 'MOCK', provenance: { realDataConnected: true } }, { ...real([row()]), region_served: 'guangdong' }, { data: [row()] }]) {
      fetchCaptured.mockResolvedValueOnce(body)
      const result = await loadDisclosureUnitRoster(params)
      expect(['unauthorized', 'error']).toContain(result.status)
      expect(result.days).toEqual([])
    }
  })
  it('过期请求不继续向前扫描历史，范围校验不发无界查询', async () => {
    const result = await loadDisclosureUnitRoster(params, () => false)
    expect(result.baseline).toBeNull()
    expect(fetchCaptured).toHaveBeenCalledTimes(1)
    expect(unitRosterDates('2026-02-30', '2026-03-01')).toEqual([])
    expect(unitRosterDates('2026-01-01', '2026-12-31')).toEqual([])
    fetchCaptured.mockClear()
    expect(await loadDisclosureUnitRoster({ ...params, dateFrom: 'wrong' })).toMatchObject({ status: 'error' })
    expect(fetchCaptured).not.toHaveBeenCalled()
  })
})
