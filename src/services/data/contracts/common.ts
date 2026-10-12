import type { MechanismProfile } from '@/services/region/mechanismProfile'
import type { DataSourceBasis, SourceType } from '../types'

export type ModuleContractBasis = Extract<DataSourceBasis, 'captured' | 'synthetic'>
export type ModuleAvailabilityStatus = 'real' | 'forecast' | 'mock' | 'missing'

export type ModuleAvailabilityItem = {
  key: string
  label: string
  status: ModuleAvailabilityStatus
  source: string | null
  note?: string
}

export type ModuleRegionMeta = {
  region_requested?: string
  region_served: string
  region_fallback: boolean
}

export type ModuleContractMeta = ModuleRegionMeta & {
  schema_version: 1
  basis: ModuleContractBasis
  sourceType: SourceType
  mock: boolean
  productionWrite: false
  data_availability: ModuleAvailabilityItem[]
  generated_at?: string
  /**
   * 市场机制画像（可选，Epic #1431 S2）：meta 的 basis/region 回答「数据真不真、哪个地区」，
   * mechanism 回答「这份数据是什么标的、什么粒度、da/rt 能不能分」，即消费方该怎么读。
   * 由 client 层注入（adapter 保持纯函数零运行时依赖）；存量契约不填即 undefined，零破坏。
   */
  mechanism?: MechanismProfile
}

export type QuarterHourMarket = 'da' | 'rt'

export type QuarterHourPoint<T = number | null> = {
  point: number
  time: string
  value: T
}

export type DailyAggregate = {
  date: string
  avg: number | null
  max: number | null
  min: number | null
  spread: number | null
  negativeSharePct: number | null
  points: number
}

export type ModuleEmptyState = {
  status: 'missing'
  reason: string
  source: string | null
}


/** AI 页解读上下文的口径归一（slim-and-fix-market-insight-pages R4）：
 *  real/captured → captured，其余取值（provisional/illustrative/empty/user_saved/缺失）保守按
 *  synthetic——宁严勿谎，后端按地区合成的口径不得被 AI 上下文当成真实采集。 */
export function normalizeContractBasis(basis?: string): 'captured' | 'synthetic' {
  return basis === 'real' || basis === 'captured' ? 'captured' : 'synthetic'
}
