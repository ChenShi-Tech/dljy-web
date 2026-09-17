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
  routeQuery: {} as Record<string, string>, companyRef: null as null | { value: string },
}))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: hoisted.routeQuery }), useRouter: () => ({ replace: hoisted.replace }) }))
vi.mock('@/services/company/companyContext', async () => {
  const selectedCompanyId = (await import('vue')).ref('comp-a')
  hoisted.companyRef = selectedCompanyId
  return { selectedCompanyId }
})
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))
vi.mock('@/services/midlong/midlongApi', () => ({
  CompanyNotSelectedError: class extends Error {},
  fetchCapabilities: hoisted.fetchCapabilities,
  fetchSubjects: vi.fn(async () => [{ id: 1, displayName: '测试交易单元', subjectKey: 'TEST-1' }]),
  midlongFailureOf: (e: unknown) => ({ status: 500, errorCode: 'STORAGE_UNAVAILABLE', message: (e as Error).message, details: null }),
}))
vi.mock('@/services/midlong/midlongP3Api', () => ({
  fetchPlanProgress: hoisted.fetchPlanProgress, fetchProposals: hoisted.fetchProposals, fetchAllWindows: hoisted.fetchWindows, confirmPlan: hoisted.confirmPlan,
}))

import MidlongPlansView from './MidlongPlansView.vue'

const STUBS = {
  CompanyScopeBar: { template: '<div />' }, PlanFormDialog: { template: '<div />' },
  PlanDetailDrawer: { props: ['modelValue', 'planId'], template: '<div class="stub-plan-drawer" :data-open="String(modelValue)" />' },
  ProposalFormDialog: { props: ['modelValue'], template: '<div class="stub-proposal-form" :data-open="String(modelValue)" />' },
  ProposalDetailDrawer: { props: ['modelValue', 'proposalId'], template: '<div class="stub-proposal-drawer" :data-open="String(modelValue)" :data-id="proposalId" />' },
  'router-link': { template: '<a><slot /></a>' },
}
const page = <T>(rows: T[], total = rows.length) => ({ rows, total, page: 1, pageSize: 50 })

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
    arrangeableQuantity: '100', overPlan: false, overCommitted: false, verificationStatus: 'VERIFIED', notices: [], incompleteContracts: [], positionsAsOf: '2031-01-01T00:00:00.000Z', ...o,
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
    view: 'CURRENT', asOf: '2031-01-01T00:00:00.000Z', regionId: 'yunnan', generatedAt: '2031-01-01T00:00:00.000Z', notices: [], total: 4, page: 1, pageSize: 50,
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
  if (hoisted.companyRef) hoisted.companyRef.value = 'comp-a'
})
enableAutoUnmount(afterEach)

describe('中长期售电计划页', () => {
  it('剩余计划待售量与完成率：已核验、超计划、未完成核验、目标未确认分别如实显示', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps({ plans: true, execution: true }))
    hoisted.fetchPlanProgress.mockResolvedValue(report())
    hoisted.fetchProposals.mockResolvedValue(page([]))
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
    hoisted.fetchProposals.mockResolvedValue(page([]))
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
    hoisted.fetchProposals.mockResolvedValue(page([]))
    hoisted.fetchWindows.mockResolvedValue([])
    const w = mount(MidlongPlansView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.find('[data-test="targets-error"]').text()).toContain('完成情况加载失败（未显示任何替代数值）')
    // 目标标签里不出现任何电量数值（方案标签的表头「交割片段（MWh）」不算）。
    expect(w.find('#pane-targets').text()).not.toContain('MWh')
  })
  it('切换公司：关闭已打开的方案与目标详情抽屉，按新公司回到第一页重新取数', async () => {
    const proposalRow = { id: 42, status: 'EXECUTABLE', subjectId: 1, subjectName: '测试交易单元', segments: [{ deliveryMonth: '2031-05', quantity: '80' }], proposedPrice: null, openOccupationQuantity: '80', window: null }
    hoisted.fetchCapabilities.mockResolvedValue(caps({ plans: true, execution: true }))
    hoisted.fetchPlanProgress.mockResolvedValue(report())
    hoisted.fetchProposals.mockResolvedValue(page([proposalRow]))
    hoisted.fetchWindows.mockResolvedValue([])
    const w = mount(MidlongPlansView, { global: { stubs: STUBS } })
    await flushPromises()
    await w.findAll('.ml-table .el-table__body-wrapper tbody tr')[0].findAll('button').find((b) => b.text() === '版本与占用')!.trigger('click')
    await w.findAll('.el-tabs__item').find((t) => t.text() === '交易方案')!.trigger('click')
    await flushPromises()
    await w.findAll('.el-table__row').find((r) => r.text().includes('#42'))!.trigger('click')
    await flushPromises()
    expect(w.find('.stub-proposal-drawer').attributes('data-open')).toBe('true')
    expect(w.find('.stub-plan-drawer').attributes('data-open')).toBe('true')
    hoisted.companyRef!.value = 'comp-b'
    await flushPromises()
    expect(w.find('.stub-proposal-drawer').attributes('data-open')).toBe('false')
    expect(w.find('.stub-plan-drawer').attributes('data-open')).toBe('false')
    expect(hoisted.fetchPlanProgress).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }))
  })

  it('占用超过目标时标注并提示；目标超过一页时显示分页并按页取数', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps({ plans: true, execution: false }))
    hoisted.fetchPlanProgress.mockResolvedValue(report({
      total: 120,
      rows: [row(1, '2031-05', { knownSoldQuantity: '50', remainingPlanQuantity: '50', completionRate: '0.05', openOccupationQuantity: '80', arrangeableQuantity: '-30', overCommitted: true })],
    }))
    hoisted.fetchProposals.mockResolvedValue(page([]))
    const w = mount(MidlongPlansView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('占用超目标')
    expect(w.text()).toContain(PLANNING_NOTICES.overCommitted)
    expect(w.text()).toContain('-30 MWh')
    expect(w.find('.ml-pagination').exists()).toBe(true)
    expect(hoisted.fetchPlanProgress).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 50 }))
  })
  it('从第 2 页进入历史视图：只剩一行结果时按第 1 页请求，不请求不存在的第 2 页', async () => {
    hoisted.routeQuery = { page: '2' }
    hoisted.fetchCapabilities.mockResolvedValue(caps({ plans: true, execution: false }))
    hoisted.fetchPlanProgress.mockResolvedValue(report({ total: 120, page: 2 }))
    const w = mount(MidlongPlansView, { global: { stubs: { ...STUBS, PlanDetailDrawer: { emits: ['history'], template: '<button class="stub-history" @click="$emit(\'history\', { planId: 7, asOf: \'2031-01-31T23:59:59.999Z\', revisionNo: 1 })" />' } } } })
    await flushPromises()
    expect(hoisted.fetchPlanProgress).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
    await w.find('.stub-history').trigger('click')
    await flushPromises()
    expect(hoisted.fetchPlanProgress).toHaveBeenLastCalledWith(expect.objectContaining({ planId: '7', asOf: '2031-01-31T23:59:59.999Z', page: 1 }))
  })

  it('方案标签改了条件就回到第一页：从第 3 页改状态后查询按第 1 页请求', async () => {
    hoisted.routeQuery = { tab: 'proposals', proposalPage: '3' }
    hoisted.fetchCapabilities.mockResolvedValue(caps({ plans: true, execution: false }))
    hoisted.fetchProposals.mockResolvedValue({ rows: [], total: 150, page: 3, pageSize: 50 })
    const w = mount(MidlongPlansView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchProposals).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }))
    w.findAllComponents({ name: 'ElSelect' }).find((c) => c.props('placeholder') === '方案状态')!.vm.$emit('update:modelValue', 'EXECUTABLE')
    await flushPromises()
    await w.findAll('button').filter((b) => b.text() === '查询').at(-1)!.trigger('click')
    await flushPromises()
    expect(hoisted.fetchProposals).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'EXECUTABLE', page: 1 }))
  })

  it('标签页分别加载：方案接口失败只在方案标签报错，目标标签的完成情况照常显示且不被清空', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps({ plans: true, execution: true }))
    hoisted.fetchPlanProgress.mockResolvedValue(report())
    hoisted.fetchProposals.mockRejectedValue(new Error('方案接口不可用'))
    hoisted.fetchWindows.mockRejectedValue(new Error('公告接口不可用'))
    const w = mount(MidlongPlansView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchProposals).not.toHaveBeenCalled()
    expect(hoisted.fetchWindows).not.toHaveBeenCalled()
    expect(w.text()).toContain('300 MWh')
    await w.findAll('.el-tabs__item').find((t) => t.text() === '交易方案')!.trigger('click')
    await flushPromises()
    expect(w.find('[data-test="proposals-error"]').text()).toContain('方案接口不可用')
    expect(w.find('[data-test="targets-error"]').exists()).toBe(false)
    expect(w.text()).toContain('300 MWh')
    await w.findAll('.el-tabs__item').find((t) => t.text() === '目标与完成情况')!.trigger('click')
    await flushPromises()
    expect(w.findAll('.ml-table .el-table__body-wrapper tbody tr')[0].text()).toContain('300 MWh')
  })

  it('公告候选在打开方案表单时才加载；加载中切换公司则不打开表单', async () => {
    hoisted.routeQuery = { tab: 'proposals' }
    hoisted.fetchCapabilities.mockResolvedValue(caps({ plans: true, execution: true }))
    hoisted.fetchProposals.mockResolvedValue(page([]))
    let resolveWindows: (rows: unknown[]) => void = () => {}
    hoisted.fetchWindows.mockImplementation(() => new Promise((resolve) => { resolveWindows = resolve }))
    const w = mount(MidlongPlansView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchWindows).not.toHaveBeenCalled()
    await w.findAll('button').find((b) => b.text() === '新建方案草稿')!.trigger('click')
    expect(hoisted.fetchWindows).toHaveBeenCalledTimes(1)
    hoisted.companyRef!.value = 'comp-b'
    await flushPromises()
    resolveWindows([])
    await flushPromises()
    expect(w.find('.stub-proposal-form').attributes('data-open')).toBe('false')
  })
})
