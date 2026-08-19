import type { ModuleContractMeta, QuarterHourPoint } from './common'

/**
 * Adapter 输入源注释：
 * - 山西：`sdpt_zfsdjy*` 分时段交易、`sdpt_zjyap` 交易安排、`sdpt_zptqx`
 *   平台曲线、`sdpt_zrqsb` 日前申报等经典 family 汇入。
 * - 云南：当前资产盘点显示中长期台账族缺真实源；后续应由 `plant_spot_settlement/contract_curves`
 *   或公司台账 canonical 派生，缺口按 `missing`/`mock` 标注，不能复用山西 family。
 */

/**
 * 中长期分时段交易 / 持仓监控的采集族。
 *
 * 这是三德普华公司私有族（2026-08-03 由 public 更正）：载荷是该公司的合同台账与逐日持仓
 * 电量/持仓均价。消费页必须把它传给 `<RegionDataBanner :families>`，否则未获授权的登录用户
 * 只会看到一张空表、不知道是被拒（横幅在未传 families 时永不显示无权限态）。
 */
export const MIDLONG_TIME_BLOCK_FAMILY = 'sdpt_zfsdjy'

export type MidlongTradeType =
  | 'annual'
  | 'monthly'
  | 'weekly'
  | 'daily'
  | 'intra_day'
  | 'inter_provincial'
  | string

export type MidlongDataType =
  | 'bid'
  | 'deal'
  | 'schedule'
  | 'position'
  | 'curve'
  | string

export type MidlongTimeSlice = QuarterHourPoint<{
  volumeMwh: number | null
  priceYuanPerMwh: number | null
}>

export type MidlongTradeCalendarItem = {
  tradingDate: string
  targetDate: string
  tradeType: MidlongTradeType
  dataType: MidlongDataType
  marketOperator?: string
  gridScope?: string
}

export type MidlongPositionItem = {
  companyId: string
  companyName: string
  targetDate: string
  tradeType: MidlongTradeType
  buyVolumeMwh: number | null
  sellVolumeMwh: number | null
  netVolumeMwh: number | null
  avgPriceYuanPerMwh: number | null
}

export type MidlongCurveItem = {
  tradingDate: string
  targetDate: string
  tradeType: MidlongTradeType
  dataType: MidlongDataType
  companyId?: string
  companyName?: string
  timeSlices: MidlongTimeSlice[]
}

export type MidlongCompanyOwnership = {
  companyId: string
  companyName: string
  regionId: string
  role: 'buyer' | 'seller' | 'agent' | 'owner' | string
  accessDenied?: boolean
  deniedReason?: string
}

export type MidlongContract = ModuleContractMeta & {
  group: 'midlong'
  calendars: MidlongTradeCalendarItem[]
  curves: MidlongCurveItem[]
  positions: MidlongPositionItem[]
  companyOwnership: MidlongCompanyOwnership[]
}
