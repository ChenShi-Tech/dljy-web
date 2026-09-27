import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import DataUploadView from './DataUploadView.vue'
const api = vi.hoisted(() => {
  // 组件按 instanceof 判别 409 冲突（#2898）：mock 工厂须提供与组件同源的类，
  // 测试用它构造 reject 值才能命中视图分支。
  class UploadConflictError extends Error {
    readonly detail: string
    constructor(message: string, detail = message) { super(message); this.name = 'UploadConflictError'; this.detail = detail }
  }
  return {
    fetchUploadContracts: vi.fn(), fetchUploadBatches: vi.fn(), fetchUploadTemplate: vi.fn(), downloadTemplateFile: vi.fn(),
    readLocalFile: vi.fn(), precheckUpload: vi.fn(), commitUpload: vi.fn(), revertUploadBatch: vi.fn(), UploadConflictError
  }
})
vi.mock('@/services/data/uploadClient', () => api)
vi.mock('@/services/company/companyContext', () => ({ selectedCompanyId: ref('subsidiary') }))
vi.mock('@/services/region/regionContext', () => ({ selectedRegionId: ref('yunnan') }))
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn(), success: vi.fn() }, ElMessageBox: { confirm: vi.fn() } }))
const { selectedCompanyId } = await import('@/services/company/companyContext')
const contract = { dataset: 'review-intervals', kind: 'review-intervals', title: '分时资料', regionPolicy: 'choose', region: null, columns: [], key: [] }
const report = { ok: true, canCommit: true, expectedToken: 'version', rows: { total: 1, valid: 1, invalid: 0, errors: [] }, rowErrors: [{ row: 4, message: '实际值不是有效数字' }], header: { colMatch: [], missingRequired: [] }, keyDupes: { count: 0 }, overlap: { count: 1 } }
beforeEach(() => { vi.resetAllMocks(); selectedCompanyId.value = 'subsidiary'; api.fetchUploadContracts.mockResolvedValue([contract]); api.fetchUploadBatches.mockResolvedValue([]); api.readLocalFile.mockResolvedValue({ fileName: '资料.csv', content: '资料', isBinary: false }); api.precheckUpload.mockResolvedValue(report); api.commitUpload.mockResolvedValue({ code: 200 }) })
type Controls = { selectContract: (row: typeof contract) => void; onFileChange: (event: Event) => Promise<void>; runPrecheck: () => Promise<void>; runCommit: () => Promise<void> }
async function open() {
  const wrapper = mount(DataUploadView, { global: { stubs: { ElCard: { template: '<div><slot /><slot name="header" /></div>' }, ElTable: true, ElTableColumn: true, ElDescriptions: true, ElSteps: true, ElStep: true, ElAlert: true, ElForm: { template: '<div><slot /></div>' }, ElFormItem: { template: '<div><slot /></div>' }, ElButton: { template: '<button><slot /></button>' }, ElInput: true, ElResult: true }, directives: { loading: () => {} } } })
  await flushPromises(); const vm = wrapper.vm as unknown as Controls
  vm.selectContract(contract); await flushPromises()
  await vm.onFileChange({ target: { files: [new File(['资料'], '资料.csv')] } } as unknown as Event)
  return { wrapper, vm }
}
it('中央入口的目录、预检、提交和批次均固定所选子公司，显示逐行错误', async () => {
  const { wrapper, vm } = await open(); await vm.runPrecheck(); await flushPromises()
  expect(wrapper.text()).toContain('第 4 行：实际值不是有效数字')
  const scope = { companyId: 'subsidiary', region: 'yunnan' }
  expect(api.fetchUploadContracts).toHaveBeenCalledWith(scope)
  expect(api.precheckUpload).toHaveBeenCalledWith(expect.objectContaining({ dataset: 'review-intervals' }), scope)
  await vm.runCommit(); await flushPromises()
  expect(api.commitUpload).toHaveBeenCalledWith(expect.objectContaining({ expectedToken: 'version', confirmed: true }), scope)
  expect(api.fetchUploadBatches).toHaveBeenLastCalledWith(undefined, scope)
  wrapper.unmount()
})
it('切换公司后迟到的预检不能恢复提交能力', async () => {
  const { wrapper, vm } = await open(); let resolve!: (value: typeof report) => void
  api.precheckUpload.mockImplementation(() => new Promise(done => { resolve = done }))
  const pending = vm.runPrecheck(); selectedCompanyId.value = 'other'; await flushPromises()
  resolve(report); await pending; await vm.runCommit(); await flushPromises()
  expect(api.commitUpload).not.toHaveBeenCalled()
  expect(api.fetchUploadContracts).toHaveBeenLastCalledWith({ companyId: 'other', region: 'yunnan' })
  wrapper.unmount()
})
// 落库 409 冲突单独成档（#2890/#2898）：冲突不是格式错误，两份数据都合法需人核对——
// 必须保留服务端换行明细、给出三条出路，且不走「落库请求失败」通用 toast。
it('落库 409 冲突单独成档：多行明细原文展示 + 三条出路，不弹通用落库失败', async () => {
  const { wrapper, vm } = await open()
  api.commitUpload.mockRejectedValue(new api.UploadConflictError(
    '2026-07-01|da: 与库内已有数据冲突（该日维表命中 2 行中 2 行已存在，其中 1 行价格不同）。\n  改价明细（库内值 vs 来件值）：\n    昆明北 @ 2026-07-01 00:00：库内 352.4，来件 999.9'
  ))
  await vm.runPrecheck(); await flushPromises()
  await vm.runCommit(); await flushPromises()
  expect(wrapper.text()).toContain('落库冲突')
  expect(wrapper.text()).toContain('昆明北 @ 2026-07-01 00:00：库内 352.4，来件 999.9')
  expect(wrapper.text()).toContain('联系运维走 owner 通道')
  expect(wrapper.text()).toContain('剔除冲突行')
  const detailText = (wrapper.find('.conflict-detail').element as HTMLElement).textContent ?? ''
  expect(detailText).toContain('改价明细（库内值 vs 来件值）：\n    昆明北')
  const { ElMessage } = await import('element-plus')
  expect(ElMessage.error).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('非冲突的落库错误仍走通用错误提示，不误渲染冲突档', async () => {
  const { wrapper, vm } = await open()
  api.commitUpload.mockRejectedValue(new Error('网络中断'))
  await vm.runPrecheck(); await flushPromises()
  await vm.runCommit(); await flushPromises()
  expect(wrapper.text()).not.toContain('落库冲突')
  const { ElMessage } = await import('element-plus')
  expect(ElMessage.error).toHaveBeenCalledWith(expect.stringContaining('落库请求失败'))
  wrapper.unmount()
})
