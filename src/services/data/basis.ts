// ============================================================================
// data/basis.ts — 来源/可信度归一映射（Phase 2）
// ----------------------------------------------------------------------------
// 把项目里四套并存的「数据真伪/来源」标注归一到单一 DataSourceBasis（types.ts），
// 供 UI（DataBasisBadge）与决策层用统一口径显示可信度。归一来源：
//
//   Node /api        provenance.sourceType : MOCK | DEMO | CAPTURE | DB
//   Python BaseResp  顶层 mock:bool + sourceType: REAL | MOCK（+ productionWrite）
//   forecast         basis: real|captured|illustrative|synthetic
//                    + source_type: REAL | CAPTURED | MIXED | MOCK
//   capture.sqlite   source_type: CAPTURE | DB | IMPORT | SEED | MOCK
//
// 归一原则：保守标注——未知/缺失回落 synthetic（宁可显「合成」也不伪装真实）。
// 与 dataBasis.ts 旧兼容函数（basisFromDemoFlag/basisFromProfileSource）并存：
// 本文件专注 SourceType 枚举归一，dataBasis.ts 保留旧接入点适配。
// ============================================================================

import type { DataSourceBasis, SourceType } from './types'

/** SourceType（各套枚举并集）→ DataSourceBasis 归一映射表。 */
const SOURCE_TO_BASIS: Record<SourceType, DataSourceBasis> = {
  REAL: 'real',
  CAPTURE: 'captured',
  CAPTURED: 'captured',
  DB: 'captured',
  IMPORT: 'captured',
  FILE: 'captured',
  MIXED: 'illustrative',
  DEMO: 'illustrative',
  PUBLIC_FORECAST: 'illustrative',
  SEED: 'synthetic',
  MOCK: 'synthetic',
  SYNTHETIC: 'synthetic',
  API: 'real',
  USER_SAVED: 'user_saved'
}

/**
 * SourceType 枚举值（字符串）归一为 DataSourceBasis。
 * 未知/空值回落 synthetic（保守：宁可标合成也不伪装真实）。
 */
export function basisFromSourceType(source?: SourceType | string | null): DataSourceBasis {
  if (!source) return 'synthetic'
  const upper = String(source).toUpperCase() as SourceType
  return SOURCE_TO_BASIS[upper] ?? 'synthetic'
}

/** Python BaseResponse 顶层（mock + sourceType）→ DataSourceBasis。mock=true 强制 synthetic。 */
export function basisFromPythonEnvelope(opts: {
  mock?: boolean | null
  sourceType?: string | null
  source_type?: string | null
}): DataSourceBasis {
  if (opts.mock) return 'synthetic'
  return basisFromSourceType(opts.sourceType ?? opts.source_type)
}

/** Node Provenance（{sourceType, realDataConnected}）→ DataSourceBasis。 */
export function basisFromProvenance(
  provenance?: { sourceType?: string | null; realDataConnected?: boolean | null } | null
): DataSourceBasis {
  if (!provenance) return 'synthetic'
  if (provenance.sourceType) return basisFromSourceType(provenance.sourceType)
  // 无 sourceType 但 realDataConnected=true，保守标 captured（已接真实源）
  return provenance.realDataConnected ? 'captured' : 'synthetic'
}

/**
 * 从一个「可能带各种可信度字段」的原始响应体（Node/Python/forecast 混合）归一出
 * DataSourceBasis。按优先级：mock → sourceType/source_type → provenance → basis。
 * 供 agentRequest 基座在解信封时统一调用。
 */
export function unifyBasis(body: unknown): DataSourceBasis | undefined {
  if (!body || typeof body !== 'object') return undefined
  const b = body as Record<string, unknown>
  if (b.mock === true) return 'synthetic'
  if (typeof b.sourceType === 'string' || typeof b.source_type === 'string') {
    return basisFromSourceType((b.sourceType as string) ?? (b.source_type as string))
  }
  if (b.provenance && typeof b.provenance === 'object') {
    return basisFromProvenance(b.provenance as { sourceType?: string })
  }
  if (typeof b.basis === 'string') {
    return b.basis as DataSourceBasis
  }
  return undefined
}
