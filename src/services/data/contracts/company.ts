import type {
  CompanyContract as CompanyCanonicalContract,
  CompanyProfile,
  CompanyStation,
  CompanyTrade,
  CompanyUnitOutput
} from '@/services/company/companyApi'
import type { ModuleContractMeta } from './common'

/**
 * Adapter 输入源注释：
 * - Canonical：公司经营统一以 `/api/company/*` 为权威入口，复用 companyApi 导出类型。
 * - 山西：`sdpt_zkhda`、`sdpt_zkhsd`、`sdpt_zsdszmx` 等旧 family 只能经 adapter
 *   写入 canonical 或映射为只读视图，页面不得直接依赖原始形状。
 * - 云南：`yn_plant_output`、`yn_spot_settlement`、`yn_loss_attribution`、合同/客户台账
 *   进入 canonical 或 company 私有族；公司归属以服务端 token 授权为准。
 */

export type CompanyRegionDimension = {
  regionId: string
  regionName: string
  gridScope?: string
}

export type CompanyGenerationDimension = {
  station: CompanyStation
  output: CompanyUnitOutput[]
}

export type CompanyCanonicalCollection<TKind extends string> = {
  canonical: `/api/company/${TKind}`
  rows: unknown[]
  note?: string
}

export type CompanyOperationContract = ModuleContractMeta & {
  group: 'company'
  company: CompanyProfile | null
  regions: CompanyRegionDimension[]
  stations: CompanyStation[]
  contracts: CompanyCanonicalContract[]
  generation: CompanyGenerationDimension[]
  trades: CompanyTrade[]
  settlements: CompanyCanonicalCollection<'settlements'>
  customerPackages: CompanyCanonicalCollection<'customer-packages'>
}
