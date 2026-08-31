// 预测中心的运行入口只保留真实、可运行、非原始零样本权重模型。
// 不改后端注册表/权重，也不把“未回测/缺目标日输入”误判为“未训练”。
import type { ModelCapabilities, ModelLineage, Provenance } from './modelContractTypes'

type ModelEvidence = {
  id?: string
  modelId?: string
  available?: boolean
  mock?: boolean
  provenance?: Pick<Provenance, 'mock'>
  capabilities?: Pick<ModelCapabilities, 'zeroShot'>
  lineage?: Pick<ModelLineage, 'mock'>
  source?: string
  framework?: string
}

// 这些本地 ID 的实现明确为 StandardScaler+Ridge；即使旧目录漏 mock 也不能重新上架。
// 不按算法名字屏蔽，以免误伤已训练的 remote:...PatchTST / DLinear 真模型。
const COMPAT_PLACEHOLDERS = new Set([
  'tslib:Autoformer', 'tslib:DLinear', 'tslib:FEDformer', 'tslib:Informer',
  'tslib:iTransformer', 'tslib:PatchTST', 'tslib:TimesNet', 'tslib:TimeXer',
])
const ORIGINAL_FOUNDATION_MODELS = new Set(['fm:Chronos2', 'fm:ChronosBoltSmall'])

export type PredictionModelExclusion = 'placeholder' | 'pretrained' | 'unavailable'

/** 返回从预测入口移除的依据；null 表示保留，不代表预测精度达标或指定日期数据齐全。 */
export function predictionModelExclusionReason(model: ModelEvidence): PredictionModelExclusion | null {
  const id = model.modelId ?? model.id ?? ''
  if (model.mock === true || model.provenance?.mock === true || model.lineage?.mock === true
    || COMPAT_PLACEHOLDERS.has(id)) return 'placeholder'
  if (model.capabilities?.zeroShot === true || ORIGINAL_FOUNDATION_MODELS.has(id)
    || model.source?.toLowerCase() === 'remote:zeroshot'
    || model.framework?.toLowerCase().startsWith('zeroshot/')) return 'pretrained'
  if (model.available === false) return 'unavailable'
  return null
}
