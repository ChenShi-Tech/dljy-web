// 历史模拟单的溯源信息（纯函数，**零依赖**）。
//
// 终态单（逾期/已出清/已驳回）无出边，用户要「重新申报」时按同参数复制一张 REHEARSAL 新单。
// note 必须同时记下**被模拟的日期**与**发起模拟的时间**：只有目标日，就分不清这张单是当年
// 真报的还是今天补跑的回测——而这两者在复盘时的含义完全不同。
//
// 之所以写进 note 而不是新增契约字段：契约每加一个字段要同步四处生成物 + 版本兼容快照，
// 而这里要的只是可读溯源，不参与任何计算或校验。格式固定以便 parse 回显。
//
// 单独成文件而非并进 `declarations.ts`：后者经 `api.ts` 链到 `regionContext.ts`，
// 那里在**模块加载期**就访问 `window.localStorage`，而本仓单测不带 jsdom——放进去就不可测了。

// 时区后缀是**格式的一部分**，不是装饰：电力市场口径恒为 +08:00，而浏览器时区未必。
// 不带标记的话，UTC 浏览器在北京时间 12:34 发起的模拟会被写成「04:34」，复盘时按 +08:00
// 读就整整差了 8 小时——溯源信息本身失真。旧格式（无后缀）仍可解析，按存量兼容处理。
const REHEARSAL_STARTED_RE = /于\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?: \(\+08:00\))?)\s*发起/

export function buildRehearsalNote(input: {
  targetDate: string
  startedAt: string
  sourceId: string
  sourceStatusLabel: string
}): string {
  return `历史模拟 · 模拟目标日 ${input.targetDate} · 于 ${input.startedAt} 发起 · 复制自 ${input.sourceId}（${input.sourceStatusLabel}）`
}

/** 从 note 取回「发起模拟的时间」；解析不出返回空串（不拿 createdAt 之类近似值顶替）。 */
export function parseRehearsalStartedAt(note: string | null | undefined): string {
  const m = String(note ?? '').match(REHEARSAL_STARTED_RE)
  return m ? m[1] : ''
}

/**
 * 时间戳 → `YYYY-MM-DD HH:mm (+08:00)`（与 note 格式一致，供发起模拟时写入）。
 *
 * **显式换算到 +08:00**，不用 `getHours()` 等本地时区方法：申报截止、目标日等全页口径都是
 * +08:00（见 `computeDeadline`），而浏览器时区未必。UTC 浏览器在北京时间 12:34 发起模拟，
 * 用本地方法会记成「04:34」，复盘时按市场口径读就差了 8 小时。
 */
export function formatRehearsalStamp(ts: number): string {
  const shifted = new Date(ts + 8 * 60 * 60 * 1000) // 移到 +08:00 后用 UTC 取值，避开本地时区
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
    + ` ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())} (+08:00)`
}
