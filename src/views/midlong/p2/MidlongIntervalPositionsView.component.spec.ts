// 中长期售电分时持仓页的渲染不变量（dljy#2971，MP-02/MP-04/MP-06）。
// 守什么：只有月量的合同切到小时视图显示「分时未知」，不显示 0；部分未知的时段明示；时段钻取能到所用分解集；
// 能力未开通时不取数；服务失败显示错误；切换公司后旧请求迟到不污染新公司。
// 坏掉的症状：月量合同在小时视图被画成 0 或均摊值；钻取找不到曲线来源；开关关闭仍在调接口。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { mount } from '@/test/mount'
import type { MidlongCapabilities } from '@/services/midlong/midlongTypes'
import type { IntervalPositionReport } from '@/services/midlong/midlongP2Types'

const hoisted = vi.hoisted(() => ({
  fetchCapabilities: vi.fn(), fetchIntervalPositions: vi.fn(), exportIntervalPositions: vi.fn(), replace: vi.fn(),
  companyRef: null as null | { value: string },
}))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: { fromDate: '2027-05-01', toDate: '2027-05-01', granularity: 'HOUR' } }), useRouter: () => ({ replace: hoisted.replace }) }))
vi.mock('@/services/company/companyContext', async () => {
  const selectedCompanyId = (await import('vue')).ref('comp-a')
  hoisted.companyRef = selectedCompanyId
  return { selectedCompanyId }
})
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))
vi.mock('@/composables/useTheme', () => ({ cssVar: () => '' }))
vi.mock('@/services/midlong/midlongApi', () => ({
  CompanyNotSelectedError: class extends Error {},
  fetchCapabilities: hoisted.fetchCapabilities,
  fetchSubjects: vi.fn(async () => []),
  midlongFailureOf: (e: unknown) => ({ status: (e as { status?: number }).status ?? 500, errorCode: 'STORAGE_UNAVAILABLE', message: (e as Error).message, details: null }),
}))
vi.mock('@/services/midlong/midlongP2Api', async (orig) => ({
  p2ModuleOn: (await orig<typeof import('@/services/midlong/midlongP2Api')>()).p2ModuleOn,
  fetchIntervalPositions: hoisted.fetchIntervalPositions,
  exportIntervalPositions: hoisted.exportIntervalPositions,
}))

import MidlongIntervalPositionsView from './MidlongIntervalPositionsView.vue'

const STUBS = { CompanyScopeBar: { template: '<div />' }, ChartCard: { template: '<div class="stub-chart" />' }, 'router-link': { props: ['to'], template: '<a :data-to="typeof to === \'string\' ? to : JSON.stringify(to)"><slot /></a>' } }
const caps = (modules: Record<string, boolean> = { curves: true }): MidlongCapabilities => ({
  enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1',
  modules: { contracts: true, positions: true, imports: true, plans: false, execution: false, review: false, ...modules } as MidlongCapabilities['modules'],
  canWrite: false, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null,
})

function report(o: Partial<IntervalPositionReport> = {}): IntervalPositionReport {
  return {
    asOf: '2026-09-17T00:00:00.000Z', view: 'CURRENT', granularity: 'HOUR', granularityMinutes: 60, fromDate: '2027-05-01', toDate: '2027-05-01',
    status: 'partial', regionId: 'yunnan', companyIds: ['comp-a'], generatedAt: '2026-09-17T00:00:00.000Z', filters: {},
    buckets: [
      { start: '2027-05-01T00:00:00+08:00', end: '2027-05-01T01:00:00+08:00', date: '2027-05-01', month: '2027-05', coverage: 'PARTIAL', formalQuantity: '1', knownContractCount: 1, unknownContractIds: [2] },
      { start: '2027-05-01T01:00:00+08:00', end: '2027-05-01T02:00:00+08:00', date: '2027-05-01', month: '2027-05', coverage: 'UNKNOWN', formalQuantity: null, knownContractCount: 0, unknownContractIds: [2] },
    ],
    contracts: [
      { contractId: 1, externalContractNo: 'TEST-CURVE', contractName: '有曲线', subjectId: 1, stationId: null, revisionNo: 1, deliveryStart: '2027-05-01', deliveryEnd: '2027-05-01', curveQuantityInRange: '1',
        months: [{ month: '2027-05', timeStatus: 'CURVE', monthlyFormalQuantity: '24', curve: { curveSetId: 31, setNo: 3, granularityMinutes: 60, confirmedAt: null }, estimate: null }] },
      { contractId: 2, externalContractNo: 'TEST-MONTH', contractName: '只有月量', subjectId: 1, stationId: null, revisionNo: 1, deliveryStart: '2027-05-01', deliveryEnd: '2027-05-31', curveQuantityInRange: '0',
        months: [{ month: '2027-05', timeStatus: 'TIME_UNKNOWN', monthlyFormalQuantity: '1000', curve: null, estimate: { curveSetId: 40, setNo: 4, granularityMinutes: 60, confirmedAt: null } }] },
    ],
    totals: { contractCount: 2, curveQuantityInRange: '1', bucketCount: 2, unknownBucketCount: 1, partialBucketCount: 1, timeUnknownContractCount: 1 },
    excluded: { estimateCurveSets: [{ contractId: 2, month: '2027-05', curveSetId: 40, setNo: 4, granularityMinutes: 60 }], note: '只计已确认的正式分时分解' },
    ...o,
  }
}

afterEach(() => { vi.clearAllMocks() })
enableAutoUnmount(afterEach)

describe('中长期售电分时持仓', () => {
  it('只有月量的合同在小时视图显示「分时未知」，不显示 0；部分未知的时段明示', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps())
    hoisted.fetchIntervalPositions.mockResolvedValue(report())
    const w = mount(MidlongIntervalPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    const rows = w.findAll('.el-table__body').at(0)!.findAll('tr')
    // 第二列是电量列：逐格核对，不用整行文本（整行里还有「已有分时合同 0」等计数列）。
    expect(rows[0].findAll('td')[1].text()).toBe('1（另有合同分时未知）')
    expect(rows[1].findAll('td')[1].text()).toBe('分时未知')
    expect(w.text()).toContain('部分时段分时未知')
    expect(w.text()).toContain('分时未知（只有月量）')
  })

  it('点击时段钻取到合同与所用分解集；分时未知的合同明确未计入，估算集注明不计入', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps())
    hoisted.fetchIntervalPositions.mockResolvedValue(report())
    const w = mount(MidlongIntervalPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    await w.findAll('.el-table__body').at(0)!.findAll('tr')[0].trigger('click')
    await nextTick()
    const links = w.findAll('a').map((a) => a.attributes('data-to'))
    expect(links).toContain('/zcqjy/curves/31?date=2027-05-01')
    expect(w.text()).toContain('分时未知，未计入该时段')
    expect(w.text()).toContain('另有内部估算 #4（不计入）')
  })

  it('能力未开通时不取分时数据，只提示未开通', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps({}))
    const w = mount(MidlongIntervalPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchIntervalPositions).not.toHaveBeenCalled()
    expect(w.text()).toContain('分时持仓尚未开通')
  })

  it('服务失败显示错误，不渲染任何数值与图表', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps())
    hoisted.fetchIntervalPositions.mockRejectedValue(Object.assign(new Error('合同存储暂不可用'), { status: 503 }))
    const w = mount(MidlongIntervalPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('分时持仓加载失败')
    expect(w.find('.stub-chart').exists()).toBe(false)
  })

  it('切换公司：旧公司迟到的响应被丢弃，不显示在新公司下', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps())
    let resolveOld: (v: IntervalPositionReport) => void = () => {}
    hoisted.fetchIntervalPositions
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockImplementationOnce(() => new Promise(() => {}))
    const w = mount(MidlongIntervalPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    hoisted.companyRef!.value = 'comp-b'
    await nextTick()
    await flushPromises()
    resolveOld(report())
    await flushPromises()
    expect(w.text()).not.toContain('TEST-CURVE')
    hoisted.companyRef!.value = 'comp-a'
  })
})
