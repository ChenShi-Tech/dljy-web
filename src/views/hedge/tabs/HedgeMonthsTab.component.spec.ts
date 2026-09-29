// 套保工作台「当月/后续」页签组件测试（HW-03/HW-04/HW-05/HW-06/HB-07/HM-06；openspec build-midlong-spot-hedging
// 任务 8.3，ChenShi-Tech/dljy#3421）。
// 守什么：默认月份范围当月 + 后 2 月、后续月份无基准不显示套保率、FORBIDDEN 不显示 0、月度未分解单列、
// 超出/未登记核定上限提示、钻取分类求和 = 公司合计（数值 + consistency 双断言）、切公司丢弃旧响应、
// 月份草稿未提交不取数且提交后月卡与钻取同窗口刷新（R1-01）、核定上限读取失败不得表述成未登记（R1-02）。
// 坏掉的症状：无基准月份出现一个像算过的百分数、无权限被渲染成 0、月量被摊进按日序列、
// 切公司后短暂显示上一家公司的月份卡、页面同屏展示两个月份窗口的数据、读取失败被当成「未登记」。
// 组件测试文件名必须是 *.component.spec.ts 才会在 happy-dom 环境运行。
import { enableAutoUnmount, config } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { HedgeMonthView } from '@/services/hedge/hedgeMonthsApi'

const monthsMock = vi.fn()
const breakdownMock = vi.fn()

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { get value() { return { id: 'yunnan' } } },
}))

// 公司上下文桩：真实 ref，切换公司的重取与旧响应丢弃（HW-06）才真正受测。
vi.mock('@/services/company/companyContext', async () => {
  const { ref } = await import('vue')
  return { selectedCompanyId: ref('comp-a') }
})

// 服务层桩打在 hedgeApi.request 上（保留 HedgeApiError 与其余导出真实）：hedgeMonthsApi 的窗口换算、
// query 组装、信封解析链路保持真实，本 spec 只控制两个端点的返回。
vi.mock('@/services/hedge/hedgeApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/hedge/hedgeApi')>()
  return {
    ...actual,
    request: (_method: string, path: string, init?: { query?: Record<string, string | undefined> }) => {
      if (path === '/months') return monthsMock(init?.query ?? {})
      if (path === '/breakdown') return breakdownMock(init?.query ?? {})
      throw new Error(`spec 未预期的请求：${path}`)
    },
  }
})

vi.mock('vue-router', () => ({
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

import HedgeMonthsTab from './HedgeMonthsTab.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { defaultMonthRange } from '@/services/hedge/hedgeMaintenanceModel'
import { mountHedgeTab } from '@/test/hedgeWorkbench'

// MetricTile 的 ⓘ 用 el-tooltip；本 spec 不装 Element Plus，桩成只渲染默认插槽（与 SettlementTab spec 同一约定）。
config.global.stubs = {
  ...config.global.stubs,
  'el-tooltip': defineComponent({ setup(_, { slots }) { return () => h('span', slots.default?.()) } }),
}

enableAutoUnmount(afterEach)

function assessmentOf(metric: string | null, tier: string | null, level = 'WITHIN') {
  return { metric, tier, level, reason: null, hints: [], basis: 'WITH_MECHANISM' } as HedgeMonthView['ratios']['interval']['assessment']
}

/** 一份完整可渲染的月度视图；用例用 over 覆盖关注面。 */
function monthView(over: Partial<HedgeMonthView> = {}): HedgeMonthView {
  return {
    month: '2026-09',
    formalQuantity: null,
    period: 'CURRENT',
    midlong: {
      lockedMwh: '500',
      structure: {
        productKind: [{ key: 'ANNUAL', label: '年度', quantityMwh: '300' }, { key: 'MONTHLY', label: '月度', quantityMwh: '200' }],
        marketScope: [{ key: 'INTRA', label: '省内', quantityMwh: '500' }],
        energyAttribute: [{ key: 'GREEN', label: '绿电', quantityMwh: '150' }],
        buyerCategory: [{ key: 'GRID', label: '电网企业', quantityMwh: '500' }],
      },
      incomplete: false,
      affectedContractIds: [],
      note: null,
    },
    monthlyUndecomposed: { quantityMwh: '80', contractIds: [11], note: '只有月量的合同：月净义务不摊到日' },
    mechanism: { basis: 'PLANNED', label: '计划口径', value: '200', stations: [], unknownStationIds: [], note: '月度基准 × 比例（扣省间）' },
    generation: { granularity: 'DAY', actualDays: 2, forecastDays: 1, uncoveredDays: 1, totalDays: 4 },
    days: [
      { date: '2026-09-01', lockedDecomposedMwh: '100', generation: { value: '300', source: 'ACTUAL', uncoveredReason: null, unknownStationIds: [] } },
      { date: '2026-09-02', lockedDecomposedMwh: '110', generation: { value: '310', source: 'FORECAST', uncoveredReason: null, unknownStationIds: [] } },
      { date: '2026-09-03', lockedDecomposedMwh: null, generation: { value: null, source: 'UNCOVERED', uncoveredReason: 'FORECAST_NOT_ARRIVED', unknownStationIds: [] } },
      { date: '2026-09-04', lockedDecomposedMwh: '120', generation: { value: '320', source: 'ACTUAL', uncoveredReason: null, unknownStationIds: [] } },
    ],
    baseline: { coverage: 'COMPLETE', totalMwh: '1200', coveredStationIds: [1, 2], missingStationIds: [], label: '计划口径', note: null },
    ratios: {
      interval: {
        granularity: 'DAY', coverage: { coveredCount: 3, totalCount: 4, ratio: '0.75' },
        withMechanism: { value: '0.5', status: 'OK' }, midlongOnly: { value: '0.4167', status: 'OK' },
        assessment: assessmentOf('MONTH_INTERVAL', 'INTRA_MONTH'),
      },
      baseline: {
        label: '计划口径',
        withMechanism: { value: '0.5833', status: 'OK' }, midlongOnly: { value: '0.5', status: 'OK' },
        assessment: assessmentOf('MONTH_BASELINE', 'INTRA_MONTH'),
      },
    },
    caps: {
      status: 'REGISTERED',
      rows: [{ subjectId: 7, status: 'REGISTERED', capMwh: '600', lockedMwh: '500', remainingMwh: '100', exceeded: false, sourceNote: null, note: null }],
      note: '核定上限按交易单元登记（HB-07）',
    },
    consistency: { ok: true, partial: false },
    ...over,
  } as HedgeMonthView
}

function monthsPayload(months: HedgeMonthView[], over: Record<string, unknown> = {}) {
  return {
    status: 'OK',
    fromMonth: months[0]?.month ?? '2026-09',
    toMonth: months[months.length - 1]?.month ?? '2026-09',
    months, totals: null, unallocatedPool: [], revisionsUsed: [], contracts: [], scheme: null, legs: {},
    gaps: [], asOf: '2026-09-15T02:00:00Z', view: 'CURRENT', ...over,
  }
}

function breakdownPayload(over: Record<string, unknown> = {}) {
  return {
    status: 'OK', reason: null, dimension: 'subject', dimensionLabel: '交易单元',
    basis: 'MONTHLY_NET_OBLIGATION', basisNote: '按窗口所触及月份的月度净义务', months: [],
    totalMwh: '500',
    rows: [
      { key: 7, label: '交易单元 #7', quantityMwh: '420', contractCount: 2, contracts: [] },
      { key: 'UNCLASSIFIED', label: '未分类', quantityMwh: '80', contractCount: 1, contracts: [] },
    ],
    consistency: { ok: true, partial: false },
    fromDate: '2026-09-01', toDate: '2026-09-30', contracts: [],
    ...over,
  }
}

async function mountTab() {
  const mounted = mountHedgeTab(HedgeMonthsTab)
  await vi.waitFor(() => { expect(mounted.wrapper.find('[data-test="month-view"]').exists()).toBe(true) })
  return mounted
}

describe('HedgeMonthsTab（任务 8.3）', () => {
  beforeEach(() => {
    selectedCompanyId.value = 'comp-a'
    monthsMock.mockReset()
    monthsMock.mockResolvedValue(monthsPayload([monthView()]))
    breakdownMock.mockReset()
    breakdownMock.mockResolvedValue(breakdownPayload())
  })

  it('默认月份范围为当月 + 后 2 个月，请求携带同一范围（HW-03）', async () => {
    const def = defaultMonthRange()
    const { wrapper } = await mountTab()
    expect((wrapper.find('[data-test="months-from"]').element as HTMLInputElement).value).toBe(def.fromMonth)
    expect((wrapper.find('[data-test="months-to"]').element as HTMLInputElement).value).toBe(def.toMonth)
    expect(monthsMock).toHaveBeenCalledWith(expect.objectContaining({ fromMonth: def.fromMonth, toMonth: def.toMonth }))
    await vi.waitFor(() => { expect(breakdownMock).toHaveBeenCalled() })
    expect(breakdownMock.mock.calls[0][0]).toMatchObject({ fromDate: `${def.fromMonth}-01`, dimension: 'subject' })
  })

  it('当月月卡：两口径套保率并列、判级带期限档（HM-02/HB-02）', async () => {
    const { wrapper } = await mountTab()
    const card = wrapper.find('[data-test="month-card-2026-09"]')
    expect(card.find('[data-test="ratio-interval"]').text()).toContain('50%')
    expect(card.find('[data-test="ratio-interval"]').text()).toContain('41.67%')
    expect(card.find('[data-test="interval-assessment"]').text()).toContain('区间内')
    expect(card.find('[data-test="interval-assessment"]').text()).toContain('月内档')
    expect(card.find('[data-test="baseline-with-mechanism"]').text()).toBe('58.33%')
    expect(card.find('[data-test="baseline-assessment"]').text()).toContain('月内档')
  })

  it('后续月份无基准：显示「预计发电未覆盖」且不出现基准套保率（HW-03）', async () => {
    const forward = monthView({
      month: '2026-10',
      period: 'FORWARD',
      baseline: { coverage: 'NONE', totalMwh: null, coveredStationIds: [], missingStationIds: [1, 2], label: '计划口径', note: '预计发电未覆盖（无预测、无基准）' },
      ratios: {
        interval: monthView().ratios.interval,
        baseline: {
          label: '计划口径',
          withMechanism: { value: null, status: 'NOT_COMPUTABLE' },
          midlongOnly: { value: null, status: 'NOT_COMPUTABLE' },
          assessment: assessmentOf('FORWARD_BASELINE', 'FORWARD', 'NOT_ASSESSED'),
        },
      },
    })
    monthsMock.mockResolvedValue(monthsPayload([monthView(), forward]))
    const { wrapper } = await mountTab()
    const card = wrapper.find('[data-test="month-card-2026-10"]')
    expect(card.find('[data-test="baseline-uncovered"]').exists()).toBe(true)
    expect(card.find('[data-test="baseline-uncovered"]').text()).toContain('预计发电未覆盖')
    expect(card.find('[data-test="baseline-with-mechanism"]').exists()).toBe(false)
    expect(card.find('[data-test="baseline-midlong-only"]').exists()).toBe(false)
    // 基准口径块里不得出现任何像算过的百分数
    expect(card.find('[data-test="ratio-baseline"]').text()).not.toMatch(/\d+(\.\d+)?%/)
    // 对照：当月基准覆盖 COMPLETE，比率照常显示
    expect(wrapper.find('[data-test="month-card-2026-09"]').find('[data-test="baseline-with-mechanism"]').exists()).toBe(true)
  })

  it('部分场站缺基准（PARTIAL）：如实标注缺基准场站，不隐藏比率区（HW-03）', async () => {
    monthsMock.mockResolvedValue(monthsPayload([monthView({
      baseline: { coverage: 'PARTIAL', totalMwh: '800', coveredStationIds: [1], missingStationIds: [2], label: '计划口径', note: '1 个场站缺基准，基准口径不完整' },
      ratios: {
        interval: monthView().ratios.interval,
        baseline: {
          label: '计划口径',
          withMechanism: { value: null, status: 'INCOMPLETE_COVERAGE' },
          midlongOnly: { value: null, status: 'INCOMPLETE_COVERAGE' },
          assessment: assessmentOf('MONTH_BASELINE', 'INTRA_MONTH', 'NOT_ASSESSED'),
        },
      },
    })]))
    const { wrapper } = await mountTab()
    const card = wrapper.find('[data-test="month-card-2026-09"]')
    expect(card.find('[data-test="baseline-partial"]').exists()).toBe(true)
    expect(card.find('[data-test="baseline-partial"]').text()).toContain('场站 #2')
    expect(card.find('[data-test="baseline-with-mechanism"]').text()).toContain('部分场站缺基准')
  })

  it('FORBIDDEN：锁价侧与钻取显示无权限而非 0（HW-04）', async () => {
    const forbiddenMonth = monthView({
      midlong: { lockedMwh: null, structure: null, incomplete: null, affectedContractIds: [], note: null },
      monthlyUndecomposed: { quantityMwh: null, contractIds: [], note: '无权限查看中长期持仓' },
      days: monthView().days.map((day) => ({ ...day, lockedDecomposedMwh: null })),
      caps: { status: 'REGISTERED', rows: [], note: '无权限查看中长期持仓' },
      consistency: { ok: null, partial: null, note: '无权限查看中长期持仓，未做守恒校验' },
    })
    monthsMock.mockResolvedValue(monthsPayload([forbiddenMonth], { status: 'FORBIDDEN' }))
    breakdownMock.mockResolvedValue(breakdownPayload({
      status: 'FORBIDDEN', reason: '无权限查看中长期持仓', totalMwh: null, rows: [], consistency: null,
    }))
    const { wrapper } = await mountTab()
    // 月卡：无权限徽标 + 锁价合计显示无权限文案；发电照常（覆盖天数仍在）
    expect(wrapper.find('[data-test="month-forbidden"]').exists()).toBe(true)
    const card = wrapper.find('[data-test="month-card-2026-09"]')
    expect(card.text()).toContain('无权限查看中长期持仓')
    expect(card.text()).toContain('实际 2 天 · 预测 1 天 · 未覆盖 1 天')
    // 钻取：无权限提示可见，分类与合计一律不渲染（不是 0）
    await vi.waitFor(() => { expect(wrapper.find('[data-test="drill-forbidden"]').exists()).toBe(true) })
    expect(wrapper.find('[data-test="drill-total"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="drill-sum"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="drill-rows"]').exists()).toBe(false)
  })

  it('月度未分解单列展示，不摊到日（HW-03/HC-06）', async () => {
    const { wrapper } = await mountTab()
    const card = wrapper.find('[data-test="month-card-2026-09"]')
    expect(card.text()).toContain('月度未分解')
    expect(card.text()).toContain('80')
    // 整段断言：fixture 的 note 里也含「不摊到日」，只断四个字会被 info 文本撑住，测不到 sub 模板本身
    expect(card.text()).toContain('1 份合同只登记月量（不摊到日）')
    // 按日序列只含已分解量（100/110/120），80 不属于任何一天——图表序列另由 MonthDaysChart spec 直接断言
    const dayTexts = card.findAll('[data-test="month-days-chart"]')
    expect(dayTexts).toHaveLength(1)
  })

  it('核定上限：剩余为负显示「超出核定上限」，未登记如实显示未登记（HB-07）', async () => {
    monthsMock.mockResolvedValue(monthsPayload([monthView({
      caps: {
        status: 'REGISTERED',
        rows: [
          { subjectId: 7, status: 'REGISTERED', capMwh: '600', lockedMwh: '650', remainingMwh: '-50', exceeded: false, sourceNote: null, note: null },
          { subjectId: 8, status: 'NOT_REGISTERED', capMwh: null, lockedMwh: '500', remainingMwh: null, exceeded: null, sourceNote: null, note: null },
          { subjectId: 9, status: 'REGISTERED', capMwh: '700', lockedMwh: '500', remainingMwh: '200', exceeded: false, sourceNote: null, note: null },
        ],
        note: '',
      },
    })]))
    const { wrapper } = await mountTab()
    expect(wrapper.find('[data-test="cap-status-7"]').text()).toBe('超出核定上限')
    expect(wrapper.find('[data-test="cap-status-8"]').text()).toBe('核定上限未登记')
    expect(wrapper.find('[data-test="cap-status-9"]').text()).toBe('已登记')
    expect(wrapper.find('[data-test="cap-row-7"]').text()).toContain('-50')
  })

  it('核定上限读取失败（FAILED）：显示读取失败/未知并带原因，不得表述成未登记（HB-07，R1-02）', async () => {
    monthsMock.mockResolvedValue(monthsPayload([monthView({
      caps: { status: 'FAILED', rows: [], note: '登记服务暂不可用，上限状态未知' },
    })]))
    const { wrapper } = await mountTab()
    const card = wrapper.find('[data-test="month-card-2026-09"]')
    const failed = card.find('[data-test="caps-failed"]')
    expect(failed.exists()).toBe(true)
    expect(failed.text()).toContain('读取失败')
    expect(failed.text()).toContain('登记服务暂不可用，上限状态未知')
    // FAILED 是「不知道」，不是「没有」：不得出现未登记空态，也没有可展示的行
    expect(card.find('[data-test="caps"]').text()).not.toContain('暂无交易单元的核定上限登记')
    expect(card.find('[data-test="caps-not-registered"]').exists()).toBe(false)
    expect(card.find('[data-test="cap-row-7"]').exists()).toBe(false)
  })

  it('核定上限整体未登记（NOT_REGISTERED）：如实显示未登记空态（HB-07，R1-02）', async () => {
    monthsMock.mockResolvedValue(monthsPayload([monthView({
      caps: { status: 'NOT_REGISTERED', rows: [], note: '尚未登记任何交易单元的核定上限' },
    })]))
    const { wrapper } = await mountTab()
    const card = wrapper.find('[data-test="month-card-2026-09"]')
    const notRegistered = card.find('[data-test="caps-not-registered"]')
    expect(notRegistered.exists()).toBe(true)
    expect(notRegistered.text()).toContain('核定上限未登记')
    expect(card.find('[data-test="caps-failed"]').exists()).toBe(false)
    expect(card.find('[data-test="cap-row-7"]').exists()).toBe(false)
  })

  it('钻取：分类求和 = 公司合计（数值断言）且服务端 consistency 可见（HM-06）', async () => {
    const { wrapper } = await mountTab()
    await vi.waitFor(() => { expect(wrapper.find('[data-test="drill-rows"]').exists()).toBe(true) })
    expect(wrapper.find('[data-test="drill-total"]').text()).toContain('500')
    expect(wrapper.find('[data-test="drill-sum"]').text()).toBe('500 MWh')
    expect(wrapper.find('[data-test="drill-consistency"]').text()).toContain('一致')
    expect(wrapper.find('[data-test="drill-row-7"]').text()).toContain('420')
    expect(wrapper.find('[data-test="drill-row-UNCLASSIFIED"]').text()).toContain('未分类')
  })

  it('钻取：求和不等于合计时数值并排可见、不一致徽标为红（HM-06 反例）', async () => {
    breakdownMock.mockResolvedValue(breakdownPayload({
      totalMwh: '600',
      consistency: { ok: false, partial: false, diff: '100' },
    }))
    const { wrapper } = await mountTab()
    await vi.waitFor(() => { expect(wrapper.find('[data-test="drill-rows"]').exists()).toBe(true) })
    expect(wrapper.find('[data-test="drill-sum"]').text()).toBe('500 MWh')
    expect(wrapper.find('[data-test="drill-total"]').text()).toContain('600')
    const badge = wrapper.find('[data-test="drill-consistency"]')
    expect(badge.text()).toContain('不一致')
    expect(badge.classes()).toContain('danger')
  })

  it('钻取：展开分类合同，链接中长期合同详情并带版本与指纹（HW-04）', async () => {
    breakdownMock.mockResolvedValue(breakdownPayload({
      rows: [{
        key: 7, label: '交易单元 #7', quantityMwh: '420', contractCount: 1,
        contracts: [{
          contractId: 55, externalContractNo: 'YN-2026-055', contractName: '年度双边 55', subjectId: 7, stationId: null,
          quantityMwh: '420', revisionId: 3, revisionNo: 2, confirmedAt: '2026-08-01T03:00:00Z', fingerprint: 'abc123def456fed',
          detail: { module: 'midlong', contractId: 55, api: '/api/v1/midlong/contracts/55' },
        }],
      }],
    }))
    const { wrapper } = await mountTab()
    await vi.waitFor(() => { expect(wrapper.find('[data-test="drill-rows"]').exists()).toBe(true) })
    expect(wrapper.find('[data-test="drill-contracts-7"]').exists()).toBe(false)
    await wrapper.find('[data-test="drill-toggle-7"]').trigger('click')
    await nextTick()
    const row = wrapper.find('[data-test="drill-contract-55"]')
    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('v2')
    expect(row.text()).toContain('abc123def456')
    const link = wrapper.find('[data-test="drill-contract-link-55"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('/zcqjy/contracts/55')
  })

  it('钻取：切换维度重新请求并带新维度参数（HW-04）', async () => {
    const { wrapper } = await mountTab()
    await vi.waitFor(() => { expect(breakdownMock).toHaveBeenCalledTimes(1) })
    await wrapper.find('[data-test="drill-dim-station"]').trigger('click')
    await vi.waitFor(() => { expect(breakdownMock).toHaveBeenCalledTimes(2) })
    expect(breakdownMock.mock.calls[1][0]).toMatchObject({ dimension: 'station' })
  })

  it('切公司前发出的旧请求晚到，不得覆盖新公司的结果（HW-06，#209 审查 R1-01）', async () => {
    selectedCompanyId.value = 'comp-a'
    const releases: Array<(value: unknown) => void> = []
    monthsMock.mockImplementation(() => new Promise((resolve) => { releases.push(resolve) }))
    const { wrapper } = mountHedgeTab(HedgeMonthsTab)
    await vi.waitFor(() => { expect(releases.length).toBeGreaterThan(0) })
    const staleCount = releases.length
    selectedCompanyId.value = 'comp-b'
    await vi.waitFor(() => { expect(releases.length).toBeGreaterThan(staleCount) })
    // 新公司先返回，旧公司后返回：页面必须停在新公司的结果上。
    releases[releases.length - 1](monthsPayload([monthView({ month: '2099-01' })]))
    await vi.waitFor(() => { expect(wrapper.find('[data-test="month-card-2099-01"]').exists()).toBe(true) })
    for (let i = 0; i < staleCount; i += 1) releases[i](monthsPayload([monthView({ month: '1999-01' })]))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(wrapper.find('[data-test="month-card-1999-01"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="month-card-2099-01"]').exists()).toBe(true)
  })

  it('认知时点变化：清空并按新时点重取月度视图与钻取（HW-05）', async () => {
    const { wrapper, workbench } = await mountTab()
    expect(monthsMock).toHaveBeenCalledTimes(1)
    expect(monthsMock.mock.calls[0][0].asOf).toBeUndefined()
    workbench.asOfInput.value = '2026-09-10T08:00'
    await vi.waitFor(() => { expect(monthsMock).toHaveBeenCalledTimes(2) })
    expect(monthsMock.mock.calls[1][0]).toMatchObject({ asOf: '2026-09-10T08:00' })
    await vi.waitFor(() => { expect(breakdownMock.mock.calls.at(-1)?.[0]).toMatchObject({ asOf: '2026-09-10T08:00' }) })
    expect(wrapper.find('[data-test="month-card-2026-09"]').exists()).toBe(true)
  })

  it('月份范围可调：改范围按新范围请求，非法范围被拦（HW-03）', async () => {
    const { wrapper } = await mountTab()
    await wrapper.find('[data-test="months-from"]').setValue('2026-10')
    await wrapper.find('[data-test="months-to"]').setValue('2026-12')
    await wrapper.find('[data-test="months-load"]').trigger('click')
    await vi.waitFor(() => {
      const last = monthsMock.mock.calls.at(-1)?.[0]
      expect(last).toMatchObject({ fromMonth: '2026-10', toMonth: '2026-12' })
    })
    // 起始晚于结束：前端直接拦下，不发请求
    const calls = monthsMock.mock.calls.length
    await wrapper.find('[data-test="months-from"]').setValue('2027-01')
    await wrapper.find('[data-test="months-load"]').trigger('click')
    expect(wrapper.find('[data-test="months-range-error"]').text()).toContain('起始月份不能晚于结束月份')
    expect(monthsMock.mock.calls.length).toBe(calls)
  })

  it('月份草稿未提交不触发取数；提交后月卡与钻取一次性按新范围刷新（R1-01）', async () => {
    const { wrapper } = await mountTab()
    await vi.waitFor(() => {
      expect(monthsMock).toHaveBeenCalledTimes(1)
      expect(breakdownMock).toHaveBeenCalledTimes(1)
    })
    // 改输入框只是草稿：等一个微任务周期以上，月卡与钻取都不得发新请求
    await wrapper.find('[data-test="months-from"]').setValue('2026-10')
    await wrapper.find('[data-test="months-to"]').setValue('2026-12')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(monthsMock).toHaveBeenCalledTimes(1)
    expect(breakdownMock).toHaveBeenCalledTimes(1)
    // 提交：同一次点击，月卡与钻取都按已提交范围请求（窗口 = 2026-10-01 ~ 2026-12-31）
    await wrapper.find('[data-test="months-load"]').trigger('click')
    await vi.waitFor(() => { expect(monthsMock).toHaveBeenCalledTimes(2) })
    expect(monthsMock.mock.calls[1][0]).toMatchObject({ fromMonth: '2026-10', toMonth: '2026-12' })
    await vi.waitFor(() => { expect(breakdownMock).toHaveBeenCalledTimes(2) })
    expect(breakdownMock.mock.calls[1][0]).toMatchObject({ fromDate: '2026-10-01', toDate: '2026-12-31' })
  })
})
