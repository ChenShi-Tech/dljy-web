// 复盘会议纪要 · 纯逻辑（Epic #2033 · M4 · #2049：模板十二，C 档纯人工表单）
// ---------------------------------------------------------------------------
// 会后 1 个工作日归档提醒（方案原文）：周六/周日顺延到周一，法定节假日未接入
// （节假日表属数据接入项，接入前以周末顺延为保守口径并注明）。

/** 会议日期 → 归档截止（+1 个工作日，周末顺延到下一工作日）。 */
export function archiveDeadline(meetingIso: string): string | null {
  const d = new Date(`${meetingIso}T00:00:00+08:00`)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + 1)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
