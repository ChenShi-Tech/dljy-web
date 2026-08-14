import { describe, expect, it } from 'vitest'
import type { GridTopologyFeature } from '../types'
import { topologyFeatureLabel, topologyVisualStyle } from './topologyStyle'

function feature(overrides: Partial<GridTopologyFeature> = {}): GridTopologyFeature {
  return {
    featureId: 'branch:one', kind: 'branch', name: '授权线路一', status: 'active', topologyVersion: 'v1', sourceRef: 'source-one',
    classification: 'restricted', ownerCompanyId: 'company-one', regionId: 'yunnan', gridOperator: 'csg',
    geometry: { type: 'LineString', coordinates: [[100, 24], [101, 25]] }, refs: { fromBusId: 'bus:a', toBusId: 'bus:b' },
    ...overrides,
  }
}

describe('topology visual truth', () => {
  it('只按要素类型、权威状态和电网画像着色', () => {
    const base = topologyVisualStyle(feature(), { selected: false, gridOperator: 'csg', viewMode: '3d', lod: 1, weakNetwork: false })
    const inactive = topologyVisualStyle(feature({ status: 'out-of-service' }), { selected: false, gridOperator: 'csg', viewMode: '3d', lod: 1, weakNetwork: false })
    expect(base.color).toBe('#5ba8ff')
    expect(inactive.color).toBe('#71889a')
    expect(Object.keys(base)).not.toContain('flowDirection')
    expect(Object.keys(base)).not.toContain('loadingRate')
  })

  it('弱网与 2D 抑制非必要标签，选择仍保留高亮', () => {
    const weak = topologyVisualStyle(feature(), { selected: false, gridOperator: 'csg', viewMode: '3d', lod: 2, weakNetwork: true })
    const selected = topologyVisualStyle(feature(), { selected: true, gridOperator: 'csg', viewMode: '2d', lod: 2, weakNetwork: false })
    expect(weak.showLabel).toBe(false)
    expect(selected.color).toBe('#ffe58a')
    expect(selected.width).toBeGreaterThan(weak.width)
  })

  it('六类权威要素都有明确中文术语', () => {
    expect(['substation', 'bus', 'node', 'branch', 'section', 'intertie'].map((kind) => topologyFeatureLabel(kind as GridTopologyFeature['kind']))).toEqual(['变电站', '母线', '节点', '线路', '断面', '联络线'])
  })
})
