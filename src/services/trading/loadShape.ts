// S3 方向判断的申报曲线生成：日总电量 × 形态 → 96 点曲线。
//
// 形态只决定**分布**，总量守恒是硬约束——生成的 96 点之和必须等于给定总量
// （浮点误差内），否则「按 1000 MWh 报」实际报出 987 MWh，偏差凭空多 1.3%。
// 形态是起点不是终点：生成后交易员可在 S4 逐点微调，这里只保证一个像样的出发点。

export type LoadShapeId = 'double-peak' | 'flat' | 'night-heavy'

export const LOAD_SHAPE_LABEL: Record<LoadShapeId, string> = {
  'double-peak': '典型双峰（早晚高峰）',
  flat: '平坦（连续生产型）',
  'night-heavy': '夜间为主（低谷生产型）'
}

/**
 * 24 小时权重模板（每小时一个权重，展开到 96 点时段内平铺）。
 * 数值只表达相对形状，函数内归一化，改模板不会破坏总量守恒。
 */
const HOURLY_WEIGHTS: Record<LoadShapeId, number[]> = {
  'double-peak': [
    0.55, 0.5, 0.48, 0.47, 0.5, 0.62, 0.85, 1.1, 1.25, 1.3, 1.28, 1.2,
    1.1, 1.05, 1.08, 1.15, 1.25, 1.35, 1.4, 1.38, 1.25, 1.05, 0.85, 0.65
  ],
  flat: new Array(24).fill(1),
  'night-heavy': [
    1.35, 1.35, 1.35, 1.35, 1.3, 1.25, 1.05, 0.85, 0.7, 0.65, 0.65, 0.7,
    0.7, 0.7, 0.7, 0.75, 0.85, 0.95, 1.0, 1.0, 1.05, 1.15, 1.25, 1.3
  ]
}

/**
 * 生成 96 点电量曲线（MWh/15min），总量守恒。
 * totalMwh 非正时返回全零曲线——没有电量就是没有电量，不编造默认值。
 */
export function buildLoadCurve96(totalMwh: number, shape: LoadShapeId): number[] {
  if (!(totalMwh > 0)) return new Array(96).fill(0)
  const hourly = HOURLY_WEIGHTS[shape]
  const weights: number[] = []
  for (const w of hourly) {
    weights.push(w, w, w, w)
  }
  const sum = weights.reduce((a, b) => a + b, 0)
  const curve = weights.map((w) => (w / sum) * totalMwh)
  // 逐点保留 4 位小数后，把舍入残差全部并进最后一点，闭合总量
  const rounded = curve.map((v) => Math.round(v * 10000) / 10000)
  const drift = totalMwh - rounded.reduce((a, b) => a + b, 0)
  rounded[95] = Math.round((rounded[95] + drift) * 10000) / 10000
  return rounded
}

/** 对曲线整体施加偏置比例（正=上偏多报），逐点缩放，形状不变。 */
export function applyBias(curve: number[], biasRatio: number): number[] {
  return curve.map((v) => Math.round(v * (1 + biasRatio) * 10000) / 10000)
}
