// 市场洞察结果 CSV 导出（dljy#2996，OpenSpec 任务 5.8）
// ----------------------------------------------------------------------------
// 明细表导出的公共口径：
//   - 头部注释写来源业务标题与原生粒度（存档后还能对上口径）；
//   - 列为语义身份：对象、字段、区间起、区间止、值、单位、来源；
//   - 值为原始字符串（原生精度），不在导出层做数值加工；缺测行写「缺测」；
//   - UTF-8 BOM 起（Excel 直接打开不乱码）；单元格含逗号/引号/换行按 RFC 4180 转义。
// 供 InsightResultTable（导出本页 / 导出全量）与页面直接导出复用。

import { getInsightSource } from 'shared/insight/sources.mjs'
import type { InsightBlockResult } from '@/services/insight/insightClient'
import { fieldText, formatBeijingDateTime, insightSourceTitle, type InsightSourceTitle } from './insightText'

type ResultRow = { seriesId: string; intervalStart: string; intervalEnd: string; value: string | null }

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** 一份结果 → CSV 文本（﻿ BOM 头）。 */
export function buildInsightCsv(result: InsightBlockResult, sourceTitles?: Record<string, InsightSourceTitle>): string {
  const rows = (result.data?.rows ?? []) as ResultRow[]
  const meta = new Map((result.data?.series ?? []).map((series) => [series.seriesId, series]))
  const sourceTitlesInUse = [
    ...new Set([...meta.values()].map((series) => insightSourceTitle(series.sourceId, sourceTitles)?.title ?? series.sourceId)),
  ]
  const nativeResolutions = [...new Set([...meta.values()].map((series) => `${series.nativeResolutionMinutes} 分钟`))]

  const lines = [
    `# 来源：${sourceTitlesInUse.join('、')}`,
    `# 原生粒度：${nativeResolutions.join('、')}`,
    ['对象', '字段', '区间起', '区间止', '值', '单位', '来源'].map(csvCell).join(','),
  ]
  for (const row of rows) {
    const series = meta.get(row.seriesId)
    if (!series) continue
    const dimension = getInsightSource(series.sourceId)?.objectDimension
    const object = dimension ? String(series.dimensions?.[dimension] ?? '') : ''
    const missing = row.value === null || row.value === undefined || row.value === ''
    lines.push(
      [
        object,
        fieldText(series.fieldId),
        formatBeijingDateTime(row.intervalStart),
        formatBeijingDateTime(row.intervalEnd),
        missing ? '缺测' : String(row.value),
        series.unit,
        insightSourceTitle(series.sourceId, sourceTitles)?.title ?? series.sourceId,
      ]
        .map(csvCell)
        .join(',')
    )
  }
  return `﻿${lines.join('\r\n')}`
}

/** 触发浏览器下载（Blob + 隐藏锚点）。 */
export function downloadInsightCsv(csv: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
