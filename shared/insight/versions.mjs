// 业务键版本选择（#2993 任务 3.6，DE06、ST01）。
//
// 规则只有三条，都不依赖「最后导入的那条」：
//   1. 同一业务键、内容完全相同的多行是重采，只计一次。
//   2. 同一业务键、内容不同，且来源没有登记有效版本规则时，这是冲突：报告出来，整键不参与统计。
//   3. 有状态轴（正式/暂结）的来源，按请求的状态取；请求正式时绝不拿暂结补位，反之亦然。
// 跨来源（例如厂侧 API 与月包）同键对照只报差异，不自动互相覆盖；调用方需要单一口径时自己显式选一个来源。

import { compareText } from './contract.mjs'

export const SETTLEMENT_STATUSES = Object.freeze(['formal', 'provisional'])

const stableJson = value => JSON.stringify(sortKeys(value))
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]))
  return value
}

/**
 * @template T
 * @param {T[]} rows
 * @param {{ keyOf: (row: T) => string, contentOf?: (row: T) => unknown, statusOf?: (row: T) => string|null, status?: string|null }} options
 * @returns {{ selected: T[], duplicates: number, conflicts: Array<{ key: string, variants: number }>, excludedByStatus: number }}
 */
export function selectVersions(rows, { keyOf, contentOf = row => row, statusOf = null, status = null }) {
  if (status !== null && !SETTLEMENT_STATUSES.includes(status)) throw new Error(`未登记的结算状态：${status}`)
  if (status !== null && !statusOf) throw new Error('按状态取数需要提供状态字段')
  const groups = new Map()
  let excludedByStatus = 0
  for (const row of rows) {
    if (status !== null) {
      const rowStatus = statusOf(row)
      if (!SETTLEMENT_STATUSES.includes(rowStatus)) throw new Error(`记录的结算状态未登记：${String(rowStatus)}`)
      if (rowStatus !== status) { excludedByStatus++; continue }
    }
    const key = keyOf(row)
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  const selected = [], conflicts = []
  let duplicates = 0
  for (const [key, list] of groups) {
    const variants = new Map(list.map(row => [stableJson(contentOf(row)), row]))
    if (variants.size > 1) { conflicts.push({ key, variants: variants.size }); continue }
    duplicates += list.length - 1
    selected.push(list[0])
  }
  conflicts.sort((a, b) => compareText(a.key, b.key))
  return { selected, duplicates, conflicts, excludedByStatus }
}

/**
 * 两个来源同业务键对照（例如正式日结与暂结、厂侧 API 与月包）：只列差异，不合成一个值。
 * @returns {{ onlyLeft: string[], onlyRight: string[], same: string[], different: Array<{ key: string, left: unknown, right: unknown }> }}
 */
export function compareSources(leftRows, rightRows, { keyOf, contentOf }) {
  const left = new Map(leftRows.map(row => [keyOf(row), row]))
  const right = new Map(rightRows.map(row => [keyOf(row), row]))
  const onlyLeft = [], onlyRight = [], same = [], different = []
  for (const [key, row] of left) {
    if (!right.has(key)) { onlyLeft.push(key); continue }
    const a = contentOf(row), b = contentOf(right.get(key))
    if (stableJson(a) === stableJson(b)) same.push(key)
    else different.push({ key, left: a, right: b })
  }
  for (const key of right.keys()) if (!left.has(key)) onlyRight.push(key)
  return { onlyLeft: onlyLeft.sort(), onlyRight: onlyRight.sort(), same: same.sort(), different: different.sort((a, b) => compareText(a.key, b.key)) }
}
