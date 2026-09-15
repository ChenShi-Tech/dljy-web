// Cross-page object identity must constrain every disclosure query and never retain another object's curve.
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ref } from 'vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import GridDisclosureSpatialView from './GridDisclosureSpatialView.vue'
import { getDisclosureDeskMetric, type DeskDataResult, type DeskLoadParams } from './disclosureDeskData'
import { useGridObjectContext } from './useGridObjectContext'
import type { GridObjectDetail, GridObjectReference } from './objectNavigation'

const calls = vi.hoisted(() => ({ overview: vi.fn(), events: vi.fn(), groups: vi.fn(), providers: vi.fn(), series: vi.fn(), themes: vi.fn() }))
vi.mock('./client', () => ({ fetchGridDisclosureOverview: calls.overview, fetchGridDisclosureEvents: calls.events, fetchGridDisclosureGroups: calls.groups, fetchGridDisclosureProviders: calls.providers }))
vi.mock('@/services/region/regionContext', async () => { const { ref } = await import('vue'); return { currentRegion: ref({ id: 'yunnan', shortName: '云南' }) } })
vi.mock('@/services/company/companyContext', async () => { const { ref } = await import('vue'); return { selectedCompanyId: ref('company-a') } })
vi.mock('@/utils/beijingDate', () => ({ todayBeijing: () => '2026-09-09' }))
vi.mock('./disclosureDeskData', async original => ({ ...await original<typeof import('./disclosureDeskData')>(), loadDisclosureDeskSeries: calls.series, loadDisclosureDeskThemeAvailability: calls.themes }))
vi.mock('./useGridObjectContext', async () => {
  const { ref } = await import('vue')
  const context = { reference: ref(null), detail: ref(null), date: ref('2026-07-01'), timeWindow: ref(null), error: ref(''), loading: ref(false), hasContext: ref(true), active: ref(true) }
  return { useGridObjectContext: () => context }
})
vi.mock('./GridObjectContextBar.vue', () => ({ default: { name: 'ObjectContextBarStub', props: ['date', 'from', 'to'], template: '<div data-context-bar />' } }))
vi.mock('./GridObjectDrawer.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./DisclosureEvidencePanel.vue', () => ({ default: { props: ['event'], template: '<div />' } }))
const chartStub = { name: 'ObjectDeskChartStub', props: ['series', 'overview', 'dateFrom', 'dateTo', 'selection', 'emptyReason'], emits: ['select', 'clear'], template: '<div class="desk-chart-wrap" />' }
const metricPickerStub = { name: 'ObjectMetricPickerStub', props: ['modelValue', 'groups'], emits: ['update:modelValue', 'change'], template: '<div class="metric-picker"><select :value="modelValue" aria-label="主图指标" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\')"><optgroup v-for="group in groups" :key="group.id" :label="group.label"><option v-for="metric in group.metrics" :key="metric.id" :value="metric.id">{{ metric.label }}</option></optgroup></select></div>' }
const groupStub = { name: 'ObjectGroupsStub', props: ['groups', 'query'], template: '<div data-groups />' }
const listStub = { name: 'ObjectListStub', props: ['rows'], template: '<div data-list />' }
const context = useGridObjectContext()
const wrappers: VueWrapper[] = []
const counts = { maintenance: 1, outage: 0, intervention: 0, congestion: 0, constraint: 0 }
const availability = { status: 'available', reason: '已接入', fallback: false }
function reference(id: string): GridObjectReference { return { kind: 'plant', id, regionId: 'yunnan' } }
function detail(id: string, metricRefs?: GridObjectDetail['metricRefs']): GridObjectDetail {
  return { reference: reference(id), name: `对象${id}`, objectType: '场站', capacityMw: null, voltageLevelKv: null, stationName: null, location: { label: '云南', longitude: null, latitude: null, status: 'unresolved' }, relations: { plants: [], nodes: [] }, disclosureFilter: { objectKind: 'plant', objectId: id }, metricRefs, overlays: [], source: { label: '公开记录', updatedAt: null, evidence: [] } }
}
function setObject(id: string, resolved = true, metricRefs?: GridObjectDetail['metricRefs']) {
  ;(context.reference as Ref<GridObjectReference | null>).value = reference(id)
  context.detail.value = resolved ? detail(id, metricRefs) : null
  context.loading.value = !resolved
}
function overview(total = 1) { return { total, countsByCategory: counts, dayOnlyCount: total, dayOnlyCountsByCategory: counts, buckets: [], bucket: 'hour', coverage: { from: '2026-07-01', to: '2026-07-01', total, timeBasis: 'businessDate', publishedTimeKnown: 0, sourceImportedTimeKnown: total, effectiveTimeKnown: 0 }, dataAvailability: availability } }
function groups() { return { items: [{ groupKey: 'plant:yunnan:A', label: '对象A', kind: 'plant', regionId: 'yunnan', total: 1, countsByCategory: counts }], total: 1, groupTotal: 1, page: 1, pageSize: 12, dataAvailability: availability } }
function curve(value = 111, selectedChannel?: string, metricId = 'price'): DeskDataResult {
  return { metric: getDisclosureDeskMetric(metricId)!, series: [{ id: 'curve', label: `对象值${value}`, unit: metricId === 'price' ? '元/MWh' : 'MW', nativeMinutes: 60, step: 'end', points: [{ time: '2026-07-01 10:00', value }] }], channels: selectedChannel ? [selectedChannel] : [], ...(selectedChannel ? { selectedChannel } : {}), status: 'available', reason: '', sourceType: 'DB', latestAt: '2026-07-01 10:00', summary: [], warnings: [] }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function view() {
  const wrapper = mount(GridDisclosureSpatialView, { global: { stubs: { DisclosureDeskChart: chartStub, DisclosureMetricPicker: metricPickerStub, DisclosureEventGroups: groupStub, DisclosureMaintenanceList: listStub, DisclosureDeskInsights: true, DisclosureUnitRoster: true, DisclosureRegionContext: true } } })
  wrappers.push(wrapper); return wrapper
}
function chart(wrapper: VueWrapper) { return wrapper.getComponent({ name: 'ObjectDeskChartStub' }) }
async function useList(wrapper: VueWrapper) { await wrapper.get('[aria-label="披露信息展示方式"]').findAll('button').find(button => button.text() === '紧凑列表')!.trigger('click'); await flushPromises() }
beforeEach(() => {
  vi.resetAllMocks()
  ;(selectedCompanyId as Ref<string | null>).value = 'company-a'
  ;(context.hasContext as Ref<boolean>).value = true
  ;(context.active as Ref<boolean>).value = true
  ;(context.date as Ref<string>).value = '2026-07-01'
  ;(context.timeWindow as Ref<{ from: string; to: string } | null>).value = null
  context.error.value = ''; setObject('A')
  calls.overview.mockResolvedValue(overview())
  calls.groups.mockResolvedValue(groups())
  calls.events.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 18, dataAvailability: availability })
  calls.providers.mockResolvedValue({ providers: [] })
  calls.series.mockResolvedValue(curve())
  calls.themes.mockResolvedValue({})
})
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount(); vi.useRealTimers() })

describe('公开披露页统一对象上下文接线', () => {
  it('跨页明确传入的历史日用于披露查询，只有点击今天才切换业务日', async () => {
    ;(context.date as Ref<string>).value = '2026-05-01'
    const wrapper = view(); await flushPromises()
    expect(wrapper.get('[data-testid="desk-date"]').element).toMatchObject({ value: '2026-05-01' })
    expect(calls.groups.mock.lastCall?.[0]).toMatchObject({ objectKind: 'plant', objectId: 'A', from: '2026-05-01T00:00:00+08:00' })
    expect(calls.series.mock.lastCall?.[0]).toMatchObject({ dateFrom: '2026-05-01', dateTo: '2026-05-01' })
    expect(wrapper.text()).toContain('数据回看')
    await wrapper.findAll('button').find(button => button.text() === '今天')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="desk-date"]').element).toMatchObject({ value: '2026-09-09' })
    expect(calls.groups.mock.lastCall?.[0]).toMatchObject({ objectKind: 'plant', objectId: 'A', from: '2026-09-09T00:00:00+08:00' })
    expect(calls.series.mock.lastCall?.[0]).toMatchObject({ dateFrom: '2026-09-09', dateTo: '2026-09-09' })
  })

  it('选择器切换指标保留对象和时窗，返回已绑定指标仍使用该对象的明确通道', async () => {
    setObject('A', false)
    calls.series.mockImplementation(async (query: DeskLoadParams) => curve(100, query.channel, query.metricId))
    const wrapper = view(); await flushPromises()
    context.detail.value = detail('A', [{ metricId: 'section-constraint', channel: '目标断面' }]); context.loading.value = false; await flushPromises()
    chart(wrapper).vm.$emit('select', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00' }); await flushPromises()
    const locked = chart(wrapper).props('selection')
    const picker = wrapper.getComponent({ name: 'ObjectMetricPickerStub' })
    expect(picker.props('modelValue')).toBe('section-constraint')
    await wrapper.get('[aria-label="主图指标"]').setValue('non-market'); await flushPromises()
    expect(wrapper.get('[data-testid="desk-theme-load"]').attributes('aria-pressed')).toBe('true')
    expect(calls.series.mock.lastCall![0]).toMatchObject({ metricId: 'non-market', dateFrom: '2026-07-01' })
    expect(chart(wrapper).props('selection')).toEqual(locked)
    await wrapper.get('[aria-label="主图指标"]').setValue('section-constraint'); await flushPromises()
    expect(picker.props('modelValue')).toBe('section-constraint')
    expect(calls.series.mock.lastCall![0]).toMatchObject({ metricId: 'section-constraint', channel: '目标断面' })
    expect(wrapper.get('[data-testid="desk-theme-transmission"]').attributes('aria-pressed')).toBe('true')
    expect(chart(wrapper).props('selection')).toEqual(locked)
    expect(wrapper.getComponent({ name: 'ObjectGroupsStub' }).props('query')).toMatchObject({ objectKind: 'plant', objectId: 'A', ...locked })
    expect(chart(wrapper).props('series')).toEqual(curve(100, '目标断面', 'section-constraint').series)
  })

  it('轨道、选区统计、分组、分组明细查询与紧凑列表全部携带同一对象筛选', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const wrapper = view(); await flushPromises()
    await wrapper.get('[data-testid="desk-search"]').setValue('检修原因')
    await vi.advanceTimersByTimeAsync(270); await flushPromises()
    chart(wrapper).vm.$emit('select', { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T11:00:00+08:00' }); await flushPromises()
    expect(wrapper.getComponent({ name: 'ObjectGroupsStub' }).props('query')).toMatchObject({ objectKind: 'plant', objectId: 'A', keyword: '检修原因', windowMode: 'overlap', timePrecision: 'timed' })
    expect(calls.groups.mock.lastCall?.[0]).toMatchObject({ objectKind: 'plant', objectId: 'A', keyword: '检修原因' })
    const rail = calls.overview.mock.calls.filter(([query]) => query.timePrecision === 'all').at(-1)?.[0]
    const window = calls.overview.mock.calls.filter(([query]) => query.timePrecision === 'timed').at(-1)?.[0]
    expect(rail).toMatchObject({ objectKind: 'plant', objectId: 'A', keyword: '检修原因', from: '2026-07-01T00:00:00+08:00' })
    expect(window).toMatchObject({ objectKind: 'plant', objectId: 'A', keyword: '检修原因', from: '2026-07-01T10:00:00.000+08:00' })
    await useList(wrapper)
    expect(calls.events.mock.lastCall?.[0]).toMatchObject({ objectKind: 'plant', objectId: 'A', keyword: '检修原因', ...chart(wrapper).props('selection') })
    for (const [query] of [...calls.overview.mock.calls, ...calls.groups.mock.calls, ...calls.events.mock.calls]) expect(query).toMatchObject({ objectKind: 'plant', objectId: 'A' })
  })
  it('跨公司无效对象上下文不请求全量披露或旧对象曲线', async () => {
    ;(selectedCompanyId as Ref<string | null>).value = 'company-b'
    ;(context.reference as Ref<GridObjectReference | null>).value = null
    context.detail.value = null; context.error.value = '对象不属于当前公司'; context.loading.value = false
    const wrapper = view(); await flushPromises(); await useList(wrapper)
    expect(calls.overview).not.toHaveBeenCalled(); expect(calls.groups).not.toHaveBeenCalled(); expect(calls.events).not.toHaveBeenCalled(); expect(calls.series).not.toHaveBeenCalled()
    expect(chart(wrapper).props('series')).toEqual([])
    expect(chart(wrapper).props('overview')).toBeNull()
  })
  it('切换公司立刻中止旧披露查询，晚到统计不会重新填回页面', async () => {
    const pending = deferred<ReturnType<typeof overview>>(); calls.overview.mockReturnValueOnce(pending.promise)
    const wrapper = view(); await flushPromises()
    const signal = calls.overview.mock.calls[0]?.[1].signal as AbortSignal
    const count = calls.groups.mock.calls.length
    ;(selectedCompanyId as Ref<string | null>).value = 'company-b'
    ;(context.reference as Ref<GridObjectReference | null>).value = null
    context.detail.value = null; await flushPromises()
    expect(signal.aborted).toBe(true)
    expect(calls.groups).toHaveBeenCalledTimes(count)
    pending.resolve(overview(999)); await flushPromises()
    expect(chart(wrapper).props('overview')).toBeNull()
    expect(wrapper.text()).not.toContain('999')
    expect(chart(wrapper).props('series')).toEqual([])
  })
  it('同组件 A 切到无法解析的 B 时清除 A 曲线，并忽略晚到的 A 数据', async () => {
    const wrapper = view(); await flushPromises()
    expect(chart(wrapper).props('series')).toEqual(curve().series)
    const pending = deferred<DeskDataResult>(); calls.series.mockReturnValueOnce(pending.promise)
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-02'); await flushPromises()
    setObject('B', false); await flushPromises()
    expect(chart(wrapper).props('series')).toEqual([])
    pending.resolve(curve(999)); context.loading.value = false; context.error.value = '当前对象无法解析'; await flushPromises()
    expect(chart(wrapper).props('series')).toEqual([])
    expect(wrapper.text()).not.toContain('对象值999')
    expect(calls.groups.mock.lastCall?.[0]).toMatchObject({ objectKind: 'plant', objectId: 'B' })
  })
  it('KeepAlive 返回相同对象保留本地改日和关键词，后续请求使用现场条件', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    setObject('A', false)
    const wrapper = view(); await flushPromises()
    context.detail.value = detail('A'); context.loading.value = false; await flushPromises()
    await wrapper.get('[data-testid="desk-date"]').setValue('2026-07-03')
    await wrapper.get('[data-testid="desk-search"]').setValue('现场搜索')
    await vi.advanceTimersByTimeAsync(270); await flushPromises()
    ;(context.active as Ref<boolean>).value = false; context.detail.value = null; await flushPromises()
    ;(context.active as Ref<boolean>).value = true; context.loading.value = true; await flushPromises()
    context.detail.value = detail('A'); context.loading.value = false; await flushPromises()
    expect(wrapper.get('[data-testid="desk-date"]').element).toMatchObject({ value: '2026-07-03' })
    expect(wrapper.get('[data-testid="desk-search"]').element).toMatchObject({ value: '现场搜索' })
    await wrapper.get('[data-testid="desk-refresh"]').trigger('click'); await flushPromises()
    expect(calls.groups.mock.lastCall?.[0]).toMatchObject({ from: '2026-07-03T00:00:00+08:00', keyword: '现场搜索', objectId: 'A' })
    expect(wrapper.getComponent({ name: 'ObjectContextBarStub' }).props('date')).toBe('2026-07-03')
  })
  it('明确断面绑定强制指定通道，并清空底层默认返回的其他通道曲线', async () => {
    setObject('A', false)
    calls.series.mockImplementation(async (query: DeskLoadParams) => curve(888, '无关断面', query.metricId))
    const wrapper = view(); await flushPromises()
    context.detail.value = detail('A', [{ metricId: 'section-constraint', channel: '目标断面' }]); context.loading.value = false; await flushPromises()
    expect(calls.series.mock.lastCall?.[0]).toMatchObject({ metricId: 'section-constraint', channel: '目标断面' })
    expect(chart(wrapper).props('series')).toEqual([])
    expect(chart(wrapper).props('emptyReason')).toContain('不展示其他通道替代')
    expect(wrapper.text()).not.toContain('对象值888')
    calls.series.mockImplementation(async (query: DeskLoadParams) => curve(0, query.channel, query.metricId))
    await wrapper.get('[data-testid="desk-refresh"]').trigger('click'); await flushPromises()
    expect(chart(wrapper).props('series')).toEqual(curve(0, '目标断面', 'section-constraint').series)
  })
})
