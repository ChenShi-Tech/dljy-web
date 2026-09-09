// ============================================================================
// 大模型供应商 / 真实型号关键词表（主仓 Epic #2661 · #2668）
// ----------------------------------------------------------------------------
// 两个消费者共用同一张表，判据只维护一处：
//   - scripts/verify-customer-edition-build.mjs —— 扫**交付版构建产物**（.js）
//   - src/services/edition.brand-keywords.spec.ts —— 扫**前端源码**（src/**）
//
// ## 为什么现在是内联表，而不是像 #2410 那样从 llmProviders.ts 现场解析
//
// #2410 时前端持有一份供应商清单（llmProviders.ts），判据从它解析——「新增供应商门禁
// 自动跟上」。#2668 起前端**不再持有任何供应商 / 型号信息**：清单文件已删，档位来自
// 网关 `/llm/services`，供应商只存在于网关内部。判据来源没了，这张表就是判据本身。
//
// 它的语义随之变了：不再是「跟着清单走的镜像」，而是**回归绊线**——列出的都是本仓
// 历史上真实出现过的品牌 / 型号词。新供应商在网关侧接入，前端永远不会知道它叫什么，
// 所以「新增供应商漏判」这个 #2410 担心的情形在新架构下**不存在**：前端根本没有可
// 泄露的字符串。要是有人把某个品牌名重新写进前端，只要它在这张表里就会被拦下；不在
// 表里的新品牌，请在合入那条 PR 时把词加进来（这也是 code review 的一项）。
//
// ## 判据形式
//
// 全部小写；产物扫描把文本转小写后做 `includes`，源码扫描按行做同样的小写子串匹配。
// 词要足够特异：三四个字母的通用英文词（`step` / `spark` / `lite`）会在无关代码里到处
// 命中（#2410 实测），这里一律不收；中文厂商名不存在这个问题，正好补上那一档。
// ============================================================================

/** 供应商标识（曾经的 llmProviders.ts `id` 字段 + 接口主机名里的厂商段） */
const VENDOR_IDS = [
  'aliyun', 'aliyuncs', 'anthropic', 'baichuan', 'bailian', 'dashscope', 'deepseek', 'doubao',
  'hunyuan', 'kimi', 'minimax', 'minimaxi', 'moonshot', 'openai', 'qwen', 'siliconflow',
  'spark-api-open', 'stepfun', 'tencent', 'volcengine', 'volces', 'xf-yun', 'xfyun', 'xinghuo', 'zhipu'
]

/** 中文厂商名（含品牌别名） */
const VENDOR_NAMES_ZH = [
  '智谱', '月之暗面', '深度求索', '火山方舟', '百川', '硅基流动', '腾讯混元', '讯飞星火', '豆包',
  '通义千问', '阶跃星辰', '阿里云百炼'
]

/**
 * 真实型号名族。只收带厂商前缀且足够长的形式（`glm-4`、`gpt-4`、`claude-`……），
 * 不收 `step-1-8k` 这类会被切成通用词的型号。
 */
const MODEL_FAMILIES = ['glm-4', 'glm-5', 'gpt-4', 'claude-', 'abab6', 'generalv3', '4.0ultra']

export const BRAND_KEYWORDS = Object.freeze(
  [...new Set([...VENDOR_IDS, ...VENDOR_NAMES_ZH, ...MODEL_FAMILIES].map((w) => w.toLowerCase()))].sort()
)

/**
 * 源码扫描里豁免的词：`volcengine` 同时是联网搜索（web_search 工具）的供应商 id——那是
 * 后端契约里的枚举值，内部档「联网搜索」配置面必须原样发送，改名等于改后端。它不是
 * 大模型档位信息，且交付档下整个 AI 设置页在模块解析层就不存在（产物扫描仍会查它）。
 */
export const SOURCE_SCAN_EXEMPT = Object.freeze(['volcengine'])
