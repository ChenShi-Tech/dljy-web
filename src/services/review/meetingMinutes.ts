// 复盘会议纪要 · 纯逻辑（Epic #2033 · M4 · #2049：模板十二，C 档纯人工表单）
// ---------------------------------------------------------------------------
// 会后 1 个工作日归档提醒（方案原文）：周六/周日顺延到周一，法定节假日未接入
// （节假日表属数据接入项，接入前以周末顺延为保守口径并注明）。

/** 会议日期 → 归档截止（+1 个工作日，周末顺延到下一工作日）。
 *  全程 UTC 日历运算：CI runner 时区不固定（多为 UTC），本地 get* 会随部署环境偏移一天。 */
export function archiveDeadline(meetingIso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(meetingIso)
  if (!m) return null
  let t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  do {
    t += 86400000
  } while (new Date(t).getUTCDay() === 0 || new Date(t).getUTCDay() === 6)
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** 案例库检索强化（#2049）：visibility 尊重商业敏感默认不公开。 */
export const CASE_LIBRARY_NOTE =
  '案例库检索支持按类型/适用场景/是否公开筛选；visibility 尊重商业敏感默认不公开（internal）——案例库读取端点随 #2045 服务端化上线，当前无案例可检、不展示假案例。'

export type MinutesActionRow = { action: string; owner: string; dueDate: string }

export type MinutesDraft = {
  meetingDate: string
  agenda: string
  issues: string[]
  actions: MinutesActionRow[]
}
