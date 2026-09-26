import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { load } = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('./disclosureUnitRoster', async (original) => ({ ...await original<typeof import('./disclosureUnitRoster')>(), loadDisclosureUnitRoster: load }))
import DisclosureUnitRoster from './DisclosureUnitRoster.vue'
import { normalizeUnitRosterRows, type UnitRosterResult } from './disclosureUnitRoster'

function result(plantName = '宣威电厂'): UnitRosterResult {
  const day = (date: string, states = ['必开']) => normalizeUnitRosterRows(states.map(textValue => ({ operateDate: date, regionName: '云南', plantName, unitName: '#1', textValue, sourceFile: '名单.xls' })), { regionId: 'yunnan', dateFrom: date, dateTo: date }).days[0]
  return { status: 'available', reason: '', days: [day('2026-07-01')], baseline: day('2026-06-27', ['必停']), comparisonStatus: 'available', comparisonReason: '', coverage: { start: '2026-06-01', end: '2026-07-01' } }
}
const props = { regionId: 'yunnan', dateFrom: '2026-07-01', dateTo: '2026-07-01', scopeKey: 'yunnan:company-a' }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
beforeEach(() => { vi.resetAllMocks(); load.mockResolvedValue(result()) })

describe('必开必停名单交互', () => {
  it('展示厂、机组、运行要求、真实前一可用日与来源，点击仅发日级记录', async () => {
    const wrapper = mount(DisclosureUnitRoster, { props }); await flushPromises()
    expect(wrapper.text()).toContain('对比上一可用日 2026-06-27')
    expect(wrapper.text()).toContain('状态变化 1')
    expect(wrapper.text()).toContain('名单.xls')
    expect(wrapper.text()).toContain('未提供分时生效区间')
    await wrapper.find('.entry-title').trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ date: '2026-07-01', plantName: '宣威电厂', unitName: '#1', state: '必开', publishedAt: '' })
    expect(wrapper.emitted('loaded')).toHaveLength(1)
    wrapper.unmount()
  })
  it('关键词、状态和变化过滤不发重复请求，缺失日不会自动切换到有数据日', async () => {
    const wrapper = mount(DisclosureUnitRoster, { props: { ...props, dateTo: '2026-07-02' } }); await flushPromises()
    expect(wrapper.text()).toContain('2026-07-02 没有可用名单')
    await wrapper.find('[aria-label="必开必停名单日期"]').setValue('2026-07-01')
    await wrapper.find('[aria-label="必开必停变化筛选"]').setValue('changed')
    expect(wrapper.findAll('.entry-title')).toHaveLength(1)
    await wrapper.find('[aria-label="必开必停状态筛选"]').setValue('必停')
    expect(wrapper.findAll('.entry-title')).toHaveLength(0)
    await wrapper.find('[aria-label="必开必停状态筛选"]').setValue('all')
    await wrapper.find('[aria-label="搜索电厂或机组"]').setValue('不存在')
    expect(wrapper.findAll('.entry-title')).toHaveLength(0)
    expect(load).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('同机组矛盾状态保留双方并标冲突，禁用变化筛选', async () => {
    const data = result()
    const first = data.days[0].entries[0]
    data.days[0].entries.push({ ...first, key: 'second-state', state: '必停' })
    load.mockResolvedValue(data)
    const wrapper = mount(DisclosureUnitRoster, { props }); await flushPromises()
    expect(wrapper.findAll('.entry-title')).toHaveLength(2)
    expect(wrapper.text()).toContain('1 台机组状态冲突')
    expect(wrapper.find('[aria-label="必开必停变化筛选"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toContain('状态变化 1')
    wrapper.unmount()
  })
  it('当日无名单时提供真实最近名单入口，仅点击才发出历史日选择', async () => {
    const data = result()
    data.days = []; data.status = 'missing'
    load.mockResolvedValue(data)
    const wrapper = mount(DisclosureUnitRoster, { props }); await flushPromises()
    expect(wrapper.text()).toContain('2026-07-01 没有可用名单')
    expect(wrapper.find('.latest-roster').text()).toBe('查看最近名单 2026-06-27')
    expect(wrapper.emitted('select')).toBeUndefined()
    expect((wrapper.find('[aria-label="必开必停名单日期"]').element as HTMLSelectElement).value).toBe('2026-07-01')
    await wrapper.find('.latest-roster').trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ date: '2026-06-27', plantName: '宣威电厂', state: '必停' })
    wrapper.unmount()
  })
  it('快速切换地区公司后立即清空旧名单，迟到响应与loaded事件均隔离', async () => {
    const old = deferred<UnitRosterResult>()
    load.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result('新公司电厂'))
    const wrapper = mount(DisclosureUnitRoster, { props })
    await wrapper.setProps({ regionId: 'guizhou', scopeKey: 'guizhou:company-b' }); await flushPromises()
    old.resolve(result('旧公司电厂')); await flushPromises()
    expect(wrapper.text()).toContain('新公司电厂')
    expect(wrapper.text()).not.toContain('旧公司电厂')
    expect(wrapper.emitted('loaded')).toHaveLength(1)
    expect(load.mock.calls[0][1]()).toBe(false)
    wrapper.unmount()
  })
  it('失败清晰显示并可刷新重试，不能保留旧结果装作成功', async () => {
    load.mockRejectedValueOnce(new Error('network'))
    const wrapper = mount(DisclosureUnitRoster, { props }); await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('读取失败')
    expect(wrapper.findAll('.entry-title')).toHaveLength(0)
    await wrapper.find('[aria-label="刷新必开必停名单"]').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('宣威电厂')
    wrapper.unmount()
  })
  it('分页不改变完整当日计数，筛选后回到第一页', async () => {
    const data = result()
    const entry = data.days[0].entries[0]
    data.days[0].entries = Array.from({ length: 24 }, (_, index) => ({ ...entry, key: `unit-${index}`, identity: `identity-${index}`, unitName: `#${index}` }))
    load.mockResolvedValue(data)
    const wrapper = mount(DisclosureUnitRoster, { props }); await flushPromises()
    expect(wrapper.text()).toContain('必开 24 条')
    expect(wrapper.findAll('.entry-title')).toHaveLength(20)
    await wrapper.find('.pagination button:last-child').trigger('click')
    expect(wrapper.findAll('.entry-title')).toHaveLength(4)
    expect(wrapper.text()).toContain('必开 24 条')
    await wrapper.find('[aria-label="搜索电厂或机组"]').setValue('#23')
    expect(wrapper.findAll('.entry-title')).toHaveLength(1)
    expect(wrapper.text()).toContain('第 1/1 页')
    wrapper.unmount()
  })
  it('卸载后不提交迟到结果，已有完整日可在外部历史读取失败时互相比较', async () => {
    const data = result()
    data.days.unshift({ ...data.baseline!, date: '2026-06-27' })
    data.baseline = null; data.comparisonStatus = 'error'; data.comparisonReason = '历史未确认'
    load.mockResolvedValueOnce(data)
    const wrapper = mount(DisclosureUnitRoster, { props: { ...props, dateFrom: '2026-06-27' } }); await flushPromises()
    expect(wrapper.text()).toContain('状态变化 1')
    wrapper.unmount()
    const pending = deferred<UnitRosterResult>(); load.mockReturnValueOnce(pending.promise)
    const unmounted = mount(DisclosureUnitRoster, { props }); unmounted.unmount()
    pending.resolve(result()); await flushPromises()
    expect(unmounted.emitted('loaded')).toBeUndefined()
  })
})
