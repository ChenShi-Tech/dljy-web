// 套保工作台「结算复核」页签组件测试（build-midlong-spot-hedging 任务 10.5，HR-01..05、HW-06/08；ChenShi-Tech/dljy#3054）。
// 守的不变量：默认月份取最近一个有正式覆盖的月份（不写死当月）；未覆盖的场站日显示「未覆盖」、不按 0 进合计和套保率；
// 正式/暂结两套数值不混用；只展示数值、不判级；切公司清空并重取、旧响应晚到被丢弃；接口失败显示原因、不冒充空数据。
// 坏掉的症状：页面固定取当月一直「暂无」（#3054 重开原因）、缺失日被算成 0 拉低套保率、暂结数值挂在正式标记下、
// 切公司后残留上一家公司的数据、失败时显示成「暂无数据」。
// 组件测试文件名必须是 *.component.spec.ts 才会在 happy-dom 环境运行。
import { config, enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

const fetchSettlementCoverage = vi.fn()
const fetchSettlementReview = vi.fn()

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { get value() { return { id: 'yunnan' } } },
}))

// 公司上下文桩：真实 ref，切换公司的清空、重取与旧响应丢弃（HW-06）才真正受测。
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
}))

vi.mock('@/services/hedge/hedgeSettlementApi', () => ({
  fetchSettlementCoverage: (...args: unknown[]) => fetchSettlementCoverage(...(args as [])),
  fetchSettlementReview: (...args: unknown[]) => fetchSettlementReview(...(args as [])),
}))

import HedgeSettlementTab from './HedgeSettlementTab.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { HedgeApiError } from '@/services/hedge/hedgeApi'
import type { SettlementCoverage, SettlementView } from '@/services/hedge/hedgeSettlementApi'
import { mountHedgeTab } from '@/test/hedgeWorkbench'
import { metricTile } from '@/test/metricTile'
import { coveragePayload, incompleteRow, ledgerPayload, provisionalNotReported, reviewPayload, reviewRow } from '@/test/hedgeSettlement'

// MetricTile 的 ⓘ 用 el-tooltip；本 spec 不装 Element Plus，桩成只渲染默认插槽。
config.global.stubs = {
  ...config.global.stubs,
  'el-tooltip': defineComponent({ setup(_, { slots }) { return () => h('span', slots.default?.()) } }),
}

enableAutoUnmount(afterEach)

const EMPTY_PROVISIONAL = coveragePayload({ plants: [], covered: {}, view: 'PROVISIONAL' })

function mockCoverage(formal: SettlementCoverage, provisional: SettlementCoverage = EMPTY_PROVISIONAL) {
  fetchSettlementCoverage.mockImplementation(async (query: { view?: SettlementView }) => (query.view === 'PROVISIONAL' ? provisional : formal))
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

const cell = (wrapper: VueWrapper, plant: string, date: string) =>
  wrapper.find(`[data-test="calendar-plant-row"][data-plant="${plant}"] [data-date="${date}"]`)
const dayCell = (wrapper: VueWrapper, date: string) => wrapper.find(`[data-test="calendar-day-row"] [data-date="${date}"]`)
const settle = async () => { await flushPromises(); await new Promise((resolve) => setTimeout(resolve, 20)) }
const MAY_FORMAL = { fromDate: '2026-05-01', toDate: '2026-05-31', granularity: 'DAY', view: 'FORMAL' }

describe('HedgeSettlementTab（HR-01..05、HW-06/08）', () => {
  beforeEach(() => {
    // 只冻结日期（today2Range 取东八区今天 = 2026-09-29），计时器保持真实，vi.waitFor 照常轮询。
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T04:00:00Z'))
    selectedCompanyId.value = 'comp-a'
  })

  afterEach(() => {
    vi.useRealTimers()
    fetchSettlementCoverage.mockReset()
    fetchSettlementReview.mockReset()
    // 公司上下文在 beforeEach 里归位：这里改它会让尚未卸载的本用例实例按「切公司」再取一次数，漏进下一条用例的计数。
  })

  it('默认月份取最近一个有正式覆盖的月份而不是当月；切到当月时区间截到今天（HR-02）', async () => {
    mockCoverage(coveragePayload({ plants: ['甲风电场'], covered: { '2026-04-10': ['甲风电场'], '2026-05-15': ['甲风电场'] } }))
    fetchSettlementReview.mockResolvedValue(reviewPayload())
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => { expect(fetchSettlementReview).toHaveBeenCalledTimes(1) })
    // 覆盖日历按回看窗口（含当月最近 12 个月）请求正式与暂结两份，不写死月份。
    expect(fetchSettlementCoverage).toHaveBeenCalledWith({ fromDate: '2025-10-01', toDate: '2026-09-29', view: 'FORMAL' })
    expect(fetchSettlementCoverage).toHaveBeenCalledWith({ fromDate: '2025-10-01', toDate: '2026-09-29', view: 'PROVISIONAL' })
    expect(fetchSettlementReview).toHaveBeenLastCalledWith(MAY_FORMAL)
    const select = wrapper.find('[data-test="settlement-month"]')
    await vi.waitFor(() => { expect((select.element as HTMLSelectElement).value).toBe('2026-05') })
    const options = select.findAll('option').map((option) => option.text())
    expect(options).toHaveLength(12)
    expect(options[0]).toBe('2026-09（未入库）')
    expect(options).toContain('2026-05（正式 1 天）')

    await select.setValue('2026-09')
    await vi.waitFor(() => {
      expect(fetchSettlementReview).toHaveBeenLastCalledWith({ fromDate: '2026-09-01', toDate: '2026-09-29', granularity: 'DAY', view: 'FORMAL' })
    })
    // 今天之后的日子还没发生：日历只画到 9-29，不把 9-30 标成未覆盖。
    expect(wrapper.findAll('[data-test="calendar-day-row"] td[data-date]')).toHaveLength(29)
  })

  it('未覆盖的场站日显示「未覆盖」而不是 0；合计与套保率只用恒等核对通过的场站日，缺失不按 0 计（HR-01/HR-02）', async () => {
    mockCoverage(coveragePayload({
      plants: ['甲风电场', '乙光伏'],
      covered: { '2026-05-15': ['甲风电场', '乙光伏'], '2026-05-16': ['甲风电场'] },
    }))
    fetchSettlementReview.mockResolvedValue(reviewPayload({
      rows: [
        reviewRow(),
        // 不平：100 + 20 − 5 ≠ 150，差额 35，剔除并单列。
        reviewRow({ date: '2026-05-16', actualOnGridEnergy: 150, balanced: false, residual: 35, realizedRatio: 0.6667 }),
        // 分段缺失：中长期为 null，不做恒等核对。
        incompleteRow({ plant: '乙光伏' }),
      ],
    }))
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => { expect(wrapper.find('[data-test="realized-metrics"]').exists()).toBe(true) })

    const missing = cell(wrapper, '乙光伏', '2026-05-16')
    expect(missing.text()).toBe('未覆盖')
    expect(missing.attributes('data-state')).toBe('MISSING')
    // 后端日历没列出的日期同样是未覆盖。
    expect(cell(wrapper, '乙光伏', '2026-05-01').text()).toBe('未覆盖')
    expect(cell(wrapper, '甲风电场', '2026-05-15').text()).toBe('正式')
    expect(dayCell(wrapper, '2026-05-15').text()).toBe('正式')
    expect(dayCell(wrapper, '2026-05-16').text()).toBe('正式 1/2')
    expect(dayCell(wrapper, '2026-05-17').text()).toBe('未覆盖')
    expect(wrapper.findAll('[data-test="calendar-cell"]').filter((node) => node.text() === '0')).toHaveLength(0)

    // 2 个场站 × 31 天 = 62 个场站日，其中 3 个有正式记录。
    expect(metricTile(wrapper, '场站日覆盖')?.value).toBe('3/62')
    // 只有甲 5-15 一行计入：100 ÷ 115 = 86.96%。把不平行计入会变成 75.47%，把分段缺失行的中长期当 0 计入会变成 60.61%。
    expect(metricTile(wrapper, '已实现套保率')?.value).toBe('86.96%')
    expect(wrapper.text()).not.toContain('75.47%')
    expect(wrapper.text()).not.toContain('60.61%')
    expect(metricTile(wrapper, '中长期结算电量')).toEqual({ value: '100', unit: 'MWh' })
    expect(metricTile(wrapper, '实际上网电量')).toEqual({ value: '115', unit: 'MWh' })
    expect(metricTile(wrapper, '现货总敞口')).toEqual({ value: '25', unit: 'MWh' })
    expect(metricTile(wrapper, '净敞口')).toEqual({ value: '15', unit: 'MWh' })
    // 乙光伏没有可计入的场站日：电量与套保率显示「—」，不显示 0（计数列的 0 是真实计数）。
    expect(wrapper.findAll('[data-test="plant-summary"] tr[data-plant="乙光伏"] td').map((td) => td.text()))
      .toEqual(['乙光伏', '1/31', '0', '—', '—', '—', '—', '—', '0', '1'])

    const quality = wrapper.find('[data-test="data-quality"]')
    expect(quality.find('[data-test="dq-missing"]').text()).toContain('未覆盖 59 个场站日（不按 0 计）')
    expect(quality.find('[data-test="dq-missing"]').text()).toContain('乙光伏：05-01~05-14、05-16~05-31')
    expect(quality.find('[data-test="dq-unbalanced"]').text()).toContain('05-16 甲风电场：差额 35 MWh')
    expect(quality.find('[data-test="dq-incomplete"]').text()).toContain('05-15 乙光伏：分段电量缺失')
  })

  it('暂结视角：切换后先清空再按暂结重取，显示暂结数值并带「暂结」标记；切回正式恢复正式数值（HR-03）', async () => {
    mockCoverage(
      coveragePayload({ plants: ['甲风电场'], covered: { '2026-05-15': ['甲风电场'] } }),
      coveragePayload({ plants: ['甲风电场'], covered: { '2026-05-15': ['甲风电场'], '2026-05-16': ['甲风电场'] }, view: 'PROVISIONAL' }),
    )
    const provisional = deferred()
    fetchSettlementReview.mockImplementation((query: { view: SettlementView }) => (query.view === 'PROVISIONAL'
      ? provisional.promise
      : Promise.resolve(reviewPayload())))
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => { expect(metricTile(wrapper, '已实现套保率')?.value).toBe('86.96%') })
    expect(wrapper.find('[data-test="provisional-badge"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="realized-metrics"] .pill')).toHaveLength(0)
    // 日历三态：5-16 只有暂结、正式缺失。
    expect(cell(wrapper, '甲风电场', '2026-05-16').text()).toBe('暂结')
    expect(wrapper.find('[data-test="dq-provisional"]').text()).toContain('只有暂结 1 个场站日')

    await wrapper.find('[data-test="view-provisional"]').trigger('click')
    expect(fetchSettlementReview).toHaveBeenLastCalledWith({ ...MAY_FORMAL, view: 'PROVISIONAL' })
    // 暂结返回之前：正式数值已清掉，不会挂在「暂结」标记下。
    expect(wrapper.find('[data-test="provisional-badge"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="realized-metrics"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('86.96%')

    provisional.resolve(reviewPayload({
      view: 'PROVISIONAL',
      rows: [reviewRow({ ltmEnergy: 90, realTimeIncrementMwh: 5, realizedRatio: 0.7826, spotExposure: { dayAheadAbsMwh: 20, realTimeAbsMwh: 5, netMwh: 25 } })],
    }))
    // 90 ÷ 115 = 78.26%：只用暂结数据，不与正式相加。
    await vi.waitFor(() => { expect(metricTile(wrapper, '已实现套保率')?.value).toContain('78.26%') })
    expect(wrapper.text()).not.toContain('86.96%')
    const pills = wrapper.findAll('[data-test="realized-metrics"] .pill')
    expect(pills.length).toBeGreaterThan(0)
    expect(pills.every((pill) => pill.text() === '暂结')).toBe(true)

    await wrapper.find('[data-test="view-formal"]').trigger('click')
    await vi.waitFor(() => { expect(metricTile(wrapper, '已实现套保率')?.value).toBe('86.96%') })
    expect(fetchSettlementReview).toHaveBeenLastCalledWith(MAY_FORMAL)
    expect(wrapper.find('[data-test="provisional-badge"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('78.26%')
  })

  it('暂结未入库：如实显示「暂结结算数据未入库」，不拿正式数值顶替（HR-03）', async () => {
    mockCoverage(coveragePayload({ plants: ['甲风电场'], covered: { '2026-05-15': ['甲风电场'] } }))
    fetchSettlementReview.mockImplementation(async (query: { view: SettlementView }) => (query.view === 'PROVISIONAL' ? provisionalNotReported() : reviewPayload()))
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => { expect(metricTile(wrapper, '已实现套保率')?.value).toBe('86.96%') })

    await wrapper.find('[data-test="view-provisional"]').trigger('click')
    await vi.waitFor(() => { expect(wrapper.find('[data-test="review-status"]').text()).toBe('暂结结算数据未入库') })
    expect(wrapper.find('[data-test="realized-metrics"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="ledger-empty"]').text()).toContain('暂结视角无已入库结算行')
    expect(wrapper.text()).not.toContain('86.96%')
  })

  it('来回切换视角：晚到的旧视角响应被丢弃，两套数值不混用（HR-03/HW-06）', async () => {
    mockCoverage(coveragePayload({ plants: ['甲风电场'], covered: { '2026-05-15': ['甲风电场'] } }))
    const pending: Array<{ view: SettlementView; resolve: (value: unknown) => void }> = []
    fetchSettlementReview.mockImplementation((query: { view: SettlementView }) => new Promise((resolve) => { pending.push({ view: query.view, resolve }) }))
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => { expect(pending).toHaveLength(1) })
    pending[0].resolve(reviewPayload())
    await vi.waitFor(() => { expect(metricTile(wrapper, '已实现套保率')?.value).toBe('86.96%') })

    await wrapper.find('[data-test="view-provisional"]').trigger('click')
    await wrapper.find('[data-test="view-formal"]').trigger('click')
    expect(pending.map((item) => item.view)).toEqual(['FORMAL', 'PROVISIONAL', 'FORMAL'])
    pending[2].resolve(reviewPayload({ rows: [reviewRow({ ltmEnergy: 80, dayAheadIncrementMwh: 40, realizedRatio: 0.6957 })] }))
    await vi.waitFor(() => { expect(metricTile(wrapper, '已实现套保率')?.value).toBe('69.57%') })
    // 暂结请求晚到：当前是正式视角，暂结数值不得出现，也不得换上暂结标记。
    pending[1].resolve(reviewPayload({ view: 'PROVISIONAL', rows: [reviewRow({ ltmEnergy: 90, realTimeIncrementMwh: 5, realizedRatio: 0.7826 })] }))
    await settle()
    expect(metricTile(wrapper, '已实现套保率')?.value).toBe('69.57%')
    expect(wrapper.text()).not.toContain('78.26%')
    expect(wrapper.find('[data-test="provisional-badge"]').exists()).toBe(false)
  })

  it('页面只展示已实现数值，不出现判级与判级颜色（HR-01）', async () => {
    mockCoverage(coveragePayload({ plants: ['甲风电场'], covered: { '2026-05-15': ['甲风电场'], '2026-05-16': ['甲风电场'] } }))
    fetchSettlementReview.mockResolvedValue(reviewPayload({
      rows: [reviewRow(), reviewRow({ date: '2026-05-16', actualOnGridEnergy: 150, balanced: false, residual: 35, realizedRatio: 0.6667 })],
      ledger: ledgerPayload({ stations: [{ stationId: 1, plantName: '甲风电场', ledgerMwh: 150, settlementMwh: 200, unexplainedDiff: -50 }] }),
    }))
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => { expect(wrapper.find('[data-test="realized-metrics"]').exists()).toBe(true) })
    expect(wrapper.find('[data-test="assessment"]').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/判级[：:]|达标|欠保|过保|偏高|偏低|风险等级|合格|NOT_ASSESSED/)
    const values = wrapper.findAll('[data-test="realized-metrics"] .tile .v')
    expect(values.length).toBeGreaterThanOrEqual(6)
    for (const value of values) {
      expect(value.classes()).toContain('default')
      expect(value.classes().some((cls) => ['good', 'bad', 'warn'].includes(cls))).toBe(false)
    }
    expect(wrapper.findAll('.pill')).toHaveLength(0)
  })

  it('台账对照逐场站列出台账、结算与未解释差异；未映射、交易单元一级与读取失败如实标注；费用只称现货增量电费（HR-04/HR-05）', async () => {
    mockCoverage(coveragePayload({ plants: ['甲风电场', '乙光伏'], covered: { '2026-05-15': ['甲风电场', '乙光伏'] } }))
    fetchSettlementReview.mockResolvedValueOnce(reviewPayload({
      rows: [
        reviewRow(),
        reviewRow({ plant: '乙光伏', totalFee: 99999, feeSplit: { status: 'UNSPLIT', spotIncrementFee: 4100, midlongFee: null, totalFee: 99999, note: '中长期电费不可拆分（总额与分段不符）' } }),
      ],
      ledger: ledgerPayload({
        stations: [{ stationId: 1, plantName: '甲风电场', ledgerMwh: 0, settlementMwh: 100, unexplainedDiff: -100 }],
        unmapped: [{ plantName: '乙光伏', settlementMwh: 100 }],
        unallocatedSubjectLevel: [{ key: 7, quantity: 300 }],
      }),
    }))
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => { expect(wrapper.find('[data-test="ledger-station"]').exists()).toBe(true) })
    expect(wrapper.find('[data-test="ledger-station"]').findAll('td').map((td) => td.text()))
      .toEqual(['甲风电场', '0', '100', '-100', '台账可能缺少合同录入'])
    expect(wrapper.find('[data-test="ledger-unmapped"]').findAll('td').map((td) => td.text()))
      .toEqual(['乙光伏', '未映射', '100', '—', '场站映射缺失，无法与台账对照'])
    expect(wrapper.find('[data-test="ledger-unallocated"]').text()).toContain('交易单元 7：含未分配到场站的 300 MWh，在交易单元一级对照')
    expect(wrapper.find('[data-test="ledger-note"]').text()).toContain('不归因任何一方')
    expect(wrapper.find('[data-test="ledger-note"]').text()).toContain('台账认知时点 2026-05-31T23:59:59+08:00')

    // 费用口径：总额与分段不符 → 中长期电费「不可拆分」，不反推；表头称「现货增量电费」，不称偏差考核或罚款。
    const detail = wrapper.find('[data-test="detail-rows"]')
    expect(detail.text()).toContain('现货增量电费·日前')
    expect(detail.text()).toContain('现货增量电费·实时')
    expect(detail.findAll('[data-test="detail-row"]')[1].text()).toContain('不可拆分')
    expect(wrapper.text()).not.toMatch(/偏差考核|罚款/)
    expect(wrapper.find('[data-test="dq-fee"]').text()).toContain('中长期电费不可拆分 1 行')
    expect(wrapper.find('[data-test="dq-mechanism"]').text()).toBe('机制差价结算：未入库')

    // 结算行已取回但台账读模型失败（后端 ledger=null）：如实说读取失败，不显示成「无差异」。
    fetchSettlementReview.mockResolvedValueOnce(reviewPayload({ ledger: null }))
    await wrapper.find('[data-test="settlement-month"]').setValue('2026-04')
    await vi.waitFor(() => { expect(wrapper.find('[data-test="ledger-empty"]').text()).toContain('台账读模型读取失败') })
  })

  it('切公司：立即清空上一家公司的日历与复核结果、视角回到正式，并按新公司重取（HW-06/#3401）', async () => {
    fetchSettlementCoverage.mockImplementation(async (query: { view?: SettlementView }) => {
      const plant = selectedCompanyId.value === 'comp-b' ? '乙光伏' : '甲风电场'
      return coveragePayload({ plants: [plant], covered: query.view === 'PROVISIONAL' ? {} : { '2026-05-15': [plant] }, view: query.view })
    })
    const companyB = deferred()
    fetchSettlementReview.mockImplementation(() => (selectedCompanyId.value === 'comp-b' ? companyB.promise : Promise.resolve(reviewPayload())))
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => { expect(metricTile(wrapper, '已实现套保率')?.value).toBe('86.96%') })
    await wrapper.find('[data-test="view-provisional"]').trigger('click')
    await vi.waitFor(() => { expect(wrapper.find('[data-test="provisional-badge"]').exists()).toBe(true) })
    const coverageCalls = fetchSettlementCoverage.mock.calls.length

    selectedCompanyId.value = 'comp-b'
    await nextTick()
    expect(wrapper.text()).not.toContain('甲风电场')
    expect(wrapper.find('[data-test="realized-metrics"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="view-formal"]').classes()).toContain('active')
    await vi.waitFor(() => {
      expect(fetchSettlementCoverage.mock.calls.length).toBe(coverageCalls + 2)
      expect(fetchSettlementReview).toHaveBeenLastCalledWith(MAY_FORMAL)
    })
    companyB.resolve(reviewPayload({ rows: [reviewRow({ plant: '乙光伏' })] }))
    await vi.waitFor(() => { expect(wrapper.find('[data-test="plant-summary"] tr[data-plant="乙光伏"]').exists()).toBe(true) })
    expect(wrapper.text()).not.toContain('甲风电场')
  })

  it('切公司前发出的复核请求晚到被丢弃，页面停在新公司的结果上（HW-06）', async () => {
    fetchSettlementCoverage.mockImplementation(async (query: { view?: SettlementView }) => {
      const plant = selectedCompanyId.value === 'comp-b' ? '乙光伏' : '甲风电场'
      return coveragePayload({ plants: [plant], covered: query.view === 'PROVISIONAL' ? {} : { '2026-05-15': [plant] }, view: query.view })
    })
    const reviews: Array<(value: unknown) => void> = []
    fetchSettlementReview.mockImplementation(() => new Promise((resolve) => { reviews.push(resolve) }))
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => { expect(reviews).toHaveLength(1) })
    selectedCompanyId.value = 'comp-b'
    await vi.waitFor(() => { expect(reviews).toHaveLength(2) })
    reviews[1](reviewPayload({ rows: [reviewRow({ plant: '乙光伏' })] }))
    await vi.waitFor(() => { expect(wrapper.find('[data-test="plant-summary"] tr[data-plant="乙光伏"]').exists()).toBe(true) })
    reviews[0](reviewPayload({ rows: [reviewRow({ plant: '甲风电场', ltmEnergy: 1 })] }))
    await settle()
    expect(wrapper.find('[data-test="plant-summary"] tr[data-plant="乙光伏"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('甲风电场')
  })

  it('切公司前发出的覆盖日历请求晚到被丢弃：不替换日历、也不据此再发复核请求（HW-06）', async () => {
    const coverageCalls: Array<{ company: string; view: SettlementView; resolve: (value: unknown) => void }> = []
    fetchSettlementCoverage.mockImplementation((query: { view: SettlementView }) => new Promise((resolve) => {
      coverageCalls.push({ company: selectedCompanyId.value, view: query.view, resolve })
    }))
    const reviewCompanies: string[] = []
    fetchSettlementReview.mockImplementation(async () => {
      reviewCompanies.push(selectedCompanyId.value)
      return reviewPayload({ rows: [reviewRow({ plant: selectedCompanyId.value === 'comp-b' ? '乙光伏' : '甲风电场' })] })
    })
    const resolveCoverage = (company: string, plant: string) => {
      for (const call of coverageCalls.filter((item) => item.company === company)) {
        call.resolve(coveragePayload({ plants: [plant], covered: call.view === 'FORMAL' ? { '2026-05-15': [plant] } : {}, view: call.view }))
      }
    }
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => { expect(coverageCalls).toHaveLength(2) })
    selectedCompanyId.value = 'comp-b'
    await vi.waitFor(() => { expect(coverageCalls).toHaveLength(4) })
    resolveCoverage('comp-b', '乙光伏')
    await vi.waitFor(() => { expect(wrapper.find('[data-test="realized-metrics"]').exists()).toBe(true) })
    resolveCoverage('comp-a', '甲风电场')
    await settle()
    expect(reviewCompanies).toEqual(['comp-b'])
    expect(wrapper.find('[data-test="calendar-plant-row"][data-plant="乙光伏"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('甲风电场')
  })

  it('覆盖日历接口失败显示原因，不冒充「暂无数据」也不画未覆盖日历（HW-08/HR-06）', async () => {
    fetchSettlementCoverage.mockRejectedValue(new HedgeApiError(403, 'FORBIDDEN', '无权限访问该公司结算数据'))
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => { expect(wrapper.find('[data-test="settlement-error"]').exists()).toBe(true) })
    expect(wrapper.find('[data-test="settlement-error"]').text()).toContain('FORBIDDEN：无权限访问该公司结算数据')
    expect(wrapper.find('[data-test="coverage-calendar"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('未覆盖')
    expect(wrapper.text()).not.toContain('暂无已入库')
    expect(fetchSettlementReview).not.toHaveBeenCalled()
  })

  it('复核接口失败显示原因且可重试，不显示成空指标或「暂无数据」（HW-08）', async () => {
    mockCoverage(coveragePayload({ plants: ['甲风电场'], covered: { '2026-05-15': ['甲风电场'] } }))
    fetchSettlementReview.mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce(reviewPayload())
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => { expect(wrapper.find('[data-test="review-error"]').exists()).toBe(true) })
    expect(wrapper.find('[data-test="review-error"]').text()).toContain('结算复核加载失败')
    expect(wrapper.find('[data-test="realized-metrics"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="review-status"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('暂无已入库')

    await wrapper.find('[data-test="review-error"] button').trigger('click')
    await vi.waitFor(() => { expect(metricTile(wrapper, '已实现套保率')?.value).toBe('86.96%') })
    expect(wrapper.find('[data-test="review-error"]').exists()).toBe(false)
  })

  it('认知时点变化作废在途请求后按原月份与视角重取，不卡在「加载中」', async () => {
    mockCoverage(coveragePayload({ plants: ['甲风电场'], covered: { '2026-05-15': ['甲风电场'] } }))
    const reviews: Array<(value: unknown) => void> = []
    fetchSettlementReview.mockImplementation(() => new Promise((resolve) => { reviews.push(resolve) }))
    const { wrapper, workbench } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => { expect(reviews).toHaveLength(1) })
    workbench.asOfInput.value = '2026-09-01T00:00'
    await vi.waitFor(() => { expect(reviews).toHaveLength(2) })
    expect(fetchSettlementReview).toHaveBeenLastCalledWith(MAY_FORMAL)
    reviews[1](reviewPayload())
    await vi.waitFor(() => { expect(metricTile(wrapper, '已实现套保率')?.value).toBe('86.96%') })
    expect(wrapper.find('[data-test="review-loading"]').exists()).toBe(false)
    reviews[0](reviewPayload({ rows: [reviewRow({ plant: '过期场站' })] }))
    await settle()
    expect(wrapper.text()).not.toContain('过期场站')
  })
})
