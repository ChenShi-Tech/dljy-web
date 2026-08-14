// 表格显示增强公共能力（纯函数，零依赖）：数值色阶、阈值分级、状态 tag 映射、
// 汇总行工厂。配合 el-table 的 :class-name / cell template / :summary-method 使用，
// 让 13 个表格密集型视图统一获得「正负红绿 / 阈值高亮 / 合计行」体验。
import { fmtNum } from '@/services/chart/chartOptions'

/** 正负值红绿类名：正→cell-pos(绿)，负→cell-neg(红)，零/非数→空。 */
export function signClass(v: unknown): '' | 'cell-pos' | 'cell-neg' {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return ''
  return n > 0 ? 'cell-pos' : 'cell-neg'
}

/**
 * 阈值分级类名：|v| ≥ danger → cell-neg(红)，≥ warn → cell-warn(橙)，否则空。
 * 用于偏差率/价差/持仓比例等「越大越危险」的指标着色（取绝对值，兼顾正负偏差）。
 */
export function thresholdClass(v: unknown, warn: number, danger: number): '' | 'cell-warn' | 'cell-neg' {
  const n = Math.abs(Number(v))
  if (!Number.isFinite(n)) return ''
  if (n >= danger) return 'cell-neg'
  if (n >= warn) return 'cell-warn'
  return ''
}

type TagType = 'success' | 'warning' | 'danger' | 'info' | 'primary'
const STATUS_SUCCESS = ['正常', '已通过', '通过', '已闭环', '已成交', '生效中', '运行', '低', '已签约', 'approved', 'static-ready', 'low']
const STATUS_WARNING = ['关注', '跟进中', '待确认', '待续签', '待数据', '待运行时', '中', 'pending', 'pending-runtime-data', 'medium']
const STATUS_DANGER = ['高', '受阻', '阻断', '停机', '异常', 'blocked', 'blocked-by-private-cache', 'high']

/** 中文/英文状态 → el-tag type。命中暖/危关键字优先，未命中归 info。 */
export function statusTagType(status: unknown): TagType {
  const s = String(status ?? '').trim().toLowerCase()
  if (!s) return 'info'
  const hit = (list: string[]) => list.some((k) => s.includes(k.toLowerCase()))
  if (hit(STATUS_DANGER)) return 'danger'
  if (hit(STATUS_WARNING)) return 'warning'
  if (hit(STATUS_SUCCESS)) return 'success'
  return 'info'
}

/** 数组按字段求和（非数值跳过）。 */
export function sumBy<T>(rows: T[], key: keyof T): number {
  return rows.reduce((acc, r) => {
    const n = Number(r[key])
    return acc + (Number.isFinite(n) ? n : 0)
  }, 0)
}

/** 数组按字段求均值。 */
export function avgBy<T>(rows: T[], key: keyof T): number {
  const xs = rows.map((r) => Number(r[key])).filter((n) => Number.isFinite(n))
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** 取字段最大值。 */
export function maxBy<T>(rows: T[], key: keyof T): number {
  const xs = rows.map((r) => Number(r[key])).filter((n) => Number.isFinite(n))
  return xs.length ? Math.max(...xs) : 0
}

export type SummarySpec = Record<string, { type: 'sum' | 'avg'; digits?: number; unit?: string }>
type SummaryParam = { columns: { property?: string }[]; data: Record<string, unknown>[] }

/**
 * el-table :summary-method 工厂。
 * 用法：:summary-method="makeSummary({ volumeMWh: { type: 'sum', unit: 'MWh' }, price: { type: 'avg', digits: 2 } })"
 * 配合 show-summary；首列自动显示「合计」。
 */
export function makeSummary(spec: SummarySpec, firstLabel = '合计') {
  return ({ columns, data }: SummaryParam): string[] =>
    columns.map((col, index) => {
      if (index === 0) return firstLabel
      const prop = col.property
      const cfg = prop ? spec[prop] : undefined
      if (!prop || !cfg) return ''
      const val = cfg.type === 'avg'
        ? avgBy(data as Record<string, number>[], prop)
        : sumBy(data as Record<string, number>[], prop)
      const text = fmtNum(val, cfg.digits ?? 2)
      return cfg.unit ? `${text} ${cfg.unit}` : text
    })
}
