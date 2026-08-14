// 自动生成，勿手改。单一来源：shared/contracts/spot-declaration.contract.json（v5）；重新生成：npm run build:spot-contract
// 消费方：src/services/declarations.ts（DeclarationStatus 权威联合）等。

export type DeclarationStatus =
  | 'DRAFT'
  | 'RISK_CHECKED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'CLEARED'
  | 'DEVIATION_TRACKING'
  | 'SETTLED'
  | 'REVIEWED'
  | 'REJECTED'
  | 'EXPIRED'

export const DECLARATION_STATUSES: readonly DeclarationStatus[] = ['DRAFT', 'RISK_CHECKED', 'PENDING_APPROVAL', 'APPROVED', 'SUBMITTED', 'ACKNOWLEDGED', 'CLEARED', 'DEVIATION_TRACKING', 'SETTLED', 'REVIEWED', 'REJECTED', 'EXPIRED'] as const

export const DECLARATION_TRANSITIONS: Readonly<Record<DeclarationStatus, readonly DeclarationStatus[]>> = {
  DRAFT: ['RISK_CHECKED', 'EXPIRED'],
  RISK_CHECKED: ['PENDING_APPROVAL', 'DRAFT', 'EXPIRED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'EXPIRED'],
  APPROVED: ['SUBMITTED', 'REJECTED', 'EXPIRED'],
  SUBMITTED: ['ACKNOWLEDGED'],
  ACKNOWLEDGED: ['CLEARED'],
  CLEARED: ['DEVIATION_TRACKING'],
  DEVIATION_TRACKING: ['SETTLED'],
  SETTLED: ['REVIEWED'],
  REVIEWED: [],
  REJECTED: ['DRAFT'],
  EXPIRED: [],
}

/** POST /api/v1/trading/spot/declarations 请求体。单位约定：energyCurveMwh96 为 96 个 15 分钟时段电量（MWh/点，平均功率 MW=点电量×4）；priceCurve96 为申报价（元/MWh，报量不报价省略）。 */
export type SpotDeclarationCreatePayload = {
  /** 标的交易日 D（截止 = D-1 10:30 +08:00）（YYYY-MM-DD） */
  targetDate: string
  /** 可用容量 MW（正数） */
  capacityMw: number
  /** 96 点电量曲线 MWh/15min；缺省按容量 60% 平铺初始化 */
  energyCurveMwh96?: number[]
  /** 96 点申报价 元/MWh；报量不报价时为 null */
  priceCurve96?: number[] | null
  /** 报价依据摘要：本次报价的成本锚或机会成本锚，须可追溯到具体数值（如「中长期均价 232、现货 P50 预测 248，价差 16 元/MWh」）。监管质询时这是自证报价形成过程的唯一材料——无法解释的报价即高风险报价，故不填不得建单。存量单无此字段者，风控检查按 UNAVAILABLE 升档而非拦死。 */
  quoteRationale: string
  /** 主体类型（GENERATOR/RETAILER/TRADER/STORAGE），缺省取会话主体 */
  subjectType?: string
  /** 策略来源标识；服务通道缺省 agent:declaration_prep，人工缺省 manual */
  strategySource?: string
  /** 数据真伪基线（synthetic/illustrative/captured），缺省 illustrative */
  basis?: string
  /** 备注 */
  note?: string | null
  /** 申报单模式，缺省 LIVE。LIVE=真实申报，受 D-1 10:30 截止约束，逾期即 EXPIRED；REHEARSAL=历史模拟演练，仅豁免时间维度（不被逾期扫描作废、提交不校验截止、允许创建人自批），角色矩阵/公司地区隔离/风控检查/状态机迁移表一律照常。存量与旧客户端缺省视为 LIVE，不做数据迁移。创建后不可修改。 */
  mode?: 'LIVE' | 'REHEARSAL'
}

export const SPOT_DECLARATION_CREATE_FIELDS = ['targetDate', 'capacityMw', 'energyCurveMwh96', 'priceCurve96', 'quoteRationale', 'subjectType', 'strategySource', 'basis', 'note', 'mode'] as const

export const SPOT_DECLARATION_MODE_VALUES = ['LIVE', 'REHEARSAL'] as const
