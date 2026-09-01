// 预测不可用原因的读取归一（申报工作台流程走查清单 #10）。
//
// 守的不变量：后端对「不可用」的三种响应形态——Core 转发失败的 `unavailable_reason`（snake）、
// 目录的 `unavailableReason`（camel）、训练数据缺失信封的 `reason`（/predict B18：
// TrainingDataUnavailable → HTTP 200 {available:false, reason}）——unavailableReasonOf 都要能读出。
// 坏掉的症状：字段名对不上时读到空串，forecastProviders.assertUsableForecast 回落兜底文案
// 「预测服务当前不可用（Core 转发未返回结果）」，把"目标月无真实回放训练数据"这类
// 数据覆盖问题伪装成服务故障，用户无从判断该补数据还是该换日期。
// @vitest-environment happy-dom
// ↑ 勿删：mlForecastClient → api.ts → regionContext 在模块求值期读 window.localStorage
// （与 modelTargetSelection.spec.ts 同款处理）。被测函数本身是纯函数，不依赖 DOM。
import { describe, expect, it } from 'vitest'

import { unavailableReasonOf } from './mlForecastClient'

describe('unavailableReasonOf：三种不可用响应形态都能读出原因', () => {
  it('训练数据缺失信封（reason）——此前读不到，显示的是兜底文案', () => {
    const r = {
      available: false,
      reason: '地区 shanxi 无真实回放训练数据（data_source=auto 不合成兜底）；如需合成链路验证请显式传 data_source=\'synthetic\'',
    }
    expect(unavailableReasonOf(r)).toContain('无真实回放训练数据')
  })

  it('Core 转发失败信封（unavailable_reason，snake_case）', () => {
    expect(unavailableReasonOf({ unavailable_reason: 'Core 不可达' })).toBe('Core 不可达')
  })

  it('目录形态（unavailableReason，camelCase）', () => {
    expect(unavailableReasonOf({ unavailableReason: '权重未下载' })).toBe('权重未下载')
  })

  it('并存时按 snake → camel → reason 优先级取第一个非空', () => {
    expect(unavailableReasonOf({ unavailable_reason: 'a', unavailableReason: 'b', reason: 'c' })).toBe('a')
    expect(unavailableReasonOf({ unavailableReason: 'b', reason: 'c' })).toBe('b')
  })

  it('全部缺失/空白 → 空串（调用方回落自己的兜底文案，而不是显示 undefined）', () => {
    expect(unavailableReasonOf({})).toBe('')
    expect(unavailableReasonOf({ reason: null })).toBe('')
    expect(unavailableReasonOf({ reason: '   ' })).toBe('')
    expect(unavailableReasonOf(null)).toBe('')
    expect(unavailableReasonOf(undefined)).toBe('')
  })
})
