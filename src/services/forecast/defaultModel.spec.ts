// 守什么不变量：预测入口的默认算法只由「目录标注 / 目录顺序」决定，前端不写死任何算法名（dljy#3647）。
// 坏掉的症状：某个算法下线后，写死的默认值仍被选中 → 页面一打开就请求一个必 400 的模型。
import { describe, expect, it } from 'vitest'
import { NO_AVAILABLE_MODEL_TEXT, pickDefaultModelId } from './defaultModel'

const m = (modelId: string, over: Record<string, unknown> = {}) => ({ modelId, available: true, ...over })

describe('pickDefaultModelId', () => {
  it('目录标注的默认算法优先于列表顺序与 recommended', () => {
    const models = [m('a'), m('b', { recommended: true }), m('c')]
    expect(pickDefaultModelId(models, 'c')).toBe('c')
  })

  it('目录默认算法不在页面可选列表里（被下线/被准入规则隐藏）时忽略，不硬凑', () => {
    expect(pickDefaultModelId([m('a'), m('b')], 'gone')).toBe('a')
    expect(pickDefaultModelId([m('a'), m('b')], null)).toBe('a')
    expect(pickDefaultModelId([m('a'), m('b')], undefined)).toBe('a')
  })

  it('目录默认算法在列表里但不可用/占位时同样忽略', () => {
    const models = [m('a'), m('down', { available: false }), m('fake', { mock: true }), m('fake2', { provenance: { mock: true } })]
    expect(pickDefaultModelId(models, 'down')).toBe('a')
    expect(pickDefaultModelId(models, 'fake')).toBe('a')
    expect(pickDefaultModelId(models, 'fake2')).toBe('a')
  })

  it('没有默认标注时取 recommended，再退回第一个可用的非占位模型', () => {
    expect(pickDefaultModelId([m('a'), m('b', { recommended: true })])).toBe('b')
    expect(pickDefaultModelId([m('down', { available: false }), m('fake', { mock: true }), m('ok')])).toBe('ok')
  })

  it('一个可选项都没有时返回空串（页面据此显示「暂无可用模型」，不回落到任何算法名）', () => {
    expect(pickDefaultModelId([])).toBe('')
    expect(pickDefaultModelId([m('down', { available: false }), m('fake', { mock: true })], 'down')).toBe('')
    expect(NO_AVAILABLE_MODEL_TEXT).toBe('暂无可用模型')
  })
})
