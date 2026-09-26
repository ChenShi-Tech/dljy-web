// Station summaries must stay collapsed until requested and use server group identity / totals.
// Regressions would read every node eagerly, split a station across pages, or mix delayed scope results. dljy#2897.
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GridGeoStationTable from './GridGeoStationTable.vue'
import GridGeoNodeTable from './GridGeoNodeTable.vue'
import type { GridGeoNode, GridGeoNodeListResponse, GridGeoNodeStationGroup } from './types'

const calls = vi.hoisted(() => ({ nodes: vi.fn() }))
vi.mock('./client', () => ({ fetchGridGeoNodes: calls.nodes }))

function group(key = 'station-a', nodeCount = 3, extra: Partial<GridGeoNodeStationGroup> = {}): GridGeoNodeStationGroup {
  return { groupKey: key, stationName: '三都站', displayName: '三都站', nodeCount, regionId: 'yunnan', gridOperator: 'csg', voltageLevels: [110, 220], unknownVoltageCount: 0, summary: { locatedCount: 0, approximateCount: 0, unresolvedCount: nodeCount }, priceReferenceCount: nodeCount, ...extra }
}
function node(index: number, prefix = '三都站'): GridGeoNode {
  const id = `${prefix}-${index}`, name = `${prefix}.110kV#${index}母`
  return {
    assetId: id, assetType: 'node', nodeId: id, nodeName: name, standardName: name, aliases: [], nodeKind: 'bus', voltageLevelKv: null,
    status: 'active', regionId: 'yunnan', gridOperator: 'csg', ownerCompanyId: 'company-a', version: 1, visibility: 'company', sourceRef: 'fixture',
    locationStatus: 'unresolved', location: null, marketRefs: { nodePriceParquet: 'node_price/market={da,rt}', regionName: '云南' },
    dataMeta: { sourceType: 'IMPORT', mock: false, productionWrite: false, visibility: 'company', contractVersion: '1', verifiedAt: null, note: '' },
    overrideState: { hasOverrides: false, count: 0, fieldPaths: [], latestVersion: null, updatedAt: null },
    storageMeta: { sourceType: 'DB', mock: false, productionWrite: false, schemaVersion: '1', updatedAt: '2026-09-14T00:00:00+08:00' },
  }
}
function response(items = [node(1), node(2), node(3)], page = 1, total = items.length): GridGeoNodeListResponse {
  return { code: 200, total, mock: false, productionWrite: false, sourceType: 'DB', data: { items, summary: { visibleCount: total, locatedCount: 0, approximateCount: 0, unresolvedCount: total, overriddenCount: 0 }, pagination: { page, pageSize: 60, total, totalPages: Math.max(1, Math.ceil(total / 60)) }, dataAvailability: { status: items.length ? 'available' : 'empty', fallback: false } } }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function view(groups = [group()], query: Record<string, string | number> = {}) {
  return mount(GridGeoStationTable, { props: { groups, query, scopeKey: 'yunnan:company-a' } })
}
const station = (wrapper: ReturnType<typeof view>, key = 'station-a') => wrapper.get(`[data-group-key="${key}"]`)
async function expand(wrapper: ReturnType<typeof view>, key = 'station-a') { await station(wrapper, key).get('.station-toggle').trigger('click'); await flushPromises() }
beforeEach(() => { vi.resetAllMocks(); calls.nodes.mockResolvedValue(response()) })

describe('station-level node browsing', () => {
  it('starts with one collapsed row per station and shows full group summaries without fetching nodes', () => {
    const wrapper = view([group('station-a', 125, { summary: { locatedCount: 3, approximateCount: 2, unresolvedCount: 120 }, priceReferenceCount: 121, unknownVoltageCount: 1 }), group('station-b', 8, { stationName: '乙站', displayName: '乙站' })])
    expect(wrapper.findAll('.station-row')).toHaveLength(2)
    expect(wrapper.findAll('.station-detail-row')).toHaveLength(0)
    expect(calls.nodes).not.toHaveBeenCalled()
    const first = station(wrapper)
    expect(first.get('.node-count').text()).toBe('125')
    expect(first.get('.location-counts').text()).toContain('未定位 120')
    expect(first.get('.price-count').text()).toContain('121 条节点引用')
    expect(first.get('.price-count').text()).toContain('不保证时序覆盖')
    expect(first.get('.voltage').text()).toContain('220 / 110 kV')
    expect(first.get('.voltage').text()).toContain('电压待补 1 条')
    expect(wrapper.text()).toContain('电压概览含名称解析值')
    expect(first.get('.station-toggle').attributes('aria-expanded')).toBe('false')
    expect(first.get('.station-toggle').element.tagName).toBe('BUTTON')
    expect(wrapper.get('.station-scroll').attributes('tabindex')).toBe('0')
    wrapper.unmount()
  })

  it('expands only the selected station with the complete query and delegates selection to the node table', async () => {
    const query = { keyword: '三都', nodeKind: 'bus', locationStatus: 'unresolved', objectKind: 'plant', objectId: 'plant-a' }
    const wrapper = view([group()], query)
    await expand(wrapper)
    expect(calls.nodes).toHaveBeenCalledWith({ ...query, stationGroupKey: 'station-a', page: 1, pageSize: 60 }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    const toggle = station(wrapper).get('.station-toggle')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(station(wrapper).get('.station-detail').attributes('id')).toBe(toggle.attributes('aria-controls'))
    expect(wrapper.getComponent(GridGeoNodeTable).props('caption')).toBe('已显示 3 / 本站匹配 3 条节点')
    expect(wrapper.get('[data-testid="node-table"] caption').text()).toBe('已显示 3 / 本站匹配 3 条节点')
    expect(wrapper.get('[data-testid="node-table"] caption').text()).not.toContain('当前页')
    await wrapper.get('[aria-label="查看三都站.110kV#1母详情"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[node(1)]])
    await wrapper.setProps({ selectedId: node(1).nodeId })
    expect(wrapper.get('[aria-label="查看三都站.110kV#1母详情"]').attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('keeps independent station expansions and reuses loaded data when collapsing and reopening', async () => {
    calls.nodes.mockImplementation(async query => query.stationGroupKey === 'station-b' ? response([node(1, '乙站')]) : response())
    const wrapper = view([group(), group('station-b', 1, { stationName: '乙站', displayName: '乙站' })])
    await expand(wrapper)
    await expand(wrapper, 'station-b')
    expect(wrapper.findAll('.station-detail-row')).toHaveLength(2)
    expect(station(wrapper).text()).toContain('三都站.110kV#1母')
    expect(station(wrapper, 'station-b').text()).toContain('乙站.110kV#1母')
    await station(wrapper).get('.station-toggle').trigger('click')
    expect(station(wrapper).find('.station-detail-row').exists()).toBe(false)
    await expand(wrapper)
    expect(calls.nodes).toHaveBeenCalledTimes(2)
    await wrapper.get('.station-tools button').trigger('click')
    expect(wrapper.findAll('.station-detail-row')).toHaveLength(0)
    await expand(wrapper, 'station-b')
    expect(calls.nodes).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('loads more than one node page only on request and keeps the complete station total visible', async () => {
    calls.nodes.mockImplementation(async query => {
      const start = (query.page - 1) * 60
      return response(Array.from({ length: Math.min(60, 125 - start) }, (_, index) => node(start + index + 1)), query.page, 125)
    })
    const wrapper = view([group('station-a', 125)])
    await expand(wrapper)
    expect(calls.nodes).toHaveBeenCalledTimes(1)
    expect(station(wrapper).get('.station-progress').text()).toContain('已显示 60 / 本站匹配 125 条节点')
    await wrapper.get('[aria-label="加载更多三都站的节点"]').trigger('click'); await flushPromises()
    expect(calls.nodes).toHaveBeenLastCalledWith(expect.objectContaining({ stationGroupKey: 'station-a', page: 2, pageSize: 60 }), expect.anything())
    expect(wrapper.get('[data-testid="node-table"]').findAll('tbody tr')).toHaveLength(120)
    await wrapper.get('[aria-label="加载更多三都站的节点"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="node-table"]').findAll('tbody tr')).toHaveLength(125)
    expect(station(wrapper).get('.station-progress').text()).toBe('已显示 125 / 本站匹配 125 条节点')
    expect(wrapper.find('[aria-label="加载更多三都站的节点"]').exists()).toBe(false)
    expect(calls.nodes).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })

  it('retains loaded nodes after a later-page error and retries exactly the failed page', async () => {
    const firstPage = Array.from({ length: 60 }, (_, index) => node(index + 1))
    calls.nodes.mockResolvedValueOnce(response(firstPage, 1, 61)).mockRejectedValueOnce(new Error('读取超时')).mockResolvedValueOnce(response([node(61)], 2, 61))
    const wrapper = view([group('station-a', 61)])
    await expand(wrapper)
    await wrapper.get('[aria-label="加载更多三都站的节点"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('读取超时')
    expect(wrapper.get('[data-testid="node-table"]').findAll('tbody tr')).toHaveLength(60)
    expect(wrapper.find('[aria-label="加载更多三都站的节点"]').exists()).toBe(false)
    await wrapper.get('[aria-label="重试读取三都站的节点"]').trigger('click'); await flushPromises()
    expect(calls.nodes).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.anything())
    expect(wrapper.get('[data-testid="node-table"]').findAll('tbody tr')).toHaveLength(61)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows first-page failures inline and does not silently retry when reopening', async () => {
    calls.nodes.mockRejectedValueOnce(new Error('当前公司无该站节点查看权限'))
    const wrapper = view()
    await expand(wrapper)
    expect(wrapper.get('[role="alert"]').text()).toContain('无该站节点查看权限')
    await station(wrapper).get('.station-toggle').trigger('click'); await expand(wrapper)
    expect(calls.nodes).toHaveBeenCalledTimes(1)
    await wrapper.get('[aria-label="重试读取三都站的节点"]').trigger('click'); await flushPromises()
    expect(calls.nodes).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }), expect.anything())
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each(['scope', 'query'])('aborts a late response when the %s changes and starts collapsed without old cache', async dimension => {
    const old = deferred<GridGeoNodeListResponse>()
    calls.nodes.mockReturnValueOnce(old.promise)
    const wrapper = view()
    await expand(wrapper)
    const signal = calls.nodes.mock.calls[0][1].signal as AbortSignal
    if (dimension === 'scope') await wrapper.setProps({ scopeKey: 'yunnan:company-b' })
    else await wrapper.setProps({ query: { keyword: '新筛选' } })
    expect(signal.aborted).toBe(true)
    expect(station(wrapper).get('.station-toggle').attributes('aria-expanded')).toBe('false')
    calls.nodes.mockResolvedValueOnce(response([node(1, '新范围')]))
    await expand(wrapper)
    old.resolve(response([node(1, '旧范围')]))
    await flushPromises()
    expect(wrapper.text()).toContain('新范围.110kV#1母')
    expect(wrapper.text()).not.toContain('旧范围.110kV#1母')
    if (dimension === 'query') expect(calls.nodes).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: '新筛选' }), expect.anything())
    wrapper.unmount()
  })

  it('keeps unknown stations as separate server-keyed objects', async () => {
    const wrapper = view([group('unresolved-a', 1, { stationName: null, displayName: '独立节点 A' }), group('unresolved-b', 1, { stationName: null, displayName: '独立节点 B' })])
    expect(wrapper.findAll('.station-row')).toHaveLength(2)
    expect(wrapper.text().match(/所属站未提供 · 独立条目/g)).toHaveLength(2)
    await expand(wrapper, 'unresolved-a')
    expect(calls.nodes).toHaveBeenLastCalledWith(expect.objectContaining({ stationGroupKey: 'unresolved-a' }), expect.anything())
    expect(station(wrapper, 'unresolved-b').get('.station-toggle').attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('aborts unmounted and removed groups so their old responses cannot populate a reappearing group', async () => {
    const old = deferred<GridGeoNodeListResponse>()
    calls.nodes.mockReturnValueOnce(old.promise)
    const wrapper = view()
    await expand(wrapper)
    const signal = calls.nodes.mock.calls[0][1].signal as AbortSignal
    await wrapper.setProps({ groups: [] })
    expect(signal.aborted).toBe(true)
    await wrapper.setProps({ groups: [group()] }); await expand(wrapper)
    old.resolve(response([node(1, '已移除旧组')]))
    await flushPromises()
    expect(wrapper.text()).not.toContain('已移除旧组')
    const pending = deferred<GridGeoNodeListResponse>()
    await wrapper.setProps({ scopeKey: 'new-scope' })
    calls.nodes.mockReturnValueOnce(pending.promise)
    await expand(wrapper)
    const finalSignal = calls.nodes.mock.lastCall![1].signal as AbortSignal
    wrapper.unmount()
    expect(finalSignal.aborted).toBe(true)
    pending.resolve(response()); await flushPromises()
  })

  it('does not misreport missing records as complete when a changing page repeats nodes', async () => {
    const first = response([node(1), node(2)], 1, 4)
    first.data.pagination.totalPages = 2
    const second = response([node(2), node(3)], 2, 4)
    second.data.pagination.totalPages = 2
    calls.nodes.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const wrapper = view([group('station-a', 4)])
    await expand(wrapper)
    await wrapper.get('[aria-label="加载更多三都站的节点"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="node-table"]').findAll('tbody tr')).toHaveLength(3)
    expect(wrapper.get('.station-progress').text()).toContain('已显示 3 / 本站匹配 4 条节点')
    expect(wrapper.get('.station-progress').text()).toContain('记录在读取期间发生变化')
    expect(wrapper.get('.station-progress button').text()).toBe('重新读取该站节点')
    wrapper.unmount()
  })

  it('distinguishes absent station data from an empty filter and keeps malformed pagination retryable', async () => {
    const missing = response([], 1, 0)
    missing.data.dataAvailability.status = 'missing'
    calls.nodes.mockResolvedValueOnce(missing)
    const wrapper = view()
    await expand(wrapper)
    expect(wrapper.text()).toContain('该站节点资料暂未接入')
    await wrapper.setProps({ scopeKey: 'next-scope' })
    const invalid = response()
    invalid.data.pagination.page = 5
    calls.nodes.mockResolvedValueOnce(invalid)
    await expand(wrapper)
    expect(wrapper.get('[role="alert"]').text()).toContain('分页信息不完整')
    expect(wrapper.find('[data-testid="node-table"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
