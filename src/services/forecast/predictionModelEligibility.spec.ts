// 回归不变量：占位/未部署/原始零样本权重不进入预测选择器，真实同名算法不能误伤。
import { describe, expect, it } from 'vitest'
import { predictionModelExclusionReason as reason } from './predictionModelEligibility'

describe('预测入口模型准入', () => {
  it.each(['Autoformer', 'DLinear', 'FEDformer', 'Informer', 'iTransformer', 'PatchTST', 'TimesNet', 'TimeXer'])
    ('旧目录即使漏报mock仍排除TSLib %s占位', (name) => {
      expect(reason({ id: `tslib:${name}`, available: true, mock: false })).toBe('placeholder')
    })
  it.each([{ mock: true }, { provenance: { mock: true } }, { lineage: { mock: true } }])
    ('任一明确占位证据都排除：%j', (evidence) => {
      expect(reason({ modelId: 'remote:any', available: true, ...evidence })).toBe('placeholder')
    })
  it.each([
    { capabilities: { zeroShot: true } }, { source: 'remote:zeroshot' }, { framework: 'zeroshot/chronos_bolt' },
  ])('即使可用也排除未训练的零样本权重：%j', (evidence) => {
    expect(reason({ available: true, ...evidence })).toBe('pretrained')
  })
  it('不可用条目移除，而不是留下禁用方框', () => {
    expect(reason({ modelId: 'remote:missing', available: false })).toBe('unavailable')
  })
  it.each(['ridge', 'lightgbm', 'xgboost', 'random_forest', 'mlp', 'nbeats', 'tft', 'nhits', 'patchtst', 'physics_hybrid'])
    ('保留真实按请求训练的%s；没有trainedAt不等于使用原始权重', (id) => {
      expect(reason({ id, available: true, mock: false })).toBeNull()
    })
  it.each(['remote:yunnan-load-dlinear-20260729', 'remote:yunnan-renewable-patchtst-20260729', 'remote:yunnan-user-price-da-tfps-20260730'])
    ('保留已训练的%s，不按算法名称误删', (modelId) => {
      expect(reason({ modelId, available: true, source: 'remote:native', framework: 'bundle/PatchTST', lineage: { mock: false } })).toBeNull()
    })
  it('固定真实回放/KNN不要求不存在的权重或训练时间', () => {
    expect(reason({ id: 'platform' })).toBeNull()
    expect(reason({ id: 'knn' })).toBeNull()
  })
})
