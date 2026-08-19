// 前端 prompt 统一管理归口。
//
// 把原先散落在 services/views 里的硬编码系统提示集中到本目录，便于统一检索、维护与口径对齐：
// - navigator      浮层全能 AI 助手 + 页面导航推荐（@@NAV 协议）
// - reportInsight  报表 AI 经营解读（三段式 JSON）
// - tiangong       天工多智能体编排演示（动态派遣 JSON）
// - pageKeys       Copilot 页面提示 key 常量（与后端 prompts/pages.py 白名单对齐）
//
// Copilot / 工作台等"专业协作层"的 supervisor 角色提示由后端白名单管理
// （前端只传 pageKeys 里的 key），不在本目录定义；本目录只放前端自管的轻量/演示提示。
// 后端角色/页面/编排提示见 packages/agent-runtime/src/agent_runtime/prompts/。

export { buildNavigatorSystemPrompt, type NavCatalogEntry } from './navigator'
export { buildReportInsightPrompt, type ReportInsightMetrics } from './reportInsight'
export { TIANGONG_ORCHESTRATOR_SYSTEM } from './tiangong'
export { PAGE_PROMPT_KEYS, type PagePromptKey } from './pageKeys'
