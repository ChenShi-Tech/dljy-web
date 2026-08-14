import type { RegionRuleProfile, SubjectRuleFocus } from '../types'

export const southernGridGenericFocus: SubjectRuleFocus = {
  roleCodes: ['BOSS', 'TRADE_LEAD', 'TRADER', 'RISK', 'QUANT', 'SETTLEMENT', 'PLANT_OPERATOR', 'RETAIL_MANAGER', 'STORAGE_OPERATOR', 'ADMIN'],
  subjectTypes: ['GROUP', 'GENERATOR', 'RETAILER', 'STORAGE', 'LOAD', 'TRADER'],
  title: '南方区域通用关注',
  summary: '先按南方区域联合出清、省内结算、跨省衔接的通用框架识别规则边界，再进入具体省区做参数和结算细化。',
  keyConcerns: ['跨省与省内市场有序衔接', '日前与实时现货联合出清', '中长期合约与现货偏差结算', '跨省送受电曲线和省内边界条件'],
  recommendedRoutes: [
    { title: '地区规则体系', path: '/sdzl/region-rules', reason: '查看当前地区规则边界和资料效力' },
    { title: '申报工作台', path: '/xhjy/desk', reason: '承接日前、实时和风险决策链路' },
    { title: '售电电价测算', path: '/djcs/retail-price', reason: '评估用户侧价格和零售套餐传导' }
  ],
  riskWarnings: ['南方区域通用版不能替代具体省区细则', '用户侧价格、限价参数和分摊返还科目必须以省区方案为准'],
  ruleReferences: ['南方区域电力市场运行规则（试行，2025年V1.0版）']
}

export const southernGridCommonRuleProfile: RegionRuleProfile = {
  regionId: 'generic-csg',
  gridOperator: 'china-southern-grid',
  marketStage: '通用模板',
  marketArchitecture: {
    title: '南方区域通用架构',
    summary: '南方区域市场以跨省与省（区）内中长期交易独立开展、有序衔接，现货电能量交易联合出清、协同运作为核心。',
    items: ['跨省与省内交易协同', '日前与实时现货联合出清', '省级交易机构承接省内结算', '跨省送受电曲线作为重要边界条件']
  },
  documents: [
    {
      title: '南方区域电力市场运行规则（试行，2025年V1.0版）',
      issuer: '南方能源监管局、云南能源监管办、贵州能源监管办',
      publishedAt: '2025-06-17',
      status: 'official',
      url: 'https://nfj.nea.gov.cn/xwzx/tzgg/202506/P020250625360641274024.pdf'
    }
  ],
  participants: [
    { title: '通用主体', summary: '覆盖发电企业、售电公司、电力用户、电网企业、交易机构、调度机构和新型主体。', items: ['发电企业和机组', '售电公司与批发用户', '独立储能、虚拟电厂、需求响应资源', '广州电力交易中心与省级交易机构'] }
  ],
  tradingProducts: [
    { title: '通用交易品种', summary: '以中长期、日前、实时和辅助服务协同为主。', items: ['跨省中长期交易', '省内中长期交易', '日前电能量交易', '实时电能量交易', '辅助服务市场'] }
  ],
  clearingTimeline: [
    { title: '通用出清时序', summary: '现货初期包括日前和实时两个核心环节。', items: ['D-1开展日前申报和出清', '实时阶段滚动修正运行边界', '跨省与省内约束共同进入优化', '出清结果推送交易结算'] }
  ],
  pricingModel: [
    { title: '通用价格机制', summary: '区域现货以节点边际电价或统一结算点电价作为核心价格信号，省区细则决定用户侧应用方式。', items: ['发电侧一般关注节点电价', '用户侧可能采用统一结算点或节点价格', '跨省结算需处理送受电价格衔接', '阻塞和不平衡资金分类疏导'] }
  ],
  settlementModel: [
    { title: '通用结算模型', summary: '中长期合约、日前、实时和分摊返还项目分别记录，不设置笼统不平衡资金池。', items: ['中长期合约电费', '日前电能量或偏差电费', '实时偏差电费', '跨省不平衡和分摊返还', '辅助服务费用'] }
  ],
  riskControls: [
    { title: '通用风险控制', summary: '各省区需结合区域规则和本省方案设置市场干预、价格限值和异常结算机制。', items: ['价格限值', '市场干预', '不平衡资金分类疏导', '交易与结算数据校验', '规则版本变更跟踪'] }
  ],
  disclosureRules: [
    { title: '通用信息披露', summary: '按公众信息、市场成员公开信息、私有信息和依申请披露信息分层。', items: ['交易公告和市场参数', '边界条件和出清结果', '结算依据和分摊返还', '市场干预和暂停重启情况'] }
  ],
  subjectFocus: [southernGridGenericFocus],
  developmentStatus: {
    title: '开发状态',
    summary: '南网通用版用于承接广东、广西、云南、贵州、海南的共性能力，不能作为具体省区最终规则。',
    items: ['已可作为地区切换后的通用兜底', '后续逐省补充现货参数、结算公式和数据适配器']
  }
}
