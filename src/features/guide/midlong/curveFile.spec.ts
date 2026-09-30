// 教学示例分时曲线 CSV（dljy#3405）的守恒守卫。
// 守什么：标准模板容差 0、月不守恒是阻断问题——示例文件必须在整数微单位算术下逐月严格守恒，
// 行格式能被导入解析（日期 + 时段序号 + 数值，数值 ≤6 位小数、非负）。
import { describe, expect, it } from 'vitest'
import { curveMonthRows, makeExampleCurveFile, quantityToMicro } from './curveFile'

const ctx = { runTag: 'GUIDE-09301200', regionId: 'yunnan', practiceCompanyId: 'practice-1', artifacts: {}, go: () => {} }

function sumRows(rows: string[]): number {
  return rows.reduce((total, row) => {
    const [, , value] = row.split(',')
    const micro = quantityToMicro(value)
    expect(micro, `数值 ${value} 应是非负且 ≤6 位小数`).not.toBeNull()
    return total + (micro ?? 0)
  }, 0)
}

describe('curveMonthRows', () => {
  it('每月合计与正式月度分解严格相等（微单位整数守恒）', () => {
    // 30 天月 400 MWh、31 天月 300 MWh：均匀值除不尽的场景。
    const cases: Array<{ month: string; quantity: string }> = [
      { month: '2026-11', quantity: '400' },
      { month: '2027-01', quantity: '300' },
      { month: '2026-02', quantity: '333.33' },
      { month: '2026-12', quantity: '0.01' },
    ]
    for (const { month, quantity } of cases) {
      const micro = quantityToMicro(quantity)
      expect(micro).not.toBeNull()
      const rows = curveMonthRows({ month, quantityMicro: micro! })
      // 每天恰好 24 个时段、日期连续。
      expect(rows.length).toBe(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() * 24)
      expect(sumRows(rows)).toBe(micro)
    }
  })

  it('时段序号在每天内 1..24 连续，最后一段吃尾差且非负', () => {
    const rows = curveMonthRows({ month: '2026-11', quantityMicro: quantityToMicro('400')! })
    const day1 = rows.slice(0, 24).map((row) => Number(row.split(',')[1]))
    expect(day1).toEqual(Array.from({ length: 24 }, (_v, i) => i + 1))
    for (const value of rows.map((row) => row.split(',')[2])) expect(quantityToMicro(value)).toBeGreaterThanOrEqual(0)
  })
})

describe('makeExampleCurveFile', () => {
  it('生成的文件按月守恒，文件名带运行标签便于在「原始文件」里对上', () => {
    const file = makeExampleCurveFile([
      { month: '2026-11', quantityMicro: quantityToMicro('400')! },
      { month: '2026-12', quantityMicro: quantityToMicro('300')! },
    ], ctx)
    expect(file.name).toContain('GUIDE-09301200')
    return file.text().then((content) => {
      const lines = content.replace(/^\u{FEFF}/u, '').trim().split('\n')
      expect(lines[0]).toBe('日期,时段序号,数值')
      const dataRows = lines.slice(1)
      expect(dataRows.length).toBe(31 * 24 + 30 * 24)
      const byMonth = new Map<string, string[]>()
      for (const row of dataRows) {
        const [date] = row.split(',')
        byMonth.set(date.slice(0, 7), [...(byMonth.get(date.slice(0, 7)) ?? []), row])
      }
      expect(sumRows(byMonth.get('2026-11')!)).toBe(quantityToMicro('400'))
      expect(sumRows(byMonth.get('2026-12')!)).toBe(quantityToMicro('300'))
    })
  })
})
