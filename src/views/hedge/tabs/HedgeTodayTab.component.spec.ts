// 套保工作台「今明两日」页签组件测试（build-midlong-spot-hedging 任务 8.2/8.4/8.7，HW-01/02/05/06/09；ChenShi-Tech/dljy#3420）。
// 组件测试文件名必须是 *.component.spec.ts 才会在 happy-dom 环境运行。
// useEChart / exportCsv / defineAiPage 全部拦截：图表断言 setOption 收到的序列数据（未知点为 null 而非 0、
// 阶梯线不平滑），导出断言 CSV 参数与认知时点，侧边栏断言注册的摘要工厂及其内容约束。
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchOverview = vi.fn()
const { setOptionMock, exportCsvMock, defineAiPageMock } = vi.hoisted(() => ({
  setOptionMock: vi.fn(),
  exportCsvMock: vi.fn(),
  defineAiPageMock: vi.fn(),
}))

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { get value() { return { id: 'yunnan' } } },
}))

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
}))

vi.mock('@/composables/useEChart', () => ({
  useEChart: () => ({
    setOption: setOptionMock,
    instance: () => null,
    resize: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    dispose: vi.fn(),
  }),
}))

vi.mock('@/utils/exportCsv', () => ({
  exportCsv: (...args: unknown[]) => exportCsvMock(...(args as [])),
}))

vi.mock('@/features/aiSidebar', () => ({
  defineAiPage: (...args: unknown[]) => defineAiPageMock(...(args as [])),
}))

import HedgeTodayTab from './HedgeTodayTab.vue'
import { mountHedgeTab, overviewPayload } from '@/test/hedgeWorkbench'
import { selectedCompanyId } from '@/services/company/companyContext'

enableAutoUnmount(afterEach)

/** 带腿水位/锁价说明/缺口分区的完整载荷（覆盖、无合同、未覆盖三段）。 */
function richPayload() {
  const base = overviewPayload()
  return {
    ...base,
    fromDate: '2026-09-15', toDate: '2026-09-16', granularity: 'HOUR',
    intervals: [
      { start: '2026-09-15T07:00:00+08:00', end: '2026-09-15T08:00:00+08:00', covered: true,
        generation: { value: '50', source: 'ACTUAL', uncoveredReason: null },
        locked: { midlong: '20', lockNote: null, mechanism: { value: '10', note: null }, total: '30' },
        exposure: { withMechanism: '20', midlongOnly: '30' } },
      { start: '2026-09-15T08:00:00+08:00', end: '2026-09-15T09:00:00+08:00', covered: true,
        generation: { value: '40', source: 'FORECAST', uncoveredReason: null },
        locked: { midlong: null, lockNote: 'NO_CONTRACT', mechanism: { value: '10', note: null }, total: '10' },
        exposure: { withMechanism: '30', midlongOnly: '30' } },
      { start: '2026-09-16T08:00:00+08:00', end: '2026-09-16T09:00:00+08:00', covered: false,
        generation: { value: null, source: null, uncoveredReason: 'FORECAST_NOT_ARRIVED' },
        locked: { midlong: null, lockNote: 'CURVE_MISSING', mechanism: { value: null, note: null }, total: null },
        exposure: { withMechanism: null, midlongOnly: null } },
    ],
    watchlist: { rows: [
      { start: '2026-09-15T07:00:00+08:00', basis: 'WITH_MECHANISM', note: null, exposureMwh: '20.5', direction: 'SELL', riskNote: null, priceTag: null },
    ], basisUsed: 'WITH_MECHANISM', note: null, disclaimer: '决策支持参考，不构成自动下单或确定性买卖指令' },
    legs: { status: 'DEGRADED', degraded: true, rows: [
      { key: 'LEDGER', sourceKey: null, label: '中长期合同台账', status: 'OK', changedAt: '2026-09-15T01:00:00Z', dataThrough: null,
        publishRule: null, publishAssumption: null, publishedAt: null, ingestedAt: null, version: null, reason: '台账无已确认合同', note: null },
      { key: 'FORECAST_VENDOR', sourceKey: 'enyvision', label: '供应商发电预测·远景', status: 'STALE', changedAt: '2026-09-15T01:30:00Z',
        dataThrough: '2026-09-15T08:00:00+08:00', publishRule: null, publishAssumption: '供应商每日 17:30 前发布', publishedAt: '2026-09-14T17:30:00+08:00',
        ingestedAt: null, version: null, reason: '预测未到达：供应商远景停更', note: null },
      { key: 'PRICE', sourceKey: null, label: '价格', status: 'FAILED', changedAt: null, dataThrough: null,
        publishRule: null, publishAssumption: null, publishedAt: null, ingestedAt: null, version: null, reason: '价格读取失败：连接超时', note: null },
    ] },
    gaps: [
      { code: 'LEDGER_WATERMARK_FAILED', message: '台账水位读取失败', affected: null },
      { code: 'BASELINES_QUERY_FAILED', message: '月度基准读取失败', affected: null },
      { code: 'FORECAST_NOT_ARRIVED', message: '明日预测未到达', affected: null },
    ],
  }
}

/** 台账腿失败（读取异常）的载荷：与「台账无合同」相对，必须展示为失败而非已知 0。 */
function ledgerFailedPayload() {
  const payload = richPayload()
  return {
    ...payload,
    legs: { ...payload.legs, degraded: true, rows: [
      { ...((payload.legs as { rows: Array<Record<string, unknown>> }).rows[0] ?? {}), status: 'FAILED', reason: '台账水位读取失败：连接超时' },
    ] },
  }
}

function mountTab() {
  return mountHedgeTab(HedgeTodayTab)
}

async function mountLoaded(payload: unknown) {
  fetchOverview.mockResolvedValue(payload)
  const mounted = mountTab()
  await vi.dynamicImportSettled()
  await vi.waitFor(() => {
    expect(mounted.wrapper.find('[data-test="metrics"]').exists()).toBe(true)
  })
  return mounted
}

describe('HedgeTodayTab（HW-01/02/05/06/09）', () => {
  afterEach(() => {
    fetchOverview.mockReset()
    setOptionMock.mockReset()
    exportCsvMock.mockReset()
    defineAiPageMock.mockReset()
    selectedCompanyId.value = 'comp-a'
  })

  it('判级未评估时展示中文原因，不显示默认安全色', async () => {
    const { wrapper } = await mountLoaded(richPayload())
    const assessment = wrapper.find('[data-test="assessment"]').text()
    expect(assessment).toContain('未评估')
    expect(assessment).toContain('机制参数不完整')
  })

  it('FORBIDDEN 显示「无权限查看中长期持仓」，不显示数值（更不是 0）', async () => {
    const payload = richPayload()
    payload.ratio = {
      ...payload.ratio,
      withMechanism: { value: '0.5', status: 'FORBIDDEN' },
      midlongOnly: { value: '0.7', status: 'OK' },
    }
    const { wrapper } = await mountLoaded(payload)
    const text = wrapper.find('[data-test="ratio-with-mechanism"]').text()
    expect(text).toContain('无权限查看中长期持仓')
    expect(text).not.toContain('0.5')
  })

  it('overview 缺 standardMetrics/sensitivity 等字段时降级显示，不冻结渲染（#3133 回归）', async () => {
    const { standardMetrics: _sm, sensitivity: _se, ...bare } = overviewPayload()
    void _sm
    void _se
    const { wrapper } = await mountLoaded(bare)
    const text = wrapper.text()
    expect(text).toContain('未评估')
    expect(text).toContain('不完整')
    expect(wrapper.find('[data-test="intervals"]').exists()).toBe(true)
  })

  it('未知时段显示未知与未覆盖原因（契约中文标签），不用 0 冒充', async () => {
    const { wrapper } = await mountLoaded(richPayload())
    const row = wrapper.findAll('[data-test="intervals"] tbody tr')[2]
    expect(row.text()).toContain('未知')
    expect(row.text()).toContain('预测未到达')
    expect(row.text()).not.toContain('0</td>')
  })

  it('敞口图：未知点为 null 不连线、阶梯不平滑、发电柱按实际/预测着色、未覆盖画灰带（HW-02）', async () => {
    await mountLoaded(richPayload())
    await vi.waitFor(() => { expect(setOptionMock).toHaveBeenCalled() })
    const option = setOptionMock.mock.calls.at(-1)?.[0] as { series: Array<{ name: string; data: unknown[]; step?: string; smooth?: boolean; connectNulls?: boolean; markArea?: { data: unknown[] } }> }
    const withMech = option.series.find((s) => s.name === '敞口（含机制）')
    const midlongOnly = option.series.find((s) => s.name === '敞口（仅中长期）')
    const bar = option.series.find((s) => s.name === '发电')
    // 未知时段是 null，不是 0（ECharts 默认 connectNulls:false → 线在断点断开）。
    expect(withMech?.data).toEqual([20, 30, null])
    expect(midlongOnly?.data).toEqual([30, 30, null])
    expect(withMech?.connectNulls).toBeUndefined()
    expect(bar?.data[2]).toBe(null)
    // 时段起点标签的阶梯线，禁用平滑。
    expect(withMech?.step).toBe('end')
    expect(withMech?.smooth).toBe(false)
    // 发电柱三色语义：实际青绿、预测中性灰、未覆盖无柱（由 markArea 灰带示意）。
    expect(bar?.data[0]).toMatchObject({ value: 50, itemStyle: { color: '#0f9d8a' } })
    expect(bar?.data[1]).toMatchObject({ value: 40, itemStyle: { color: '#94a3b8' } })
    expect(bar?.markArea?.data).toHaveLength(1)
  })

  it('数据腿新鲜度：供应商预测按来源一行、STALE 标过期、FAILED 标加载失败并带原因、登记假设有标注（HW-01）', async () => {
    const { wrapper } = await mountLoaded(richPayload())
    const rows = wrapper.findAll('[data-test="leg-row"]')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('中长期合同台账')
    const vendor = rows[1].text()
    expect(vendor).toContain('供应商发电预测·远景')
    expect(vendor).toContain('过期')
    expect(vendor).toContain('预测未到达：供应商远景停更')
    expect(vendor).toContain('登记假设')
    const price = rows[2].text()
    expect(price).toContain('加载失败')
    expect(price).toContain('价格读取失败：连接超时')
    expect(wrapper.find('[data-test="legs-degraded"]').exists()).toBe(true)
  })

  it('「台账无合同」与「台账失败」分开：前者是已知 0，后者按失败展示并进缺口失败区', async () => {
    // 无合同：腿行说明 + 中长期单元格「0（无生效合同）」（已知 0，不是未知）。
    const { wrapper } = await mountLoaded(richPayload())
    expect(wrapper.find('[data-test="leg-row"]').text()).toContain('台账无已确认合同')
    expect(wrapper.findAll('[data-test="midlong-cell"]')[1].text()).toBe('0（无生效合同）')

    // 读取失败：腿行状态「加载失败」+ 原因，缺口失败区单列，单元格不再显示 0。
    fetchOverview.mockReset()
    const failed = await mountLoaded(ledgerFailedPayload())
    expect(failed.wrapper.find('[data-test="leg-row"]').find('[data-test="leg-status"]').text()).toBe('加载失败')
    expect(failed.wrapper.find('[data-test="leg-row"]').text()).toContain('台账水位读取失败：连接超时')
    expect(failed.wrapper.find('[data-test="gap-failures"]').text()).toContain('台账水位读取失败')
  })

  it('数据缺口分区：读取失败与数据覆盖分开展示，不混在一起', async () => {
    const { wrapper } = await mountLoaded(richPayload())
    const failures = wrapper.find('[data-test="gap-failures"]').text()
    expect(failures).toContain('台账水位读取失败')
    expect(failures).toContain('月度基准读取失败')
    expect(failures).not.toContain('明日预测未到达')
    const coverage = wrapper.find('[data-test="gap-coverage"]').text()
    expect(coverage).toContain('明日预测未到达')
    expect(coverage).not.toContain('台账水位读取失败')
  })

  it('加载失败显示失败原因，不用空图冒充零敞口（HW-08）', async () => {
    fetchOverview.mockRejectedValue(new Error('网络中断'))
    const { wrapper } = mountTab()
    await vi.dynamicImportSettled()
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="load-error"]').text()).toContain('数据加载失败')
    })
  })

  it('切公司后旧请求晚到被丢弃，只显示新公司的结果（HW-06）', async () => {
    selectedCompanyId.value = 'comp-a'
    const releases: Array<(value: unknown) => void> = []
    fetchOverview.mockImplementation(() => new Promise((resolve) => { releases.push(resolve) }))
    const { wrapper } = mountTab()
    await vi.dynamicImportSettled()
    await vi.waitFor(() => { expect(releases.length).toBe(1) })
    selectedCompanyId.value = 'comp-b'
    await vi.waitFor(() => { expect(releases.length).toBe(2) })
    // comp-a 的响应晚到：必须被丢弃，页面不得显示它的数据。
    releases[0](richPayload())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(wrapper.find('[data-test="metrics"]').exists()).toBe(false)
    releases[1](richPayload())
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="metrics"]').exists()).toBe(true)
    })
  })

  it('同作用域并发两次 load：先发的成功响应后到被丢弃，不覆盖新结果（R1-01）', async () => {
    selectedCompanyId.value = 'comp-a'
    const releases: Array<(value: unknown) => void> = []
    fetchOverview.mockImplementation(() => new Promise((resolve) => { releases.push(resolve) }))
    const { wrapper, workbench } = mountTab()
    await vi.dynamicImportSettled()
    await vi.waitFor(() => { expect(releases.length).toBe(1) })
    // 同一作用域内再触发一次 load（维护写入成功后的重取路径），两个在途请求都被判为同一作用域。
    workbench.notifyDataChanged()
    await vi.waitFor(() => { expect(releases.length).toBe(2) })
    // 新请求先成功：页面显示新结果（用 midlongOnly 的值区分两次结果）。
    const newer = richPayload()
    newer.ratio = { ...newer.ratio, midlongOnly: { value: '0.77', status: 'OK' } }
    releases[1](newer)
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="ratio-midlong-only"]').text()).toContain('0.77')
    })
    // 旧请求后到：必须被丢弃，不得把 0.6 覆盖回去。
    releases[0](richPayload())
    await new Promise((resolve) => setTimeout(resolve, 20))
    const cell = wrapper.find('[data-test="ratio-midlong-only"]').text()
    expect(cell).toContain('0.77')
    expect(cell).not.toContain('0.6')
  })

  it('同作用域并发两次 load：先发的失败后到被丢弃，不清空页面也不报错（R1-01）', async () => {
    selectedCompanyId.value = 'comp-a'
    const settles: Array<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = []
    fetchOverview.mockImplementation(() => new Promise((resolve, reject) => { settles.push({ resolve, reject }) }))
    const { wrapper, workbench } = mountTab()
    await vi.dynamicImportSettled()
    await vi.waitFor(() => { expect(settles.length).toBe(1) })
    workbench.notifyDataChanged()
    await vi.waitFor(() => { expect(settles.length).toBe(2) })
    // 新请求先成功：页面已有数据。
    settles[1].resolve(richPayload())
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="metrics"]').exists()).toBe(true)
    })
    // 旧请求后到且失败：必须被丢弃——不清空已显示的结果、不显示错误。
    settles[0].reject(new Error('慢请求失败'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(wrapper.find('[data-test="metrics"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="load-error"]').exists()).toBe(false)
  })

  it('导出 CSV 带认知时点与当前结果的查询参数，不用输入框里尚未生效的值（HW-05）', async () => {
    const { wrapper, workbench } = await mountLoaded(richPayload())
    await wrapper.find('[data-test="export-csv"]').trigger('click')
    expect(exportCsvMock).toHaveBeenCalledTimes(1)
    const [filename, headers, rows] = exportCsvMock.mock.calls[0] as [string, string[], unknown[][]]
    expect(headers[0]).toBe('认知时点')
    expect(rows[0]?.[0]).toBe('当前视图')
    expect(filename).toContain('hedge-today2')

    // 认知时点输入改了但尚未生效（防抖窗口内）：旧结果已清空、无数据可导，不得拿输入框的新值导旧结果。
    workbench.asOfInput.value = '2026-09-15T08:00:00+08:00'
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="export-csv"]').exists()).toBe(false)
    })
    expect(exportCsvMock).toHaveBeenCalledTimes(1)

    // 防抖重取生效后导出：行内认知时点是已生效查询的快照值。
    await new Promise((resolve) => setTimeout(resolve, 300))
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="export-csv"]').exists()).toBe(true)
    })
    expect(fetchOverview).toHaveBeenLastCalledWith(expect.objectContaining({ asOf: '2026-09-15T08:00:00+08:00' }))
    await wrapper.find('[data-test="export-csv"]').trigger('click')
    const second = exportCsvMock.mock.calls[1] as [string, string[], unknown[][]]
    expect(second[2][0]?.[0]).toBe('2026-09-15T08:00:00+08:00')
  })

  it('侧边栏摘要：注册页面声明，摘要含套保率/判级/腿状态，不含试算字段、未覆盖时段不带数值（HW-09）', async () => {
    const { wrapper } = await mountLoaded(richPayload())
    expect(wrapper.find('[data-test="watchlist-row"]').exists()).toBe(true)
    expect(defineAiPageMock).toHaveBeenCalledTimes(1)
    const def = defineAiPageMock.mock.calls[0][0] as {
      label: string; promptKey: string
      interpret: { context: () => Record<string, unknown> | null }
      presets: Array<{ label: string }>
    }
    expect(def.label).toContain('今明两日')
    expect(def.promptKey).toBe('workbench')
    expect(def.presets[0]?.label).toContain('补仓')

    const summary = def.interpret.context()
    expect(summary).not.toBe(null)
    const summaryObj = summary as Record<string, unknown>
    expect(summaryObj.ratios).toBeTruthy()
    expect(summaryObj.assessment).toBeTruthy()
    expect(JSON.stringify(summary)).not.toContain('试算')
    expect(JSON.stringify(summary)).not.toContain('simulate')
    // 未覆盖时段不带数值：摘要没有逐时段明细，需关注行只含已覆盖时段的敞口。
    expect(summaryObj).not.toHaveProperty('intervals')
    const watchlist = summaryObj.watchlist as Array<{ exposureMwh: string | null }>
    expect(watchlist).toHaveLength(1)
    expect(watchlist[0]?.exposureMwh).toBe('20.5')
  })
})
