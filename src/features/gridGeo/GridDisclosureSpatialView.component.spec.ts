// 守住交易日/时窗/地区与响应隔离：历史数据不得自动冒充今日，旧结果不得覆盖新上下文。dljy#2897。
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ref } from 'vue'
import GridDisclosureSpatialView from './GridDisclosureSpatialView.vue'
import { currentRegion } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { getDisclosureDeskMetric } from './disclosureDeskData'

const calls = vi.hoisted(() => ({ overview: vi.fn(), events: vi.fn(), groups: vi.fn(), providers: vi.fn(), series: vi.fn(), themeAvailability: vi.fn() }))
vi.mock('./client', () => ({ fetchGridDisclosureOverview: calls.overview, fetchGridDisclosureEvents: calls.events, fetchGridDisclosureGroups: calls.groups, fetchGridDisclosureProviders: calls.providers, fetchGridObject: vi.fn(async () => { throw new Error('对象详情不在本组用例范围') }) }))
vi.mock('@/services/region/regionContext', async () => { const { ref } = await import('vue'); return { currentRegion: ref({ id: 'yunnan', shortName: '云南' }) } })
vi.mock('@/services/company/companyContext', async () => { const { ref } = await import('vue'); return { selectedCompanyId: ref('company-a') } })
vi.mock('@/utils/beijingDate', () => ({ todayBeijing: () => '2026-09-09' }))
vi.mock('./disclosureDeskData', async (original) => ({ ...await original<typeof import('./disclosureDeskData')>(), loadDisclosureDeskSeries: calls.series, loadDisclosureDeskThemeAvailability: calls.themeAvailability }))
vi.mock('./DisclosureEvidencePanel.vue', () => ({ default: { name: 'EvidenceStub', props: ['event', 'scopeKey'], emits: ['favorite-change', 'close'], template: '<div data-testid="evidence-stub">{{ event.title }}</div>' } }))

const chartStub = { name: 'DeskChartStub', props: ['series', 'overview', 'dateFrom', 'dateTo', 'selection', 'eventWindow'], emits: ['select', 'hover', 'event-focus', 'clear'], template: '<div class="desk-chart-wrap" data-testid="chart-stub" />' }
const metricPickerStub = { name: 'MetricPickerStub', props: ['modelValue', 'groups'], emits: ['update:modelValue', 'change'], template: '<div class="metric-picker"><select :value="modelValue" aria-label="主图指标" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\')"><optgroup v-for="group in groups" :key="group.id" :label="group.label"><option v-for="metric in group.metrics" :key="metric.id" :value="metric.id">{{ metric.label }}</option></optgroup></select><span data-testid="metric-picker-icon" aria-hidden="true">⌄</span></div>' }
const categoryCounts = { maintenance: 130, outage: 1, intervention: 0, congestion: 0, constraint: 0 }
const availability = { status: 'available', reason: '测试夹具', fallback: false }
function overview() { return { total: 131, countsByCategory: categoryCounts, dayOnlyCount: 130, dayOnlyCountsByCategory: { ...categoryCounts, outage: 0 }, buckets: [], bucket: 'hour', coverage: { from: '2026-07-01', to: '2026-07-02', total: 131, timeBasis: 'businessDate', publishedTimeKnown: 0, sourceImportedTimeKnown: 131, effectiveTimeKnown: 1 }, dataAvailability: availability } }
function fullRailOverview(total = 145) {
  const countsByCategory = { maintenance: 130, outage: 3, intervention: 4, congestion: 2, constraint: 6 }
  return { ...overview(), total, countsByCategory, buckets: [
    { from: '2026-07-01T02:00:00+08:00', to: '2026-07-01T02:59:59.999+08:00', count: 5, countsByCategory: { maintenance: 2, outage: 1, intervention: 2, congestion: 0, constraint: 0 } },
    { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00', count: 4, countsByCategory: { maintenance: 2, outage: 1, intervention: 0, congestion: 1, constraint: 0 } },
    { from: '2026-07-01T21:00:00+08:00', to: '2026-07-01T21:59:59.999+08:00', count: 8, countsByCategory: { maintenance: 2, outage: 0, intervention: 1, congestion: 1, constraint: 4 } },
  ] }
}
function event(id: string) { return { eventId: id, category: 'outage', title: `披露 ${id}`, summary: '测试停运记录', regionId: 'yunnan', businessDate: '2026-07-01', effectiveAt: '2026-07-01T10:00:00+08:00', expiresAt: '2026-07-01T11:00:00+08:00', publishedAt: null, spatialBinding: { label: '云南', kind: 'region', coordinates: null }, source: { sourceTable: 'fixture', file: 'fixture.csv', url: null } } }
function curve(value = 100) { return { metric: getDisclosureDeskMetric('price')!, series: [{ id: 'da', label: '日前用户侧统一电价', unit: '元/MWh', nativeMinutes: 60, step: 'end', points: [{ time: '2026-07-01 10:00', value }] }], channels: [], status: 'available', reason: '', sourceType: 'DB', latestAt: '2026-07-01 10:00', summary: [], warnings: [] } }
function channelCurve(selectedChannel = '云南总送出 · 云南', value = 100) { return { ...curve(value), metric: getDisclosureDeskMetric('transmission')!, channels: ['云南总送出 · 云南', '云南省网送广东 · 云南'], selectedChannel } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
const insightsStub = { name: 'DeskInsightsStub', props: ['selection', 'dateFrom', 'dateTo', 'scopeKey', 'refreshKey'], emits: ['focus'], template: '<div />' }
const rosterStub = { name: 'UnitRosterStub', props: ['regionId', 'dateFrom', 'dateTo', 'scopeKey', 'refreshKey'], emits: ['select'], template: '<div />' }
const groupsStub = { name: 'DisclosureEventGroups', props: ['groups', 'query', 'scopeKey', 'selectedId', 'selectedEvent', 'focusGroupKey', 'eventTiming'], emits: ['select'], template: '<div data-testid="groups-stub"><span v-for="group in groups" :key="group.groupKey">{{ group.label }} {{ group.total }} 条</span></div>' }
function group(label = '小湾电厂', total = 83) { return { groupKey: `plant:yunnan:${label}`, label, kind: 'plant', regionId: 'yunnan', total, countsByCategory: { maintenance: total - 1, outage: 1, intervention: 0, congestion: 0, constraint: 0 } } }
function groupedResult(items = [group()], groupTotal = 25, total = 131) { return { items, total, groupTotal, page: 1, pageSize: 12, dataAvailability: availability } }
function view(layout: 'list' | 'groups' = 'list') {
  const wrapper = mount(GridDisclosureSpatialView, { global: { stubs: { DisclosureDeskChart: chartStub, DisclosureMetricPicker: metricPickerStub, DisclosureDeskInsights: insightsStub, DisclosureUnitRoster: rosterStub, DisclosureEventGroups: groupsStub } } })
  // Existing event-row regressions explicitly use the public layout switch; group tests exercise the real default.
  if (layout === 'list') void wrapper.get('[aria-label="披露信息展示方式"]').findAll('button').find(button => button.text() === '紧凑列表')!.trigger('click')
  return wrapper
}
async function showCards(wrapper: ReturnType<typeof view>) { await wrapper.get('[aria-label="披露信息展示方式"]').findAll('button').find(button => button.text() === '信息卡片')!.trigger('click'); await flushPromises() }

beforeEach(() => {
  vi.resetAllMocks()
  ;(currentRegion as Ref<typeof currentRegion.value>).value = { id: 'yunnan', shortName: '云南' } as typeof currentRegion.value
  ;(selectedCompanyId as Ref<string | null>).value = 'company-a'
  calls.overview.mockResolvedValue(overview())
  calls.events.mockResolvedValue({ items: [event('a')], total: 131, page: 1, pageSize: 18, dataAvailability: availability })
  calls.groups.mockResolvedValue(groupedResult())
  calls.providers.mockResolvedValue({ providers: [] })
  calls.series.mockResolvedValue(curve())
  calls.themeAvailability.mockResolvedValue({ load: { available: 1, total: 1 }, 'new-energy': { available: 0, total: 2 }, reserve: { available: 0, total: 3 } })
})
afterEach(() => { vi.useRealTimers() })

describe('公开披露交易台上下文联动', () => {
  it('非法日历日期不能归一化后进入事件、统计与曲线请求', async () => {
    const wrapper = view()
    await flushPromises()
    for (const mock of [calls.events, calls.overview, calls.series, calls.themeAvailability]) mock.mockClear()
    const input = wrapper.get('[data-testid="desk-date"]')
    input.element.setAttribute('type', 'text')
    await input.setValue('2026-02-30'); await flushPromises()
    for (const mock of [calls.events, calls.overview, calls.series, calls.themeAvailability]) expect(mock).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'DeskChartStub' }).exists()).toBe(false)
    wrapper.unmount()
  })
  it('指标选择器接收市场与主题分组，选择指标联动主题并保留交易日和原选区', async () => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    await wrapper.get('[aria-label="检修停运类别"]').findAll('button')[2].trigger('click'); await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    chart.vm.$emit('select', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T11:59:59.999+08:00' }); await flushPromises()
    const locked = chart.props('selection')
    const picker = wrapper.getComponent({ name: 'MetricPickerStub' })
    expect(picker.props('modelValue')).toBe('price')
    expect(picker.props('groups')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'price', label: '市场电价', metrics: expect.arrayContaining([expect.objectContaining({ id: 'price', label: '用户侧统一电价' })]) }),
      expect.objectContaining({ id: 'load', label: '负荷与供需', metrics: expect.arrayContaining([expect.objectContaining({ id: 'non-market' })]) }),
      expect.objectContaining({ id: 'transmission', label: '联络线与断面', metrics: expect.arrayContaining([expect.objectContaining({ id: 'section-constraint' })]) }),
    ]))
    await wrapper.get('[aria-label="主图指标"]').setValue('section-constraint'); await flushPromises()
    expect(picker.props('modelValue')).toBe('section-constraint')
    expect(wrapper.get('[data-testid="desk-theme-transmission"]').attributes('aria-pressed')).toBe('true')
    expect(calls.series.mock.lastCall![0]).toMatchObject({ metricId: 'section-constraint', dateFrom: '2026-07-01', dateTo: '2026-07-01' })
    expect(calls.events.mock.lastCall![0]).toMatchObject({ category: 'congestion,constraint', ...locked })
    expect(chart.props('selection')).toEqual(locked)
    await wrapper.get('[aria-label="主图指标"]').setValue('price'); await flushPromises()
    expect(wrapper.findAll('.theme-card[aria-pressed="true"]')).toHaveLength(0)
    expect(calls.series.mock.lastCall![0].metricId).toBe('price')
    expect(calls.events.mock.lastCall![0]).not.toHaveProperty('category')
    expect(chart.props('selection')).toEqual(locked)
    expect((wrapper.get('[data-testid="desk-date"]').element as HTMLInputElement).value).toBe('2026-07-01')
    wrapper.unmount()
  })

  it('默认按电厂对象读取整查询分组总数，折叠状态不预读事件明细', async () => {
    const items = [group('小湾电厂', 83), group('糯扎渡电厂', 29)]
    calls.groups.mockResolvedValue(groupedResult(items))
    const wrapper = view('groups'); await flushPromises()
    const switcher = wrapper.get('[aria-label="披露信息展示方式"]')
    expect(switcher.findAll('button').map(button => button.text())).toEqual(['按电厂 / 对象', '紧凑列表', '信息卡片'])
    expect(switcher.findAll('button')[0].attributes('aria-pressed')).toBe('true')
    expect(switcher.text()).toContain('共 131 条匹配记录 · 25 组')
    expect(wrapper.get('.feed-tabs').text()).toContain('关联披露 131')
    expect(wrapper.get('.pager').text()).toContain('1 / 3 页 · 共 25 组')
    expect(wrapper.getComponent({ name: 'DisclosureEventGroups' }).props('groups')).toEqual(items)
    expect(wrapper.findAll('.event-card')).toHaveLength(0)
    expect(wrapper.find('[data-testid="disclosure-list"]').exists()).toBe(false)
    expect(calls.groups).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 12, region: 'yunnan', windowMode: 'overlap' }), expect.anything())
    expect(calls.events).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('分组翻页与展开明细接收同一完整筛选，统计不由当前页对象数量推算', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const wrapper = view('groups')
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await wrapper.get('[data-testid="desk-search"]').setValue('调度')
    await vi.advanceTimersByTimeAsync(260); await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    chart.vm.$emit('select', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T11:59:59.999+08:00' }); await flushPromises()
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    await wrapper.get('[aria-label="搜索检修设备或电厂"]').setValue('小湾')
    await wrapper.get('[aria-label="搜索检修停运原因"]').setValue('保供')
    await vi.advanceTimersByTimeAsync(260); await flushPromises()
    await wrapper.get('[aria-label="检修停运时间关系"]').setValue('covers-window')
    await wrapper.get('[aria-label="检修停运排序"]').setValue('duration-desc')
    await wrapper.get('[aria-label="检修停运类别"]').findAll('button')[2].trigger('click'); await flushPromises()
    const expected = { ...chart.props('selection'), region: 'yunnan', keyword: '调度', equipmentKeyword: '小湾', reasonKeyword: '保供', timingFilter: 'covers-window', sort: 'duration-desc', category: 'outage', windowMode: 'overlap', timePrecision: 'timed' }
    const firstGroupComponent = wrapper.getComponent({ name: 'DisclosureEventGroups' })
    expect(firstGroupComponent.props('query')).toEqual(expected)
    expect(firstGroupComponent.props('scopeKey')).toBe('yunnan:company-a')
    expect(calls.groups.mock.lastCall![0]).toEqual({ ...expected, page: 1, pageSize: 12 })
    calls.groups.mockResolvedValue(groupedResult([group('下一页电厂', 17)]))
    await wrapper.get('[aria-label="下一页分组"]').trigger('click'); await flushPromises()
    expect(calls.groups.mock.lastCall![0]).toEqual({ ...expected, page: 2, pageSize: 12 })
    expect(wrapper.get('.pager').text()).toContain('2 / 3 页 · 共 25 组')
    expect(wrapper.get('[data-testid="groups-stub"]').text()).toContain('下一页电厂 17 条')
    expect(wrapper.get('[aria-label="检修信息展示方式"]').text()).toContain('共 131 条匹配记录')
    expect(wrapper.getComponent({ name: 'DisclosureEventGroups' }).vm).not.toBe(firstGroupComponent.vm)
    expect(calls.events).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('分组与逐条展示互切回到各自第一页，列表卡片互切复用当前事件页', async () => {
    const wrapper = view('groups'); await flushPromises()
    await wrapper.get('[aria-label="下一页分组"]').trigger('click'); await flushPromises()
    const switcher = wrapper.get('[aria-label="披露信息展示方式"]')
    await switcher.findAll('button').find(button => button.text() === '紧凑列表')!.trigger('click'); await flushPromises()
    expect(calls.events.mock.lastCall![0]).toMatchObject({ page: 1, pageSize: 18 })
    expect(wrapper.find('[data-testid="groups-stub"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="disclosure-list"]').findAll('.open-event')).toHaveLength(1)
    await wrapper.get('[aria-label="下一页披露"]').trigger('click'); await flushPromises()
    await wrapper.get('.open-event').trigger('click'); await flushPromises()
    const eventRequests = calls.events.mock.calls.length
    await showCards(wrapper)
    expect(calls.events).toHaveBeenCalledTimes(eventRequests)
    expect(wrapper.get('.pager').text()).toContain('2 / 8 页')
    expect(wrapper.get('.event-card').attributes('aria-pressed')).toBe('true')
    await switcher.findAll('button').find(button => button.text() === '按电厂 / 对象')!.trigger('click'); await flushPromises()
    expect(calls.groups.mock.lastCall![0]).toMatchObject({ page: 1, pageSize: 12 })
    expect(wrapper.get('.pager').text()).toContain('1 / 3 页')
    expect(wrapper.find('[data-testid="evidence-stub"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each(['load', 'new-energy', 'reserve', 'maintenance', 'transmission', 'intervention'])('%s主题关联披露保持分组，取消主题保留原时段并恢复全部类别', async theme => {
    const wrapper = view('groups')
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01'); await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    chart.vm.$emit('select', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T11:59:59.999+08:00' }); await flushPromises()
    const locked = chart.props('selection')
    await wrapper.get(`[data-testid="desk-theme-${theme}"]`).trigger('click'); await flushPromises()
    await wrapper.get('.feed-tabs').findAll('button')[0].trigger('click'); await flushPromises()
    expect(wrapper.find('[data-testid="groups-stub"]').exists()).toBe(true)
    await wrapper.get(`[data-testid="desk-theme-${theme}"]`).trigger('click'); await flushPromises()
    expect(wrapper.findAll('.theme-card[aria-pressed="true"]')).toHaveLength(0)
    expect(chart.props('selection')).toEqual(locked)
    expect(wrapper.find('[data-testid="groups-stub"]').exists()).toBe(true)
    expect(calls.groups.mock.lastCall![0]).toMatchObject({ ...locked, timePrecision: 'timed', page: 1, pageSize: 12 })
    expect(calls.groups.mock.lastCall![0]).not.toHaveProperty('category')
    expect(calls.events).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('分组内选中事件打开相同来源详情，收藏变化回传组内记录且不重取分组', async () => {
    const wrapper = view('groups'); await flushPromises()
    const grouped = wrapper.getComponent({ name: 'DisclosureEventGroups' })
    const chosen = { ...event('plant-event'), personalFavorite: false }
    grouped.vm.$emit('select', chosen); await flushPromises()
    expect(wrapper.get('[data-testid="evidence-stub"]').text()).toBe('披露 plant-event')
    expect(grouped.props('selectedId')).toBe('plant-event')
    expect(grouped.props('selectedEvent')).toEqual(chosen)
    const before = calls.groups.mock.calls.length
    const evidence = wrapper.getComponent({ name: 'EvidenceStub' })
    evidence.vm.$emit('favorite-change', { eventId: 'plant-event', favorite: true }); await flushPromises()
    expect(grouped.props('selectedEvent')).toMatchObject({ eventId: 'plant-event', personalFavorite: true })
    evidence.vm.$emit('close'); await flushPromises()
    expect(wrapper.find('[data-testid="evidence-stub"]').exists()).toBe(false)
    expect(grouped.props('selectedId')).toBeUndefined()
    expect(calls.groups).toHaveBeenCalledTimes(before)
    expect(calls.events).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('单事件圆点仅补读一条对应组记录，定位分组并打开详情', async () => {
    const wrapper = view('groups')
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01'); await flushPromises()
    const singleGroup = group('小湾电厂', 1)
    calls.groups.mockResolvedValue(groupedResult([singleGroup], 1, 1))
    calls.events.mockResolvedValue({ items: [event('single-group-event')], total: 1, page: 1, pageSize: 1, dataAvailability: availability })
    wrapper.getComponent({ name: 'DeskChartStub' }).vm.$emit('event-focus', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00', category: 'outage', count: 1 }); await flushPromises()
    expect(calls.events).toHaveBeenCalledTimes(1)
    expect(calls.events.mock.lastCall![0]).toMatchObject({ groupKey: singleGroup.groupKey, category: 'outage', timePrecision: 'timed', page: 1, pageSize: 1 })
    expect(wrapper.getComponent({ name: 'DisclosureEventGroups' }).props('focusGroupKey')).toBe(singleGroup.groupKey)
    expect(wrapper.get('[data-testid="evidence-stub"]').text()).toContain('single-group-event')
    wrapper.unmount()
  })

  it('聚合事件圆点仅定位分组，不抢先选中组内任意一条事件', async () => {
    const wrapper = view('groups')
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01'); await flushPromises()
    wrapper.getComponent({ name: 'DeskChartStub' }).vm.$emit('event-focus', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00', category: 'outage', count: 2 }); await flushPromises()
    expect(calls.groups.mock.lastCall![0]).toMatchObject({ category: 'outage', timePrecision: 'timed', page: 1 })
    expect(calls.events).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="evidence-stub"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('分组错误可重试，不把读取失败显示成无披露；空结果使用来源原因', async () => {
    calls.groups.mockRejectedValueOnce(new Error('没有读取披露权限'))
    const wrapper = view('groups'); await flushPromises()
    expect(wrapper.get('.feed-panel [role="alert"]').text()).toContain('没有读取披露权限')
    expect(wrapper.find('[data-testid="desk-events-empty"]').exists()).toBe(false)
    calls.groups.mockResolvedValue({ ...groupedResult([], 0, 0), dataAvailability: { ...availability, status: 'missing', reason: '所选日期没有已接入披露' } })
    await wrapper.get('.feed-panel [role="alert"] button').trigger('click'); await flushPromises()
    expect(wrapper.find('.feed-panel [role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="desk-events-empty"]').text()).toContain('所选日期没有已接入披露')
    expect(wrapper.find('[data-testid="groups-stub"]').exists()).toBe(false)
    expect(calls.events).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each(['date', 'company'])('切换%s使旧分组请求失效，刷新重建展开区而不预读明细', async context => {
    const pending = deferred<unknown>()
    calls.groups.mockReturnValueOnce(pending.promise)
    const wrapper = view('groups'); await flushPromises()
    const oldSignal = calls.groups.mock.calls[0][1].signal as AbortSignal
    calls.groups.mockResolvedValue(groupedResult([group('新上下文电厂')], 1, 83))
    if (context === 'date') await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-03')
    else (selectedCompanyId as Ref<string | null>).value = 'company-b'
    await flushPromises()
    expect(oldSignal.aborted).toBe(true)
    pending.resolve(groupedResult([group('旧上下文电厂')], 99, 999)); await flushPromises()
    expect(wrapper.get('[data-testid="groups-stub"]').text()).toContain('新上下文电厂')
    expect(wrapper.get('[data-testid="groups-stub"]').text()).not.toContain('旧上下文电厂')
    expect(wrapper.get('[aria-label="披露信息展示方式"]').text()).toContain('共 83 条匹配记录 · 1 组')
    const grouped = wrapper.getComponent({ name: 'DisclosureEventGroups' })
    await wrapper.get('[data-testid="desk-refresh"]').trigger('click'); await flushPromises()
    expect(wrapper.getComponent({ name: 'DisclosureEventGroups' }).vm).not.toBe(grouped.vm)
    expect(calls.events).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('单事件补读期间取消主题，迟到明细不会重新打开旧组或旧详情', async () => {
    const wrapper = view('groups')
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01'); await flushPromises()
    const pending = deferred<unknown>()
    calls.groups.mockResolvedValueOnce(groupedResult([group('旧单事件电厂', 1)], 1, 1))
    calls.events.mockReturnValueOnce(pending.promise)
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    chart.vm.$emit('event-focus', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00', category: 'outage', count: 1 }); await flushPromises()
    const locked = chart.props('selection')
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    pending.resolve({ items: [event('late-single')], total: 1, dataAvailability: availability }); await flushPromises()
    expect(wrapper.find('[data-testid="evidence-stub"]').exists()).toBe(false)
    expect(wrapper.getComponent({ name: 'DisclosureEventGroups' }).props('focusGroupKey')).toBeNull()
    expect(wrapper.get('[data-testid="groups-stub"]').text()).toContain('小湾电厂')
    expect(chart.props('selection')).toEqual(locked)
    wrapper.unmount()
  })

  it('未选主题提供完整披露工具，紧凑列表切换卡片保留已选记录且不重载', async () => {
    const wrapper = view(); await flushPromises()
    expect(wrapper.findAll('.theme-card[aria-pressed="true"]')).toHaveLength(0)
    const tools = wrapper.get('[data-testid="disclosure-tools"]')
    expect(tools.get('[aria-label="披露类别"]').findAll('button').map(button => button.text())).toEqual(['全部', '检修计划', '非计划停运', '人工干预', '断面阻塞', '输电约束'])
    expect(tools.find('[aria-label="搜索披露对象"]').exists()).toBe(true)
    expect(tools.find('[aria-label="搜索披露原因或摘要"]').exists()).toBe(true)
    expect(tools.find('[aria-label="披露时间关系"]').exists()).toBe(true)
    expect(tools.find('[aria-label="披露排序"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="disclosure-list"]').findAll('.open-event')).toHaveLength(1)
    expect(wrapper.get('[aria-label="披露信息展示方式"]').text()).toContain('共 131 条匹配记录')
    await wrapper.get('.open-event').trigger('click'); await flushPromises()
    const requests = calls.events.mock.calls.length
    await showCards(wrapper)
    expect(wrapper.get('.event-card').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="evidence-stub"]').text()).toBe('披露 a')
    expect(wrapper.find('[data-testid="disclosure-list"]').exists()).toBe(false)
    expect(calls.events).toHaveBeenCalledTimes(requests)
    wrapper.unmount()
  })

  it.each(['load', 'new-energy', 'reserve', 'maintenance', 'transmission', 'intervention'])('再次点击%s主题取消选择，保留交易日与原始时窗并恢复全部披露和价格', async (theme) => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01'); await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    chart.vm.$emit('select', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T11:59:59.999+08:00' }); await flushPromises()
    const locked = chart.props('selection')
    await wrapper.get('.open-event').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-testid="evidence-stub"]').exists()).toBe(true)
    const button = wrapper.get(`[data-testid="desk-theme-${theme}"]`)
    await button.trigger('click'); await flushPromises()
    expect(button.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="evidence-stub"]').exists()).toBe(false)
    if (theme === 'maintenance') {
      await wrapper.get('[aria-label="检修停运类别"]').findAll('button')[2].trigger('click'); await flushPromises()
      expect(calls.events.mock.lastCall![0]).toHaveProperty('category', 'outage')
    }
    await button.trigger('click'); await flushPromises()
    expect(wrapper.findAll('.theme-card[aria-pressed="true"]')).toHaveLength(0)
    expect((wrapper.get('[data-testid="desk-date"]').element as HTMLInputElement).value).toBe('2026-07-01')
    expect(chart.props('selection')).toEqual(locked)
    expect((wrapper.get('[aria-label="主图指标"]').element as HTMLSelectElement).value).toBe('price')
    expect(wrapper.find('[data-testid="disclosure-list"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="desk-metric-cards"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="evidence-stub"]').exists()).toBe(false)
    expect(calls.events.mock.lastCall![0]).toMatchObject({ ...locked, timePrecision: 'timed', page: 1 })
    expect(calls.events.mock.lastCall![0]).not.toHaveProperty('category')
    wrapper.unmount()
  })

  it('未选主题可依次筛选全部五类披露，完整轨道与跨页分类统计不受局部类别影响', async () => {
    const full = fullRailOverview()
    calls.overview.mockResolvedValue(full)
    const wrapper = view(); await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' }), requests = calls.overview.mock.calls.length
    const buttons = wrapper.get('[aria-label="披露类别"]').findAll('button')
    for (const [index, category] of ['maintenance', 'outage', 'intervention', 'congestion', 'constraint'].entries()) {
      await buttons[index + 1].trigger('click'); await flushPromises()
      expect(calls.events.mock.lastCall![0]).toMatchObject({ category, page: 1 })
      expect(buttons[index + 1].attributes('aria-pressed')).toBe('true')
      expect(wrapper.findAll('.theme-card[aria-pressed="true"]')).toHaveLength(0)
      expect(chart.props('overview')).toEqual(full)
    }
    await buttons[0].trigger('click'); await flushPromises()
    expect(calls.events.mock.lastCall![0]).not.toHaveProperty('category')
    expect(calls.overview).toHaveBeenCalledTimes(requests)
    expect(wrapper.get('[data-testid="desk-theme-maintenance"]').text()).toContain('133')
    wrapper.unmount()
  })

  it('通用搜索、时间关系和排序发送完整筛选，清空局部筛选保留日期、选区和顶部关键词', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const full = fullRailOverview()
    calls.overview.mockResolvedValue(full)
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await wrapper.get('[data-testid="desk-search"]').setValue('调度')
    await vi.advanceTimersByTimeAsync(260); await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    chart.vm.$emit('select', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T11:59:59.999+08:00' }); await flushPromises()
    const locked = chart.props('selection'), initialRequests = calls.events.mock.calls.length
    calls.events.mockResolvedValue({ items: [event('matched')], total: 83, dataAvailability: availability })
    calls.overview.mockResolvedValue({ ...overview(), total: 83, countsByCategory: { ...categoryCounts, maintenance: 82 } })
    await wrapper.get('[aria-label="搜索披露对象"]').setValue(' 云南总送出 ')
    await vi.advanceTimersByTimeAsync(150)
    await wrapper.get('[aria-label="搜索披露原因或摘要"]').setValue('保供')
    await vi.advanceTimersByTimeAsync(259); await flushPromises()
    expect(calls.events).toHaveBeenCalledTimes(initialRequests)
    await vi.advanceTimersByTimeAsync(1); await flushPromises()
    const expected = { ...locked, keyword: '调度', equipmentKeyword: '云南总送出', reasonKeyword: '保供', windowMode: 'overlap', timePrecision: 'timed' }
    expect(calls.events.mock.lastCall![0]).toMatchObject({ ...expected, page: 1 })
    expect(calls.events.mock.lastCall![0]).not.toHaveProperty('category')
    expect(calls.overview.mock.lastCall![0]).toMatchObject(expected)
    await wrapper.get('[aria-label="披露时间关系"]').setValue('covers-window'); await flushPromises()
    const overviewRequests = calls.overview.mock.calls.length
    await wrapper.get('[aria-label="披露排序"]').setValue('duration-desc')
    await wrapper.get('[aria-label="披露类别"]').findAll('button')[5].trigger('click'); await flushPromises()
    expect(calls.events.mock.lastCall![0]).toMatchObject({ ...expected, category: 'constraint', timingFilter: 'covers-window', sort: 'duration-desc', page: 1 })
    expect(calls.overview.mock.lastCall![0]).toMatchObject({ ...expected, timingFilter: 'covers-window' })
    expect(calls.overview.mock.lastCall![0]).not.toHaveProperty('sort')
    expect(calls.overview.mock.lastCall![0]).not.toHaveProperty('category')
    expect(calls.overview).toHaveBeenCalledTimes(overviewRequests)
    expect(chart.props('overview')).toEqual(full)
    expect(wrapper.get('[data-testid="disclosure-list"]').findAll('li')).toHaveLength(1)
    expect(wrapper.get('[aria-label="披露信息展示方式"]').text()).toContain('共 83 条匹配记录')
    expect(wrapper.get('[data-testid="desk-theme-maintenance"]').text()).toContain('83')
    await wrapper.get('[aria-label="下一页披露"]').trigger('click'); await flushPromises()
    expect(calls.events.mock.lastCall![0]).toMatchObject({ ...expected, category: 'constraint', timingFilter: 'covers-window', sort: 'duration-desc', page: 2 })
    await wrapper.get('[data-testid="disclosure-tools"] .clear').trigger('click'); await flushPromises()
    expect(calls.events.mock.lastCall![0]).toMatchObject({ ...locked, keyword: '调度', timePrecision: 'timed', page: 1 })
    for (const key of ['equipmentKeyword', 'reasonKeyword', 'timingFilter', 'sort', 'category']) expect(calls.events.mock.lastCall![0]).not.toHaveProperty(key)
    expect(chart.props('selection')).toEqual(locked)
    expect(chart.props('overview')).toEqual(full)
    expect((wrapper.get('[data-testid="desk-date"]').element as HTMLInputElement).value).toBe('2026-07-01')
    expect((wrapper.get('[data-testid="desk-search"]').element as HTMLInputElement).value).toBe('调度')
    wrapper.unmount()
  })

  it('通用筛选与检修共用状态，进入其他主题挂起，取消该主题后恢复原筛选', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const wrapper = view(); await flushPromises()
    await wrapper.get('[aria-label="搜索披露对象"]').setValue('小湾')
    await wrapper.get('[aria-label="搜索披露原因或摘要"]').setValue('检修')
    await vi.advanceTimersByTimeAsync(260); await flushPromises()
    await wrapper.get('[aria-label="披露时间关系"]').setValue('starts-in-window')
    await wrapper.get('[aria-label="披露排序"]').setValue('start-asc')
    await wrapper.get('[aria-label="披露类别"]').findAll('button')[3].trigger('click'); await flushPromises()
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    const expected = { equipmentKeyword: '小湾', reasonKeyword: '检修', timingFilter: 'starts-in-window', sort: 'start-asc' }
    expect(calls.events.mock.lastCall![0]).toMatchObject({ ...expected, category: 'maintenance,outage' })
    expect((wrapper.get('[aria-label="搜索检修设备或电厂"]').element as HTMLInputElement).value).toBe('小湾')
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    expect(calls.events.mock.lastCall![0]).toMatchObject(expected)
    expect(calls.events.mock.lastCall![0]).not.toHaveProperty('category')
    await wrapper.get('[data-testid="desk-theme-intervention"]').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-testid="disclosure-tools"]').exists()).toBe(false)
    expect(calls.events.mock.lastCall![0]).toMatchObject({ category: 'intervention' })
    for (const key of Object.keys(expected)) expect(calls.events.mock.lastCall![0]).not.toHaveProperty(key)
    await wrapper.get('[data-testid="desk-theme-intervention"]').trigger('click'); await flushPromises()
    expect(calls.events.mock.lastCall![0]).toMatchObject(expected)
    expect(calls.events.mock.lastCall![0]).not.toHaveProperty('category')
    expect((wrapper.get('[aria-label="搜索披露对象"]').element as HTMLInputElement).value).toBe('小湾')
    expect((wrapper.get('[aria-label="披露排序"]').element as HTMLSelectElement).value).toBe('start-asc')
    wrapper.unmount()
  })

  it('取消主题后迟到的旧曲线不能覆盖恢复的价格', async () => {
    const wrapper = view(); await flushPromises()
    const pending = deferred<unknown>()
    calls.series.mockReturnValueOnce(pending.promise)
    await wrapper.get('[data-testid="desk-theme-load"]').trigger('click'); await flushPromises()
    calls.series.mockResolvedValue(curve(222))
    await wrapper.get('[data-testid="desk-theme-load"]').trigger('click'); await flushPromises()
    pending.resolve({ ...curve(999), metric: getDisclosureDeskMetric('load')! }); await flushPromises()
    expect(wrapper.findAll('.theme-card[aria-pressed="true"]')).toHaveLength(0)
    expect(wrapper.getComponent({ name: 'DeskChartStub' }).props('series')[0].points[0].value).toBe(222)
    expect((wrapper.get('[aria-label="主图指标"]').element as HTMLSelectElement).value).toBe('price')
    wrapper.unmount()
  })

  it('单事件请求未完成时取消已选主题，迟到响应不能重开旧详情或替换通用列表', async () => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01'); await flushPromises()
    const pending = deferred<unknown>(), chart = wrapper.getComponent({ name: 'DeskChartStub' })
    calls.events.mockReturnValueOnce(pending.promise)
    chart.vm.$emit('event-focus', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00', category: 'outage', count: 1 }); await flushPromises()
    const locked = chart.props('selection')
    calls.events.mockResolvedValue({ items: [event('fresh-all')], total: 12, dataAvailability: availability })
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    pending.resolve({ items: [event('old-single')], total: 1, dataAvailability: availability }); await flushPromises()
    expect(wrapper.findAll('.theme-card[aria-pressed="true"]')).toHaveLength(0)
    expect(wrapper.get('[data-testid="disclosure-list"]').text()).toContain('披露 fresh-all')
    expect(wrapper.get('[data-testid="disclosure-list"]').text()).not.toContain('old-single')
    expect(wrapper.find('[data-testid="evidence-stub"]').exists()).toBe(false)
    expect(chart.props('selection')).toEqual(locked)
    expect(calls.events.mock.lastCall![0]).not.toHaveProperty('category')
    wrapper.unmount()
  })

  it('重复点击同类别事件点始终定位对应主题与详情，不触发主题取消', async () => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01'); await flushPromises()
    calls.events.mockResolvedValue({ items: [event('single')], total: 1, dataAvailability: availability })
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    for (let click = 0; click < 2; click += 1) {
      chart.vm.$emit('event-focus', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00', category: 'outage', count: 1 }); await flushPromises()
      expect(wrapper.get('[data-testid="desk-theme-maintenance"]').attributes('aria-pressed')).toBe('true')
      expect(wrapper.get('[data-testid="evidence-stub"]').text()).toContain('披露 single')
      expect(calls.events.mock.lastCall![0]).toMatchObject({ category: 'outage', timePrecision: 'timed', page: 1 })
    }
    wrapper.unmount()
  })

  it('选区摘要反向切换指标并锁定15分钟原始时段，子指标留在现有主题内', async () => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01'); await flushPromises()
    wrapper.getComponent({ name: 'DeskInsightsStub' }).vm.$emit('focus', { metricId: 'non-market', from: '2026-07-01T10:15:00+08:00', to: '2026-07-01T10:29:59.999+08:00' })
    await flushPromises()
    expect((wrapper.get('[aria-label="主图指标"]').element as HTMLSelectElement).value).toBe('non-market')
    expect(wrapper.get('[data-testid="desk-theme-load"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.getComponent({ name: 'DeskChartStub' }).props('selection')).toEqual({ from: '2026-07-01T10:15:00.000+08:00', to: '2026-07-01T10:29:59.999+08:00' })
    expect(wrapper.get('[aria-label="当前主题子指标"]').text()).toContain('非市场化电源')
    expect(wrapper.findAll('.theme-card')).toHaveLength(6)
    wrapper.unmount()
  })
  it('必开必停按选区日期联动，查看已移除机组时回到其原始业务日', async () => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await wrapper.get('[data-testid="desk-theme-reserve"]').trigger('click'); await flushPromises()
    const roster = wrapper.getComponent({ name: 'UnitRosterStub' })
    expect(roster.props('dateFrom')).toBe('2026-07-01')
    roster.vm.$emit('select', { date: '2026-06-29' }); await flushPromises()
    expect((wrapper.get('[data-testid="desk-date"]').element as HTMLInputElement).value).toBe('2026-06-29')
    expect(wrapper.getComponent({ name: 'DeskChartStub' }).props('selection')).toBeNull()
    expect(roster.props('dateFrom')).toBe('2026-06-29')
    wrapper.unmount()
  })
  it.each([['actual', '实际'], ['planned', '计划']] as const)('检修卡片直接展示%s停复电的完整跨日时间，不依赖摘要或详情', async (intervalBasis, label) => {
    calls.events.mockResolvedValue({ items: [{ ...event('maintenance-time'), category: 'maintenance', summary: '设备及检修原因。'.repeat(40), businessDate: '2026-07-02', sourceImportedAt: '2026-09-09T06:30:00+08:00', effectiveAt: '2026-06-30T19:30:00+08:00', expiresAt: '2026-07-14T23:00:00+08:00', timeQuality: { effective: 'source', published: 'unknown', intervalBasis, issues: [] } }], total: 1, dataAvailability: availability })
    const wrapper = view()
    await flushPromises()
    await showCards(wrapper)
    const card = wrapper.get('.event-card')
    expect(card.findAll('.event-time-fields dt').map((row) => row.text())).toEqual([`${label}停电时间`, `${label}复电时间`])
    expect(card.findAll('.event-time-fields dd').map((row) => row.text())).toEqual(['2026-06-30 19:30', '2026-07-14 23:00'])
    expect(card.get('.event-time').text()).toContain(`${label}停复电区间`)
    expect(card.get('.event-time-fields').text()).not.toContain('2026-09-09')
    expect(card.get('.event-time-fields').text()).not.toContain('2026-07-02')
    expect(wrapper.find('[data-testid="evidence-stub"]').exists()).toBe(false)
    wrapper.unmount()
  })

  // dljy#3563：同地区有整年导出与日文件两路南网来源，卡片来源名取事件自己的来源，不再取该地区第一个来源。
  it('信息卡片来源名按事件自己的来源显示，未登记来源如实写待确认', async () => {
    const csgProvider = (providerId: string, name: string) => ({ providerId, gridOperator: 'csg', name, regionIds: ['yunnan', 'guangdong'], sourceType: 'IMPORT', mock: false, productionWrite: false, access: 'public', originalLinkPolicy: 'only-when-source-supplies-url', license: '南方电网公开披露信息', eventCount: 1, dataAvailability: { status: 'available', reason: '测试夹具' } })
    calls.providers.mockResolvedValue({ providers: [csgProvider('csg-authorized-export', '南方电网公开披露'), csgProvider('csg-disclosure-file', '南方电网公开披露（日文件接续）')] })
    calls.events.mockResolvedValue({ items: [
      { ...event('daily-file'), providerId: 'csg-disclosure-file' },
      { ...event('annual-export'), providerId: 'csg-authorized-export' },
      { ...event('unregistered'), providerId: 'unregistered-source' },
    ], total: 3, dataAvailability: availability })
    const wrapper = view()
    await flushPromises()
    await showCards(wrapper)
    expect(wrapper.findAll('.event-card .event-source > span').map((item) => item.text())).toEqual(['南方电网公开披露（日文件接续）', '南方电网公开披露', '来源名称待确认（unregistered-source）'])
    expect(wrapper.get('.event-card .event-source > span').attributes('title')).toBe('fixture.csv')
    expect(wrapper.get('.header-context').text()).toContain('南方电网公开披露')
    wrapper.unmount()
  })

  it.each([null, '2026-07-01T00:00:00+08:00'])('日级检修卡片缺少停复电时间时明确未提供，不用业务日或入库日补值：%s', async (effectiveAt) => {
    calls.events.mockResolvedValue({ items: [{ ...event('unknown-time'), category: 'maintenance', effectiveAt, expiresAt: null, effectiveDate: '2026-07-01', sourceImportedAt: '2026-09-09T06:30:00+08:00', timeQuality: { effective: 'business-date', published: 'unknown', intervalBasis: 'unknown', issues: [] } }], total: 1, dataAvailability: availability })
    const wrapper = view()
    await flushPromises()
    await showCards(wrapper)
    const card = wrapper.get('.event-card')
    expect(card.findAll('.event-time-fields dt').map((row) => row.text())).toEqual(['停电时间', '复电时间'])
    expect(card.findAll('.event-time-fields dd').map((row) => row.text())).toEqual(['未提供', '未提供'])
    expect(card.get('.event-time').text()).toContain('时间未提供')
    wrapper.unmount()
  })

  it.each([['干预时刻', '已知时点'], ['实际停电日期', '实际停电时间']])('单点停运按来源字段%s标识起点，复电时间保持未知', async (startField, startLabel) => {
    calls.events.mockResolvedValue({ items: [{ ...event('point-time'), expiresAt: null, sourceImportedAt: '2026-09-09T06:30:00+08:00', timeQuality: { effective: 'source', published: 'unknown', intervalBasis: 'point', issues: ['restoration-time-not-provided'] }, source: { ...event('point-time').source, time: { startField, endField: null } } }], total: 1, dataAvailability: availability })
    const wrapper = view()
    await flushPromises()
    await showCards(wrapper)
    const card = wrapper.get('.event-card')
    expect(card.findAll('.event-time-fields dt').map((row) => row.text())).toEqual([startLabel, '复电时间'])
    expect(card.findAll('.event-time-fields dd').map((row) => row.text())).toEqual(['2026-07-01 10:00', '未提供'])
    expect(card.get('.event-time').text()).toContain('仅有单点，持续区间未知')
    expect(card.get('.event-time').text()).not.toContain('实际停复电区间')
    wrapper.unmount()
  })

  it('输电约束保留生效与结束文案，不显示设备停复电标签', async () => {
    calls.events.mockResolvedValue({ items: [{ ...event('constraint-time'), category: 'constraint', timeQuality: { effective: 'source', published: 'unknown', intervalBasis: 'source', issues: [] } }], total: 1, dataAvailability: availability })
    const wrapper = view()
    await flushPromises()
    await showCards(wrapper)
    const card = wrapper.get('.event-card')
    expect(card.findAll('.event-time-fields dt').map((row) => row.text())).toEqual(['生效时间', '结束时间'])
    expect(card.findAll('.event-time-fields dd').map((row) => row.text())).toEqual(['2026-07-01 10:00', '2026-07-01 11:00'])
    expect(card.get('.event-time').text()).toContain('来源有效区间')
    wrapper.unmount()
  })

  it('今日缺数不自动换日，用户选择交易日才进入历史', async () => {
    calls.series.mockResolvedValue({ ...curve(), series: [], status: 'missing', reason: '今日无值', latestAt: null })
    calls.events.mockResolvedValue({ items: [], total: 0, dataAvailability: availability })
    const wrapper = view()
    await flushPromises()
    expect((wrapper.get('[data-testid="desk-date"]').element as HTMLInputElement).value).toBe('2026-09-09')
    expect(calls.series).toHaveBeenLastCalledWith(expect.objectContaining({ regionId: 'yunnan', dateFrom: '2026-09-09', dateTo: '2026-09-09' }))
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-02')
    await flushPromises()
    expect((wrapper.get('[data-testid="desk-date"]').element as HTMLInputElement).value).toBe('2026-07-02')
    expect(wrapper.text()).toContain('数据回看')
    wrapper.unmount()
  })

  it('悬停不发请求，锁定时段按timed过滤；解除锁定恢复全天记录', async () => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await flushPromises()
    const previous = calls.events.mock.calls.length
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    chart.vm.$emit('hover', '2026-07-01T10:15:00+08:00')
    await flushPromises()
    expect(calls.events).toHaveBeenCalledTimes(previous)
    chart.vm.$emit('select', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00' })
    await flushPromises()
    expect(calls.events).toHaveBeenLastCalledWith(expect.objectContaining({ timePrecision: 'timed', page: 1 }), expect.anything())
    expect(Date.parse(calls.events.mock.lastCall![0].from)).toBe(Date.parse('2026-07-01T10:00:00+08:00'))
    await wrapper.get('[data-testid="desk-clear-selection"]').trigger('click')
    await flushPromises()
    expect(calls.events).toHaveBeenLastCalledWith(expect.objectContaining({ timePrecision: 'all' }), expect.anything())
    wrapper.unmount()
  })

  it('页内一条记录仍展示全量131条，主题重置分页但保留全部类别轨道', async () => {
    calls.overview.mockResolvedValue(fullRailOverview())
    const wrapper = view()
    await flushPromises()
    expect(wrapper.get('[data-testid="disclosure-list"]').findAll('.open-event')).toHaveLength(1)
    expect(wrapper.find('.pager').text()).toContain('131')
    await wrapper.get('[aria-label="下一页披露"]').trigger('click')
    await flushPromises()
    expect(calls.events).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.anything())
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click')
    await flushPromises()
    expect(calls.events).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, category: 'maintenance,outage' }), expect.anything())
    expect(wrapper.getComponent({ name: 'DeskChartStub' }).props('overview')).toEqual(fullRailOverview())
    wrapper.unmount()
  })

  it('同一日期初始仅取一次概览；选区只更新当前统计，解除时段复用全部轨道且不重读概览', async () => {
    const full = fullRailOverview()
    calls.overview.mockResolvedValue(full)
    const wrapper = view(); await flushPromises()
    expect(calls.overview).toHaveBeenCalledTimes(1)
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01'); await flushPromises()
    expect(calls.overview).toHaveBeenCalledTimes(2)
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    calls.overview.mockResolvedValue({ ...overview(), total: 3, countsByCategory: { ...categoryCounts, maintenance: 2 } })
    chart.vm.$emit('select', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00' }); await flushPromises()
    expect(calls.overview).toHaveBeenCalledTimes(3)
    expect(calls.overview.mock.lastCall![0]).toMatchObject({ ...chart.props('selection'), timePrecision: 'timed' })
    expect(chart.props('overview')).toEqual(full)
    expect(chart.props('overview').buckets.map((bucket: { from: string }) => bucket.from)).toEqual(full.buckets.map(bucket => bucket.from))
    expect(wrapper.get('[data-testid="desk-theme-maintenance"]').text()).toContain('3')
    chart.vm.$emit('clear'); await flushPromises()
    expect(chart.props('selection')).toBeNull()
    expect(calls.overview).toHaveBeenCalledTimes(3)
    expect(chart.props('overview')).toEqual(full)
    expect(wrapper.get('[data-testid="desk-theme-maintenance"]').text()).toContain('133')
    expect(calls.events.mock.lastCall![0]).toMatchObject({ from: '2026-07-01T00:00:00+08:00', to: '2026-07-01T23:59:59+08:00', timePrecision: 'all' })
    wrapper.unmount()
  })

  it('切主题、细类和专业筛选只整理下方内容，全部类别和选区外圆点仍来自完整日期', async () => {
    const full = fullRailOverview()
    calls.overview.mockResolvedValue(full)
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01'); await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' }), initialRequests = calls.overview.mock.calls.length
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    await wrapper.get('[aria-label="检修停运类别"]').findAll('button')[2].trigger('click'); await flushPromises()
    expect(calls.overview).toHaveBeenCalledTimes(initialRequests)
    expect(calls.events.mock.lastCall![0]).toMatchObject({ category: 'outage' })
    calls.overview.mockResolvedValue({ ...overview(), total: 1, countsByCategory: { ...categoryCounts, maintenance: 0 } })
    await wrapper.get('[aria-label="检修停运时间关系"]').setValue('incomplete'); await flushPromises()
    expect(chart.props('overview')).toEqual(full)
    expect(calls.overview.mock.lastCall![0]).toMatchObject({ timingFilter: 'incomplete' })
    expect(chart.props('overview').countsByCategory).toEqual(full.countsByCategory)
    expect(chart.props('overview').buckets).toHaveLength(3)
    const unfiltered = calls.overview.mock.calls.filter(([query]) => query.from === '2026-07-01T00:00:00+08:00' && query.to === '2026-07-01T23:59:59+08:00' && query.timePrecision === 'all' && !query.timingFilter)
    expect(unfiltered).toHaveLength(1)
    wrapper.unmount()
  })

  it('选区统计尚未返回就解除时段时，迟到统计不能替换恢复的全天计数与轨道', async () => {
    calls.overview.mockResolvedValue(fullRailOverview())
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01'); await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' }), pending = deferred<unknown>()
    calls.overview.mockReturnValueOnce(pending.promise)
    chart.vm.$emit('select', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00' }); await flushPromises()
    chart.vm.$emit('clear'); await flushPromises()
    const count = calls.overview.mock.calls.length
    pending.resolve({ ...overview(), total: 1, countsByCategory: { ...categoryCounts, maintenance: 0 } }); await flushPromises()
    expect(chart.props('selection')).toBeNull()
    expect(chart.props('overview')).toEqual(fullRailOverview())
    expect(wrapper.get('[data-testid="desk-theme-maintenance"]').text()).toContain('133')
    expect(calls.overview).toHaveBeenCalledTimes(count)
    wrapper.unmount()
  })

  it('顶部搜索更新整条轨道与当前窗口查询，检修设备搜索不会混入轨道请求', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    calls.overview.mockResolvedValue(fullRailOverview())
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    chart.vm.$emit('select', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00' }); await flushPromises()
    await wrapper.get('[aria-label="搜索检修设备或电厂"]').setValue('大朝山')
    await vi.advanceTimersByTimeAsync(260); await flushPromises()
    calls.overview.mockClear()
    await wrapper.get('[data-testid="desk-search"]').setValue('主变')
    await vi.advanceTimersByTimeAsync(260); await flushPromises()
    expect(calls.overview).toHaveBeenCalledTimes(2)
    const requests = calls.overview.mock.calls.map(([query]) => query)
    const rail = requests.find(query => query.from === '2026-07-01T00:00:00+08:00')!
    expect(rail).toMatchObject({ to: '2026-07-01T23:59:59+08:00', keyword: '主变', timePrecision: 'all' })
    expect(rail).not.toHaveProperty('equipmentKeyword')
    expect(rail).not.toHaveProperty('category')
    expect(requests.find(query => query.equipmentKeyword)).toMatchObject({ ...chart.props('selection'), keyword: '主变', equipmentKeyword: '大朝山' })
    wrapper.unmount()
  })

  it.each(['日期', '公司'] as const)('%s切换立即清空旧轨道，旧请求最后返回也不能替换新上下文', async (context) => {
    calls.overview.mockResolvedValue(fullRailOverview())
    const wrapper = view(); await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' }), old = deferred<unknown>(), fresh = deferred<unknown>()
    calls.overview.mockReturnValueOnce(old.promise)
    if (context === '日期') await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    else { (selectedCompanyId as Ref<string | null>).value = 'company-b'; await flushPromises() }
    expect(chart.props('overview')).toBeNull()
    calls.overview.mockReturnValueOnce(fresh.promise)
    if (context === '日期') await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-02')
    else { (selectedCompanyId as Ref<string | null>).value = 'company-c'; await flushPromises() }
    expect(chart.props('overview')).toBeNull()
    fresh.resolve(fullRailOverview(777)); await flushPromises()
    expect(chart.props('overview').total).toBe(777)
    old.resolve(fullRailOverview(999)); await flushPromises()
    expect(chart.props('overview').total).toBe(777)
    wrapper.unmount()
  })

  it('点击图旁非交互留白解除选区但保留主题和专业筛选；控件与图内部点击不会误清选区', async () => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    await wrapper.get('[aria-label="检修停运时间关系"]').setValue('covers-window'); await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    chart.vm.$emit('select', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00' }); await flushPromises()
    const locked = chart.props('selection')
    await wrapper.get('[aria-label="主图指标"]').trigger('click')
    await wrapper.get('.metric-picker').trigger('click')
    await wrapper.get('[data-testid="metric-picker-icon"]').trigger('click')
    await wrapper.get('[data-testid="chart-stub"]').trigger('click'); await flushPromises()
    expect(chart.props('selection')).toEqual(locked)
    await wrapper.get('[data-testid="chart-stub"]').trigger('pointerdown')
    await wrapper.get('.trend-header').trigger('click'); await flushPromises()
    expect(chart.props('selection')).toEqual(locked)
    await wrapper.get('.trend-header').trigger('pointerdown')
    await wrapper.get('.trend-header').trigger('click'); await flushPromises()
    expect(chart.props('selection')).toBeNull()
    expect(wrapper.get('[data-testid="desk-theme-maintenance"]').attributes('aria-pressed')).toBe('true')
    expect((wrapper.get('[aria-label="检修停运时间关系"]').element as HTMLSelectElement).value).toBe('covers-window')
    expect(calls.events.mock.lastCall![0]).toMatchObject({ timePrecision: 'all', timingFilter: 'covers-window', category: 'maintenance,outage' })
    chart.vm.$emit('select', { from: '2026-07-01T11:00:00+08:00', to: '2026-07-01T11:59:59.999+08:00' }); await flushPromises()
    await wrapper.get('.trend-panel').trigger('click'); await flushPromises()
    expect(chart.props('selection')).toBeNull()
    wrapper.unmount()
  })

  it('日期快速切换后忽略旧事件和旧曲线响应', async () => {
    const oldEvents = deferred<unknown>(), oldCurve = deferred<unknown>()
    calls.events.mockImplementationOnce(() => oldEvents.promise)
    calls.series.mockImplementationOnce(() => oldCurve.promise)
    const wrapper = view(); await flushPromises()
    calls.events.mockResolvedValue({ items: [event('new')], total: 1, dataAvailability: availability })
    calls.series.mockResolvedValue(curve(200))
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await flushPromises()
    oldEvents.resolve({ items: [event('old')], total: 999, dataAvailability: availability }); oldCurve.resolve(curve(999))
    await flushPromises()
    expect(wrapper.get('[data-testid="disclosure-list"]').text()).toContain('披露 new')
    expect(wrapper.get('[data-testid="disclosure-list"]').text()).not.toContain('披露 old')
    expect(wrapper.getComponent({ name: 'DeskChartStub' }).props('series')[0].points[0].value).toBe(200)
    wrapper.unmount()
  })

  it('切换公司清空旧选中证据；概览失败不隐藏独立成功的价格', async () => {
    const wrapper = view()
    await flushPromises()
    await wrapper.get('.open-event').trigger('click')
    expect(wrapper.find('[data-testid="evidence-stub"]').exists()).toBe(true)
    calls.overview.mockRejectedValue(new Error('概览读取失败'))
    ;(selectedCompanyId as Ref<string | null>).value = 'company-b'
    await flushPromises()
    expect(wrapper.find('[data-testid="evidence-stub"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('概览读取失败')
    expect(wrapper.getComponent({ name: 'DeskChartStub' }).props('series')[0].points[0].value).toBe(100)
    wrapper.unmount()
  })

  it('点击单事件点按类别和时窗定位，并自动打开唯一记录证据及图上区间', async () => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await flushPromises()
    calls.events.mockResolvedValue({ items: [event('single')], total: 1, dataAvailability: availability })
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    chart.vm.$emit('event-focus', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00', category: 'outage', count: 1 })
    await flushPromises()
    expect(calls.events).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'outage', timePrecision: 'timed', page: 1 }), expect.anything())
    expect(Date.parse(calls.events.mock.lastCall![0].from)).toBe(Date.parse('2026-07-01T10:00:00+08:00'))
    expect(Date.parse(calls.events.mock.lastCall![0].to)).toBe(Date.parse('2026-07-01T10:59:59.999+08:00'))
    expect(wrapper.get('[data-testid="evidence-stub"]').text()).toContain('披露 single')
    expect(chart.props('eventWindow')).toEqual({ from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T11:00:00+08:00' })
    wrapper.unmount()
  })

  it('点击其它类别圆点离开专业筛选并定位原始小时桶，未到期关键词防抖不能再次污染列表', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    calls.overview.mockResolvedValue(fullRailOverview())
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    await wrapper.get('[aria-label="检修停运时间关系"]').setValue('covers-window')
    await wrapper.get('[aria-label="搜索检修设备或电厂"]').setValue('大朝山')
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    const bucket = { from: '2026-07-01T21:00:00+08:00', to: '2026-07-01T21:59:59.999+08:00' }
    chart.vm.$emit('event-focus', { ...bucket, category: 'intervention', count: 2 }); await flushPromises()
    await vi.advanceTimersByTimeAsync(300); await flushPromises()
    expect(wrapper.get('[data-testid="desk-theme-intervention"]').attributes('aria-pressed')).toBe('true')
    expect(calls.events.mock.lastCall![0]).toMatchObject({ category: 'intervention', timePrecision: 'timed', page: 1 })
    expect(Date.parse(calls.events.mock.lastCall![0].from)).toBe(Date.parse(bucket.from))
    expect(Date.parse(calls.events.mock.lastCall![0].to)).toBe(Date.parse(bucket.to))
    expect(calls.events.mock.lastCall![0]).not.toHaveProperty('equipmentKeyword')
    expect(calls.events.mock.lastCall![0]).not.toHaveProperty('timingFilter')
    expect(chart.props('overview')).toEqual(fullRailOverview())
    expect(Date.parse(chart.props('selection').from)).toBe(Date.parse(bucket.from))
    expect(Date.parse(chart.props('selection').to)).toBe(Date.parse(bucket.to))
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    expect((wrapper.get('[aria-label="搜索检修设备或电厂"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('[aria-label="检修停运时间关系"]').element as HTMLSelectElement).value).toBe('all')
    wrapper.unmount()
  })

  it('从15分钟指标点击日桶时保留桶的整日范围，并切到对应披露主题', async () => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await wrapper.get('[data-testid="desk-mode-week"]').trigger('click')
    await wrapper.get('[data-testid="desk-theme-load"]').trigger('click'); await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    const bucket = { from: '2026-06-29T00:00:00+08:00', to: '2026-06-29T23:59:59.999+08:00' }
    chart.vm.$emit('event-focus', { ...bucket, category: 'constraint', count: 3 }); await flushPromises()
    expect(wrapper.get('[data-testid="desk-theme-transmission"]').attributes('aria-pressed')).toBe('true')
    expect(calls.events.mock.lastCall![0]).toMatchObject({ category: 'constraint', timePrecision: 'all' })
    expect(Date.parse(calls.events.mock.lastCall![0].from)).toBe(Date.parse(bucket.from))
    expect(Date.parse(calls.events.mock.lastCall![0].to)).toBe(Date.parse(bucket.to))
    expect(Date.parse(chart.props('selection').from)).toBe(Date.parse(bucket.from))
    expect(Date.parse(chart.props('selection').to)).toBe(Date.parse(bucket.to))
    wrapper.unmount()
  })

  it('从指标读数点击聚合点切回对应类别事件列表，不自动选其中一条', async () => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await wrapper.get('[data-testid="desk-theme-load"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="desk-metric-cards"]').exists()).toBe(true)
    calls.events.mockResolvedValue({ items: [event('aggregate-a'), event('aggregate-b')], total: 2, dataAvailability: availability })
    wrapper.getComponent({ name: 'DeskChartStub' }).vm.$emit('event-focus', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00', category: 'outage', count: 2 })
    await flushPromises()
    expect(calls.events).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'outage', page: 1, timePrecision: 'timed' }), expect.anything())
    expect(wrapper.get('[data-testid="maintenance-list"]').findAll('.open-event')).toHaveLength(2)
    expect(wrapper.find('[data-testid="desk-metric-cards"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="evidence-stub"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('单点数量与实际结果不符时保留列表，不猜测应打开哪条记录', async () => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await flushPromises()
    calls.events.mockResolvedValue({ items: [event('a'), event('b')], total: 2, dataAvailability: availability })
    wrapper.getComponent({ name: 'DeskChartStub' }).vm.$emit('event-focus', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00', category: 'outage', count: 1 })
    await flushPromises()
    expect(wrapper.get('[data-testid="maintenance-list"]').findAll('.open-event')).toHaveLength(2)
    expect(wrapper.find('[data-testid="evidence-stub"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('单事件请求尚未返回就点聚合点，旧响应不能重开详情或覆盖新列表', async () => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await flushPromises()
    const old = deferred<unknown>()
    calls.events.mockImplementationOnce(() => old.promise)
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    chart.vm.$emit('event-focus', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00', category: 'outage', count: 1 })
    await flushPromises()
    calls.events.mockResolvedValue({ items: [event('new-a'), event('new-b')], total: 2, dataAvailability: availability })
    chart.vm.$emit('event-focus', { from: '2026-07-01T11:00:00+08:00', to: '2026-07-01T11:59:59.999+08:00', category: 'maintenance', count: 2 })
    await flushPromises()
    old.resolve({ items: [event('old-single')], total: 1, dataAvailability: availability })
    await flushPromises()
    expect(wrapper.get('[data-testid="maintenance-list"]').text()).toContain('披露 new-a')
    expect(wrapper.get('[data-testid="maintenance-list"]').text()).not.toContain('old-single')
    expect(wrapper.find('[data-testid="evidence-stub"]').exists()).toBe(false)
    expect(calls.events).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'maintenance', page: 1 }), expect.anything())
    wrapper.unmount()
  })

  it('跨日停电按实际停复电区间重叠查询，切主题和细类均保留锁定时段', async () => {
    const crossing = { ...event('crossing'), category: 'maintenance', businessDate: '2026-06-27', effectiveAt: '2026-06-30T19:30:00+08:00', expiresAt: '2026-07-02T08:00:00+08:00', sourceImportedAt: '2026-09-09T06:30:00+08:00', timeQuality: { effective: 'source', published: 'unknown', issues: [] } }
    calls.events.mockResolvedValue({ items: [crossing], total: 1, dataAvailability: availability })
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    chart.vm.$emit('select', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00' })
    await flushPromises()
    const locked = chart.props('selection')
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click')
    await flushPromises()
    expect(calls.events).toHaveBeenLastCalledWith(expect.objectContaining({ ...locked, windowMode: 'overlap', timePrecision: 'timed', category: 'maintenance,outage' }), expect.anything())
    await wrapper.get('[aria-label="检修停运类别"]').findAll('button')[1].trigger('click')
    await flushPromises()
    expect(chart.props('selection')).toEqual(locked)
    expect(calls.events).toHaveBeenLastCalledWith(expect.objectContaining({ ...locked, windowMode: 'overlap', timePrecision: 'timed', category: 'maintenance' }), expect.anything())
    expect(wrapper.get('[data-testid="maintenance-list"]').text()).toContain('披露 crossing')
    await wrapper.get('.open-event').trigger('click')
    expect(chart.props('eventWindow')).toEqual({ from: crossing.effectiveAt, to: crossing.expiresAt })
    expect(chart.props('eventWindow').from).not.toContain('2026-09-09')
    wrapper.unmount()
  })

  it.each([null, '2026-07-01T00:00:00+08:00'])('业务日或导入时间不成为图上实际有效区间：effectiveAt=%s', async (effectiveAt) => {
    calls.events.mockResolvedValue({ items: [{ ...event('day-only'), effectiveAt, expiresAt: null, sourceImportedAt: '2026-09-09T06:30:00+08:00', timeQuality: { effective: 'business-date', published: 'unknown', issues: [] } }], total: 1, dataAvailability: availability })
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await flushPromises()
    await wrapper.get('.open-event').trigger('click')
    expect(wrapper.getComponent({ name: 'DeskChartStub' }).props('eventWindow')).toBeNull()
    expect(wrapper.find('[data-testid="evidence-stub"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('设备与原因关键词共同防抖260ms后作用列表和全量概览，保持原有小时选区', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    chart.vm.$emit('select', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00' }); await flushPromises()
    const locked = chart.props('selection'), eventCount = calls.events.mock.calls.length, overviewCount = calls.overview.mock.calls.length
    await wrapper.get('[aria-label="搜索检修设备或电厂"]').setValue(' 大朝山 ')
    await vi.advanceTimersByTimeAsync(150)
    await wrapper.get('[aria-label="搜索检修停运原因"]').setValue('主机检修')
    await vi.advanceTimersByTimeAsync(259); await flushPromises()
    expect(calls.events).toHaveBeenCalledTimes(eventCount)
    expect(calls.overview).toHaveBeenCalledTimes(overviewCount)
    await vi.advanceTimersByTimeAsync(1); await flushPromises()
    expect(calls.events).toHaveBeenCalledTimes(eventCount + 1)
    expect(calls.overview).toHaveBeenCalledTimes(overviewCount + 1)
    const expected = { ...locked, equipmentKeyword: '大朝山', reasonKeyword: '主机检修', windowMode: 'overlap', timePrecision: 'timed' }
    expect(calls.events).toHaveBeenLastCalledWith(expect.objectContaining({ ...expected, category: 'maintenance,outage', page: 1 }), expect.anything())
    expect(calls.overview).toHaveBeenLastCalledWith(expect.objectContaining(expected), expect.anything())
    expect(chart.props('selection')).toEqual(locked)
    wrapper.unmount()
  })

  it('时间关系过滤当前计数与列表，全天轨道保持不变；排序只重取列表且清空专业筛选不清时窗', async () => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    chart.vm.$emit('select', { from: '2026-07-01T12:00:00+08:00', to: '2026-07-01T12:59:59.999+08:00' }); await flushPromises()
    const locked = chart.props('selection')
    calls.events.mockResolvedValue({ items: [event('filtered')], total: 83, dataAvailability: availability })
    calls.overview.mockResolvedValue({ ...overview(), total: 83, countsByCategory: { ...categoryCounts, maintenance: 82 } })
    await wrapper.get('[aria-label="检修停运时间关系"]').setValue('covers-window'); await flushPromises()
    expect(calls.events).toHaveBeenLastCalledWith(expect.objectContaining({ ...locked, timingFilter: 'covers-window' }), expect.anything())
    expect(calls.overview).toHaveBeenLastCalledWith(expect.objectContaining({ ...locked, timingFilter: 'covers-window' }), expect.anything())
    expect(wrapper.get('[data-testid="maintenance-list"]').findAll('li')).toHaveLength(1)
    expect(wrapper.get('[aria-label="检修信息展示方式"]').text()).toContain('共 83 条匹配记录')
    expect(chart.props('overview').total).toBe(131)
    expect(wrapper.get('[data-testid="desk-theme-maintenance"]').text()).toContain('83')
    const overviewCount = calls.overview.mock.calls.length
    await wrapper.get('[aria-label="检修停运排序"]').setValue('duration-desc'); await flushPromises()
    expect(calls.events).toHaveBeenLastCalledWith(expect.objectContaining({ timingFilter: 'covers-window', sort: 'duration-desc', page: 1 }), expect.anything())
    expect(calls.overview.mock.lastCall![0]).toMatchObject({ ...locked, timingFilter: 'covers-window' })
    expect(calls.overview.mock.lastCall![0]).not.toHaveProperty('sort')
    expect(calls.overview).toHaveBeenCalledTimes(overviewCount)
    expect(chart.props('overview').total).toBe(131)
    await wrapper.get('[aria-label="下一页披露"]').trigger('click'); await flushPromises()
    expect(calls.events).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, sort: 'duration-desc' }), expect.anything())
    await wrapper.get('[data-testid="maintenance-tools"] .clear').trigger('click'); await flushPromises()
    expect(calls.events.mock.lastCall![0]).not.toHaveProperty('timingFilter')
    expect(calls.events.mock.lastCall![0]).not.toHaveProperty('sort')
    expect(calls.overview.mock.lastCall![0]).not.toHaveProperty('timingFilter')
    expect(calls.events.mock.lastCall![0]).toMatchObject({ ...locked, page: 1, category: 'maintenance,outage' })
    expect(chart.props('selection')).toEqual(locked)
    wrapper.unmount()
  })

  it('时间不完整筛选解除timed限制，完整日级记录仍被纳入当前选区查询', async () => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    const chart = wrapper.getComponent({ name: 'DeskChartStub' })
    chart.vm.$emit('select', { from: '2026-07-01T12:00:00+08:00', to: '2026-07-01T12:59:59.999+08:00' }); await flushPromises()
    const locked = chart.props('selection')
    await wrapper.get('[aria-label="检修停运时间关系"]').setValue('incomplete'); await flushPromises()
    expect(calls.events).toHaveBeenLastCalledWith(expect.objectContaining({ ...locked, timePrecision: 'all', timingFilter: 'incomplete' }), expect.anything())
    expect(calls.overview).toHaveBeenLastCalledWith(expect.objectContaining({ ...locked, timePrecision: 'all', timingFilter: 'incomplete' }), expect.anything())
    chart.vm.$emit('select', { from: '2026-07-01T13:00:00+08:00', to: '2026-07-01T13:59:59.999+08:00' }); await flushPromises()
    expect(calls.events).toHaveBeenLastCalledWith(expect.objectContaining({ ...chart.props('selection'), timePrecision: 'all', timingFilter: 'incomplete' }), expect.anything())
    expect(calls.overview).toHaveBeenLastCalledWith(expect.objectContaining({ ...chart.props('selection'), timePrecision: 'all', timingFilter: 'incomplete' }), expect.anything())
    wrapper.unmount()
  })

  it('检修紧凑列表点击可打开详情，切换卡片保留已选事件且不重载接口', async () => {
    const wrapper = view()
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="maintenance-list"]').findAll('.open-event')).toHaveLength(1)
    expect(wrapper.findAll('.event-card')).toHaveLength(0)
    await wrapper.get('.open-event').trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="evidence-stub"]').text()).toBe('披露 a')
    expect(wrapper.get('.open-event').attributes('aria-pressed')).toBe('true')
    const before = calls.events.mock.calls.length
    await wrapper.get('[aria-label="检修信息展示方式"]').findAll('button').find(button => button.text() === '信息卡片')!.trigger('click'); await flushPromises()
    expect(wrapper.find('[data-testid="maintenance-list"]').exists()).toBe(false)
    expect(wrapper.get('.event-card').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="evidence-stub"]').text()).toBe('披露 a')
    expect(calls.events).toHaveBeenCalledTimes(before)
    await wrapper.get('[aria-label="检修信息展示方式"]').findAll('button').find(button => button.text() === '紧凑列表')!.trigger('click'); await flushPromises()
    expect(wrapper.get('.open-event').attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('切公司清空专业筛选并取消尚未触发的旧公司关键词防抖', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const wrapper = view()
    await wrapper.get('[data-testid="desk-theme-maintenance"]').trigger('click'); await flushPromises()
    await wrapper.get('[aria-label="检修停运类别"]').findAll('button')[2].trigger('click')
    await wrapper.get('[aria-label="检修停运时间关系"]').setValue('ends-in-window')
    await wrapper.get('[aria-label="检修停运排序"]').setValue('end-asc')
    await wrapper.get('[aria-label="搜索检修设备或电厂"]').setValue('公司A电厂')
    await vi.advanceTimersByTimeAsync(100)
    ;(selectedCompanyId as Ref<string | null>).value = 'company-b'; await flushPromises()
    await vi.advanceTimersByTimeAsync(300); await flushPromises()
    expect((wrapper.get('[aria-label="搜索检修设备或电厂"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('[aria-label="检修停运时间关系"]').element as HTMLSelectElement).value).toBe('all')
    expect((wrapper.get('[aria-label="检修停运排序"]').element as HTMLSelectElement).value).toBe('default')
    expect(calls.events.mock.lastCall![0]).toMatchObject({ category: 'maintenance,outage' })
    expect(calls.events.mock.lastCall![0]).not.toHaveProperty('equipmentKeyword')
    expect(calls.events.mock.lastCall![0]).not.toHaveProperty('timingFilter')
    expect(calls.overview.mock.lastCall![0]).not.toHaveProperty('equipmentKeyword')
    wrapper.unmount()
  })

  it('指标自动回填selectedChannel只渲染一次，不因设置下拉值重复取数', async () => {
    const wrapper = view(); await flushPromises()
    calls.series.mockResolvedValue(channelCurve())
    const before = calls.series.mock.calls.length
    await wrapper.get('[data-testid="desk-theme-transmission"]').trigger('click'); await flushPromises()
    expect((wrapper.get('[aria-label="指标地区或通道"]').element as HTMLSelectElement).value).toBe('云南总送出 · 云南')
    expect(wrapper.get('[aria-label="指标地区或通道"]').attributes('disabled')).toBeUndefined()
    expect(calls.series).toHaveBeenCalledTimes(before + 1)
    expect(wrapper.getComponent({ name: 'DeskChartStub' }).props('series')[0].points[0].value).toBe(100)
    wrapper.unmount()
  })

  it('手动换对象只取一次并记忆该公司指标偏好，再次进入时携带preferredChannel', async () => {
    const wrapper = view(); await flushPromises()
    calls.series.mockImplementation(async query => query.metricId === 'transmission' ? channelCurve(query.channel ?? query.preferredChannel ?? '云南总送出 · 云南') : curve())
    await wrapper.get('[data-testid="desk-theme-transmission"]').trigger('click'); await flushPromises()
    const before = calls.series.mock.calls.length
    await wrapper.get('[aria-label="指标地区或通道"]').setValue('云南省网送广东 · 云南'); await flushPromises()
    expect(calls.series).toHaveBeenCalledTimes(before + 1)
    expect(calls.series.mock.lastCall![0]).toMatchObject({ metricId: 'transmission', channel: '云南省网送广东 · 云南', preferredChannel: '云南省网送广东 · 云南', scopeKey: 'yunnan:company-a' })
    await wrapper.get('[data-testid="desk-theme-load"]').trigger('click'); await flushPromises()
    await wrapper.get('[data-testid="desk-theme-transmission"]').trigger('click'); await flushPromises()
    expect(calls.series.mock.lastCall![0]).toMatchObject({ metricId: 'transmission', preferredChannel: '云南省网送广东 · 云南' })
    expect(calls.series.mock.lastCall![0]).not.toHaveProperty('channel')
    expect((wrapper.get('[aria-label="指标地区或通道"]').element as HTMLSelectElement).value).toBe('云南省网送广东 · 云南')
    ;(selectedCompanyId as Ref<string | null>).value = 'company-b'; await flushPromises()
    expect(calls.series.mock.lastCall![0].preferredChannel).toBeUndefined()
    wrapper.unmount()
  })

  it('日期变更后的旧曲线响应不能回填旧对象或覆盖当前读数', async () => {
    const wrapper = view(); await flushPromises()
    const oldSeries = deferred<unknown>()
    calls.series.mockReturnValueOnce(oldSeries.promise)
    await wrapper.get('[data-testid="desk-theme-transmission"]').trigger('click'); await flushPromises()
    calls.series.mockResolvedValue(channelCurve('云南省网送广东 · 云南', 222))
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-03'); await flushPromises()
    oldSeries.resolve(channelCurve('云南总送出 · 云南', 999)); await flushPromises()
    expect((wrapper.get('[aria-label="指标地区或通道"]').element as HTMLSelectElement).value).toBe('云南省网送广东 · 云南')
    expect(wrapper.getComponent({ name: 'DeskChartStub' }).props('series')[0].points[0].value).toBe(222)
    wrapper.unmount()
  })
})

// 洞察深链承接（dljy#3106 D6.1）：电网边界页「在空间视图查看」经 keyword/objectDate
// 预填披露检索与业务日期；只认合法单值，数组/非法日历日按缺省处理，不伪造上下文。
describe('洞察深链：keyword 与业务日期预填', () => {
  const deskStubs = { DisclosureDeskChart: chartStub, DisclosureMetricPicker: metricPickerStub, DisclosureDeskInsights: insightsStub, DisclosureUnitRoster: rosterStub, DisclosureEventGroups: groupsStub }

  async function mountWithQuery(query: Record<string, unknown>) {
    const { createMemoryHistory, createRouter } = await import('vue-router')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/grid-assets/disclosures', component: GridDisclosureSpatialView }] })
    await router.push({ path: '/grid-assets/disclosures', query: query as Record<string, string> })
    await router.isReady()
    const wrapper = mount(GridDisclosureSpatialView, { global: { plugins: [router], stubs: deskStubs } })
    await flushPromises()
    return wrapper
  }

  it('keyword 预填搜索框并进入首个请求；objectDate 落到洞察窗口末日', async () => {
    const wrapper = await mountWithQuery({ keyword: '  某输电通道 ', objectDate: '2026-07-01' })
    expect((wrapper.get('[data-testid="desk-search"]').element as HTMLInputElement).value).toBe('某输电通道')
    expect(calls.groups.mock.calls.length).toBeGreaterThan(0)
    expect(calls.groups.mock.lastCall![0]).toMatchObject({ keyword: '某输电通道', from: '2026-07-01T00:00:00+08:00', to: '2026-07-01T23:59:59+08:00' })
    expect(calls.overview.mock.lastCall![0].keyword).toBe('某输电通道')
    // 无对象上下文键：不触发对象关联读取，也不出现对象范围说明
    expect(wrapper.find('.object-scope-note').exists()).toBe(false)
    wrapper.unmount()
  })

  it('数组 keyword 与非法日历日不进请求：按无词、今天处理', async () => {
    const wrapper = await mountWithQuery({ keyword: ['a', 'b'], objectDate: '2026-02-30' })
    expect((wrapper.get('[data-testid="desk-search"]').element as HTMLInputElement).value).toBe('')
    expect(calls.groups.mock.lastCall![0]).toMatchObject({ from: '2026-09-09T00:00:00+08:00' })
    expect(calls.groups.mock.lastCall![0].keyword).toBeUndefined()
    wrapper.unmount()
  })
})

describe('洞察深链在保活复用下按签名生效', () => {
  const deskStubs = { DisclosureDeskChart: chartStub, DisclosureMetricPicker: metricPickerStub, DisclosureDeskInsights: insightsStub, DisclosureUnitRoster: rosterStub, DisclosureEventGroups: groupsStub }

  it('离开后再带新深链进入（实例未销毁）：新签名立即应用；同一签名与无键返回保留现场', async () => {
    const { createMemoryHistory, createRouter } = await import('vue-router')
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/grid-assets/disclosures', component: GridDisclosureSpatialView },
        { path: '/other', component: { render: () => null } },
      ],
    })
    await router.push({ path: '/grid-assets/disclosures', query: { keyword: '第一条通道', objectDate: '2026-07-01' } })
    await router.isReady()
    const wrapper = mount(GridDisclosureSpatialView, { global: { plugins: [router], stubs: deskStubs } })
    await flushPromises()
    expect((wrapper.get('[data-testid="desk-search"]').element as HTMLInputElement).value).toBe('第一条通道')

    // 用户本地改动搜索词（现场）
    await wrapper.get('[data-testid="desk-search"]').setValue('本地改动')

    // 同一签名再次进入：保留本地编辑
    await router.push({ path: '/grid-assets/disclosures', query: { keyword: '第一条通道', objectDate: '2026-07-01' } })
    await flushPromises()
    expect((wrapper.get('[data-testid="desk-search"]').element as HTMLInputElement).value).toBe('本地改动')

    // 离开（保活隐藏）后带新深链回来：新签名立即生效
    await router.push('/other')
    await flushPromises()
    await router.push({ path: '/grid-assets/disclosures', query: { keyword: '第二条通道', objectDate: '2026-07-02' } })
    await flushPromises()
    expect((wrapper.get('[data-testid="desk-search"]').element as HTMLInputElement).value).toBe('第二条通道')
    expect((wrapper.get('[data-testid="desk-date"]').element as HTMLInputElement).value).toBe('2026-07-02')
    expect(calls.groups.mock.lastCall![0]).toMatchObject({ keyword: '第二条通道', from: '2026-07-02T00:00:00+08:00' })

    // 不带深链键的普通导航（菜单返回）：不覆盖现场
    await router.push('/other')
    await flushPromises()
    await router.push({ path: '/grid-assets/disclosures' })
    await flushPromises()
    expect((wrapper.get('[data-testid="desk-search"]').element as HTMLInputElement).value).toBe('第二条通道')
    expect((wrapper.get('[data-testid="desk-date"]').element as HTMLInputElement).value).toBe('2026-07-02')

    wrapper.unmount()
  })

  it('接受新深链签名时重置时间范围：近七日模式与时段锁定不套在新词上', async () => {
    const { createMemoryHistory, createRouter } = await import('vue-router')
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/grid-assets/disclosures', component: GridDisclosureSpatialView },
        { path: '/other', component: { render: () => null } },
      ],
    })
    await router.push({ path: '/grid-assets/disclosures', query: { keyword: '第一条通道', objectDate: '2026-07-01' } })
    await router.isReady()
    const wrapper = mount(GridDisclosureSpatialView, { global: { plugins: [router], stubs: deskStubs } })
    await flushPromises()
    // 缓存页遗留：近七日模式
    await wrapper.get('[data-testid="desk-mode-week"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="desk-mode-week"]').attributes('aria-pressed')).toBe('true')

    await router.push('/other')
    await flushPromises()
    await router.push({ path: '/grid-assets/disclosures', query: { keyword: '第二条通道', objectDate: '2026-07-02' } })
    await flushPromises()
    // 新深链落地：回到单日盯盘，时间范围按链接日期整日展开
    expect(wrapper.get('[data-testid="desk-mode-day"]').attributes('aria-pressed')).toBe('true')
    expect(calls.groups.mock.lastCall![0]).toMatchObject({ keyword: '第二条通道', from: '2026-07-02T00:00:00+08:00', category: 'congestion,constraint' })
    wrapper.unmount()
  })

  it('grid-geo 对象上下文链接（带 objectDate 但无 keyword/from）不算通道深链：主题不被切走', async () => {
    const { createMemoryHistory, createRouter } = await import('vue-router')
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/grid-assets/disclosures', component: GridDisclosureSpatialView }],
    })
    await router.push({ path: '/grid-assets/disclosures' })
    await router.isReady()
    const wrapper = mount(GridDisclosureSpatialView, { global: { plugins: [router], stubs: deskStubs } })
    await flushPromises()
    const baseline = calls.groups.mock.calls.length

    await router.push({ path: '/grid-assets/disclosures', query: { objectKind: 'disclosure', objectId: 'E1', objectRegion: 'yunnan', objectCompany: 'company-a', objectDate: '2026-07-05' } })
    await flushPromises()
    // 只有洞察电网边界页的通道深链（from=insight-grid-boundaries 或带 keyword）才落「联络线与断面」主题；
    // 门控失效时 chooseTheme('transmission') 会让组查询带上输电主题的类别过滤
    for (const call of calls.groups.mock.calls.slice(baseline)) {
      expect(call[0]).not.toHaveProperty('category', 'congestion,constraint')
    }
    wrapper.unmount()
  })
})
