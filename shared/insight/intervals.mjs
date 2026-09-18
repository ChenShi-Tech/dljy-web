// 市场洞察时间区间与聚合内核（#2993 任务 3.3/3.4）。
//
// 规范时间是带时区的半开区间 [start, end)；源端的「日期 + HH:MM 起点」在这里一次性换算。
// 数值一律用十进制字符串精确计算（复用中长期模块的定点十进制内核，项目内唯一一份），
// 聚合完成后才按指标的显示精度舍入；图表拿到的浮点数不回流统计（DE12）。
//
// 聚合纪律（DE03、D5）：
//   - 只允许把细粒度汇总到整数倍的粗粒度（96→24），不允许把小时价复制成 96 个 15 分钟样本。
//   - 目标区间内缺任意一个原生时段，该区间结果为空并报告缺口，不插补、不缩短分母。
//   - 同一时段重复出现且数值相同视为重采，不增量；数值不同视为冲突，整段剔除并报告，不挑一个。
//   - 价格、功率、比率按时长加权平均；电量、金额求和；瞬时或语义未知的功率不能积算成电量。

import { decimalAdd, decimalDiv, decimalMul, decimalSum, parseDecimal } from '../midlong/decimal.mjs'
import { INSIGHT_ERRORS, InsightContractError, calendarDayMs } from './contract.mjs'

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000
const BEIJING_OFFSET_MS = 8 * 3_600_000
/** 平均值内部保留的小数位：远高于任何显示精度，只在最终格式化时舍入。 */
export const INTERNAL_PLACES = 12
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

const fail = (message, details) => { throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, message, details) }

/** 北京时间业务日 + HH:MM 起点 → UTC 毫秒。 */
function beijingInstantMs(date, minutesOfDay) {
  return calendarDayMs(date) - BEIJING_OFFSET_MS + minutesOfDay * MINUTE_MS
}

/** 毫秒 → 带 +08:00 的 ISO 字符串（业务展示与证据都用北京时间表达）。 */
export function toBeijingIso(ms) {
  const local = new Date(ms + BEIJING_OFFSET_MS).toISOString().slice(0, 19)
  return `${local}+08:00`
}

/** 业务日 → 该日在北京时间的 [start, end)。 */
export function businessDayRange(date) {
  const start = beijingInstantMs(date, 0)
  return { startMs: start, endMs: start + DAY_MS }
}

/**
 * 源时点 → 规范区间。slotLabel 为 interval-start（HH:MM 是区间起点）或 business-day（日级记录）。
 * 时点必须落在原生粒度的格点上，否则说明来源登记的粒度与数据不符，直接报错而不是四舍五入到格点。
 */
export function slotInterval({ date, time, resolutionMinutes, slotLabel = 'interval-start' }) {
  if (slotLabel === 'business-day' || resolutionMinutes === 1440) {
    const { startMs, endMs } = businessDayRange(date)
    return { startMs, endMs }
  }
  if (slotLabel !== 'interval-start') fail(`未登记的时点标注方式：${slotLabel}`)
  const match = typeof time === 'string' ? time.match(TIME_RE) : null
  if (!match) fail(`时点格式不正确：${String(time)}`)
  const minutes = Number(match[1]) * 60 + Number(match[2])
  if (minutes % resolutionMinutes !== 0) fail(`时点 ${time} 不在 ${resolutionMinutes} 分钟格点上，来源粒度登记与数据不符`)
  const startMs = beijingInstantMs(date, minutes)
  return { startMs, endMs: startMs + resolutionMinutes * MINUTE_MS }
}

/** 业务窗内应有的全部原生时段起点。 */
export function expectedSlotStarts(window, resolutionMinutes) {
  const first = businessDayRange(window.start).startMs
  const last = businessDayRange(window.end).endMs
  const step = resolutionMinutes * MINUTE_MS
  const starts = []
  for (let t = first; t < last; t += step) starts.push(t)
  return starts
}

/**
 * 把源点规范成「时段起点 → 值」的序列，并统计质量问题。
 * @param {Array<{date:string, time?:string|null, value:unknown}>} points
 * @param {{resolutionMinutes:number, slotLabel?:string, window?:{start:string,end:string}}} spec
 * @returns {{ resolutionMinutes:number, slots: Map<number,{startMs:number,endMs:number,value:string}>, quality:{ missingValues:number, nonFinite:number, duplicates:number, conflicts:number[], outOfWindow:number } }}
 */
export function normalizeSeries(points, spec) {
  const { resolutionMinutes, slotLabel = 'interval-start', window } = spec
  if (![15, 60, 1440].includes(resolutionMinutes)) fail(`不支持的原生粒度：${resolutionMinutes} 分钟`)
  const bounds = window ? { from: businessDayRange(window.start).startMs, to: businessDayRange(window.end).endMs } : null
  const slots = new Map(), conflicted = new Set()
  const quality = { missingValues: 0, nonFinite: 0, duplicates: 0, conflicts: [], outOfWindow: 0 }
  for (const point of points) {
    const { startMs, endMs } = slotInterval({ date: point.date, time: point.time, resolutionMinutes, slotLabel })
    if (bounds && (startMs < bounds.from || endMs > bounds.to)) { quality.outOfWindow++; continue }
    if (point.value === null || point.value === undefined || point.value === '') { quality.missingValues++; continue }
    const parsed = parseDecimal(point.value, { allowNegative: true })
    if (!parsed.ok) { quality.nonFinite++; continue }
    if (conflicted.has(startMs)) continue
    const existing = slots.get(startMs)
    if (existing) {
      if (existing.value === parsed.value) { quality.duplicates++; continue }
      // 同一时段两份不同的值：不按先后覆盖，整段剔除并报告冲突（DE06）。
      slots.delete(startMs); conflicted.add(startMs); quality.conflicts.push(startMs)
      continue
    }
    slots.set(startMs, { startMs, endMs, value: parsed.value })
  }
  quality.conflicts.sort((a, b) => a - b)
  return { resolutionMinutes, slots, quality }
}

const MEAN_KINDS = new Set(['price', 'power', 'ratio', 'capacity'])
const SUM_KINDS = new Set(['energy', 'amount'])

/** 时长加权平均 Σ(v×Δt)/ΣΔt；没有有效时长返回 null，不返回 0。 */
export function timeWeightedMean(items) {
  let weighted = '0', minutes = 0
  for (const { value, durationMinutes } of items) {
    if (value === null || value === undefined) continue
    weighted = decimalAdd(weighted, decimalMul(value, String(durationMinutes)))
    minutes += durationMinutes
  }
  return minutes > 0 ? decimalDiv(weighted, String(minutes), INTERNAL_PLACES) : null
}

/**
 * 把规范序列汇总到更粗的目标粒度。
 * @param {ReturnType<typeof normalizeSeries>} series
 * @param {{ targetMinutes:number, measureKind:string, window:{start:string,end:string} }} options
 * @returns {{ method:string, buckets:Array<{startMs:number,endMs:number,value:string|null,expectedSlots:number,validSlots:number,missingSlots:number,conflictSlots:number}> }}
 */
export function aggregateSeries(series, { targetMinutes, measureKind, window }) {
  const native = series.resolutionMinutes
  if (targetMinutes < native) fail(`不能把 ${native} 分钟数据拆成 ${targetMinutes} 分钟：细化会复制出不存在的观测`)
  if (targetMinutes % native !== 0) fail(`${targetMinutes} 分钟不是 ${native} 分钟的整数倍，无法无损汇总`)
  const method = MEAN_KINDS.has(measureKind) ? 'time-weighted-mean' : SUM_KINDS.has(measureKind) ? 'sum' : null
  if (!method) fail(`「${measureKind}」类数据不能做时间汇总`)
  const perBucket = targetMinutes / native
  const conflicts = new Set(series.quality.conflicts)
  const buckets = []
  for (const bucketStart of expectedSlotStarts(window, targetMinutes)) {
    const members = []
    let missing = 0, conflict = 0
    for (let i = 0; i < perBucket; i++) {
      const start = bucketStart + i * native * MINUTE_MS
      const slot = series.slots.get(start)
      if (slot) members.push({ value: slot.value, durationMinutes: native })
      else if (conflicts.has(start)) conflict++
      else missing++
    }
    // 缺一个原生时段就不产出完整区间的值：部分时段的均值不是这个小时的价格（A04）。
    const complete = members.length === perBucket
    const value = !complete ? null : method === 'sum' ? decimalSum(members.map(m => m.value)) : timeWeightedMean(members)
    buckets.push({ startMs: bucketStart, endMs: bucketStart + targetMinutes * MINUTE_MS, value, expectedSlots: perBucket, validSlots: members.length, missingSlots: missing, conflictSlots: conflict })
  }
  return { method, buckets }
}

/**
 * 功率 → 电量：只有登记为区间平均功率的序列可以乘有效时长；瞬时或语义未知的功率拒绝（DE03、PP03）。
 * @returns {Array<{startMs:number,endMs:number,value:string}>} 每段电量（MWh）
 */
export function powerToEnergy(series, { powerSemantics }) {
  if (powerSemantics !== 'interval-average') {
    fail(powerSemantics === 'instant' ? '瞬时功率不能按时长积算电量' : '来源未说明功率是区间平均还是瞬时值，不能积算电量')
  }
  return [...series.slots.values()].sort((a, b) => a.startMs - b.startMs)
    .map(slot => ({ startMs: slot.startMs, endMs: slot.endMs, value: decimalDiv(decimalMul(slot.value, String((slot.endMs - slot.startMs) / MINUTE_MS)), '60', INTERNAL_PLACES) }))
}

/**
 * 两条已对齐（同粒度）序列的共同有效时段。只有双方都有有效值的时段参与配对计算，
 * 各自覆盖另行报告（PR04「共同 20 小时」）。
 */
export function commonSlots(a, b) {
  if (a.resolutionMinutes !== undefined && b.resolutionMinutes !== undefined && a.resolutionMinutes !== b.resolutionMinutes) {
    fail('两条序列粒度不同，需先汇总到同一粒度再配对')
  }
  const aSlots = a.slots ?? new Map(a.buckets.filter(x => x.value !== null).map(x => [x.startMs, x]))
  const bSlots = b.slots ?? new Map(b.buckets.filter(x => x.value !== null).map(x => [x.startMs, x]))
  const pairs = []
  for (const [start, left] of aSlots) {
    const right = bSlots.get(start)
    if (right) pairs.push({ startMs: start, endMs: left.endMs, a: left.value, b: right.value })
  }
  pairs.sort((x, y) => x.startMs - y.startMs)
  return { pairs, aValid: aSlots.size, bValid: bSlots.size, common: pairs.length }
}
