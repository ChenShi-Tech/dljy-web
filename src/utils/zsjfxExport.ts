// zsjfxExport — 综合数据分析导出（Epic #3591 S2 / dljy#3594，ZW-09）。
// CSV：保留各系列单位（表头注释行）与空值（空单元格，绝不补零）；UTF-8 BOM 便于 Excel
// 直接打开中文表头。图片导出由视图层经 ECharts getDataURL 取当前视口，本模块只定文件名。

export type ExportSeries = {
  name: string
  unit: string
  points: Array<number | null>
}

export const POINT_LABELS: string[] = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0')
  const m = String((i % 4) * 15).padStart(2, '0')
  return `${h}:${m}`
})

/** 96 点曲线 CSV：首列时段，随后每系列一列；空值导出为空单元格。 */
export function buildZsjfxCsv(params: { date: string; series: ExportSeries[] }): string {
  const { date, series } = params
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)
  const lines: string[] = []
  lines.push(`# 综合数据分析导出｜日期=${date}｜时段=96点｜空值=空单元格（不补零）｜生成时间=${new Date().toISOString()}`)
  lines.push(`# 单位: ${series.map((s) => `${esc(s.name)}=${esc(s.unit || '无')}`).join(', ')}`)
  lines.push(['时段', ...series.map((s) => esc(s.name))].join(','))
  for (let i = 0; i < 96; i += 1) {
    const cells = [POINT_LABELS[i]]
    for (const s of series) {
      const v = s.points[i]
      cells.push(v == null || !Number.isFinite(v) ? '' : String(v))
    }
    lines.push(cells.join(','))
  }
  return `\uFEFF${lines.join('\n')}\n`
}

export function downloadTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function zsjfxExportFilenames(date: string): { csv: string; png: string } {
  return { csv: `zsjfx_${date}.csv`, png: `zsjfx_${date}.png` }
}
