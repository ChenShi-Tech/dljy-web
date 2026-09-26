// 合同调整独立页（建议路由 /zcqjy/adjustments，dljy#3014，MA-01..05）。
// 守什么：adjustments 能力关闭显示未开放、不请求列表；筛选（状态/类型/只看方向待核对）进服务端查询；
//        登记入口先取已核验确认合同作候选；点行打开详情抽屉；切换公司清空列表并关闭抽屉/对话框。
// 坏掉的症状：能力未开放时页面空报错；待核对筛选在前端过滤一页导致静默漏掉；换公司后显示上一家公司的调整。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongCapabilities } from '@/services/midlong/midlongTypes'

const hoisted = vi.hoisted(() => ({
  fetchCapabilities: vi.fn(), fetchAdjustments: vi.fn(), fetchContracts: vi.fn(), replace: vi.fn(),
  routeQuery: {} as Record<string, string>, companyRef: null as null | { value: string },
}))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: hoisted.routeQuery }), useRouter: () => ({ replace: hoisted.replace }) }))
vi.mock('@/services/company/companyContext', async () => {
  const selectedCompanyId = (await import('vue')).ref('comp-a')
  hoisted.companyRef = selectedCompanyId
  return { selectedCompanyId }
})
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))
vi.mock('@/services/midlong/midlongApi', () => ({
  CompanyNotSelectedError: class extends Error {},
  fetchCapabilities: hoisted.fetchCapabilities, fetchContracts: hoisted.fetchContracts,
  midlongFailureOf: (e: unknown) => ({ status: 500, errorCode: 'STORAGE_UNAVAILABLE', message: (e as Error).message, details: null }),
}))
vi.mock('@/services/midlong/midlongP4Api', () => ({
  fetchAdjustments: hoisted.fetchAdjustments,
  p4ModuleOn: (caps: { enabled?: boolean; regionSupported?: boolean; modules?: Record<string, boolean> } | null | undefined, name: string) =>
    Boolean(caps?.enabled && caps.regionSupported && caps?.modules?.[name] === true),
}))

import MidlongAdjustmentsView from './MidlongAdjustmentsView.vue'

const STUBS = {
  CompanyScopeBar: { template: '<div />' },
  AdjustmentFormDialog: { props: ['modelValue', 'contractId'], template: '<div class="stub-adj-form" :data-open="String(modelValue)" :data-contract="contractId" />' },
  AdjustmentDetailDrawer: { props: ['modelValue', 'adjustmentId'], template: '<div class="stub-adj-drawer" :data-id="adjustmentId" :data-open="String(modelValue)" />' },
  AdjustmentMappingDialog: { props: ['modelValue'], template: '<div class="stub-adj-mapping" :data-open="String(modelValue)" />' },
  'router-link': { template: '<a><slot /></a>' },
}

const caps = (adjustments: boolean): MidlongCapabilities => ({
  enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1',
  modules: { contracts: true, positions: true, imports: true, plans: true, execution: true, adjustments },
  canWrite: true, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null,
} as unknown as MidlongCapabilities)

const row = (id: number, overrides: Record<string, unknown> = {}) => ({
  id, companyId: 'comp-a', regionId: 'yunnan', contractId: 7, contractNo: 'M-7', contractName: '月度合同', subjectId: 1, subjectName: '云南中广核一号',
  sourceNamespace: '昆明交易中心', externalAdjustmentNo: `T-2026-${id}`, externalRevisionNo: 1, status: 'DRAFT', currentRevisionNo: 1, rowVersion: 1,
  adjustmentType: 'TRANSFER', direction: 'OBLIGATION_DECREASE', directionSource: 'DOCUMENT_FIELD', pendingReason: null, baseRevisionNo: 3,
  totalQuantity: '200', prices: {}, effective: null, createdAt: '', createdBy: null, updatedAt: '', ...overrides,
})
const page = (rows: unknown[], total = rows.length) => ({ rows, total, page: 1, pageSize: 50 })

afterEach(() => {
  vi.clearAllMocks()
  hoisted.routeQuery = {}
  if (hoisted.companyRef) hoisted.companyRef.value = 'comp-a'
})
enableAutoUnmount(afterEach)

describe('合同调整页', () => {
  it('adjustments 能力关闭：显示未开放且不请求列表；打开时列表与筛选正常', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps(false))
    const closed = mount(MidlongAdjustmentsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(closed.text()).toContain('合同调整功能尚未开放')
    expect(hoisted.fetchAdjustments).not.toHaveBeenCalled()

    hoisted.fetchCapabilities.mockResolvedValue(caps(true))
    hoisted.fetchAdjustments.mockResolvedValue(page([row(31), row(32, { status: 'PENDING_VERIFICATION', direction: null, pendingReason: 'NO_DIRECTION' })]))
    const w = mount(MidlongAdjustmentsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchAdjustments).toHaveBeenCalledWith({ page: 1, pageSize: 50, status: undefined, adjustmentType: undefined, pendingDirection: undefined })
    expect(w.text()).toContain('待生效')
    expect(w.text()).toContain('待核对（方向未确认）')
    expect(w.text()).toContain('方向待核对')
    expect(w.text()).toContain('昆明交易中心 / T-2026-31 r1')
    // 只看方向待核对：筛选进服务端查询。
    w.findAllComponents({ name: 'ElCheckbox' })[0].vm.$emit('update:modelValue', true)
    w.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()
    expect(hoisted.fetchAdjustments).toHaveBeenLastCalledWith(expect.objectContaining({ pendingDirection: true }))
  })

  it('登记入口先取已核验确认合同作候选；选择后打开表单并带合同 ID', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps(true))
    hoisted.fetchAdjustments.mockResolvedValue(page([]))
    hoisted.fetchContracts.mockResolvedValue(page([{ contractId: 7, contractName: '月度合同', externalContractNo: 'M-7' }]))
    const w = mount(MidlongAdjustmentsView, { global: { stubs: STUBS } })
    await flushPromises()
    await w.findAll('button').find((b) => b.text() === '登记调整')!.trigger('click')
    await flushPromises()
    expect(hoisted.fetchContracts).toHaveBeenCalledWith(expect.objectContaining({ confirmationStatus: 'CONFIRMED' }))
    // 选择对话框 append-to-body：按标题在 body 下找，下一步以首个候选为默认合同。
    const dialog = [...document.body.querySelectorAll('.el-dialog')].find((d) => d.textContent?.includes('选择要调整的合同')) as HTMLElement
    expect(Boolean(dialog)).toBe(true)
    const next = [...dialog.querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent?.trim() === '下一步') as HTMLButtonElement
    expect(next.disabled).toBe(false)
    next.click()
    await flushPromises()
    expect(w.find('.stub-adj-form').attributes('data-open')).toBe('true')
    expect(w.find('.stub-adj-form').attributes('data-contract')).toBe('7')
  })

  it('点行打开详情抽屉；映射登记入口可打开；切换公司清空列表并关闭抽屉', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps(true))
    hoisted.fetchAdjustments.mockResolvedValueOnce(page([row(31)])).mockImplementation(() => new Promise(() => {}))
    const w = mount(MidlongAdjustmentsView, { global: { stubs: STUBS } })
    await flushPromises()
    await w.findAll('.el-table__row').find((r) => r.text().includes('T-2026-31'))!.trigger('click')
    expect(w.find('.stub-adj-drawer').attributes('data-id')).toBe('31')
    expect(w.find('.stub-adj-drawer').attributes('data-open')).toBe('true')
    await w.findAll('button').find((b) => b.text() === '产品映射登记')!.trigger('click')
    expect(w.find('.stub-adj-mapping').attributes('data-open')).toBe('true')

    hoisted.companyRef!.value = 'comp-b'
    await flushPromises()
    expect(w.find('.stub-adj-drawer').attributes('data-open')).toBe('false')
    expect(w.find('.stub-adj-mapping').attributes('data-open')).toBe('false')
    expect(w.text()).not.toContain('T-2026-31')
  })
})
