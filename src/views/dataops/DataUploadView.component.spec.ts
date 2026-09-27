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
// 公共落点提交置灰（#2898 验收③）按登录角色分档：默认 ADMIN（与真实默认演示账号一致，
// 既有用例不受置灰影响），公共落点用例里换成公司级角色。
const auth = vi.hoisted(() => ({ getCurrentUser: vi.fn(() => ({ roleCode: 'ADMIN' })) }))
vi.mock('@/services/auth', () => auth)
vi.mock('@/services/company/companyContext', () => ({ selectedCompanyId: ref('subsidiary') }))
vi.mock('@/services/region/regionContext', () => ({ selectedRegionId: ref('yunnan') }))
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn(), success: vi.fn() }, ElMessageBox: { confirm: vi.fn() } }))
const { selectedCompanyId } = await import('@/services/company/companyContext')
type ContractRow = { dataset: string; kind: string; title: string; regionPolicy: string; region: string | null; columns: never[]; key: never[] }
const contract: ContractRow = { dataset: 'review-intervals', kind: 'review-intervals', title: '分时资料', regionPolicy: 'choose', region: null, columns: [], key: [] }
// 公共落点模板（yn-t0-node-price）：直落数据库类、地区固定（与真实契约同形）。
const publicGridContract: ContractRow = { ...contract, dataset: 'yn-t0-node-price', kind: 'capture-family', title: '节点电价', regionPolicy: 'fixed', region: 'yunnan' }
const report = { ok: true, canCommit: true, expectedToken: 'version', rows: { total: 1, valid: 1, invalid: 0, errors: [] }, rowErrors: [{ row: 4, message: '实际值不是有效数字' }], header: { colMatch: [], missingRequired: [] }, keyDupes: { count: 0 }, overlap: { count: 1 } }
beforeEach(() => { vi.resetAllMocks(); auth.getCurrentUser.mockReturnValue({ roleCode: 'ADMIN' }); selectedCompanyId.value = 'subsidiary'; api.fetchUploadContracts.mockResolvedValue([contract]); api.fetchUploadBatches.mockResolvedValue([]); api.readLocalFile.mockResolvedValue({ fileName: '资料.csv', content: '资料', isBinary: false }); api.precheckUpload.mockResolvedValue(report); api.commitUpload.mockResolvedValue({ code: 200 }) })
type Controls = { selectContract: (row: ContractRow) => void; onFileChange: (event: Event) => Promise<void>; runPrecheck: () => Promise<void>; runCommit: () => Promise<void>; backToUpload: () => void }
async function open(contractRow: ContractRow = contract) {
  const wrapper = mount(DataUploadView, { global: { stubs: { ElCard: { template: '<div><slot /><slot name="header" /></div>' }, ElTable: true, ElTableColumn: true, ElDescriptions: true, ElSteps: true, ElStep: true, ElAlert: { template: '<div class="stub-alert"><slot /></div>' }, ElForm: { template: '<div><slot /></div>' }, ElFormItem: { template: '<div><slot /></div>' }, ElButton: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' }, ElInput: true, ElResult: true }, directives: { loading: () => {} } } })
  await flushPromises(); const vm = wrapper.vm as unknown as Controls
  vm.selectContract(contractRow); await flushPromises()
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
// 冲突后不得残留预检成功态（review #193 R1-01）：409 切到独立冲突步骤后，「预检通过，
// 可确认落库」卡片与「确认落库」按钮都要消失（report 已清，重复提交连 guard 都过不去）；
// 返回修改重新预检后恢复可提交。
it('落库 409 后预检成功卡片消失、确认落库不可再提交；重新预检后恢复', async () => {
  const { wrapper, vm } = await open()
  api.commitUpload.mockRejectedValueOnce(new api.UploadConflictError('2026-07-01|da: 与库内已有数据冲突'))
  await vm.runPrecheck(); await flushPromises()
  // 预检成功态在场：预检报告卡片与可点的「确认落库」按钮
  expect(wrapper.text()).toContain('预检报告')
  expect(wrapper.findAll('button').find((b) => b.text() === '确认落库')?.attributes('disabled')).toBeUndefined()
  await vm.runCommit(); await flushPromises()
  // 冲突档出现，预检成功卡片（连同「确认落库」按钮）不再渲染
  expect(wrapper.text()).toContain('落库冲突')
  expect(wrapper.text()).not.toContain('预检报告')
  expect(wrapper.findAll('button').find((b) => b.text() === '确认落库')).toBeUndefined()
  // 同一批次不可重复提交（guard 层也被 report 已清拦住）
  await vm.runCommit(); await flushPromises()
  expect(api.commitUpload).toHaveBeenCalledTimes(1)
  // 返回修改（文件保留）→ 重新预检 → 恢复正常提交入口
  vm.backToUpload(); await flushPromises()
  expect(wrapper.text()).not.toContain('落库冲突')
  await vm.runPrecheck(); await flushPromises()
  expect(wrapper.text()).toContain('预检报告')
  const btn = wrapper.findAll('button').find((b) => b.text() === '确认落库')
  expect(btn?.attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})
// 公共落点提交置灰（#2898 验收③）：yn-t0-node-price 写平台公共表，后端仅 ADMIN 可提交。
// 非 ADMIN：预检请求正常发出（预检不禁）、上传步与预检报告页有明确提示、「确认落库」
// 置灰且 guard 拦截；ADMIN：不受限、可提交。
it('非 ADMIN 对公共落点模板预检可用、确认落库置灰并提示', async () => {
  auth.getCurrentUser.mockReturnValue({ roleCode: 'TRADER' })
  api.fetchUploadContracts.mockResolvedValue([publicGridContract])
  const { wrapper, vm } = await open(publicGridContract)
  const scope = { companyId: 'subsidiary', region: 'yunnan' }
  await vm.runPrecheck(); await flushPromises()
  // 预检不受公共落点置灰影响：请求正常发出、报告正常渲染
  expect(api.precheckUpload).toHaveBeenCalledWith(expect.objectContaining({ dataset: 'yn-t0-node-price' }), scope)
  expect(wrapper.text()).toContain('预检报告')
  // 上传步与预检报告页都有「先预检再交管理员」提示
  expect(wrapper.text()).toContain('公共曲线，仅平台管理员可提交')
  expect(wrapper.text()).toContain('预检不落库，不受影响')
  // 确认落库按钮置灰，guard 拦截提交
  const commitBtn = wrapper.findAll('button').find((b) => b.text() === '确认落库')
  expect(commitBtn?.attributes('disabled')).toBeDefined()
  await vm.runCommit(); await flushPromises()
  expect(api.commitUpload).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('ADMIN 对公共落点模板不受置灰限制，可正常提交', async () => {
  api.fetchUploadContracts.mockResolvedValue([publicGridContract])
  const { wrapper, vm } = await open(publicGridContract)
  await vm.runPrecheck(); await flushPromises()
  expect(wrapper.text()).not.toContain('公共曲线，仅平台管理员可提交')
  const commitBtn = wrapper.findAll('button').find((b) => b.text() === '确认落库')
  expect(commitBtn?.attributes('disabled')).toBeUndefined()
  await vm.runCommit(); await flushPromises()
  expect(api.commitUpload).toHaveBeenCalledWith(expect.objectContaining({ dataset: 'yn-t0-node-price' }), { companyId: 'subsidiary', region: 'yunnan' })
  wrapper.unmount()
})
