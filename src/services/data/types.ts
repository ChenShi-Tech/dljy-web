// data/types.ts — 统一数据层共享类型（Phase 0）
// ----------------------------------------------------------------------------
// 归一项目里散落 / 重复定义的数据可信度、来源、信封类型，建立单一权威来源。
//
// 合并目标（消除重复定义）：
// - dataBasis.ts::DataBasis
// - forecast/mlForecastClient.ts::ForecastBasis
// - forecast/forecastProviders.ts::ForecastBasis
// 以上三处字面量相同（'real'|'captured'|'illustrative'|'synthetic'）却各自独立定义
// → 统一为 DataSourceBasis；旧名 DataBasis / ForecastBasis 经别名 re-export 保持现有
// import 路径不破（dataBasis.ts 工具函数、forecast 通道继续用窄类型）。
//
// Provenance / 信封类型为 Phase 2「信封归一」准备：agentRequest() 基座把 Node ApiEnvelope
// 与 Python BaseResponse 归一为 UnifiedEnvelope / UnifiedResult。

/**
 * 数据来源可信度口径（单一权威）。口径定义沿用 dataBasis.ts 既有语义：
 *   real         生产实时接入（预留，当前项目尚无此来源）
 *   captured     真实采集回放（data/private/capture-raw）
 *   illustrative 策划示意 / 默认样例（地区画像 curated、内置默认曲线）
 *   synthetic    合成降级 / 演示生成（回放未命中 synth、纯 Mock 序列）
 *   empty        诚实空态（演示开通地区如四川缺真实采集、严格地区不回退，返回空 points）
 *   user_saved   用户保存的分析产物（Phase 6 可写产物层；与回放数据区分，非决策级）
 */
export type DataSourceBasis =
  | 'real'
  | 'captured'
  | 'illustrative'
  | 'synthetic'
  | 'empty'
  | 'user_saved'

/**
 * 旧名兼容：DataBasis / ForecastBasis 不含 user_saved，作为 DataSourceBasis 的窄子集。
 * 现有 dataBasis.ts 工具函数（isDecisionGrade / worstBasis / basisFrom*）与 forecast 通道
 * 继续使用此窄类型，它们只处理回放/合成数据，不涉及用户保存产物。
 */
export type DataBasis = Exclude<DataSourceBasis, 'user_saved'>
export type ForecastBasis = DataBasis

/**
 * 数据来源类型枚举（归一项目里四套并存的 sourceType 枚举）：
 *   api.ts Provenance      MOCK | DEMO | CAPTURE | DB
 *   Python BaseResponse    REAL | MOCK（+ productionWrite）
 *   forecast source_type   REAL | CAPTURED | MIXED | MOCK
 *   capture.sqlite         CAPTURE | DB | IMPORT | SEED | MOCK
 * Phase 2 的 basis.ts 提供各套 → 本枚举的归一映射；此处只声明并集，供 UnifiedResult 透传。
 */
export type SourceType =
  | 'REAL'
  | 'CAPTURE'
  | 'CAPTURED'
  | 'MIXED'
  | 'DB'
  | 'IMPORT'
  | 'SEED'
  | 'MOCK'
  | 'DEMO'
  | 'SYNTHETIC'
  | 'FILE'
  | 'API'
  | 'PUBLIC_FORECAST'
  | 'USER_SAVED'

/** 数据溯源标注（归一自 api.ts::Provenance，Node 通道可信度标注）。 */
export type Provenance = {
  sourceType: SourceType
  realDataConnected: boolean
  family?: string
  capturedAt?: string
}

/**
 * 统一响应信封（归一 Node ApiEnvelope 与 Python BaseResponse）。
 * Phase 2 起 agentRequest() 基座把两套后端信封归一为此外层结构。
 */
export type UnifiedEnvelope<T> = {
  code: number
  msg?: string
  data?: T
  /** 可信度口径（Phase 2 由基座从 provenance / mock / sourceType / basis 归一填充） */
  basis?: DataSourceBasis
  mock?: boolean
  sourceType?: SourceType
  productionWrite?: boolean
  provenance?: Provenance
  traceId?: string
}

/**
 * 基座返回给调用方的统一结果：领域 data + 可信度元信息（剥除信封 code/msg 外壳）。
 * 通道 C 各 client 在 Phase 3 迁移后，对外领域方法返回 UnifiedResult<T>，
 * 让调用方统一拿到「数据 + 这份数据可信吗」两件事。
 */
export type UnifiedResult<T> = {
  data: T
  basis?: DataSourceBasis
  mock?: boolean
  sourceType?: SourceType
  productionWrite?: boolean
  provenance?: Provenance
}
