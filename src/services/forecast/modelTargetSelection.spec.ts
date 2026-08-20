// @vitest-environment happy-dom
// ↑ 勿删：被测模块经 forecastProviders → api.ts → regionContext 传递依赖，后者在模块
// 求值期读 window.localStorage；node project 无 DOM，缺此 pragma 整文件 0 test 直接失败
// （与 agentClient.spec.ts 同款处理）。判据本身是纯函数，不依赖 DOM。
// 申报决策驾驶舱「按腿选模型」判据（#2324）。
//
// 守的不变量：单 target 上架的真实模型（remote:* 多为只声明 price 或只声明 load）
// 必须能在它声明的那条腿里被选中。旧版要求一个模型两腿全覆盖，把它们整体挡在选择之外——
// 那条限制的真实来源只是 /cockpit 聚合端点只收一个 model_type，不该扩散到四个带
// 显式 target 的调用点上。判据放松后必须同时守住反向：没声明这条腿的不能选。
import { describe, expect, it } from 'vitest'
import { isModelSelectableForTarget } from './forecastProviders'

type M = Parameters<typeof isModelSelectableForTarget>[0]
const model = (over: Partial<M>): M => ({
  modelId: 'xgboost', namespace: 'base', available: true, ...over,
} as M)

describe('isModelSelectableForTarget', () => {
  it('未声明 supportedTargets 的 core 模型两腿都可选（旧行为不回归）', () => {
    const m = model({ modelId: 'xgboost', namespace: 'base' })
    expect(isModelSelectableForTarget(m, 'price')).toBe(true)
    expect(isModelSelectableForTarget(m, 'load')).toBe(true)
  })

  it('只声明 price 的远端模型：价格腿可选、负荷腿不可选', () => {
    const m = model({ modelId: 'remote:lear-price', namespace: 'remote', supportedTargets: ['price'] })
    expect(isModelSelectableForTarget(m, 'price')).toBe(true)
    expect(isModelSelectableForTarget(m, 'load')).toBe(false)
  })

  it('只声明 load 的远端模型：负荷腿可选、价格腿不可选', () => {
    const m = model({ modelId: 'remote:tft-load', namespace: 'remote', supportedTargets: ['load'] })
    expect(isModelSelectableForTarget(m, 'load')).toBe(true)
    expect(isModelSelectableForTarget(m, 'price')).toBe(false)
  })

  it('两腿都声明的模型两腿都可选', () => {
    const m = model({ modelId: 'remote:both', namespace: 'remote', supportedTargets: ['price', 'load'] })
    expect(isModelSelectableForTarget(m, 'price')).toBe(true)
    expect(isModelSelectableForTarget(m, 'load')).toBe(true)
  })

  it('available:false 一律不可选，哪怕声明了该腿（后端能力位是硬门）', () => {
    const m = model({ modelId: 'remote:down', namespace: 'remote', available: false, supportedTargets: ['price'] })
    expect(isModelSelectableForTarget(m, 'price')).toBe(false)
  })

  it('非 /predict 直算端点一律不可选，哪怕声明了该腿（选中必失败）', () => {
    // naive 属 baseline namespace，/predict 直算会 ValueError（见 isPredictSupported 文档）
    const m = model({ modelId: 'naive', namespace: 'baseline', supportedTargets: ['price', 'load'] })
    expect(isModelSelectableForTarget(m, 'price')).toBe(false)
    expect(isModelSelectableForTarget(m, 'load')).toBe(false)
  })

  it('空的 supportedTargets 数组当作「没有声明任何腿」，两腿都不可选', () => {
    // 判据用 declared.includes(target)，空数组恒 false——这是要的语义：
    // 后端明确回了一个空清单，说明它哪条腿都不支持，不能当成「没声明所以都行」。
    const m = model({ modelId: 'remote:empty', namespace: 'remote', supportedTargets: [] })
    expect(isModelSelectableForTarget(m, 'price')).toBe(false)
    expect(isModelSelectableForTarget(m, 'load')).toBe(false)
  })
})
