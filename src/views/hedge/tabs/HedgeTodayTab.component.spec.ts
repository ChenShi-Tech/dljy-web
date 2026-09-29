// 套保工作台「今明两日」页签组件测试（build-midlong-spot-hedging 任务 8.1/8.2，HW-01/02/08；#3420 自外壳 spec 搬入）。
// 组件测试文件名必须是 *.component.spec.ts 才会在 happy-dom 环境运行。
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchOverview = vi.fn()

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

import HedgeTodayTab from './HedgeTodayTab.vue'
import { mountHedgeTab, overviewPayload } from '@/test/hedgeWorkbench'

enableAutoUnmount(afterEach)

function mountTab() {
  return mountHedgeTab(HedgeTodayTab).wrapper
}

describe('HedgeTodayTab（HW-01/02/08）', () => {
  afterEach(() => {
    fetchOverview.mockReset()
  })

  it('判级未评估时展示原因而不是默认安全色', async () => {
    fetchOverview.mockResolvedValue(overviewPayload())
    const wrapper = mountTab()
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
    const wrapper = mountTab()
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
    const wrapper = mountTab()
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
    const wrapper = mountTab()
    await vi.dynamicImportSettled()
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="load-error"]').text()).toContain('数据加载失败')
    })
  })
})
