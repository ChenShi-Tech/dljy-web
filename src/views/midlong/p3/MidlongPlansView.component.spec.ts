// 中长期售电计划页的渲染不变量（dljy#2973，MS-01/MS-02/MS-04）。
// 守什么：术语为剩余计划待售量；已核验行显示剩余与完成率、超计划显示负数与超过 100% 并标超计划、
//        未完成核验与目标未确认不显示 0；目标是经营安排的声明可见；历史视图有说明；能力未开放时不取数；
//        页面不出现套保率、现货敞口、预计利润。
// 坏掉的症状：未分解合同的月份显示「剩余 1000、完成率 0%」；超计划被截成 0；能力未开放仍请求接口出空壳页面。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongCapabilities } from '@/services/midlong/midlongTypes'
import { FORBIDDEN_PLANNING_TERMS, PLANNING_NOTICES, type PlanProgress, type PlanProgressReport, type PlanProgressRow } from '@/services/midlong/midlongP3Types'

const hoisted = vi.hoisted(() => ({
  fetchCapabilities: vi.fn(), fetchPlanProgress: vi.fn(), fetchProposals: vi.fn(), fetchWindows: vi.fn(), confirmPlan: vi.fn(), replace: vi.fn(),
  routeQuery: {} as Record<string, string>,
}))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: hoisted.routeQuery }), useRouter: () => ({ replace: hoisted.replace }) }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))
vi.mock('@/services/midlong/midlongApi', () => ({
  CompanyNotSelectedError: class extends Error {},
  fetchCapabilities: hoisted.fetchCapabilities,
  fetchSubjects: vi.fn(async () => [{ id: 1, displayName: '测试交易单元', subjectKey: 'TEST-1' }]),
  midlongFailureOf: (e: unknown) => ({ status: 500, errorCode: 'STORAGE_UNAVAILABLE', message: (e as Error).message, details: null }),
}))
vi.mock('@/services/midlong/midlongP3Api', () => ({
  fetchPlanProgress: hoisted.fetchPlanProgress, fetchProposals: hoisted.fetchProposals, fetchWindows: hoisted.fetchWindows, confirmPlan: hoisted.confirmPlan,
}))

import MidlongPlansView from './MidlongPlansView.vue'

const STUBS = {
  CompanyScopeBar: { template: '<div />' }, PlanFormDialog: { template: '<div />' }, PlanDetailDrawer: { template: '<div />' },
  ProposalFormDialog: { template: '<div />' }, ProposalDetailDrawer: { template: '<div />' }, 'router-link': { template: '<a><slot /></a>' },
}

function caps(modules: { plans: boolean; execution: boolean }): MidlongCapabilities {
  return {
    enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1',
    modules: { contracts: true, positions: true, imports: true, review: false, ...modules },
    canWrite: true, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null,
  } as unknown as MidlongCapabilities
}

function progress(o: Partial<PlanProgress> = {}): PlanProgress {
  return {
    targetQuantity: '1000', knownSoldQuantity: '700', soldComplete: true, remainingPlanQuantity: '300', completionRate: '0.7', openOccupationQuantity: '200',
    arrangeableQuantity: '100', overPlan: false, verificationStatus: 'VERIFIED', notices: [], incompleteContracts: [], positionsAsOf: '2031-01-01T00:00:00.000Z', ...o,
  }
}

function row(id: number, periodKey: string, p: Partial<PlanProgress>, confirmed = true): PlanProgressRow {
  const revision = { id, planId: id, revisionNo: 1, status: 'CONFIRMED' as const, supersedesRevisionNo: null, targetQuantity: p.targetQuantity ?? '1000', targetPriceLow: null, targetPriceHigh: null, priceTaxBasis: 'UNKNOWN' as const, basisNote: '测试依据', ownerName: '测试', changeReason: null, recordedAt: '', recordedBy: null, updatedAt: '', confirmedAt: '2031-01-01T00:00:00.000Z', confirmedBy: 'cgn-admin' }
  return {
    id, companyId: 'comp-a', regionId: 'yunnan', subjectId: 1, subjectName: '测试交易单元', subjectKey: 'TEST-1', periodType: 'MONTH', periodKey, currentRevisionNo: 1,
    confirmedRevisionNo: confirmed ? 1 : null, rowVersion: 2, createdAt: '', createdBy: null, updatedAt: '', targetNature: 'BUSINESS_ARRANGEMENT', targetNatureNotice: PLANNING_NOTICES.targetNature,
    confirmedRevision: confirmed ? revision : null, draftRevision: null, progress: progress(p),
  }
}

function report(o: Partial<PlanProgressReport> = {}): PlanProgressReport {
  return {
    view: 'CURRENT', asOf: '2031-01-01T00:00:00.000Z', regionId: 'yunnan', generatedAt: '2031-01-01T00:00:00.000Z', notices: [],
    rows: [
      row(1, '2031-05', {}),
      row(2, '2031-06', { knownSoldQuantity: '1100', remainingPlanQuantity: '-100', completionRate: '1.1', arrangeableQuantity: '-150', overPlan: true, openOccupationQuantity: '50' }),
      row(3, '2031-07', { knownSoldQuantity: '800', soldComplete: false, remainingPlanQuantity: null, completionRate: null, arrangeableQuantity: null, verificationStatus: 'UNVERIFIED', openOccupationQuantity: '0' }),
      row(4, '2031-08', { targetQuantity: null, remainingPlanQuantity: null, completionRate: null, arrangeableQuantity: null, verificationStatus: 'TARGET_UNKNOWN', openOccupationQuantity: '0' }, false),
    ],
    ...o,
  }
}

afterEach(() => {
  vi.clearAllMocks()
  hoisted.routeQuery = {}
})
enableAutoUnmount(afterEach)

describe('中长期售电计划页', () => {
  it('剩余计划待售量与完成率：已核验、超计划、未完成核验、目标未确认分别如实显示', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps({ plans: true, execution: true }))
    hoisted.fetchPlanProgress.mockResolvedValue(report())
    hoisted.fetchProposals.mockResolvedValue([])
    hoisted.fetchWindows.mockResolvedValue([])
    const w = mount(MidlongPlansView, { global: { stubs: STUBS } })
    await flushPromises()
    const text = w.text()
    expect(text).toContain('剩余计划待售量')
    expect(text).toContain(PLANNING_NOTICES.targetNature)
    const rows = w.findAll('.ml-table .el-table__body-wrapper tbody tr')
    expect(rows[0].text()).toContain('300 MWh')
    expect(rows[0].text()).toContain('70%')
    expect(rows[0].text()).toContain('100 MWh')
    expect(rows[1].text()).toContain('-100 MWh')
    expect(rows[1].text()).toContain('-150 MWh')
    expect(rows[1].text()).toContain('110%')
    expect(rows[1].text()).toContain('超计划')
    expect(rows[2].text()).toContain('待核验（不按零计）')
    expect(rows[2].text()).toContain('另有未分解')
    expect(rows[2].text()).not.toMatch(/\b0%/)
    expect(rows[3].text()).toContain('目标未确认')
    expect(text).toContain('部分结果未完成核验')
    for (const term of FORBIDDEN_PLANNING_TERMS) expect(text).not.toContain(term)
  })

  it('历史视图：显示旧报告说明，不提供新建与确认操作', async () => {
    hoisted.routeQuery = { planId: '1', asOf: '2031-02-01T00:00:00.000Z' }
    hoisted.fetchCapabilities.mockResolvedValue(caps({ plans: true, execution: false }))
    hoisted.fetchPlanProgress.mockResolvedValue(report({ view: 'AS_OF', rows: [row(1, '2031-05', {})] }))
    hoisted.fetchProposals.mockResolvedValue([])
    const w = mount(MidlongPlansView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchPlanProgress).toHaveBeenCalledWith(expect.objectContaining({ planId: '1', asOf: '2031-02-01T00:00:00.000Z' }))
    expect(w.text()).toContain('历史视图（旧报告）')
    expect(w.findAll('button').some((b) => b.text() === '新建目标')).toBe(false)
    expect(hoisted.fetchWindows).not.toHaveBeenCalled()
  })

  it('能力未开放：显示未开放提示，不请求计划与方案接口', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps({ plans: false, execution: false }))
    const w = mount(MidlongPlansView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('售电计划功能尚未开放')
    expect(hoisted.fetchPlanProgress).not.toHaveBeenCalled()
    expect(hoisted.fetchProposals).not.toHaveBeenCalled()
  })

  it('服务失败显示错误，不显示任何替代数值', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps({ plans: true, execution: true }))
    hoisted.fetchPlanProgress.mockRejectedValue(new Error('存储不可用'))
    hoisted.fetchProposals.mockResolvedValue([])
    hoisted.fetchWindows.mockResolvedValue([])
    const w = mount(MidlongPlansView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('计划加载失败（未显示任何替代数值）')
    expect(w.text()).not.toContain('MWh')
  })
})
