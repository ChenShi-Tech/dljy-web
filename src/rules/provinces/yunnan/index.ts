import type { RegionRuleProfile, SubjectRuleFocus } from '../../types'

const sourceBase = 'D:\\OneDrive\\Document\\文档\\现货交易\\云南电力现货交易规则调研\\资料原文'

export const yunnanSubjectFocus: SubjectRuleFocus[] = [
  {
    roleCodes: ['RETAIL_MANAGER'],
    subjectTypes: ['RETAILER', 'LOAD'],
    title: '售电公司：用户侧价格与偏差结算优先',
    summary: '云南售电侧首要关注用户侧统一结算价、节点电价试点、客户负荷曲线、偏差费用和零售套餐倒挂风险。',
    keyConcerns: ['日前/实时用户侧统一结算价', '用户节点电价结算机制试点', '客户96点负荷曲线申报质量', '中长期合约曲线覆盖率', '市场化用户分时电价政策变化'],
    recommendedRoutes: [
      { title: '售电经营工作台', path: '/xhjy/yunnan/retail', reason: '查看云南客户、套餐和毛利风险' },
      { title: '结算模拟器', path: '/xhjy/yunnan/settlement', reason: '拆解中长期、日前、实时和分摊返还' },
      { title: '日前电量预估', path: '/xhjy/zptqx', reason: '校验客户负荷曲线和日前申报偏差' },
      { title: '分时行情', path: '/sjfx/fshq', reason: '跟踪分时价格曲线和现货价差' }
    ],
    riskWarnings: ['用户侧价格机制处于统一结算价向节点电价过渡阶段', '零售合同若不传导偏差费用，容易形成套餐倒挂', '2025连续结算报审稿属于行业转载资料，不能直接作为执行依据'],
    ruleReferences: ['云南电力市场结算实施细则（征求意见稿）', '云南用户节点电价结算机制试点动态', '市场化用户分时电价调整动态']
  },
  {
    roleCodes: ['TRADER', 'TRADE_LEAD'],
    subjectTypes: ['TRADER'],
    title: '交易组合：日前申报与合约敞口优先',
    summary: '云南交易侧需要把中长期合约曲线、日前96点申报、实时偏差和南方区域跨省边界放在同一个交易视图内。',
    keyConcerns: ['D-1日前申报', '96点曲线完整性', '发电侧与用户侧申报差异', '中长期净合约敞口', '实时偏差电费和跨省送电边界'],
    recommendedRoutes: [
      { title: '量化策略实验室', path: '/xhjy/yunnan/quant', reason: '回测云南合约覆盖和日前偏置' },
      { title: '日前上报', path: '/xhjy/zrqsb', reason: '形成或复核日前申报曲线' },
      { title: '申报工作台', path: '/xhjy/desk', reason: '把预测、风险和申报建议串联起来' }
    ],
    riskWarnings: ['日前价格和实时价格分开结算，不能只看单一均价', '中长期合约曲线不足会放大实时偏差暴露', '云南水电和跨省送出边界会影响节点价和阻塞'],
    ruleReferences: ['云南电力市场现货电能量交易实施细则（征求意见稿）', '云南电力市场中长期电能量交易实施细则（征求意见稿）', '南方区域电力市场运行规则（2025年V1.0版）']
  },
  {
    roleCodes: ['PLANT_OPERATOR'],
    subjectTypes: ['GENERATOR'],
    title: '发电侧：报价方式、节点价与运行补偿优先',
    summary: '云南发电侧要区分调节性能较好的水电报量报价、其他水电/风光起步阶段报量不报价，并重点跟踪节点电价、阻塞和运行补偿。',
    keyConcerns: ['水电梯级和水库调度约束', '报量报价与报量不报价边界', '日前/实时出清曲线', '发电侧节点电价', '运行补偿、启动费用和阻塞相关电费'],
    recommendedRoutes: [
      { title: '出清现货电量分析', path: '/sjfx/zcqxhdl', reason: '分析日前/实时出清电量变化' },
      { title: '新能源资产测算', path: '/tzcs/wind-solar', reason: '评估风光资产在云南现货下的收益空间' }
    ],
    riskWarnings: ['报量不报价主体作为价格接受者，收益受节点价和出清曲线影响较大', '汛期水电消纳和跨省送出边界会改变阻塞与价格信号', '机组运行参数变化需按调度审核流程更新'],
    ruleReferences: ['云南电力市场现货电能量交易实施细则（征求意见稿）', '汛期水电参与区域现货市场官方动态', '南方区域运行规则特殊机组条款']
  },
  {
    roleCodes: ['RISK'],
    subjectTypes: ['GROUP', 'TRADER'],
    title: '风控：熔断、限价与规则效力优先',
    summary: '风控侧重点识别试运行阶段熔断、损益风险防控、市场力检测和规则版本效力，避免把待核验资料误当执行规则。',
    keyConcerns: ['价格上下限', '市场力检测与缓解', '现货结算损益风险防控', '熔断与切回中长期结算', '规则版本和资料效力'],
    recommendedRoutes: [
      { title: '风控阈值面板', path: '/xhjy/risk-center', reason: '复核策略风险和限额暴露' },
      { title: 'ML 预测工作台', path: '/ycsj/workbench', reason: '评估预测偏差导致的风险传导' },
      { title: '运营中枢', path: '/yygl/ops', reason: '查看风险台账和异常处置' }
    ],
    riskWarnings: ['2023四项省内细则为征求意见稿，正式版本需持续核验', '2024试运行参数不应无条件沿用到连续结算阶段', '异常情况下可能不进行现货商业结算'],
    ruleReferences: ['2024年一季度短周期结算试运行方案', '电力现货市场基本规则（试行）', '云南规则体系修订动态']
  },
  {
    roleCodes: ['QUANT'],
    subjectTypes: ['TRADER'],
    title: '量化：预测因子与价格口径优先',
    summary: '量化侧要把水电、新能源、负荷、跨省送出、节点价/统一价口径差异纳入特征和回测条件。',
    keyConcerns: ['统调负荷预测', '新能源出力预测', '水电水库约束', '节点电价与统一结算价差异', '日前/实时价差和偏差成本'],
    recommendedRoutes: [
      { title: 'ML 预测工作台', path: '/ycsj/workbench', reason: '管理价格、负荷和新能源预测模型' },
      // dljy#3390：旧「价格与新能源关系」「价格与统调负荷关系」两页合并为价格驱动分析。
      { title: '价格驱动分析', path: '/sjfx/price-drivers', reason: '观察新能源出力与统调负荷对价格的影响' }
    ],
    riskWarnings: ['统一结算价和节点价不能混作同一训练标签', '云南水电主导特性会让通用国网省份模型失真', '行业转载连续结算参数不能直接固化到模型'],
    ruleReferences: ['云南现货电能量交易实施细则（征求意见稿）', '云南电力现货市场运行情况分析官方动态']
  },
  {
    roleCodes: ['SETTLEMENT'],
    subjectTypes: ['GROUP', 'RETAILER'],
    title: '结算：偏差、不平衡与分摊返还优先',
    summary: '结算侧需要把中长期合约、日前偏差、实时偏差、辅助服务、阻塞盈余和不平衡资金分项核对。',
    keyConcerns: ['中长期合约电费', '日前市场偏差电费', '实时市场偏差电费', '分摊返还科目', '市场不平衡资金', '日清分和月结算确认'],
    recommendedRoutes: [
      { title: '结算模拟器', path: '/xhjy/yunnan/settlement', reason: '总览云南结算科目和对账口径' },
      { title: '数据导入融合台', path: '/yygl/import-hub', reason: '导入结算、交易和客户曲线数据' },
      { title: '售电电价测算', path: '/djcs/retail-price', reason: '复核零售侧费用传导和套餐结算' }
    ],
    riskWarnings: ['日前和实时不平衡资金需分开记录', '分时计量缺失时需使用拟合数据并留痕', '试运行阶段部分分摊返还科目可能按方案压缩或调整'],
    ruleReferences: ['云南电力市场结算实施细则（征求意见稿）', '云南计量和结算实施细则修订动态', '南方区域运行规则结算要求']
  },
  {
    roleCodes: ['BOSS', 'ADMIN'],
    subjectTypes: ['GROUP'],
    title: '管理层：市场阶段与经营风险优先',
    summary: '管理层重点看云南规则阶段、南方区域协同、跨区经营影响和不同主体收益风险排行。',
    keyConcerns: ['市场连续结算推进', '规则体系修订状态', '售电/发电/储能收益风险', '跨省送电和省内结算协同', '重大异常和熔断事件'],
    recommendedRoutes: [
      { title: '地区规则体系', path: '/sdzl/region-rules', reason: '查看云南规则阶段和资料效力' },
      { title: '售电经营工作台', path: '/xhjy/yunnan/retail', reason: '查看售电组合收益和风险' },
      { title: '结算模拟器', path: '/xhjy/yunnan/settlement', reason: '查看云南结算拆解和风险提示' },
      { title: '运营中枢', path: '/yygl/ops', reason: '查看风险、合同和运营状态' }
    ],
    riskWarnings: ['云南处于区域现货深度融合阶段，规则版本变化会影响经营口径', '节点电价试点和用户侧分时电价调整会改变售电利润结构'],
    ruleReferences: ['云南电力市场高质量发展三年行动计划动态', '云南推进南方区域电力市场建设动态']
  },
  {
    roleCodes: ['STORAGE_OPERATOR'],
    subjectTypes: ['STORAGE'],
    title: '储能：价差套利和辅助服务轻量提示',
    summary: '储能首版先关注日前/实时价差、SOC执行、辅助服务收益和实时偏差风险，后续再接入云南专属储能规则。',
    keyConcerns: ['日前/实时价差', 'SOC执行切片', '辅助服务收益', '实时偏差风险'],
    recommendedRoutes: [
      { title: '储能投资收益测算', path: '/xhjy/storage-copilot', reason: '统一估算投资、现金流、充放电价差和收益结构' }
    ],
    riskWarnings: ['云南储能和虚拟电厂参与细则仍需持续核验', '现货价差不能覆盖辅助服务和偏差全部风险'],
    ruleReferences: ['云南虚拟电厂参与现货市场交易官方动态']
  }
]

export const yunnanSouthernGridRuleProfile: RegionRuleProfile = {
  regionId: 'yunnan',
  gridOperator: 'china-southern-grid',
  marketStage: '南方区域现货连续结算推进中',
  marketArchitecture: {
    title: '云南南网现货架构',
    summary: '云南现货嵌入南方区域电力市场，按跨省与省内联合出清、两级协同运作组织，省内规则负责主体申报、结算和披露承接。',
    items: ['南方区域联合出清', '云南省内交易组织和结算承接', '跨省送受电曲线参与边界条件', '中长期合约与日前/实时现货衔接']
  },
  documents: [
    {
      title: '南方区域电力市场运行规则（试行，2025年V1.0版）',
      issuer: '南方能源监管局、云南能源监管办、贵州能源监管办',
      publishedAt: '2025-06-17',
      status: 'official',
      url: 'https://nfj.nea.gov.cn/xwzx/tzgg/202506/P020250625360641274024.pdf',
      localPath: `${sourceBase}\\官方PDF\\2025-06-17_南方区域电力市场运行规则_试行2025年V1.0版.pdf`
    },
    {
      title: '云南电力市场现货电能量交易实施细则（征求意见稿）',
      issuer: '国家能源局云南监管办公室',
      publishedAt: '2023-07-28',
      status: 'consultation',
      url: 'https://ynb.nea.gov.cn/jflyfox/nengyuan/ueditor/file/20230728/20230728_162520_954795.pdf',
      localPath: `${sourceBase}\\官方PDF\\2023-07-28_云南电力市场现货电能量交易实施细则_征求意见稿.pdf`
    },
    {
      title: '云南电力市场结算实施细则（征求意见稿）',
      issuer: '国家能源局云南监管办公室',
      publishedAt: '2023-07-28',
      status: 'consultation',
      url: 'https://ynb.nea.gov.cn/jflyfox/nengyuan/ueditor/file/20230728/20230728_162754_163256.pdf',
      localPath: `${sourceBase}\\官方PDF\\2023-07-28_云南电力市场结算实施细则_征求意见稿.pdf`
    },
    {
      title: '云南电力现货市场2024年一季度短周期结算试运行实施方案（征求意见稿）',
      issuer: '国家能源局云南监管办公室',
      publishedAt: '2024-03-18',
      status: 'trial',
      url: 'https://ynb.nea.gov.cn/dtyw/gsgg/202403/t20240318_259137.html',
      localPath: `${sourceBase}\\官方PDF\\2024-03-18_云南电力现货市场2024年一季度短周期结算试运行实施方案_征求意见稿.docx`
    },
    {
      title: '云南连续结算试运行实施方案报审稿（行业转载）',
      issuer: '行业转载，待主管部门正式文件核验',
      publishedAt: '2025-06-28',
      status: 'industry-reference',
      url: 'https://www.pvmeng.com/2025/06/28/41176/',
      localPath: `${sourceBase}\\行业资料\\2025连续结算方案报审稿图片`
    }
  ],
  participants: [
    { title: '发电侧', summary: '区分调节性能、水电梯级和新能源出力预测，采用报量报价或报量不报价参与现货。', items: ['大型水电和调节性能较好水电原则上报量报价', '其他水电、风电、光伏起步阶段多为报量不报价', '报量不报价电厂作为价格接受者', '火电关注启停、运行补偿和一次能源约束'] },
    { title: '用户侧', summary: '售电公司和批发用户起步阶段报量不报价，以需求曲线参与日前出清。', items: ['售电公司代理零售用户', '批发用户申报分时用电曲线', '电网企业代理购电用户纳入试运行范围', '成熟后预留用户侧报量报价和节点电价结算'] },
    { title: '新型主体', summary: '储能、虚拟电厂和需求响应资源逐步纳入，首版仅做规则提示。', items: ['独立储能', '虚拟电厂', '需求响应资源', '辅助服务资源'] }
  ],
  tradingProducts: [
    { title: '中长期交易', summary: '作为现货风险对冲基础，需要形成分时曲线并与日前/实时偏差结算衔接。', items: ['年度、月度、周、多日、日交易', '双边协商、集中竞价、连续挂牌', '合同转让', '分时曲线或曲线分解原则'] },
    { title: '现货交易', summary: '初期包括日前电能量和实时电能量交易。', items: ['日前电能量交易', '实时电能量交易', '跨省与省内联合出清', '出清结果用于结算和调度执行'] },
    { title: '辅助服务和跨省衔接', summary: '调频、备用、跨省送受电边界会影响现货出清和结算。', items: ['调频辅助服务容量占用', '跨省备用辅助服务衔接', '跨省中长期和现货偏差费用', '省间分摊返还'] }
  ],
  clearingTimeline: [
    { title: '日前阶段', summary: 'D-1申报D日96个15分钟时段，出清得到机组组合、分时出力、节点电价和跨省送受电计划。', items: ['发电侧报量报价或报量不报价', '用户侧申报分时需求曲线', 'SCUC/SCED集中优化', '日前结果一般作为运行日发电调度计划'] },
    { title: '实时阶段', summary: '系统实际运行前15分钟开展实时出清，基于日前封存报价和最新边界滚动优化。', items: ['超短期负荷预测', '设备状态和检修执行', '新能源实时预测', '实时节点电价和发电计划', '次日发布正式实时结果作为结算依据'] }
  ],
  pricingModel: [
    { title: '发电侧价格', summary: '市场化电厂原则上按所在节点小时平均节点电价结算。', items: ['15分钟节点电价', '小时内四个节点价算术平均', '节点价反映阻塞和网架约束', '跨省送电价格按区域规则衔接'] },
    { title: '用户侧价格', summary: '起步阶段采用统一结算点或加权平均现货价格，成熟后向用户所在节点电价过渡。', items: ['日前统一结算价', '实时统一结算价', '用户节点电价结算机制试点', '市场化用户分时电价政策变化影响零售套餐'] }
  ],
  settlementModel: [
    { title: '用户侧结算', summary: '用户侧电费由中长期合约、日前偏差、实时偏差、分摊和返还构成。', items: ['中长期合约电费', '日前偏差电费', '实时偏差电费', '分摊电费', '返还电费'] },
    { title: '发电侧结算', summary: '发电侧重点核对日前全电量、实时偏差、中长期差价合约和运行补偿。', items: ['日前市场出清电量乘以日前节点价', '实际上网与日前出清差额乘以实时节点价', '中长期差价合约电费', '运行补偿、启动费用、阻塞相关电费'] },
    { title: '分摊返还', summary: '南方区域规则要求不设置笼统不平衡资金池，日前和实时不平衡资金分开计算。', items: ['用户侧偏差收益转移', '中长期交易偏差收益回收', '市场不平衡资金', '现货部分阻塞盈余', '辅助服务费用'] }
  ],
  riskControls: [
    { title: '试运行风险机制', summary: '云南试运行方案设置熔断、损益风险防控和异常结算处理。', items: ['技术支持系统故障可中止现货商业结算', '恶意串通或巨额盈亏可触发熔断', '损益风险防控系数用于平滑试运行盈亏', '异常情况下切回中长期规则结算'] },
    { title: '市场风险', summary: '现货运行中需关注市场力、价格限值、预测偏差和水电/跨省边界。', items: ['市场力检测与缓解', '申报价格和出清价格上下限', '中长期曲线不足导致实时偏差', '水电汛期消纳和跨省送出约束'] }
  ],
  disclosureRules: [
    { title: '信息披露分层', summary: '云南信息披露细则将信息分为公众信息、公开信息、私有信息和依申请披露信息。', items: ['交易公告和参数', '边界条件和关键断面', '节点电价和出清结果', '日清分和月结算', '市场干预和暂停重启'] }
  ],
  subjectFocus: yunnanSubjectFocus,
  developmentStatus: {
    title: '开发状态',
    summary: '云南首版已具备规则展示和主体关注矩阵，后续应继续补正式细则版本、可计算结算公式和数据适配。',
    items: ['今晚优先支持售电、交易、电厂三类深度关注', '风控、量化、结算、管理层和储能提供轻量提示', '连续结算报审稿仅作为待核验线索', '后续可接入云南专属交易日历和规则计算器']
  }
}
