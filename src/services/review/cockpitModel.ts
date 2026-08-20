// 六维驾驶舱纯模型（Epic #2033 · M1 · #2038）
// ---------------------------------------------------------------------------
// 注册表（shared/review-templates/registry.mjs，#2036 交付）→ 驾驶舱视图模型。
// 只做视图推导：不发请求、不触 DOM。数字诚实纪律：缺数据按就绪度台账呈现
// data_gap 计数与 gapNote，不出假数、不合成。
import {
  DIMENSIONS,
  REVIEW_TEMPLATES,
  templateById,
  type ReviewDimension
} from 'shared/review-templates/registry.mjs'
import type { TodoView } from './templateInstanceApi'

export type TemplateCard = {
  id: string
  name: string
  readiness: 'ready' | 'data_gap' | 'deferred'
  automation: 'A' | 'B' | 'C'
  cadences: readonly string[]
  slots24: boolean
  gapNote: string | null
  notes: string | null
}

export type DimensionCard = {
  key: ReviewDimension
  label: string
  templates: TemplateCard[]
  counts: { ready: number; dataGap: number; deferred: number }
  /** 驾驶舱页内锚点：M1 已有真实区块的维度锚到既有 section；null=入口即模板抽屉 */
  anchor: string | null
}

/**
 * 六维 → 驾驶舱页内锚点（2026-08-13 拍板：升级现页不另建）。
 * 偏差/结果锚到既有核心区块；策略/市场/风险/决策锚到 M2–M4 维度面板
 * （#2042–#2049 落地后六维全部有真实落点）。
 */
const DIMENSION_ANCHORS: Partial<Record<ReviewDimension, string>> = {
  deviation: 'deviation',
  result: 'result',
  strategy: 'strategy',
  market: 'market',
  risk: 'risk',
  decision: 'decision'
}

function toCard(t: (typeof REVIEW_TEMPLATES)[number]): TemplateCard {
  return {
    id: t.id,
    name: t.name,
    readiness: t.readiness,
    automation: t.automation,
    cadences: t.cadences,
    slots24: t.slots24 === true,
    gapNote: t.gapNote ?? null,
    notes: t.notes ?? null
  }
}

/** 六维入口卡：每维模板清单 + 就绪度计数（就绪度台账即分期验收清单，注册表单源）。 */
export function buildDimensionCards(): DimensionCard[] {
  return (Object.keys(DIMENSIONS) as ReviewDimension[]).map((key) => {
    const templates = REVIEW_TEMPLATES.filter((t) => t.dimension === key).map(toCard)
    const counts = {
      ready: templates.filter((t) => t.readiness === 'ready').length,
      dataGap: templates.filter((t) => t.readiness === 'data_gap').length,
      deferred: templates.filter((t) => t.readiness === 'deferred').length
    }
    return { key, label: DIMENSIONS[key], templates, counts, anchor: DIMENSION_ANCHORS[key] ?? null }
  })
}

/**
 * 顶部指标卡 · 偏差率（两张真数卡之一）：总偏差 / 申报总量。
 * 无结果或申报总量 ≤0 → pct 为 null（「无从计率」），绝不用 0 冒充无偏差。
 */
export type DeviationMetric = {
  deviationPct: number | null
  totalAbsDeviationMwh: number | null
  estimatedPenaltyYuan: number | null
}

export function deviationMetricOf(input: {
  totalAbsDeviationMwh: number | null
  declaredTotalMwh: number | null
  estimatedPenaltyYuan: number | null
}): DeviationMetric {
  const { totalAbsDeviationMwh, declaredTotalMwh, estimatedPenaltyYuan } = input
  const pct =
    totalAbsDeviationMwh !== null && declaredTotalMwh !== null && declaredTotalMwh > 0
      ? totalAbsDeviationMwh / declaredTotalMwh
      : null
  return { deviationPct: pct, totalAbsDeviationMwh, estimatedPenaltyYuan }
}

/** 风险事件卡（M3 前占位空态，Epic 验收：M3 前不显示数字）。 */
export const RISK_CARD_NOTE =
  '风险事件库随 M3（#2047）上线：届时此处显示近 30 天高/中风险事件数与未闭环处置数。当前无数据源，不显示占位数字。'

/** 待办行：实例 + 注册表模板元信息（模板名/维度/时限文案）。未知 templateId 如实标注。 */
export type TodoRow = TodoView & {
  templateName: string
  dimensionLabel: string | null
  deadlineLabel: string | null
}

export function enrichTodos(todos: readonly TodoView[]): TodoRow[] {
  return todos.map((t) => {
    const tpl = templateById(t.templateId)
    return {
      ...t,
      templateName: tpl ? tpl.name : `未知模板 ${t.templateId}`,
      dimensionLabel: tpl ? DIMENSIONS[tpl.dimension] : null,
      deadlineLabel: tpl ? tpl.deadline : null
    }
  })
}

/** S1/驾驶舱共用的实例摘要写入方向提示（提交端点未上线，#2037 落地前只读）。 */
export const SUBMIT_PENDING_NOTE =
  '模板实例提交端点随服务端化（#2037）上线：当前仅本地预览，不落库、不留「已提交」痕迹。'
