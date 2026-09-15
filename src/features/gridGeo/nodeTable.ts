import { regionProfiles } from '@/data/regions'
import { parseGridNodeName } from '@/services/gridGeo/nodeNameParser'
import type { GridGeoNode, GridGeoNodeListResponse } from './types'

export type NodeTableRow = {
  node: GridGeoNode
  station: string
  stationKey: string
  stationSpan: number
  voltage: string
  voltageBasis: string
  voltageKey: string
  voltageSpan: number
  region: string
  links: string[]
}

const validVoltage = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 1000
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Full-query summary only: an absent or inconsistent summary must never become a page-derived total. */
export function nodeListStatistics(summary: GridGeoNodeListResponse['data']['summary'] | null | undefined, total: number | null) {
  const base = { total: count(total) ? total : null, located: null as number | null, approximate: null as number | null, unresolved: null as number | null }
  if (!summary || ![summary.visibleCount, summary.locatedCount, summary.approximateCount, summary.unresolvedCount].every(count)) return base
  if (summary.visibleCount !== total || summary.locatedCount + summary.approximateCount + summary.unresolvedCount !== total) return base
  return { ...base, located: summary.locatedCount, approximate: summary.approximateCount, unresolved: summary.unresolvedCount }
}

function nodeLinks(node: GridGeoNode) {
  const refs = node.marketRefs ?? {}
  const hasPriceReference = [refs.nodePriceFamily, refs.nodePriceParquet].some(value => typeof value === 'string' && value.trim())
  return hasPriceReference ? ['节点价格引用'] : []
}

/** Group the current server page for reading; parsing neither persists fields nor establishes topology. */
export function buildNodeTableRows(nodes: GridGeoNode[], grouped = true): NodeTableRow[] {
  const rows = nodes.map(node => {
    const parsed = parseGridNodeName(node.nodeName)
    const registered = validVoltage(node.voltageLevelKv)
    // A station prefix is not the node voltage. Keep it as a note until a node value is supplied.
    const parsedNodeVoltage = parsed.basis === 'node-segment' ? parsed.voltageLevelKv : null
    const voltage = registered ? node.voltageLevelKv : parsedNodeVoltage
    const voltageBasis = registered ? '已登记' : parsedNodeVoltage !== null ? '节点名称解析' : parsed.stationVoltageKv !== null ? `站名含 ${parsed.stationVoltageKv} kV，节点待补` : '未提供'
    const parsedStation = node.grouping ? node.grouping.basis === 'name-parsed' ? node.grouping.stationName : null : parsed.stationName
    const station = parsedStation || '所属站未提供'
    return {
      node, station, stationKey: `${node.regionId}:${node.gridOperator}:${parsedStation || node.nodeId}`, stationSpan: 1,
      voltage: voltage !== null ? `${voltage} kV` : '待补录', voltageBasis,
      voltageKey: `${voltage ?? 'unknown'}:${registered ? 'registered' : parsedNodeVoltage !== null ? 'parsed' : voltageBasis}`, voltageSpan: 1,
      region: regionProfiles.find(region => region.id === node.regionId)?.shortName ?? (node.regionId || '未提供'), links: nodeLinks(node),
    }
  })
  if (!grouped) return rows
  rows.sort((a, b) => a.stationKey.localeCompare(b.stationKey, 'zh-CN', { numeric: true }) || a.voltageKey.localeCompare(b.voltageKey, 'zh-CN', { numeric: true }) || a.node.nodeName.localeCompare(b.node.nodeName, 'zh-CN', { numeric: true }) || a.node.nodeId.localeCompare(b.node.nodeId))
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (index > 0 && rows[index - 1].stationKey === row.stationKey) row.stationSpan = 0
    else {
      let next = index + 1
      while (next < rows.length && rows[next].stationKey === row.stationKey) next += 1
      row.stationSpan = next - index
    }
    if (index > 0 && rows[index - 1].stationKey === row.stationKey && rows[index - 1].voltageKey === row.voltageKey) row.voltageSpan = 0
    else {
      let next = index + 1
      while (next < rows.length && rows[next].stationKey === row.stationKey && rows[next].voltageKey === row.voltageKey) next += 1
      row.voltageSpan = next - index
    }
  }
  return rows
}
