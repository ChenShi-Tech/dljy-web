// Guard full-query counts, server pagination and isolation of node browsing / asset maintenance.
// Regressions would show page totals or stale company/region assets, bypass relation filters, or overwrite a newer version. dljy#2897.
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Ref } from 'vue'
import { currentRegion } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { ApiError } from '@/services/api'
import GridGeoNodeManagerView from './GridGeoNodeManagerView.vue'
import type { GridGeoNode, GridGeoNodeListResponse } from './types'

const calls = vi.hoisted(() => ({ nodes: vi.fn(), manifest: vi.fn(), revisions: vi.fn(), create: vi.fn(), update: vi.fn(), revert: vi.fn(), object: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn(), prompt: vi.fn() }))
vi.mock('./client', () => ({ fetchGridGeoNodes: calls.nodes, fetchGridGeoManifest: calls.manifest, fetchGridGeoNodeRevisions: calls.revisions, createGridGeoNode: calls.create, updateGridGeoNode: calls.update, revertGridGeoNode: calls.revert, fetchGridObject: calls.object }))
vi.mock('element-plus', () => ({ ElMessage: { warning: calls.warning, error: calls.error, success: calls.success }, ElMessageBox: { prompt: calls.prompt } }))
vi.mock('@/services/region/regionContext', async () => { const { ref } = await import('vue'); return { currentRegion: ref({ id: 'yunnan', shortName: '云南', name: '云南省' }) } })
vi.mock('@/services/company/companyContext', async () => { const { ref } = await import('vue'); return { selectedCompanyId: ref('company-a') } })
vi.mock('./GridGeoStationTable.vue', () => ({ default: { name: 'StationTableStub', props: ['groups', 'query', 'scopeKey', 'selectedId'], emits: ['select'], template: '<section data-testid="node-station-table"><div v-for="group in groups" :key="group.groupKey">{{ group.displayName }} · {{ group.nodeCount }} 个节点</div></section>' } }))
vi.mock('./GridOperatorProfileBanner.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./GridObjectContextBar.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./GridObjectDrawer.vue', () => ({ default: { name: 'ObjectDrawerStub', props: ['modelValue', 'object', 'date', 'from', 'to'], emits: ['update:modelValue'], template: '<section v-if="modelValue" data-testid="node-object-detail"><span>{{ object.id }}</span><slot name="management" /><button aria-label="关闭对象详情" @click="$emit(\'update:modelValue\', false)">关闭</button></section>' } }))

function node(id = 'node-a', name = '220kV三都站.110kV#1母'): GridGeoNode {
  return { assetId: id, assetType: 'node', nodeId: id, nodeName: name, standardName: name, aliases: [], nodeKind: 'bus', voltageLevelKv: null, status: 'active', locationStatus: 'unresolved', location: null, marketRefs: { nodePriceFamily: 'yn_node_price' }, regionId: 'yunnan', gridOperator: 'csg', ownerCompanyId: 'company-a', version: 2, visibility: 'company', sourceRef: 'fixture', dataMeta: { sourceType: 'IMPORT', mock: false, productionWrite: false, visibility: 'company', contractVersion: '1', verifiedAt: null, note: '' }, overrideState: { hasOverrides: false, count: 0, fieldPaths: [], latestVersion: null, updatedAt: null }, storageMeta: { sourceType: 'DB', mock: false, productionWrite: false, schemaVersion: '1', updatedAt: '2026-09-14T00:00:00+08:00' } }
}
function list(items = [node()], total = 1241, grouped = true): GridGeoNodeListResponse {
  const groupCount = total ? 81 : 0
  return { code: 200, data: {
    items: grouped ? [] : items,
    ...(grouped ? { groups: items.map(item => ({ groupKey: `station-${item.nodeId}`, stationName: item.nodeName.split('.')[0], displayName: item.nodeName.split('.')[0], nodeCount: 1, regionId: item.regionId, gridOperator: item.gridOperator, voltageLevels: [110], unknownVoltageCount: 0, summary: { locatedCount: 0, approximateCount: 0, unresolvedCount: 1 }, priceReferenceCount: 1 })), totalNodes: total } : {}),
    summary: { visibleCount: total, locatedCount: total ? 400 : 0, approximateCount: total ? 100 : 0, unresolvedCount: total ? total - 500 : 0, overriddenCount: 0 },
    pagination: { page: 1, pageSize: grouped ? 20 : 60, total: grouped ? groupCount : total, totalPages: Math.max(1, Math.ceil((grouped ? groupCount : total) / (grouped ? 20 : 60))) },
    dataAvailability: { status: items.length ? 'available' : 'empty', fallback: false }
  }, total: grouped ? groupCount : total, sourceType: 'DB', mock: false, productionWrite: false }
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function view(query = '') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/grid-assets/:page', component: { template: '<div />' } }] })
  await router.push(`/grid-assets/nodes${query}`); await router.isReady()
  const wrapper = mount(GridGeoNodeManagerView, { global: { plugins: [router], stubs: { ElDrawer: { props: ['modelValue'], template: '<section v-if="modelValue" class="test-el-drawer"><slot /></section>' } } } })
  return { wrapper, router }
}
function button(wrapper: Awaited<ReturnType<typeof view>>['wrapper'], text: string) { return wrapper.findAll('button').find(item => item.text() === text)! }

beforeEach(() => {
  vi.resetAllMocks()
  ;(currentRegion as Ref<typeof currentRegion.value>).value = { id: 'yunnan', shortName: '云南', name: '云南省' } as typeof currentRegion.value
  ;(selectedCompanyId as Ref<string | null>).value = 'company-a'
  calls.nodes.mockResolvedValue(list())
  calls.manifest.mockResolvedValue({ capabilities: { canWrite: true } })
  calls.revisions.mockResolvedValue({ rows: [] })
  calls.object.mockImplementation(async reference => ({ reference, name: '关联场站', relations: { nodes: [], plants: [] } }))
})
afterEach(() => { vi.useRealTimers() })

describe('node browsing and full-query summary', () => {
  it('starts with server station groups and node totals, and routes expanded node selections into details', async () => {
    const { wrapper } = await view(); await flushPromises()
    expect(wrapper.find('[data-testid="node-station-table"]').exists()).toBe(true)
    expect(wrapper.findAll('.node-card')).toHaveLength(0)
    expect(wrapper.get('[aria-label="完整筛选范围统计"]').text()).toContain('1,241')
    expect(wrapper.get('[aria-label="完整筛选范围统计"]').text()).toContain('400')
    expect(wrapper.get('[aria-label="完整筛选范围统计"]').text()).toContain('741')
    expect(wrapper.text()).not.toContain('node-a')
    expect(wrapper.text()).not.toContain('编辑资料')
    wrapper.getComponent({ name: 'StationTableStub' }).vm.$emit('select', node()); await flushPromises()
    const detail = wrapper.getComponent({ name: 'ObjectDrawerStub' })
    expect(detail.props('object')).toEqual({ kind: 'node', id: 'node-a', regionId: 'yunnan', gridOperator: 'csg' })
    expect(wrapper.get('[data-testid="node-object-detail"]').text()).toContain('版本历史')
    await wrapper.get('[aria-label="关闭对象详情"]').trigger('click')
    expect(wrapper.get('[data-testid="node-station-table"]').text()).toContain('三都站')
    expect(calls.nodes).toHaveBeenCalledTimes(1)
    expect(calls.update).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('paginates by station and restarts node pagination when switching to cards', async () => {
    const { wrapper } = await view(); await flushPromises()
    calls.nodes.mockResolvedValue(list([node('node-b', '乙站.220kV#2母')]))
    await wrapper.get('[aria-label="下一页节点"]').trigger('click'); await flushPromises()
    expect(calls.nodes).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, groupBy: 'station' })
    expect(wrapper.get('.pager').text()).toContain('第 2 / 5 页')
    expect(wrapper.get('.pager').text()).toContain('本页 1 个站组（1 个匹配节点） / 共 81 个站组')
    calls.nodes.mockResolvedValue(list([node('node-b', '乙站.220kV#2母')], 1241, false))
    await button(wrapper, '资产卡片').trigger('click'); await flushPromises()
    expect(calls.nodes).toHaveBeenLastCalledWith({ page: 1, pageSize: 60 })
    expect(wrapper.get('.pager').text()).toContain('第 1 / 21 页')
    expect(wrapper.findAll('.node-card')).toHaveLength(1)
    expect(wrapper.find('[data-testid="node-station-table"]').exists()).toBe(false)
    expect(calls.nodes).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })

  it('invalidates a response immediately when a search changes, before the debounce expires', async () => {
    const pending = deferred<GridGeoNodeListResponse>()
    calls.nodes.mockReturnValueOnce(pending.promise)
    const { wrapper } = await view()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await wrapper.get('[aria-label="搜索节点名称、所属站、别名或 ID"]').setValue('乙站')
    pending.resolve(list([node('stale', '过期节点')]))
    await flushPromises()
    expect(wrapper.text()).not.toContain('过期节点')
    expect(calls.nodes).toHaveBeenCalledTimes(1)
    calls.nodes.mockResolvedValue(list([node('new', '乙站.220kV#2母')]))
    await vi.advanceTimersByTimeAsync(260); await flushPromises()
    expect(calls.nodes).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, groupBy: 'station', keyword: '乙站' })
    expect(wrapper.get('[data-testid="node-station-table"]').text()).toContain('乙站')
    expect(wrapper.text()).not.toContain('过期节点')
    wrapper.unmount()
  })

  it.each(['company', 'region'])('blocks stale %s rows and manifest permissions after a scope switch', async dimension => {
    const pending = deferred<GridGeoNodeListResponse>()
    calls.nodes.mockReturnValueOnce(pending.promise)
    const { wrapper } = await view()
    calls.nodes.mockResolvedValue(list([node('current', '当前范围节点')]))
    calls.manifest.mockResolvedValue({ capabilities: { canWrite: false } })
    if (dimension === 'company') (selectedCompanyId as Ref<string | null>).value = 'company-b'
    else (currentRegion as Ref<typeof currentRegion.value>).value = { id: 'shanxi', shortName: '山西', name: '山西省' } as typeof currentRegion.value
    await flushPromises()
    pending.resolve(list([node('stale', '旧范围节点')]))
    await flushPromises()
    expect(wrapper.text()).toContain('当前范围节点')
    expect(wrapper.text()).not.toContain('旧范围节点')
    expect(button(wrapper, '新建节点').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('does not pretend a legacy node page is a complete station summary', async () => {
    calls.nodes.mockResolvedValue(list([node()], 1241, false))
    const { wrapper } = await view(); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('完整站级分组')
    expect(wrapper.find('[data-testid="node-station-table"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('can turn off station merging and restores grouping with its own pagination', async () => {
    const { wrapper } = await view(); await flushPromises()
    calls.nodes.mockResolvedValue(list([node()], 1241, false))
    await wrapper.get('.group-switch input').setValue(false); await flushPromises()
    expect(calls.nodes).toHaveBeenLastCalledWith({ page: 1, pageSize: 60 })
    expect(wrapper.find('[data-testid="node-table"]').exists()).toBe(true)
    calls.nodes.mockResolvedValue(list())
    await wrapper.get('.group-switch input').setValue(true); await flushPromises()
    expect(calls.nodes).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, groupBy: 'station' })
    expect(wrapper.find('[data-testid="node-station-table"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows unknown statistics instead of rebuilding them from the current page', async () => {
    const response = list()
    response.data.summary = undefined as unknown as GridGeoNodeListResponse['data']['summary']
    calls.nodes.mockResolvedValue(response)
    const { wrapper } = await view(); await flushPromises()
    const metrics = wrapper.get('[aria-label="完整筛选范围统计"]')
    expect(metrics.text()).toContain('1,241')
    expect(metrics.findAll('strong').map(item => item.text())).toEqual(['1,241', '未提供', '未提供', '未提供'])
    expect(wrapper.text()).toContain('位置统计暂未提供')
    wrapper.unmount()
  })

  it('clears old rows on request failure, keeps an inline retry, and reports lack of permission honestly', async () => {
    const { wrapper } = await view(); await flushPromises()
    calls.nodes.mockRejectedValue(new ApiError('Forbidden', { status: 403, code: 403, payload: { code: 403 } }))
    await button(wrapper, '刷新').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('无节点资产查看权限')
    expect(wrapper.find('[data-testid="node-station-table"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('三都站')
    calls.nodes.mockResolvedValue(list([], 0))
    await button(wrapper, '重试').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('没有匹配的节点资产')
    expect(wrapper.get('[aria-label="完整筛选范围统计"]').findAll('strong').map(item => item.text())).toEqual(['0', '0', '0', '0'])
    wrapper.unmount()
  })

  it('passes a valid object identity to the server and never falls back to the whole directory for no relations', async () => {
    calls.nodes.mockResolvedValue(list([], 0))
    const { wrapper } = await view('?objectKind=plant&objectId=plant-a&objectRegion=yunnan&objectCompany=company-a')
    await flushPromises()
    expect(calls.nodes).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, groupBy: 'station', objectKind: 'plant', objectId: 'plant-a' })
    expect(wrapper.text()).toContain('当前对象没有匹配的关联节点')
    expect(calls.nodes).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('distinguishes a missing dataset from a completed empty filter result', async () => {
    const response = list([], 0)
    response.data.dataAvailability.status = 'missing'
    calls.nodes.mockResolvedValue(response)
    const { wrapper } = await view(); await flushPromises()
    expect(wrapper.text()).toContain('当前范围的节点资产尚未接入')
    expect(wrapper.text()).not.toContain('没有匹配的节点资产')
    wrapper.unmount()
  })

  it('blocks invalid or foreign-scope object context before requesting a node list', async () => {
    const { wrapper } = await view('?objectKind=plant&objectId=plant-a&objectRegion=yunnan&objectCompany=other-company')
    await flushPromises()
    expect(calls.nodes).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('对象关联与当前公司或地区不一致')
    expect(wrapper.find('[data-testid="node-station-table"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('preserves the current page and search when a kept-alive page becomes hidden and returns', async () => {
    const { wrapper, router } = await view(); await flushPromises()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await wrapper.get('[aria-label="搜索节点名称、所属站、别名或 ID"]').setValue('三都站')
    await vi.advanceTimersByTimeAsync(260); await flushPromises()
    await wrapper.get('[aria-label="下一页节点"]').trigger('click'); await flushPromises()
    const requests = calls.nodes.mock.calls.length
    await router.push('/grid-assets/weather-impact'); await flushPromises()
    await router.push('/grid-assets/nodes'); await flushPromises()
    expect(calls.nodes).toHaveBeenCalledTimes(requests)
    expect(wrapper.get('.pager').text()).toContain('第 2 / 5 页')
    expect((wrapper.get('[aria-label="搜索节点名称、所属站、别名或 ID"]').element as HTMLInputElement).value).toBe('三都站')
    wrapper.unmount()
  })

  it('preserves expected-version writes and refreshes after 409 instead of resubmitting silently', async () => {
    const { wrapper } = await view(); await flushPromises()
    wrapper.getComponent({ name: 'StationTableStub' }).vm.$emit('select', node()); await flushPromises()
    await button(wrapper, '编辑资料').trigger('click')
    const reason = wrapper.findAll('.form-grid label').find(item => item.text().startsWith('变更原因'))!
    await reason.get('textarea').setValue('核对节点资料')
    calls.update.mockRejectedValue(new ApiError('Conflict', { status: 409, code: 409, payload: { code: 409 } }))
    await button(wrapper, '保存并生成新版本').trigger('click'); await flushPromises()
    expect(calls.update).toHaveBeenCalledWith('node-a', expect.objectContaining({ expectedVersion: 2, reason: '核对节点资料', changes: expect.objectContaining({ voltageLevelKv: null }) }))
    expect(calls.warning).toHaveBeenCalledWith('资产版本已变化，已刷新最新数据，请重新确认后保存')
    expect(calls.nodes).toHaveBeenCalledTimes(2)
    expect(calls.update).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.editor').exists()).toBe(false)
    wrapper.unmount()
  })
})
