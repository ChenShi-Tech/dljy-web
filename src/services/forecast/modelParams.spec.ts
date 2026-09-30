// @vitest-environment happy-dom
// ↑ 勿删：forecastProviders → api.ts → regionContext 在模块求值期读 window（与 modelTargetSelection.spec.ts 同款）。
// 模型参数面板与 I/O 门槛按模型声明渲染（dljy#2464 · Epic dljy#2455 4.3.10）。
import { describe, expect, it } from 'vitest'
import { normalizeModelRegistryEntry } from './modelContract'
import { modelParamFields, modelParamsFromInputs } from './forecastProviders'

const RAW = {
  modelId: 'remote:chronos-bolt-base', target: 'price', regionId: 'yunnan', available: true, basisVersion: 'model-registry.v1',
  provenance: { basis: 'real', sourceType: 'REAL', mock: false, productionWrite: false },
  unit: '元/MWh', framework: 'zeroshot/chronos_bolt', source: 'remote:zeroshot',
  io: { intervalMinutes: 60, seqLen: 256, predLen: 24, quantilesSupported: [0.1, 0.5, 0.9],
    covariates: [
      { field: 'region_load_actual', labelZh: '统调负荷实际', unit: 'MW', platformStatus: 'available' },
      { field: 'transfer_plan_guizhou_export', platformStatus: 'blocked', blockedReason: '须回灌（dljy#2475）' },
      { field: 'bad', platformStatus: 'weird' },
    ] },
  paramsSchema: [
    { key: 'context_length', label: '回看长度', type: 'slider', default: 256, min: 64, max: 256, step: 32, noteZh: '截尾' },
    { key: 'train_days', label: '撞平台键', type: 'number', default: 1 },
    { key: 'nokey', type: 'number', default: 1 },
  ],
  lineage: { version: 'zs-v1', activeVersion: 'zs-v1', versionCount: 1, dataSeenThrough: '2026-06-30', mock: false, loaded: true, lineageNote: null },
}

describe('normalizeModelRegistryEntry 2.1.0 字段', () => {
  it('io / paramsSchema / lineage / unit / source / framework 归一化，坏项丢弃', () => {
    const e = normalizeModelRegistryEntry(RAW, { target: 'price', regionId: 'yunnan' })!
    expect(e.unit).toBe('元/MWh'); expect(e.source).toBe('remote:zeroshot'); expect(e.framework).toBe('zeroshot/chronos_bolt')
    expect(e.io?.intervalMinutes).toBe(60); expect(e.io?.seqLen).toBe(256); expect(e.io?.predLen).toBe(24)
    expect(e.io?.covariates.map((c) => c.field)).toEqual(['region_load_actual', 'transfer_plan_guizhou_export']) // 'bad' 状态非法被丢
    expect(e.io?.covariates[1]).toMatchObject({ platformStatus: 'blocked', blockedReason: '须回灌（dljy#2475）' })
    expect(e.paramsSchema?.map((p) => p.key)).toEqual(['context_length', 'train_days']) // 缺 label 的丢
    expect(e.lineage).toMatchObject({ activeVersion: 'zs-v1', versionCount: 1, dataSeenThrough: '2026-06-30', loaded: true, lineageNote: null })
  })
  it('缺 io 的旧目录条目照常归一化（全部可选）', () => {
    const e = normalizeModelRegistryEntry({ modelId: 'random_forest', target: 'price', regionId: 'yunnan', available: true,
      basisVersion: 'model-registry.v1', provenance: RAW.provenance }, { target: 'price', regionId: 'yunnan' })!
    expect(e.io).toBeUndefined(); expect(e.paramsSchema).toBeUndefined(); expect(e.lineage).toBeUndefined()
  })
})

describe('模型参数面板与透传', () => {
  const schema = normalizeModelRegistryEntry(RAW, { target: 'price', regionId: 'yunnan' })!.paramsSchema
  it('paramsSchema → ParamField；与平台参数撞名的模型项被丢弃', () => {
    const fields = modelParamFields(schema, new Set(['train_days', 'probabilistic', 'conformal']))
    expect(fields.map((f) => f.key)).toEqual(['context_length'])
    expect(fields[0]).toMatchObject({ type: 'slider', default: 256, min: 64, max: 256, step: 32, label: '回看长度（截尾）' })
  })
  it('只把模型声明过的键送进 extra.params；未声明/undefined 不发；无声明返回 undefined', () => {
    expect(modelParamsFromInputs(schema, { context_length: 128, probabilistic: true, foo: 1, train_days: 90 }))
      .toEqual({ context_length: 128, train_days: 90 })
    expect(modelParamsFromInputs(schema, { context_length: undefined })).toBeUndefined()
    expect(modelParamsFromInputs(undefined, { context_length: 128 })).toBeUndefined()
  })
})
