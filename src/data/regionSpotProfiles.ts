// 地区现货量化档案：从“量化交易”视角刻画各地区现货市场特征 + 策略适配。
// 与 regions.ts（行政/电网/规则状态）、rules/（规则条款）解耦互补。
// 字段分两种可信度：fact=结构性事实(正常展示)，illustrative=特征示意(UI 加角标)。
import { getRegionById } from './regions'

export type DataConfidence = 'fact' | 'illustrative'
export type MarketStage = 'formal' | 'trial' | 'not-started' // 已转正式 / 试运行 / 未启动

export type PriceFormation = '节点电价' | '统一出清价' | '分区电价'
export type RenewableBidding = '报量报价' | '报量不报价' | '混合'
export type PriceShape = '鸭子曲线' | '双峰' | '丰枯主导' | '平稳'
export type Volatility = 'low' | 'mid' | 'high' | 'extreme'
export type DominantDriver = '火电边际' | '新能源出力' | '来水/丰枯' | '外购受电'

// 决策台输入用的主体画像类型
export type SubjectKind =
  | 'generator-thermal'
  | 'generator-renewable'
  | 'generator-hydro'
  | 'retailer'
  | 'storage'
  | 'trader'

export type RegionMechanism = {
  priceFormation: PriceFormation
  settlement: string
  granularity: string
  priceFloor: number // 元/MWh
  priceCap: number // 元/MWh
  allowsNegative: boolean
  renewableBidding: RenewableBidding
}

export type RegionPriceProfile = {
  // 24 点典型日内形态（示意，元/MWh）。仅表征“形状”，非实时价格。
  typicalDayCurve: number[]
  shape: PriceShape
  volatility: Volatility
  negativePriceFreq: number // 负价时段占比 0~1（示意）
  peakValleySpread: number // 峰谷价差 元/MWh（示意）
}

export type RegionGenerationMix = {
  coal: number
  hydro: number
  wind: number
  solar: number
  nuclear: number
  other: number
} // 百分比，合计 100

export type StrategyArchetype = {
  id: string
  title: string
  rationale: string
  keySignals: string[]
  // 适配评分用：对各主体类型的权重 0~1（缺省按低权重处理）
  fitWeights: Partial<Record<SubjectKind, number>>
  linkedRoutes: Array<{ title: string; path: string }>
}

export type RegionRiskParams = {
  suggestedVolBudget: number // 建议波动预算 元/MWh
  exposureLimitHint: string
  keyRisks: string[]
}

// 地区可校准的「交易口径参数」接缝（PR-4 框架）。
// 全部 optional：地区未填 → 量化算法仍用各自字面默认值（与历史一致，零行为变更）；
// 地区填了 → 由 view 层经 deriveRegionTradingParams 注入 quant.ts / tradingLab.ts
//   （这两个文件保持运行时自包含、不 import 地区数据，只接收带字面默认值的纯数字参数）。
// 设计意图：把散落在 quant/tradingLab 的硬编码「知识点」收成可按地区校准的同一接缝；
//   当前所有地区均不填，值待真实校准（basis 标注「待校准」）。
export type RegionTradingParams = {
  /** 峰谷套利识别的波动带倍数 σ（quant.detectPeakValleyArbitrage），默认 0.65 */
  peakValleySigma?: number
  /** 偏差考核罚比 %（未参数化结算规则的回退口径；已参数化省用 SettlementRuleSpec 权威考核价），默认 12 */
  deviationPenaltyPct?: number
  /** 策略置信度区间 [下限, 上限]（tradingLab），默认 [52, 92] */
  confidenceBounds?: [number, number]
  /** 储能 SOC 运行边界 % [下限, 上限]（tradingLab），默认 [12, 92] */
  socBounds?: [number, number]
  /** 风险等级判级阈值（tradingLab）：默认 { lowRiskReturn: 18, lowRiskConfidence: 74, midRiskReturn: 12 } */
  riskThresholds?: { lowRiskReturn: number; lowRiskConfidence: number; midRiskReturn: number }
}

export type RegionSpotProfile = {
  regionId: string
  marketStage: MarketStage
  mechanism: RegionMechanism
  priceProfile: RegionPriceProfile
  generationMix: RegionGenerationMix
  dominantDriver: DominantDriver
  strategyArchetypes: StrategyArchetype[]
  riskParams: RegionRiskParams
  // 交易口径可校准参数（PR-4 框架接缝）：当前各地区均不填 → 量化算法用字面默认值（零行为变更）。
  tradingParams?: RegionTradingParams
  references?: string[]
  dataSource: 'curated' | 'captured' // 画像来源：策划示意 / 真实采集（PR#21）
}

// 固定的工作台跳转，供各省策略原型复用。
const WORKBENCH_ROUTES: StrategyArchetype['linkedRoutes'] = [
  { title: '日前上报', path: '/xhjy/zrqsb' },
  { title: '申报工作台', path: '/xhjy/desk' }
]

// 已做深的省份（机制为结构性事实；价格画像/风险为特征示意；曲线表征“形状”，元/MWh）。
export const regionSpotProfiles: Record<string, RegionSpotProfile> = {
  shandong: {
    regionId: 'shandong',
    marketStage: 'formal',
    mechanism: {
      priceFormation: '统一出清价',
      settlement: '日前+实时双结算',
      granularity: '实时15min / 日前96点',
      priceFloor: -85,
      priceCap: 1300,
      allowsNegative: true,
      renewableBidding: '报量报价'
    },
    priceProfile: {
      typicalDayCurve: [320, 300, 285, 280, 290, 330, 410, 470, 430, 250, 60, -40, -60, -30, 120, 360, 520, 680, 760, 720, 600, 480, 410, 360],
      shape: '鸭子曲线',
      volatility: 'high',
      negativePriceFreq: 0.12,
      peakValleySpread: 700
    },
    generationMix: { coal: 65, hydro: 1, wind: 8, solar: 22, nuclear: 3, other: 1 },
    dominantDriver: '新能源出力',
    strategyArchetypes: [
      {
        id: 'pv-arb',
        title: '午间负价规避 + 储能日内套利',
        rationale: '山东光伏装机巨大，午间常态性负价；储能午充晚放在峰谷价差约 700 元/MWh 下套利空间显著。',
        keySignals: ['午间光伏出力', '负价时段长度', '储能可用容量', '日前-实时价差'],
        fitWeights: { storage: 1, 'generator-renewable': 0.9, trader: 0.7 },
        linkedRoutes: WORKBENCH_ROUTES
      },
      {
        id: 're-forecast-bid',
        title: '新能源出力预测驱动申报',
        rationale: '报量报价机制下，出力预测偏差直接放大偏差电费，预测质量是收益核心。',
        keySignals: ['新能源出力预测', '预测偏差', '日前申报曲线', '实时偏差电费'],
        fitWeights: { 'generator-renewable': 1, trader: 0.8 },
        linkedRoutes: WORKBENCH_ROUTES
      }
    ],
    riskParams: {
      suggestedVolBudget: 160,
      exposureLimitHint: '午间负价时段建议收紧现货净敞口，优先储能/可调负荷对冲',
      keyRisks: ['午间负价频发，无储能则现货敞口易亏损', '光伏出力预测偏差直接放大偏差电费']
    },
    references: ['山东电力现货市场交易规则'],
    dataSource: 'curated'
  },
  shanxi: {
    regionId: 'shanxi',
    marketStage: 'formal',
    mechanism: {
      priceFormation: '节点电价',
      settlement: '日前+实时双结算',
      granularity: '实时15min / 日前96点',
      priceFloor: -80,
      priceCap: 1500,
      allowsNegative: true,
      renewableBidding: '报量报价'
    },
    priceProfile: {
      typicalDayCurve: [260, 240, 230, 235, 260, 320, 460, 560, 540, 420, 320, 240, 180, 220, 300, 420, 560, 700, 760, 720, 600, 460, 360, 300],
      shape: '双峰',
      volatility: 'high',
      negativePriceFreq: 0.06,
      peakValleySpread: 550
    },
    generationMix: { coal: 80, hydro: 2, wind: 9, solar: 8, nuclear: 0, other: 1 },
    dominantDriver: '火电边际',
    strategyArchetypes: [
      {
        id: 'marginal-cost',
        title: '边际成本报价 + 煤价联动',
        rationale: '山西火电主导，节点电价下报价需紧盯煤价与机组边际成本及阻塞分区。',
        keySignals: ['煤价', '机组边际成本', '日前竞价空间', '负荷预测'],
        fitWeights: { 'generator-thermal': 1, trader: 0.8 },
        linkedRoutes: WORKBENCH_ROUTES
      },
      {
        id: 'peak-spread',
        title: '双峰峰谷套利',
        rationale: '早晚双峰、午间走低，峰谷价差约 550 元/MWh，适合储能/可调负荷跨时段套利。',
        keySignals: ['峰谷价差', '储能可用容量', '日内价格形态', '充放时段'],
        fitWeights: { storage: 0.9, trader: 0.8 },
        linkedRoutes: WORKBENCH_ROUTES
      }
    ],
    riskParams: {
      suggestedVolBudget: 160,
      exposureLimitHint: '节点电价下关注阻塞分区，分区敞口分别设限',
      keyRisks: ['节点电价下阻塞使分区价差扩大', '火电报价需紧盯煤价与机组边际成本']
    },
    references: ['山西电力现货市场运营规则'],
    dataSource: 'curated'
  },
  guangdong: {
    regionId: 'guangdong',
    marketStage: 'formal',
    mechanism: {
      priceFormation: '统一出清价',
      settlement: '日前+实时双结算',
      granularity: '15min / 96点',
      priceFloor: 0,
      priceCap: 1500,
      allowsNegative: false,
      renewableBidding: '报量报价'
    },
    priceProfile: {
      typicalDayCurve: [340, 320, 305, 300, 320, 370, 470, 560, 540, 480, 430, 400, 380, 400, 440, 500, 580, 660, 700, 680, 600, 520, 440, 380],
      shape: '双峰',
      volatility: 'mid',
      negativePriceFreq: 0,
      peakValleySpread: 450
    },
    generationMix: { coal: 45, hydro: 5, wind: 7, solar: 13, nuclear: 8, other: 22 },
    dominantDriver: '外购受电',
    strategyArchetypes: [
      {
        id: 'recv-curve',
        title: '受电曲线 + 跨省价差',
        rationale: '广东西电东送外购占比高，省内价格受受电曲线与省间价差牵动，需协同建模。',
        keySignals: ['西电东送受电曲线', '省间价差', '省内负荷', '峰段价格'],
        fitWeights: { retailer: 0.9, trader: 1 },
        linkedRoutes: WORKBENCH_ROUTES
      },
      {
        id: 'peak-spread',
        title: '峰谷套利',
        rationale: '不允许负价、波动适中，峰谷价差约 450 元/MWh，储能套利稳健但空间有限。',
        keySignals: ['峰谷价差', '储能可用容量', '日内价格形态', '充放时段'],
        fitWeights: { storage: 0.9, trader: 0.8 },
        linkedRoutes: WORKBENCH_ROUTES
      }
    ],
    riskParams: {
      suggestedVolBudget: 90,
      exposureLimitHint: '关注西电东送计划变化对省内价格的传导',
      keyRisks: ['西电东送受电曲线变化影响省内价格', '峰段尖峰价格波动需控制敞口']
    },
    references: ['南方（广东）电力现货市场交易实施细则'],
    dataSource: 'curated'
  },
  gansu: {
    regionId: 'gansu',
    marketStage: 'formal',
    mechanism: {
      priceFormation: '统一出清价',
      settlement: '日前+实时双结算',
      granularity: '15min / 96点',
      priceFloor: -75,
      priceCap: 1500,
      allowsNegative: true,
      renewableBidding: '报量报价'
    },
    priceProfile: {
      typicalDayCurve: [180, 150, 130, 120, 130, 200, 320, 380, 300, 120, -20, -60, -75, -50, 60, 280, 460, 640, 780, 740, 560, 400, 300, 220],
      shape: '鸭子曲线',
      volatility: 'extreme',
      negativePriceFreq: 0.10,
      peakValleySpread: 800
    },
    generationMix: { coal: 38, hydro: 8, wind: 35, solar: 16, nuclear: 0, other: 3 },
    dominantDriver: '新能源出力',
    strategyArchetypes: [
      {
        id: 'pv-arb',
        title: '午间负价规避 + 储能日内套利',
        rationale: '甘肃风光占比极高，午间负价与极端波动并存，峰谷价差约 800 元/MWh，储能套利价值居前。',
        keySignals: ['午间光伏出力', '负价时段长度', '储能可用容量', '日前-实时价差'],
        fitWeights: { storage: 1, 'generator-renewable': 0.9, trader: 0.7 },
        linkedRoutes: WORKBENCH_ROUTES
      },
      {
        id: 're-forecast-bid',
        title: '新能源出力预测驱动申报',
        rationale: '大规模风光下出力预测偏差是收益与偏差电费的主导因素。',
        keySignals: ['新能源出力预测', '预测偏差', '日前申报曲线', '实时偏差电费'],
        fitWeights: { 'generator-renewable': 1, trader: 0.8 },
        linkedRoutes: WORKBENCH_ROUTES
      }
    ],
    riskParams: {
      suggestedVolBudget: 220,
      exposureLimitHint: '极端波动地区，建议大幅收紧净敞口并强化储能对冲',
      keyRisks: ['极高波动+频繁负价，敞口风险全国居前', '大规模风光出力预测偏差冲击收益']
    },
    references: ['甘肃电力现货市场运营规则'],
    dataSource: 'curated'
  },
  sichuan: {
    regionId: 'sichuan',
    marketStage: 'trial',
    mechanism: {
      priceFormation: '统一出清价',
      settlement: '中长期为主 + 现货试结算',
      granularity: '15min / 96点',
      priceFloor: 0,
      priceCap: 1200,
      allowsNegative: false,
      renewableBidding: '报量不报价'
    },
    priceProfile: {
      typicalDayCurve: [300, 290, 285, 280, 285, 300, 340, 380, 390, 380, 360, 350, 345, 350, 360, 380, 410, 450, 470, 460, 430, 390, 350, 320],
      shape: '丰枯主导',
      volatility: 'mid',
      negativePriceFreq: 0.02,
      peakValleySpread: 300
    },
    generationMix: { coal: 8, hydro: 82, wind: 3, solar: 6, nuclear: 0, other: 1 },
    dominantDriver: '来水/丰枯',
    strategyArchetypes: [
      {
        id: 'hydro-season',
        title: '丰枯跨季套利 + 来水预测',
        rationale: '四川水电主导，丰枯季价差远大于日内，来水预测与跨季持仓是收益核心。',
        keySignals: ['来水预测', '丰枯期判断', '水库蓄能', '中长期持仓'],
        fitWeights: { 'generator-hydro': 1, trader: 0.8 },
        linkedRoutes: WORKBENCH_ROUTES
      },
      {
        id: 'flood-absorb',
        title: '汛期消纳与水库调度',
        rationale: '汛期来水集中、消纳受限，需结合水库调度与跨省送出安排申报。',
        keySignals: ['汛期来水', '水电消纳空间', '跨省送出边界', '弃水风险'],
        fitWeights: { 'generator-hydro': 1, retailer: 0.6 },
        linkedRoutes: WORKBENCH_ROUTES
      }
    ],
    riskParams: {
      suggestedVolBudget: 90,
      exposureLimitHint: '丰枯季持仓敞口分季设限，弱化日内套利',
      keyRisks: ['丰枯季价差远大于日内，跨季持仓是主风险', '水电报量不报价为价格接受者，受出清曲线影响大']
    },
    references: ['四川电力现货市场结算试运行方案'],
    dataSource: 'curated'
  },
  shaanxi: {
    regionId: 'shaanxi',
    marketStage: 'trial',
    mechanism: {
      priceFormation: '统一出清价',
      settlement: '日前+实时双结算（试运行）',
      granularity: '15min / 96点',
      priceFloor: -60,
      priceCap: 1500,
      allowsNegative: true,
      renewableBidding: '混合'
    },
    priceProfile: {
      typicalDayCurve: [280, 260, 250, 255, 275, 330, 440, 520, 500, 420, 350, 300, 280, 300, 360, 440, 540, 640, 690, 660, 560, 460, 380, 320],
      shape: '双峰',
      volatility: 'mid',
      negativePriceFreq: 0.03,
      peakValleySpread: 400
    },
    generationMix: { coal: 70, hydro: 3, wind: 14, solar: 11, nuclear: 0, other: 2 },
    dominantDriver: '火电边际',
    strategyArchetypes: [
      {
        id: 'marginal-cost',
        title: '边际成本报价 + 煤价联动',
        rationale: '陕西火电主导、新能源占比上升，试运行阶段报价需结合煤价与边际成本。',
        keySignals: ['煤价', '机组边际成本', '日前竞价空间', '负荷预测'],
        fitWeights: { 'generator-thermal': 1, trader: 0.8 },
        linkedRoutes: WORKBENCH_ROUTES
      },
      {
        id: 'peak-spread',
        title: '双峰峰谷套利',
        rationale: '双峰形态、峰谷价差约 400 元/MWh，储能/可调负荷可做稳健套利。',
        keySignals: ['峰谷价差', '储能可用容量', '日内价格形态', '充放时段'],
        fitWeights: { storage: 0.9, trader: 0.8 },
        linkedRoutes: WORKBENCH_ROUTES
      }
    ],
    riskParams: {
      suggestedVolBudget: 90,
      exposureLimitHint: '试运行阶段参数易调整，敞口与限额留足缓冲',
      keyRisks: ['现货处试运行，规则与参数可能调整', '火电边际+部分新能源，双峰时段敞口需关注']
    },
    references: ['陕西电力现货市场建设试运行方案'],
    dataSource: 'curated'
  },
  yunnan: {
    regionId: 'yunnan',
    marketStage: 'trial',
    mechanism: {
      priceFormation: '统一出清价',
      settlement: '南方区域联合出清 + 省内结算 + 中长期/现货偏差',
      granularity: '15min / 96点',
      priceFloor: 0,
      priceCap: 1500,
      allowsNegative: true,
      renewableBidding: '报量报价'
    },
    priceProfile: {
      typicalDayCurve: [280, 270, 265, 260, 265, 285, 330, 370, 380, 360, 330, 300, 280, 290, 320, 360, 400, 440, 460, 450, 420, 380, 340, 300],
      shape: '丰枯主导',
      volatility: 'mid',
      negativePriceFreq: 0.03,
      peakValleySpread: 350
    },
    generationMix: { coal: 5, hydro: 78, wind: 6, solar: 10, nuclear: 0, other: 1 },
    dominantDriver: '来水/丰枯',
    strategyArchetypes: [
      {
        id: 'hydro-season',
        title: '丰枯跨季套利 + 来水预测',
        rationale: '云南水电主导，丰枯季差异显著，来水预测与中长期合约曲线决定现货敞口。',
        keySignals: ['来水预测', '丰枯期判断', '水库蓄能', '中长期持仓'],
        fitWeights: { 'generator-hydro': 1, trader: 0.8 },
        linkedRoutes: WORKBENCH_ROUTES
      },
      {
        id: 'flood-absorb',
        title: '汛期消纳与水库调度',
        rationale: '汛期水电消纳压力大、跨省送出边界影响价格，可能出现低价甚至负价。',
        keySignals: ['汛期来水', '水电消纳空间', '跨省送出边界', '弃水风险'],
        fitWeights: { 'generator-hydro': 1, retailer: 0.6 },
        linkedRoutes: WORKBENCH_ROUTES
      }
    ],
    riskParams: {
      suggestedVolBudget: 90,
      exposureLimitHint: '汛期收紧低价/负价时段敞口，区分统一价与用户节点价口径',
      keyRisks: ['汛期水电消纳压力可能压低甚至负价', '统一价向用户节点价试点过渡，价格口径需区分']
    },
    references: ['云南电力市场现货电能量交易实施细则（征求意见稿）', '南方区域电力市场运行规则（2025年V1.0版）'],
    dataSource: 'curated'
  }
}

// 未做深省份：返回结构一致、marketStage='not-started' 的最小档，保证任意地区可渲染。
function buildNotStartedProfile(regionId: string): RegionSpotProfile {
  const region = getRegionById(regionId)
  return {
    regionId: region.id,
    marketStage: 'not-started',
    mechanism: {
      priceFormation: '统一出清价',
      settlement: '待按地区现货细则确定',
      granularity: '待定',
      priceFloor: 0,
      priceCap: 0,
      allowsNegative: false,
      renewableBidding: '混合'
    },
    priceProfile: {
      typicalDayCurve: [],
      shape: '平稳',
      volatility: 'low',
      negativePriceFreq: 0,
      peakValleySpread: 0
    },
    generationMix: { coal: 0, hydro: 0, wind: 0, solar: 0, nuclear: 0, other: 0 },
    dominantDriver: '火电边际',
    strategyArchetypes: [],
    riskParams: {
      suggestedVolBudget: 0,
      exposureLimitHint: '现货市场尚未启动，暂无量化敞口建议',
      keyRisks: ['该地区现货市场尚未启动或未接入专属规则']
    },
    references: [],
    dataSource: 'curated'
  }
}

export function getRegionSpotProfile(regionId: string): RegionSpotProfile {
  return regionSpotProfiles[regionId] ?? buildNotStartedProfile(regionId)
}

export function hasDeepSpotProfile(regionId: string): boolean {
  return Boolean(regionSpotProfiles[regionId])
}

export { WORKBENCH_ROUTES }
