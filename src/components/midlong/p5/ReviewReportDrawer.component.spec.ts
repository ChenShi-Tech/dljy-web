// 复盘报告详情抽屉（dljy#3016，MR-05）。
// 守什么：版本列表含全部版本（旧版保留）；冻结快照按版本只读——迟到目标 1000→1200 后 v1 仍显示 1000、
//         v2 显示 1200（旧报告数值不被当前数据覆盖）；导出带版本号并从冻结快照下载（与归档一致）。
// 坏掉的症状：旧版本快照跟着当前数据漂移；导出按钮重新拉实时指标而不是冻结内容。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { ReviewReportDetail, ReviewReportVersionSnapshot } from '@/services/midlong/midlongP5Types'

const hoisted = vi.hoisted(() => ({ fetchReport: vi.fn(), fetchReportVersion: vi.fn(), exportReport: vi.fn(), downloadCsv: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('@/services/midlong/midlongApi', () => ({
  midlongFailureOf: (e: unknown) => (e as { failure: { status: number; errorCode: string; message: string; details: unknown } }).failure,
}))
vi.mock('@/services/midlong/midlongP5Api', () => ({
  fetchReport: hoisted.fetchReport, fetchReportVersion: hoisted.fetchReportVersion, exportReport: hoisted.exportReport,
}))
vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), downloadCsv: hoisted.downloadCsv }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))

import ReviewReportDrawer from './ReviewReportDrawer.vue'

const DRAWER_TIMEOUT = 20000

/** 冻结快照的指标：v1 冻结目标 1000；v2 迟到修订后 1200（MR-05 场景：计划后来调高）。 */
function snapshot(versionNo: number, targetQuantity: string): ReviewReportVersionSnapshot {
  return {
    id: 7, reportMonth: '2026-08', scope: 'COMPANY', subjectId: null, versionNo,
    supersedesVersionNo: versionNo > 1 ? versionNo - 1 : null,
    changeReason: versionNo === 1 ? '首次生成' : `迟到修订重算：PLAN#1 v1→v2`,
    note: null, contentFingerprint: `fp-${versionNo}`,
    inputFreeze: { asOf: null, filters: { month: '2026-08' }, contracts: { '7': 1 }, plans: { '1': versionNo }, confirmations: {}, bills: {} },
    metrics: {
      month: '2026-08', subjectId: null, regionId: 'yunnan', view: 'CURRENT', asOf: null,
      caliber: { positions: '', priceGroups: '', amounts: '', conclusions: 'NONE' },
      planCompletion: [{
        planId: 1, subjectId: null, subjectName: null, periodType: 'MONTH', periodKey: '2026-08', confirmedRevisionNo: versionNo,
        targetQuantity, knownSoldQuantity: '1000', soldComplete: true, remainingPlanQuantity: String(Number(targetQuantity) - 1000),
        completionRate: null, verificationStatus: 'VERIFIED', overPlan: false, positionsAsOf: null,
      }],
      tradedVolumePrice: {
        month: '2026-08', formalQuantity: '1000', contractCount: 1, incomplete: false,
        price: {
          groups: [{ currency: 'CNY', taxBasis: 'TAX_INCLUDED', priceComponent: 'ENERGY_ONLY', knownQuantity: '1000', notionalAmount: '300000', averagePrice: '300' }],
          comparable: true, averagePrice: '300', notionalAmount: '300000', ranking: null, rankingNotice: null,
          knownPriceQuantity: '1000', unknownPriceQuantity: '0', coverageRatio: '1', environmentValue: null,
        },
        contributionCount: 1,
      },
      counterpartyDistribution: { rows: [], note: '' },
      tradeMethodDistribution: { rows: [], note: '' },
      green: { rows: [], gaps: [], notice: null },
      untraded: { rows: [], statusesCounted: [] },
      missedWindows: { asOf: '', rows: [] },
      changes: { rows: [], countByKind: {} },
      dataGaps: { unallocatedContractCount: 0, unallocatedQuantity: '0', unknownPriceQuantity: '0', contracts: [], pool: [] },
      settlement: {
        month: '2026-08',
        nominalAmount: { amount: '300000', source: 'CONTRACT_LEDGER', sourceLabel: '中长期合同量价（持仓口径，名义金额）', coverage: 'COMPLETE', groups: [], notice: '' },
        billedAmount: { amount: null, quantity: null, source: 'EXTERNAL_BILL', sourceLabel: '外部中长期账单（当前有效版本分项）', coverage: 'MISSING', unitemizedBillCount: 0, currentRevisionOnly: true, notice: '' },
        receivedAmount: { amount: null, voucherCount: 0, source: 'PAYMENT_VOUCHER', sourceLabel: '收款凭证（编号 + 金额 + 日期 + 文件）', coverage: 'MISSING', notice: '' },
        independentlyRecomputed: { status: 'NOT_PERFORMED', reason: 'NO_INDEPENDENT_SETTLEMENT_BASIS' },
        notice: '',
      },
      excluded: { draftCount: 0, pendingVerificationCount: 0, frameworkCount: 0, voidedCount: 0, estimatedQuantity: '0', note: '' },
      notices: [], generatedAt: '2026-09-01T00:00:00Z',
      inputs: { asOf: null, contracts: 1, plans: 1, confirmations: 0, bills: 0 },
    },
    generatedAt: '2026-09-01T00:00:00Z', generatedBy: 'u1', notices: [],
  } as unknown as ReviewReportVersionSnapshot
}

const detail = (): ReviewReportDetail => ({
  id: 7, companyId: 'comp-a', regionId: 'yunnan', subjectId: null, subjectName: null, reportMonth: '2026-08', scope: 'COMPANY',
  currentVersionNo: 2, versionCount: 2, currentChangeReason: '迟到修订重算：PLAN#1 v1→v2', generatedAt: '2026-09-02T00:00:00Z', generatedBy: 'u1',
  rowVersion: 2, createdAt: '', updatedAt: '',
  versions: [
    { versionNo: 1, supersedesVersionNo: null, changeReason: '首次生成', note: null, contentFingerprint: 'fp-1', inputs: { asOf: null, contracts: 1, plans: 1, confirmations: 0, bills: 0 }, generatedAt: '2026-09-01T00:00:00Z', generatedBy: 'u1' },
    { versionNo: 2, supersedesVersionNo: 1, changeReason: '迟到修订重算：PLAN#1 v1→v2', note: null, contentFingerprint: 'fp-2', inputs: { asOf: null, contracts: 1, plans: 2, confirmations: 0, bills: 0 }, generatedAt: '2026-09-02T00:00:00Z', generatedBy: 'u1' },
  ],
  events: [], notices: [],
} as unknown as ReviewReportDetail)

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})
enableAutoUnmount(afterEach)

async function open() {
  hoisted.fetchReport.mockResolvedValue(detail())
  // 打开默认取当前版本 v2（迟到修订后的 1200）。
  hoisted.fetchReportVersion.mockImplementation((_id: number, versionNo: number) => Promise.resolve(snapshot(versionNo, versionNo === 1 ? '1000' : '1200')))
  const w = mount(ReviewReportDrawer, {
    props: { modelValue: true, reportId: 7 },
    attachTo: document.body,
    global: { stubs: { 'router-link': { template: '<a><slot /></a>' } } },
  })
  await flushPromises()
  return w
}

describe('复盘报告详情抽屉', () => {
  it('版本列表含全部版本（旧版保留）；默认展示当前版本 v2 的冻结快照（目标 1200）', async () => {
    await open()
    const text = document.body.textContent ?? ''
    expect(hoisted.fetchReport).toHaveBeenCalledWith(7)
    expect(hoisted.fetchReportVersion).toHaveBeenCalledWith(7, 2)
    expect(text).toContain('v1')
    expect(text).toContain('v2')
    expect(document.body.querySelector('[data-test="snapshot-title"]')?.textContent).toContain('v2')
    expect(text).toContain('1,200')
  }, DRAWER_TIMEOUT)

  it('切到 v1 冻结快照：目标仍是 1000，不随当前数据漂移（计划后来调高也不覆盖旧报告）', async () => {
    await open()
    // 抽屉 append-to-body：行在 body 下，用原生点击触发 el-table 的 row-click。
    const rows = [...document.body.querySelectorAll('.el-table__row')]
    const v1Row = rows.find((r) => r.textContent?.includes('首次生成')) as HTMLElement
    expect(Boolean(v1Row)).toBe(true)
    v1Row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(hoisted.fetchReportVersion).toHaveBeenLastCalledWith(7, 1)
    const text = document.body.textContent ?? ''
    expect(text).toContain('1,000')
    expect(text).not.toContain('1,200')
  }, DRAWER_TIMEOUT)

  it('导出带版本号并从冻结快照下载 CSV（与归档一致）', async () => {
    hoisted.exportReport.mockResolvedValue({
      fileName: '中长期售电月度复盘-2026-08-v2.csv', contentType: 'text/csv',
      content: '报告,版本\n2026-08,2', reportId: 7, versionNo: 2, contentFingerprint: 'fp-2', notice: '',
    })
    await open()
    const exportButtons = [...document.body.querySelectorAll('[data-test="report-export"]')] as HTMLButtonElement[]
    expect(exportButtons.length).toBeGreaterThan(0)
    exportButtons.at(-1)!.click()
    await flushPromises()
    expect(hoisted.exportReport).toHaveBeenCalledWith(7, 2)
    expect(hoisted.downloadCsv).toHaveBeenCalledWith('中长期售电月度复盘-2026-08-v2.csv', '报告,版本\n2026-08,2')
  }, DRAWER_TIMEOUT)
})
