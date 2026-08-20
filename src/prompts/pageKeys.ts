// Copilot 页面提示 key 常量（统一前端 prompt 管理：页面白名单层）。
//
// 这些 key 必须与后端白名单严格一致：
// packages/agent-runtime/src/agent_runtime/prompts/pages.py::PAGE_PROMPTS
// 前端只传 key、不传自由文本，后端按 key 解析固定 supervisor 上下文提示，防注入绕过安全基线。
// 各 Copilot 视图从这里取常量传给 AgentChatPanel 的 prompt-key，避免散落的字符串字面量漂移。

export const PAGE_PROMPT_KEYS = {
  /** 交易晨报：行情研判 + 交易策略 + 风险提示 */
  morningBrief: 'morning_brief',
  /** 储能投资测算：MILP 充放优化 + 套利 + 敏感性分析 */
  storageCopilot: 'storage_copilot',
  /** 申报前体检：合规 / 风险 / 收益三维 go/no-go 评分卡 */
  preSubmitCheck: 'pre_submit_check',
  /** 政策情报官：披露检索 + 规则影响相关性打分 */
  policyIntel: 'policy_intel',
  /** 智能体工作台：综合决策入口（会话历史/续聊/澄清意图/复用权威端点） */
  workbench: 'workbench',
  /** 申报台·行情问询：申报相关行情解读与价格区间 */
  declarationMarket: 'declaration_market',
  /** 申报台·起草审批：96 点申报草稿 + CVaR + 人工审批 */
  declarationDraft: 'declaration_draft',
  /** 复盘中心：偏差归因 + 损益分解 + 改进项 */
  reviewCenter: 'review_center',
  /** 市场洞察驾驶舱：行情/弹性/价差/节点/异动多区块解读 */
  marketInsightCockpit: 'market_insight_cockpit',
  /** 市场数据分析页（分时行情/价格/出清/量价关系/负荷/综合）：真实回放时序回看解读 */
  marketDataAnalysis: 'market_data_analysis',
  /** 市场经营分析：发电/售电/储能/套餐结构与价格趋势经营视角 */
  marketOperations: 'market_operations'
} as const

export type PagePromptKey = (typeof PAGE_PROMPT_KEYS)[keyof typeof PAGE_PROMPT_KEYS]
