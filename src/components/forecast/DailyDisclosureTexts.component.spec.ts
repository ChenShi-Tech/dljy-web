import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

const api = vi.hoisted(() => ({ catalog: vi.fn(), page: vi.fn() }))
vi.mock('@/services/forecast/dailyDisclosureRecords', () => ({ loadDisclosureRecordCatalog: api.catalog, loadDisclosureRecordPage: api.page }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('test-company') }))

import { selectedCompanyId as company } from '@/services/company/companyContext'
import DailyDisclosureTexts from './DailyDisclosureTexts.vue'

const datasets = ['maintenance', 'outage', 'intervention'].map((id) => ({ id, title: id + '类', category: id, description: '数据库规范化事件' }))

function event(id = 'maintenance', extra = {}) {
  return {
    eventId: `csg-${id}-1`, providerId: 'csg-authorized-export', category: id,
    title: `${id}设备事件`, summary: '<img src=x onerror=alert(1)>\n真实换行', regionId: 'yunnan',
    spatialBinding: { kind: 'region', ref: 'yunnan', label: '云南省内', coordinates: null },
    effectiveAt: '2026-06-24T16:00:00.000Z', expiresAt: null, publishedAt: '2026-06-24T12:00:00.000Z',
    source: {
      file: '原始.xls', recordId: 'record-1', url: null, sourceTable: 'tb_disclosure_test', sourceType: 'IMPORT',
      mock: false, productionWrite: false, dataAvailability: 'available', license: '仅授权使用', originalLinkStatus: 'unavailable-in-export',
    },
    confidence: 'verified-source-row', importedAt: '2026-07-01T00:00:00.000Z', ...extra,
  }
}

function page(id = 'maintenance', extra = {}) {
  return {
    regionId: 'yunnan', date: '2026-06-25', datasetId: id, title: id, category: id,
    items: [event(id)], total: 41, page: 1, pageSize: 20,
    dataAvailability: { status: 'available', reason: '真实授权导出行', fallback: false, regionRequested: 'yunnan' },
    categories: ['maintenance', 'outage', 'intervention', 'congestion', 'constraint'],
    storage: { sourceType: 'DB', mock: false, productionWrite: false },
    ...extra,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { resolve, promise }
}

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

function button(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find((item) => item.text().includes(text))!
}

beforeEach(() => {
  company.value = 'test-company'
  api.catalog.mockReset().mockResolvedValue({
    regionId: 'yunnan', datasets,
    limitations: ['这里只展示 PostgreSQL 中的规范化事件，不等同于原始 CSV 全字段。'],
  })
  api.page.mockReset().mockImplementation((_region, _date, id) => Promise.resolve(page(id)))
})
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()) })

describe('检修与运行规范化事件区', () => {
  it('类别为空有明确提示，不留空白区域', async () => {
    api.catalog.mockResolvedValueOnce({ regionId: 'yunnan', datasets: [] })
    const wrapper = await render()
    expect(wrapper.text()).toContain('当前没有后端返回的披露事件类别')
    expect(api.page).not.toHaveBeenCalled()
  })

  it('标题、摘要、类别、空间、时间和逐事件溯源可见，HTML 只按文本显示', async () => {
    const wrapper = await render()
    expect(api.page).toHaveBeenCalledTimes(3)
    expect(wrapper.findAll('nav button')).toHaveLength(3)
    expect(wrapper.text()).toContain('maintenance设备事件')
    expect(wrapper.text()).toContain('云南省内')
    expect(wrapper.text()).toContain('tb_disclosure_test')
    expect(wrapper.text()).toContain('原始.xls')
    expect(wrapper.text()).toContain('record-1')
    expect(wrapper.text()).toContain('PostgreSQL 中的规范化事件')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.findAll('details')).toHaveLength(2)
  })

  it('分页和搜索传正确条件，切类别清空关键词', async () => {
    const wrapper = await render()
    await button(wrapper, '下一页').trigger('click')
    await flushPromises()
    expect(api.page).toHaveBeenLastCalledWith('yunnan', '2026-06-25', 'maintenance', { page: 2, keyword: '' }, expect.any(Object))
    await wrapper.find('input').setValue('机组')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(api.page).toHaveBeenLastCalledWith('yunnan', '2026-06-25', 'maintenance', { page: 1, keyword: '机组' }, expect.any(Object))
    await button(wrapper, 'outage类').trigger('click')
    await flushPromises()
    expect(api.page).toHaveBeenLastCalledWith('yunnan', '2026-06-25', 'outage', { page: 1, keyword: '' }, expect.any(Object))
  })

  it('当日为空不生成事件卡；单类失败不影响其他类', async () => {
    api.page.mockImplementation((_r, _d, id) => id === 'intervention'
      ? Promise.reject(new Error('读取失败测试'))
      : Promise.resolve(page(id, { items: [], total: 0, dataAvailability: { status: 'missing', reason: '当日云南无事件', fallback: false, regionRequested: 'yunnan' } })))
    const wrapper = await render()
    expect(wrapper.text()).toContain('当日云南无事件')
    expect(wrapper.findAll('article')).toHaveLength(0)
    await button(wrapper, 'intervention类').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('读取失败测试')
    expect(wrapper.text()).not.toContain('当日云南无事件')
  })

  it('认证或类别读取失败保留真实错误，刷新可重试', async () => {
    api.catalog.mockRejectedValueOnce(new Error('登录失效'))
    const wrapper = await render()
    expect(wrapper.text()).toContain('登录失效')
    expect(api.page).not.toHaveBeenCalled()
    await button(wrapper, '刷新事件').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('maintenance设备事件')
  })

  it('并发最多 2 路，换日取消旧批次；A→B→A 的旧结果不能覆盖', async () => {
    const old = deferred<ReturnType<typeof page>>()
    api.page.mockReturnValue(old.promise)
    const wrapper = await render()
    expect(api.page).toHaveBeenCalledTimes(2)
    api.page.mockImplementation((_r, _d, id) => Promise.resolve(page(id, { items: [event(id, { title: '最新设备事件' })] })))
    await wrapper.setProps({ date: '2026-06-26' })
    await flushPromises()
    await wrapper.setProps({ date: '2026-06-25' })
    await flushPromises()
    old.resolve(page('maintenance', { items: [event('maintenance', { title: '过期设备事件' })] }))
    await flushPromises()
    expect(wrapper.text()).toContain('最新设备事件')
    expect(wrapper.text()).not.toContain('过期设备事件')
  })

  it('切公司清空旧事件，非云南或无日期不发请求', async () => {
    const wrapper = await render()
    const calls = api.catalog.mock.calls.length
    company.value = 'company-b'
    await flushPromises()
    expect(api.catalog).toHaveBeenCalledTimes(calls + 1)
    await wrapper.setProps({ regionId: 'guangdong' })
    await flushPromises()
    expect(wrapper.findAll('article')).toHaveLength(0)
    expect(api.catalog).toHaveBeenCalledTimes(calls + 1)
    await wrapper.setProps({ regionId: 'yunnan', date: '' })
    await flushPromises()
    expect(api.catalog).toHaveBeenCalledTimes(calls + 1)
  })

  it('搜索失败清掉旧事件，不把旧数据贴到新条件下', async () => {
    const wrapper = await render()
    api.page.mockRejectedValueOnce(new Error('本次搜索失败'))
    await wrapper.find('input').setValue('不存在')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('本次搜索失败')
    expect(wrapper.findAll('article')).toHaveLength(0)
  })
})
