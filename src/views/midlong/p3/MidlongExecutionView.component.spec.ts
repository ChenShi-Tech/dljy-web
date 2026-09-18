// 中长期交易执行页的渲染不变量（dljy#2973，MT-01/MT-02）。
// 守什么：日历只列公告明确给出的时间并按北京时间分日；时间未知的公告列入「待补」、不生成事件；
//        公告列表显示待核对参数数与待重新核对方案数；执行标签只列已进入执行链路的方案，并提示导出不等于提交；
//        能力未开放时不请求接口；公告详情抽屉开着时登记更正公告，保存后抽屉重新取数显示新版本；
//        交易主体加载期间换了公告不弹出原公告的更正表单；请求进行中动了筛选控件，结果照常显示不被丢弃。
// 坏掉的症状：缺截止时间的公告被套上默认截止出现在日历里；草稿方案出现在执行列表可登记提交。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongCapabilities } from '@/services/midlong/midlongTypes'
import { PLANNING_NOTICES, type TradeProposalDetail, type TradingWindowDetail, type TradingWindowListRow, type WindowCalendarReport } from '@/services/midlong/midlongP3Types'

const hoisted = vi.hoisted(() => ({
  fetchCapabilities: vi.fn(), fetchWindowCalendar: vi.fn(), fetchWindows: vi.fn(), fetchProposals: vi.fn(), fetchSubjects: vi.fn(), fetchWindow: vi.fn(), replace: vi.fn(), routeQuery: {} as Record<string, string>,
  companyRef: null as null | { value: string },
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
  fetchSubjects: hoisted.fetchSubjects,
  midlongFailureOf: (e: unknown) => ({ status: 500, errorCode: 'STORAGE_UNAVAILABLE', message: (e as Error).message, details: null }),
}))
vi.mock('@/services/midlong/midlongP3Api', () => ({
  fetchWindowCalendar: hoisted.fetchWindowCalendar, fetchWindows: hoisted.fetchWindows, fetchProposals: hoisted.fetchProposals,
  // 公告详情抽屉按真实组件挂载时用到的接口。
  fetchWindow: hoisted.fetchWindow, fetchPlanningAttachment: vi.fn(),
}))

import MidlongExecutionView from './MidlongExecutionView.vue'
import WindowDetailDrawer from '@/components/midlong/p3/WindowDetailDrawer.vue'

const STUBS = {
  CompanyScopeBar: { template: '<div />' }, WindowFormDialog: { props: ['modelValue'], template: '<div class="stub-window-form" :data-open="String(modelValue)" />' }, WindowDetailDrawer: { template: '<div />' },
  ProposalDetailDrawer: { template: '<div />' }, 'router-link': { template: '<a><slot /></a>' },
}

function caps(execution: boolean): MidlongCapabilities {
  return {
    enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1',
    modules: { contracts: true, positions: true, imports: true, review: false, plans: true, execution },
    canWrite: true, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null,
  } as unknown as MidlongCapabilities
}

const page = <T>(rows: T[], total = rows.length) => ({ rows, total, page: 1, pageSize: 50 })

const calendar: WindowCalendarReport = {
  fromMonth: '2031-04', toMonth: '2031-06', notice: PLANNING_NOTICES.windowPending, windowTotal: 2, windowLimit: 500, truncated: false,
  events: [
    { kind: 'DECLARATION_OPENS', label: '申报开始', at: '2031-04-19T16:30:00.000Z', windowId: 1, revisionNo: 2, announcementName: '【测试数据】已明确时间的公告' },
    { kind: 'DECLARATION_CLOSES', label: '申报截止', at: '2031-04-20T09:00:00.000Z', windowId: 1, revisionNo: 2, announcementName: '【测试数据】已明确时间的公告' },
  ],
  pending: [{ windowId: 2, revisionNo: 1, announcementName: '【测试数据】只有交割月的公告', deliveryStartMonth: '2031-05', deliveryEndMonth: '2031-05', pendingTimes: [{ kind: 'DECLARATION_CLOSES', label: '申报截止待补' }] }],
}

const windowRow = (id: number, name: string, pending: number, recheck: number): TradingWindowListRow => ({
  id, companyId: 'comp-a', regionId: 'yunnan', currentRevisionNo: 2, rowVersion: 2, createdAt: '', createdBy: null, proposalCount: 3, proposalsNeedingRecheck: recheck,
  current: { announcementName: name, sourceName: null, publishedDate: null, deliveryStartMonth: '2031-05', deliveryEndMonth: null, declarationClosesAt: null, pendingFields: Array.from({ length: pending }, (_, i) => ({ field: `f${i}`, label: `参数${i}`, reason: 'MISSING' })) } as never,
})

const proposalRow = (id: number, status: TradeProposalDetail['status']) => ({ id, status, subjectId: 1, subjectName: '测试交易单元', totalQuantity: '100', window: null, submissions: [] }) as unknown as TradeProposalDetail

function windowDetail(revisionNo: number, changeReason: string | null): TradingWindowDetail {
  const revision = (no: number, reason: string | null) => ({
    id: no, revisionNo: no, announcementName: '【测试数据】公告甲', recordedBy: 'cgn-admin', recordedAt: '', changeReason: reason, sourceName: null, sourceReference: null, publishedDate: null,
    announcementVersion: null, effectiveFrom: null, effectiveTo: null, applicableScope: null, applicableSubjectIds: [], tradeMethod: null, productKind: null, deliveryStartMonth: '2031-05',
    deliveryEndMonth: null, declarationOpensAt: null, declarationClosesAt: null, confirmationAt: null, attachment: null, pendingFields: [], changesFromPrevious: [],
  })
  return {
    id: 1, companyId: 'comp-a', regionId: 'yunnan', currentRevisionNo: revisionNo, rowVersion: revisionNo, createdAt: '', createdBy: null, proposals: [], events: [], notice: PLANNING_NOTICES.windowPending,
    revisions: Array.from({ length: revisionNo }, (_, i) => revision(i + 1, i + 1 === revisionNo ? changeReason : null)),
  } as unknown as TradingWindowDetail
}

afterEach(() => {
  vi.clearAllMocks()
  hoisted.routeQuery = {}
  if (hoisted.companyRef) hoisted.companyRef.value = 'comp-a'
})
enableAutoUnmount(afterEach)

describe('中长期交易执行页', () => {
  it('日历：已明确时间按北京时间分日，时间未知的公告只进待补、不生成事件', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps(true))
    hoisted.fetchWindowCalendar.mockResolvedValue(calendar)
    hoisted.fetchWindows.mockResolvedValue(page([]))
    hoisted.fetchProposals.mockResolvedValue(page([]))
    const w = mount(MidlongExecutionView, { global: { stubs: STUBS } })
    await flushPromises()
    const days = w.findAll('.ml-day')
    expect(days).toHaveLength(1)
    expect(days[0].find('.ml-day-date').text()).toBe('2031-04-20')
    expect(days[0].text()).toContain('00:30')
    expect(days[0].text()).toContain('17:00')
    expect(days[0].text()).not.toContain('只有交割月的公告')
    expect(w.text()).toContain('申报截止待补')
    expect(w.text()).toContain(PLANNING_NOTICES.windowPending)
  })

  it('公告标签只加载公告列表并显示待核对与待重新核对数；方案标签由服务端排除草稿并分页；各标签互不牵连', async () => {
    hoisted.routeQuery = { tab: 'windows' }
    hoisted.fetchCapabilities.mockResolvedValue(caps(true))
    hoisted.fetchWindows.mockResolvedValue(page([windowRow(1, '【测试数据】公告甲', 4, 2)], 130))
    hoisted.fetchProposals.mockResolvedValue(page([proposalRow(11, 'EXECUTABLE'), proposalRow(12, 'SUBMITTED')], 2))
    const w = mount(MidlongExecutionView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchWindows).toHaveBeenCalledWith({ page: 1, pageSize: 50 })
    expect(hoisted.fetchWindowCalendar).not.toHaveBeenCalled()
    expect(hoisted.fetchProposals).not.toHaveBeenCalled()
    expect(w.text()).toContain('【测试数据】公告甲')
    expect(w.text()).toContain('2 / 3')
    expect(w.findAll('.ml-pagination')).toHaveLength(1)
    await w.findAll('.el-tabs__item').find((t) => t.text() === '方案执行')!.trigger('click')
    await flushPromises()
    expect(hoisted.fetchProposals).toHaveBeenCalledWith(expect.objectContaining({ stage: 'execution', page: 1, pageSize: 50 }))
    const text = w.text()
    expect(text).toContain(PLANNING_NOTICES.exportNotSubmission)
    expect(text).toContain('#11')
    expect(text).toContain('#12')
    expect(text).toContain('未登记提交')
  })

  it('方案标签改了状态就回到第一页；日历加载失败不影响方案标签', async () => {
    hoisted.routeQuery = { tab: 'proposals', proposalPage: '3' }
    hoisted.fetchCapabilities.mockResolvedValue(caps(true))
    hoisted.fetchProposals.mockResolvedValue(page([proposalRow(11, 'EXECUTABLE')], 150))
    hoisted.fetchWindowCalendar.mockRejectedValue(new Error('日历接口不可用'))
    const w = mount(MidlongExecutionView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchProposals).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }))
    w.findAllComponents({ name: 'ElSelect' }).find((c) => c.props('placeholder') === '方案状态')!.vm.$emit('update:modelValue', 'SUBMITTED')
    await w.findAll('.el-tabs__item').find((t) => t.text() === '交易日历')!.trigger('click')
    await flushPromises()
    expect(w.find('[data-test="calendar-error"]').text()).toContain('日历接口不可用')
    await w.findAll('.el-tabs__item').find((t) => t.text() === '方案执行')!.trigger('click')
    await flushPromises()
    expect(hoisted.fetchProposals).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'SUBMITTED', page: 1 }))
    // 路由与请求一致：改条件后切换标签写入的 URL 不能留着第 3 页（第 1 页不写页码）。
    expect(hoisted.replace.mock.calls.at(-1)![0].query).toMatchObject({ tab: 'proposals', status: 'SUBMITTED' })
    expect(hoisted.replace.mock.calls.at(-1)![0].query).not.toHaveProperty('proposalPage')
    expect(w.text()).toContain('#11')
  })

  it('日历超过单次公告上限：明确提示未显示全部并给出总数', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps(true))
    hoisted.fetchWindowCalendar.mockResolvedValue({ ...calendar, windowTotal: 812, windowLimit: 500, truncated: true })
    const w = mount(MidlongExecutionView, { global: { stubs: STUBS } })
    await flushPromises()
    const notice = w.find('[data-test="calendar-truncated"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('共 812 条')
    expect(notice.text()).toContain('前 500 条')
  })

  it('能力未开放：显示未开放提示，不请求日历与公告接口', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps(false))
    const w = mount(MidlongExecutionView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('交易执行功能尚未开放')
    expect(hoisted.fetchWindowCalendar).not.toHaveBeenCalled()
    expect(hoisted.fetchWindows).not.toHaveBeenCalled()
  })
  it('交易主体在打开公告表单时才加载；加载中切换公司则不打开表单', async () => {
    hoisted.routeQuery = { tab: 'windows' }
    hoisted.fetchCapabilities.mockResolvedValue(caps(true))
    hoisted.fetchWindows.mockResolvedValue(page([]))
    let resolveSubjects: (rows: unknown[]) => void = () => {}
    hoisted.fetchSubjects.mockImplementation(() => new Promise((resolve) => { resolveSubjects = resolve }))
    const w = mount(MidlongExecutionView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchSubjects).not.toHaveBeenCalled()
    await w.findAll('button').find((b) => b.text() === '登记公告')!.trigger('click')
    expect(hoisted.fetchSubjects).toHaveBeenCalledTimes(1)
    hoisted.companyRef!.value = 'comp-b'
    await flushPromises()
    resolveSubjects([])
    await flushPromises()
    expect(w.find('.stub-window-form').attributes('data-open')).toBe('false')
  })

  it('公告详情抽屉开着时登记更正公告：保存后抽屉重新取数，显示新版本与更正原因', async () => {
    hoisted.routeQuery = { tab: 'windows' }
    hoisted.fetchCapabilities.mockResolvedValue(caps(true))
    hoisted.fetchWindows.mockResolvedValue(page([windowRow(1, '【测试数据】公告甲', 0, 0)]))
    hoisted.fetchSubjects.mockResolvedValue([])
    hoisted.fetchWindow.mockResolvedValueOnce(windowDetail(2, null)).mockResolvedValue(windowDetail(3, '【测试数据】更正申报截止'))
    const stubs = {
      ...STUBS,
      WindowDetailDrawer: false,
      WindowFormDialog: {
        props: ['modelValue', 'window'], emits: ['saved', 'update:modelValue'],
        template: '<div class="stub-window-form" :data-open="String(modelValue)"><button class="stub-window-save" @click="$emit(\'saved\', { windowId: window.id, revisionNo: 3 }); $emit(\'update:modelValue\', false)" /></div>',
      },
    }
    const w = mount(MidlongExecutionView, { global: { stubs } })
    await flushPromises()
    await w.findAll('.el-table__row').find((r) => r.text().includes('【测试数据】公告甲'))!.trigger('click')
    await flushPromises()
    const drawer = w.findComponent(WindowDetailDrawer)
    expect(drawer.text()).toContain('当前 v2')
    await drawer.findAll('button').find((b) => b.text() === '登记更正公告')!.trigger('click')
    await flushPromises()
    expect(w.find('.stub-window-form').attributes('data-open')).toBe('true')
    await w.find('.stub-window-save').trigger('click')
    await flushPromises()
    expect(hoisted.fetchWindow).toHaveBeenCalledTimes(2)
    expect(drawer.text()).toContain('当前 v3')
    expect(drawer.text()).toContain('更正原因：【测试数据】更正申报截止')
  })

  it('切换公司：重跑页面级加载刷新能力与写权限，清空全部标签，切到其他标签时不出现上一家公司的记录', async () => {
    hoisted.routeQuery = { tab: 'proposals' }
    hoisted.fetchCapabilities.mockResolvedValue(caps(true))
    hoisted.fetchProposals.mockResolvedValue(page([proposalRow(11, 'EXECUTABLE')]))
    hoisted.fetchWindows.mockResolvedValue(page([windowRow(1, '【测试数据】甲公司公告', 0, 0)]))
    const w = mount(MidlongExecutionView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('#11')
    await w.findAll('.el-tabs__item').find((t) => t.text() === '公告登记')!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('【测试数据】甲公司公告')
    expect(w.findAll('button').some((b) => b.text() === '登记公告')).toBe(true)

    // 乙公司只读；公告与方案接口都还没返回。
    hoisted.fetchCapabilities.mockResolvedValue({ ...caps(true), canWrite: false, companyId: 'comp-b', scopeCompanyIds: ['comp-b'] })
    hoisted.fetchWindows.mockImplementation(() => new Promise(() => {}))
    hoisted.fetchProposals.mockImplementation(() => new Promise(() => {}))
    hoisted.companyRef!.value = 'comp-b'
    await flushPromises()
    expect(hoisted.fetchCapabilities).toHaveBeenCalledTimes(2)
    expect(w.text()).not.toContain('【测试数据】甲公司公告')
    expect(w.findAll('button').some((b) => b.text() === '登记公告')).toBe(false)
    await w.findAll('.el-tabs__item').find((t) => t.text() === '方案执行')!.trigger('click')
    await flushPromises()
    expect(hoisted.fetchProposals).toHaveBeenCalledTimes(2)
    expect(w.text()).not.toContain('#11')
  })

  it('登记更正时交易主体加载期间换了公告：不弹出原公告的更正表单；抽屉仍是该公告时正常打开', async () => {
    hoisted.routeQuery = { tab: 'windows' }
    hoisted.fetchCapabilities.mockResolvedValue(caps(true))
    hoisted.fetchWindows.mockResolvedValue(page([windowRow(1, '【测试数据】公告甲', 0, 0), windowRow(2, '【测试数据】公告乙', 0, 0)]))
    let resolveSubjects: (rows: unknown[]) => void = () => {}
    hoisted.fetchSubjects.mockImplementationOnce(() => new Promise((resolve) => { resolveSubjects = resolve }))
    const stubs = {
      ...STUBS,
      WindowDetailDrawer: {
        props: ['modelValue', 'windowId'], emits: ['correct'],
        template: '<div class="stub-window-drawer" :data-id="windowId"><button class="stub-correct" @click="$emit(\'correct\', { id: windowId, rowVersion: 1, currentRevisionNo: 1 })" /></div>',
      },
      WindowFormDialog: { props: ['modelValue', 'window'], template: '<div class="stub-window-form" :data-open="String(modelValue)" :data-window="window ? window.id : \'\'" />' },
    }
    const w = mount(MidlongExecutionView, { global: { stubs } })
    await flushPromises()
    const openRow = async (name: string) => {
      await w.findAll('.el-table__row').find((r) => r.text().includes(name))!.trigger('click')
      await flushPromises()
    }
    await openRow('【测试数据】公告甲')
    await w.find('.stub-correct').trigger('click')
    expect(hoisted.fetchSubjects).toHaveBeenCalledTimes(1)
    await openRow('【测试数据】公告乙')
    expect(w.find('.stub-window-drawer').attributes('data-id')).toBe('2')
    resolveSubjects([])
    await flushPromises()
    expect(w.find('.stub-window-form').attributes('data-open')).toBe('false')

    hoisted.fetchSubjects.mockResolvedValueOnce([])
    await w.find('.stub-correct').trigger('click')
    await flushPromises()
    expect(w.find('.stub-window-form').attributes('data-open')).toBe('true')
    expect(w.find('.stub-window-form').attributes('data-window')).toBe('2')
  })

  it('请求进行中动了筛选控件但未点查询：返回结果照常显示，不被当成过期丢弃（日历与方案标签）', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps(true))
    let resolveCalendar: (r: WindowCalendarReport) => void = () => {}
    hoisted.fetchWindowCalendar.mockImplementationOnce(() => new Promise((resolve) => { resolveCalendar = resolve }))
    const w = mount(MidlongExecutionView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchWindowCalendar).toHaveBeenCalledTimes(1)
    w.findAllComponents({ name: 'ElDatePicker' })[0].vm.$emit('update:modelValue', ['2031-01', '2031-03'])
    await flushPromises()
    resolveCalendar(calendar)
    await flushPromises()
    expect(w.find('#pane-calendar').text()).toContain('【测试数据】已明确时间的公告')
    expect(w.find('#pane-calendar .ml-placeholder').exists()).toBe(false)

    let resolveProposals: (r: unknown) => void = () => {}
    hoisted.fetchProposals.mockImplementationOnce(() => new Promise((resolve) => { resolveProposals = resolve }))
    await w.findAll('.el-tabs__item').find((t) => t.text() === '方案执行')!.trigger('click')
    await flushPromises()
    w.findAllComponents({ name: 'ElSelect' }).find((c) => c.props('placeholder') === '方案状态')!.vm.$emit('update:modelValue', 'SUBMITTED')
    await flushPromises()
    resolveProposals(page([proposalRow(11, 'EXECUTABLE')]))
    await flushPromises()
    expect(w.find('#pane-proposals').text()).toContain('#11')
  })
})
