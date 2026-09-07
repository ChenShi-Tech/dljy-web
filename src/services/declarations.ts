// 现货申报单客户端（P1 申报闭环）：对接 /api/v1/trading/spot/declarations。
// 申报台步骤条由申报单状态驱动（替代轮询智能体状态字符串）。
// DeclarationStatus 联合改由契约单一来源生成（#756 C3）：
// shared/contracts/spot-declaration.contract.json → spotDeclarationContract.gen.ts；
// 此处 re-export 保持既有 import 路径不变，消费方零改动。
import { apiGet, apiPost, apiPut } from '@/services/api'
import type { DataBasis } from '@/services/dataBasis'
import type {
  DeclarationStatus,
  SpotDeclarationCreatePayload as SpotDeclarationCreatePayloadGen
} from '@/services/contracts/spotDeclarationContract.gen'

export type { DeclarationStatus, SpotDeclarationCreatePayload } from '@/services/contracts/spotDeclarationContract.gen'

/**
 * 申报单模式（契约 v2）。类型取自生成物的 mode 字段，避免此处手写联合造成两处真相。
 * LIVE=真实申报（受 D-1 10:30 截止约束）；REHEARSAL=历史模拟演练（仅豁免时间维度）。
 */
export type DeclarationMode = NonNullable<SpotDeclarationCreatePayloadGen['mode']>

export const DECLARATION_MODE_LABEL: Record<DeclarationMode, string> = {
  LIVE: '真实申报',
  REHEARSAL: '历史模拟'
}

export type RiskCheckItem = {
  // 契约已扩为手册 T4 十项（capacity/priceCap/quotePrecision/exposure/bias/dataBasis/
  // quoteRationale/redLine/socTrajectory/breakeven），此处只作展示用途，放宽为 string
  checkId: string
  name: string
  status: 'PASS' | 'FAIL' | 'UNAVAILABLE'
  severity?: 'hard' | 'overridable' | 'warning'
  detail: string
}

export type RiskCheckResult = {
  checks: RiskCheckItem[]
  passed: boolean
  /** 硬约束不通过：结果照常落库但状态转移被拦（送审门据此拒绝） */
  blocked?: boolean
  blockers?: RiskCheckItem[]
  gateLevel: 'L2' | 'L3'
  totalMwh: number
  maxMw: number
  evaluatedAt: string
  inputs?: Record<string, unknown>
}

export type ApprovalRecord = {
  at: string
  approver: string
  role: string
  decision: 'approve' | 'reject'
  gateLevel: string
  comment: string | null
  /** 演练单创建人自批留痕（真实单永远缺席），四眼原则豁免的审计标记 */
  rehearsalSelfApproval?: boolean
  /** L3 双签：本条只是第一签，单据尚未批准（第二签批准后另有正式记录） */
  dualSignPending?: boolean
}

export type DeclarationAuditEntry = {
  at: string
  actor: string
  role: string
  action: string
  from: string | null
  to: string | null
  note: string | null
}

export type DeclarationOrder = {
  id: string
  targetDate: string
  deadline: string
  status: DeclarationStatus
  /** 申报单模式。存量单无此字段，消费方一律按 LIVE 处理（用 declarationModeOf 归一化）。 */
  mode?: DeclarationMode
  companyId: string
  region: string | null
  subjectId: string | null
  subjectType: string | null
  capacityMw: number
  // 96 个 15 分钟时段电量（MWh/点）；平均功率 MW = 点电量 × 4
  energyCurveMwh96: number[]
  priceCurve96: number[] | null
  strategySource: string
  basis: DataBasis
  /** 报价依据摘要（契约 v3 起必填）；存量单可能缺失 */
  quoteRationale?: string
  /**
   * 一日作业链各阶段产出（契约 v5，v1.0 七步动线）。每步做完写回这里，下一步与服务端
   * 风控检查直接读，交易员不必在页面之间手抄结论。
   * 是作业留痕而非权威判据：服务端对能自算的硬字段（basis/capacity/报价精度）不看它。
   * 写入窗口由服务端按阶段把门：申报前判据限提交前，出清复盘限出清后，日终收口不限。
   */
  preflight?: {
    /** S1 晨会复盘：昨日偏差认知 + 今日不重犯要点 */
    morningReview?: {
      reviewedDate: string
      reviewedDeclarationId: string | null
      /** ① 中标情况：申报 vs 出清的中标率 */
      clearRate: number | null
      /**
       * 偏差主因 id，取值集合见 `shared/trading-rules/morning-review.mjs::DEVIATION_CAUSES`。
       * 改版前（按责任环节分类）的历史单据存的是中文标签，展示一律走 `causeLabelOf` 兜底，
       * 命中不了原样显示，把当时真实写下的判断显示成「未知」等于抹掉它。
       */
      cause: string
      /** 写入时的中文标签快照，便于不加载规则层也能读懂这条留痕 */
      causeLabel?: string
      /** 归因未判定（`cause === 'pending'`），待晨会人工讨论后回填主因 */
      pendingAnalysis?: boolean
      /** ② 执行偏差摘要：申报 vs 实际（后端 quant /review 口径）。未取到为 null，不用 0 冒充「无偏差」 */
      executionDeviationMwh?: number | null
      assessedMwh?: number | null
      /** 实际侧来源（如 `replay`）；`client_provided:*` 表示服务端无法验证其口径 */
      actualSource?: string | null
      lessons: string
      writtenBy: string
      writtenAt: string
      // ── 六维复盘扩展（需求文档 §五，新增字段全 optional，旧单据读取不报错）──
      /** 需求1：责任归属 id（模板七四分类），见 `shared/.../morning-review.mjs::DEVIATION_RESPONSIBILITY` */
      responsibility?: 'forecast' | 'emergency' | 'strategy' | 'operation' | null
      /** 写入时的中文标签快照 */
      responsibilityLabel?: string
      /** 需求2：偏差考核费用（模板八；后端 /review 估算）。null=未取到，不用 0 冒充 */
      deviationCostYuan?: number | null
      /** 需求2：偏差率（%，偏差量/申报量） */
      deviationRate?: number | null
      /** 需求3：结果三层拆分快照（品种/峰平谷/单笔） */
      resultLayers?: {
        byProduct?: Array<{
          product: string
          revenue: number | null   // null=未取到（不用 0 冒充）
          share: number | null
          sourceType: 'REAL' | 'MOCK'
        }>
        byPeriod?: Array<{ segment: string; slots: number; totalMwh: number; sharePct: number | null }>
        topTrades?: {
          topGain: Array<{ slot: number; note: string }>
          topLoss: Array<{ slot: number; note: string }>
        } | null
      } | null
      /** 需求4：决策复盘三问结论（模板一精简版） */
      decisionReview?: {
        totalDecisions: number
        reviewedDecisions: number
        threeQuestions: Array<{
          decisionId: string
          info: 'ok' | 'lacking'
          logic: 'ok' | 'flawed'
          emotion: 'calm' | 'biased'
          note?: string
        }>
      } | null
      /** 需求6：本次复盘的角色（角色专属区口径） */
      role?: 'retail' | 'storage' | 'renewable'
      /** 需求6：角色专属汇总（R1/R4、E3/S1、N1 口径；结构按角色定，旧读取方不解析） */
      roleSpecific?: Record<string, unknown> | null
    }
    /**
     * S2 早间分析的产出：数据可信度门禁 + 今日市场判断。
     * 市场判断字段（regime、priceCenterLow/High、coverage）在 v1.0 动线下由早间分析写入；
     * 若只跑了八源核验则仅有门禁字段，故市场判断部分为可选。
     */
    dataGate?: {
      gate: string
      completenessRate: number
      weakestCredibility: string
      degradeLevel: number
      writtenBy: string
      writtenAt: string
      regime?: string
      coverage?: number
      priceCenterLow?: number
      priceCenterHigh?: number
      tightestSlot?: { slot: number; ratio: number; regime: string } | null
      loosestSlot?: { slot: number; ratio: number; regime: string } | null
    }
    storagePlan?: { socTrajectoryOk: boolean; socEndOk: boolean; safetyMultiple: number | null; cycles: number; grossMarginYuan: number; writtenBy: string; writtenAt: string }
    /** S3 方向判断的产出：方向 + 置信度 + 申报曲线（供 R4 偏置校验） */
    forecast?: {
      curveMwh96: number[]
      source: string
      direction?: 'add' | 'reduce' | 'hold'
      confidence?: number
      biasRatio?: number
      rationale?: string
      /** 概率分布消费结论（#1963）：P10/P50/P90 摘要 + 漂移回退标志 */
      quantileDigest?: {
        mean: number
        peak: number
        peakHour: number
        valley: number
        valleyHour: number
        spread: number
        avgBandWidth: number
        widestBandHour: number
        widestBandWidth: number
        driftFallback?: boolean | null
        exposureFactorApplied?: number
      } | null
      /** 储能套利窗口结论（#1963） */
      arbitrage?: {
        assetLabel: string
        requiredSpreadYuanPerMwh: number
        prepareExecute: boolean
        windows: Array<{
          chargeFrom: number
          chargeTo: number
          dischargeFrom: number
          dischargeTo: number
          chargePriceP50: number
          dischargePriceP50: number
          p50Spread: number
          conservativeSpread: number
          verdict: 'execute' | 'needs_approval' | 'skip'
          safetyMultiple: number
        }>
      } | null
      /** 凯利仓位上限红线（%）（#1963） */
      kellyCapPct?: number | null
      writtenBy: string
      writtenAt: string
    }
    /** S5 出清分析：中标偏差结论 */
    clearingReview?: {
      clearRate: number | null
      maxGapSlot: number | null
      needsRealtimeAction: boolean
      summary: string
      /** 严重偏离（>±20%）时段数（手册第二档，#1965） */
      severeSlotCount?: number
      needsEscalation?: boolean
      /** 实时调整指令草稿（±10% 档决策留痕；执行通道未接须平台人工操作） */
      realtimeAdjustment?: {
        action: 'none' | 'increase' | 'decrease'
        label?: string
        volumeMwh: number | null
        reason: string | null
      } | null
      /** 严重偏离上报记录 */
      escalation?: { reason: string; reportedBy: string; reportedAt: string } | null
      /** 持仓联动（F4.2）：日前中标量自动喂给 S6 持仓视图 */
      positionUpdate?: { dayAheadClearedMwh: number; declaredMwh: number }
      /** 外送出清量价（人工录入留痕） */
      exportClearing?: { volumeMwh: number | null; avgPriceYuanPerMwh: number | null } | null
      /** 电站出勤记录（人工录入留痕，清比例随录随算） */
      stationRecords?: Array<{
        station: string
        declaredMwh: number | null
        clearedMwh: number | null
        clearRate: number | null
        attendancePct: number | null
      }>
      writtenBy: string
      writtenAt: string
    }
    /** S6 中长期补仓决定 */
    contract?: {
      gapMwh: number
      gapPct: number | null
      suggestion: string
      action: string
      reason: string
      /** 挂牌价与年度均价（库内年度合同量加权，#1966） */
      listingPriceYuanPerMwh?: number | null
      annualAvgYuanPerMwh?: number | null
      listingCompare?: { diffPct: number; verdict: 'below' | 'above' | 'comparable' } | null
      /** 分布判时机（lock_now/wait/neutral，依赖 S3 概率分布） */
      timingVerdict?: 'lock_now' | 'wait' | 'neutral' | null
      /** 波动守卫（>5% 暂停补仓/改对冲） */
      volatility?: { changePct: number | null; paused: boolean }
      kellyCapPct?: number | null
      /** 已执行登记到公司合约库 */
      executedRegistered?: boolean | null
      writtenBy: string
      writtenAt: string
    }
    /** S7 日报收尾 */
    dailyClose?: {
      reportSummary: string
      decisionsLogged: number
      coverageOk: boolean
      /** 市场概况（本单口径：出清优先/申报兜底，全市场待数据活源，#1967） */
      marketDigest?: {
        sourceBasis: 'declared' | 'cleared'
        totalVolumeMwh: number
        highYuanPerMwh: number | null
        lowYuanPerMwh: number | null
        weightedAvgYuanPerMwh: number | null
      } | null
      /** 明日提醒（自动拼装 + 人工补充） */
      tomorrowReminders?: string[]
      writtenBy: string
      writtenAt: string
    }
  }
  note: string | null
  riskCheck: RiskCheckResult | null
  approvalRecord: ApprovalRecord[]
  /**
   * L3 双签在途的第一签（工作台审查 P1 修复）：gateLevel=L3 的真实单须两位不同审批人
   * 先后批准才迁移 APPROVED。送审与批准完成后服务端都会清空本数组，故非空即「已有一签、
   * 待第二签」。
   */
  l3Signatures?: Array<{ approver: string; role: string; at: string; comment: string | null }>
  /** 瞬态响应标记（不落库）：本次 approve 只完成 L3 第一签，等待第二位审批人 */
  awaitingSecondSignature?: boolean
  receipt: {
    receiptId: string
    gateway: string
    acknowledgedAt: string
    idempotencyKey: string
    mock: boolean
    /** 回执自证模式：演练回执标 REHEARSAL，单看回执即可判断是否真实申报 */
    mode?: DeclarationMode
    note?: string
  } | null
  clearing: { clearedCurveMwh96: number[] | null; markedAt: string; source: string } | null
  createdBy: string
  createdAt: string
  updatedAt: string
  audit: DeclarationAuditEntry[]
}

export type DeclarationMeta = {
  targetDate: string
  deadline: string
  deadlineHHmm: string
  now: string
  msRemaining: number
  expired: boolean
}

const BASE = '/v1/trading/spot/declarations'

export async function fetchDeclarationMeta(date: string): Promise<DeclarationMeta> {
  const res = await apiGet<{ data: DeclarationMeta }>(`${BASE}/meta`, { date })
  return (res.data ?? res) as unknown as DeclarationMeta
}

export type DeclarationListParams = {
  /** 精确目标日；与 dateFrom/dateTo 同传时服务端以 date 为准（appliedFilters 回显生效条件） */
  date?: string
  /** 目标日范围，含端点；单传一侧即开区间 */
  dateFrom?: string
  dateTo?: string
  status?: DeclarationStatus
  mode?: DeclarationMode
  limit?: number
  offset?: number
}

export type DeclarationListPage = {
  rows: DeclarationOrder[]
  /** 过滤后、分页前的总数 */
  total: number
  limit: number
  offset: number
  /** 模式分布。服务端刻意不含 mode 过滤，故切 mode 筛选时两个计数不互相抹零 */
  counts: Record<DeclarationMode, number>
  appliedFilters: {
    date: string | null
    dateFrom: string | null
    dateTo: string | null
    status: string | null
    mode: string | null
  }
}

/** 申报单模式归一化：存量单无 mode 字段一律视为 LIVE（与服务端 declarationMode 同口径）。 */
export function declarationModeOf(declaration: Pick<DeclarationOrder, 'mode'> | null | undefined): DeclarationMode {
  return declaration?.mode === 'REHEARSAL' ? 'REHEARSAL' : 'LIVE'
}

export async function listDeclarations(params: DeclarationListParams = {}): Promise<DeclarationOrder[]> {
  const res = await apiGet<{ data: { rows: DeclarationOrder[] } }>(BASE, params)
  const data = (res.data ?? res) as unknown as { rows?: DeclarationOrder[] }
  return data.rows ?? []
}

/**
 * 带分页元信息的列表查询（历史申报单区块用）。
 * 服务端未回 counts/total 时按 rows 兜底推导，避免旧后端下 UI 整块空白。
 */
export async function listDeclarationsPage(params: DeclarationListParams = {}): Promise<DeclarationListPage> {
  const res = await apiGet<{ data: DeclarationListPage }>(BASE, params)
  const data = (res.data ?? res) as unknown as Partial<DeclarationListPage>
  const rows = data.rows ?? []
  const counts = data.counts ?? rows.reduce(
    (acc, row) => { acc[declarationModeOf(row)] += 1; return acc },
    { LIVE: 0, REHEARSAL: 0 } as Record<DeclarationMode, number>
  )
  return {
    rows,
    total: typeof data.total === 'number' ? data.total : rows.length,
    limit: typeof data.limit === 'number' ? data.limit : rows.length,
    offset: typeof data.offset === 'number' ? data.offset : 0,
    counts,
    appliedFilters: data.appliedFilters ?? {
      date: params.date ?? null,
      dateFrom: params.dateFrom ?? null,
      dateTo: params.dateTo ?? null,
      status: params.status ?? null,
      mode: params.mode ?? null
    }
  }
}

export async function getDeclaration(id: string): Promise<DeclarationOrder> {
  const res = await apiGet<{ data: DeclarationOrder }>(`${BASE}/${encodeURIComponent(id)}`)
  return (res.data ?? res) as unknown as DeclarationOrder
}

export async function createDeclaration(input: {
  targetDate: string
  capacityMw: number
  /**
   * 报价依据摘要（契约 v3 起必填）。须写明本次报价的成本锚或机会成本锚且可追溯到具体
   * 数值，监管质询时这是自证报价形成过程的唯一材料，事后补写等于自证材料失效。
   */
  quoteRationale: string
  energyCurveMwh96?: number[]
  priceCurve96?: number[] | null
  strategySource?: string
  basis?: DataBasis
  note?: string
  subjectType?: string
  /** 缺省 LIVE。REHEARSAL 创建后不可改（服务端 updateCurve 不接受 mode）。 */
  mode?: DeclarationMode
}): Promise<DeclarationOrder> {
  const res = await apiPost<{ data: DeclarationOrder }>(BASE, input)
  return (res.data ?? res) as unknown as DeclarationOrder
}

export type PreflightStage =
  | 'morningReview'
  | 'dataGate'
  | 'storagePlan'
  | 'forecast'
  | 'clearingReview'
  | 'contract'
  | 'dailyClose'

/**
 * 写回某一阶段的作业产出。
 * 这是七步作业链串成一条的写入端：做完本阶段即写回，下一阶段自动读到。
 */
export async function savePreflight(
  id: string,
  stage: PreflightStage,
  payload: Record<string, unknown>,
  note?: string
): Promise<DeclarationOrder> {
  const res = await apiPost<{ data: DeclarationOrder }>(`${BASE}/${id}/preflight`, { stage, payload, note })
  return (res.data ?? res) as unknown as DeclarationOrder
}

export async function updateDeclarationCurve(id: string, input: {
  energyCurveMwh96?: number[]
  priceCurve96?: number[] | null
  basis?: DataBasis
  note?: string
  strategySource?: string
}): Promise<DeclarationOrder> {
  const res = await apiPut<{ data: DeclarationOrder }>(`${BASE}/${encodeURIComponent(id)}/curve`, input)
  return (res.data ?? res) as unknown as DeclarationOrder
}

/**
 * 申报曲线编辑器是否相对已保存曲线存在未保存修改（脏标记的派生口径）。
 * 对比口径与保存链一致：编辑器 96 点每点即一个 15min 时点，点电量 = MW/4（4 位舍入）。
 * 用派生值而非「watch 置 true / 同步置 false」的标志位：deep watch 异步 flush，
 * 「赋新数组 → 同步置 false」的序列会被迟到的 watcher 改回 true，造成加载/保存后
 * 恒报「含未保存修改」、无修改也可点保存（服务端会把 RISK_CHECKED 打回 DRAFT）。
 */
export function isCurveEdited(pointMw96: number[], savedCurve96?: number[] | null): boolean {
  if (!Array.isArray(savedCurve96) || savedCurve96.length !== 96) return false
  return pointMw96.some((mw, i) => {
    const point = Math.round((mw / 4) * 10000) / 10000
    return Math.abs(savedCurve96[i] - point) > 1e-6
  })
}

/**
 * 申报曲线编辑器单格原始输入 → 数值 MW。清空/半输入态（v-model.number 得 ''）、
 * 非数与负数（input min 挡不住键入）一律返回 NaN，由调用方禁用保存并明示，
 * 不再静默按 0 处理——此前 '' 参与求和会退化成字符串拼接（总量显示成拼接数字）、
 * 保存链上 ''/4 会把该小时静默归零。
 */
export function editorMwOf(value: unknown): number {
  // Number('') === 0、Number(null) === 0：空输入必须先于数值转换判定，
  // 否则清空一格会被静默折算成 0（本次修复要消灭的正是这个行为）
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return Number.NaN
  }
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN
}

/** 编辑器 96 点中非法（未填/非数/负数）的时点下标，供保存门与「时点 HH:MM 未填」提示。 */
export function invalidPointIndexesOf(points: Array<unknown>): number[] {
  return points.flatMap((value, index) => (Number.isNaN(editorMwOf(value)) ? [index] : []))
}

/**
 * 风控/敞口的中长期合约总量入参归一：输入框被清空/误输（''、非数、0、负数）时
 * 不把垃圾值发给风控与敞口端点，兜底为 1 MWh。服务端虽会优雅拒绝，但前端
 * 不发垃圾本身是口径（正常值原样透传，含小数）。
 */
export function normalizeExposureTotalMwh(value: unknown): number {
  return Math.max(1, Number(value) || 1)
}

export async function runDeclarationRiskCheck(id: string, input: {
  // 当月中长期合约总电量（MWh），服务端据此调 harness 敞口端点
  exposureTotalMwh?: number
  // 地区限价区间（来自 RegionSpotProfile.mechanism.priceCap，来源被记录审计）
  priceCap?: { floor: number; cap: number; source?: string }
}): Promise<DeclarationOrder> {
  const res = await apiPost<{ data: DeclarationOrder }>(`${BASE}/${encodeURIComponent(id)}/risk-check`, input)
  return (res.data ?? res) as unknown as DeclarationOrder
}

export async function submitDeclarationForApproval(id: string): Promise<DeclarationOrder> {
  const res = await apiPost<{ data: DeclarationOrder }>(`${BASE}/${encodeURIComponent(id)}/submit-for-approval`, {})
  return (res.data ?? res) as unknown as DeclarationOrder
}

export async function approveDeclaration(id: string, decision: 'approve' | 'reject', comment?: string): Promise<DeclarationOrder> {
  const res = await apiPost<{ data: DeclarationOrder }>(`${BASE}/${encodeURIComponent(id)}/approve`, { decision, comment })
  return (res.data ?? res) as unknown as DeclarationOrder
}

export async function submitDeclaration(id: string, idempotencyKey: string): Promise<DeclarationOrder> {
  const res = await apiPost<{ data: DeclarationOrder }>(`${BASE}/${encodeURIComponent(id)}/submit`, { idempotencyKey })
  return (res.data ?? res) as unknown as DeclarationOrder
}

export async function markDeclarationCleared(id: string, input: { clearedCurveMwh96?: number[]; note?: string } = {}): Promise<DeclarationOrder> {
  const res = await apiPost<{ data: DeclarationOrder }>(`${BASE}/${encodeURIComponent(id)}/mark-cleared`, input)
  return (res.data ?? res) as unknown as DeclarationOrder
}

export const STATUS_LABEL: Record<DeclarationStatus, string> = {
  DRAFT: '草稿',
  RISK_CHECKED: '已风控检查',
  PENDING_APPROVAL: '待审批',
  APPROVED: '已审批',
  SUBMITTED: '已提交',
  ACKNOWLEDGED: '回执确认',
  CLEARED: '已出清',
  DEVIATION_TRACKING: '偏差跟踪',
  SETTLED: '已结算',
  REVIEWED: '已复盘',
  REJECTED: '已驳回',
  EXPIRED: '已逾期'
}

// 状态 → 申报台向导步骤（0情报与草稿 / 1风控与审批 / 2提交回执 / 3出清跟踪）
export function stepOfStatus(status: DeclarationStatus): number {
  if (status === 'DRAFT' || status === 'REJECTED') return 0
  if (status === 'RISK_CHECKED' || status === 'PENDING_APPROVAL') return 1
  if (status === 'APPROVED' || status === 'SUBMITTED' || status === 'ACKNOWLEDGED') return 2
  if (status === 'EXPIRED') return 1
  return 3
}
