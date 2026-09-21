// 覆盖与共同样本（#2993 任务 3.7，DE05、D3.1）。
//
// 覆盖按「应有的规范对象 × 应有的时段」逐格计算，分别报告有效、缺失、冲突、剔除；
// 起止日期不代表连续覆盖，版本行数不代表有效观测。可分析历史候选按「当前分析的必需输入」
// 逐日求真实交集，不拿各源最早/最晚日期猜重叠，也不要求所有页面的来源同时有数。

import { expectedSlotStarts, toBeijingIso } from './intervals.mjs'

const DAY_MS = 86_400_000

/** 业务窗内的全部业务日（YYYY-MM-DD）。 */
export function businessDates(window) {
  const dates = []
  const start = Date.parse(`${window.start}T00:00:00Z`), end = Date.parse(`${window.end}T00:00:00Z`)
  for (let t = start; t <= end; t += DAY_MS) dates.push(new Date(t).toISOString().slice(0, 10))
  return dates
}

const dateOfSlot = startMs => toBeijingIso(startMs).slice(0, 10)

/**
 * 单条序列在业务窗内的时段覆盖。
 * @param {{ resolutionMinutes:number, slots:Map<number,unknown>, quality:{missingValues:number,nonFinite:number,duplicates:number,conflicts:number[],outOfWindow:number} }} series normalizeSeries 的结果
 * @param {{start:string,end:string}} window
 */
export function seriesCoverage(series, window) {
  const expected = expectedSlotStarts(window, series.resolutionMinutes)
  const conflicts = new Set(series.quality.conflicts)
  const perDate = new Map(businessDates(window).map(date => [date, { expected: 0, valid: 0 }]))
  let valid = 0, conflict = 0
  for (const start of expected) {
    const bucket = perDate.get(dateOfSlot(start))
    bucket.expected++
    if (series.slots.has(start)) { valid++; bucket.valid++ } else if (conflicts.has(start)) conflict++
  }
  const completeDates = [], partialDates = [], emptyDates = []
  for (const [date, { expected: e, valid: v }] of perDate) (v === e ? completeDates : v === 0 ? emptyDates : partialDates).push(date)
  return {
    resolutionMinutes: series.resolutionMinutes,
    expectedSlots: expected.length,
    validSlots: valid,
    missingSlots: expected.length - valid - conflict,
    conflictSlots: conflict,
    // 质量剔除：数值非法与窗外记录单列，不混进「缺失」。
    excludedValues: series.quality.nonFinite,
    missingValueRows: series.quality.missingValues,
    duplicateRows: series.quality.duplicates,
    completeDates,
    partialDates,
    emptyDates,
  }
}

/**
 * 对象覆盖与分母口径。能证明资产全集时分母是登记全集；否则分母只能叫「所选获权资料对象」，
 * 不称全集团（D4）。原始名称数不等于规范对象数，未映射的名称单列。
 */
export function objectCoverage({ registeredObjects = null, observedObjects, unmappedNames = [] }) {
  const observed = [...new Set(observedObjects)].sort()
  if (registeredObjects === null) {
    return { denominatorBasis: 'authorized-observed-objects', expectedObjects: null, observedObjects: observed.length, missingObjects: null, unmappedNames: [...new Set(unmappedNames)].sort() }
  }
  const registered = new Set(registeredObjects)
  const outside = observed.filter(id => !registered.has(id))
  if (outside.length) throw new Error(`观测对象不在登记全集内：${outside.slice(0, 5).join('、')}`)
  return {
    denominatorBasis: 'registered-asset-set',
    expectedObjects: registered.size,
    observedObjects: observed.length,
    missingObjects: [...registered].filter(id => !observed.includes(id)).sort(),
    unmappedNames: [...new Set(unmappedNames)].sort(),
  }
}

/**
 * 两期（或两组）对象的共同样本：跨期变化默认按共同对象重算，同时报告各自全部样本（DE05）。
 */
export function commonObjectSample(left, right) {
  const a = new Set(left), b = new Set(right)
  const common = [...a].filter(id => b.has(id)).sort()
  return { leftCount: a.size, rightCount: b.size, common, commonCount: common.length, onlyLeft: [...a].filter(id => !b.has(id)).sort(), onlyRight: [...b].filter(id => !a.has(id)).sort() }
}

/** 连续日期段；离散日不会被包装成一段连续历史。 */
export function dateRanges(dates) {
  const sorted = [...new Set(dates)].sort()
  const ranges = []
  for (const date of sorted) {
    const last = ranges.at(-1)
    if (last && Date.parse(`${date}T00:00:00Z`) - Date.parse(`${last.end}T00:00:00Z`) === DAY_MS) last.end = date
    else ranges.push({ start: date, end: date })
  }
  return ranges.map(range => ({ ...range, days: (Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / DAY_MS + 1 }))
}

/**
 * 按当前分析的输入给出可分析的历史候选日（D3.1、OV06）。
 * @param {{ required: Array<{ sourceId:string, completeDates:string[] }>, optional?: Array<{ sourceId:string, completeDates:string[] }> }} inputs
 * @returns {{ dates:string[], ranges:Array<{start:string,end:string,days:number}>, discrete:boolean, perInput:Array<{sourceId:string, required:boolean, dates:number, ranges:Array<{start:string,end:string,days:number}>}>, reason: null|'no-required-input'|'no-common-window' }}
 */
export function analysisCandidates({ required, optional = [] }) {
  const perInput = [...required.map(input => ({ ...input, required: true })), ...optional.map(input => ({ ...input, required: false }))]
    .map(({ sourceId, completeDates, required: isRequired }) => ({ sourceId, required: isRequired, dates: new Set(completeDates).size, ranges: dateRanges(completeDates) }))
  if (!required.length) return { dates: [], ranges: [], discrete: false, perInput, reason: 'no-required-input' }
  let common = new Set(required[0].completeDates)
  for (const input of required.slice(1)) {
    const next = new Set(input.completeDates)
    common = new Set([...common].filter(date => next.has(date)))
  }
  const dates = [...common].sort()
  const ranges = dateRanges(dates)
  return { dates, ranges, discrete: ranges.length > 1, perInput, reason: dates.length ? null : 'no-common-window' }
}
