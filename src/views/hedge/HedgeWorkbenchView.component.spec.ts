// 套保工作台组件测试（build-midlong-spot-hedging 任务 8.1/8.2/8.6，HW-01/06/07/10）。
// 组件测试文件名必须是 *.component.spec.ts 才会在 happy-dom 环境运行。
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const fetchOverview = vi.fn()
const putCaps = vi.fn()
const putBaselines = vi.fn()

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
  putBaselines: (...args: unknown[]) => putBaselines(...(args as [])),
  fetchBandPresets: vi.fn(async () => ({ rows: [] })),
  fetchBandActivation: vi.fn(async () => ({ active: null })),
  fetchCaps: vi.fn(async () => ({ rows: [{ subjectId: 1, month: '2026-11', capMwh: '100' }] })),
  fetchMechanismParams: vi.fn(async () => ({ rows: [] })),
  fetchMonths: vi.fn(async () => ({})),
  fetchSettlement: vi.fn(async () => ({})),
  postMechanismVersion: vi.fn(async () => ({})),
  postSimulate: vi.fn(async () => ({})),
  putCaps: (...args: unknown[]) => putCaps(...(args as [])),
  requestBandSchemeCreate: vi.fn(async () => ({ schemeId: 1 })),
  activateBand: vi.fn(async () => ({})),
}))

import HedgeWorkbenchView from './HedgeWorkbenchView.vue'
import { HedgeApiError } from '@/services/hedge/hedgeApi'
import { selectedCompanyId } from '@/services/company/companyContext'

enableAutoUnmount(afterAll)

const hedgeApiError = (status: number, errorCode: string, message: string, details: Record<string, unknown> | null = null) =>
  new HedgeApiError(status, errorCode, message, details)

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

function overviewPayload() {
  return {
    asOf: '2026-09-15T02:00:00Z',
    view: 'CURRENT',
    intervals: [
      { start: '2026-09-15T07:00:00+08:00', end: '2026-09-15T08:00:00+08:00', covered: true,
        generation: { value: '50', source: 'ACTUAL', uncoveredReason: null },
        locked: { midlong: '20', mechanism: { value: '10', note: null }, total: '30' },
        exposure: { withMechanism: '20', midlongOnly: '30' } },
      { start: '2026-09-15T10:00:00+08:00', end: '2026-09-15T11:00:00+08:00', covered: false,
        generation: { value: null, source: 'FORECAST', uncoveredReason: 'FORECAST_NOT_ARRIVED' },
        locked: { midlong: '20', mechanism: { value: null, note: null }, total: null },
        exposure: { withMechanism: null, midlongOnly: null } },
    ],
    ratio: {
      coverage: { coveredCount: 1, totalCount: 2 },
      withMechanism: { value: null, status: 'MECHANISM_INCOMPLETE' },
      midlongOnly: { value: '0.6', status: 'OK' },
    },
    standardMetrics: { TODAY2_INTERVAL: { level: 'NOT_ASSESSED', reason: 'MECHANISM_INCOMPLETE', hints: [], tier: null, basis: 'WITH_MECHANISM' } },
    sensitivity: { value: null, incomplete: true, reference: '30', note: '未计机制电量' },
    watchlist: { rows: [], basisUsed: 'WITH_MECHANISM', note: null, disclaimer: '决策支持参考，不构成自动下单或确定性买卖指令' },
    scheme: null,
    legs: {},
    gaps: [{ code: 'FORECAST_NOT_ARRIVED', message: '明日预测未到达', affected: null }],
    meta: {},
  }
}

async function openMaintenance(wrapper: ReturnType<typeof mount>) {
  await vi.waitFor(() => {
    expect(wrapper.find('[data-test="maintenance-toggle"]').exists()).toBe(true)
  })
  await wrapper.find('[data-test="maintenance-toggle"]').trigger('click')
  await vi.waitFor(() => {
    expect(wrapper.find('[data-test="maintenance"]').exists()).toBe(true)
  })
}

describe('HedgeWorkbenchView（HW-01/02/06/07/10）', () => {
  afterEach(() => {
    fetchOverview.mockReset()
    putCaps.mockReset()
    putBaselines.mockReset()
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
  })

  it('判级未评估时展示原因而不是默认安全色', async () => {
    fetchOverview.mockResolvedValue(overviewPayload())
    const wrapper = mountView()
    await vi.dynamicImportSettled()
    await vi.waitFor(() => {
      const assessment = wrapper.find('[data-test="assessment"]').text()
      expect(assessment).toContain('未评估')
    })
  })

  it('overview 缺 standardMetrics/sensitivity 等字段时降级显示，不冻结渲染（#3133 回归）', async () => {
    const { standardMetrics: _sm, sensitivity: _se, ...bare } = overviewPayload()
    void _sm
    void _se
    fetchOverview.mockResolvedValue(bare)
    const wrapper = mountView()
    await vi.dynamicImportSettled()
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="metrics"]').exists()).toBe(true)
    })
    const text = wrapper.text()
    expect(text).toContain('未评估')
    expect(text).toContain('不完整')
    expect(wrapper.find('[data-test="intervals"]').exists()).toBe(true)
  })

  it('未知时段显示未知/未覆盖原因，不用 0 冒充', async () => {
    fetchOverview.mockResolvedValue(overviewPayload())
    const wrapper = mountView()
    await vi.dynamicImportSettled()
    await vi.waitFor(() => {
      const row = wrapper.find('tbody tr:nth-child(2)')
      expect(row.text()).toContain('未知')
      expect(row.text()).toContain('FORECAST_NOT_ARRIVED')
      expect(row.text()).not.toContain('0</td>')
    })
  })

  it('加载失败显示失败原因，不用空图冒充零敞口（HW-08）', async () => {
    fetchOverview.mockRejectedValue(new Error('网络中断'))
    const wrapper = mountView()
    await vi.dynamicImportSettled()
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="load-error"]').text()).toContain('数据加载失败')
    })
  })

  it('维护入口 409 冲突提示刷新（8.6/HW-10）', async () => {
    fetchOverview.mockResolvedValue(overviewPayload())
    const wrapper = mountView()
    await vi.dynamicImportSettled()
    await openMaintenance(wrapper)
    putCaps.mockRejectedValue(hedgeApiError(409, 'VERSION_CONFLICT', '标注已被他人更新，请刷新后核对'))
    await wrapper.find('[data-test="caps-status"]').exists()
    const saveButtons = wrapper.findAll('button').filter((b) => b.text() === '保存')
    expect(saveButtons.length).toBeGreaterThan(0)
    await saveButtons[0]!.trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="caps-status"]').text()).toContain('409')
      expect(wrapper.find('[data-test="caps-status"]').text()).toContain('刷新后核对')
    })
  })

  it('维护入口 422 按 details.field 定位字段（8.6/HB-07）', async () => {
    fetchOverview.mockResolvedValue(overviewPayload())
    const wrapper = mountView()
    await vi.dynamicImportSettled()
    await openMaintenance(wrapper)
    putCaps.mockRejectedValue(hedgeApiError(422, 'BAND_TIER_INVALID', '比例不在允许档位', { field: 'capMwh' }))
    const saveButtons = wrapper.findAll('button').filter((b) => b.text() === '保存')
    await saveButtons[0]!.trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="caps-status"]').text()).toContain('422')
      expect(wrapper.find('[data-test="caps-status"]').text()).toContain('字段 capMwh')
    })
  })

  it('维护入口 403 转只读态并说明所需权限（8.6）', async () => {
    fetchOverview.mockResolvedValue(overviewPayload())
    const wrapper = mountView()
    await vi.dynamicImportSettled()
    await openMaintenance(wrapper)
    putBaselines.mockRejectedValue(hedgeApiError(403, 'FORBIDDEN', '当前角色无公司写权限'))
    await wrapper.find('[data-test="baseline-save"]').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="baseline-status"]').text()).toContain('403')
      expect(wrapper.find('.readonly-note').exists()).toBe(true)
      expect(wrapper.find('.readonly-note').text()).toContain('ADMIN / 本公司 BOSS')
      expect((wrapper.find('[data-test="baseline-save"]').element as HTMLButtonElement).disabled).toBe(true)
    })
  })
})
