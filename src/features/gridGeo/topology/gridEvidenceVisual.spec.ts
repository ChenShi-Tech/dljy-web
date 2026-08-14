import { describe, expect, it } from 'vitest'
import type { GridTopologyEvidenceResult } from './gridEvidence'
import {
  evidenceReasonLabel,
  evidenceToTopologyFeatures,
  findEvidenceFeature,
  preferredEvidenceSourceId,
} from './gridEvidenceVisual'

const available = (): GridTopologyEvidenceResult => ({
  sourceId: 'osm-yunnan',
  sourceRef: 'osm-yunnan@v2',
  status: 'authorized',
  version: 'v2',
  asOf: '2026-07-24',
  crs: 'WGS84',
  regionId: 'yunnan',
  gridOperator: 'csg',
  availability: 'available',
  reason: 'ok',
  features: [
    {
      stableId: 'osm:substation:node-1',
      kind: 'substation',
      originKey: 'node-1',
      sourceRef: 'osm-yunnan@v2',
      name: null,
      voltage: null,
      geometryStatus: 'resolved',
      geometry: { type: 'Point', coordinates: [102.7, 24.8] },
    },
    {
      stableId: 'osm:line:way-2',
      kind: 'line',
      originKey: 'way-2',
      sourceRef: 'osm-yunnan@v2',
      name: '授权线路',
      voltage: '220000',
      geometryStatus: 'resolved',
      geometry: { type: 'LineString', coordinates: [[102.7, 24.8], [102.8, 24.9]] },
    },
  ],
  unresolvedFeatureIds: [],
  license: 'ODbL',
  licenseUrl: 'https://opendatacommons.org/licenses/odbl/',
  attribution: '© OpenStreetMap contributors',
  revocable: true,
})

const scope = { regionId: 'yunnan', gridOperator: 'csg', ownerCompanyId: 'company-yunnan' }

describe('grid evidence visual adapter', () => {
  it('只映射闸门已放行的点线要素，并保留稳定 ID 与 sourceRef', () => {
    const rendered = evidenceToTopologyFeatures(available(), scope)
    expect(rendered).toHaveLength(2)
    expect(rendered.map((item) => [item.featureId, item.kind, item.sourceRef])).toEqual([
      ['osm:substation:node-1', 'substation', 'osm-yunnan@v2'],
      ['osm:line:way-2', 'branch', 'osm-yunnan@v2'],
    ])
    expect(rendered[0].geometry).toEqual({ type: 'Point', coordinates: [102.7, 24.8] })
  })

  it('作用域残缺/不匹配、撤销和来源引用漂移都归零', () => {
    expect(evidenceToTopologyFeatures(available(), { ...scope, ownerCompanyId: '' })).toEqual([])
    expect(evidenceToTopologyFeatures(available(), { ...scope, regionId: 'shanxi', gridOperator: 'sgcc' })).toEqual([])
    expect(evidenceToTopologyFeatures({ ...available(), availability: 'unavailable', status: 'revoked', features: [] }, scope)).toEqual([])
    const drifted = available()
    drifted.features[0] = { ...drifted.features[0], sourceRef: 'other@v1' }
    expect(evidenceToTopologyFeatures(drifted, scope)).toHaveLength(1)
    expect(evidenceToTopologyFeatures(drifted, scope)[0].featureId).toBe('osm:line:way-2')
  })

  it('版本选择优先保留当前项，否则选择首个 available', () => {
    const revoked = { ...available(), sourceId: 'old', availability: 'unavailable' as const, status: 'revoked' as const, features: [] }
    expect(preferredEvidenceSourceId([revoked, available()], 'old')).toBe('old')
    expect(preferredEvidenceSourceId([revoked, available()], null)).toBe('osm-yunnan')
    expect(preferredEvidenceSourceId([], null)).toBeNull()
  })

  it('选中详情和诚实空态只来自解析结果', () => {
    expect(findEvidenceFeature(available(), 'osm:line:way-2')?.voltage).toBe('220000')
    expect(findEvidenceFeature(available(), 'missing')).toBeNull()
    expect(evidenceReasonLabel({ ...available(), availability: 'unavailable', reason: 'source-blocked: no', features: [] }))
      .toContain('未授权')
  })
})
