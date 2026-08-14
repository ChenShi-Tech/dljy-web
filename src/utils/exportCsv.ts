// 前端 CSV 导出（带 UTF-8 BOM，Excel 直接打开不乱码）。
// 交互体验优化：数据密集型表格（账单、交易记录、预测序列等）提供一键导出。
export type CsvCell = string | number | null | undefined

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportCsv(filename: string, headers: string[], rows: CsvCell[][]) {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(','))
  const blob = new Blob(['\ufeff', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
