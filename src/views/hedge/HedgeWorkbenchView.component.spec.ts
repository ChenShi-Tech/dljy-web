// 套保工作台外壳组件测试（build-midlong-spot-hedging 任务 8.1/8.2/8.6，HW-01/06/07；#3420 外壳 + 页签拆分）。
// 组件测试文件名必须是 *.component.spec.ts 才会在 happy-dom 环境运行。
// 外壳只测地区门禁、默认页签、页签切换与跨页签的切公司行为；各页签自身的显示与写口用例在 tabs/*.component.spec.ts。
import { flushPromises, mount, enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchOverview = vi.fn()
const fetchMonths = vi.fn(async (): Promise<unknown> => ({}))
const fetchSettlement = vi.fn(async (): Promise<unknown> => ({}))
const emptyCoverage = async (): Promise<unknown> => ({ plants: [], calendar: { days: [], coveredDays: 0, totalDays: 0 }, status: 'NOT_REPORTED' })
const fetchSettlementCoverage = vi.fn(emptyCoverage)

// 地区上下文桩：mountView(regionId) 切换 currentRegion，地区门禁（HW-07）才真正受测。
const regionState = vi.hoisted(() => ({ id: 'yunnan' }))
vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { get value() { return { id: regionState.id } } },
}))

// 公司上下文桩：真实 ref，切换公司的重取与清空（HW-06/#3401）才真正受测。
vi.mock('@/services/company/companyContext', async () => {
  const { ref } = await import('vue')
  return { selectedCompanyId: ref('comp-a') }
})

vi.mock('@/services/hedge/hedgeApi', () => ({
  HedgeApiError: class HedgeApiError extends Error {
    status: number
    errorCode: string
    details: Record<string, unknown> | null
    constructor(status: number, errorCode: string, message: string, details: Record<string, unknown> | null = null) {
      super(message)
      this.status = status
      this.errorCode = errorCode
      this.details = details
    }
  },
  fetchOverview: (...args: unknown[]) => fetchOverview(...(args as [])),
  fetchBaselines: vi.fn(async () => ({ rows: [] })),
  putBaselines: vi.fn(async () => ({})),
  fetchBandPresets: vi.fn(async () => ({ rows: [] })),
  fetchBandActivation: vi.fn(async () => ({ active: null })),
  fetchCaps: vi.fn(async () => ({ rows: [{ subjectId: 1, month: '2026-11', capMwh: '100' }] })),
  fetchMechanismParams: vi.fn(async () => ({ rows: [] })),
  fetchMonths: (...args: unknown[]) => fetchMonths(...(args as [])),
  fetchSettlement: (...args: unknown[]) => fetchSettlement(...(args as [])),
  postMechanismVersion: vi.fn(async () => ({})),
  postSimulate: vi.fn(async () => ({})),
  putCaps: vi.fn(async () => ({})),
  requestBandSchemeCreate: vi.fn(async () => ({ schemeId: 1 })),
  activateBand: vi.fn(async () => ({})),
}))

// 结算复核页签改走 hedgeSettlementApi（ChenShi-Tech/dljy#3054）：复核请求仍计入原 fetchSettlement 桩，
// 原有「非云南不发请求」「失活页签切公司不取数」的断言保持不变；覆盖日历请求单独计数。
vi.mock('@/services/hedge/hedgeSettlementApi', () => ({
  fetchSettlementCoverage: (...args: unknown[]) => fetchSettlementCoverage(...(args as [])),
  fetchSettlementReview: (...args: unknown[]) => fetchSettlement(...(args as [])),
}))

import HedgeWorkbenchView from './HedgeWorkbenchView.vue'
import HedgeTodayTab from './tabs/HedgeTodayTab.vue'
import HedgeMonthsTab from './tabs/HedgeMonthsTab.vue'
import HedgeSettlementTab from './tabs/HedgeSettlementTab.vue'
import HedgeSimulateTab from './tabs/HedgeSimulateTab.vue'
import HedgeMaintenanceTab from './tabs/HedgeMaintenanceTab.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { fetchCaps as fetchCapsMock } from '@/services/hedge/hedgeApi'
import { overviewPayload } from '@/test/hedgeWorkbench'

// 每条用例结束即卸载（ChenShi-Tech/dljy#3432）：原先 afterAll 让前面用例挂载的实例一直存活，切换公司时
// 多个实例各自重取，测试保存的 release 可能放行的是别的实例的请求，本用例的页面永远等不到结果——CI 高负载下
// 几乎每次都红（main 连红 3 次）。
enableAutoUnmount(afterEach)

function mountView(regionId = 'yunnan') {
  regionState.id = regionId
  return mount(HedgeWorkbenchView, {
    global: {
      mocks: {
        $route: { query: {} },
      },
    },
  })
}

// 每个页签在外壳里渲染时的标志区块：切到某页签后只应出现它自己的那一块。
const TAB_MARKERS = {
  today2: '[data-test="metrics"]',
  month: '[data-test="month-view"]',
  settlement: '[data-test="settlement-view"]',
  simulate: '[data-test="simulate-view"]',
  maintenance: '[data-test="maintenance"]',
} as const

describe('HedgeWorkbenchView 外壳（HW-01/06/07）', () => {
  afterEach(() => {
    fetchOverview.mockReset()
    fetchMonths.mockReset()
    fetchMonths.mockImplementation(async () => ({}))
    fetchSettlement.mockReset()
    fetchSettlement.mockImplementation(async () => ({}))
    fetchSettlementCoverage.mockReset()
    fetchSettlementCoverage.mockImplementation(emptyCoverage)
    regionState.id = 'yunnan'
  })

  it('地区开放时按今明窗口请求 /overview 并渲染判级与缺口', async () => {
    fetchOverview.mockResolvedValue(overviewPayload())
    const wrapper = mountView()
    await vi.dynamicImportSettled()
    await vi.waitFor(() => {
      expect(fetchOverview).toHaveBeenCalled()
      expect(wrapper.find('[data-test="metrics"]').exists()).toBe(true)
    })
    const text = wrapper.text()
    expect(text).toContain('MECHANISM_INCOMPLETE')
    expect(text).toContain('明日预测未到达')
  })

  it('切换公司：立即清空上一家公司的结果并按新公司重取（HW-06/#3401）', async () => {
    selectedCompanyId.value = 'comp-a'
    fetchOverview.mockResolvedValue(overviewPayload())
    const wrapper = mountView()
    await vi.dynamicImportSettled()
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="metrics"]').exists()).toBe(true)
    })
    const callsBefore = fetchOverview.mock.calls.length
    // 新公司的请求挂起：旧结果必须先被清掉，不能在新请求返回前继续显示上一家公司的数值。
    let release: (value: unknown) => void = () => {}
    fetchOverview.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    selectedCompanyId.value = 'comp-b'
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="metrics"]').exists()).toBe(false)
      expect(fetchOverview.mock.calls.length).toBeGreaterThan(callsBefore)
    })
    // 切换一次公司只应新增一次取数：多于一次说明有别的组件实例在响应同一切换（#3432 的根因），
    // 等过 150ms 防抖窗口再数，否则第二次取数还没发出来。
    await new Promise((r) => setTimeout(r, 300))
    expect(fetchOverview.mock.calls.length - callsBefore).toBe(1)
    release(overviewPayload())
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="metrics"]').exists()).toBe(true)
    })
    selectedCompanyId.value = 'comp-a'
  })

  it('非云南地区显示「未开放」且不发任何请求（HW-07 地区门禁）', async () => {
    fetchOverview.mockResolvedValue(overviewPayload())
    const wrapper = mountView('shanxi')
    await vi.dynamicImportSettled()
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="region-closed"]').exists()).toBe(true)
    })
    expect(wrapper.find('[data-test="region-closed"]').text()).toContain('该地区未开放')
    expect(fetchOverview).not.toHaveBeenCalled()
    expect(fetchMonths).not.toHaveBeenCalled()
    expect(fetchSettlement).not.toHaveBeenCalled()
    expect(fetchSettlementCoverage).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="tabs"]').exists()).toBe(false)
  })

  it('切换到每个页签都渲染对应组件，且只显示当前页签的内容（#3420）', async () => {
    fetchOverview.mockResolvedValue(overviewPayload())
    const wrapper = mountView()
    await vi.waitFor(() => {
      expect(wrapper.find(TAB_MARKERS.today2).exists()).toBe(true)
    })
    const cases = [
      { key: 'month', component: HedgeMonthsTab },
      { key: 'settlement', component: HedgeSettlementTab },
      { key: 'simulate', component: HedgeSimulateTab },
      { key: 'maintenance', component: HedgeMaintenanceTab },
      { key: 'today2', component: HedgeTodayTab },
    ] as const
    for (const { key, component } of cases) {
      await wrapper.find(`[data-test="tab-${key}"]`).trigger('click')
      await vi.waitFor(() => {
        expect(wrapper.findComponent(component).exists()).toBe(true)
        expect(wrapper.find(TAB_MARKERS[key]).exists()).toBe(true)
      })
      for (const [other, selector] of Object.entries(TAB_MARKERS)) {
        if (other !== key) expect(wrapper.find(selector).exists(), `${key} 页签下不应出现 ${other} 的内容`).toBe(false)
      }
      expect(wrapper.find(`[data-test="tab-${key}"]`).classes()).toContain('active')
    }
    // 维护不再是页头开关：原「维护」按钮已并入页签导航。
    expect(wrapper.find('[data-test="maintenance-toggle"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="tabs"] button').map((b) => b.text()))
      .toEqual(['今明两日', '当月/后续', '结算复核', '补仓试算', '维护'])
  })

  it('非今明页签：切公司立即清空当前页签数据并按新公司重取，旧响应晚到被丢弃（HW-06/#3420）', async () => {
    selectedCompanyId.value = 'comp-a'
    fetchOverview.mockResolvedValue(overviewPayload())
    const releases: Array<(value: unknown) => void> = []
    fetchMonths.mockImplementation(() => new Promise((resolve) => { releases.push(resolve) }))
    const wrapper = mountView()
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="tab-month"]').exists()).toBe(true)
    })
    // 首次激活「当月/后续」：取回 comp-a 的月度视图。
    await wrapper.find('[data-test="tab-month"]').trigger('click')
    await vi.waitFor(() => { expect(releases.length).toBe(1) })
    releases[0]({ months: [{ month: 'COMP-A' }] })
    await vi.waitFor(() => { expect(wrapper.find('[data-test="month-view"]').text()).toContain('COMP-A') })
    // 切走再切回：页签被重新激活即重取（comp-a 的第二个请求挂起），期间仍显示已取回的数据。
    await wrapper.find('[data-test="tab-settlement"]').trigger('click')
    await wrapper.find('[data-test="tab-month"]').trigger('click')
    await vi.waitFor(() => { expect(releases.length).toBe(2) })
    expect(wrapper.find('[data-test="month-view"]').text()).toContain('COMP-A')
    // 切公司：上一家公司的结果立即消失，并按新公司只重取一次。
    selectedCompanyId.value = 'comp-b'
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="month-view"]').exists()).toBe(false)
      expect(releases.length).toBe(3)
    })
    // 新公司先返回、旧公司（切换前发出的请求）后返回：页面必须停在新公司的结果上。
    releases[2]({ months: [{ month: 'COMP-B' }] })
    await vi.waitFor(() => { expect(wrapper.find('[data-test="month-view"]').text()).toContain('COMP-B') })
    releases[1]({ months: [{ month: 'STALE-COMP-A' }] })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(wrapper.find('[data-test="month-view"]').text()).toContain('COMP-B')
    expect(wrapper.find('[data-test="month-view"]').text()).not.toContain('STALE-COMP-A')
    // 失活的页签只清空不取数：切换一次公司只应新增一次月度请求（结算复核失活，不得因切公司取数）。
    expect(releases.length).toBe(3)
    expect(fetchSettlement).toHaveBeenCalledTimes(1)
    expect(fetchSettlementCoverage).toHaveBeenCalledTimes(2)
    selectedCompanyId.value = 'comp-a'
  })

  it('维护页签写入成功后今明两日重取总览；切走再切回不丢试算输入（#3420 保持原面板行为）', async () => {
    fetchOverview.mockResolvedValue(overviewPayload())
    const wrapper = mountView()
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="metrics"]').exists()).toBe(true)
    })
    const callsBefore = fetchOverview.mock.calls.length
    await wrapper.find('[data-test="tab-maintenance"]').trigger('click')
    await vi.waitFor(() => { expect(wrapper.find('[data-test="baseline-save"]').exists()).toBe(true) })
    await wrapper.find('[data-test="baseline-save"]').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="baseline-status"]').text()).toContain('已保存')
      expect(fetchOverview.mock.calls.length).toBe(callsBefore + 1)
    })

    await wrapper.find('[data-test="tab-simulate"]').trigger('click')
    await wrapper.find('[data-test="simulate-qty"]').setValue('12.5')
    await wrapper.find('[data-test="tab-today2"]').trigger('click')
    await wrapper.find('[data-test="tab-simulate"]').trigger('click')
    expect((wrapper.find('[data-test="simulate-qty"]').element as HTMLInputElement).value).toBe('12.5')
  })

  it('维护页签切走再切回不重取，未保存的输入不被接口响应覆盖；切公司后重新激活才重取（#218 审查 R1-01）', async () => {
    fetchOverview.mockResolvedValue(overviewPayload())
    const caps = vi.mocked(fetchCapsMock)
    caps.mockClear()
    const wrapper = mountView()
    await wrapper.find('[data-test="tab-maintenance"]').trigger('click')
    await vi.waitFor(() => { expect(wrapper.find('[data-test="caps-row"] input[data-test="cap-mwh"]').exists()).toBe(true) })
    expect(caps).toHaveBeenCalledTimes(1)
    await wrapper.find('[data-test="caps-row"] input[data-test="cap-mwh"]').setValue('250')

    await wrapper.find('[data-test="tab-today2"]').trigger('click')
    await wrapper.find('[data-test="tab-maintenance"]').trigger('click')
    await flushPromises()
    expect(caps).toHaveBeenCalledTimes(1)
    expect((wrapper.find('[data-test="caps-row"] input[data-test="cap-mwh"]').element as HTMLInputElement).value).toBe('250')

    // 切公司：维护页签正处于激活态，清空后立即按新公司重取（草稿随上一家公司一并丢弃是预期行为）。
    selectedCompanyId.value = 'comp-b'
    await vi.waitFor(() => { expect(caps).toHaveBeenCalledTimes(2) })
    selectedCompanyId.value = 'comp-a'
    await vi.waitFor(() => { expect(caps).toHaveBeenCalledTimes(3) })
  })
})
