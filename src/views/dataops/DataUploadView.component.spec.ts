import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import DataUploadView from './DataUploadView.vue'
const api = vi.hoisted(() => ({ fetchUploadContracts: vi.fn(), fetchUploadBatches: vi.fn(), fetchUploadTemplate: vi.fn(), downloadTemplateFile: vi.fn(), readLocalFile: vi.fn(), precheckUpload: vi.fn(), commitUpload: vi.fn(), revertUploadBatch: vi.fn() }))
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
