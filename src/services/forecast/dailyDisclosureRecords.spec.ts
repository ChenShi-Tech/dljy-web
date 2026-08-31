import { beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ get: vi.fn() }))
const company = vi.hoisted(() => ({ value: 'test-company' }))
vi.mock('@/services/api', () => ({ apiGet: api.get }))
vi.mock('@/services/company/companyContext', () => ({ selectedCompanyId: company }))
vi.mock('@/services/region/regionCompany', () => ({ companyRegionId: (id: string) => id === 'other-region' ? 'guangdong' : null }))
import { loadDisclosureRecordCatalog, loadDisclosureRecordPage } from './dailyDisclosureRecords'

const date = '2026-06-25'
function page() {
  return { regionId: 'yunnan', date, datasetId: 'maintenance', columns: ['operate_date'], total: 1,
    items: [{ operate_date: date, '统计范围': '云南省内', '设备名称': '试验设备' }],
    page: 1, pageSize: 20, scopeCounts: { '云南省内': 1 }, sourceRowCount: 10, excludedRegionCount: 2,
    coverage: { from: '2025-07-01', to: '2026-07-02' }, source: { sourceTable: 'test', sourceFiles: ['test.xls'], license: '测试夹具', originalUrl: null },
    dataAvailability: { status: 'available', fallback: false, reason: '测试记录' } }
}
function envelope(data: unknown, overrides = {}) { return { code: 200, data, sourceType: 'IMPORT', mock: false, productionWrite: false, ...overrides } }
beforeEach(() => { api.get.mockReset(); company.value = 'test-company' })

describe('当日原文服务守卫', () => {
  it('目录与分页都传递当前授权公司/地区，使用统一认证API', async () => {
    api.get.mockResolvedValueOnce(envelope({ regionId: 'yunnan', datasets: [{ id: 'maintenance', title: '检修', description: '记录' }] }))
    await loadDisclosureRecordCatalog('yunnan')
    expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('/daily-records/catalog'), { region: 'yunnan', company: 'test-company' }, undefined)
    api.get.mockResolvedValueOnce(envelope({ ...page(), page: 2 }))
    await loadDisclosureRecordPage('yunnan', date, 'maintenance', { page: 2, keyword: '  机组  ' })
    expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('/daily-records'), expect.objectContaining({ company: 'test-company', date, dataset: 'maintenance', page: 2, pageSize: 20, keyword: '机组' }), undefined)
  })
  it.each(['guangdong', 'all'])('不接受未接地区%s', async (region) => {
    await expect(loadDisclosureRecordCatalog(region)).rejects.toThrow('仅接入云南')
    expect(api.get).not.toHaveBeenCalled()
  })
  it.each(['', 'other-region'])('未选公司/跨区公司不请求：%s', async (id) => {
    company.value = id
    await expect(loadDisclosureRecordCatalog('yunnan')).rejects.toThrow(/公司/)
    expect(api.get).not.toHaveBeenCalled()
  })
  it.each(['2026-02-30', '2026-99-99', '20260625'])('非法日期%s不请求', async (invalid) => {
    await expect(loadDisclosureRecordPage('yunnan', invalid, 'maintenance')).rejects.toThrow('有效的记录日期')
    expect(api.get).not.toHaveBeenCalled()
  })
  it.each([{ sourceType: 'MOCK' }, { mock: true }, { productionWrite: true }])('不显示非只读真实来源%j', async (overrides) => {
    api.get.mockResolvedValue(envelope(page(), overrides))
    await expect(loadDisclosureRecordPage('yunnan', date, 'maintenance')).rejects.toThrow('真实记录')
  })
  it.each([
    { regionId: 'guangdong' }, { date: '2026-06-26' }, { datasetId: 'other' }, { total: -1 },
    { items: [{ operate_date: date, '统计范围': '广东' }] },
    { items: [{ operate_date: '2026-06-26', '统计范围': '云南省内' }] },
    { dataAvailability: { status: 'empty', fallback: true } },
    { pageSize: 0 }, { page: 2 }, { scopeCounts: undefined }, { source: null }, { coverage: undefined },
    { sourceRowCount: -1 }, { scopeCounts: { '云南省内': '1' } }, { columns: [null] },
  ])('拒绝错日期/范围/响应%j', async (overrides) => {
    api.get.mockResolvedValue(envelope({ ...page(), ...overrides }))
    await expect(loadDisclosureRecordPage('yunnan', date, 'maintenance')).rejects.toThrow('不匹配')
  })
  it('全网记录只在有明确标签时通过', async () => {
    api.get.mockResolvedValue(envelope({ ...page(), items: [{ operate_date: date, '统计范围': '南网全网（未分省）' }] }))
    expect((await loadDisclosureRecordPage('yunnan', date, 'maintenance')).items).toHaveLength(1)
  })
  it('目录错地区拒绝，不把认证失败变成空数据', async () => {
    api.get.mockResolvedValueOnce(envelope({ regionId: 'guangdong', datasets: [] }))
    await expect(loadDisclosureRecordCatalog('yunnan')).rejects.toThrow('不匹配')
    api.get.mockRejectedValueOnce(new Error('无权访问'))
    await expect(loadDisclosureRecordCatalog('yunnan')).rejects.toThrow('无权访问')
  })
})
