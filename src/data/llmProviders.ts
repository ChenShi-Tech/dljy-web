// 预置「市面上大部分国产大模型」的接入模板 + 后端 model_providers.yaml 派生的主力供应商。
// 它们基本都提供 OpenAI 兼容的 /chat/completions 接口，因此前端只需切 baseURL + model。
// 用户在「AI 设置」里选一个 provider，填自己的 apiKey、选/填 model 即可。
//
// ⚠️ 本文件分两段：
// - 「自动生成段」（BEGIN/END AUTO 标记内）：由 scripts/build/sync-llm-providers.mjs 从
//   packages/agent-runtime/src/agent_runtime/config/model_providers.yaml 派生，勿手改（改了会被覆盖）。
//   换型号请改 yaml 后跑 npm run sync:llm。
// - 「手维护段」（标记外）：前端独有的市面接入模板（minimax/baichuan/stepfun/spark/custom），
//   yaml 没有，由本文件手维护。
export type LlmProvider = {
  id: string
  name: string
  baseURL: string
  models: string[]
  docUrl?: string
  note?: string
}

export const llmProviders: LlmProvider[] = [
  // ---- BEGIN AUTO: 由 npm run sync:llm 从 model_providers.yaml 生成，勿手改 ----
  {
    id: "deepseek",
    name: "DeepSeek 深度求索",
    baseURL: "https://api.deepseek.com/v1",
    models: ["deepseek-v4-flash","deepseek-v4-pro"],
    docUrl: "https://platform.deepseek.com",
    note: "便宜、中文好，推荐做意图识别"
  },
  {
    id: "qwen",
    name: "通义千问（阿里云百炼）",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-max","qwen-plus","qwen-turbo","qwen-long","qwen-vl-max"],
    docUrl: "https://bailian.console.aliyun.com",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-5.2","glm-5.1","glm-5-turbo","glm-4-plus","glm-4-air","glm-4-flash","glm-4v-plus"],
    docUrl: "https://open.bigmodel.cn",
  },
  {
    id: "moonshot",
    name: "月之暗面 Kimi",
    baseURL: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k","moonshot-v1-32k","moonshot-v1-128k","kimi-k2.6"],
    docUrl: "https://platform.moonshot.cn",
  },
  {
    id: "hunyuan",
    name: "腾讯混元",
    baseURL: "https://api.hunyuan.cloud.tencent.com/v1",
    models: ["hunyuan-turbos-latest","hunyuan-large","hunyuan-t1-latest","hunyuan-standard"],
    docUrl: "https://cloud.tencent.com/product/hunyuan",
  },
  {
    id: "doubao",
    name: "豆包（火山方舟）",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    models: ["doubao-seed-2-0-pro","doubao-seed-1-6","doubao-seed-1-6-flash","doubao-seed-1-6-thinking"],
    docUrl: "https://console.volcengine.com/ark",
    note: "火山方舟 model 处填接入点 ID（ep-开头）或预置 Model ID"
  },
  {
    id: "siliconflow",
    name: "硅基流动 SiliconFlow（聚合多模型）",
    baseURL: "https://api.siliconflow.cn/v1",
    models: ["deepseek-ai/DeepSeek-V3.1","Qwen/Qwen2.5-72B-Instruct"],
    docUrl: "https://siliconflow.cn",
  },
  {
    id: "openai",
    name: "OpenAI（海外）",
    baseURL: "https://api.openai.com/v1",
    models: ["gpt-4o","gpt-4o-mini"],
    docUrl: "https://platform.openai.com",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude（海外）",
    baseURL: "",
    models: ["claude-opus-4-8","claude-sonnet-4-6"],
    docUrl: "https://console.anthropic.com",
  },
  // ---- END AUTO ----

  // ---- 以下为前端独有的市面接入模板（yaml 未声明），手维护 ----
  {
    id: 'minimax',
    name: 'MiniMax',
    baseURL: 'https://api.minimax.chat/v1',
    models: ['abab6.5s-chat', 'abab6.5g-chat'],
    docUrl: 'https://platform.minimaxi.com'
  },
  {
    id: 'baichuan',
    name: '百川 Baichuan',
    baseURL: 'https://api.baichuan-ai.com/v1',
    models: ['Baichuan4-Turbo', 'Baichuan4', 'Baichuan3-Turbo'],
    docUrl: 'https://platform.baichuan-ai.com'
  },
  {
    id: 'stepfun',
    name: '阶跃星辰 Step',
    baseURL: 'https://api.stepfun.com/v1',
    models: ['step-1-8k', 'step-2-16k'],
    docUrl: 'https://platform.stepfun.com'
  },
  {
    id: 'spark',
    name: '讯飞星火',
    baseURL: 'https://spark-api-open.xf-yun.com/v1',
    models: ['4.0Ultra', 'generalv3.5', 'lite'],
    docUrl: 'https://xinghuo.xfyun.cn'
  },
  {
    id: 'custom',
    name: '自定义（任意 OpenAI 兼容接口）',
    baseURL: '',
    models: [],
    note: '填入任意兼容 /chat/completions 的 baseURL 与 model'
  }
]

export function findProvider(id: string): LlmProvider | undefined {
  return llmProviders.find((p) => p.id === id)
}
