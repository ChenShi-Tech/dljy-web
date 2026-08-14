// 逐日系统负荷子图的「按年矩阵 → 图表系列」纯映射（从 LoadPanelChart 抽出以便单测）。
//
// 两种模式（数据驱动、非地区硬编码）：
//   overlay    —— 逐年同期对比：各年满覆盖、真重叠（如山西 2021-2026）→ 每年一条年线，共用月-日轴；
//   continuous —— 单一连续时间线被按年切片：年数≥2、跨年同期重叠占比低（各年互补）、
//                 且拼接后确为一段连续区间（如云南仅 2025-07~2026-07 连续一年，折叠后
//                 2025 落下半年、2026 落上半年，视觉上"拼接不重叠"）→ 按时序拼成一条连续线，
//                 x 轴改为带年份的连续日期。重叠用「占比」判（非固定天数）以容忍上游逐日增长；
//                 并须校验无月级缺口，否则会把隔半年的两段误呈现为连续走势。

export type LoadPanelMode = 'overlay' | 'continuous'

export interface LoadPanelLine {
  /** 系列名（legend 用）。 */
  name: string
  /** 与 xData 对齐的数值序列（overlay 模式可含 null，缺日断线）。 */
  data: (number | null)[]
}

export interface LoadPanelModel {
  mode: LoadPanelMode
  /** x 轴 category 列表。 */
  xData: string[]
  /** 一条或多条折线（样式由组件补齐）。 */
  lines: LoadPanelLine[]
}

// 拼接连续线允许的相邻非空点最大「全局日序」间隔。
// =5 容忍：非闰年 2/29 空槽（跨月+1）、个别缺采日；堵住月级及以上缺口——
// 避免把"2025 只有 12 月 + 2026 只有 6 月"这类隔半年的两段误呈现为一条连续负荷（codex #1385 P2）。
const MAX_CONTINUOUS_GAP = 5

// 被 ≥2 年同时覆盖的月-日槽位占比上限：< 该值算「连续切片」，≥ 则算「逐年同期对比」。
// 用占比而非固定天数，容忍上游逐日增长——数据略超一年只在跨年边界有少量重叠仍判连续；
// 长到约 1.5 年（近半年可同期对比）才切回逐年对比（codex #1385 P2 二审）。
const MAX_OVERLAP_RATIO = 0.5

interface DatedPoint {
  /** 带年份的连续日期标签，如 `2025/7月1日`。 */
  label: string
  value: number
  /** 全局日序 =（年份−基准年）×槽数 + 槽位，用于时序排序与连续性判定。 */
  global: number
}

/** 从年份标签解析年份数值（'2025年'→2025）；解析失败回退到给定序号。 */
function yearNum(label: string, fallback: number): number {
  const n = Number(String(label).replace(/[^0-9]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function isLeapYear(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
}

/** 收集全部非空点并按全局日序升序（年升序+槽升序本已有序，防御性再排一次）。 */
function collectPoints(nameList: string[], years: string[], mat: (number | null)[][]): DatedPoint[] {
  if (!years.length) return []
  const base = yearNum(years[0], 0)
  const slots = nameList.length
  const pts: DatedPoint[] = []
  years.forEach((y, yi) => {
    const yn = yearNum(y, base + yi)
    const row = mat[yi] || []
    for (let j = 0; j < nameList.length; j++) {
      if (row[j] != null) pts.push({ label: `${yn}/${nameList[j]}`, value: row[j] as number, global: (yn - base) * slots + j })
    }
  })
  return pts.sort((a, b) => a.global - b.global)
}

/**
 * 判定是否为「单一连续时间线被按年切片」。规则（三者皆满足）：
 *   ① 年数≥2；
 *   ② 被 ≥2 年同时覆盖的月-日槽位「占比」 < MAX_OVERLAP_RATIO——区分"逐年同期对比"
 *      （山西各年满覆盖、占比≈100%）与"连续切片"（云南各年互补、占比≈0）；用占比而非固定
 *      天数，容忍上游逐日增长（数据略超一年只在边界少量重叠仍判连续，codex #1385 P2 二审）；
 *   ③ 拼接后各非空点确构成一段连续区间（相邻全局日序间隔 ≤ MAX_CONTINUOUS_GAP），
 *      否则会把中间缺口误呈现为连续负荷走势（低重叠 ≠ 日期连续，codex #1385 P2）。
 */
export function isSingleTimeline(nameList: string[], years: string[], mat: (number | null)[][]): boolean {
  if (years.length < 2) return false
  let overlapSlots = 0
  let coveredSlots = 0
  for (let j = 0; j < nameList.length; j++) {
    let cnt = 0
    for (const row of mat) if (row && row[j] != null) cnt++
    if (cnt >= 1) coveredSlots++
    if (cnt >= 2) overlapSlots++
  }
  if (coveredSlots === 0) return false
  if (overlapSlots / coveredSlots >= MAX_OVERLAP_RATIO) return false
  // 连续性：拼接序列无月级及以上缺口
  const pts = collectPoints(nameList, years, mat)
  if (pts.length < 2) return false
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].global - pts[i - 1].global > MAX_CONTINUOUS_GAP) return false
  }
  return true
}

/**
 * 把 [年][月-日槽] 的负荷矩阵映射为图表模型。
 * @param nameList 366 个「M月D日」月-日槽位标签
 * @param years    年份系列，形如 ['2025年','2026年']（升序）
 * @param mat      metrics 二维矩阵：mat[年索引][槽位] = 值或 null
 * @param metricName 指标中文名（均值/最小值/最大值），用于系列命名
 */
export function buildLoadPanelModel(
  nameList: string[],
  years: string[],
  mat: (number | null)[][],
  metricName: string
): LoadPanelModel {
  if (isSingleTimeline(nameList, years, mat)) {
    // 连续线：补齐首末非空点之间的完整日历类目，缺测日保留 null（配合 connectNulls:false 断线）——
    // 不压缩空槽，避免把漏采日两侧误画成相邻的连续负荷（codex #1385 P2）。
    const pts = collectPoints(nameList, years, mat)
    const base = yearNum(years[0], 0)
    const slots = nameList.length
    const valueByGlobal = new Map(pts.map((p) => [p.global, p.value]))
    const xData: string[] = []
    const data: (number | null)[] = []
    for (let g = pts[0].global; g <= pts[pts.length - 1].global; g++) {
      const slot = ((g % slots) + slots) % slots
      const yr = base + Math.floor(g / slots)
      // 跳过非闰年不存在的 2/29（固定 366 槽产物），否则会把完整采集的 2/28→3/1 误画成缺测断线；
      // 真实存在的缺测日仍保留 null（codex #1385 P2）。
      if (nameList[slot] === '2月29日' && !isLeapYear(yr)) continue
      xData.push(`${yr}/${nameList[slot]}`)
      data.push(valueByGlobal.has(g) ? (valueByGlobal.get(g) as number) : null)
    }
    return { mode: 'continuous', xData, lines: [{ name: `连续实际值·${metricName}`, data }] }
  }
  const lines = years.map((y, yi) => ({
    name: `${y.replace('年', '')}年${metricName}`,
    data: mat[yi] || []
  }))
  return { mode: 'overlay', xData: nameList, lines }
}

/** 连续时间线 x 轴刻度：每月「1日」打刻度，标签带年后两位（如 25/7月）。 */
export function continuousTickFormatter(v: string): string {
  const m = v.match(/^(\d{4})\/(\d+月)1日$/)
  return m ? `${m[1].slice(2)}/${m[2]}` : ''
}

/** 逐年对比 x 轴刻度：每月「1日」打刻度，标签去掉「1日」（如 7月）。 */
export function overlayTickFormatter(v: string): string {
  return v.endsWith('月1日') ? v.replace('1日', '') : ''
}
