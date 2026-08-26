// S1 风险复盘 · 纯逻辑（Epic #2033 · 六维「维度五·风险复盘」· #2015）
// ---------------------------------------------------------------------------
// 守的不变量：S1 风险段只呈现「事件库昨日窗口的事实」——near_miss 标注、处置/有效性
// 回填状态构成风控回顾提醒；无源的两个监测面（节点电价飙升自动识别、止损/仓位监测）
// 维持 data_gap 口径，不装作在监测。
// 坏掉的症状：提醒漏报（昨日有 near_miss 未评估却不出提醒）＝侥幸逃过被忽略；
// 或 data_gap 被静默吞掉＝页面假装全面监测——两者都直接违背 #2015 验收。
import type { RiskEventSummary } from './reviewStoreApi'

/** 节点电价飙升自动识别无数据源的口径文案（grid-geo 仅节点名解析，无电价时序）。 */
export const NODE_PRICE_SPIKE_DATA_GAP_NOTE =
  '断面阻塞致节点电价飙升的自动识别无数据源（grid-geo 仅有节点名解析）——data_gap；人工登记的此类事件照常呈现。'

/** 止损/仓位限制监测的既有口径（沿用 riskReview.ts「待数据接入」同款纪律）。 */
export const STOP_LOSS_DATA_GAP_NOTE =
  '止损/仓位限制的触发与执行监测：持仓/止损线数据未接入（data_gap）——未在监测；风控有效性以事件库的处置回填与有效性评估为回查面。'

export type RiskReviewReminder = {
  /** 提醒文案（空数组=无需提醒：昨日无事件或全部已评估闭环） */
  notes: string[]
  /** 昨日事件里存在 near_miss（侥幸逃过）项——验收要求的标注来源 */
  hasNearMiss: boolean
  /** near_miss 事件数（含已评估） */
  nearMissCount: number
  /** 昨日事件总数 */
  total: number
}

/**
 * 昨日窗口事件 → 风控回顾提醒。提醒触发条件（验收「触发风控回顾提醒」）：
 * - near_miss 且有效性未评估（躲过亏损是预判还是运气没说清）；
 * - 处置已填但有效性未回填（风控措施效果未回查）；
 * - 处置为空（事件挂账未处置）。
 * near_miss 已评估 + 处置闭环的事件不打扰（复盘不是催办清单）。
 */
export function riskReviewReminder(events: readonly RiskEventSummary[]): RiskReviewReminder {
  const notes: string[] = []
  let nearMissUnevaluated = 0
  let disposalMissing = 0
  let effectivenessMissing = 0
  for (const e of events) {
    if (e.nearMiss) {
      if (e.effective === null) nearMissUnevaluated += 1
    } else if (!e.disposal) {
      disposalMissing += 1
    } else if (e.effective === null) {
      effectivenessMissing += 1
    }
  }
  if (nearMissUnevaluated > 0) {
    notes.push(`昨日有 ${nearMissUnevaluated} 起「侥幸逃过」未评估——是预判到还是运气，需在风险事件库补有效性评估（这次没事≠下次没事）。`)
  }
  if (disposalMissing > 0) {
    notes.push(`昨日有 ${disposalMissing} 起风险事件未填处置措施——风控回顾前先补处置。`)
  }
  if (effectivenessMissing > 0) {
    notes.push(`昨日有 ${effectivenessMissing} 起事件处置已填但有效性未回查——需回填「处置是否有效」。`)
  }
  return {
    notes,
    hasNearMiss: events.some((e) => e.nearMiss),
    nearMissCount: events.filter((e) => e.nearMiss).length,
    total: events.length,
  }
}

/** 昨日窗口过滤（eventTime 落在 [since, until) 半开区间，ISO 字符串比较即可）。 */
export function eventsInWindow(
  events: readonly RiskEventSummary[],
  since: string,
  until: string
): RiskEventSummary[] {
  return events.filter((e) => e.eventTime >= since && e.eventTime < until)
}

/**
 * 北京时区某日 00:00 的 UTC 瞬时（#2015「昨日」窗口边界必须用北京日界，不能直接
 * 拼UTC 零点——那会把窗口整体后移 8 小时：漏掉昨日 0–8 点、错收今日 0–8 点）。
 * 返回 Z 后缀 ISO，字符串比较与服务端 SQL 比较口径一致。
 */
export function beijingDayStartUtc(day: string): string {
  return new Date(`${day}T00:00:00+08:00`).toISOString()
}

/** 六维⑤维一行（ready=事件库可用；无事件=平稳日，ready 且显示平安）。 */
export function riskDimSummary(
  feed: { available: true } | { available: false },
  reminder: RiskReviewReminder
): { summary: string; ready: boolean } {
  if (!feed.available) return { summary: '风险事件服务不可用', ready: false }
  if (reminder.total === 0) return { summary: '昨日无风险事件（平安日）', ready: true }
  const near = reminder.nearMissCount > 0 ? ` · 侥幸逃过 ${reminder.nearMissCount} 起` : ''
  const pending = reminder.notes.length ? ' · 有待回顾项' : ''
  return { summary: `昨日 ${reminder.total} 起风险事件${near}${pending}`, ready: true }
}
