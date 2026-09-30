// 导出 CSV 单测（Epic #3591 S2 / dljy#3594，ZW-09）：空值为空单元格不补零、单位行、BOM。
import { describe, expect, it } from 'vitest'
import { buildZsjfxCsv, POINT_LABELS, zsjfxExportFilenames } from './zsjfxExport'

describe('buildZsjfxCsv（ZW-09）', () => {
  const series = [
    { name: '日前价出清', unit: '元/MWh', points: [300, null, ...new Array<number | null>(93).fill(310)] },
    { name: '温度', unit: '℃', points: [20, 20, ...new Array<number | null>(94).fill(21)] }
  ]
  const csv = buildZsjfxCsv({ date: '2026-09-18', series })

  it('空值导出为空单元格，绝不补零', () => {
    const dataRow = csv.split('\n').find((line) => line.startsWith('00:15'))
    expect(dataRow).toBeDefined()
    expect(dataRow!.split(',')).toEqual(['00:15', '', '20'])
  })

  it('首行是 96 点时段标签', () => {
    expect(POINT_LABELS).toHaveLength(96)
    expect(POINT_LABELS[1]).toBe('00:15')
    expect(POINT_LABELS[95]).toBe('23:45')
  })

  it('单位随表头注释行保留；带 BOM 便于 Excel 中文表头', () => {
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('日前价出清=元/MWh')
    expect(csv).toContain('温度=℃')
    expect(csv).toContain('空值=空单元格（不补零）')
  })

  it('文件名按日期生成', () => {
    expect(zsjfxExportFilenames('2026-09-18')).toEqual({ csv: 'zsjfx_2026-09-18.csv', png: 'zsjfx_2026-09-18.png' })
  })
})
