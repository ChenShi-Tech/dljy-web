/**
 * 多省现货结算口径参数表（按省 / 按年参数化，禁止在公式或视图里硬编码）
 *
 * 定位：settlementFormula.ts 只做数学，价格口径开关、限价、免考核带、容量电价等
 * 「随省 / 随规则版本变化」的参数集中在此，由 reportEngine 按当前地区注入计算入参。
 *
 * 与地区规则的关系：regionId 与 src/data/regions.ts 的 RegionProfile.id 一一对应；
 * regions.ts 给出 RegionRuleSet（市场范围 / 成熟度 / 交易模式），本表给出可计算的结算数值参数。
 *
 * 数据可信度护栏（重要）：各省限价版本迭代频繁（山东 2025 版、山西 V14/V15），
 * 广东现货结算细则为「征求意见稿」，偏差免考核带各省差异且部分未公开。因此：
 *   - 每条规则都带 version / asOf / source / maturity 元数据；
 *   - 未经省级正式细则核实的字段在 notes 标注「待核」，UI 用 DataBasisBadge 显示成熟度；
 *   - 命中失败时回退到对应电网通用底座（generic-sgcc / generic-csg）并标注 fallback。
 */

import { regionGridOperator } from 'shared/region/constants.mjs'

/** 结算价口径：节点电价 LMP / 统一结算点电价 / 分区电价。 */
export type SettlementPriceBasis = 'nodal' | 'unified' | 'zonal'

export type RegionSettlementRule = {
  regionId: string
  label: string
  // 限价（元/MWh；null 表示该省该项未公开 / 不适用）
  declaredPriceFloor: number | null
  declaredPriceCap: number | null
  clearingPriceFloor: number | null
  clearingPriceCap: number | null
  // 结算价口径开关
  /** 发电侧结算价口径（多数节点市场为 nodal） */
  generatorPriceBasis: SettlementPriceBasis
  /** 用户侧结算价口径（多数为 unified 统一结算点价） */
  userPriceBasis: SettlementPriceBasis
  /** 中长期空间价值口径（广东「合约阻塞电费」≈ 山东「节点−参考点价差」，同机制不同表述） */
  mlSpaceValueModel: string
  // 偏差与退补
  /** 偏差免考核带（比例，如 0.03 表示 ±3%）；多数省 3%~5%，部分未公开 */
  deviationTolerance: number
  /** 退补差错免考核阈值（如 0.02） */
  reconciliationTolerancePct: number
  /** 退补追溯月数上限 */
  reconciliationLookbackMonths: number
  // 容量电价（元/kW·年；null 表示执行国家煤电统一标准）
  capacityPriceYuanPerKwYear: number | null
  // 可信度护栏元数据
  version: string
  /** 数据时点 YYYY-MM */
  asOf: string
  source: string
  maturity: 'generic' | 'draft' | 'trial' | 'active' | 'to-be-customized'
  notes: string[]
}

/** 煤电容量电价全国统一标准：每年每千瓦 330 元（发改价格〔2023〕1501号）。 */
export const CAPACITY_PRICE_NATIONAL_YUAN_PER_KW_YEAR = 330

/**
 * 容量电价回收比例（全国口径，按年）：2024–2025 约 30%，2026 年起 ≥50%。
 * 各省可上浮，省级细则覆盖时以省值为准。
 */
export function getCapacityRecoveryRatio(year: number): number {
  if (year >= 2026) return 0.5
  if (year >= 2024) return 0.3
  return 0.3
}

// 通用底座：命中失败时回退，参数保守、明确标注待定制。
const sgccGeneric: RegionSettlementRule = {
  regionId: 'generic-sgcc',
  label: '国网通用现货结算底座',
  declaredPriceFloor: 0,
  declaredPriceCap: 1500,
  clearingPriceFloor: 0,
  clearingPriceCap: 1500,
  generatorPriceBasis: 'unified',
  userPriceBasis: 'unified',
  mlSpaceValueModel: '计入现货综合价（通用占位，待省级细则区分）',
  deviationTolerance: 0.03,
  reconciliationTolerancePct: 0.02,
  reconciliationLookbackMonths: 12,
  capacityPriceYuanPerKwYear: null,
  version: 'generic-2024',
  asOf: '2024-07',
  source: '电力现货市场基本规则(试行) 发改能源规〔2023〕1217号',
  maturity: 'generic',
  notes: ['通用底座参数为保守占位，接入具体省份请覆盖限价、价格口径与免考核带']
}

const csgGeneric: RegionSettlementRule = {
  ...sgccGeneric,
  regionId: 'generic-csg',
  label: '南网通用现货结算底座',
  mlSpaceValueModel: '区域联合出清 + 省内结算（通用占位）',
  source: '南方区域电力市场规则体系（通用占位）',
  notes: ['南方区域联合出清 + 省内结算，具体参数按省内细则覆盖']
}

/** 各省结算参数（仅收录已开展现货且口径相对明确的省份，其余回退通用底座）。 */
export const regionSettlementRules: Record<string, RegionSettlementRule> = {
  shandong: {
    regionId: 'shandong',
    label: '山东电力现货结算口径',
    declaredPriceFloor: -80,
    declaredPriceCap: 1300,
    clearingPriceFloor: -100,
    clearingPriceCap: 1500,
    generatorPriceBasis: 'nodal',
    userPriceBasis: 'unified',
    mlSpaceValueModel: '合约电量结算节点−参考点价差',
    deviationTolerance: 0.03,
    reconciliationTolerancePct: 0.02,
    reconciliationLookbackMonths: 12,
    capacityPriceYuanPerKwYear: null,
    version: '2025版',
    asOf: '2025-01',
    source: '山东电力现货市场交易规则/结算实施细则（编制说明）',
    maturity: 'active',
    notes: ['限价版本迭代频繁，落库前核对当期生效版本号', '山东建立市场化容量补偿机制（独立储能可获补偿）']
  },
  shanxi: {
    regionId: 'shanxi',
    label: '山西电力现货结算口径',
    declaredPriceFloor: 0,
    declaredPriceCap: 1500,
    clearingPriceFloor: 0,
    clearingPriceCap: 1500,
    generatorPriceBasis: 'nodal',
    userPriceBasis: 'unified',
    mlSpaceValueModel: '节点边际电价偏差结算',
    deviationTolerance: 0.03,
    reconciliationTolerancePct: 0.02,
    reconciliationLookbackMonths: 12,
    capacityPriceYuanPerKwYear: null,
    version: 'V14.0',
    asOf: '2024-12',
    source: '山西电力现货市场运营规则 V14（15 分钟出清周期）',
    maturity: 'trial',
    notes: ['火电报量报价 3–10 段，用户报量不报价', '限价以 V14/V15 当期版本为准（待核）']
  },
  guangdong: {
    regionId: 'guangdong',
    label: '广东电力现货结算口径',
    declaredPriceFloor: 0,
    declaredPriceCap: 1500,
    clearingPriceFloor: 0,
    clearingPriceCap: 3000,
    generatorPriceBasis: 'nodal',
    userPriceBasis: 'unified',
    mlSpaceValueModel: '中长期合约阻塞电费 = Σ Q净合约·(P日前节点 − P日前统一)',
    deviationTolerance: 0.02,
    reconciliationTolerancePct: 0.02,
    reconciliationLookbackMonths: 12,
    capacityPriceYuanPerKwYear: null,
    version: '征求意见稿',
    asOf: '2024-06',
    source: '广东电力市场现货结算实施细则（征求意见稿）',
    maturity: 'draft',
    notes: ['细则为征求意见稿，正式版可能微调', '“七分区/下限−100”未证实，已证实报价上限1500、出清0~3000', '单独《容量补偿办法》']
  },
  gansu: {
    regionId: 'gansu',
    label: '甘肃电力现货结算口径',
    declaredPriceFloor: 0,
    declaredPriceCap: 1500,
    clearingPriceFloor: 0,
    clearingPriceCap: 1500,
    generatorPriceBasis: 'nodal',
    userPriceBasis: 'unified',
    mlSpaceValueModel: '节点边际电价（15 分钟）偏差结算',
    deviationTolerance: 0.03,
    reconciliationTolerancePct: 0.02,
    reconciliationLookbackMonths: 12,
    capacityPriceYuanPerKwYear: null,
    version: '2024转正',
    asOf: '2024-09',
    source: '甘肃电力现货市场规则（2024-09 正式运行）',
    maturity: 'active',
    notes: ['全国唯一用户报量报价、首个新能源报量报价', '节点价超限按市场限价结算（限价数值待核）']
  },
  'inner-mongolia': {
    regionId: 'inner-mongolia',
    label: '蒙西电力现货结算口径',
    declaredPriceFloor: 0,
    declaredPriceCap: 1710,
    clearingPriceFloor: 0,
    clearingPriceCap: 1710,
    generatorPriceBasis: 'nodal',
    userPriceBasis: 'zonal',
    mlSpaceValueModel: '节点电价 + 用户侧分区价',
    deviationTolerance: 0.03,
    reconciliationTolerancePct: 0.02,
    reconciliationLookbackMonths: 12,
    capacityPriceYuanPerKwYear: null,
    version: '2025转正',
    asOf: '2025-02',
    source: '蒙西电力现货市场规则（2025-02 正式运行）',
    maturity: 'active',
    notes: ['全电量、发用双侧报量报价', '发电侧实测最高约 1710（经验值，非正式限价）']
  },
  zhejiang: {
    regionId: 'zhejiang',
    label: '浙江电力现货结算口径',
    declaredPriceFloor: -200,
    declaredPriceCap: 800,
    clearingPriceFloor: -200,
    clearingPriceCap: 1200,
    generatorPriceBasis: 'unified',
    userPriceBasis: 'unified',
    mlSpaceValueModel: '统一出清价 + 双重限价（燃煤成本控涨）',
    deviationTolerance: 0.03,
    reconciliationTolerancePct: 0.02,
    reconciliationLookbackMonths: 12,
    capacityPriceYuanPerKwYear: null,
    version: '2025转正',
    asOf: '2025-08',
    source: '浙江电力现货市场结算实施细则（2025-08 正式运行，长三角首个）',
    maturity: 'active',
    notes: ['集中式 + 双边现货', '一级限价申报−200~800、结算−200~1200；二级按燃煤成本控涨']
  },
  yunnan: {
    regionId: 'yunnan',
    label: '云南电力现货结算口径',
    declaredPriceFloor: 0,
    declaredPriceCap: 1500,
    clearingPriceFloor: 0,
    clearingPriceCap: 1500,
    generatorPriceBasis: 'nodal',
    userPriceBasis: 'unified',
    mlSpaceValueModel: '南方区域联合出清 + 云南省内结算 + 中长期/现货偏差结算',
    deviationTolerance: 0.03,
    reconciliationTolerancePct: 0.02,
    reconciliationLookbackMonths: 12,
    capacityPriceYuanPerKwYear: null,
    version: '试运行',
    asOf: '2025-06',
    source: '云南电力现货市场试运行方案（南网）',
    maturity: 'trial',
    notes: ['跨省与省内两级联合出清', '现货电能量/结算/披露细则待补，限价为通用占位（待核）']
  }
}

/**
 * 电网运营商词汇归一：仓内并存两套 ID，`src/data/regions.ts` 用
 * `state-grid/china-southern-grid`，`shared/region/constants.mjs` 用 `sgcc/csg`。
 * 两套都接受；蒙西（mengxi）/特殊区（other）不落国网/南网底座，返回 null 交调用方保守处理。
 */
export function normalizeGridOperatorToken(token?: string | null): 'csg' | 'sgcc' | null {
  if (!token) return null
  const value = String(token).toLowerCase()
  if (value === 'csg' || value === 'china-southern-grid') return 'csg'
  if (value === 'sgcc' || value === 'state-grid') return 'sgcc'
  return null
}

/**
 * 取地区结算规则。命中省份返回其规则；否则按电网回退到通用底座，并在返回对象 notes 标注 fallback。
 * 未显式传 gridOperator 时按 REGION_GRID_OPERATOR 从 regionId 推导（此前广西/贵州/海南等
 * 未收录南网省份会因调用方不传 operator 而误落国网底座）；两者都无法判定时保守回退国网通用底座。
 * @param regionId 与 src/data/regions.ts 的 RegionProfile.id 一致
 * @param gridOperator 可选，`csg|sgcc|china-southern-grid|state-grid` 均可
 */
export function getRegionSettlementRule(
  regionId: string,
  gridOperator?: 'state-grid' | 'china-southern-grid' | 'csg' | 'sgcc' | string
): RegionSettlementRule {
  const hit = regionSettlementRules[regionId]
  if (hit) return hit
  const operator =
    normalizeGridOperatorToken(gridOperator) ?? normalizeGridOperatorToken(regionGridOperator(regionId))
  const base = operator === 'csg' ? csgGeneric : sgccGeneric
  return {
    ...base,
    regionId,
    notes: [...base.notes, `未收录 ${regionId} 的专属结算口径，已回退通用底座（fallback）`]
  }
}

/** 成熟度中文标签，UI 角标用。 */
export function getMaturityLabel(maturity: RegionSettlementRule['maturity']): string {
  const labels: Record<RegionSettlementRule['maturity'], string> = {
    generic: '通用模板',
    draft: '草案',
    trial: '试运行',
    active: '运行中',
    'to-be-customized': '待定制'
  }
  return labels[maturity]
}

/** 已收录专属结算口径的地区数（其余回退通用底座）。 */
export function getSettlementRuleCoverage() {
  const ids = Object.keys(regionSettlementRules)
  return {
    coveredCount: ids.length,
    activeCount: ids.filter((id) => regionSettlementRules[id].maturity === 'active').length,
    trialCount: ids.filter((id) => regionSettlementRules[id].maturity === 'trial').length,
    coveredRegionIds: ids
  }
}
