# 客户交付版前端（`VITE_EDITION=customer`）

> 配套实现：`src/services/edition.ts` · `vite.config.ts`（`dljy-customer-edition` 插件）·
> `src/views/edition/EditionRemovedView.vue` · `scripts/verify-customer-edition-build.mjs` · `.env.customer`
>
> 上游：主仓 Epic #2408 · 子任务 #2410（后端侧见主仓 #2409）

## 这是什么

交付给客户的前端不能让对方看到底层用的是哪家大模型（2026-08-24 用户拍板）。

```bash
npm run build:customer            # 构建交付版
npm run verify:customer-edition-build   # 扫产物，确认零泄露
```

用 `vite build --mode customer` 而不是 `VITE_EDITION=customer vite build`——后者在 Windows 的 cmd 下不成立，而本仓纪律要求 npm 脚本三平台可运行。`--mode` 是 vite 原生机制，零新依赖。

## 交付档下少了什么

| 面 | 处置 |
|---|---|
| 「AI 模型设置」tab | 整个摘掉，组件被替换成占位 |
| `/model`（`/模型`）斜杠命令 | 整条摘掉 |
| 子智能体卡片的模型路由标签 | 不显示 |
| 子智能体编辑表单的模型选择 | 不显示 |
| 编排画布的节点级模型覆盖 | 不显示 |

产物层面：交付版比内部版少 5 个 chunk——`AiSettingsView` / `llmProviders` / `agentConfig` / `notifyClient` / `voice`。

## 关键：v-if 藏不住东西

这是本次踩了两次的坑，**改法必须落到模块解析层**：

**第一次**：把 tab 用编译期常量摘掉，以为 rollup 会连带消除动态 import。实测两版产物**一模一样**——rollup 对动态 `import()` 的 chunk 生成是保守的，即使引用它的分支被消除，chunk 照样产出。`llmProviders.ts` 里那份供应商清单（deepseek / 豆包 / 智谱的中文名、型号、文档链接）仍躺在交付出去的 JS 里，devtools 搜一下就有。

→ 解法：`vite.config.ts` 里加 `resolveId` 插件，交付档构建时把 `AiSettingsView.vue` 重定向到占位组件，让真实组件根本不进模块图。

**第二次**：页面 chunk 消掉了，品牌名还在 `AgentChatPanel` 里。追下去发现 `/model` 斜杠命令也 import 了 `llmProviders`——它会把各厂商与型号**逐条打印进聊天框**，用户输个 `/model` 就能看到，比配置页还直接。

→ 解法：交付档下从命令注册数组里摘掉整条，`runModel` / `modelArgOptions` 随之失去引用者，`llmProviders` 才真正被 tree-shake。

**两次都是「源码看着改对了、产物里还在」。所以判据只能是构建产物。**

## 门禁

`verify:customer-edition-build` 扫交付版产物里有没有供应商信息。

**判据从 `llmProviders.ts` 现场解析**（id 字段 + baseURL 主机名 + 中文厂商名），不硬编码清单——硬编码的话新增供应商时门禁不会跟着覆盖，会一直报绿到某天客户在界面上看见型号。当前解析出 40 个关键词。

三档噪音过滤，都是实测撞出来的：

| 表 | 例子 | 为什么 |
|---|---|---|
| `HOSTNAME_NOISE` | `console` `api` `cloud` | `console.volcengine.com` 切出的 `console` 在几乎每个产物里命中 |
| `TOO_GENERIC_IDS` | `custom` `spark` | 确实是 id，但泄不出「用的是哪家」；中文名补上了这一档 |
| `CHINESE_NOISE` | `自定义` `任意` | 来自「自定义（任意 OpenAI 兼容接口）」这条模板 |

两条变异验证过区分力：

- 拿它扫**内部版**产物 → 红（命中 `deepseek` / `doubao` / `openai` 等）
- **判据来源被破坏**（`llmProviders.ts` 结构变了）→ 红，而不是解析出 0 个关键词后报绿

第二条尤其重要：判据失效时报绿的门禁，比没有门禁更糟。

## 与后端的关系

后端（主仓 #2409）在交付档下把 `/llm/*` 对无 admin token 者返回 404。所以前端摘掉这些入口不只是「藏起来」——那些接口在交付档本来也调不通，留着只会是空白页面和空下拉。

两侧是同一件事的两半，缺一不可：只做前端，客户能直接打接口；只做后端，客户能从 JS 里读到供应商清单。
