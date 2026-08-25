import type {
  ModelCapabilities,
  ModelConfigDescriptor,
  ModelIo,
  ModelIoCovariate,
  ModelLineage,
  ModelParamField,
  ModelQuality,
  ModelRegistryEntry,
  ModelShadowGate,
  ModelStage,
  ModelVersionInfo,
  Provenance,
  ProvenanceBasis,
  SourceType,
} from './modelContractTypes'

export type {
  ModelConfigDescriptor,
  ModelQuality,
  ModelRegistryEntry,
  ModelShadowGate,
  ModelStage,
} from './modelContractTypes'

// 模型管理契约（dljy-contracts 1.5.0）
// 后端 /forecast/models 当前仍可能返回旧 snake_case catalog。客户端在唯一边界处白名单归一为
// ModelRegistryEntry；页面和 provider 不再消费 legacy id/reason/source_type/quality 字段。
export type ForecastModel = ModelRegistryEntry
export type { ModelIo, ModelIoCovariate, ModelLineage, ModelParamField } from './modelContractTypes'

export type ForecastModelCatalog = {
  target: string
  regionId: string
  available: boolean
  models: ModelRegistryEntry[]
  unavailableReason: string | null
}

const LEGACY_MODEL_BASIS_VERSION = 'legacy-forecast-catalog.v1'
const PROVENANCE_BASES = new Set<ProvenanceBasis>([
  'real', 'captured', 'illustrative', 'synthetic', 'forecast', 'user_saved', 'imported', 'derived', 'reference',
])
const SOURCE_TYPES = new Set<SourceType>([
  'REAL', 'CAPTURE', 'DB', 'IMPORT', 'MOCK', 'MIXED', 'OFFICIAL_API', 'CSG_DISCLOSURE', 'CONFIG', 'DEMO',
])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function nonEmpty(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}

function nullableText(value: unknown): string | null | undefined {
  return value === null ? null : nonEmpty(value)
}

function finiteOrNull(value: unknown): number | null | undefined {
  if (value === null) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isoTime(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value * 1000).toISOString()
  return nonEmpty(value)
}

function normalizeProvenance(value: unknown): Provenance | null {
  const raw = asRecord(value)
  const basis = nonEmpty(raw.basis) as ProvenanceBasis | undefined
  const sourceType = nonEmpty(raw.sourceType ?? raw.source_type)?.toUpperCase() as SourceType | undefined
  // productionWrite 与 sourceType 同样兼容 snake_case（后端 provenance 可能以 production_write 发送）。
  const productionWrite = raw.productionWrite ?? raw.production_write
  if (!basis || !PROVENANCE_BASES.has(basis) || !sourceType || !SOURCE_TYPES.has(sourceType)
      || typeof raw.mock !== 'boolean' || typeof productionWrite !== 'boolean') return null
  return { basis, sourceType, mock: raw.mock, productionWrite }
}

function legacyProvenance(raw: Record<string, unknown>, meta: Record<string, unknown>): Provenance {
  const mock = raw.mock === true
  const rawBasis = nonEmpty(raw.basis ?? meta.basis) as ProvenanceBasis | undefined
  const basis = rawBasis && PROVENANCE_BASES.has(rawBasis) ? rawBasis : (mock ? 'synthetic' : 'reference')
  const rawSource = nonEmpty(raw.sourceType ?? raw.source_type ?? meta.sourceType ?? meta.source_type)?.toUpperCase() as SourceType | undefined
  const sourceType = rawSource && SOURCE_TYPES.has(rawSource) ? rawSource : (mock ? 'MOCK' : 'REAL')
  return { basis, sourceType, mock, productionWrite: false }
}

function normalizeCapabilities(value: unknown): ModelCapabilities | undefined {
  const raw = asRecord(value)
  const supportsQuantiles = raw.supportsQuantiles ?? raw.supports_quantiles
  const supportsCovariates = raw.supportsCovariates ?? raw.supports_covariates
  const supportsMultivariate = raw.supportsMultivariate ?? raw.supports_multivariate
  const horizon = raw.horizon
  if (typeof supportsQuantiles !== 'boolean' || typeof supportsCovariates !== 'boolean'
      || typeof supportsMultivariate !== 'boolean' || !Number.isInteger(horizon) || Number(horizon) < 1) return undefined
  const zeroShot = raw.zeroShot ?? raw.zero_shot
  return {
    supportsQuantiles,
    supportsCovariates,
    supportsMultivariate,
    horizon: Number(horizon),
    ...(typeof zeroShot === 'boolean' ? { zeroShot } : {}),
  }
}

function normalizeQuality(value: unknown): ModelQuality | undefined {
  const raw = asRecord(value)
  const passesSkillGate = raw.passesSkillGate ?? raw.passes_skill_gate
  const sourceRun = nonEmpty(raw.sourceRun ?? raw.source_run)
  // 未回测/null 不是 false；契约 quality 块要求 boolean，故整块诚实缺席。
  if (typeof passesSkillGate !== 'boolean' || (sourceRun !== 'full' && sourceRun !== 'lag_only')) return undefined
  return {
    passesSkillGate,
    skillVsLear: finiteOrNull(raw.skillVsLear ?? raw.skill_vs_lear),
    skillVsSeasonalNaive: finiteOrNull(raw.skillVsSeasonalNaive ?? raw.skill_vs_seasonal_naive),
    sourceRun,
  }
}

function normalizeShadowGate(value: unknown): ModelShadowGate | undefined {
  const raw = asRecord(value)
  if (typeof raw.passed !== 'boolean') return undefined
  return {
    passed: raw.passed,
    report: nullableText(raw.report),
    checkedAt: isoTime(raw.checkedAt ?? raw.checked_at),
  }
}

function normalizeVersion(value: unknown): ModelVersionInfo | undefined {
  const raw = asRecord(value)
  // version 块对齐同文件其余归一函数，兼容 snake_case（后端 model_versions.py 全 snake_case）。
  const isActive = raw.isActive ?? raw.is_active
  const isDefault = raw.isDefault ?? raw.is_default
  if (typeof isActive !== 'boolean' || typeof isDefault !== 'boolean') return undefined
  const metricsRaw = asRecord(raw.metrics)
  const metrics = raw.metrics === null ? null : Object.keys(metricsRaw).length ? {
    rmse: finiteOrNull(metricsRaw.rmse),
    mae: finiteOrNull(metricsRaw.mae),
    r2: finiteOrNull(metricsRaw.r2),
  } : undefined
  const stationId = raw.stationId ?? raw.station_id
  const trainSamples = raw.trainSamples ?? raw.train_samples
  return {
    stationId: stationId === null ? null : (Number.isInteger(stationId) ? Number(stationId) : undefined),
    modelType: nonEmpty(raw.modelType ?? raw.model_type),
    metrics,
    trainSamples: trainSamples === null ? null : (Number.isInteger(trainSamples) ? Number(trainSamples) : undefined),
    isActive,
    isDefault,
    description: nullableText(raw.description),
    createdAt: nonEmpty(raw.createdAt ?? raw.created_at),
    trainedAt: isoTime(raw.trainedAt ?? raw.trained_at),
  }
}

const PARAM_FIELD_TYPES = new Set(['number', 'slider', 'switch', 'select'])

/** io（dljy#2461）：缺 intervalMinutes 或 covariates 非数组 → 整块缺席（不拿半截门槛冒充完整）。 */
function normalizeIo(value: unknown): ModelIo | undefined {
  const raw = asRecord(value)
  const interval = raw.intervalMinutes
  if (!Number.isInteger(interval) || Number(interval) < 1 || !Array.isArray(raw.covariates)) return undefined
  const covariates: ModelIoCovariate[] = []
  for (const item of raw.covariates) {
    const c = asRecord(item)
    const field = nonEmpty(c.field)
    const status = c.platformStatus === 'blocked' ? 'blocked' : c.platformStatus === 'available' ? 'available' : null
    if (!field || !status) continue
    covariates.push({
      field, platformStatus: status,
      ...(nonEmpty(c.labelZh) ? { labelZh: nonEmpty(c.labelZh) } : {}),
      ...(nonEmpty(c.unit) ? { unit: nonEmpty(c.unit) } : {}),
      ...(status === 'blocked' ? { blockedReason: nullableText(c.blockedReason) ?? null } : {}),
    })
  }
  const quantiles = Array.isArray(raw.quantilesSupported)
    ? raw.quantilesSupported.filter((q): q is number => typeof q === 'number' && Number.isFinite(q)) : []
  return {
    intervalMinutes: Number(interval), covariates, quantilesSupported: quantiles,
    ...(Number.isInteger(raw.seqLen) ? { seqLen: Number(raw.seqLen) } : {}),
    ...(Number.isInteger(raw.predLen) ? { predLen: Number(raw.predLen) } : {}),
  }
}

/** paramsSchema：逐项校验，不合法的项丢弃（一个坏声明不该让整个面板消失）。 */
function normalizeParamsSchema(value: unknown): ModelParamField[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: ModelParamField[] = []
  for (const item of value) {
    const p = asRecord(item)
    const key = nonEmpty(p.key); const label = nonEmpty(p.label); const type = nonEmpty(p.type)
    if (!key || !label || !type || !PARAM_FIELD_TYPES.has(type) || !('default' in p)) continue
    const options = Array.isArray(p.options)
      ? p.options.map((o) => asRecord(o)).filter((o) => 'value' in o && nonEmpty(o.label))
        .map((o) => ({ value: o.value, label: String(o.label) }))
      : undefined
    out.push({
      key, label, type: type as ModelParamField['type'], default: p.default,
      ...(typeof p.min === 'number' ? { min: p.min } : {}),
      ...(typeof p.max === 'number' ? { max: p.max } : {}),
      ...(typeof p.step === 'number' ? { step: p.step } : {}),
      ...(nonEmpty(p.unit) ? { unit: nonEmpty(p.unit) } : {}),
      ...(nonEmpty(p.noteZh) ? { noteZh: nonEmpty(p.noteZh) } : {}),
      ...(options && options.length ? { options } : {}),
    })
  }
  return out
}

function normalizeLineage(value: unknown): ModelLineage | undefined {
  const raw = asRecord(value)
  if (!Object.keys(raw).length) return undefined
  const trainWindow = Array.isArray(raw.trainWindow) ? raw.trainWindow.map(String) : raw.trainWindow === null ? null : undefined
  return {
    ...(nonEmpty(raw.version) ? { version: nonEmpty(raw.version) } : {}),
    ...('activeVersion' in raw ? { activeVersion: nullableText(raw.activeVersion) ?? null } : {}),
    ...(Number.isInteger(raw.versionCount) || raw.versionCount === null ? { versionCount: raw.versionCount as number | null } : {}),
    ...('bundleId' in raw ? { bundleId: nullableText(raw.bundleId) ?? null } : {}),
    ...('checksum' in raw ? { checksum: nullableText(raw.checksum) ?? null } : {}),
    ...('trainedAt' in raw ? { trainedAt: nullableText(raw.trainedAt) ?? null } : {}),
    ...(trainWindow !== undefined ? { trainWindow } : {}),
    ...('dataSeenThrough' in raw ? { dataSeenThrough: nullableText(raw.dataSeenThrough) ?? null } : {}),
    ...('lineageNote' in raw ? { lineageNote: nullableText(raw.lineageNote) ?? null } : {}),
    ...('evidenceLevel' in raw ? { evidenceLevel: nullableText(raw.evidenceLevel) ?? null } : {}),
    ...(typeof raw.mock === 'boolean' ? { mock: raw.mock } : {}),
    ...(typeof raw.loaded === 'boolean' || raw.loaded === null ? { loaded: raw.loaded as boolean | null } : {}),
  }
}

export function normalizeModelRegistryEntry(
  input: unknown,
  context: { target: string; regionId: string },
): ModelRegistryEntry | null {
  const raw = asRecord(input)
  const meta = asRecord(raw.meta)
  const modelId = nonEmpty(raw.modelId ?? raw.id ?? raw.model_id)
  if (!modelId) return null
  const target = nonEmpty(raw.target ?? meta.target) ?? context.target
  const regionRaw = raw.regionId ?? raw.region_id ?? meta.regionId ?? meta.region_id
  const regionId = regionRaw === null ? null : (nonEmpty(regionRaw) ?? context.regionId)
  const available = raw.available === true
  const stageRaw = nonEmpty(raw.stage)
  const stage: ModelStage | undefined = stageRaw === 'staging' || stageRaw === 'production' ? stageRaw : undefined
  const shadowGate = normalizeShadowGate(raw.shadowGate ?? raw.shadow_gate ?? meta.shadowGate ?? meta.shadow_gate)
  const provenance = normalizeProvenance(raw.provenance) ?? legacyProvenance(raw, meta)
  // #1461：逐模型支持的目标清单。后端目录已按 target 过滤（不支持的不进目录），
  // 此字段供前端 provider 保留它声明的目标范围（如 physics_hybrid 仅 renewable）。
  // 非数组或空 → undefined（缺省=全集，向后兼容旧目录）。
  const rawTargets = raw.supportedTargets ?? raw.supported_targets
  const supportedTargets = Array.isArray(rawTargets)
    ? rawTargets.filter((t): t is string => typeof t === 'string' && t.length > 0)
    : undefined
  return {
    modelId,
    name: nonEmpty(raw.name ?? meta.displayName ?? meta.display_name),
    target,
    regionId,
    namespace: nonEmpty(raw.namespace),
    tier: nonEmpty(raw.tier),
    available,
    unavailableReason: nullableText(raw.unavailableReason ?? raw.unavailable_reason ?? raw.reason),
    stage,
    shadowGate,
    capabilities: normalizeCapabilities(raw.capabilities),
    quality: normalizeQuality(raw.quality),
    version: normalizeVersion(raw.version),
    supportedTargets: supportedTargets && supportedTargets.length ? supportedTargets : undefined,
    // dljy-contracts 2.1.0（dljy#2461）：全部可选，缺省即缺席
    unit: nonEmpty(raw.unit),
    framework: nonEmpty(raw.framework),
    source: nonEmpty(raw.source),
    io: normalizeIo(raw.io),
    paramsSchema: normalizeParamsSchema(raw.paramsSchema),
    lineage: normalizeLineage(raw.lineage),
    basisVersion: nonEmpty(raw.basisVersion ?? raw.basis_version) ?? LEGACY_MODEL_BASIS_VERSION,
    provenance,
  }
}

export function normalizeForecastModelCatalog(
  input: unknown,
  context: { target: string; regionId: string },
): ForecastModelCatalog {
  const raw = asRecord(input)
  const source = Array.isArray(raw.models) ? raw.models : []
  const models = source
    .map((item) => normalizeModelRegistryEntry(item, context))
    .filter((item): item is ModelRegistryEntry => item !== null)
  return {
    target: nonEmpty(raw.target) ?? context.target,
    regionId: context.regionId,
    available: models.length > 0,
    models,
    unavailableReason: models.length > 0 ? null : '当前地区没有可消费的模型目录产物',
  }
}

// ModelConfigDescriptor 只接受已符合 1.5.0 的安全只读形状，并白名单拣取字段。
// 旧 /model-config 接口含私有配置字段，且缺 kind/isActive/provenance，
// 因而会返回 null；在服务端提供安全 DTO 前，前端不得把旧响应伪装成契约描述符。
export function normalizeModelConfigDescriptor(input: unknown): ModelConfigDescriptor | null {
  const raw = asRecord(input)
  const configName = nonEmpty(raw.configName)
  const kind = raw.kind === 'training' || raw.kind === 'llm' ? raw.kind : null
  const basisVersion = nonEmpty(raw.basisVersion)
  const provenance = normalizeProvenance(raw.provenance)
  if (!configName || !kind || typeof raw.isActive !== 'boolean' || !basisVersion || !provenance) return null
  return {
    configName,
    kind,
    provider: nullableText(raw.provider),
    defaultModel: nullableText(raw.defaultModel),
    description: nullableText(raw.description),
    isActive: raw.isActive,
    createdAt: nonEmpty(raw.createdAt),
    updatedAt: isoTime(raw.updatedAt),
    basisVersion,
    provenance,
  }
}
