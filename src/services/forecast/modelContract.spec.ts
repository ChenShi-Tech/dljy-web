import { describe, expect, it } from 'vitest'
import {
  normalizeForecastModelCatalog,
  normalizeModelConfigDescriptor,
  normalizeModelRegistryEntry,
} from './modelContract'

const context = { target: 'price', regionId: 'yunnan' }

describe('预测模型管理契约归一', () => {
  it('把 legacy catalog 白名单归一为 ModelRegistryEntry，并透传 quality/stage/shadowGate', () => {
    const entry = normalizeModelRegistryEntry({
      id: 'tslib:DLinear',
      name: 'DLinear compat',
      namespace: 'tslib',
      tier: 'deep',
      available: false,
      reason: '运行依赖未安装',
      mock: true,
      source_type: 'MOCK',
      basis: 'synthetic',
      stage: 'staging',
      shadow_gate: { passed: false, report: null, checked_at: 1_720_000_000 },
      capabilities: {
        supports_quantiles: true,
        supports_covariates: false,
        supports_multivariate: false,
        horizon: 96,
        zero_shot: false,
      },
      quality: {
        passes_skill_gate: false,
        skill_vs_lear: -0.12,
        skill_vs_seasonal_naive: 0.03,
        source_run: 'lag_only',
      },
      privateModelField: 'redacted',
    }, context)

    expect(entry).toEqual(expect.objectContaining({
      modelId: 'tslib:DLinear',
      target: 'price',
      regionId: 'yunnan',
      available: false,
      unavailableReason: '运行依赖未安装',
      stage: 'staging',
      basisVersion: 'legacy-forecast-catalog.v1',
      provenance: { basis: 'synthetic', sourceType: 'MOCK', mock: true, productionWrite: false },
      shadowGate: expect.objectContaining({ passed: false, report: null }),
      quality: {
        passesSkillGate: false,
        skillVsLear: -0.12,
        skillVsSeasonalNaive: 0.03,
        sourceRun: 'lag_only',
      },
    }))
    expect(entry).not.toHaveProperty('privateModelField')
    expect(entry).not.toHaveProperty('reason')
    expect(entry).not.toHaveProperty('source_type')
  })

  it('未评估的 nullable quality 不伪造成未过门禁', () => {
    const entry = normalizeModelRegistryEntry({
      id: 'random_forest', available: true, mock: false, source_type: 'REAL',
      quality: { passes_skill_gate: null, source_run: 'full' },
    }, context)
    expect(entry?.available).toBe(true)
    expect(entry?.quality).toBeUndefined()
  })

  it('目录无产物时返回 available=false 和空数组，不合成默认模型', () => {
    expect(normalizeForecastModelCatalog({ target: 'price', models: [] }, context)).toEqual({
      target: 'price',
      regionId: 'yunnan',
      available: false,
      models: [],
      unavailableReason: '当前地区没有可消费的模型目录产物',
      defaultModelId: null,
    })
    expect(normalizeForecastModelCatalog({ models: [{ available: true }] }, context).models).toEqual([])
  })

  // dljy#3647：前端不再写死默认算法，默认值只认目录标注（顶层 defaultModelId + 条目 recommended）。
  it('目录默认算法 defaultModelId 兼容 camelCase/snake_case，缺省或空串一律归为 null', () => {
    const models = [{ id: 'random_forest', available: true, mock: false }]
    expect(normalizeForecastModelCatalog({ target: 'price', models, defaultModelId: 'random_forest' }, context).defaultModelId)
      .toBe('random_forest')
    expect(normalizeForecastModelCatalog({ target: 'price', models, default_model_id: 'random_forest' }, context).defaultModelId)
      .toBe('random_forest')
    expect(normalizeForecastModelCatalog({ target: 'price', models }, context).defaultModelId).toBeNull()
    expect(normalizeForecastModelCatalog({ target: 'price', models, defaultModelId: '  ' }, context).defaultModelId).toBeNull()
    expect(normalizeForecastModelCatalog({ target: 'price', models, defaultModelId: 42 }, context).defaultModelId).toBeNull()
  })

  it('条目 recommended 只认布尔：true/false 透传，其它形态视为目录未标注', () => {
    const at = (recommended: unknown) => normalizeModelRegistryEntry({ id: 'random_forest', available: true, recommended }, context)
    expect(at(true)?.recommended).toBe(true)
    expect(at(false)?.recommended).toBe(false)
    expect(at('yes')).not.toHaveProperty('recommended')
    expect(normalizeModelRegistryEntry({ id: 'random_forest', available: true }, context)).not.toHaveProperty('recommended')
  })

  it('ModelConfigDescriptor 只接受安全契约形状并剔除私有配置', () => {
    const descriptor = normalizeModelConfigDescriptor({
      configName: 'default-training',
      kind: 'training',
      isActive: true,
      basisVersion: 'model-config.v1',
      provenance: { basis: 'reference', sourceType: 'CONFIG', mock: false, productionWrite: false },
      description: '只读生命周期描述',
      privateTrainingConfig: 'redacted',
      privateGatewayConfig: 'redacted',
    })
    expect(descriptor).toEqual({
      configName: 'default-training',
      kind: 'training',
      provider: undefined,
      defaultModel: undefined,
      description: '只读生命周期描述',
      isActive: true,
      createdAt: undefined,
      updatedAt: undefined,
      basisVersion: 'model-config.v1',
      provenance: { basis: 'reference', sourceType: 'CONFIG', mock: false, productionWrite: false },
    })
    expect(descriptor).not.toHaveProperty('privateTrainingConfig')
    expect(descriptor).not.toHaveProperty('privateGatewayConfig')
    expect(normalizeModelConfigDescriptor({ config_name: 'legacy', privateConfig: 'redacted' })).toBeNull()
  })

  it('归一 version 块兼容 snake_case（后端 model_versions.py 惯例），不静默丢弃', () => {
    const entry = normalizeModelRegistryEntry({
      id: 'stacking', available: true, mock: false, source_type: 'REAL',
      version: {
        is_active: true, is_default: false,
        station_id: 7, model_type: 'stacking', train_samples: 1200,
        created_at: '2026-01-01T00:00:00Z', trained_at: 1_720_000_000,
      },
    }, context)
    expect(entry?.version).toEqual(expect.objectContaining({
      isActive: true,
      isDefault: false,
      stationId: 7,
      modelType: 'stacking',
      trainSamples: 1200,
    }))
    // camelCase 同样可用（回退优先 camelCase）
    const camel = normalizeModelRegistryEntry({
      id: 'rf', available: true, mock: false, source_type: 'REAL',
      version: { isActive: true, isDefault: true, stationId: 9, modelType: 'random_forest', trainSamples: 500, createdAt: '2026-02-02T00:00:00Z' },
    }, context)
    expect(camel?.version).toEqual(expect.objectContaining({ stationId: 9, modelType: 'random_forest', isActive: true, isDefault: true }))
  })

  it('normalizeProvenance 兼容 snake_case production_write（避免落 legacy 硬编码）', () => {
    const descriptor = normalizeModelConfigDescriptor({
      configName: 'default-training',
      kind: 'training',
      isActive: true,
      basisVersion: 'model-config.v1',
      provenance: { basis: 'reference', source_type: 'CONFIG', mock: false, production_write: false },
    })
    // 修复前 production_write(snake_case) 让 normalizeProvenance 返回 null → 整个 descriptor 为 null。
    expect(descriptor?.provenance).toEqual({ basis: 'reference', sourceType: 'CONFIG', mock: false, productionWrite: false })
  })
})
