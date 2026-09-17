// 中长期售电分时分解集详情页的交互不变量（dljy#2971，MP-04/MA-05）。
// 守什么：来源可钻取到原始行、原始数值与单位；有阻断问题的草稿不能确认；内部估算确认必须写依据；
// 合同已更正时确认失败给出「按当前版本重新登记」的提示。
// 坏掉的症状：看不到曲线来自哪一行；不守恒的草稿也能点确认；估算被当正式资料确认；过期草稿确认失败时只给一句含糊报错。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongCapabilities } from '@/services/midlong/midlongTypes'
import type { CurveSetDetail } from '@/services/midlong/midlongP2Types'

const hoisted = vi.hoisted(() => ({ fetchCurveSet: vi.fn(), confirmCurveSet: vi.fn(), routeQuery: {} as Record<string, string> }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: '31' }, query: hoisted.routeQuery }), useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))
const caps: MidlongCapabilities = {
  enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1',
  modules: { contracts: true, positions: true, imports: true, plans: false, execution: false, review: false, curves: true } as MidlongCapabilities['modules'],
  canWrite: true, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null,
}
vi.mock('@/services/midlong/midlongApi', () => ({
  CompanyNotSelectedError: class extends Error {},
  fetchCapabilities: vi.fn(async () => caps),
  fetchContract: vi.fn(async () => ({ evidence: [{ id: 5, documentType: 'ELECTRONIC_CONFIRMATION', originalFileName: '确认单.pdf' }] })),
  midlongFailureOf: (e: unknown) => (e as { failure: unknown }).failure,
}))
vi.mock('@/services/midlong/midlongP2Api', async (orig) => ({
  p2ModuleOn: (await orig<typeof import('@/services/midlong/midlongP2Api')>()).p2ModuleOn,
  fetchCurveSet: hoisted.fetchCurveSet,
  confirmCurveSet: hoisted.confirmCurveSet,
  discardCurveSet: vi.fn(),
}))

import MidlongCurveSetView from './MidlongCurveSetView.vue'

const STUBS = { CompanyScopeBar: { template: '<div />' }, 'router-link': { template: '<a><slot /></a>' } }

function detail(o: Partial<CurveSetDetail> = {}): CurveSetDetail {
  const validation = {
    blocking: false, blockingCount: 0, warningCount: 0, summary: [], issues: [], truncated: false, totalQuantity: '744', intervalCount: 2976, expectedIntervalCount: 2976,
    missingIntervalCount: 0, zeroIntervalCount: 0, completeness: 'COMPLETE' as const,
    months: [{ month: '2027-05', curveQuantity: '744', formalQuantity: '744', difference: '0', status: 'CONSERVED' as const, intervalCount: 2976, expectedIntervalCount: 2976, missingIntervalCount: 0, zeroIntervalCount: 0 }],
    coverage: { fromMonth: '2027-05', toMonth: '2027-05', start: '2027-05-01T00:00:00+08:00', end: '2027-06-01T00:00:00+08:00' }, tolerance: '0', templateCode: 'MIDLONG-CURVE-STD-V1', roundingRule: 'NONE', roundingRuleText: '不做任何舍入',
  }
  return {
    id: 31, contractId: 7, revisionId: 1, revisionNo: 1, setNo: 3, basedOnSetNo: 0, sourceSetId: null, status: 'DRAFT', evidenceBasis: 'FORMAL', inputKind: 'INTERVAL_SERIES',
    granularityMinutes: 15, sourceUnit: 'MW', sourceMeasure: 'POWER', conversionMethod: 'POWER_TIMES_DURATION', sourceTimezone: 'Asia/Shanghai', templateCode: 'MIDLONG-CURVE-STD-V1',
    tolerance: '0', roundingRule: 'NONE', coverageFromMonth: '2027-05', coverageToMonth: '2027-05', intervalCount: 2976, totalQuantity: '744', blockingIssueCount: 0, completeness: 'COMPLETE',
    evidenceIds: [], note: null, provenance: { format: 'xlsx', sourceFiles: [{ role: 'workbook', fileName: 'TEST-曲线.xlsx', byteSize: 2048, sha256: 'a'.repeat(64), storageKey: 'x' }], sourceDocumentType: 'IMPORT_SOURCE_FILE' },
    recordedAt: '2026-09-17T00:00:00.000Z', recordedBy: 'u', confirmedAt: null, confirmedBy: null, discardedAt: null, discardedBy: null, discardReason: null,
    contract: { contractId: 7, externalContractNo: 'TEST-7', contractName: '【测试数据】', confirmationStatus: 'CONFIRMED', currentRevisionNo: 1 },
    isCurrentRevision: true, template: { code: 'MIDLONG-CURVE-STD-V1', label: '中长期分时曲线标准模板 V1', tolerance: '0', roundingRule: 'NONE', roundingRuleText: '不做任何舍入' },
    validation, days: [{ date: '2027-05-01', quantity: '24', intervalCount: 96, zeroIntervalCount: 0 }], date: null, intervals: null,
    ...o,
  }
}

afterEach(() => { vi.clearAllMocks(); hoisted.routeQuery = {} })
enableAutoUnmount(afterEach)

describe('分时分解集详情', () => {
  it('钻取到原始行：当日逐时段显示原始数值、原始单位与资料定位；来源显示粒度、时区、换算方法与容差', async () => {
    hoisted.routeQuery = { date: '2027-05-01' }
    hoisted.fetchCurveSet.mockResolvedValue(detail({
      date: '2027-05-01',
      intervals: [{ rowNo: 1, start: '2027-05-01T00:00:00+08:00', end: '2027-05-01T00:15:00+08:00', quantity: '0.25', sourceValue: '1', sourceUnit: 'MW', sourceRef: '分时曲线 第 3 行' }],
    }))
    const w = mount(MidlongCurveSetView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchCurveSet).toHaveBeenCalledWith(31, '2027-05-01')
    const text = w.text()
    expect(text).toContain('1 MW')
    expect(text).toContain('分时曲线 第 3 行')
    expect(text).toContain('功率 × 区间时长（小时）')
    expect(text).toContain('Asia/Shanghai')
    expect(text).toContain('0 MWh')
    expect(text).toContain('TEST-曲线.xlsx')
  })

  it('有阻断问题的草稿不能确认，并列出问题定位', async () => {
    hoisted.fetchCurveSet.mockResolvedValue(detail({
      blockingIssueCount: 2,
      validation: { ...detail().validation, blocking: true, blockingCount: 2, summary: [{ code: 'MISSING_INTERVALS', severity: 'blocking', label: '缺时段（未知，不按零补齐）', count: 1 }],
        issues: [{ code: 'MISSING_INTERVALS', severity: 'blocking', message: '2027-05 缺 4 个时段', month: '2027-05' }] },
    }))
    const w = mount(MidlongCurveSetView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('存在阻断问题，不能确认')
    expect(w.text()).toContain('2027-05 缺 4 个时段')
    const confirm = w.findAll('button').find((b) => b.text() === '确认')!
    expect(confirm.attributes('disabled')).toBeDefined()
  })

  it('内部估算必须写估算依据才能确认；合同已更正时确认失败给出按当前版本重新登记的提示', async () => {
    hoisted.fetchCurveSet.mockResolvedValue(detail({ evidenceBasis: 'INTERNAL_ESTIMATE', inputKind: 'ESTIMATE_GENERATED' }))
    hoisted.confirmCurveSet.mockRejectedValue({ failure: { status: 409, errorCode: 'PREVIEW_STALE', message: '草稿基于合同版本 1，合同已更正为版本 2', details: null } })
    const w = mount(MidlongCurveSetView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('内部估算（不计入正式持仓）')
    await w.findAll('button').find((b) => b.text() === '确认')!.trigger('click')
    await flushPromises()
    const dialogConfirm = () => w.findAll('.el-dialog__footer button').find((b) => b.text() === '确认')!
    expect(dialogConfirm().attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('内部估算必须写明估算依据')
    await w.find('.el-dialog textarea').setValue('【测试】均分参考')
    await dialogConfirm().trigger('click')
    await flushPromises()
    expect(hoisted.confirmCurveSet).toHaveBeenCalledWith(31, { evidenceIds: [], note: '【测试】均分参考' })
    expect(w.text()).toContain('请回到合同详情按当前版本重新登记或沿用原曲线')
  })
})
