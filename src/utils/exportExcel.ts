/**
 * Excel(.xlsx) 导出工具（SheetJS）。与 exportCsv 同为纯前端 Blob 下载，无后端依赖。
 *
 * 通过动态 import('../utils/exportExcel') 懒加载，xlsx 库只在用户点击导出时加载，不进主 bundle。
 * 报表的真实 Excel 价值：多 sheet（每区块一表）、表头、数值类型保留。
 */
import * as XLSX from 'xlsx'

export type ExcelSheet = {
  name: string
  /** 二维数组（首行通常为表头）；数值保持 number 类型以便 Excel 计算 */
  rows: (string | number)[][]
  /** 各列字符宽（xlsx !cols/wch）。日期、长单号这类宽列不给宽时，Excel 默认列宽放不下会显示成「####」。 */
  colWidths?: number[]
}

/** Excel sheet 名约束：≤31 字符、不含 : \ / ? * [ ]、工作簿内唯一。 */
function safeSheetName(name: string, index: number, used: Set<string>): string {
  let base = (name || `Sheet${index + 1}`).replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 28)
  if (!base) base = `Sheet${index + 1}`
  let candidate = base
  let n = 1
  while (used.has(candidate)) candidate = `${base.slice(0, 25)}_${n++}`
  used.add(candidate)
  return candidate
}

/** 导出多 sheet 工作簿并触发浏览器下载。 */
export function exportWorkbook(filename: string, sheets: ExcelSheet[]): void {
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()
  for (let i = 0; i < sheets.length; i++) {
    const ws = XLSX.utils.aoa_to_sheet(sheets[i].rows)
    const colWidths = sheets[i].colWidths
    if (colWidths) ws['!cols'] = colWidths.map((wch) => ({ wch }))
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(sheets[i].name, i, used))
  }
  const name = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  XLSX.writeFile(wb, name)
}
