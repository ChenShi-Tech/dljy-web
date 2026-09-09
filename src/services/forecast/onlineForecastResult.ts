// 在线面板的请求/响应边界：不同目标日或时隙的曲线不能贴上当前控件标签。
import { adaptMlResult, nativeSlotsForTarget, type UnifiedForecastResult } from './forecastProviders'
import { unavailableReasonOf, type ForecastResult } from './mlForecastClient'

export type OnlineForecastContext = { regionId: string; target: string; modelId: string; targetDate: string }

/** 严格日历日期，拒绝Date自动把2月30日滚到3月。 */
export function isForecastDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** 只接受本次请求的完整日内预测；部分真值允许null，预测本身不得缺时段。 */
export function toOnlineForecastResult(r: ForecastResult, ctx: OnlineForecastContext): UnifiedForecastResult {
  if (r?.available === false) throw new Error(unavailableReasonOf(r) || '预测服务当前不可用')
  const expected = { region_id: ctx.regionId, target: ctx.target, model_type: ctx.modelId, target_date: ctx.targetDate }
  if (!isForecastDate(ctx.targetDate) || Object.entries(expected).some(([key, value]) => r?.task?.[key] !== value)) {
    throw new Error('预测响应上下文与当前地区、目标、模型或日期不一致，请重新运行')
  }
  const count = nativeSlotsForTarget(ctx.target)
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  if (!Array.isArray(r.points) || r.points.length !== count || !r.points.every(finite)) {
    throw new Error(`预测曲线不完整：当前目标需要${count}个有效点，未绘制错位或无效曲线`)
  }
  if (r.slots !== undefined && (!Array.isArray(r.slots) || r.slots.length !== count || r.slots.some((slot, i) => slot !== i))) {
    throw new Error('预测时隙不连续或错位，未将缺失时段挪到其他时间显示')
  }
  if (r.actual?.length && (r.actual.length !== count || !r.actual.every((v) => v === null || finite(v)))) {
    throw new Error('目标日实际值长度或数值无效，不能用于效果对比')
  }
  for (const values of Object.values(r.baseline_curves ?? {})) {
    if (values?.length && (values.length !== count || !values.every(finite))) {
      throw new Error('预测对照基线不完整，不能用于效果对比')
    }
  }
  return adaptMlResult(r, ctx.modelId, count === 24 ? 24 : 96, count)
}
