// 套保工作台「当月/后续」页签组件测试（HW-06；#3420 自外壳 spec 搬入）。
// 组件测试文件名必须是 *.component.spec.ts 才会在 happy-dom 环境运行。
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchMonths = vi.fn(async (): Promise<unknown> => ({}))

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { get value() { return { id: 'yunnan' } } },
}))

// 公司上下文桩：真实 ref，切换公司的重取与旧响应丢弃（HW-06）才真正受测。
vi.mock('@/services/company/companyContext', async () => {
  const { ref } = await import('vue')
  return { selectedCompanyId: ref('comp-a') }
})

vi.mock('@/services/hedge/hedgeApi', () => ({
  fetchMonths: (...args: unknown[]) => fetchMonths(...(args as [])),
}))

import HedgeMonthsTab from './HedgeMonthsTab.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { mountHedgeTab } from '@/test/hedgeWorkbench'

enableAutoUnmount(afterEach)

describe('HedgeMonthsTab（HW-06）', () => {
  afterEach(() => {
    fetchMonths.mockReset()
    fetchMonths.mockImplementation(async () => ({}))
  })

  it('辅助页签：切公司前发出的旧请求晚到，不得覆盖新公司的结果（HW-06，#209 审查 R1-01）', async () => {
    selectedCompanyId.value = 'comp-a'
    const releases: Array<(value: unknown) => void> = []
    fetchMonths.mockImplementation(() => new Promise((resolve) => { releases.push(resolve) }))
    // 页签被激活（挂载）即取数，对应原外壳里点击「当月/后续」页签。
    const { wrapper } = mountHedgeTab(HedgeMonthsTab)
    await vi.waitFor(() => { expect(releases.length).toBeGreaterThan(0) })
    const staleCount = releases.length
    selectedCompanyId.value = 'comp-b'
    await vi.waitFor(() => { expect(releases.length).toBeGreaterThan(staleCount) })
    // 新公司先返回，旧公司后返回：页面必须停在新公司的结果上。
    releases[releases.length - 1]({ months: [{ month: 'NEW-COMPANY' }] })
    await vi.waitFor(() => { expect(wrapper.find('[data-test="month-view"]').text()).toContain('NEW-COMPANY') })
    for (let i = 0; i < staleCount; i += 1) releases[i]({ months: [{ month: 'STALE-COMPANY' }] })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(wrapper.find('[data-test="month-view"]').text()).toContain('NEW-COMPANY')
    expect(wrapper.find('[data-test="month-view"]').text()).not.toContain('STALE-COMPANY')
    fetchMonths.mockReset()
    fetchMonths.mockImplementation(async () => ({}))
    selectedCompanyId.value = 'comp-a'
  })
})
