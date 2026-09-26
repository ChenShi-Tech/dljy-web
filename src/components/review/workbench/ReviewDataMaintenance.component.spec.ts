import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewDataMaintenance from './ReviewDataMaintenance.vue'
const api = vi.hoisted(() => ({ fetchUploadContracts: vi.fn(), fetchUploadBatches: vi.fn(), readLocalFile: vi.fn(), precheckUpload: vi.fn(), commitUpload: vi.fn() }))
vi.mock('@/services/data/uploadClient', () => api)
const contract = { dataset: 'private-series', region: 'yunnan', review: { purpose: '厂站时段资料', canWrite: true } }
const report = { ok: true, canCommit: true, rows: { total: 2, valid: 2, invalid: 0 }, header: { missingRequired: [] }, keyDupes: { count: 0 }, overlap: { window: { from: '2026-05-01', to: '2026-05-31' } } }
beforeEach(() => {
  vi.resetAllMocks()
  api.fetchUploadContracts.mockResolvedValue([contract])
  api.fetchUploadBatches.mockResolvedValue([])
  api.readLocalFile.mockResolvedValue({ fileName: '原始资料.csv', content: 'data', isBinary: false })
  api.precheckUpload.mockResolvedValue(report)
  api.commitUpload.mockResolvedValue({ code: 200 })
})
async function openAndCheck() {
  const wrapper = mount(ReviewDataMaintenance, { props: { companyId: 'child', companyLabel: '子公司', region: 'yunnan' } })
  await flushPromises()
  const input = wrapper.get('input[type=file]')
  Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['data'], '原始资料.csv')] })
  await input.trigger('change')
  await wrapper.findAll('button').find(button => button.text() === '预检文件')!.trigger('click')
  await flushPromises()
  return wrapper
}
describe('交易员共用统一资料维护', () => {
  it('分时资料提交带预检版本，改口径后预检作废', async () => {
    api.fetchUploadContracts.mockResolvedValue([{ ...contract, dataset: 'review-intervals', kind: 'review-intervals' }])
    api.precheckUpload.mockResolvedValue({ ...report, expectedToken: 'version-one' })
    const wrapper = await openAndCheck()
    await wrapper.get('input[type=checkbox]').setValue(true)
    await wrapper.findAll('button').find(button => button.text() === '确认导入')!.trigger('click'); await flushPromises()
    expect(api.commitUpload).toHaveBeenCalledWith(expect.objectContaining({ expectedToken: 'version-one', confirmed: true, review: expect.objectContaining({ view: 'generator', simulated: false }) }), { companyId: 'child', region: 'yunnan' })
    wrapper.unmount()
    const another = await openAndCheck()
    await another.get('input[placeholder="例如：日前申报电量"]').setValue('预测电量')
    expect(another.find('[aria-label="导入预检"]').exists()).toBe(false)
    another.unmount()
  })
  it('预检不提交，确认后用同一个公司和文件导入并读取同公司批次', async () => {
    const wrapper = await openAndCheck()
    const button = wrapper.findAll('button').find(item => item.text() === '确认导入')!
    expect(button.attributes('disabled')).toBeDefined()
    expect(api.commitUpload).not.toHaveBeenCalled()
    await wrapper.get('input[type=checkbox]').setValue(true)
    await button.trigger('click'); await flushPromises()
    expect(api.commitUpload).toHaveBeenCalledWith({ dataset: 'private-series', fileName: '原始资料.csv', content: 'data', isBinary: false, region: 'yunnan' }, { companyId: 'child', region: 'yunnan' })
    expect(api.fetchUploadBatches).toHaveBeenLastCalledWith('private-series', { companyId: 'child', region: 'yunnan' })
    expect(wrapper.text()).toContain('资料已导入')
    expect(wrapper.text()).not.toContain('private-series')
  })
  it('更换文件后原预检和确认失效', async () => {
    const wrapper = await openAndCheck()
    await wrapper.get('input[type=checkbox]').setValue(true)
    await wrapper.get('input[type=file]').trigger('change')
    expect(wrapper.find('[aria-label="导入预检"]').exists()).toBe(false)
    expect(api.commitUpload).not.toHaveBeenCalled()
  })
  it('只读授权可以预检但没有提交入口', async () => {
    api.fetchUploadContracts.mockResolvedValue([{ ...contract, review: { ...contract.review, canWrite: false } }])
    const wrapper = await openAndCheck()
    expect(wrapper.find('input[type=checkbox]').exists()).toBe(false)
    expect(wrapper.text()).toContain('没有提交权限')
  })
  it('切换公司后旧预检不能成为新公司的可提交材料', async () => {
    let resolve!: (value: typeof report) => void
    api.precheckUpload.mockImplementation(() => new Promise(done => { resolve = done }))
    const wrapper = await openAndCheck()
    await wrapper.setProps({ companyId: 'another', companyLabel: '另一公司' })
    await flushPromises(); resolve(report); await flushPromises()
    expect(wrapper.find('[aria-label="导入预检"]').exists()).toBe(false)
    expect(api.commitUpload).not.toHaveBeenCalled()
    expect(wrapper.get('select').findAll('option')).toHaveLength(1)
    expect(api.fetchUploadContracts).toHaveBeenLastCalledWith({ companyId: 'another', region: 'yunnan' })
  })
})
