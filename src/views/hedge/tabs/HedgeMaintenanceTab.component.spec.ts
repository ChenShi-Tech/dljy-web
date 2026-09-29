// 套保工作台「维护」页签组件测试（build-midlong-spot-hedging 任务 8.6，HW-10/HB-07；#3420 自外壳 spec 搬入）。
// 组件测试文件名必须是 *.component.spec.ts 才会在 happy-dom 环境运行。
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const putCaps = vi.fn()
const putBaselines = vi.fn()

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
  fetchBaselines: vi.fn(async () => ({ rows: [] })),
  putBaselines: (...args: unknown[]) => putBaselines(...(args as [])),
  fetchBandPresets: vi.fn(async () => ({ rows: [] })),
  fetchBandActivation: vi.fn(async () => ({ active: null })),
  fetchCaps: vi.fn(async () => ({ rows: [{ subjectId: 1, month: '2026-11', capMwh: '100' }] })),
  fetchMechanismParams: vi.fn(async () => ({ rows: [] })),
  postMechanismVersion: vi.fn(async () => ({})),
  putCaps: (...args: unknown[]) => putCaps(...(args as [])),
  requestBandSchemeCreate: vi.fn(async () => ({ schemeId: 1 })),
  activateBand: vi.fn(async () => ({})),
}))

import HedgeMaintenanceTab from './HedgeMaintenanceTab.vue'
import { HedgeApiError } from '@/services/hedge/hedgeApi'
import { mountHedgeTab } from '@/test/hedgeWorkbench'

enableAutoUnmount(afterEach)

const hedgeApiError = (status: number, errorCode: string, message: string, details: Record<string, unknown> | null = null) =>
  new HedgeApiError(status, errorCode, message, details)

/** 挂载维护页签（对应原外壳里打开维护面板），等核定上限行载入。 */
async function openMaintenance() {
  const { wrapper } = mountHedgeTab(HedgeMaintenanceTab)
  await vi.waitFor(() => {
    expect(wrapper.find('[data-test="maintenance"]').exists()).toBe(true)
    expect(wrapper.findAll('button').filter((b) => b.text() === '保存').length).toBeGreaterThan(0)
  })
  return wrapper
}

describe('HedgeMaintenanceTab（HW-10）', () => {
  afterEach(() => {
    putCaps.mockReset()
    putBaselines.mockReset()
  })

  it('维护入口 409 冲突提示刷新（8.6/HW-10）', async () => {
    const wrapper = await openMaintenance()
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
    const wrapper = await openMaintenance()
    putCaps.mockRejectedValue(hedgeApiError(422, 'BAND_TIER_INVALID', '比例不在允许档位', { field: 'capMwh' }))
    const saveButtons = wrapper.findAll('button').filter((b) => b.text() === '保存')
    await saveButtons[0]!.trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="caps-status"]').text()).toContain('422')
      expect(wrapper.find('[data-test="caps-status"]').text()).toContain('字段 capMwh')
    })
  })

  it('维护入口 403 转只读态并说明所需权限（8.6）', async () => {
    const wrapper = await openMaintenance()
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
