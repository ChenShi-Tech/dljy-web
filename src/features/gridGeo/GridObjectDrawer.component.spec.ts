// Object detail must keep scope, source identity and annotation conflict drafts. dljy#2897.
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routeLocationKey, routerKey } from 'vue-router'
import GridObjectDrawer from './GridObjectDrawer.vue'
import type { GridObjectDetail, GridObjectReference } from './objectNavigation'

const state = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  class ApiError extends Error { constructor(public status: number) { super('conflict') } }
  return { region: ref({ id: 'yunnan', name: '云南' }), company: ref('company-a'), detail: vi.fn(), manifest: vi.fn(), save: vi.fn(), ApiError }
})
vi.mock('@/services/region/regionContext', () => ({ currentRegion: state.region }))
vi.mock('@/services/company/companyContext', () => ({ selectedCompanyId: state.company }))
vi.mock('@/services/api', () => ({ ApiError: state.ApiError }))
vi.mock('./client', () => ({ fetchGridObject: state.detail, fetchGridGeoManifest: state.manifest, saveGridObjectOverlay: state.save }))

function reference(id: string): GridObjectReference { return { kind: 'node', id, regionId: 'yunnan' } }
function detail(id: string): GridObjectDetail {
  return { reference: reference(id), name: `节点 ${id}`, objectType: '节点', capacityMw: null, voltageLevelKv: 220, stationName: '站 A', location: { label: '云南', longitude: null, latitude: null, status: 'unresolved' }, relations: { plants: [], nodes: [] }, disclosureFilter: { objectKind: 'node', objectId: id }, overlays: [], source: { label: '受管资产', updatedAt: null, evidence: [] } }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function panel() { return mount(GridObjectDrawer, { props: { modelValue: true, object: reference('a'), date: '2026-07-01' }, global: { stubs: { 'el-drawer': { template: '<div><slot /></div>' } } } }) }
beforeEach(() => { vi.resetAllMocks(); state.region.value = { id: 'yunnan', name: '云南' }; state.company.value = 'company-a'; state.detail.mockImplementation(async (ref: GridObjectReference) => detail(ref.id)); state.manifest.mockResolvedValue({ capabilities: { canWrite: false } }) })

describe('统一对象详情', () => {
  it('主动选择历史日期后，相关披露继承该日并丢弃原日期的时窗', async () => {
    const push = vi.fn()
    const wrapper = mount(GridObjectDrawer, {
      props: { modelValue: true, object: reference('a'), date: '2026-09-15', from: '2026-09-15T10:00:00+08:00', to: '2026-09-15T11:00:00+08:00' },
      global: {
        stubs: { 'el-drawer': { template: '<div><slot /></div>' } },
        provide: { [routerKey as symbol]: { push }, [routeLocationKey as symbol]: { fullPath: '/grid-assets/command', query: {} } },
      },
    })
    try {
      await flushPromises()
      await wrapper.get('[aria-label="对象业务日期"]').setValue('2026-05-01')
      await wrapper.findAll('button').find(button => button.text().startsWith('相关披露'))!.trigger('click')
      expect(push).toHaveBeenCalledWith({ path: '/grid-assets/disclosures', query: {
        objectKind: 'node', objectId: 'a', objectRegion: 'yunnan', objectCompany: 'company-a', objectDate: '2026-05-01', returnTo: '/grid-assets/command',
      } })
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
    } finally { wrapper.unmount() }
  })

  it('缺容量与坐标不补零，真实零值仍可展示；无映射不激活气象', async () => {
    const wrapper = panel(); await flushPromises()
    expect(wrapper.text()).toContain('容量未提供'); expect(wrapper.text()).toContain('未定位')
    expect(wrapper.findAll('button').find(button => button.text().startsWith('气象'))?.attributes('disabled')).toBeDefined()
    state.detail.mockResolvedValue({ ...detail('b'), capacityMw: 0 })
    await wrapper.setProps({ object: reference('b') }); await flushPromises()
    expect(wrapper.text()).toContain('0 MW'); wrapper.unmount()
  })
  it('迟到的旧对象响应不能覆盖新对象', async () => {
    const old = deferred<GridObjectDetail>(); state.detail.mockImplementationOnce(() => old.promise)
    const wrapper = panel(); await wrapper.setProps({ object: reference('b') }); await flushPromises()
    old.resolve(detail('a')); await flushPromises()
    expect(wrapper.find('h2').text()).toBe('节点 b'); wrapper.unmount()
  })
  it('跨公司后关闭详情并隔离未完成请求', async () => {
    const old = deferred<GridObjectDetail>(); state.detail.mockImplementationOnce(() => old.promise)
    const wrapper = panel(); state.company.value = 'company-b'; await flushPromises(); old.resolve(detail('a')); await flushPromises()
    expect(wrapper.find('h2').exists()).toBe(false); expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false]); wrapper.unmount()
  })
  it('公司笔记权限未知时保持只读，个人笔记按既有版本保存', async () => {
    state.detail.mockResolvedValue({ ...detail('a'), overlays: [{ eventId: 'object-a', scope: 'user', version: 4, note: '旧稿', favorite: false, tags: [] }] })
    state.save.mockResolvedValue({ eventId: 'object-a', scope: 'user', version: 5, note: '新稿', favorite: false, tags: [] })
    const wrapper = panel(); await flushPromises(); await wrapper.findAll('[role=tab]')[2].trigger('click')
    await wrapper.find('select').setValue('company'); expect(wrapper.find('textarea').attributes('disabled')).toBeDefined()
    await wrapper.find('select').setValue('user'); await wrapper.find('textarea').setValue('新稿')
    await wrapper.findAll('button').find(button => button.text() === '保存笔记')!.trigger('click'); await flushPromises()
    expect(state.save).toHaveBeenCalledWith(reference('a'), expect.objectContaining({ scope: 'user', expectedVersion: 4, note: '新稿' })); wrapper.unmount()
  })
  it('409保留草稿与最新版本比较，未经核对不能重写', async () => {
    state.save.mockRejectedValue(new state.ApiError(409))
    const wrapper = panel(); await flushPromises(); await wrapper.findAll('[role=tab]')[2].trigger('click'); await wrapper.find('textarea').setValue('待合并草稿')
    state.detail.mockResolvedValue({ ...detail('a'), overlays: [{ eventId: 'object-a', scope: 'user', version: 2, note: '同事已改', favorite: false, tags: [] }] })
    await wrapper.findAll('button').find(button => button.text() === '保存笔记')!.trigger('click'); await flushPromises()
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('待合并草稿'); expect(wrapper.text()).toContain('同事已改')
    expect(wrapper.findAll('button').find(button => button.text() === '保存笔记')!.attributes('disabled')).toBeDefined(); expect(state.save).toHaveBeenCalledTimes(1); wrapper.unmount()
  })
  it('409最新读取失败时不能把旧笔记当最新，重试成功并核对后才使用新版本保存草稿', async () => {
    state.detail.mockResolvedValue({ ...detail('a'), overlays: [{ eventId: 'object-a', scope: 'user', version: 4, note: '旧版本笔记', favorite: false, tags: [] }] })
    const wrapper = panel(); await flushPromises(); await wrapper.findAll('[role=tab]')[2].trigger('click')
    await wrapper.find('textarea').setValue('需要保留的草稿')
    state.save.mockRejectedValueOnce(new state.ApiError(409))
    state.detail.mockRejectedValueOnce(new Error('network unavailable'))
    const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label)!
    await button('保存笔记').trigger('click'); await flushPromises()
    expect(wrapper.get('.conflict').text()).toContain('最新笔记尚未读取成功')
    expect(wrapper.get('.conflict').text()).not.toContain('旧版本笔记')
    expect(wrapper.find('.conflict pre').exists()).toBe(false)
    expect(button('采用最新版本').attributes('disabled')).toBeDefined()
    expect(button('已核对，保留当前草稿').attributes('disabled')).toBeDefined()
    expect(button('保存笔记').attributes('disabled')).toBeDefined()
    await button('采用最新版本').trigger('click')
    await button('已核对，保留当前草稿').trigger('click')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('需要保留的草稿')
    expect(state.save).toHaveBeenCalledTimes(1)
    const latest = deferred<GridObjectDetail>()
    state.detail.mockReturnValueOnce(latest.promise)
    await button('重试读取最新版本').trigger('click')
    expect(wrapper.get('[aria-label="笔记范围"]').attributes('disabled')).toBeDefined()
    expect(button('采用最新版本').attributes('disabled')).toBeDefined()
    latest.resolve({ ...detail('a'), overlays: [{ eventId: 'object-a', scope: 'user', version: 7, note: '服务器最新笔记', favorite: false, tags: [], updatedBy: 'test-user', updatedAt: '2026-09-14T10:00:00+08:00' }] })
    await flushPromises()
    expect(wrapper.get('.conflict').text()).toContain('最新笔记 · v7')
    expect(wrapper.get('.conflict pre').text()).toBe('服务器最新笔记')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('需要保留的草稿')
    expect(button('保存笔记').attributes('disabled')).toBeDefined()
    expect(button('已核对，保留当前草稿').attributes('disabled')).toBeUndefined()
    await button('已核对，保留当前草稿').trigger('click')
    state.save.mockResolvedValueOnce({ eventId: 'object-a', scope: 'user', version: 8, note: '需要保留的草稿', favorite: false, tags: [] })
    await button('保存笔记').trigger('click'); await flushPromises()
    expect(state.save).toHaveBeenLastCalledWith(reference('a'), expect.objectContaining({ note: '需要保留的草稿', expectedVersion: 7 }))
    expect(state.save).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('笔记已保存')
    wrapper.unmount()
  })
  it('保存请求尚未结束时禁止切换个人或公司笔记范围', async () => {
    state.manifest.mockResolvedValue({ capabilities: { canWrite: true } })
    const pending = deferred<{ eventId: string; scope: 'user'; version: number; note: string; favorite: boolean; tags: string[] }>()
    state.save.mockReturnValueOnce(pending.promise)
    const wrapper = panel(); await flushPromises(); await wrapper.findAll('[role=tab]')[2].trigger('click')
    await wrapper.find('textarea').setValue('个人草稿')
    await wrapper.findAll('button').find(button => button.text() === '保存笔记')!.trigger('click')
    expect(wrapper.get('[aria-label="笔记范围"]').attributes('disabled')).toBeDefined()
    expect((wrapper.get('[aria-label="笔记范围"]').element as HTMLSelectElement).value).toBe('user')
    expect(state.save).toHaveBeenCalledWith(reference('a'), expect.objectContaining({ scope: 'user', note: '个人草稿' }))
    pending.resolve({ eventId: 'object-a', scope: 'user', version: 1, note: '个人草稿', favorite: false, tags: [] })
    await flushPromises()
    expect(wrapper.get('[aria-label="笔记范围"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[aria-label="笔记范围"]').setValue('company')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
    expect(state.save).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('重读冲突版本返回错误对象时保持草稿，不能解锁覆盖', async () => {
    state.save.mockRejectedValue(new state.ApiError(409))
    const wrapper = panel(); await flushPromises(); await wrapper.findAll('[role=tab]')[2].trigger('click')
    await wrapper.find('textarea').setValue('对象A的草稿')
    state.detail.mockResolvedValueOnce({ ...detail('b'), overlays: [{ eventId: 'object-b', scope: 'user', version: 20, note: '错误对象笔记', favorite: false, tags: [] }] })
    await wrapper.findAll('button').find(button => button.text() === '保存笔记')!.trigger('click'); await flushPromises()
    expect(wrapper.text()).not.toContain('错误对象笔记')
    expect(wrapper.text()).toContain('最新版本读取失败')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('对象A的草稿')
    expect(wrapper.findAll('button').find(button => button.text() === '已核对，保留当前草稿')!.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
  it('对象切换后迟到的冲突重读不得覆盖新对象的笔记或解锁状态', async () => {
    state.save.mockRejectedValueOnce(new state.ApiError(409))
    const wrapper = panel(); await flushPromises(); await wrapper.findAll('[role=tab]')[2].trigger('click')
    await wrapper.find('textarea').setValue('A的待核对草稿')
    const pending = deferred<GridObjectDetail>()
    state.detail.mockReturnValueOnce(pending.promise)
    await wrapper.findAll('button').find(button => button.text() === '保存笔记')!.trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('正在读取最新笔记')
    state.detail.mockResolvedValueOnce({ ...detail('b'), overlays: [{ eventId: 'object-b', scope: 'user', version: 3, note: 'B的笔记', favorite: false, tags: [] }] })
    await wrapper.setProps({ object: reference('b') }); await flushPromises()
    pending.resolve({ ...detail('a'), overlays: [{ eventId: 'object-a', scope: 'user', version: 8, note: 'A的迟到笔记', favorite: false, tags: [], updatedBy: 'test-user', updatedAt: '2026-09-14T10:00:00+08:00' }] })
    await flushPromises(); await wrapper.findAll('[role=tab]')[2].trigger('click')
    expect(wrapper.find('h2').text()).toBe('节点 b')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('B的笔记')
    expect(wrapper.find('.conflict').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('A的迟到笔记')
    expect(wrapper.get('[aria-label="笔记范围"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
})
