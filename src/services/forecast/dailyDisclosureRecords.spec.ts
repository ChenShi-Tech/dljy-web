import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn() }))
const company = vi.hoisted(() => ({ value: 'test-company' }))
vi.mock('@/services/api', () => ({ apiGet: api.get }))
vi.mock('@/services/company/companyContext', () => ({ selectedCompanyId: company }))
vi.mock('@/services/region/regionCompany', () => ({ companyRegionId: (id: string) => id === 'other-region' ? 'guangdong' : null }))

import { loadDisclosureRecordCatalog, loadDisclosureRecordPage } from './dailyDisclosureRecords'

const date = '2026-06-25'
const categories = ['maintenance', 'outage', 'intervention', 'congestion', 'constraint']

function event(extra = {}) {
  return {
    eventId: 'csg-maintenance-1', providerId: 'csg-authorized-export', category: 'maintenance',
    title: '试验设备检修计划', summary: '设备；计划停电和复电时间已规范化。', regionId: 'yunnan',
    spatialBinding: { kind: 'region', ref: 'yunnan', label: '云南省内', coordinates: null },
    effectiveAt: '2026-06-24T16:00:00.000Z', expiresAt: '2026-06-25T10:00:00.000Z', publishedAt: null,
    source: {
      file: '原始.xls', recordId: '1', url: null, sourceTable: 'tb_disclosure_forecast_maintenance_plan',
      sourceType: 'IMPORT', mock: false, productionWrite: false, dataAvailability: 'available',
      license: '仅授权使用', originalLinkStatus: 'unavailable-in-export',
    },
    confidence: 'verified-source-row', importedAt: '2026-07-01T00:00:00.000Z', ...extra,
  }
}

function response(extra = {}) {
  return {
    items: [event()], total: 1, page: 1, pageSize: 20, categories,
    dataAvailability: { status: 'available', fallback: false, regionRequested: 'yunnan', reason: '真实授权导出行' },
    ...extra,
  }
}

function envelope(data: unknown, overrides = {}) {
  return { code: 200, data, sourceType: 'DB', mock: false, productionWrite: false, ...overrides }
}

beforeEach(() => {
  api.get.mockReset()
  company.value = 'test-company'
})

describe('当日规范化披露事件服务守卫', () => {
  it('从最新 events 端点读取类别，并传递当前授权公司和地区', async () => {
    api.get.mockResolvedValueOnce(envelope(response({ pageSize: 1 })))
    const catalog = await loadDisclosureRecordCatalog('yunnan')
    expect(catalog.datasets.map((item) => item.id)).toEqual(categories)
    expect(catalog.limitations?.join('')).toContain('规范化事件')
    expect(api.get).toHaveBeenLastCalledWith(
      expect.stringContaining('/disclosures/events'),
      { region: 'yunnan', company: 'test-company', page: 1, pageSize: 1 },
      undefined,
    )
  })

  it('分页搜索按云南日界传 from/to，并限制事件类别', async () => {
    api.get.mockResolvedValueOnce(envelope(response({ page: 2, total: 21 })))
    const result = await loadDisclosureRecordPage('yunnan', date, 'maintenance', { page: 2, keyword: '  机组  ' })
    expect(result.storage).toEqual({ sourceType: 'DB', mock: false, productionWrite: false })
    expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('/disclosures/events'), expect.objectContaining({
      region: 'yunnan', company: 'test-company', category: 'maintenance', keyword: '机组', page: 2, pageSize: 20,
      from: '2026-06-25T00:00:00+08:00', to: '2026-06-25T23:59:59+08:00',
    }), undefined)
  })

  it.each(['guangdong', 'all'])('不接受未接地区 %s', async (region) => {
    await expect(loadDisclosureRecordCatalog(region)).rejects.toThrow('仅接入云南')
    expect(api.get).not.toHaveBeenCalled()
  })

  it.each(['', 'other-region'])('未选公司或跨区公司不请求：%s', async (id) => {
    company.value = id
    await expect(loadDisclosureRecordCatalog('yunnan')).rejects.toThrow(/公司/)
    expect(api.get).not.toHaveBeenCalled()
  })

  it.each(['2026-02-30', '2026-99-99', '20260625'])('非法日期 %s 不请求', async (invalid) => {
    await expect(loadDisclosureRecordPage('yunnan', invalid, 'maintenance')).rejects.toThrow('有效的记录日期')
    expect(api.get).not.toHaveBeenCalled()
  })

  it('非法类别和页码不请求', async () => {
    await expect(loadDisclosureRecordPage('yunnan', date, 'must_run')).rejects.toThrow('有效的披露事件类别')
    await expect(loadDisclosureRecordPage('yunnan', date, 'maintenance', { page: 0 })).rejects.toThrow('有效的页码')
    expect(api.get).not.toHaveBeenCalled()
  })

  it.each([
    { sourceType: 'IMPORT' }, { sourceType: 'MOCK' }, { mock: true }, { productionWrite: true },
  ])('不显示非 DB 只读真实来源 %j', async (overrides) => {
    api.get.mockResolvedValue(envelope(response(), overrides))
    await expect(loadDisclosureRecordPage('yunnan', date, 'maintenance')).rejects.toThrow('数据库中的真实事件')
  })

  it.each([
    { items: [event({ regionId: 'guangdong' })] },
    { items: [event({ category: 'outage' })] },
    { items: [event({ effectiveAt: '2026-06-25T16:00:00.000Z' })] },
    { items: [event({ source: { ...event().source, mock: true } })] },
    { items: [event({ source: { ...event().source, sourceTable: '' } })] },
    { items: [event({ spatialBinding: { kind: 'region', ref: 'yunnan', label: '', coordinates: null } })] },
    { total: -1 }, { page: 2 }, { pageSize: 0 }, { categories: ['maintenance', 'unknown'] },
    { dataAvailability: { status: 'missing', fallback: false, regionRequested: 'yunnan', reason: '错状态' } },
    { dataAvailability: { status: 'available', fallback: true, regionRequested: 'yunnan', reason: '回退' } },
    { dataAvailability: { status: 'available', fallback: false, regionRequested: 'guangdong', reason: '错地区' } },
  ])('拒绝错日期、地区、类别或来源响应 %j', async (overrides) => {
    api.get.mockResolvedValue(envelope(response(overrides)))
    await expect(loadDisclosureRecordPage('yunnan', date, 'maintenance')).rejects.toThrow('不匹配')
  })

  it('只接受明确标注的南网全网事件，并允许真实空日', async () => {
    api.get.mockResolvedValueOnce(envelope(response({ items: [event({ regionId: 'csg', spatialBinding: { kind: 'grid', ref: 'csg', label: '南方电网范围', coordinates: null } })] })))
    expect((await loadDisclosureRecordPage('yunnan', date, 'maintenance')).items).toHaveLength(1)
    api.get.mockResolvedValueOnce(envelope(response({
      items: [], total: 0, dataAvailability: { status: 'missing', fallback: false, regionRequested: 'yunnan', reason: '当日无事件' },
    })))
    expect((await loadDisclosureRecordPage('yunnan', date, 'maintenance')).items).toEqual([])
  })

  it('类别契约错误会拒绝，认证失败不会伪装成空数据', async () => {
    api.get.mockResolvedValueOnce(envelope(response({ pageSize: 1, categories: [] })))
    await expect(loadDisclosureRecordCatalog('yunnan')).rejects.toThrow('不匹配')
    api.get.mockRejectedValueOnce(new Error('无权访问'))
    await expect(loadDisclosureRecordCatalog('yunnan')).rejects.toThrow('无权访问')
  })
})
