// Object context and modal Escape must preserve the selected asset until the map handles a later key. dljy#2897.
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { selectedCompanyId } from '@/services/company/companyContext'
import { useGridObjectContext } from './useGridObjectContext'
import GridWeatherImpactView from './GridWeatherImpactView.vue'
import GridMarketSpatialView from './GridMarketSpatialView.vue'
import GridSpatialCommandView from './GridSpatialCommandView.vue'
import PlantDetailDrawer from './PlantDetailDrawer.vue'
import PlantBusinessAttributes from './PlantBusinessAttributes.vue'
import type { GridObjectDetail, GridObjectReference } from './objectNavigation'
import type { GridGeoPlant, GridGeoNode } from './types'

const calls = vi.hoisted(() => ({ plants: vi.fn(), manifest: vi.fn(), weather: vi.fn(), market: vi.fn(), integrations: vi.fn(), prices: vi.fn(), focusPlant: vi.fn(), focusNode: vi.fn() }))
vi.mock('@/services/company/companyContext', async () => { const { ref } = await import('vue'); return { selectedCompanyId: ref('comp-cgn-yunnan'), currentCompany: ref({ name: '公司一' }) } })
vi.mock('@/services/region/regionContext', async () => { const { ref } = await import('vue'); return { currentRegion: ref({ id: 'yunnan', name: '云南省', shortName: '云南' }) } })
vi.mock('@/composables/useRegionReload', () => ({ onRegionChange: vi.fn() }))
vi.mock('./useGridObjectContext', async () => {
  const { ref } = await import('vue')
  const context = { reference: ref(null), detail: ref(null), date: ref('2026-07-01'), timeWindow: ref(null), error: ref(''), loading: ref(false), hasContext: ref(true), active: ref(true) }
  return { useGridObjectContext: () => context }
})
vi.mock('./client', () => ({ fetchGridGeoPlants: calls.plants, fetchGridGeoManifest: calls.manifest, fetchGridGeoPlantIntegrations: calls.integrations, fetchGridOperatorProfile: vi.fn().mockResolvedValue(null), fetchGridTopologyManifest: vi.fn().mockRejectedValue(new Error('未接入')), fetchGridTopologySnapshotPage: vi.fn(), fetchGridGeoNodes: vi.fn(), fetchGridGeoWeather: vi.fn(), fetchGridDisclosureEvents: vi.fn() }))
vi.mock('./weatherImpact', () => ({ loadWeatherImpact: calls.weather }))
vi.mock('./marketSpatial', () => ({ loadGridMarketSpatialSnapshot: calls.market }))
vi.mock('@/services/market/spotClient', () => ({ fetchNodePriceSeries: calls.prices }))
vi.mock('./GridObjectContextBar.vue', () => ({ default: { template: '<div data-context-bar />' } }))
vi.mock('./GridObjectDrawer.vue', () => ({ default: { name: 'ObjectDrawerStub', props: ['modelValue', 'object', 'date'], emits: ['update:modelValue'], template: '<div v-if="modelValue" role="dialog" data-object-drawer><slot name="management" /><slot name="extra" /></div>' } }))
vi.mock('./ProvinceFlatMap.vue', () => ({ default: { name: 'MapStub', props: ['plants', 'nodes', 'selectedPlantId', 'selectedNodeId'], setup(_: unknown, { expose }: { expose: (value: unknown) => void }) { expose({ focusPlant: calls.focusPlant, focusNode: calls.focusNode }); return {} }, template: '<div data-map />' } }))
vi.mock('./useViewPreference', async () => { const { ref } = await import('vue'); return { useGridGeoViewPreference: () => ({ viewMode: ref('2d'), terrainProvider: ref('arcgis-terrain'), hillshadeEnabled: ref(false), verticalExaggeration: ref(1) }) } })
const context = useGridObjectContext()
const wrappers: VueWrapper[] = []
const global = { stubs: { PlantCatalogPanel: false, GridOperatorProfileBanner: true, WeatherTrackTimeline: true, TerrainControlPanel: true, PlantAssetGovernance: true, TopologyFeatureCard: true, TopologyLayerStatus: true, RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' } } }
function plant(id: string): GridGeoPlant {
  return { plantId: id, standardName: `场站${id}`, aliases: [], plantType: 'wind', capacityMw: 100, regionId: 'yunnan', ownerCompanyId: 'comp-cgn-yunnan', gridOperator: 'csg', version: 1,
    location: { longitude: 102, latitude: 25, coordinateSystem: 'WGS84', locationLabel: '核验位置', accuracyLevel: 'site', confidence: 'verified', uncertaintyMeters: 0, displayPolicy: 'exact-marker', evidence: [{ title: '公开许可', url: 'https://example.com/evidence', publisher: '发布部门', accessedAt: '2026-07-01' }], coordinateSource: { name: '坐标目录', url: 'https://example.com/coordinate' } },
    dataMeta: { sourceType: 'MANUAL', mock: false, note: '' }, overrideState: { hasOverrides: false, count: 0 }, integrationRefs: {} } as unknown as GridGeoPlant
}
function node(id: string, located = true): GridGeoNode {
  return { nodeId: id, nodeName: `节点${id}`, regionId: 'yunnan', gridOperator: 'csg', nodeKind: 'pricing', locationStatus: located ? 'located' : 'unresolved', location: located ? plant('a').location : null } as GridGeoNode
}
function setObject(kind: GridObjectReference['kind'], id: string, plants: string[] = []) {
  const reference: GridObjectReference = { kind, id, regionId: 'yunnan', gridOperator: 'csg' }
  ;(context.reference as Ref<GridObjectReference | null>).value = reference
  context.detail.value = { reference, name: id, relations: { plants: plants.map(id => ({ id, name: id, regionId: 'yunnan' })), nodes: [] }, ...(kind === 'node' ? { node: node(id) } : {}) } as unknown as GridObjectDetail
}
function snapshot(date = '2026-07-01', count = 0) {
  return { date, formula: { priceContribution: '', outputContribution: '' }, metrics: [], summary: { mappedPlants: count, pricedPlants: 0, outputPlants: 0, highRiskPlants: 0 }, sources: { nodePrice: { status: 'empty', mock: false }, output: { status: 'empty', mock: false } } }
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function render(component: typeof GridWeatherImpactView | typeof GridMarketSpatialView | typeof GridSpatialCommandView) { const wrapper = mount(component, { global }); wrappers.push(wrapper); return wrapper }
beforeEach(() => {
  vi.clearAllMocks()
  ;(selectedCompanyId as Ref<string | null>).value = 'comp-cgn-yunnan'
  ;(context.active as Ref<boolean>).value = true
  ;(context.hasContext as Ref<boolean>).value = true
  ;(context.date as Ref<string>).value = '2026-07-01'
  ;(context.timeWindow as Ref<{ from: string; to: string } | null>).value = null
  context.loading.value = false; context.error.value = ''
  setObject('plant', 'b')
  calls.plants.mockResolvedValue({ data: { items: [plant('a'), plant('b')] }, mock: false })
  calls.manifest.mockResolvedValue({ operatorProfile: null, capabilities: { canWrite: true } })
  calls.weather.mockRejectedValue(new Error('当日未提供气象源'))
  calls.market.mockResolvedValue(snapshot())
  calls.integrations.mockResolvedValue({ asset: { plantId: 'b', regionId: 'yunnan', ownerCompanyId: 'comp-cgn-yunnan' }, identity: { nodeName: '定价节点B', plantNames: ['场站b'] }, domains: { output: { status: 'not-configured' }, settlement: { status: 'not-configured' } }, navigation: { nodePrice: '/xhjy/yunnan/node-price', settlement: '/xhjy/yunnan/settlement' } })
  calls.prices.mockResolvedValue({ series: [{ price: 0 }] })
})
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount(); vi.useRealTimers() })

describe('space pages use the Beijing business day only as the initial default', () => {
  const pages = [['command', GridSpatialCommandView], ['market', GridMarketSpatialView], ['weather', GridWeatherImpactView]] as const
  function noObjectContext(now: string) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    ;(context.hasContext as Ref<boolean>).value = false
    ;(context.reference as Ref<GridObjectReference | null>).value = null
    context.detail.value = null
  }
  async function exposeDate(wrapper: VueWrapper, name: string) {
    await flushPromises()
    if (name === 'command') { await wrapper.get('.scene-rail .market').trigger('click'); await flushPromises() }
    return wrapper.get('input[type="date"]')
  }
  async function openSelectedDetail(wrapper: VueWrapper, name: string) {
    if (name !== 'weather') {
      wrapper.getComponent({ name: 'MapStub' }).vm.$emit(name === 'command' ? 'asset-select' : 'select', { kind: 'plant', plantId: 'b' })
      await flushPromises()
    }
    await wrapper.findAll('button').find(button => button.text().startsWith('完整信息'))!.trigger('click')
    return wrapper.getComponent({ name: 'ObjectDrawerStub' })
  }
  for (const [name, component] of pages) {
    it.each([
      ['2026-09-14T15:59:00Z', '2026-09-14'],
      ['2026-09-14T16:01:00Z', '2026-09-15'],
    ])(`${name} defaults to %s in Beijing when no object date was supplied`, async (now, expected) => {
      noObjectContext(now)
      const wrapper = render(component)
      expect((await exposeDate(wrapper, name)).element).toMatchObject({ value: expected })
      expect((name === 'weather' ? calls.weather : calls.market).mock.lastCall?.[1]).toBe(expected)
      expect((await openSelectedDetail(wrapper, name)).props('date')).toBe(expected)
    })
    it(`${name} passes a manually selected historical day to its requests and object drawer`, async () => {
      noObjectContext('2026-09-14T16:01:00Z')
      const wrapper = render(component)
      await (await exposeDate(wrapper, name)).setValue('2026-05-01'); await flushPromises()
      if (name === 'command') { await wrapper.get('.market-controls button').trigger('click'); await flushPromises() }
      expect((name === 'weather' ? calls.weather : calls.market).mock.lastCall?.[1]).toBe('2026-05-01')
      expect((await openSelectedDetail(wrapper, name)).props('date')).toBe('2026-05-01')
      expect(wrapper.get('input[type="date"]').element).toMatchObject({ value: '2026-05-01' })
    })
  }
})

describe('plant pages consume exact shared object context', () => {
  it('weather selects the requested second plant and incoming day instead of the first plant', async () => {
    const wrapper = render(GridWeatherImpactView); await flushPromises()
    expect(calls.weather).toHaveBeenCalledTimes(1)
    expect(calls.weather.mock.calls[0]?.slice(0, 2)).toEqual([plant('b'), '2026-07-01'])
    expect(wrapper.get('select[aria-label="关联场站"]').element).toMatchObject({ value: 'b' })
    expect(wrapper.findAll('select[aria-label="关联场站"] option').map(item => item.text())).toEqual(['场站b'])
    await wrapper.findAll('button').find(item => item.text() === '完整信息')!.trigger('click')
    expect(wrapper.getComponent({ name: 'ObjectDrawerStub' }).props()).toMatchObject({ object: { kind: 'plant', id: 'b' }, date: '2026-07-01', modelValue: true })
  })
  it('weather clears the previous request on an unlinked object and ignores its late error', async () => {
    const pending = deferred<never>(); calls.weather.mockReturnValueOnce(pending.promise)
    const wrapper = render(GridWeatherImpactView); await flushPromises()
    setObject('disclosure', 'unlinked'); await flushPromises()
    expect(calls.weather).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('尚未关联')
    expect(wrapper.get('select[aria-label="关联场站"]').attributes('disabled')).toBeDefined()
    pending.reject(new Error('过期对象失败')); await flushPromises()
    expect(wrapper.text()).not.toContain('过期对象失败')
  })
  it('weather handles same-component object/day changes and preserves selection while hidden', async () => {
    const wrapper = render(GridWeatherImpactView); await flushPromises()
    setObject('node', 'n1', ['a']); (context.date as Ref<string>).value = '2026-07-02'; await flushPromises()
    expect(calls.weather.mock.calls.at(-1)?.slice(0, 2)).toEqual([plant('a'), '2026-07-02'])
    const count = calls.weather.mock.calls.length
    ;(context.active as Ref<boolean>).value = false; context.detail.value = null; await flushPromises()
    expect(calls.weather).toHaveBeenCalledTimes(count)
    expect(wrapper.get('select[aria-label="关联场站"]').element).toMatchObject({ value: '' })
  })
  it('market requests only the confirmed related plant and suppresses invalid company context', async () => {
    setObject('node', 'n1', ['b'])
    const wrapper = render(GridMarketSpatialView); await flushPromises()
    expect(calls.market).toHaveBeenCalledTimes(1)
    expect(calls.market.mock.calls[0]?.slice(0, 2)).toEqual([[plant('b')], '2026-07-01'])
    expect(wrapper.getComponent({ name: 'MapStub' }).props('selectedPlantId')).toBe('b')
    ;(context.reference as Ref<GridObjectReference | null>).value = null; context.detail.value = null; context.error.value = '对象不属于当前公司'; await flushPromises()
    expect(calls.market).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('对象不属于当前公司')
    expect(wrapper.getComponent({ name: 'MapStub' }).props('plants')).toEqual([])
  })
  it('market isolates late snapshots when the object and day change', async () => {
    const pending = deferred<ReturnType<typeof snapshot>>(); calls.market.mockReturnValueOnce(pending.promise)
    const wrapper = render(GridMarketSpatialView); await flushPromises()
    setObject('plant', 'a'); (context.date as Ref<string>).value = '2026-07-02'; await flushPromises()
    expect(calls.market.mock.calls.at(-1)?.slice(0, 2)).toEqual([[plant('a')], '2026-07-02'])
    pending.resolve(snapshot('2026-07-01', 999)); await flushPromises()
    expect(wrapper.text()).not.toContain('999')
    expect(wrapper.getComponent({ name: 'MapStub' }).props('selectedPlantId')).toBe('a')
  })
  it.each([['weather', GridWeatherImpactView], ['market', GridMarketSpatialView]] as const)('%s keeps a locally edited day when returning to the same object', async (name, component) => {
    const wrapper = render(component); await flushPromises()
    await wrapper.get('input[type="date"]').setValue('2026-07-03'); await flushPromises()
    ;(context.active as Ref<boolean>).value = false; context.detail.value = null; await flushPromises()
    context.loading.value = true; (context.active as Ref<boolean>).value = true; await flushPromises()
    setObject('plant', 'b'); context.loading.value = false; await flushPromises()
    expect(wrapper.get('input[type="date"]').element).toMatchObject({ value: '2026-07-03' })
    const last = name === 'weather' ? calls.weather.mock.calls.at(-1) : calls.market.mock.calls.at(-1)
    expect(last?.[1]).toBe('2026-07-03')
  })
  it('command focuses an authorized target node outside the map page and keeps unknown coordinates off map', async () => {
    setObject('node', 'outside-page')
    const wrapper = render(GridSpatialCommandView); await flushPromises()
    expect(calls.focusNode).toHaveBeenCalledWith('outside-page')
    expect(wrapper.getComponent({ name: 'MapStub' }).props('nodes')).toEqual([node('outside-page')])
    expect(wrapper.text()).toContain('节点outside-page')
    setObject('node', 'unlocated'); context.detail.value = { ...context.detail.value!, node: node('unlocated', false) }; await flushPromises()
    expect(calls.focusNode).not.toHaveBeenCalledWith('unlocated')
    expect(wrapper.getComponent({ name: 'MapStub' }).props('nodes')).not.toContainEqual(node('unlocated', false))
    expect(wrapper.find('.selection-card').exists()).toBe(false)
  })
  it('command focuses the selected plant and passes object date into its drawer wrapper', async () => {
    const wrapper = render(GridSpatialCommandView); await flushPromises()
    expect(calls.focusPlant).toHaveBeenCalledWith('b')
    expect(wrapper.getComponent({ name: 'MapStub' }).props('plants')).toContainEqual(plant('b'))
    await wrapper.findAll('button').find(item => item.text() === '完整信息')!.trigger('click')
    expect(wrapper.getComponent(PlantDetailDrawer).props('date')).toBe('2026-07-01')
  })
})

describe('command Escape respects the modal before the map', () => {
  function command() {
    const wrapper = mount(GridSpatialCommandView, {
      attachTo: document.body,
      global: { ...global, stubs: { ...global.stubs, PlantAssetGovernance: {
        name: 'GovernanceDialogStub', props: ['open', 'plant'], emits: ['update:open'],
        template: '<div v-if="open" role="dialog" data-governance-dialog><button>治理字段</button></div>',
      } } },
    })
    wrappers.push(wrapper)
    return wrapper
  }
  async function openDetail(wrapper: VueWrapper) {
    await flushPromises()
    await wrapper.get('.selection-card .deep-link').trigger('click')
  }
  function keydown(target: EventTarget, key = 'Escape') {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }))
  }
  function expectSelected(wrapper: VueWrapper) {
    expect(wrapper.getComponent({ name: 'MapStub' }).props('selectedPlantId')).toBe('b')
    expect(wrapper.get('.selection-card').text()).toContain('场站b')
  }
  it('closes governance, then detail, and clears the selected plant only on the following map Escape', async () => {
    const wrapper = command(); await openDetail(wrapper)
    await wrapper.findAll('button').find(button => button.text() === '版本历史')!.trigger('click')
    const governance = wrapper.getComponent({ name: 'GovernanceDialogStub' })
    expect(governance.props('open')).toBe(true)
    keydown(window, 'Enter'); await flushPromises()
    expect(governance.props('open')).toBe(true)
    keydown(window); await flushPromises()
    expect(governance.props('open')).toBe(false)
    expect(wrapper.getComponent(PlantDetailDrawer).props('open')).toBe(true)
    expectSelected(wrapper)
    keydown(window); await flushPromises()
    expect(wrapper.getComponent(PlantDetailDrawer).props('open')).toBe(false)
    expect(wrapper.find('[data-object-drawer]').exists()).toBe(false)
    expectSelected(wrapper)
    keydown(wrapper.get('[data-map]').element); await flushPromises()
    expect(wrapper.getComponent({ name: 'MapStub' }).props('selectedPlantId')).toBeNull()
    expect(wrapper.find('.selection-card').exists()).toBe(false)
    expect(wrapper.getComponent({ name: 'ObjectDrawerStub' }).props('modelValue')).toBe(false)
  })
  it.each(['detail', 'governance'] as const)('does not act again when the %s dialog closes at document before the event reaches window', async (kind) => {
    const wrapper = command(); await openDetail(wrapper)
    if (kind === 'governance') await wrapper.findAll('button').find(button => button.text() === '版本历史')!.trigger('click')
    const dialog = wrapper.getComponent({ name: kind === 'detail' ? 'ObjectDrawerStub' : 'GovernanceDialogStub' })
    const target = dialog.get('button').element
    const closeAtDocument = vi.fn((event: KeyboardEvent) => {
      // Element Plus receives the bubbling key at document, before the page's window handler.
      if (event.key === 'Escape') dialog.vm.$emit(kind === 'detail' ? 'update:modelValue' : 'update:open', false)
    })
    document.addEventListener('keydown', closeAtDocument)
    try { keydown(target) } finally { document.removeEventListener('keydown', closeAtDocument) }
    await flushPromises()
    expect(closeAtDocument).toHaveBeenCalledTimes(1)
    expect(wrapper.getComponent(PlantDetailDrawer).props('open')).toBe(kind === 'governance')
    expect(wrapper.getComponent({ name: 'GovernanceDialogStub' }).props('open')).toBe(false)
    expectSelected(wrapper)
  })
  it('does not clear the map for an Escape already consumed by another control', async () => {
    const wrapper = command(); await flushPromises()
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    consumed.preventDefault()
    wrapper.get('[data-map]').element.dispatchEvent(consumed)
    await flushPromises()
    expectSelected(wrapper)
    keydown(wrapper.get('[data-map]').element); await flushPromises()
    expect(wrapper.find('.selection-card').exists()).toBe(false)
  })
})

describe('plant detail wrapper and business date', () => {
  it('preserves maintenance actions and coordinate evidence through the unified drawer', async () => {
    const wrapper = mount(PlantDetailDrawer, { props: { open: true, plant: plant('b'), date: '2026-07-02', canWrite: false }, global }); wrappers.push(wrapper)
    expect(wrapper.getComponent({ name: 'ObjectDrawerStub' }).props()).toMatchObject({ object: { kind: 'plant', id: 'b', regionId: 'yunnan' }, date: '2026-07-02' })
    expect(wrapper.get('a[href="https://example.com/coordinate"]').text()).toContain('坐标目录')
    expect(wrapper.get('a[href="https://example.com/evidence"]').text()).toContain('发布部门')
    expect(wrapper.findAll('button').find(item => item.text() === '编辑卡片')!.attributes('disabled')).toBeDefined()
    await wrapper.findAll('button').find(item => item.text() === '版本历史')!.trigger('click')
    expect(wrapper.emitted('governance')).toEqual([['history']])
    expect(wrapper.findComponent(PlantBusinessAttributes).exists()).toBe(false)
  })
  it('business loads the explicit date, retains zero prices, and sends objects to market/weather pages', async () => {
    const wrapper = mount(PlantBusinessAttributes, { props: { plant: plant('b'), date: '2026-07-02' }, global }); wrappers.push(wrapper); await flushPromises()
    expect(calls.prices).toHaveBeenCalledWith('2026-07-02', '定价节点B', 'rt', '云南')
    expect(wrapper.text()).toContain('0.0')
    const links = wrapper.findAllComponents({ name: 'RouterLink' })
    for (const path of ['/grid-assets/nodes', '/grid-assets/disclosures']) expect(links.map(item => item.props('to'))).toContainEqual({ path, query: { objectKind: 'plant', objectId: 'b', objectRegion: 'yunnan', objectCompany: 'comp-cgn-yunnan', objectDate: '2026-07-02' } })
    expect(links.some(item => item.props('to').path.startsWith('/xhjy/'))).toBe(false)
    expect(links.map(item => item.props('to'))).toContainEqual({ path: '/grid-assets/market', query: { objectKind: 'plant', objectId: 'b', objectRegion: 'yunnan', objectCompany: 'comp-cgn-yunnan', objectDate: '2026-07-02' } })
    await wrapper.setProps({ date: '2026-07-03' }); await flushPromises()
    expect(calls.prices).toHaveBeenLastCalledWith('2026-07-03', '定价节点B', 'rt', '云南')
    const count = calls.prices.mock.calls.length
    await wrapper.setProps({ date: '' }); await flushPromises()
    expect(wrapper.text()).toContain('请选择有效的交易日期')
    expect(calls.prices).toHaveBeenCalledTimes(count)
  })
})
