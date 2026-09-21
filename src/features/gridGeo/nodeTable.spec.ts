// Keep parsed station/node voltage distinct and use only complete-query statistics.
// Regressions would merge unrelated objects, invent node voltages, or show page counts as totals. dljy#2897.
import { describe, expect, it } from 'vitest'
import { buildNodeTableRows, nodeListStatistics } from './nodeTable'
import type { GridGeoNode, GridGeoNodeListResponse } from './types'

const node = (id: string, name: string, extra: Partial<GridGeoNode> = {}) => ({ nodeId: id, nodeName: name, regionId: 'yunnan', gridOperator: 'csg', voltageLevelKv: null, marketRefs: {}, ...extra }) as GridGeoNode
const summary = (extra: Partial<GridGeoNodeListResponse['data']['summary']> = {}) => ({ visibleCount: 1241, locatedCount: 400, approximateCount: 100, unresolvedCount: 741, overriddenCount: 0, ...extra })

describe('node table grouping', () => {
  it('groups station then node voltage within one page without mutating assets or interpreting station voltage as node voltage', () => {
    const items = [node('b', '220kV三都站.110kV#2母'), node('a', '220kV三都站.110kV#1母'), node('c', '220kV三都站.#3母'), node('d', '220kV三都站.220kV#4母')]
    const original = structuredClone(items)
    const rows = buildNodeTableRows(items)
    expect(rows.map(row => row.node.nodeId)).toEqual(['a', 'b', 'd', 'c'])
    expect(rows[0]).toMatchObject({ station: '三都站', stationSpan: 4, voltage: '110 kV', voltageBasis: '节点名称解析', voltageSpan: 2 })
    expect(rows[1]).toMatchObject({ stationSpan: 0, voltageSpan: 0 })
    expect(rows[3]).toMatchObject({ voltage: '待补录', voltageBasis: '站名含 220 kV，节点待补' })
    expect(items).toEqual(original)
    expect(items.every(item => item.voltageLevelKv === null)).toBe(true)
  })

  it('prefers registered node voltage and keeps registered and parsed evidence separate', () => {
    const rows = buildNodeTableRows([node('a', '三都站.220kV#1母', { voltageLevelKv: 110 }), node('b', '三都站.110kV#2母')])
    expect(rows.find(row => row.node.nodeId === 'a')).toMatchObject({ voltage: '110 kV', voltageBasis: '已登记', voltageSpan: 1 })
    expect(rows.find(row => row.node.nodeId === 'b')).toMatchObject({ voltage: '110 kV', voltageBasis: '节点名称解析', voltageSpan: 1 })
  })

  it('does not merge same-name stations across regions and does not borrow missing voltage', () => {
    const rows = buildNodeTableRows([node('a', '同名站.110kV#1母'), node('b', '同名站.110kV#2母', { regionId: 'shanxi' }), node('c', '同名站.#3母')])
    expect(rows.find(row => row.node.nodeId === 'b')?.stationSpan).toBe(1)
    expect(rows.find(row => row.node.nodeId === 'b')?.region).toBe('山西')
    expect(rows.find(row => row.node.nodeId === 'c')).toMatchObject({ voltage: '待补录', voltageBasis: '未提供' })
  })

  it('labels configured references without claiming actual data coverage, and supports ungrouped server order', () => {
    const rows = buildNodeTableRows([node('b', '乙站.110kV#2母', { marketRefs: { nodePriceFamily: 'yn_node_price', relation: 'known-id', absent: null } }), node('a', '甲站.#1母', { regionId: 'new-region' })], false)
    expect(rows.map(row => row.node.nodeId)).toEqual(['b', 'a'])
    expect(rows[0].links).toEqual(['节点价格引用'])
    expect(rows[1]).toMatchObject({ region: 'new-region', links: [], stationSpan: 1, voltageSpan: 1 })
  })

  it('recognizes captured node-price references without counting regional metadata as a relationship', () => {
    const rows = buildNodeTableRows([
      node('a', '甲站.110kV#1母', { marketRefs: { nodePriceParquet: 'node_price/market={da,rt}', regionName: '云南' } }),
      node('b', '乙站.110kV#1母', { marketRefs: { nodePriceFamily: 'yn_node_price', nodePriceParquet: 'node_price/market={da,rt}', regionName: '云南' } }),
      node('c', '丙站.110kV#1母', { marketRefs: { regionName: '云南', unknownField: '原始值' } }),
      node('d', '丁站.110kV#1母', { marketRefs: { nodePriceFamily: ' ', nodePriceParquet: null } }),
    ], false)
    expect(rows.map(row => row.links)).toEqual([['节点价格引用'], ['节点价格引用'], [], []])
  })

  it('honors server grouping evidence without writing it into registered fields', () => {
    const grouping = { stationName: '三都站', stationSegment: '220kV三都站', nodeSegment: '110kV#1母', voltageLevelKv: 110, stationVoltageKv: 220, basis: 'name-parsed' as const }
    const item = node('a', '220kV三都站.110kV#1母', { grouping })
    expect(buildNodeTableRows([item])[0]).toMatchObject({ station: '三都站', voltage: '110 kV', voltageBasis: '节点名称解析' })
    expect(item.voltageLevelKv).toBeNull()
    expect(buildNodeTableRows([node('b', '未能解析的名称', { grouping: { ...grouping, stationName: null, basis: 'unparsed' } })])[0].station).toBe('所属站未提供')
  })

  it.each([0, NaN, Infinity, -1, 9999])('does not present invalid registered voltage %s as a fact', voltageLevelKv => {
    expect(buildNodeTableRows([node('a', '某站.#1母', { voltageLevelKv })])[0]).toMatchObject({ voltage: '待补录', voltageBasis: '未提供' })
  })
})

describe('node query summary', () => {
  it('uses full-query counts even when the current page has only unresolved nodes', () => {
    expect(nodeListStatistics(summary(), 1241)).toEqual({ total: 1241, located: 400, approximate: 100, unresolved: 741 })
    expect(nodeListStatistics(summary({ visibleCount: 0, locatedCount: 0, approximateCount: 0, unresolvedCount: 0 }), 0)).toEqual({ total: 0, located: 0, approximate: 0, unresolved: 0 })
  })

  it('keeps unavailable or page-derived statistics unknown', () => {
    expect(nodeListStatistics(null, 1241)).toEqual({ total: 1241, located: null, approximate: null, unresolved: null })
    expect(nodeListStatistics(summary({ visibleCount: 60, locatedCount: 0, approximateCount: 0, unresolvedCount: 60 }), 1241).located).toBeNull()
    expect(nodeListStatistics(summary({ locatedCount: 400.5 }), 1241).located).toBeNull()
    expect(nodeListStatistics(summary({ locatedCount: -1 }), 1241).located).toBeNull()
    expect(nodeListStatistics(summary({ locatedCount: NaN }), 1241).located).toBeNull()
    expect(nodeListStatistics(summary({ locatedCount: Infinity }), 1241).located).toBeNull()
    expect(nodeListStatistics(undefined, null)).toEqual({ total: null, located: null, approximate: null, unresolved: null })
  })
})
