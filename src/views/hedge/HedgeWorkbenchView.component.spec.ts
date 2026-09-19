// 套保工作台组件测试（build-midlong-spot-hedging 任务 8.1/8.2，HW-01/06/07）。
// 组件测试文件名必须是 *.component.spec.ts 才会在 happy-dom 环境运行。
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const fetchOverview = vi.fn()
vi.mock('@/services/hedge/hedgeApi', () => ({
  HedgeApiError: class HedgeApiError extends Error {
    status: number
    errorCode: string
    constructor(status: number, errorCode: string, message: string) {
      super(message)
      this.status = status
      this.errorCode = errorCode
    }
  },
  fetchOverview: (...args: unknown[]) => fetchOverview(...(args as [])),
  fetchBaselines: vi.fn(async () => ({ rows: [] })),
  putBaselines: vi.fn(async () => ({ rows: [] })),
}))

import HedgeWorkbenchView from './HedgeWorkbenchView.vue'

enableAutoUnmount(afterAll)

const REGION = { id: 'yunnan' }

function mountView(regionId = 'yunnan') {
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

describe('HedgeWorkbenchView（HW-01/02/06/07）', () => {
  afterEach(() => {
    fetchOverview.mockReset()
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

  it('判级未评估时展示原因而不是默认安全色', async () => {
    fetchOverview.mockResolvedValue(overviewPayload())
    const wrapper = mountView()
    await vi.dynamicImportSettled()
    await vi.waitFor(() => {
      const assessment = wrapper.find('[data-test="assessment"]').text()
      expect(assessment).toContain('未评估')
    })
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
})
