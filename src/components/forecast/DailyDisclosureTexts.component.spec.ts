import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
const api = vi.hoisted(() => ({ catalog: vi.fn(), page: vi.fn() }))
vi.mock('@/services/forecast/dailyDisclosureRecords', () => ({ loadDisclosureRecordCatalog: api.catalog, loadDisclosureRecordPage: api.page }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('test-company') }))
import { selectedCompanyId as company } from '@/services/company/companyContext'
import DailyDisclosureTexts from './DailyDisclosureTexts.vue'

const datasets = ['maintenance', 'must_run', 'outage'].map((id) => ({ id, title: id + '类', category: id, description: '原表记录' }))
function page(id = 'maintenance', extra = {}) {
  return { regionId: 'yunnan', date: '2026-06-25', datasetId: id, title: id, category: id,
    columns: ['operate_date', '设备名称', '干预原因', 'source_file'],
    items: [{ operate_date: '2026-06-25', '统计范围': '云南省内', '设备名称': id + '设备', '干预原因': '<img src=x onerror=alert(1)>\n真实换行', source_file: '原始.xls' }],
    total: 41, page: 1, pageSize: 20, scopeCounts: { '云南省内': 41 }, sourceRowCount: 100,
    excludedRegionCount: 2, coverage: { from: '2025-07-01', to: '2026-07-02' },
    dataAvailability: { status: 'available', reason: '', fallback: false },
    source: { sourceTable: 'table', sourceFiles: ['原始.xls'], license: '仅授权使用', originalUrl: null }, ...extra }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { resolve, promise } }
const stubs = {
  ElButton: { props: ['disabled', 'loading', 'nativeType'], emits: ['click'], template: '<button :type="nativeType || \'button\'" :disabled="disabled || loading" @click="$emit(\'click\')"><slot/></button>' },
  ElInput: { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"/>' },
  ElAlert: { props: ['title'], template: '<p role="alert">{{ title }}</p>' },
}
const wrappers: VueWrapper[] = []
async function render(props = { regionId: 'yunnan', date: '2026-06-25' }) {
  const wrapper = mount(DailyDisclosureTexts, { props, global: { stubs } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
function button(wrapper: VueWrapper, text: string) { return wrapper.findAll('button').find((item) => item.text().includes(text))! }
beforeEach(() => {
  company.value = 'test-company'
  api.catalog.mockReset().mockResolvedValue({ regionId: 'yunnan', datasets, limitations: ['必开必停分时出力原表为空，未生成曲线。'] })
  api.page.mockReset().mockImplementation((_region, _date, id) => Promise.resolve(page(id)))
})
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()) })

describe('检修与运行原文区', () => {
  it('目录为空有明确提示，不留空白区域', async () => {
    api.catalog.mockResolvedValueOnce({ regionId: 'yunnan', datasets: [] })
    const wrapper = await render()
    expect(wrapper.text()).toContain('当前没有已接入的文本来源类别')
    expect(api.page).not.toHaveBeenCalled()
  })
  it('来源分类、原字段、覆盖来源可见，HTML原文只按文本显示', async () => {
    const wrapper = await render()
    expect(api.page).toHaveBeenCalledTimes(3)
    expect(wrapper.findAll('nav button')).toHaveLength(3)
    expect(wrapper.text()).toContain('maintenance设备')
    expect(wrapper.text()).toContain('原始.xls')
    expect(wrapper.text()).toContain('必开必停分时出力原表为空')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.findAll('details')).toHaveLength(2)
  })
  it('分页和搜索传正确条件，切类别清空关键词', async () => {
    const wrapper = await render()
    await button(wrapper, '下一页').trigger('click'); await flushPromises()
    expect(api.page).toHaveBeenLastCalledWith('yunnan', '2026-06-25', 'maintenance', { page: 2, keyword: '' }, expect.any(Object))
    await wrapper.find('input').setValue('机组')
    await wrapper.find('form').trigger('submit'); await flushPromises()
    expect(api.page).toHaveBeenLastCalledWith('yunnan', '2026-06-25', 'maintenance', { page: 1, keyword: '机组' }, expect.any(Object))
    await button(wrapper, 'must_run类').trigger('click'); await flushPromises()
    expect(api.page).toHaveBeenLastCalledWith('yunnan', '2026-06-25', 'must_run', { page: 1, keyword: '' }, expect.any(Object))
  })
  it('当日为空不生成记录框；单类失败不影响其他类', async () => {
    api.page.mockImplementation((_r, _d, id) => id === 'outage' ? Promise.reject(new Error('读取失败测试')) : Promise.resolve(page(id, { items: [], total: 0, dataAvailability: { status: 'empty', reason: '当日云南无记录' } })))
    const wrapper = await render()
    expect(wrapper.text()).toContain('当日云南无记录')
    expect(wrapper.findAll('article')).toHaveLength(0)
    await button(wrapper, 'outage类').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('读取失败测试')
    expect(wrapper.text()).not.toContain('当日云南无记录')
  })
  it('认证目录失败保留真实错误，刷新可重试', async () => {
    api.catalog.mockRejectedValueOnce(new Error('登录失效'))
    const wrapper = await render()
    expect(wrapper.text()).toContain('登录失效')
    expect(api.page).not.toHaveBeenCalled()
    await button(wrapper, '刷新文本').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('maintenance设备')
  })
  it('并发最多2路，换日取消旧批次；A→B→A旧结果不能覆盖', async () => {
    const old = deferred<ReturnType<typeof page>>()
    api.page.mockReturnValue(old.promise)
    const wrapper = await render()
    expect(api.page).toHaveBeenCalledTimes(2)
    api.page.mockImplementation((_r, _d, id) => Promise.resolve(page(id, { items: [{ '设备名称': '最新设备' }] })))
    await wrapper.setProps({ date: '2026-06-26' }); await flushPromises()
    await wrapper.setProps({ date: '2026-06-25' }); await flushPromises()
    old.resolve(page('过期')); await flushPromises()
    expect(wrapper.text()).toContain('最新设备')
    expect(wrapper.text()).not.toContain('过期设备')
  })
  it('切公司清空旧原文，非云南/无日期不发请求', async () => {
    const wrapper = await render()
    const calls = api.catalog.mock.calls.length
    company.value = 'company-b'; await flushPromises()
    expect(api.catalog).toHaveBeenCalledTimes(calls + 1)
    await wrapper.setProps({ regionId: 'guangdong' }); await flushPromises()
    expect(wrapper.findAll('article')).toHaveLength(0)
    expect(api.catalog).toHaveBeenCalledTimes(calls + 1)
    await wrapper.setProps({ regionId: 'yunnan', date: '' }); await flushPromises()
    expect(api.catalog).toHaveBeenCalledTimes(calls + 1)
  })
  it('搜索请求失败清掉旧原文，不将旧数据贴在新条件上', async () => {
    const wrapper = await render()
    api.page.mockRejectedValueOnce(new Error('本次搜索失败'))
    await wrapper.find('input').setValue('不存在')
    await wrapper.find('form').trigger('submit'); await flushPromises()
    expect(wrapper.text()).toContain('本次搜索失败')
    expect(wrapper.findAll('article')).toHaveLength(0)
  })
})
