// 预测响应的来源标识（Mock 红线：mock:true + sourceType:'MOCK' + productionWrite:false 必须在页面可见）。
// 后端 /cockpit、/midterm、/ultra-short 会带这些字段；旧后端没有，全部可选，缺失按「无标识」处理，不崩。
// 本文件零依赖，供 mlForecastClient 的响应类型与页面/组件共用（不放进 mlForecastClient，避免组件测试整模块 mock 时丢失）。

export type ForecastSourceType = 'REAL' | 'CAPTURED' | 'MOCK' | 'MIXED' | 'UNAVAILABLE'

export type ForecastProvenance = {
  mock?: boolean
  // 后端两种拼写并存（snake_case 与 camelCase），读取一律走 sourceTypeOf() 归一。
  sourceType?: ForecastSourceType | string
  source_type?: ForecastSourceType | string
  productionWrite?: boolean
  warnings?: string[]
  // 中长期不可用时驾驶舱栏位形态：{ available:false, reason }
  available?: boolean
  reason?: string | null
}

/** 归一 sourceType/source_type（大写、去空白）；缺失返回空串。 */
export function sourceTypeOf(p: ForecastProvenance | null | undefined): string {
  return String(p?.sourceType ?? p?.source_type ?? '').trim().toUpperCase()
}

/** mock:true 或 sourceType==='MOCK' 任一成立即视为模拟数据（宁可多标，不漏标）。 */
export function isMockProvenance(p: ForecastProvenance | null | undefined): boolean {
  return p?.mock === true || sourceTypeOf(p) === 'MOCK'
}

/** 混合来源（部分为模拟/合成）。 */
export function isMixedProvenance(p: ForecastProvenance | null | undefined): boolean {
  return sourceTypeOf(p) === 'MIXED'
}

/** 该栏位没有可用结果（远端无模型/不可用）：sourceType==='UNAVAILABLE' 或 available:false。 */
export function isUnavailableProvenance(p: ForecastProvenance | null | undefined): boolean {
  return sourceTypeOf(p) === 'UNAVAILABLE' || p?.available === false
}

/** 只保留非空字符串 warning；非数组（旧后端/异常形态）返回空数组。 */
export function provenanceWarnings(p: ForecastProvenance | null | undefined): string[] {
  const raw = p?.warnings
  if (!Array.isArray(raw)) return []
  return raw.map((w) => (typeof w === 'string' ? w.trim() : '')).filter(Boolean)
}
