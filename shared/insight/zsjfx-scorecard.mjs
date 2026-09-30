// ============================================================================
// zsjfx-scorecard —— 综合数据分析「预测×实际对拍」共享契约（Epic #3591 / #3594，ZW-04/ZW-08）。
// ----------------------------------------------------------------------------
// 只读确定性计算：MAE/MAPE/方向命中率与逐时段误差由服务端装配，LLM 不参与数值计算。
// 配对目录是事实源：预测类类型 ↔ 实际值类类型的语义配对，逐地区按该地区 zsjfx 目录
// 校验可用性（目录里没有的类型 → 该配对不可用并说明，不产出无意义指标）。
// 空值与真实零之别（ZW-04）：任一侧空值的时段剔除并计数；实际为真实零参与 MAE 与
// 方向命中，仅 MAPE 因分母为零剔除该时段并单独计数。
// ============================================================================

/** 对拍窗口上限（天）：默认单日，显式区间最多近 30 天。 */
export const ZSJFX_SCORECARD_MAX_WINDOW_DAYS = 30

/** MAPE 分母保护：|实际| 低于该值（元/MWh、MW 等按原量纲）的时段从 MAPE 剔除并计数。 */
export const ZSJFX_SCORECARD_MAPE_DENOM_FLOOR = 1e-9

/**
 * 语义配对目录（跨地区共用；可用性按地区目录校验）。
 * kind 用于前端分组与文案：load 负荷 / newenergy 新能源 / generation 发电 / price 价格。
 */
export const ZSJFX_SCORECARD_PAIRS = Object.freeze([
  Object.freeze({ id: 'load-d1', kind: 'load', label: '日前负荷预测 × 系统负荷实际值', forecast: '日前负荷预测', actual: '系统负荷实际值' }),
  Object.freeze({ id: 'newenergy-d1', kind: 'newenergy', label: '日前新能源预测-总 × 风光总加实际值', forecast: '日前新能源预测-总', actual: '风光总加实际值' }),
  Object.freeze({ id: 'totalgen-d1', kind: 'generation', label: '总发电预测 × 总发电实际值', forecast: '总发电预测', actual: '总发电实际值' }),
  Object.freeze({ id: 'price-da-knn', kind: 'price', label: '日前价KNN预测(P50) × 日前价出清', forecast: '日前价KNN预测(P50)', actual: '日前价出清' }),
  Object.freeze({ id: 'price-da-company', kind: 'price', label: '日前价公司预测 × 日前价出清', forecast: '日前价公司预测', actual: '日前价出清' }),
  Object.freeze({ id: 'price-da-ai1', kind: 'price', label: '日前价AI预测1 × 日前价出清', forecast: '日前价AI预测1', actual: '日前价出清' }),
  Object.freeze({ id: 'price-rt-company', kind: 'price', label: '实时价公司预测 × 实时价出清', forecast: '实时价公司预测', actual: '实时价出清' }),
  Object.freeze({ id: 'price-rt-ai1', kind: 'price', label: '实时价AI预测1 × 实时价出清', forecast: '实时价AI预测1', actual: '实时价出清' })
])

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)

/**
 * 解析对拍请求 query：{ pair, date?, dateFrom?, dateTo? }。
 * pair 必须是配对目录里的 id；date 默认当日区间的单日；dateFrom/dateTo 可选且
 * 窗口 ≤ MAX_WINDOW_DAYS 天、不得早于 dateFrom（dateTo >= dateFrom）。
 */
export function parseZsjfxScorecardRequest(query) {
  const q = query && typeof query === 'object' ? query : {}
  const pairId = typeof q.pair === 'string' ? q.pair : ''
  const pair = ZSJFX_SCORECARD_PAIRS.find((p) => p.id === pairId)
  if (!pair) throw new Error(`未知对拍配对：${pairId || '(空)'}（可用：${ZSJFX_SCORECARD_PAIRS.map((p) => p.id).join(', ')}）`)
  const date = typeof q.date === 'string' ? q.date : ''
  const dateFrom = typeof q.dateFrom === 'string' ? q.dateFrom : date
  const dateTo = typeof q.dateTo === 'string' ? q.dateTo : date
  for (const [name, value] of [['date', date], ['dateFrom', dateFrom], ['dateTo', dateTo]]) {
    if (value && !DATE_RE.test(value)) throw new Error(`${name} 应为 YYYY-MM-DD：${value}`)
  }
  if (!dateFrom || !dateTo) throw new Error('缺少对拍日期（date 或 dateFrom/dateTo）')
  if (dayDiff(dateFrom, dateTo) < 0) throw new Error(`dateTo（${dateTo}）不得早于 dateFrom（${dateFrom}）`)
  const windowDays = dayDiff(dateFrom, dateTo) + 1
  if (windowDays > ZSJFX_SCORECARD_MAX_WINDOW_DAYS) {
    throw new Error(`对拍窗口最多 ${ZSJFX_SCORECARD_MAX_WINDOW_DAYS} 天：请求 ${windowDays} 天（${dateFrom}~${dateTo}）`)
  }
  return Object.freeze({ pair, dateFrom, dateTo, windowDays })
}

/** 配对按目录（groups 扁平类型集）逐类型校验可用性；不可用时给原因，不产出指标。 */
export function checkPairAvailability(pair, catalogTypes) {
  const types = new Set(catalogTypes ?? [])
  const missing = [pair.forecast, pair.actual].filter((t) => !types.has(t))
  if (!missing.length) return { available: true, missingTypes: [] }
  return { available: false, missingTypes: missing }
}
