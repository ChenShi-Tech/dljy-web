// 守住披露面板拆分边界：同范围/同指标/同单位才可复用选择键，目标日只影响面板实例不影响用户已选范围。
// 坏掉会把不同范围/不同指标揉成一张卡，或在换日后丢失用户当前选择。
import type { DisclosureDatasetResult, DisclosureSeries } from './dailyDisclosure'

export interface DisclosurePanel {
  id: string
  selectionKey: string
  title: string
  scopeLabel: string
  dataset: DisclosureDatasetResult
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseSeriesParts(id: string): [string, string | null, string | null] | null {
  try {
    const parsed = JSON.parse(id) as unknown
    if (!Array.isArray(parsed) || parsed.length < 3) return null
    const scope = text(parsed[0])
    const targetDate = text(parsed[1]) || null
    const metric = text(parsed[2]) || null
    if (!scope && targetDate === null && metric === null) return null
    return [scope, targetDate, metric]
  } catch {
    return null
  }
}

function fallbackMetric(series: DisclosureSeries): string {
  return [text(series.label), text(series.id)].filter(Boolean).join('::') || 'series'
}

function metricOf(series: DisclosureSeries): string {
  return parseSeriesParts(series.id)?.[2] || fallbackMetric(series)
}

function targetDateOf(series: DisclosureSeries): string {
  return parseSeriesParts(series.id)?.[1] || text(series.targetDate)
}

// 同一记录日可能同时披露D+1/D+2；按相对天数区分，既能独立勾选，也能跨日记忆。
function horizonOf(dataset: DisclosureDatasetResult, series: DisclosureSeries): string {
  const targetDate = targetDateOf(series)
  if (!targetDate) return 'record-only'
  const days = (Date.parse(`${targetDate}T00:00:00Z`) - Date.parse(`${dataset.date}T00:00:00Z`)) / 86400000
  return Number.isFinite(days) ? `D${days >= 0 ? '+' : ''}${days}` : `target:${targetDate}`
}

function hasFinitePoint(series: DisclosureSeries): boolean {
  return series.validPoints > 0 && series.points.some((value) => typeof value === 'number' && Number.isFinite(value))
}

function buildTitle(dataset: DisclosureDatasetResult, series: DisclosureSeries): string {
  const base = text(dataset.spec.title) || text(series.label) || dataset.spec.id
  const label = text(series.label)
  return label && label !== base ? `${base} · ${label}` : base
}

export function buildDisclosurePanels(results: DisclosureDatasetResult[]): DisclosurePanel[] {
  const panels: DisclosurePanel[] = []
  for (const dataset of results) {
    if (!dataset || ['error', 'rejected', 'empty'].includes(dataset.status)) continue
    for (const series of dataset.series) {
      if (!series || !hasFinitePoint(series)) continue
      const metric = metricOf(series)
      const selectionKey = JSON.stringify([dataset.spec.id, text(series.scope), metric, text(series.unit), horizonOf(dataset, series)])
      panels.push({
        id: JSON.stringify([dataset.spec.id, series.id, text(series.unit)]),
        selectionKey,
        title: buildTitle(dataset, series),
        scopeLabel: text(series.scopeLabel) || text(series.scope) || '未标明范围',
        dataset: { ...dataset, series: [series] },
      })
    }
  }
  return panels
}

export function matchesDisclosurePanel(panel: DisclosurePanel, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase()
  if (!needle) return true
  const series = panel.dataset.series[0]
  const haystack = [
    panel.title,
    series?.label ?? '',
    panel.scopeLabel,
    series?.scope ?? '',
    panel.id,
    targetDateOf(series),
  ].join(' ').toLowerCase()
  return haystack.includes(needle)
}
