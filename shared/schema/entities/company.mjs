// 公司管理模块 mart 层实体的单一 schema 来源。
// 后端 server/company-store.mjs 落库前 parse；前端 src/services/companyApi.ts 由此派生 TS 类型。
// 仅描述「可编辑业务字段」；server 托管字段（id/companyId/source/created_at/updated_at）不在此。

import { object, str, num, enumOf } from '../define.mjs'

export const STATION_TYPES = ['火电', '风电', '光伏', '水电', '储能']

export const stationSchema = object({
  name: str({ required: true, default: '未命名场站' }),
  type: enumOf(STATION_TYPES, { default: '火电' }),
  capacity: num(),
  voltageLevel: str({ alias: 'voltage_level' }),
  province: str(),
  regionId: str({ alias: 'region_id' }),
  subjectId: str({ alias: 'subject_id' }),
  status: str({ default: '运行' })
})

export const unitSchema = object({
  stationId: num({ alias: 'station_id' }),
  unitName: str({ required: true, default: '未命名机组', alias: 'unit_name' }),
  ratedCapacity: num({ alias: 'rated_capacity' }),
  fuelType: str({ alias: 'fuel_type' }),
  status: str({ default: '运行' })
})

export const unitOutputSchema = object({
  unitId: num({ required: true, alias: 'unit_id' }),
  date: str({ required: true }),
  point: num({ default: 0 }),
  valueMw: num({ alias: 'value_mw' })
})

export const tradeSchema = object({
  tradeDate: str({ required: true, alias: 'trade_date' }),
  contractCode: str({ alias: 'contract_code' }),
  counterparty: str(),
  type: str(),
  direction: str(),
  volume: num(),
  price: num(),
  status: str({ default: '已成交' })
})

export const profileSchema = object({
  contact: str(),
  address: str(),
  businessScope: str({ alias: 'business_scope' })
})

// 合同交易类型（11 类）/ 交易模式（4 类）/ 合同状态。来源对齐 ironclaw 合同模型，
// 状态仅存可枚举的稳定态；「即将到期(expiring)」由前端按 end_date 动态派生，不入库。
export const MARKET_TYPES = [
  'annual_bilateral', 'annual_centralized', 'monthly_bilateral', 'monthly_centralized',
  'intraday_matching', 'day_ahead', 'real_time',
  'provincial_green_annual', 'provincial_green_monthly',
  'cross_provincial_green_annual', 'cross_provincial_green_monthly'
]
export const TRADE_MODES = ['bilateral', 'centralized', 'listing', 'matching']
export const CONTRACT_STATUSES = ['draft', 'active', 'expired', 'cancelled']

export const contractSchema = object({
  stationId: num({ alias: 'station_id' }),
  contractNo: str({ required: true, default: '未命名合同', alias: 'contract_no' }),
  contractName: str({ required: true, default: '未命名合同', alias: 'contract_name' }),
  marketType: enumOf(MARKET_TYPES, { default: 'annual_bilateral', alias: 'market_type' }),
  // 批零 owner 判据必须可持久化；旧行迁移后保持 NULL，仍按既有 marketType 规则分类。
  subjectType: str({ alias: 'subject_type' }),
  settlementRelation: str({ alias: 'settlement_relation' }),
  tradeMode: enumOf(TRADE_MODES, { default: 'bilateral', alias: 'trade_mode' }),
  startDate: str({ alias: 'start_date' }),
  endDate: str({ alias: 'end_date' }),
  totalQuantity: num({ alias: 'total_quantity' }),
  buyerName: str({ alias: 'buyer_name' }),
  sellerName: str({ alias: 'seller_name' }),
  buyerPrice: num({ alias: 'buyer_price' }),
  sellerPrice: num({ alias: 'seller_price' }),
  totalFee: num({ alias: 'total_fee' }),
  status: enumOf(CONTRACT_STATUSES, { default: 'draft' }),
  remarks: str()
})

export const contractDetailSchema = object({
  buyerName: str({ alias: 'buyer_name' }),
  sellerName: str({ alias: 'seller_name' }),
  dateRange: str({ alias: 'date_range' }),
  timeType: str({ alias: 'time_type' }),
  buyerQty: num({ alias: 'buyer_qty' }),
  sellerQty: num({ alias: 'seller_qty' }),
  buyerPrice: num({ alias: 'buyer_price' }),
  sellerPrice: num({ alias: 'seller_price' }),
  totalFee: num({ alias: 'total_fee' }),
  virtualHour: str({ alias: 'virtual_hour' })
})

export const companySchemas = { stationSchema, unitSchema, unitOutputSchema, tradeSchema, profileSchema, contractSchema, contractDetailSchema }
