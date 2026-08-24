// 交付档（edition）—— 同一份代码构建出「内部版」与「客户交付版」两种前端。
//
// 主仓 Epic #2408 · 子任务 #2410（后端开关见主仓 #2409 的 agent_runtime/edition.py）。
//
// 交付给客户的包不能让对方看到底层用的是哪家大模型（2026-08-24 用户拍板）。
//
// ## 为什么用构建期常量而不是运行期开关
//
// 运行期开关（比如向后端问一句「现在是什么档」）只能把界面藏起来，`llmProviders.ts`
// 里那份供应商清单——deepseek / 豆包 / 智谱的中文名、文档链接、型号列表——照样躺在
// 交付出去的 JS 里，打开 devtools 搜一下就有。
//
// `import.meta.env.VITE_EDITION` 在 `vite build` 时会被替换成字面量，于是
// `IS_CUSTOMER_EDITION` 成为编译期常量，rollup 能把 false 分支连同它引用的动态
// import 一起消除——交付版的产物里根本不存在那个 chunk。
//
// 构建：`VITE_EDITION=customer npm run build`
export const IS_CUSTOMER_EDITION = import.meta.env.VITE_EDITION === 'customer'

/** 内部档为 true。用于「这块只在内部版显示」的正向判断，避免满屏 `!IS_CUSTOMER_EDITION`。 */
export const IS_INTERNAL_EDITION = !IS_CUSTOMER_EDITION
