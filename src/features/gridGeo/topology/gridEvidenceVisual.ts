import type { GridTopologyFeature } from '../types'
import type {
  GridEvidenceFeature,
  GridTopologyEvidenceResult,
} from './gridEvidence'

export type GridEvidenceVisualScope = {
  regionId: string
  gridOperator: string
  ownerCompanyId: string
}

function completeScope(scope: GridEvidenceVisualScope) {
  return Boolean(scope.regionId.trim() && scope.gridOperator.trim() && scope.ownerCompanyId.trim())
}

/**
 * 只把已经过 resolveEvidenceFeatures 闸门的结果翻译成 Cesium 既有视觉类型。
 * 这里不解析 GeoJSON、不补坐标、不推断端点；任何输出/作用域字段残缺或不一致都归零。
 */
export function evidenceToTopologyFeatures(
  result: GridTopologyEvidenceResult | null,
  scope: GridEvidenceVisualScope,
): GridTopologyFeature[] {
  if (!result || result.availability !== 'available' || !completeScope(scope)) return []
  if (
    result.status !== 'authorized'
    || result.crs !== 'WGS84'
    || !result.sourceRef
    || !result.version
    || result.regionId !== scope.regionId
    || result.gridOperator !== scope.gridOperator
    || !['csg', 'sgcc'].includes(scope.gridOperator)
  ) return []

  const sourceRef = result.sourceRef
  const version = result.version
  return result.features.flatMap((feature) => {
    if (
      feature.geometryStatus !== 'resolved'
      || feature.sourceRef !== sourceRef
      || (feature.kind === 'substation' && feature.geometry.type !== 'Point')
      || (feature.kind === 'line' && feature.geometry.type !== 'LineString')
    ) return []
    return [{
      featureId: feature.stableId,
      kind: feature.kind === 'line' ? 'branch' : 'substation',
      name: feature.name ?? (feature.kind === 'line' ? '未命名授权线路' : '未命名授权变电站'),
      status: 'available',
      topologyVersion: version,
      sourceRef: feature.sourceRef,
      classification: 'public',
      ownerCompanyId: scope.ownerCompanyId,
      regionId: scope.regionId,
      gridOperator: scope.gridOperator as 'csg' | 'sgcc',
      geometry: feature.geometry,
      refs: { sourceFeatureId: feature.originKey },
    } satisfies GridTopologyFeature]
  })
}

export function preferredEvidenceSourceId(
  items: GridTopologyEvidenceResult[],
  currentSourceId: string | null = null,
) {
  if (currentSourceId && items.some((item) => item.sourceId === currentSourceId)) return currentSourceId
  return items.find((item) => item.availability === 'available')?.sourceId
    ?? items[0]?.sourceId
    ?? null
}

export function findEvidenceFeature(
  result: GridTopologyEvidenceResult | null,
  stableId: string | null,
): GridEvidenceFeature | null {
  if (!result || result.availability !== 'available' || !stableId) return null
  return result.features.find((feature) => feature.stableId === stableId) ?? null
}

export function evidenceReasonLabel(result: GridTopologyEvidenceResult | null) {
  if (!result) return '尚未选择证据版本'
  if (result.reason.startsWith('source-revoked:')) return `版本已撤销：${result.reason.slice('source-revoked:'.length).trim()}`
  if (result.reason.startsWith('source-blocked:')) return '来源未授权：不抓取、不推断、不绘制'
  if (result.reason.startsWith('scope-missing:')) return '作用域不完整：已按 fail-closed 归零'
  if (result.reason.startsWith('scope-mismatch:')) return '地区或电网不匹配：已按 fail-closed 归零'
  if (result.reason.startsWith('fixture-missing:')) return '脱敏样本不可用：未绘制任何要素'
  if (result.reason.startsWith('provenance-mismatch:')) return '来源证据不一致：已按 fail-closed 归零'
  if (result.reason.startsWith('entry-invalid:')) return '登记项校验失败：已按 fail-closed 归零'
  return result.availability === 'available' ? '授权证据可用' : result.reason
}
