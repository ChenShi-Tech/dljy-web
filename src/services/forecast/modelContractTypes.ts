// #1640：自 packages/platform-sdk/src/model-contract.ts 搬入（platform-sdk 包随拆仓归档删除，
// 本文件是其唯一存续消费面，预测模型注册表契约类型，纯类型零运行时）。
// Vendored from @chenshi-tech/dljy-contracts@1.5.0：模型管理只读 DTO。
//
// 这里只保留 ModelRegistryEntry / ModelConfigDescriptor 及其直接依赖，不包含模型权重、
// 特征清单、训练超参、LLM 网关或密钥。契约事实源仍是 dljy-contracts；本文件只是原仓
// 前端在未直接安装 contracts 包时使用的类型快照。

// #1640：原 platform-sdk/envelope.ts 中被本文件消费的三个类型内联于此（信封本体不再需要）。
export type ProvenanceBasis = 'real' | 'captured' | 'illustrative' | 'synthetic' | 'forecast' | 'user_saved' | 'imported' | 'derived' | 'reference'
export type SourceType = 'REAL' | 'CAPTURE' | 'DB' | 'IMPORT' | 'MOCK' | 'MIXED' | 'OFFICIAL_API' | 'CSG_DISCLOSURE' | 'CONFIG' | 'DEMO'
export interface Provenance { basis: ProvenanceBasis; sourceType: SourceType; mock: boolean; productionWrite: boolean }

export type ModelStage = 'staging' | 'production'
export type ModelQualitySourceRun = 'full' | 'lag_only'
export type ModelConfigKind = 'training' | 'llm'

export interface ModelShadowGate {
  passed: boolean
  report?: string | null
  checkedAt?: string | null
}

export interface ModelCapabilities {
  supportsQuantiles: boolean
  supportsCovariates: boolean
  supportsMultivariate: boolean
  horizon: number
  zeroShot?: boolean
}

export interface ModelQuality {
  passesSkillGate: boolean
  skillVsLear?: number | null
  skillVsSeasonalNaive?: number | null
  sourceRun: ModelQualitySourceRun
}

export interface ModelVersionMetrics {
  rmse?: number | null
  mae?: number | null
  r2?: number | null
}

export interface ModelVersionInfo {
  stationId?: number | null
  modelType?: string
  metrics?: ModelVersionMetrics | null
  trainSamples?: number | null
  isActive: boolean
  isDefault: boolean
  description?: string | null
  createdAt?: string
  trainedAt?: string | null
}

export interface ModelRegistryEntry {
  modelId: string
  name?: string
  target: string
  regionId: string | null
  namespace?: string
  tier?: string
  available: boolean
  unavailableReason?: string | null
  stage?: ModelStage
  shadowGate?: ModelShadowGate
  capabilities?: ModelCapabilities
  quality?: ModelQuality
  version?: ModelVersionInfo
  /** 该模型实际支持的预测目标清单（#1461）。缺省=支持全部目标（向后兼容）。 */
  supportedTargets?: string[]
  basisVersion: string
  provenance: Provenance
}

export interface ModelConfigDescriptor {
  configName: string
  kind: ModelConfigKind
  provider?: string | null
  defaultModel?: string | null
  description?: string | null
  isActive: boolean
  createdAt?: string
  updatedAt?: string | null
  basisVersion: string
  provenance: Provenance
}
