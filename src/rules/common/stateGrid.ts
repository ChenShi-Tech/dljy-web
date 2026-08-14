import type { RegionRuleProfile, SubjectRuleFocus } from '../types'

export const stateGridGenericFocus: SubjectRuleFocus = {
  roleCodes: ['BOSS', 'ADMIN', 'TRADE_LEAD', 'TRADER', 'RISK', 'QUANT', 'SETTLEMENT', 'PLANT_OPERATOR', 'RETAIL_MANAGER', 'STORAGE_OPERATOR'],
  subjectTypes: ['GROUP', 'GENERATOR', 'RETAILER', 'STORAGE', 'LOAD', 'TRADER'],
  title: '国网通用版：省级现货规则待映射',
  summary: '用于国网经营区省份的通用交易底座。具体省份仍需按当地现货细则配置报价、出清、价格、结算和风险参数。',
  keyConcerns: ['省级现货规则差异', '中长期曲线衔接', '日前/实时偏差结算', '用户侧价格口径', '分摊返还和不平衡资金'],
  recommendedRoutes: [
    { title: '当前地区交易', path: '/xhjy/region', reason: '查看当前地区专属模块或建设中状态' },
    { title: '地区规则体系', path: '/sdzl/region-rules', reason: '查看当前地区规则画像和资料效力' },
    { title: '现货交易驾驶舱', path: '/dashboard', reason: '进入通用现货分析入口' }
  ],
  riskWarnings: ['国网通用版不能替代各省正式细则', '未定制地区不得复用云南南网结算模型', '涉及交易申报和结算计算时必须确认当前地区规则版本'],
  ruleReferences: ['电力现货市场基本规则通用框架', '各省电力市场运营规则和结算细则待接入']
}

export const stateGridCommonRuleProfile: RegionRuleProfile = {
  regionId: 'generic-sgcc',
  gridOperator: 'state-grid',
  marketStage: '国网经营区通用模板',
  documents: [],
  marketArchitecture: {
    title: '国网通用现货架构',
    summary: '面向国家电网经营区省份的通用规则底座，用来承接各省中长期、日前、实时、辅助服务和零售结算差异化配置。',
    items: ['省级市场组织', '中长期合约曲线衔接', '日前和实时现货出清', '省间交易和辅助服务衔接']
  },
  participants: [
    { title: '市场主体', summary: '按省级规则确认发电企业、售电公司、批发用户、新型主体和电网企业参与边界。', items: ['发电企业', '售电公司', '批发用户', '独立储能', '虚拟电厂', '市场运营机构'] }
  ],
  tradingProducts: [
    { title: '中长期交易', summary: '作为风险对冲基础，需要按省份规则分解到分时曲线。', items: ['年度/月度交易', '周交易和日交易', '双边协商', '集中竞价', '挂牌交易'] },
    { title: '现货交易', summary: '通用模板保留日前和实时两级现货结构，具体申报窗口和出清粒度由省级细则确定。', items: ['日前申报', '日前出清', '实时出清', '出清结果发布'] },
    { title: '辅助服务', summary: '调频、备用、爬坡、需求响应等收益和成本需按省级规则独立配置。', items: ['调频', '备用', '需求响应', '辅助服务分摊'] }
  ],
  clearingTimeline: [
    { title: '交易时序', summary: '各省申报、边界发布、出清和复核节点不同，需在地区模块中单独配置。', items: ['D-1申报', '日前出清', '实时滚动', '日清分', '月结算'] }
  ],
  pricingModel: [
    { title: '价格机制', summary: '国网省份可能采用节点电价、分区电价、统一结算点电价或过渡口径。', items: ['发电侧价格口径待映射', '用户侧价格口径待映射', '限价参数待映射', '分时电价政策待映射'] }
  ],
  settlementModel: [
    { title: '结算模型', summary: '保留中长期合约、日前偏差、实时偏差、分摊返还和不平衡资金的通用科目。', items: ['中长期合约电费', '日前偏差电费', '实时偏差电费', '分摊返还', '不平衡资金'] }
  ],
  riskControls: [
    { title: '风险控制', summary: '各省规则对限价、熔断、市场力检测、异常结算和试运行损益控制差异较大。', items: ['价格上下限', '熔断机制', '市场力检测', '异常盈亏', '规则效力核验'] }
  ],
  disclosureRules: [
    { title: '信息披露', summary: '信息披露范围、频率和权限应按各省交易中心规则配置。', items: ['市场公告', '边界条件', '出清结果', '结算结果', '异常处置'] }
  ],
  subjectFocus: [stateGridGenericFocus],
  developmentStatus: {
    title: '开发状态',
    summary: '国网通用版作为侧边栏长期固定入口，用于承接国网省份后续逐省定制。',
    items: ['山西、陕西、新疆等地区按同一接口扩展', '未定制地区显示建设中', '不复用云南南网专属结算逻辑']
  }
}
