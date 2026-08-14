// B4 批量导出打包：把多张表（CSV 文本）打包进一个 .zip 下载。jszip 懒加载（仅用时引入）。
// 与 exportCsv 单表下载互补：驾驶舱/复盘/敞口等多表场景一键打包，避免下载多个散文件。
// CSV 加 UTF-8 BOM 防 Excel 中文乱码（与 exportCsv 口径一致）。

export type CsvTable = {
  /** 文件名（不含扩展名，作 zip 内文件名；重名自动加 (2)/(3)） */
  name: string
  /** CSV 表头单元格 */
  header: string[]
  /** CSV 数据行（每行单元格数组） */
  rows: unknown[][]
}

function escapeCell(cell: unknown): string {
  const s = String(cell ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(table: CsvTable): string {
  const lines = [table.header.map(escapeCell).join(',')]
  for (const row of table.rows) lines.push(row.map(escapeCell).join(','))
  return '﻿' + lines.join('\n')
}

/** 把多张表打包成一个 .zip（每表一个 CSV）并触发下载。空 tables 直接返回。 */
export async function exportBundleCsv(zipName: string, tables: CsvTable[]): Promise<void> {
  if (!tables.length) return
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const used = new Set<string>()
  for (const t of tables) {
    let fname = `${t.name}.csv`
    let i = 2
    while (used.has(fname)) fname = `${t.name} (${i++}).csv`
    used.add(fname)
    zip.file(fname, toCsv(t))
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = zipName.endsWith('.zip') ? zipName : `${zipName}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
