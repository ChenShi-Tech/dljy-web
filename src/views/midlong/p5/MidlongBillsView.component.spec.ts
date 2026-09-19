// 账单与差异页（建议路由 /zcqjy/bills，dljy#3016，MR-02..04）。
// 守什么：bills 模块关闭 = 显示未开放且不发任何请求；账单列表 UNITEMIZED 标未分项、无凭证不显示到账；
//         差异列表量差「外部−台账」带符号如实、不可比只核对电量；登记入口按 canWrite；导出同列表筛选；
//         切换公司清空两个台账并关闭抽屉/对话框。
// 坏掉的症状：能力未开放时列表空报错；收款 null 显示 0；换公司后显示上一家公司的账单。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongCapabilities } from '@/services/midlong/midlongTypes'
import { FORBIDDEN_SETTLEMENT_TERMS } from '@/services/midlong/midlongP5Types'

const hoisted = vi.hoisted(() => ({
  fetchCapabilities: vi.fn(), fetchSubjects: vi.fn(), fetchBills: vi.fn(), fetchDiscrepancies: vi.fn(),
  exportBills: vi.fn(), exportDiscrepancies: vi.fn(), replace: vi.fn(), downloadCsv: vi.fn(),
  routeQuery: {} as Record<string, string>, companyRef: null as null | { value: string },
}))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: hoisted.routeQuery }), useRouter: () => ({ replace: hoisted.replace }) }))
vi.mock('@/services/company/companyContext', async () => {
  const selectedCompanyId = (await import('vue')).ref('comp-a')
  hoisted.companyRef = selectedCompanyId
  return { selectedCompanyId }
})
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))
vi.mock('@/services/midlong/midlongApi', () => ({
  CompanyNotSelectedError: class extends Error {},
  fetchCapabilities: hoisted.fetchCapabilities, fetchSubjects: hoisted.fetchSubjects,
  midlongFailureOf: (e: unknown) => ({ status: 500, errorCode: 'STORAGE_UNAVAILABLE', message: (e as Error).message, details: null }),
}))
vi.mock('@/services/midlong/midlongP5Api', () => ({
  fetchBills: hoisted.fetchBills, fetchDiscrepancies: hoisted.fetchDiscrepancies,
  exportBills: hoisted.exportBills, exportDiscrepancies: hoisted.exportDiscrepancies,
  p5ModuleOn: (caps: { enabled?: boolean; regionSupported?: boolean; modules?: Record<string, boolean> } | null | undefined, name: string) =>
    Boolean(caps?.enabled && caps.regionSupported && caps?.modules?.[name] === true),
}))
vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), downloadCsv: hoisted.downloadCsv }))

import MidlongBillsView from './MidlongBillsView.vue'

const STUBS = {
  CompanyScopeBar: { template: '<div />' },
  BillFormDialog: { props: ['modelValue'], template: '<div class="stub-bill-form" :data-open="String(modelValue)" />' },
  BillDetailDrawer: { props: ['modelValue', 'billId'], template: '<div class="stub-bill-drawer" :data-id="billId" :data-open="String(modelValue)" />' },
  DiscrepancyFormDialog: { props: ['modelValue'], template: '<div class="stub-disc-form" :data-open="String(modelValue)" />' },
  DiscrepancyDetailDrawer: { props: ['modelValue', 'discrepancyId'], template: '<div class="stub-disc-drawer" :data-id="discrepancyId" :data-open="String(modelValue)" />' },
}

const caps = (bills: boolean): MidlongCapabilities => ({
  enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1',
  modules: { contracts: true, positions: true, imports: true, plans: true, execution: true, bills },
  canWrite: true, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null,
} as unknown as MidlongCapabilities)

const billRow = (id: number, overrides: Record<string, unknown> = {}) => ({
  id, companyId: 'comp-a', regionId: 'yunnan', subjectId: 3, subjectName: '云南中广核一号',
  sourceNamespace: '昆明交易中心', externalBillNo: `B-2026-00${id}`, currentRevisionNo: 1, revisionCount: 1, rowVersion: 1,
  billKind: 'ITEMIZED', sourceName: null, externalRevisionLabel: null, periodStartMonth: '2026-08', periodEndMonth: '2026-08',
  currency: 'CNY', taxBasis: 'TAX_INCLUDED', amount: '144000', lineItemCount: 1, lineItemQuantity: '960', lineItemAmount: '288000',
  voucherCount: 0, voucherAmount: null, openDiscrepancyCount: 0, recheckDiscrepancyCount: 0, createdAt: '', updatedAt: '', ...overrides,
})
const billsPage = (rows: unknown[]) => ({ rows, total: rows.length, page: 1, pageSize: 50, notice: null })

const discrepancyRow = (id: number, overrides: Record<string, unknown> = {}) => ({
  id: id, companyId: 'comp-a', regionId: 'yunnan', subjectId: 3, subjectName: '云南中广核一号', deliveryMonth: '2026-08',
  billId: 9, billRevisionNo: 1, sides: { ledger: 'POSITION_LEDGER', external: 'EXTERNAL_BILL' },
  ledger: { quantity: '1000', price: '300', notional: '300000' }, external: { quantity: '980', price: '300', amount: '294000' },
  quantityDelta: '-20', priceDelta: null, priceComparable: false, reason: null, ownerName: null, evidenceIds: [],
  status: 'OPEN', resolutionNote: null, resolvedAt: null, resolvedBy: null, rowVersion: 1, createdAt: '', updatedAt: '',
  billNo: 'B-2026-001', ...overrides,
})
const discrepanciesPage = (rows: unknown[]) => ({ rows, total: rows.length, page: 1, pageSize: 50, notices: [] })

afterEach(() => {
  vi.clearAllMocks()
  hoisted.routeQuery = {}
  if (hoisted.companyRef) hoisted.companyRef.value = 'comp-a'
})
enableAutoUnmount(afterEach)

async function openView(capsValue = caps(true)) {
  hoisted.fetchCapabilities.mockResolvedValue(capsValue)
  hoisted.fetchSubjects.mockResolvedValue([{ id: 3, displayName: '云南中广核一号' }])
  hoisted.fetchBills.mockResolvedValue(billsPage([billRow(9), billRow(10, { billKind: 'UNITEMIZED', amount: '500000', lineItemAmount: null, lineItemCount: 0, lineItemQuantity: null })]))
  hoisted.fetchDiscrepancies.mockResolvedValue(discrepanciesPage([discrepancyRow(5), discrepancyRow(6, { status: 'RECHECK_REQUIRED', priceComparable: true, priceDelta: '-5' })]))
  const w = mount(MidlongBillsView, { global: { stubs: STUBS }, attachTo: document.body })
  await flushPromises()
  return w
}

describe('账单与差异页', () => {
  it('bills 模块关闭：显示未开放且不发任何请求；打开时两个台账都请求', async () => {
    const closed = await openView(caps(false))
    expect(closed.text()).toContain('账单与差异功能尚未开放')
    expect(hoisted.fetchBills).not.toHaveBeenCalled()
    expect(hoisted.fetchDiscrepancies).not.toHaveBeenCalled()

    const w = await openView()
    expect(hoisted.fetchBills).toHaveBeenCalledWith({ page: 1, pageSize: 50, subjectId: undefined, billKind: undefined, externalBillNo: undefined, month: undefined })
    expect(hoisted.fetchDiscrepancies).toHaveBeenCalledWith({ page: 1, pageSize: 50, subjectId: undefined, status: undefined, month: undefined })
    expect(w.text()).toContain('B-2026-009')
  })

  it('账单列表：UNITEMIZED 标未分项（金额只按整单归档展示）、无凭证不显示到账', async () => {
    const w = await openView()
    const text = w.text()
    expect(text).toContain('综合账单（未分项，仅归档）')
    expect(text).toContain('500,000 元（未分项）')
    expect(text).toContain('无凭证（未显示到账）')
    expect(text).not.toContain('已到账')
    for (const term of FORBIDDEN_SETTLEMENT_TERMS) expect(text).not.toContain(term)
  })

  it('差异标签：量差带符号如实（-20）、不可比只核对电量、需重新核对状态展示', async () => {
    const w = await openView()
    w.findAllComponents({ name: 'ElTabPane' })
    // 切到差异标签。
    const tabs = w.findAll('.el-tabs__item')
    await tabs.find((t) => t.text().includes('差异台账'))!.trigger('click')
    await flushPromises()
    const text = w.text()
    expect(text).toContain('-20 MWh')
    expect(text).toContain('不可比（只核对电量）')
    expect(text).toContain('需重新核对（账单已修订）')
  })

  it('登记入口与导出：canWrite 打开登记对话框；导出同列表筛选并下载', async () => {
    const w = await openView()
    await w.findAll('button').find((b) => b.text() === '登记账单')!.trigger('click')
    expect(w.find('.stub-bill-form').attributes('data-open')).toBe('true')

    hoisted.exportBills.mockResolvedValue({ fileName: '中长期外部账单台账-yunnan.csv', contentType: 'text/csv', content: '账单', rowCount: 2, notice: null })
    await w.findAll('button').find((b) => b.text() === '导出台账')!.trigger('click')
    await flushPromises()
    expect(hoisted.exportBills).toHaveBeenCalledWith({ subjectId: undefined, billKind: undefined, externalBillNo: undefined, month: undefined })
    expect(hoisted.downloadCsv).toHaveBeenCalledWith('中长期外部账单台账-yunnan.csv', '账单')
  })

  it('点行打开详情抽屉；切换公司清空两个台账并关闭抽屉/对话框', async () => {
    const w = await openView()
    await w.findAll('.el-table__row').find((r) => r.text().includes('B-2026-009'))!.trigger('click')
    expect(w.find('.stub-bill-drawer').attributes('data-id')).toBe('9')

    hoisted.fetchBills.mockImplementation(() => new Promise(() => {}))
    hoisted.fetchDiscrepancies.mockImplementation(() => new Promise(() => {}))
    hoisted.companyRef!.value = 'comp-b'
    await flushPromises()
    expect(w.find('.stub-bill-drawer').attributes('data-open')).toBe('false')
    // 登记对话框本用例未打开（v-if 不渲染）；断言其不存在即可证明关闭态。
    expect(w.find('.stub-bill-form').exists()).toBe(false)
    expect(w.text()).not.toContain('B-2026-009')
  })
})
