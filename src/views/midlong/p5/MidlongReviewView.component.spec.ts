// 复盘 / 月报页（建议路由 /zcqjy/review，dljy#3016，MR-01/02/05/06）。
// 守什么：review 模块关闭 = 显示未开放且不发任何请求；指标只陈述中长期量价事实（FORBIDDEN 词汇红线）；
//         不可比价格分组分列且无排名；三种金额无凭证不显示到账、未独立复算不显示复算通过；
//         生成报告错误信封（REPORT_INPUTS_UNCHANGED）如实渲染；受影响报告定位；切换公司清空并重载。
// 坏掉的症状：能力未开放时空报错；页面出现「现货择时收益/套保收益/实际利润」；收款 null 被显示成 0 元到账。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongCapabilities, MidlongSubject } from '@/services/midlong/midlongTypes'
import type { PageResult } from '@/services/midlong/midlongP3Types'
import type { ReviewMetrics, ReviewReportSummaryRow } from '@/services/midlong/midlongP5Types'
import { FORBIDDEN_REVIEW_TERMS, FORBIDDEN_SETTLEMENT_TERMS } from '@/services/midlong/midlongP5Types'

const hoisted = vi.hoisted(() => ({
  fetchCapabilities: vi.fn(), fetchSubjects: vi.fn(), fetchReviewMetrics: vi.fn(), fetchReports: vi.fn(),
  generateReport: vi.fn(), fetchAffectedReports: vi.fn(), replace: vi.fn(),
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
  midlongFailureOf: (e: unknown) => {
    const failure = (e as { failure?: { status: number; errorCode: string; message: string; details: unknown } }).failure
    if (failure) return failure
    return { status: 500, errorCode: 'STORAGE_UNAVAILABLE', message: (e as Error).message, details: null }
  },
}))
vi.mock('@/services/midlong/midlongP5Api', () => ({
  fetchReviewMetrics: hoisted.fetchReviewMetrics, fetchReports: hoisted.fetchReports, generateReport: hoisted.generateReport,
  fetchAffectedReports: hoisted.fetchAffectedReports,
  p5ModuleOn: (caps: { enabled?: boolean; regionSupported?: boolean; modules?: Record<string, boolean> } | null | undefined, name: string) =>
    Boolean(caps?.enabled && caps.regionSupported && caps?.modules?.[name] === true),
}))

import MidlongReviewView from './MidlongReviewView.vue'

const STUBS = {
  CompanyScopeBar: { template: '<div />' },
  ReviewReportDrawer: { props: ['modelValue', 'reportId'], template: '<div class="stub-report-drawer" :data-id="reportId" :data-open="String(modelValue)" />' },
  'router-link': { template: '<a><slot /></a>' },
}

const caps = (review: boolean): MidlongCapabilities => ({
  enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1',
  modules: { contracts: true, positions: true, imports: true, plans: true, execution: true, review },
  canWrite: true, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null,
} as unknown as MidlongCapabilities)

const subjects: MidlongSubject[] = [
  { id: 3, companyId: 'comp-a', regionId: 'yunnan', subjectKey: 'YNGZ-1', displayName: '云南中广核一号', unitCode: null, unitCodeSource: null, verificationNote: null } as MidlongSubject,
]

function metrics(overrides: Record<string, unknown> = {}): ReviewMetrics {
  return {
    nature: 'MIDLONG_FACTS_ONLY', month: '2026-08', subjectId: null, regionId: 'yunnan', view: 'CURRENT', asOf: null,
    caliber: { positions: 'P1 月度持仓口径', priceGroups: '同口径分组', amounts: '名义/账单/收款分离', conclusions: 'NONE' },
    planCompletion: [{
      planId: 1, subjectId: 3, subjectName: '云南中广核一号', periodType: 'MONTH', periodKey: '2026-08', confirmedRevisionNo: 2,
      targetQuantity: '1000', knownSoldQuantity: '1000', soldComplete: true, remainingPlanQuantity: '0', completionRate: '1',
      verificationStatus: 'VERIFIED', overPlan: false, positionsAsOf: null,
    }],
    tradedVolumePrice: {
      month: '2026-08', formalQuantity: '1000', contractCount: 2, incomplete: true,
      price: {
        groups: [
          { currency: 'CNY', taxBasis: 'TAX_INCLUDED', priceComponent: 'ENERGY_ONLY', knownQuantity: '500', notionalAmount: '150000', averagePrice: '300' },
          { currency: 'CNY', taxBasis: 'TAX_EXCLUDED', priceComponent: 'ENERGY_ONLY', knownQuantity: '480', notionalAmount: '134400', averagePrice: '280' },
        ],
        comparable: false, averagePrice: null, notionalAmount: null, ranking: null,
        rankingNotice: '价格比较须同产品、交割期、曲线、币种与税口径：口径不可比时按组分列展示，不生成统一均价与排名。',
        knownPriceQuantity: '980', unknownPriceQuantity: '20', coverageRatio: '0.98', environmentValue: null,
      },
      contributionCount: 2,
    },
    counterpartyDistribution: { rows: [{ key: '云南电网', known: true, quantity: '1000', contractCount: 2 }], note: '' },
    tradeMethodDistribution: { rows: [{ key: 'BILATERAL', known: true, quantity: '1000', contractCount: 2 }], note: '' },
    green: {
      rows: [{
        contractId: 7, contractName: '绿电月度合同', externalContractNo: 'G-7', revisionNo: 1, quantity: '100',
        sellerPrice: '310', environmentPrice: '10', priceComponent: 'ENERGY_WITH_ENVIRONMENT', currency: 'CNY', taxBasis: 'TAX_INCLUDED',
        unitTotal: '310', energyUnit: '300', environmentUnit: '10', notionalAmount: '31000', composition: 'TOTAL_INCLUDES_ENVIRONMENT', gaps: [],
      }],
      gaps: [], notice: '绿电合同总价已含环境价值时，名义金额按总价计算，电能量与环境价值分项展示，不再次相加环境价值。',
    },
    untraded: { rows: [{ proposalId: 9, subjectId: 3, status: 'CLOSED', closeKind: 'NOT_FILLED', ownerName: '张三', windowId: 4, quantity: '50' }], statusesCounted: ['CANCELLED', 'CLOSED', 'WITHDRAWN'] },
    missedWindows: { asOf: '2026-08-31T00:00:00Z', rows: [{ proposalId: 8, subjectId: 3, status: 'SUBMITTED', closeKind: null, ownerName: '李四', windowId: 4, windowRevisionNo: 1, announcementName: '8 月月度交易', declarationClosesAt: '2026-08-15T09:00:00Z', quantityInMonth: '30' }] },
    changes: {
      rows: [{ contractId: 7, revisionNo: 2, revisionKind: 'CORRECTION', recordedAt: '2026-08-20T02:00:00Z', changeReason: '录入更正', affectedMonths: ['2026-08'], scopeLocated: true }],
      countByKind: { CORRECTION: 1, ADJUSTMENT: 0, TRANSFER: 0, PARTIAL_TERMINATION: 0 },
    },
    dataGaps: {
      unallocatedContractCount: 1, unallocatedQuantity: '44', unknownPriceQuantity: '20',
      contracts: [{ contractId: 7, flags: ['MISSING_EVIDENCE'] }],
      pool: [{ contractId: 7, externalContractNo: 'G-7', unallocatedQuantity: '44', reason: '未分解' }],
    },
    settlement: {
      month: '2026-08',
      nominalAmount: { amount: null, source: 'CONTRACT_LEDGER', sourceLabel: '中长期合同量价（持仓口径，名义金额）', coverage: 'PARTIAL', groups: [], notice: '' },
      billedAmount: { amount: '294000', quantity: '980', source: 'EXTERNAL_BILL', sourceLabel: '外部中长期账单（当前有效版本分项）', coverage: 'PARTIAL', unitemizedBillCount: 1, currentRevisionOnly: true, notice: '' },
      receivedAmount: { amount: null, voucherCount: 0, source: 'PAYMENT_VOUCHER', sourceLabel: '收款凭证（编号 + 金额 + 日期 + 文件）', coverage: 'MISSING', notice: '' },
      independentlyRecomputed: { status: 'NOT_PERFORMED', reason: 'NO_INDEPENDENT_SETTLEMENT_BASIS' },
      notice: '',
    },
    excluded: { draftCount: 0, pendingVerificationCount: 1, frameworkCount: 0, voidedCount: 0, estimatedQuantity: '0', note: '' },
    notices: ['复盘只覆盖中长期量价事实：不推断市场择时、套保或利润结论，不读取现货、预测数据。'],
    generatedAt: '2026-09-01T00:00:00Z',
    inputs: { asOf: null, contracts: 2, plans: 1, confirmations: 0, bills: 2 },
    ...overrides,
  } as unknown as ReviewMetrics
}

const reportsPage: PageResult<ReviewReportSummaryRow> & { notice: string | null } = { rows: [], total: 0, page: 1, pageSize: 20, notice: null }

afterEach(() => {
  vi.clearAllMocks()
  hoisted.routeQuery = {}
  if (hoisted.companyRef) hoisted.companyRef.value = 'comp-a'
  document.body.innerHTML = ''
})
enableAutoUnmount(afterEach)

async function openView(capsValue = caps(true), metricsValue = metrics(), reports = reportsPage) {
  hoisted.fetchCapabilities.mockResolvedValue(capsValue)
  hoisted.fetchSubjects.mockResolvedValue(subjects)
  hoisted.fetchReviewMetrics.mockResolvedValue(metricsValue)
  hoisted.fetchReports.mockResolvedValue(reports)
  const w = mount(MidlongReviewView, { global: { stubs: STUBS }, attachTo: document.body })
  await flushPromises()
  return w
}

describe('复盘 / 月报页', () => {
  it('review 模块关闭：显示未开放且不发指标/报告请求；打开时正常请求当月指标', async () => {
    const closed = await openView(caps(false))
    expect(closed.text()).toContain('业务复盘功能尚未开放')
    expect(hoisted.fetchReviewMetrics).not.toHaveBeenCalled()
    expect(hoisted.fetchReports).not.toHaveBeenCalled()

    const w = await openView()
    expect(hoisted.fetchReviewMetrics).toHaveBeenCalledWith({ month: expect.stringMatching(/^\d{4}-\d{2}$/), subjectId: null })
    expect(w.text()).toContain('复盘只覆盖中长期量价事实')
  })

  it('不可比价格分组分列展示、不排名：两组各自均价、无统一汇总', async () => {
    const w = await openView()
    expect(w.find('[data-test="price-not-comparable"]').text()).toContain('不生成统一均价与排名')
    const groupRows = w.findAll('[data-test="price-groups"] tbody tr')
    expect(groupRows.length).toBe(2)
    expect(w.text()).toContain('300')
    expect(w.text()).toContain('280')
    // 「不生成统一均价与排名」的固定说明允许出现「排名」二字，但不得出现优劣名次类结论。
    const text = w.text()
    for (const forbidden of ['优于', '劣于', '第一', '第1', '最优']) expect(text).not.toContain(forbidden)
  })

  it('三种金额：无凭证不显示到账、未独立复算；未成交/错过窗口/资料缺口明确列出；页面不出现禁用口径', async () => {
    const w = await openView()
    const settlementText = w.find('[data-test="settlement-amounts"]').text()
    expect(settlementText).toContain('无凭证（未显示到账）')
    expect(settlementText).toContain('另有 1 张综合账单仅归档（未分项）')
    expect(w.find('[data-test="recompute-status"]').text()).toContain('未独立复算')
    expect(w.text()).toContain('未成交（方案终态）')
    expect(w.text()).toContain('#9')
    expect(w.text()).toContain('错过窗口')
    expect(w.text()).toContain('8 月月度交易')
    expect(w.text()).toContain('资料缺口')
    expect(w.text()).toContain('未分解合同 1 份 / 44 MWh')
    const text = w.text()
    for (const term of [...FORBIDDEN_REVIEW_TERMS, ...FORBIDDEN_SETTLEMENT_TERMS]) expect(text).not.toContain(term)
  })

  it('绿电组成：310=300+10 按总价计名义、分项展示不重复相加', async () => {
    const w = await openView()
    const row = w.find('[data-test="green-row-7"]').text()
    expect(row).toContain('总价已含环境价值')
    expect(row).toContain('合计 310')
    expect(row).toContain('电能量 300')
    expect(row).toContain('环境价值 10')
    expect(row).toContain('31,000')
  })

  it('生成月报：成功显示版本与冻结输入；REPORT_INPUTS_UNCHANGED 如实渲染不生成空版本', async () => {
    hoisted.routeQuery = { month: '2026-08' }
    const w = await openView()
    await w.findAll('button').find((b) => b.text() === '生成月报（冻结）')!.trigger('click')
    await flushPromises()
    // el-dialog append-to-body：按 data-test 在 body 下找。
    expect(document.body.querySelector('[data-test="generate-month"]')?.textContent).toBe('2026-08')

    hoisted.generateReport.mockRejectedValueOnce({
      failure: { status: 422, errorCode: 'REPORT_INPUTS_UNCHANGED', message: '报告输入版本未变化', details: { reportId: 7, currentVersionNo: 1 } },
    })
    const submitGenerate = () => [...document.body.querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent?.trim() === '生成（冻结当前输入）') as HTMLButtonElement
    submitGenerate().click()
    await flushPromises()
    expect(document.body.querySelector('[data-test="generate-error"]')?.textContent).toContain('未生成新版本')
    expect(document.body.querySelector('[data-test="generate-error"]')?.textContent).toContain('#7')

    hoisted.generateReport.mockResolvedValueOnce({
      reportId: 7, versionNo: 2, scope: 'COMPANY', month: '2026-08',
      changeReason: '迟到修订重算：PLAN#1 v1→v2', changes: [{ kind: 'PLAN', id: 1, from: 1, to: 2 }],
      frozenInputs: { contracts: 2, plans: 1, confirmations: 0, bills: 2 }, notices: [],
    })
    submitGenerate().click()
    await flushPromises()
    expect(document.body.querySelector('[data-test="generate-result"]')?.textContent).toContain('v2')
    expect(document.body.querySelector('[data-test="generate-result"]')?.textContent).toContain('PLAN#1 v1→v2')
  }, 20000)

  it('受影响报告定位：输入变化后列出冻结旧版本的报告（旧报告数值不变的提示）', async () => {
    hoisted.fetchAffectedReports.mockResolvedValue({
      input: { kind: 'PLAN', id: 1, currentRevisionNo: 2 },
      rows: [{ reportId: 7, reportMonth: '2026-08', scope: 'COMPANY', subjectId: null, versionNo: 1, isCurrentVersion: true, frozenRevisionNo: 1, changeReason: '首次生成', generatedAt: '2026-09-01T00:00:00Z' }],
      notice: '迟到修订已生成新报告版本：旧报告数值保持不变，版本差异可查。',
    })
    const w = await openView()
    await w.find('input[data-test="affected-id"]').setValue('1')
    await w.find('[data-test="affected-search"]').trigger('click')
    await flushPromises()
    expect(hoisted.fetchAffectedReports).toHaveBeenCalledWith({ kind: 'contractId', id: 1 })
    const text = w.find('[data-test="affected-locator"]').text()
    expect(text).toContain('#7')
    expect(text).toContain('v1 → 当前 v2')
  })

  it('点报告行打开详情抽屉；切换公司清空指标并重载', async () => {
    hoisted.routeQuery = { month: '2026-08' }
    const w = await openView(caps(true), metrics(), {
      rows: [{ id: 7, reportMonth: '2026-08', scope: 'COMPANY', subjectId: null, subjectName: null, currentVersionNo: 1, versionCount: 1, currentChangeReason: '首次生成', generatedAt: null, generatedBy: null, rowVersion: 1, companyId: 'comp-a', regionId: 'yunnan', createdAt: '', updatedAt: '' }],
      total: 1, page: 1, pageSize: 20, notice: null,
    })
    // 报告列表行以变更说明「首次生成」定位（指标区也有 #7 文本，不能只按 #7 找）。
    await w.findAll('.el-table__row').find((r) => r.text().includes('首次生成'))!.trigger('click')
    expect(w.find('.stub-report-drawer').attributes('data-id')).toBe('7')

    hoisted.fetchReviewMetrics.mockImplementation(() => new Promise(() => {}))
    hoisted.companyRef!.value = 'comp-b'
    await flushPromises()
    expect(w.find('.stub-report-drawer').attributes('data-open')).toBe('false')
    expect(hoisted.fetchCapabilities).toHaveBeenCalledTimes(2)
  })
})
