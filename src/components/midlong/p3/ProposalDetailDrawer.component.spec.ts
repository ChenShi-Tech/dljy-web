// 交易方案详情的交互不变量（dljy#2973，MS-03/MS-04/MS-05、MT-01/MT-02）。
// 守什么：方案测算标「方案测算」、名义金额、不判断价格优劣，已售不完整时交易后电量不计算；
//        确认可执行带上测算里看到的目标版本，余额冲突显示最新可安排量；
//        导出申报材料只下载文件、不发任何写请求、不改状态；登记提交无回执时明示不代表平台已受理；
//        公告已更正时显示差异与重新核对入口。
// 坏掉的症状：导出后方案被标成已提交；余额冲突只显示「失败」；无回执提交被显示成已受理。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import { FORBIDDEN_PLANNING_TERMS, PLANNING_NOTICES, type PlanProgress, type ProposalComparison, type TradeProposalDetail } from '@/services/midlong/midlongP3Types'

const hoisted = vi.hoisted(() => ({
  fetchProposal: vi.fn(), fetchProposalComparison: vi.fn(), confirmProposal: vi.fn(), cancelProposal: vi.fn(), closeProposal: vi.fn(), exportProposal: vi.fn(),
  recheckProposalWindow: vi.fn(), markAwaitingResult: vi.fn(), fetchPlanningAttachment: vi.fn(), downloadCsv: vi.fn(), info: vi.fn(),
}))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), info: hoisted.info } }))
vi.mock('@/services/midlong/midlongApi', () => ({ midlongFailureOf: (e: unknown) => (e as { failure: unknown }).failure }))
vi.mock('@/services/midlong/midlongP3Api', () => ({
  fetchProposal: hoisted.fetchProposal, fetchProposalComparison: hoisted.fetchProposalComparison, confirmProposal: hoisted.confirmProposal,
  cancelProposal: hoisted.cancelProposal, closeProposal: hoisted.closeProposal, exportProposal: hoisted.exportProposal,
  recheckProposalWindow: hoisted.recheckProposalWindow, markAwaitingResult: hoisted.markAwaitingResult, fetchPlanningAttachment: hoisted.fetchPlanningAttachment,
}))
vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), downloadCsv: hoisted.downloadCsv }))

import ProposalDetailDrawer from './ProposalDetailDrawer.vue'

const STUBS = { SubmissionDialog: { template: '<div />' } }
const WRITE_APIS = ['confirmProposal', 'cancelProposal', 'closeProposal', 'recheckProposalWindow', 'markAwaitingResult'] as const

function progress(o: Partial<PlanProgress> = {}): PlanProgress {
  return {
    targetQuantity: '1000', knownSoldQuantity: '700', soldComplete: true, remainingPlanQuantity: '300', completionRate: '0.7', openOccupationQuantity: '0',
    arrangeableQuantity: '300', overPlan: false, verificationStatus: 'VERIFIED', notices: [], incompleteContracts: [], positionsAsOf: '', ...o,
  }
}

function proposal(o: Partial<TradeProposalDetail> = {}): TradeProposalDetail {
  return {
    id: 42, companyId: 'comp-a', regionId: 'yunnan', subjectId: 1, subjectName: '测试交易单元', windowId: 5, windowRevisionNo: 1, productKind: 'MONTHLY',
    tradeMethod: 'CENTRALIZED_BIDDING', proposedPrice: '330', priceTaxBasis: 'TAX_INCLUDED', priceComponent: 'ENERGY_ONLY', ownerName: '测试负责人', rationale: '【测试数据】理由',
    status: 'DRAFT', rowVersion: 3, confirmedAt: null, confirmedBy: null, positionsAsOf: null, awaitingResultAt: null, awaitingResultBy: null, endedAt: null, endedBy: null,
    endReason: null, closeKind: null, createdAt: '', createdBy: null, updatedAt: '', segments: [{ deliveryMonth: '2031-05', quantity: '200' }, { deliveryMonth: '2031-06', quantity: '50' }],
    totalQuantity: '250', planRefs: [], occupations: [], openOccupationQuantity: '0', submissions: [],
    window: {
      windowId: 5, referencedRevisionNo: 1, currentRevisionNo: 1, needsRecheck: false, notice: null, changesSinceReferenced: [], current: null,
      referenced: { announcementName: '【测试数据】月度集中竞价公告', declarationClosesAt: null, confirmationAt: null, pendingFields: [{ field: 'declarationClosesAt', label: '申报截止时间', reason: 'MISSING' }] } as never,
    },
    readiness: { missing: [], windowMismatches: [], windowUnverified: [], windowRevised: false }, events: [], notices: [], formalPosition: false, ...o,
  }
}

function comparison(): ProposalComparison {
  return {
    proposalId: 42, proposalStatus: 'DRAFT', proposalRowVersion: 3, uncoveredMonths: [], nature: 'SIMULATION', notices: [],
    priceAssessment: { status: 'NOT_ASSESSED', reason: 'NO_COMPARABLE_MIDLONG_QUOTE' },
    proposal: { totalQuantity: '250', proposedPrice: '330', priceTaxBasis: 'TAX_INCLUDED', priceComponent: 'ENERGY_ONLY', notionalAmount: '82500' },
    months: [
      { month: '2031-05', proposalQuantity: '200', proposalNotionalAmount: '66000', before: { formalQuantity: '700', soldComplete: true, affectedContractIds: [], groups: [], comparable: true, averagePrice: '300', notionalAmount: '210000', notionalAmountComplete: true },
        after: { quantity: '900', groups: [], comparable: true, averagePrice: '306.666667', notionalAmount: '276000', notionalAmountComplete: true } },
      { month: '2031-06', proposalQuantity: '50', proposalNotionalAmount: '16500', before: { formalQuantity: '100', soldComplete: false, affectedContractIds: [9], groups: [], comparable: true, averagePrice: null, notionalAmount: null, notionalAmountComplete: false },
        after: { quantity: null, groups: [], comparable: true, averagePrice: null, notionalAmount: null, notionalAmountComplete: false } },
    ],
    plans: [{ planId: 7, periodType: 'MONTH', periodKey: '2031-05', currentRevisionNo: 2, referencedRevisionNo: null, referencedTargetQuantity: null, revisionSuperseded: false, proposalQuantityInPeriod: '200',
      before: progress(), after: progress({ knownSoldQuantity: '900', remainingPlanQuantity: '100', completionRate: '0.9', arrangeableQuantity: '100' }) }],
    positionsAsOf: '',
  }
}

afterEach(() => vi.clearAllMocks())
enableAutoUnmount(afterEach)

async function open(p: TradeProposalDetail, mode: 'plans' | 'execution' = 'plans') {
  hoisted.fetchProposal.mockResolvedValue(p)
  hoisted.fetchProposalComparison.mockResolvedValue(comparison())
  const w = mount(ProposalDetailDrawer, { props: { modelValue: true, proposalId: p.id, canWrite: true, mode }, global: { stubs: STUBS } })
  await flushPromises()
  return w
}
const button = (w: Awaited<ReturnType<typeof open>>, label: string) => w.findAll('button').find((b) => b.text().startsWith(label))

describe('交易方案详情', () => {
  it('方案测算：标方案测算与名义金额，不判断价格优劣；已售不完整月份交易后电量不计算；公告截止未知显示待补', async () => {
    const w = await open(proposal())
    const text = w.text()
    expect(text).toContain(PLANNING_NOTICES.simulation)
    expect(text).toContain(PLANNING_NOTICES.priceNotAssessed)
    expect(text).toContain('名义金额')
    expect(text).toContain('276,000')
    expect(text).toContain('已售不完整，不计算')
    expect(text).toContain('300 MWh → 100 MWh')
    expect(text).toContain('70% → 90%')
    expect(text).toContain('申报截止：待补')
    for (const term of FORBIDDEN_PLANNING_TERMS) expect(text).not.toContain(term)
  })

  it('确认可执行带上测算中的目标版本；余额冲突时显示最新可安排计划量', async () => {
    const w = await open(proposal())
    hoisted.confirmProposal.mockRejectedValue({ failure: { status: 409, errorCode: 'VERSION_CONFLICT', message: '冲突', details: { reason: 'ARRANGEABLE_BALANCE_EXCEEDED', conflicts: [{ periodKey: '2031-05', arrangeableQuantity: '20', requestedQuantity: '200' }] } } })
    await button(w, '确认可执行')!.trigger('click')
    await flushPromises()
    expect(hoisted.confirmProposal).toHaveBeenCalledWith(42, { expectedRowVersion: 3, expectedPlanRevisions: [{ planId: 7, revisionNo: 2 }] })
    expect(w.text()).toContain('2031-05 剩余可安排 20 MWh，本方案需要 200 MWh')
  })

  it('导出申报材料只下载文件：不发任何写请求、不重新加载、状态不变', async () => {
    const w = await open(proposal({ status: 'EXECUTABLE' }), 'execution')
    hoisted.exportProposal.mockResolvedValue({ fileName: '方案-42-v3.csv', content: '方案编号,42', proposalRowVersion: 3, proposalStatus: 'EXECUTABLE', contentType: 'text/csv', proposalId: 42, notice: '' })
    const loadsBefore = hoisted.fetchProposal.mock.calls.length
    await button(w, '导出申报材料')!.trigger('click')
    await flushPromises()
    expect(hoisted.downloadCsv).toHaveBeenCalledWith('方案-42-v3.csv', '方案编号,42')
    for (const api of WRITE_APIS) expect(hoisted[api]).not.toHaveBeenCalled()
    expect(hoisted.fetchProposal.mock.calls.length).toBe(loadsBefore)
    expect(w.text()).toContain('确认可执行')
    expect(w.text()).toContain(PLANNING_NOTICES.exportNotSubmission)
  })

  it('无回执的提交登记：显示依据待补与不代表平台已受理', async () => {
    const w = await open(proposal({
      status: 'SUBMITTED',
      submissions: [{ id: 1, proposalId: 42, submittedAt: '2026-09-01T02:00:00.000Z', submittedByName: '测试交易员', channel: null, note: null, registeredAt: '2026-09-01T02:05:00.000Z', registeredBy: 'cgn-admin', receipts: [], receiptCompleteness: 'NONE', receiptMissing: ['externalReference', 'receiptAt', 'attachment'], platformAcceptance: 'NOT_ASSERTED', notice: '' }],
    }), 'execution')
    const text = w.text()
    expect(text).toContain('无回执（仅登记提交事实）')
    expect(text).toContain('依据待补：外部申报/回执编号、平台回执时间、回执文件')
    expect(text).toContain(PLANNING_NOTICES.submissionNotAccepted)
    // 去掉「不代表平台已受理」这条否定说明后，页面其他地方不能出现任何「受理」字样。
    expect(text.replaceAll(PLANNING_NOTICES.submissionNotAccepted, '')).not.toContain('受理')
  })

  it('公告已更正：显示新旧差异与重新核对入口，核对带上当前版本号', async () => {
    const w = await open(proposal({
      status: 'EXECUTABLE',
      window: {
        windowId: 5, referencedRevisionNo: 1, currentRevisionNo: 2, needsRecheck: true, notice: PLANNING_NOTICES.windowRevised, current: null,
        referenced: { announcementName: '【测试数据】公告', declarationClosesAt: '2031-04-20T09:00:00.000Z', confirmationAt: null, pendingFields: [] } as never,
        changesSinceReferenced: [{ field: 'declarationClosesAt', label: '申报截止时间', previous: '2031-04-20T09:00:00.000Z', next: '2031-04-21T04:00:00.000Z' }],
      },
    }))
    expect(w.text()).toContain(PLANNING_NOTICES.windowRevised)
    expect(w.text()).toContain('申报截止时间：2031-04-20T09:00:00.000Z → 2031-04-21T04:00:00.000Z')
    hoisted.recheckProposalWindow.mockResolvedValue({ proposalId: 42, windowRevisionNo: 2, rowVersion: 4 })
    await w.find('.p3-inline input').setValue('【测试数据】已核对')
    await button(w, '按新版本重新核对')!.trigger('click')
    await flushPromises()
    expect(hoisted.recheckProposalWindow).toHaveBeenCalledWith(42, { expectedRowVersion: 3, windowRevisionNo: 2, note: '【测试数据】已核对' })
  })
})
