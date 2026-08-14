import type { GridGeoViewMode, GridTopologyFeature, GridTopologyFeatureKind } from '../types'

export type TopologyVisualStyle = {
  color: string
  width: number
  pointSize: number
  showLabel: boolean
  dashed: boolean
}

const CSG_COLORS: Record<GridTopologyFeatureKind, string> = {
  substation: '#55e5ff', bus: '#a7f3d0', node: '#72f1b8', branch: '#5ba8ff', section: '#ffc85b', intertie: '#c69cff',
}
const SGCC_COLORS: Record<GridTopologyFeatureKind, string> = {
  substation: '#70d6ff', bus: '#9de6cf', node: '#65e5b8', branch: '#78a8ff', section: '#f0bf63', intertie: '#d3a0ff',
}

export function topologyVisualStyle(feature: GridTopologyFeature, options: {
  selected: boolean
  gridOperator: 'csg' | 'sgcc'
  viewMode: GridGeoViewMode
  lod: 0 | 1 | 2
  weakNetwork: boolean
}): TopologyVisualStyle {
  const palette = options.gridOperator === 'sgcc' ? SGCC_COLORS : CSG_COLORS
  const inactive = !['active', 'available', 'in-service', '运行', '在运'].includes(feature.status.toLowerCase())
  const color = options.selected ? '#ffe58a' : inactive ? '#71889a' : palette[feature.kind]
  const lineKind = ['branch', 'section', 'intertie'].includes(feature.kind)
  return {
    color,
    width: options.selected ? 7 : feature.kind === 'section' ? 5 : feature.kind === 'intertie' ? 4 : 3,
    pointSize: options.selected ? 17 : feature.kind === 'substation' ? 13 : feature.kind === 'bus' ? 11 : 9,
    showLabel: !options.weakNetwork && (options.selected || options.lod >= 1 || !lineKind) && options.viewMode !== '2d',
    dashed: inactive,
  }
}

export function topologyFeatureLabel(kind: GridTopologyFeatureKind) {
  return ({ substation: '变电站', bus: '母线', node: '节点', branch: '线路', section: '断面', intertie: '联络线' } as const)[kind]
}
