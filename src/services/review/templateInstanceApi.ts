// 模板实例数据面 · 纯逻辑（Epic #2033 · M1 · #2038/#2040 消费端）
// ---------------------------------------------------------------------------
// #2037/#2039 已上线：触发引擎按周期生成实例分母，端点经 Python 薄代理转发
// Node BFF（/api/v1/review/template-instances）。探针契约保留——端点未部署的
// 环境（404/405）仍诚实降级，不合成、不拿假分母。
//
// 纯逻辑独立成文件（沿用 reviewError.ts 惯例）：传输层模块链触 window，进不了
// vitest node 环境；可测的分类/排序逻辑全部收在这里。

export type TemplateInstanceStatus = 'pending' | 'draft' | 'submitted' | 'reviewed'

/** 待办箱/驾驶舱消费的实例摘要（对齐迁移 025 的 template_instances 关键列） */
export type TemplateInstanceSummary = {
  id: string
  templateId: string
  /** 日/周/月/季或事件锚（如 2026-08-14、2026-W33、event:xxx） */
  periodKey: string
  status: TemplateInstanceStatus
  /** 截止时限 ISO 8601；无时限为 null（排序沉底） */
  dueAt: string | null
  updatedAt: string | null
  /** 人工字段草稿（human + 已采纳 ai 建议值，按 field key）；列表未带回时缺省 */
  payload?: Record<string, unknown>
}

/**
 * 探针结果三态：
 * - available：端点已上线，instances 为真数据（可为空数组=引擎在跑但无待办）
 * - endpoint-absent：404/405/200-but-HTML——触发引擎未上线（当前常态）
 * - unauthorized / unreachable：权限与网络态（可重试提示）
 */
export type TemplateInstanceFeed =
  | { available: true; instances: TemplateInstanceSummary[] }
  | { available: false; reason: 'endpoint-absent' | 'unauthorized' | 'unreachable' }

export const FEED_ABSENT_NOTE =
  '复盘触发引擎（#2039）未上线：待办由引擎按周期/事件生成（分母），上线前不显示复盘覆盖率与填写率，不拿假分母凑数。'

function coerceInstance(row: unknown): TemplateInstanceSummary | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  // 服务端（#2037 起）JSON 里 id 是数字；历史探针契约是 string——两种都收，统一出口 string
  const rawId = typeof r.id === 'number' ? String(r.id) : typeof r.id === 'string' ? r.id : null
  const templateId = typeof r.template_id === 'string' ? r.template_id : typeof r.templateId === 'string' ? r.templateId : null
  if (!rawId || !templateId) return null
  const id = rawId
  const status = r.status
  const periodKey = typeof r.period_key === 'string' ? r.period_key : typeof r.periodKey === 'string' ? r.periodKey : ''
  const dueAt = typeof r.due_at === 'string' ? r.due_at : typeof r.dueAt === 'string' ? r.dueAt : null
  const updatedAt = typeof r.updated_at === 'string' ? r.updated_at : typeof r.updatedAt === 'string' ? r.updatedAt : null
  if (status === 'pending' || status === 'draft' || status === 'submitted' || status === 'reviewed') {
    const payload =
      r.payload && typeof r.payload === 'object' && !Array.isArray(r.payload)
        ? (r.payload as Record<string, unknown>)
        : undefined
    return { id, templateId, periodKey, status, dueAt, updatedAt, payload }
  }
  return null
}

/**
 * 从响应体提取实例列表。容忍三种信封：裸数组 / {data:[…]} / {instances:[…]}。
 * 200 但提取不到数组（如静态托管的 HTML 兜底页）按「端点不存在」处理——
 * 生产静态部署对未知路径可能回 index.html，不能把 HTML 当空列表渲染。
 */
function extractInstances(body: unknown): TemplateInstanceSummary[] | null {
  const rows: unknown[] | null = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).data)
      ? ((body as Record<string, unknown>).data as unknown[])
      : body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).instances)
        ? ((body as Record<string, unknown>).instances as unknown[])
        : null
  if (!rows) return null
  const mapped = rows.map(coerceInstance).filter((x): x is TemplateInstanceSummary => x !== null)
  // 行存在但全部不合法 → 形态不符，视为未上线（宁降级不误读）
  if (mapped.length === 0 && rows.length > 0) return null
  return mapped
}

export function classifyInstanceResponse(status: number, body: unknown): TemplateInstanceFeed {
  if (status === 404 || status === 405) return { available: false, reason: 'endpoint-absent' }
  if (status === 401 || status === 403) return { available: false, reason: 'unauthorized' }
  if (status >= 200 && status < 300) {
    const instances = extractInstances(body)
    return instances ? { available: true, instances } : { available: false, reason: 'endpoint-absent' }
  }
  // 5xx 与其它：端点在但暂时不可用，可重试
  return { available: false, reason: 'unreachable' }
}

/** 传输层 catch 用：网络层异常（TypeError/DOMException/超时）与 HTTP 错误统一归 unreachable。 */
export function classifyInstanceError(_e: unknown): TemplateInstanceFeed {
  return { available: false, reason: 'unreachable' }
}

/** 待办视图项：pending/draft + 逾期推导 */
export type TodoView = TemplateInstanceSummary & { overdue: boolean }

function dueTs(dueAt: string | null): number | null {
  if (!dueAt) return null
  const t = Date.parse(dueAt)
  return Number.isNaN(t) ? null : t
}

/**
 * 待办排序：逾期在前 → 截止越早越前 → 无时限沉底；同截止按 updatedAt 新者在前。
 * 只收 pending/draft（submitted/reviewed 不是待办）。
 */
export function toTodoViews(instances: readonly TemplateInstanceSummary[], nowIso: string): TodoView[] {
  const now = Date.parse(nowIso)
  const nowTs = Number.isNaN(now) ? Date.now() : now
  return instances
    .filter((i) => i.status === 'pending' || i.status === 'draft')
    .map((i) => {
      const d = dueTs(i.dueAt)
      return { ...i, overdue: d !== null && d < nowTs }
    })
    .sort((a, b) => {
      const da = dueTs(a.dueAt)
      const db = dueTs(b.dueAt)
      if (da !== null && db !== null && da !== db) return da - db
      if (da !== null && db === null) return -1
      if (da === null && db !== null) return 1
      const ua = dueTs(a.updatedAt) ?? 0
      const ub = dueTs(b.updatedAt) ?? 0
      return ub - ua
    })
}
