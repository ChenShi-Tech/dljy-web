// 教学示例分时曲线 CSV（dljy#3405）：导引「帮我填」时生成，走导入对话框的 CSV「分时曲线」通道。
// 守恒规则（shared/midlong/curves.mjs）：标准模板容差 0，月合计与正式月度分解不一致是阻断问题——
// 所以生成的曲线必须逐月严格守恒。全部用整数微单位（1e-6 MWh）算术：每月电量 ≤2 位小数，
// 均匀值 6 位小数封顶，尾差全记到当月最后一个时段，合计精确相等、不依赖浮点舍入。
import type { GuideCtx } from '../types'
import { beijingParts } from './examples'

/** 一个月的天数（按北京时间日历）。 */
function daysInMonth(month: string): number {
  const [year, mon] = month.split('-').map(Number)
  return new Date(Date.UTC(year, mon, 0)).getUTCDate()
}

/** 整数微单位 → 定点 6 位小数字符串（不走浮点，避免 toFixed 边界抖动）。 */
function microToText(micro: number): string {
  const sign = micro < 0 ? '-' : ''
  const abs = Math.abs(micro)
  return `${sign}${Math.floor(abs / 1_000_000)}.${String(abs % 1_000_000).padStart(6, '0')}`
}

export type CurveMonthSpec = { month: string; quantityMicro: number }

/** 把月电量（MWh 文本，≤2 位小数）换成整数微单位；非法输入返回 null（调用方跳过该月）。 */
export function quantityToMicro(quantity: unknown): number | null {
  const text = String(quantity ?? '').trim()
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return null
  const [whole, frac = ''] = text.split('.')
  return Number(whole) * 1_000_000 + Number(frac.padEnd(6, '0'))
}

/**
 * 一个月的 24 点逐时段 CSV 行（粒度 60 分钟、单位 MWh、北京时间）。
 * 前 n-1 个时段取均匀值，最后一段吃尾差，合计与该月电量严格相等。
 */
export function curveMonthRows(spec: CurveMonthSpec): string[] {
  const days = daysInMonth(spec.month)
  const periods = days * 24
  const even = Math.floor(spec.quantityMicro / periods)
  const last = spec.quantityMicro - even * (periods - 1)
  const rows: string[] = []
  for (let day = 1; day <= days; day += 1) {
    const date = `${spec.month}-${String(day).padStart(2, '0')}`
    for (let period = 1; period <= 24; period += 1) {
      const isLast = day === days && period === 24
      rows.push(`${date},${period},${microToText(isLast ? last : even)}`)
    }
  }
  return rows
}

/**
 * 生成覆盖若干个月的教学示例曲线 CSV 文件。
 * 追溯信息只放在文件名里（分解集「原始文件」区展示文件名与校验值）——CSV 数据区之外的
 * 任何说明文字都会被当成坏行解析，不能写进文件正文。
 */
export function makeExampleCurveFile(months: CurveMonthSpec[], ctx: GuideCtx): File {
  const p = beijingParts()
  const stamp = `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}-${String(p.hour).padStart(2, '0')}${String(p.minute).padStart(2, '0')}`
  const lines = ['日期,时段序号,数值', ...months.flatMap(curveMonthRows)]
  const name = `教学示例-分时曲线-${stamp}-${ctx.runTag}.csv`
  // BOM 与真实 CSV 上传同通道；text/plain 便于浏览器直接预览，导入按声明解析不挑扩展名。
  return new File([`\u{FEFF}${lines.join('\n')}\n`], name, { type: 'text/plain;charset=utf-8' })
}
