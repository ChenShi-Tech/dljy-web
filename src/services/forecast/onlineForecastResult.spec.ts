// @vitest-environment happy-dom
// 在线预测必须保持目标/日期/时隙及真实值语义；错位或不可用响应不得绘图（dljy-web#54）。
import { describe, expect, it } from 'vitest'
import type { ForecastResult } from './mlForecastClient'
import { isForecastDate, toOnlineForecastResult } from './onlineForecastResult'

const ctx = { regionId: 'yunnan', target: 'price_user_da_settlement', modelId: 'remote:test', targetDate: '2026-06-25' }
function response(count = 24): ForecastResult {
  return {
    task: { region_id: ctx.regionId, target: ctx.target, model_type: ctx.modelId, target_date: ctx.targetDate },
    points: Array.from({ length: count }, (_, i) => 100 + i), slots: Array.from({ length: count }, (_, i) => i),
    lower: [], upper: [], actual: Array.from({ length: count }, (_, i) => 101 + i),
    baseline_curves: { naive: Array(count).fill(120), knn: Array(count).fill(110) },
    evaluation_mode: 'backtest', basis: 'captured', mock: false, model_version: 'v1',
    metrics: { mae: 1, rmse: 1, mase_vs_naive: 0.5, improve_vs_knn_pct: 50, passes_gate: true },
    baseline_metrics: { naive_mae: 2, knn_mae: 2 }, warnings: [], unit: '元/MWh',
  }
}

describe('日期和在线曲线契约', () => {
  it.each(['2026-06-25', '2024-02-29'])('接受真实日历日期 %s', (value) => expect(isForecastDate(value)).toBe(true))
  it.each(['', '2026-02-29', '2026-06-31', '2026-6-25', '2026-06-25T00:00:00Z'])('拒绝非法日期 %s', (value) => expect(isForecastDate(value)).toBe(false))
  it('原生小时价保持24点，真值/基线/评价/模拟标记全部透传', () => {
    const r = response()
    const value = toOnlineForecastResult(r, ctx)
    expect(value.granularity).toBe(24)
    expect(value.points).toEqual(r.points)
    expect(value.actual).toEqual(r.actual)
    expect(value.baselines).toEqual(r.baseline_curves)
    expect(value.evaluationMode).toBe('backtest')
    expect(value.mock).toBe(false)
    expect(value.metrics?.mae).toBe(1)
    expect(toOnlineForecastResult({ ...r, basis: 'synthetic', mock: true }, ctx).mock).toBe(true)
  })
  it('区域负荷保留96点与部分日真值的null，不插值补造', () => {
    const r = response(96)
    r.task.target = 'load'
    r.actual = Array.from({ length: 96 }, (_, i) => i < 20 ? 500 : null)
    r.evaluation_mode = 'partial'
    const value = toOnlineForecastResult(r, { ...ctx, target: 'load' })
    expect(value.granularity).toBe(96)
    expect(value.points).toHaveLength(96)
    expect(value.actual?.[20]).toBeNull()
    expect(value.evaluationMode).toBe('partial')
  })
  it('HTTP200的不可用原因保留，不返回空成功', () => {
    expect(() => toOnlineForecastResult({ available: false, unavailable_reason: '', reason: '缺少真实小时输入' } as ForecastResult, ctx)).toThrow('缺少真实小时输入')
  })
  it.each(['region_id', 'target', 'model_type', 'target_date'])('拒绝返回上下文错误或缺失：%s', (field) => {
    const r = response()
    r.task[field] = 'wrong'
    expect(() => toOnlineForecastResult(r, ctx)).toThrow('上下文')
    delete r.task[field]
    expect(() => toOnlineForecastResult(r, ctx)).toThrow('上下文')
  })
  it.each([NaN, Infinity, -Infinity, null, '12'])('拒绝脏预测值 %s', (value) => {
    const r = response()
    r.points[3] = value as number
    expect(() => toOnlineForecastResult(r, ctx)).toThrow('预测曲线')
  })
  it('拒绝截短曲线、错位时隙、真实值长度错误', () => {
    expect(() => toOnlineForecastResult(response(23), ctx)).toThrow('预测曲线')
    const r = response()
    r.slots![3] = 4
    expect(() => toOnlineForecastResult(r, ctx)).toThrow('时隙')
    r.slots = undefined
    r.actual = [1]
    expect(() => toOnlineForecastResult(r, ctx)).toThrow('实际值')
  })
  it('未来日不伪造实际值或误差', () => {
    const r = response()
    r.actual = undefined
    r.baseline_curves = undefined
    r.evaluation_mode = 'forecast'
    r.metrics = {} as ForecastResult['metrics']
    const value = toOnlineForecastResult(r, ctx)
    expect(value.actual).toBeUndefined()
    expect(value.metrics?.mae).toBeUndefined()
    expect(value.evaluationMode).toBe('forecast')
  })
})
