// 授权网架证据·输出契约（Issue #1339）。
//
// 本文件是纯类型声明（无运行时逻辑、不改渲染实现），描述「来源授权审计」层对下游暴露的
// 稳定引用与可用性契约。权威 schema/解析器在 shared/schema/grid-topology-evidence.mjs，
// 这里是其输出形状的 TypeScript 镜像，供渲染层（cesiumTopologyRenderer 等）未来按需消费。
//
// 契约要点（与 grid-topology-provider.md 受控空态口径一致）：
// - 无授权（status 非 authorized / 作用域不符）→ availability:'unavailable'，features:[]，
//   UI 不绘制任何猜测拓扑（零要素）。
// - authorized 但某要素坐标未知/非法 → 该稳定 ID 进 unresolvedFeatureIds（显式 unresolved，
//   不补画、不据相邻位置猜测连线）。
// - 稳定 ID 由登记表的 originKeys → stableIdPrefix 确定性映射，可撤销（status 翻 revoked 后可见性归零）。

/** 证据层处理的源级实体类别（公开 OSM 几何仅承载场站点与输电线；母线/节点/支路属受限算子模型）。 */
export type GridEvidenceEntityKind = 'substation' | 'line'

/** 登记条目授权状态：authorized=可合法使用；blocked=授权未确认不抓取；revoked=曾授权已撤销。 */
export type GridEvidenceStatus = 'authorized' | 'blocked' | 'revoked'

/** 敏感字段等级。 */
export type GridEvidenceSensitivityLevel = 'public' | 'internal' | 'restricted' | 'confidential'

/** 来源类别：决定脱敏与抓取策略。 */
export type GridEvidenceOriginKind = 'osm-public' | 'operator-restricted' | 'official-api' | 'disclosure' | 'other'

/** 可用性：unavailable 覆盖 blocked / revoked / 作用域不符 / 无样本，下游一律零要素。 */
export type GridEvidenceAvailability = 'available' | 'unavailable'

/** 单要素几何状态：resolved=有合法 WGS84 几何可绘制；unresolved=坐标未知/非法，不绘制。 */
export type GridEvidenceGeometryStatus = 'resolved' | 'unresolved'

/** WGS84 经纬度位置（[经度, 纬度] 或带高程）。 */
export type GridEvidencePosition = [longitude: number, latitude: number] | [longitude: number, latitude: number, elevationM: number]

/** 证据层几何（仅 Point / LineString；场站点与输电线，无多线/断面）。 */
export type GridEvidenceGeometry =
  | { type: 'Point'; coordinates: GridEvidencePosition }
  | { type: 'LineString'; coordinates: GridEvidencePosition[] }

/**
 * 已解析的稳定要素——下游唯一可消费的形状。
 * 只携带稳定 ID、源级身份与 WGS84 几何；不含潮流、热限额、负载率、N-1、母线连接关系。
 */
export interface GridEvidenceFeature {
  /** 稳定 ID（登记表 stableIdPrefix + originKeys 派生），可撤销映射的唯一键。 */
  stableId: string
  kind: GridEvidenceEntityKind
  /** 原始识别键拼接值（如 OSM 的 `way-1121935644`），用于审计回溯原始来源。 */
  originKey: string
  /** 来源引用 `${sourceId}@${version}`，绑定授权时点。 */
  sourceRef: string
  name: string | null
  voltage: string | null
  geometryStatus: 'resolved'
  geometry: GridEvidenceGeometry
}

/**
 * 来源授权审计登记条目（config/grid-topology/evidence-registry.json 的 TS 镜像）。
 */
export interface GridEvidenceRegistryEntry {
  sourceId: string
  source: string
  originKind: GridEvidenceOriginKind
  license: string | null
  licenseUrl: string | null
  attribution: string | null
  version: string | null
  asOf: string | null
  crs: 'WGS84'
  regionId: string
  gridOperator: 'csg' | 'sgcc' | 'mengxi' | 'other'
  /** 各实体的原始识别键（OSM 用 osm_type+osm_id；受限算子模型用 operator_asset_id 等）。 */
  originKeys: Record<GridEvidenceEntityKind, string[]>
  /** 各实体的稳定 ID 前缀（如 osm:line: / csg:substation:）。 */
  stableIdPrefix: Record<GridEvidenceEntityKind, string>
  /** 地区边界 [south, west, north, east]（authorized 必填）：解析阶段拒绝越域几何。 */
  bbox?: [number, number, number, number] | null
  sensitivityLevel: GridEvidenceSensitivityLevel
  status: GridEvidenceStatus
  statusNote: string
  authorizationRef: string | null
  /** 原始授权资料路径（仅 data/private/，gitignored，对组织仓不可见）。 */
  evidenceRef: string | null
  /** 脱敏样本路径（authorized 公开来源进 git）。 */
  fixtureRef: string | null
  redistributionAllowed: boolean
  revokedAt: string | null
  revocationReason: string | null
}

/**
 * 可撤销稳定引用解析结果（resolveEvidenceFeatures 输出契约）。
 * - availability:'unavailable' 时 features 必为空（零要素，不绘制猜测拓扑）。
 * - unresolvedFeatureIds 标注 authorized 但坐标未知的稳定 ID（显式 unresolved，不补画）。
 */
export interface GridTopologyEvidenceResult {
  /** entry-invalid（伪造/残缺条目、null 入参）时为 null。 */
  sourceId: string | null
  /** 授权来源与版本的稳定审计引用；无版本的 blocked 来源为 null。 */
  sourceRef: string | null
  /** 经登记校验后的来源状态；entry-invalid 时为 null。 */
  status: GridEvidenceStatus | null
  version: string | null
  asOf: string | null
  crs: 'WGS84' | null
  regionId: string | null
  gridOperator: 'csg' | 'sgcc' | 'mengxi' | 'other' | null
  availability: GridEvidenceAvailability
  /** unavailable 时的原因码（entry-invalid / source-revoked / source-blocked / scope-missing / scope-mismatch / provenance-mismatch / fixture-missing / ok）。 */
  reason: string
  features: GridEvidenceFeature[]
  unresolvedFeatureIds: string[]
  license: string | null
  licenseUrl: string | null
  attribution: string | null
  /** 始终为 true：稳定 ID 映射可撤销（status 翻转后下游可见性归零）。 */
  revocable: true
}

/** 请求作用域：地区/电网严格匹配，跨域 fail-closed。 */
export interface GridEvidenceScope {
  regionId: string
  gridOperator: string
}

/** 视觉层只读端点信封：items 均为 resolveEvidenceFeatures 的原样输出。 */
export interface GridTopologyEvidenceResponse {
  code: number
  data: {
    contractVersion: '1.0.0'
    registryVersion: string
    items: GridTopologyEvidenceResult[]
    dataAvailability: {
      status: 'available' | 'unavailable'
      reason: string
      regionRequested: string
      regionServed: string | null
      fallback: false
    }
  }
  sourceType: 'IMPORT'
  mock: false
  productionWrite: false
}
