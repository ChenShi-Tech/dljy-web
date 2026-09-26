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
import { isModelSelectableForTarget, predictBlockerReason } from './forecastProviders'

type M = Parameters<typeof isModelSelectableForTarget>[0]
const model = (over: Partial<M>): M => ({
  modelId: 'xgboost', namespace: 'base', available: true, ...over,
} as M)

describe('isModelSelectableForTarget', () => {
  it('未声明 supportedTargets 的模型两腿都不可选（缺省不能冒充真实绑定）', () => {
    const m = model({ modelId: 'xgboost', namespace: 'base' })
    expect(isModelSelectableForTarget(m, 'price')).toBe(false)
    expect(isModelSelectableForTarget(m, 'load')).toBe(false)
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

  it('空的 supportedTargets 数组当作「没有接入任何输出目标」，两腿都不可选', () => {
    const m = model({ modelId: 'remote:empty', namespace: 'remote', supportedTargets: [] })
    expect(isModelSelectableForTarget(m, 'price')).toBe(false)
    expect(isModelSelectableForTarget(m, 'load')).toBe(false)
  })
})

describe('predictBlockerReason：拦住静默回落', () => {
  // 不传 model_type 时后端会用它的默认模型——请求成功、页面出数字，但那不是用户选的模型。
  // 这组用例守的是「宁可空着并说清原因，也不给一个来路不明的结果」。
  const ok = { catalogError: '', selectable: [{ modelId: 'xgboost' }], selectedModelId: 'xgboost', targetLabel: '价格预测' }

  it('一切正常时返回空串（可以发请求）', () => {
    expect(predictBlockerReason(ok)).toBe('')
  })

  it('目录加载失败 → 拦住并带上原因（不退回后端默认模型）', () => {
    const r = predictBlockerReason({ ...ok, catalogError: 'HTTP 503' })
    expect(r).not.toBe('')
    expect(r).toContain('HTTP 503')
  })

  it('目录为空 → 拦住并说清是没有可用模型，不是请求失败', () => {
    const r = predictBlockerReason({ ...ok, selectable: [] })
    expect(r).not.toBe('')
    expect(r).toContain('价格预测')
  })

  it('选中项已不在可选集合（模型下架/转不可用）→ 拦住并提示另选', () => {
    const r = predictBlockerReason({ ...ok, selectedModelId: 'remote:gone' })
    expect(r).toBe('所选预测模型当前不可用，请另选模型')
  })

  it('目录加载失败优先于其它原因上报（根因在前，不报下游症状）', () => {
    // 目录都没拉到时 selectable 必然为空，若先报「没有可用模型」会把人引向错误方向
    const r = predictBlockerReason({ catalogError: '网络超时', selectable: [], selectedModelId: '', targetLabel: '价格预测' })
    expect(r).toContain('网络超时')
  })
})
