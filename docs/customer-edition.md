# 客户交付版前端（`VITE_EDITION=customer`）

> 配套实现：`src/services/edition.ts` · `vite.config.ts`（`dljy-customer-edition` / `dljy-build-info` 插件）·
> `src/views/edition/EditionRemovedView.vue` · `scripts/verify-customer-edition-build.mjs` · `.env.customer`
> `scripts/shared-fingerprint.mjs`（#2454）
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
| 「AI 模型设置」tab | 换成「模型服务」面（#2668 · #2701）：**接入凭据**（填供应方下发的网关地址与密钥，明文只随保存直传服务端、页面只回显尾号）+ 档位启用与角色路由 + **用量与额度**（今日已用 / 上限 / 剩余 / 重置时间，上限不限显示「不限」）+ **联网搜索**（开通状态与连通测试），零品牌信息；内部档的完整设置页（联网搜索密钥、管理令牌、采样 / 工作流参数）被替换成占位，且网关模式下其搜索卡只剩提示与测试——本地供应商配置不生效 |
| `/model`（`/模型`）斜杠命令 | 保留（#2668 起只列模型服务档位，不再打印供应商 / 型号；#2410 时因打印清单而摘掉） |
| 子智能体卡片的模型路由标签 | 不显示 |
| 子智能体编辑表单的模型选择 | 不显示 |
| 编排画布的节点级模型覆盖 | 不显示 |

产物层面：交付版没有 `AiSettingsView` / `notifyClient` / `voice` 这些内部档专属 chunk；`llmProviders` 这个 chunk 已随 #2668 从两个档一起消失（前端不再持有供应商清单）。

## 关键：v-if 藏不住东西

这是本次踩了两次的坑，**改法必须落到模块解析层**：

**第一次**：把 tab 用编译期常量摘掉，以为 rollup 会连带消除动态 import。实测两版产物**一模一样**——rollup 对动态 `import()` 的 chunk 生成是保守的，即使引用它的分支被消除，chunk 照样产出。当时前端那份供应商清单（`llmProviders.ts`，各厂商的中文名、型号、文档链接）仍躺在交付出去的 JS 里，devtools 搜一下就有。

→ 解法：`vite.config.ts` 里加 `resolveId` 插件，交付档构建时把 `AiSettingsView.vue` 重定向到占位组件，让真实组件根本不进模块图。

**第二次**：页面 chunk 消掉了，品牌名还在 `AgentChatPanel` 里。追下去发现 `/model` 斜杠命令也 import 了 `llmProviders`——它会把各厂商与型号**逐条打印进聊天框**，用户输个 `/model` 就能看到，比配置页还直接。

→ 解法：交付档下从命令注册数组里摘掉整条，`runModel` / `modelArgOptions` 随之失去引用者，`llmProviders` 才真正被 tree-shake。

**两次都是「源码看着改对了、产物里还在」。所以判据只能是构建产物。**

## 门禁（两道，共用一张关键词表）

关键词表在 `scripts/llm-brand-keywords.mjs`：供应商 id、中文厂商名、真实型号族，全部小写。#2410 时判据从前端的供应商清单现场解析（「新增供应商门禁自动跟上」）；**#2668 起前端不再持有任何供应商 / 型号信息**，判据来源没了，这张表就是判据本身——它是回归绊线，谁把品牌词写回前端就红。新供应商在网关侧接入，前端永远不知道它叫什么，所以 #2410 担心的「新增供应商漏判」在新架构下不存在；真要新增品牌词，在合入那条 PR 时补进表里。

三四个字母的通用英文词（`step` / `spark` / `lite`）一律不收：#2410 实测它们在无关代码里到处命中，中文厂商名正好补上那一档。

| 门禁 | 扫什么 | 守什么 |
|---|---|---|
| `verify:customer-edition-build` | 交付版构建**产物**（.js） | 内部档专属的东西没有随 tree-shaking 失效混进交付版 |
| `src/services/edition.brand-keywords.spec.ts` | 前端**源码**（src/**，含 spec） | 前端不写品牌 / 型号——不论哪个档。`volcengine` 豁免：它是联网搜索工具的后端契约枚举值 |

两条变异验证过区分力：

- 拿产物门禁扫**内部版**产物 → #2410 时命中十几个品牌词；#2668 后只剩 `volcengine` 一处（内部档「联网搜索」的供应商枚举，见关键词表里的 `SOURCE_SCAN_EXEMPT`）——区分力仍在，且内部版也没有大模型品牌词了
- **关键词表被清空** → 红，而不是 0 个关键词后报绿

第二条尤其重要：判据失效时报绿的门禁，比没有门禁更糟。

## 与后端的关系

后端（主仓 #2409）在交付档下把 `/llm/*` 对无 admin token 者返回 404。所以前端摘掉这些入口不只是「藏起来」——那些接口在交付档本来也调不通，留着只会是空白页面和空下拉。

两侧是同一件事的两半，缺一不可：只做前端，客户能直接打接口；只做后端，客户能从 JS 里读到供应商清单。

## 构建信息文件 build-info.json（dljy#2454，两仓版本绑定的 web 半边）

主仓出包（`scripts/release/build-release.mjs --web-dist <dljy-web 的 dist>`）把本仓产物装进交付包，但没有任何机制保证这份产物与主仓的 `shared/` 契约面**同代**——本仓 `shared/` 是主仓经 `sync:web` 单向镜像的只读副本，产物一旦是在上一次 sync 之前构建的，装包后就是「新后端 + 旧契约前端」。

机制：每次构建（**所有 mode**，不只交付档）收尾时，`vite.config.ts` 的 `dljy-build-info` 插件把 `build-info.json` 写进产物根目录；主仓出包时用**同一套算法**（`scripts/shared-fingerprint.mjs`，主仓逐字复制一份）对自己的 `shared/` 白名单算指纹比对，`algorithm` 串或 `hash` 不等即拒绝出包。

```json
{
  "repo": "dljy-web",
  "edition": "customer",
  "viteMode": "customer",
  "gitSha": "<git rev-parse HEAD，git 不可用时 null>",
  "gitDirty": false,
  "builtAt": "<UTC ISO>",
  "shared": { "hash": "<64 位小写 hex>", "fileCount": 37, "algorithm": "sha256-path0content-v1" }
}
```

| 字段 | 含义 |
|---|---|
| `edition` | `customer`（`--mode customer`）/ `internal`（其余构建） |
| `viteMode` | 构建时的 vite mode 原值 |
| `gitSha` / `gitDirty` | 构建时的源码状态，出包侧排查用；git 不可用时 `sha=null`、dirty 保守记 `true` |
| `shared.hash` | 仓库 `shared/` 全部文件的内容指纹（排除 `README*` 与点文件） |
| `shared.fileCount` | 参与指纹的文件数（当前 37），比对前的第一道快速判据 |
| `shared.algorithm` | 算法版本串，主仓比对前先核对它，不等直接拒绝并提示两侧算法代差 |

**指纹算法口径**（`scripts/shared-fingerprint.mjs` 头注释是权威）：relPaths POSIX 分隔符、UTF-16 码元序升序；每文件 `sha256(relPath + "\0" + 原始字节)`；总指纹 = `sha256(各文件 hex 以 "\n" 连接)`。内容**不做换行归一**（sync 是字节级拷贝）。

**改算法必须两仓同改**：本文件被主仓逐字复制，动任何一条规则（分隔符、排序、哈希输入、拼接方式）都要同时改主仓那份并升级 `SHARED_FINGERPRINT_ALGORITHM` 串——只改一边，主仓比对会全部拒绝出包（`algorithm` 串兜底不至于错配放行）。

本仓侧的两道配套门禁：

| 门禁 | 守什么 |
|---|---|
| `npm run test:scripts`（也接在 `lint` 尾部） | 指纹算法本身的契约（排序、路径参与哈希、字节级敏感、单文件退化口径），期望值按规格独立手算写死 |
| `verify:customer-edition-build` 后半段 | 交付档产物携带的 `shared.hash` / `fileCount` / `algorithm` 与当下仓库 `shared/` 现算一致——shared/ 在构建之后被动过（sync 回流等）即红，重新构建即可 |

`build-info.json` 是给出包脚本读的，**不给浏览器**：主仓拷产物进镜像前会删掉它，本仓 nginx 不用处理。

