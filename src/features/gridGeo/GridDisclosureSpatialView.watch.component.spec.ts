// 守住公开披露页“日前盯盘”入口与原页状态隔离（dljy#3484，规格 DW-12）：
// 页面关键词、主题、分页不进入研判请求；关闭弹窗后焦点回到入口按钮，原日期/关键词/分页不变。
// 坏掉的症状：在第二页、带关键词时启动研判被列表筛选裁剪；关闭后键盘焦点丢到 body；关闭弹窗把列表打回第一页。
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ref } from 'vue'
import { liveTradeDate } from 'shared/schema/disclosure-watch-contract.mjs'
import GridDisclosureSpatialView from './GridDisclosureSpatialView.vue'
import { currentRegion } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { getDisclosureDeskMetric } from './disclosureDeskData'

const calls = vi.hoisted(() => ({ overview: vi.fn(), events: vi.fn(), groups: vi.fn(), providers: vi.fn(), series: vi.fn(), themeAvailability: vi.fn() }))
const watchApi = vi.hoisted(() => ({ caps: vi.fn(), run: vi.fn() }))
vi.mock('./client', () => ({ fetchGridDisclosureOverview: calls.overview, fetchGridDisclosureEvents: calls.events, fetchGridDisclosureGroups: calls.groups, fetchGridDisclosureProviders: calls.providers, fetchGridObject: vi.fn(async () => { throw new Error('对象详情不在本组用例范围') }) }))
vi.mock('@/services/region/regionContext', async () => { const { ref } = await import('vue'); return { currentRegion: ref({ id: 'yunnan', shortName: '云南' }) } })
vi.mock('@/services/company/companyContext', async () => { const { ref } = await import('vue'); return { selectedCompanyId: ref('company-a') } })
vi.mock('@/utils/beijingDate', () => ({ todayBeijing: () => '2026-09-09' }))
vi.mock('./disclosureDeskData', async (original) => ({ ...await original<typeof import('./disclosureDeskData')>(), loadDisclosureDeskSeries: calls.series, loadDisclosureDeskThemeAvailability: calls.themeAvailability }))
vi.mock('@/services/gridGeo/disclosureWatch', async (original) => ({ ...await original<typeof import('@/services/gridGeo/disclosureWatch')>(), fetchDisclosureWatchCapabilities: watchApi.caps, runDisclosureWatch: watchApi.run, newDisclosureWatchIdempotencyKey: () => 'key-page' }))

const chartStub = { name: 'DeskChartStub', props: ['series', 'overview', 'dateFrom', 'dateTo', 'selection', 'eventWindow'], emits: ['select', 'hover', 'event-focus', 'clear'], template: '<div class="desk-chart-wrap" />' }
const pickerStub = { name: 'MetricPickerStub', props: ['modelValue', 'groups'], emits: ['update:modelValue', 'change'], template: '<div class="metric-picker" />' }
const plainStub = { props: ['regionId', 'dateFrom', 'dateTo', 'scopeKey', 'refreshKey', 'selection'], template: '<div />' }
const groupsStub = { name: 'DisclosureEventGroups', props: ['groups', 'query', 'scopeKey', 'selectedId', 'selectedEvent', 'focusGroupKey', 'eventTiming'], emits: ['select'], template: '<div data-testid="groups-stub" />' }
const counts = { maintenance: 130, outage: 1, intervention: 0, congestion: 0, constraint: 0 }
const availability = { status: 'available', reason: '测试夹具', fallback: false }
const overview = () => ({ total: 131, countsByCategory: counts, dayOnlyCount: 0, dayOnlyCountsByCategory: counts, buckets: [], bucket: 'hour', coverage: { from: '2026-07-01', to: '2026-07-02', total: 131, timeBasis: 'businessDate', publishedTimeKnown: 0, sourceImportedTimeKnown: 131, effectiveTimeKnown: 1 }, dataAvailability: availability })
const group = (label: string) => ({ groupKey: `plant:yunnan:${label}`, label, kind: 'plant', regionId: 'yunnan', total: 3, countsByCategory: { ...counts, maintenance: 3, outage: 0 } })
const curve = () => ({ metric: getDisclosureDeskMetric('price')!, series: [], channels: [], status: 'available', reason: '', sourceType: 'DB', latestAt: null, summary: [], warnings: [] })
const caps = () => ({ contractVersion: '1.0.0', enabled: true, regionId: 'yunnan', supportedRegion: true, modelReady: true, calibrationStatus: 'uncalibrated', liveTradeDate: liveTradeDate(), tradeDate: liveTradeDate(), datasets: [], errors: [] })

let wrapper: VueWrapper | null = null
// 弹窗真实 Teleport 到 body（不桩掉：桩会在更新时重建节点，测不出真实的焦点行为），弹窗内元素从 document 取。
function view() {
  wrapper = mount(GridDisclosureSpatialView, { attachTo: document.body, global: { stubs: { DisclosureDeskChart: chartStub, DisclosureMetricPicker: pickerStub, DisclosureDeskInsights: plainStub, DisclosureUnitRoster: plainStub, DisclosureEventGroups: groupsStub, DisclosureRegionContext: true } } })
  return wrapper
}
function inDialog<T extends HTMLElement = HTMLElement>(testId: string) { return document.body.querySelector<T>(`[data-testid="${testId}"]`) }
async function click(testId: string) { inDialog(testId)!.click(); await flushPromises() }

beforeEach(() => {
  vi.resetAllMocks()
  ;(currentRegion as Ref<typeof currentRegion.value>).value = { id: 'yunnan', shortName: '云南' } as typeof currentRegion.value
  ;(selectedCompanyId as Ref<string | null>).value = 'company-a'
  calls.overview.mockResolvedValue(overview())
  calls.events.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 18, dataAvailability: availability })
  calls.groups.mockImplementation(async (query: { page: number }) => ({ items: [group(`电厂${query.page}`)], total: 131, groupTotal: 25, page: query.page, pageSize: 12, dataAvailability: availability }))
  calls.providers.mockResolvedValue({ providers: [] })
  calls.series.mockResolvedValue(curve())
  calls.themeAvailability.mockResolvedValue({})
  watchApi.caps.mockResolvedValue(caps())
  watchApi.run.mockResolvedValue({ settled: false, runId: 'run-1' })
})
afterEach(() => { vi.useRealTimers(); wrapper?.unmount(); wrapper = null; document.body.innerHTML = '' })

describe('公开披露页日前盯盘入口', () => {
  it('第二页且有关键词时启动研判：请求只带地区/公司/目标日，关闭后焦点回到入口且原筛选与页码不变', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const page = view(); await flushPromises()
    await page.get('[data-testid="desk-date"]').setValue('2026-07-01')
    await page.get('[data-testid="desk-search"]').setValue('小湾')
    await vi.advanceTimersByTimeAsync(260); await flushPromises()
    await page.get('[aria-label="下一页分组"]').trigger('click'); await flushPromises()
    expect(page.get('.pager').text()).toContain('2 / 3 页')
    const groupCalls = calls.groups.mock.calls.length

    const trigger = page.get('[data-testid="desk-watch-open"]')
    await trigger.trigger('click'); await flushPromises()
    expect(document.activeElement).toBe(inDialog('disclosure-watch-dialog'))
    const dialog = page.getComponent({ name: 'DisclosureWatchDialog' })
    expect(dialog.props()).toEqual({ regionId: 'yunnan', regionLabel: '云南', companyId: 'company-a', initialReviewDate: '2026-07-01' })
    expect(dialog.vm.$attrs).toEqual({})
    expect(inDialog('watch-scope')!.textContent).toContain('全部机组披露（不受列表筛选影响）')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    await click('watch-run')
    expect(watchApi.caps).toHaveBeenCalledWith({ regionId: 'yunnan', companyId: 'company-a' }, liveTradeDate(), expect.anything())
    expect(watchApi.run.mock.calls[0].slice(0, 3)).toEqual([{ regionId: 'yunnan', companyId: 'company-a' }, { tradeDate: liveTradeDate(), mode: 'live' }, 'key-page'])
    expect(JSON.stringify(watchApi.run.mock.calls[0].slice(0, 3))).not.toMatch(/小湾|"page"|"keyword"|"theme"/)

    await click('watch-close')
    expect(inDialog('disclosure-watch-dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger.element)
    expect(page.get('.pager').text()).toContain('2 / 3 页')
    expect((page.get('[data-testid="desk-search"]').element as HTMLInputElement).value).toBe('小湾')
    expect((page.get('[data-testid="desk-date"]').element as HTMLInputElement).value).toBe('2026-07-01')
    expect(calls.groups.mock.calls.length).toBe(groupCalls)
  })

  it('Esc 关闭弹窗后焦点同样回到入口按钮', async () => {
    const page = view(); await flushPromises()
    const trigger = page.get('[data-testid="desk-watch-open"]')
    await trigger.trigger('click'); await flushPromises()
    expect(document.activeElement).toBe(inDialog('disclosure-watch-dialog'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await flushPromises()
    expect(inDialog('disclosure-watch-dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger.element)
  })

  it('近七日视图把窗口末日预填为历史审阅日期，但不自动运行', async () => {
    const page = view(); await flushPromises()
    await page.get('[data-testid="desk-date"]').setValue('2026-07-07')
    await page.get('[data-testid="desk-mode-week"]').trigger('click'); await flushPromises()
    await page.get('[data-testid="desk-watch-open"]').trigger('click'); await flushPromises()
    expect(page.getComponent({ name: 'DisclosureWatchDialog' }).props('initialReviewDate')).toBe('2026-07-07')
    await click('watch-mode-review')
    expect(inDialog<HTMLInputElement>('watch-review-date')!.value).toBe('2026-07-07')
    expect(watchApi.run).not.toHaveBeenCalled()
  })
})
