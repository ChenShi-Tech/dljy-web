// 演示数据确定性生成器（PRD §4.4）。
//
// * mulberry32 播种（同后端 mock-capture.mjs 先例）：同一 seedKey 恒同曲线，页面来回切换不跳变。
// * 锚定「今天」：日曲线永远"最新"，演示永不过期。云南主线（PRD 拍板）形状优先打磨——
//   午间光伏大发压价、早晚双峰的电价形态。

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seedOf(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function dateStr(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86400000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function hhmm(slot: number): string {
  const total = slot * 15
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export type CurveKind = 'price' | 'load' | 'renewable' | 'output'

/**
 * 山西日前价 96 点形态基线（元/MWh）：来自采集 dmx 近月（2026-02~06）真实均值标定
 * （PRD C.20）。典型光伏省「鸭子曲线」——夜间平台 ~290、早间回落、午间光伏深谷 ~60、
 * 傍晚尖峰 ~415（19 时）。合成价曲线按此形态 + 日间水平因子 + 周末效应 + 偶发限价尖峰
 * 生成，与真实驾驶舱/监盘曲线（fixtures 直供）观感一致。
 */
const PRICE_PROFILE_96: number[] = [
  310, 306, 297, 289, 289, 279, 278, 278, 284, 280, 277, 273, 274, 269, 265, 268,
  268, 266, 263, 262, 266, 271, 277, 282, 287, 283, 279, 272, 265, 249, 236, 221,
  218, 182, 146, 126, 122, 107, 95, 86, 87, 78, 74, 72, 81, 74, 72, 68,
  59, 58, 58, 57, 57, 59, 58, 58, 62, 66, 73, 79, 82, 90, 107, 115,
  123, 158, 198, 234, 258, 292, 318, 335, 363, 376, 404, 413, 414, 414, 413, 399,
  385, 380, 378, 370, 357, 352, 343, 326, 317, 314, 301, 289, 293, 285, 277, 271
]

/**
 * 96 点日曲线。price：真实形态标定（鸭子曲线 + 日间/周末因子 + 限价尖峰）；
 * load：白天高原夜晚低谷；renewable/output：午间单峰。
 */
export function curve96(kind: CurveKind, seedKey: string, date: string): number[] {
  const rand = mulberry32(seedOf(`${kind}:${seedKey}:${date}`))
  const jitter = () => 1 + (rand() - 0.5) * 0.12
  if (kind === 'price') {
    let dayFactor = 0.82 + rand() * 0.42
    const weekday = new Date(`${date}T00:00:00`).getDay()
    if (weekday === 0 || weekday === 6) dayFactor *= 0.93
    return Array.from({ length: 96 }, (_, slot) => {
      let value = PRICE_PROFILE_96[slot] * dayFactor * jitter()
      // 偶发限价尖峰收敛到 ~800（C.22）：1500 限价针会把 y 轴拉满、其余曲线被压扁；
      // 与 fixtures 软化上限（softenPriceValue：1500→814）观感一致。
      if (rand() < 0.004) value = 560 + rand() * 240
      return Math.round(Math.max(0, Math.min(1500, value)) * 10) / 10
    })
  }
  return Array.from({ length: 96 }, (_, slot) => {
    const hour = slot / 4
    const base =
      kind === 'load'
        ? 5200 + 2600 * Math.exp(-((hour - 11) ** 2) / 14) + 1800 * Math.exp(-((hour - 20) ** 2) / 8)
        : kind === 'renewable'
          ? 820 * Math.max(0, Math.sin(((hour - 6.5) / 13) * Math.PI))
          : 430 + 90 * Math.sin(((hour - 6) / 12) * Math.PI)
    const value = Math.max(0, base * jitter())
    return Math.round(value * 10) / 10
  })
}

/**
 * 有界日水平因子（C.22）：0.86–1.14 + 周末 −8%，同 (salt, date) 恒同。
 * 用于持仓/计划类日序列的日间起伏——纯逐点抖动的均值会抵消成近似直线（过规律），
 * 乘上日水平因子后柱状/日曲线有 ±14% 的真实起伏，又不至于失真。
 */
export function dayLevel(salt: string, date: string, spread = 0.28): number {
  const r = mulberry32(seedOf(`level:${salt}:${date}`))
  let factor = 1 - spread / 2 + r() * spread
  const weekday = new Date(`${date}T00:00:00`).getDay()
  if (weekday === 0 || weekday === 6) factor *= 0.92
  return factor
}

/** 24 点小时曲线（fetchClearingPrice 云南口径：da_user_price 24 点 → 前端阶梯成 96 点）。 */
export function hourlyPrice24(seedKey: string, date: string): number[] {
  const c96 = curve96('price', seedKey, date)
  return Array.from({ length: 24 }, (_, h) => Math.round(((c96[h * 4] + c96[h * 4 + 2]) / 2) * 10) / 10)
}

export const TIME_AXIS_96: string[] = Array.from({ length: 96 }, (_, i) => hhmm(i))
