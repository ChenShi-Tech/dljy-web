# 开发指南（前端 × 后端）

> 本文是 dljy-web 的开发权威指南：架构、前后端通讯、环境搭建、联调、约定与排错。
> 快速开始见 README.md；本仓分界与红线见 CONTRIBUTING.md；worktree、issue、PR、合并等流程规则见 AGENTS.md 的「跨仓通用规则」块与工作区 CLAUDE.md。

## 1. 架构总览

本仓是**纯前端**（Vue 3 + Vite + Element Plus + ECharts + Cesium），后端服务不在本仓，通过 Vite 代理访问各独立后端面：

```
浏览器 ──► Vite dev server (5174)
              │  代理（vite.config.ts server.proxy）
              ├── /api/*        ──► Node BFF        （DLJY_DEV_API_TARGET，默认 127.0.0.1:4174）
              │   /dify-*、/console、/_next 同走此面
              ├── /agent-api/*  ──► Python FastAPI  （DLJY_AGENT_API_TARGET，默认 127.0.0.1:8000）
              │   （路径会被 rewrite：/agent-api/xxx → /api/xxx）
              ├── /data-svc/*   ──► 数据服务        （DLJY_DATA_SVC_TARGET，默认 127.0.0.1:8190；rewrite 去前缀）
              │   （数据管理路径族经 api.ts::dataServicePath 改道，#2169 P2-2a）
              └── /pi-api/*     ──► pi-poc 编排服务 （DLJY_PI_POC_TARGET，默认 127.0.0.1:8100；rewrite → /api）
                  （战略问答 #1526 / 申报体检 #1527 PoC 与智能体工作台 chat 共用，见 §3.5 第 8 条）
```

两个后端面的分工：

| 面 | 职责 | 典型接口 |
|---|---|---|
| `/api`（Node BFF） | 登录鉴权、RBAC/数据权限、真实采集数据回放（`/api/real`）、业务 CRUD、报表 | `/api/auth/login`、`/api/real?family=…`、`/api/v1/…` |
| `/agent-api`（Python） | 智能体对话、预测、量化计算的**权威实现**、PostgreSQL 时序数据（节点电价等） | `/agent-api/agent/*`、`/agent-api/v1/spot/*`、`/agent-api/v1/forecast/*` |

**两个面必须是两个独立端点**：`/agent-api` 会被 rewrite 成 `/api`，若与 Node 面共用同一 upstream 会路径撞车。

## 2. 环境搭建

```bash
# 要求 Node >= 22.12
npm ci
cp .env.example .env.local        # 填 DLJY_DEV_API_TARGET / DLJY_AGENT_API_TARGET（向维护者索取）；DLJY_DATA_SVC_TARGET / DLJY_PI_POC_TARGET 默认即可
npm run dev                        # http://localhost:5174
```

- dev server 只监听本机回环（刻意不开 `--host 0.0.0.0`）；需要给别人演示时再临时加。
- 端口 5174 固定（`strictPort`），被占用会直接报错——先关掉占用者。
- 登录：账号密码由维护者发放；滑块验证仅生产构建才有，dev server 默认跳过。权限受限（部分管理页 403 / 部分数据空态）属正常。
- 功能开关见 `.env.example`「功能开关」区。其中 `VITE_YUNNAN_INSIGHT_WORKSPACE` 控制的云南市场洞察工作区（dljy#2995 新版六页）**已于 2026-09-28 封存（dljy#3387），保持关闭、不要打开**——市场洞察沿用旧版入口，封存说明见 `docs/market-insight.md`。

## 3. 前后端通讯约定（写代码必读）

### 3.1 取数只经服务层

页面组件**不直接 `fetch`**，一律经 `src/services/`：

- `src/services/api.ts` —— `/api` 面的统一出口：响应信封解析、Token 注入（`Authorization: Bearer`）、**自动注入 `x-region-id` 请求头**（全局地区上下文）。
- `src/services/agent/` —— `/agent-api` 面的出口：`agentClient.ts`、`difyStudioClient.ts` 等客户端与它们共用的 `httpClient.ts` 基座（`createAgentClient` 工厂）。基址统一走 `AGENT_API_BASE` 常量（`${AGENT_API_BASE_ROOT}/agent`，根 `AGENT_API_BASE_ROOT` 定义在 `api.ts`、默认 `/agent-api`，可被 `VITE_AGENT_API_BASE` 覆盖），**不得硬编码 `http://…:8000`**（生产会 404）。
- `src/services/agent/piPocClient.ts` —— `/pi-api` 面唯一出口（基址 `PI_AGENT_BASE`）；dev 经 vite 代理到 pi-poc 编排服务（默认 8100），见 §1 架构图。
- `src/services/dataServiceRoutes.ts` —— `/data-svc` 面改道：数据管理路径族经 `dataServicePath()` 改写为 `/data-svc/api/…`（#2169 P2-2a），代理目标 `DLJY_DATA_SVC_TARGET`（默认 8190）。
- `src/services/data/` —— 统一类型 + 数据口径（basis）归一的取数基座。

### 3.2 响应信封与真伪标注

后端响应带统一信封与「真伪标注」，前端必须如实呈现：

- `mock: true` / `sourceType: 'MOCK'` 的数据，页面**必须有可见「模拟数据」提示**——伪装真实接入按 P1 处理。
- `sourceType: 'REAL'` + `provenance` 才是真实数据；`availability`/`freshness` 字段描述数据新鲜度（如 `stale`），要如实展示而不是隐藏。
- 路由 `meta.kind` 三档语义：`real`（真实）/ `mixed`（混合）/ `forecast`（**数值不可信**，只看格式，多为 `/ycsj/*`）。

### 3.3 地区体系（为什么有的省切过去是空的）

- 全局地区存 `localStorage`（`src/services/region/regionContext.ts`），所有 `/api` 请求自动带 `x-region-id`。
- 响应头 `x-region-served` / `x-region-fallback` 驱动 `RegionDataBanner` 显示回退提示。
- **「真实或空」纪律**：除山西（基线）外，任何地区缺自身真实数据时只返回按地区合成的 Mock（标 `mock:true`）或空态，**绝不串读山西数据**。所以切到无数据省份看到空页面是设计行为，不是 bug。
- 前端可切换地区由 `REAL_DATA_REGION_IDS`（真实：yunnan/shanxi）与演示开通地区（sichuan）控制。

### 3.4 AI 侧边栏与智能体聊天面板

**业务页接入 AI 只走 `@/features/aiSidebar`**（统一 AI 侧边栏，规格见工作区 `openspec/specs/ai-sidebar-*`）：

- **声明页面**：在页面 setup 里调用 `defineAiPage({ label, promptKey, interpret?, presets? })`。
  - `promptKey` 只能取 `PAGE_PROMPT_KEYS` 白名单里的值，类型层会拒绝自由文本。
  - `interpret.context` 和预制问题的 `context` 都是函数，在点击那一刻求值，只返回当前筛选的摘要，不要传整页原始数据。
  - 声明跟随 KeepAlive 的激活与失活自动生效或失效，不需要手动清理。
- **发起提问**：`useAiSidebar().interpret()` 按当前页声明解读本页；`ask(question, { context })` 用于快捷任务、单卡解读和选中即问。
  - 数据切片只随发起解读的那一轮发送；页面背景（页面名、路由、地区、公司）由侧边栏每轮自动附带。
- **不要在业务视图里直接内嵌 `AgentChatPanel.vue`**，ESLint 会报错。确实属于流程步骤的内嵌对话（一日作业台、申报台、储能测算、复盘写作）要登记到 `eslint.config.js` 的 `EMBEDDED_CHAT_ALLOWLIST`。
- **侧边栏和智能体工作台 `/ai-agent` 平级**，共用 `components/agent` 对话内核。工作台支持 `?entry=&session=` 续接侧边栏里的会话。

`AgentChatPanel.vue` 的内嵌接入点必须给**静态且全仓唯一**的 `history-key`，且不得关闭历史持久化（不得出现 `:persist-history="false"`）。这两条由单测 `src/components/agent/historyKeyInvariants.spec.ts` 守护，边界 lint 的自测见 `src/features/aiSidebar/boundaryLint.spec.ts`。

### 3.5 API 对接指南（新增/收编端点时的 checklist）

1. **先定归属面**：业务 CRUD/鉴权/采集回放 → `/api`（`apiGet`/`apiPost`）；智能体、预测、量化权威实现 → `/agent-api`（`createAgentClient` 工厂）；pi-poc 沙箱 → `piPocClient`。URL 只写相对路径，基址一律用常量（`/api` 面由 `api.ts` 内部拼接、可被 `VITE_API_BASE` 覆盖；agent / pi 面用 `AGENT_API_BASE` / `PI_AGENT_BASE`），显式 `/api|/agent-api|/dify-*` 前缀不会被叠加基址。
2. **信封契约**：响应统一 `{ code, message, data, mock, sourceType, productionWrite }`。`unwrap` 的错误分类：`payload.code ≥ 400` 优先于 HTTP status；响应体非 JSON（如网关 HTML 错误页）时 msg 回落 `statusText`，仍无则为「接口响应无法解析」；204 → `{ code: 204 }`；抛出的 `ApiError` 携带 `status/code/payload/lockedUntil/remainingAttempts`。
3. **请求头自动注入**（不要在调用方手拼）：`apiGet`/`apiPost` 自动带 `Authorization`、`x-company-id`（与 `x-tenant-id` 同值）、`x-region-id`（全局地区上下文）；`apiPost` 自动 `content-type: application/json` + `idempotency-key`（幂等键）。agent 面的写方法额外带 `x-admin-token`，`postForm` **绝不手设 content-type**（multipart boundary 由浏览器生成）。
4. **地区响应头**：`x-region-served` / `x-region-fallback` 驱动 `RegionDataBanner`；api.ts 内部有请求序号守卫，切区后旧地区的迟到响应不会覆盖新地区状态。
5. **401 白名单**：`/auth/login`、`/auth/login-options`、`/qweather`、`/csg/disclosure` 之外的 401 会清登录态 + `auth-expired` 事件 + 跳 `/login?redirect=`。新端点若属「后端代理外部服务」性质，评估是否要加白名单（否则外部服务 401 会误触发全局登出）。
6. **GET 退避重试**：502/503/504 自动重试最多 2 次（退避 400→800ms）；500/404 不重试；AbortError 直抛。新写 client 不要自己再包一层重试。
7. **mock 标注透传**：收编/新写 client 时，信封的 `mock` 与 `mockFields` 必须原样透传给 UI 层（驾驶舱/工作台的 Mock 可见标注依赖它）；「缺数据返 null、失败不缓存、未知回落标 synthetic」是数据诚实性红线。
8. **`/pi-api` 特例**：战略问答/申报体检 PoC 与智能体工作台（chat 已切流 #2158）共用，后端是 integrations/pi-poc 沙箱（`DLJY_PI_POC_TARGET`，默认 8100，代理 rewrite `/pi-api` → `/api`）；不跑该服务时代理目标不可达属正常。会话**生命周期**请求（建/查会话、messages、stream、active-run、stop、approvals）恒走 `PI_AGENT_BASE`（#2958）；但**产物（artifacts）与 data_ref（refs）虽按 pi 会话号寻址，却由 agent-runtime 提供**（pi-poc 没有这两类端点），固定走 `AGENT_API_BASE`。

### 3.6 三维地图：底图、地形与凭据（改 `src/features/gridGeo/**` 前必读）

「空间资产」下的多个页面共用 `CesiumPlantMap.vue`（装配层，实现拆在 `composables/`：底图 `useBaseMap.ts`、地形与光照 `useTerrain.ts` 等），三层是**互相独立**的，排障时先分清坏在哪一层：

| 层 | 配置位置 | 现状 |
|---|---|---|
| 底图影像 | `src/config/mapProviders.ts` 注册表 + `VITE_GRID_GEO_BASEMAP` | 默认 `arcgis-imagery`（卫星），失败按降级链退到矢量图、最终退内置底色 |
| 地形高程 | `TerrainControlPanel` 下拉 + `VITE_GRID_GEO_TERRAIN_PROVIDER` | 默认 ArcGIS Terrain 3D（免 token）；Cesium World Terrain 需 ion token |
| 山体阴影 | 晕渲图层（`applyHillshade`）+ `VITE_GRID_GEO_HILLSHADE_URL` | 默认走 `server.arcgisonline.com` 降级链 |

三条容易踩空的事实：

1. **`server.arcgisonline.com` 通，`services.arcgisonline.com` 不通。** 同一家 Esri 的两个子域，后者对本项目出口 IP 15s 超时无响应。历史上把整域判死，导致卫星底图与晕渲被一起弃用。新引 Esri 服务一律用 `server.`（`mapProviders.spec.ts` 有回归护栏钉死这条）。
2. **ArcGIS Terrain 3D 没有顶点法线**（Cesium 里 `hasVertexNormals` 恒为 `false`），所以它的地形**几何是真的、山体阴影是没有的**——光照算不出明暗，起伏全靠晕渲图层勾勒。要真山体明暗只能用 Cesium World Terrain（quantized-mesh + `requestVertexNormals`）。
3. **`globe.enableLighting` 不能简单关掉。** 关掉能治「夜半球全黑」，但地表明暗 100% 来自光照，关掉等于把地形摁成一张平贴图。现在的做法是保留光照、把光源换成跟随相机的 `DirectionalLight`（见 `applyLighting`）：相机看到的永远是受光面，地形明暗照常。

**ion token 是运行时凭据**（`src/config/mapTokens.ts`）：localStorage 优先、`VITE_CESIUM_ION_TOKEN` 兜底。用户在「地形环境」面板里就能填，填完立即生效、无需重新构建——现场交付拿到的是构建产物，没有这条路径就永远开不了带山体阴影的那一档。它是前端可见的第三方地图凭据（随每个瓦片请求发出），不属于需要保密的后端密钥。

天地图影像底图（`tianditu-imagery`，`src/config/mapProviders.ts` 注册）需要 `VITE_TIANDITU_TOKEN`（`src/config/mapTokens.ts` 读取，构建期默认，运行时可经 localStorage `dljy.grid-geo.tianditu-token` 覆盖）。

### 3.7 预测模型目录必须带目标上下文（ChenShi-Tech/dljy-web#54）

`src/services/forecast/forecastProviders.ts` 按 `(regionId, target)` 分开保存目录、加载状态与错误；
不同目标的同名模型可能有不同的可用性和质量，不能借用普通电价 `price` 的目录。

- 单目标工作台：调用 `ensureForecastCatalog(target, false, regionId)`，用 `forecastCatalogState(targetRef, regionRef)` 读取响应式状态，用 `providersForTarget(target, regionId)` 读取对应模型。
- 价格/负荷共页：可并行调用 `ensureForecastCatalog(['price', 'load'])`，但两个选择器分别读取各自的 `forecastCatalogState`，不要按模型ID合并可用性或质量。
- 申报决策页 `ForecastDecisionCockpitView.vue` 的首载和切区共用目录请求代次，并显式传递地区快照。只有当前代次可标记就绪、校验模型选择或启动预测；A→B→A 的旧完成/失败及卸载后回调均不得改动当前状态，不以自动换模型掩盖选择丢失。
- `ensureForecastCatalog(true)`、`PROVIDERS`、`getProvider(id)` 保留旧的默认 `price` 语义；新增非价格路径不得依赖它们推断模型状态。
- 目录修复不等于远端可用：后端返回的 `available:false` 和不可用原因必须保留，不得为了显示模型而伪造数据、权重或授权状态。

### 3.8 指定日期与在线模型入口（ChenShi-Tech/dljy-web#54）

- 工作台消费 `/ycsj/center?mod=bench&target=price_user_da_settlement&date=YYYY-MM-DD`，并跟随同页query变化。日期为空或非法时不自动改算固定历史日；模型目录异步加载后按当前目标选择可用模型。
- 云南旧价格回放与厂站负荷tab仍遵循degraded/not-configured门控。新目标入口仅在账号有 `/ycsj/workbench` 权限且地区工作台能力为available时出现，切到同页建模工作台；区域负荷不是厂站负荷，用户结算价不是旧平台价格回放。
- 在线面板默认 `data_source=auto`，显式选择合成验证才发送synthetic；缺数据原因常驻显示。日期/地区/目标/模型/窗口/参数改变即清空旧结果、作废在途请求，旧finally不得改变新请求状态。
- `services/forecast/onlineForecastResult.ts`核对返回的地区/目标/模型/日期、原生24或96点与时隙。真实值中的null保留为空，不插值，不把小时价扩成96个时段。统一适配器透传实际值、基线、评价模式与mock标记；所有预测曲线为虚线、实际值为实线。
- 组件测试只验证状态与图表参数，不等于实际网站、代理、登录和远端服务端到端验收。缺浏览器权限时不得声称网页已通过。

### 3.9 预测输出目标的台账真值（2026-08-31）

- `supportedTargets` 只表示后端**明确登记**的目标能力：具体权重是已接入输出，runtime 算法是经过真实取数链验证的即时训练/计算范围；缺省或空数组都不能被前端补成“全目标支持”。
- 建模工作台区分两类目标能力：remote/store具体权重显示“已部署输出”，base/neural/deep及KNN显示“即时训练目标”（请求时用真实历史数据拟合/计算，不代表已有持久化权重或历史训练次数）。缺省/空目标不回退全集；平台官方回放不计为训练模型，输入协变量不计入目标数字。
- 工作台目标下拉可先用注册表全集触发目录发现，但最终只显示“当前地区有可见已接入模型”的目标；目录加载中不能当作该目标无模型。

## 4. 联调与排错

常见响应状态判读（联调时先查这张表再报 bug）：

| 现象 | 含义 | 是前端 bug 吗 |
|---|---|---|
| `/api/*` 连不上 / 502 | `.env.local` 的 `DLJY_DEV_API_TARGET` 不可达 | 否，检查配置/网络 |
| `/agent-api/*` 404 或超时 | `DLJY_AGENT_API_TARGET` 没配对（它与 `/api` 是两个端点） | 否 |
| `/api/real?family=…` 404 | 该地区该数据族无真实采集 → 空态兜底 | 否（设计行为） |
| 401 / 403 | 未登录 / RBAC 无权限（你的账号权限受限属正常） | 否 |
| `/agent-api/agent/quant/*` 503 | Python 侧该子服务未就绪 | 否，报给维护者 |
| 页面「智能体服务未连接/响应超时」横幅 | timeout=探活 2.5s 内未应答的假阳性（如 `/forecast/predict` 同步重训占住后端）；unreachable=服务真未起（vite 代理对已宕 upstream 固定回 502） | 否，offline 后每 5/10/15s 自动重探，服务恢复即自愈 |
| 页面白屏 / 控制台异常 | 前端问题 | **是**，带控制台报错提 issue |

## 5. 测试与本地门禁

```bash
npm run lint          # 全量门禁 = 字号令牌检查（scripts/check-font-tokens.mjs）+ ESLint（correctness 最小面 + 分层守卫，0 error 才能提 PR；no-explicit-any 为 warn）+ shared 指纹脚本测试（scripts/shared-fingerprint.test.mjs）
npm run lint:files -- src/foo.ts src/Bar.vue
                      # 仅 ESLint 检查指定改动文件（不含字号令牌检查与指纹测试）
node scripts/check-font-tokens.mjs
                      # 改了 .vue/.css 时另跑：src 下不允许裸 font-size px，必须用 var(--font-*) 令牌（档位见 src/styles/global.css）
npm run check         # vue-tsc 类型检查（0 错误才能提 PR）
npm run test:unit     # vitest：纯函数 *.spec.ts（node 环境）+ 组件 *.component.spec.ts（happy-dom）
npm run test:unit -- src/foo.spec.ts
                      # 直接运行指定测试文件
npm run test:related -- src/foo.ts src/Bar.vue
                      # 根据源码依赖自动运行相关测试
npm run test:coverage # 覆盖率阈值门禁（阈值见 vitest.config.ts）
npm run test:scripts  # scripts/ 下的 node:test 测试（shared 指纹算法）
npm run build         # 生产构建（index + grid-geo 双入口）
npm run build:customer                  # 客户交付版构建（vite --mode customer，内部档专属模块被占位替换）
npm run verify:customer-edition-build   # 扫交付版产物，确认无内部供应商/品牌/后台路径泄露
```

客户交付版的机制、占位替换清单与构建信息文件见 `docs/customer-edition.md`；改到 AI 设置、模型服务、平台后台迁移入口（`src/features/platformAdminMigration/`）等内部档专属面时，须同时考虑交付版产物。

### 5.1 测试策略

- **分层验证（本仓验证规则的唯一权威，AGENTS.md / CONTRIBUTING.md / README.md 只指向此处）**：开发内循环只跑改动文件 `lint:files` 与相关测试（`test:related` 或指定 spec）；提交前始终运行 `npm run check`，改了 `.vue`/`.css` 另跑字号令牌检查，并按实际影响面补齐 lint 和测试。修改路由、全局状态、公共服务、测试/构建基础设施、依赖或锁文件时视为高爆炸半径，须扩大到对应模块，无法可靠界定影响面时运行全量 `npm run lint`、`npm run test:unit` 与 `npm run build`。
- **全量兜底**：本地不要求为每次小改动重复运行 `npm run test:coverage`。PR CI 固定运行全量 mirror-guard、lint、check、coverage 与 build；相关测试通过不能替代 CI 全量门禁。
- **双 project 分工**：`*.spec.ts` 跑 node project（纯函数/服务层逻辑）；`*.component.spec.ts` 跑 dom project（happy-dom + `vitest.setup.dom.ts`）。node project 里个别 spec 确需浏览器 API（localStorage 等）时，用文件头 `// @vitest-environment happy-dom` pragma 按文件切环境——这是**合法机制**，但仅限 node 文件；`*.component.spec.ts` 天然在 dom project，**不要**再加冗余 pragma（仓内已清理过一轮，勿回潮）。
- **文件头三要素**：守什么不变量 / 坏掉的症状 / issue 号（如有）。新 spec 必须遵循（可参照 `src/services/agent/httpClient.spec.ts`）。
- **断言纪律**：正反双侧断言（happy path + 错误路径都要锁）；边界穷举（NaN / ±Infinity / null / 空串 / 脏 localStorage）；金融数值手算对拍（不用「自身输出回读自身」的伪对拍）。
- **mock 纪律**：`vi.hoisted` + 工厂模式；`vi.stubGlobal` 后必须 `vi.unstubAllGlobals()`；store/composable 的模块级单例用 `resetXxxForTest()` 或直接赋值归位。stub `fetch` 的实现签名带 `(url, init)` 两参，`mock.calls` 才能推导出元组类型。
- **诚实语义红线**（spec 要专门锁这些）：缺数据返 `null` 而非 `0`；未知回落标 synthetic 不伪装 real；失败不缓存；`mock:true`/`sourceType!=='REAL'` 的私有数据必须 throw 而非放行。
- **覆盖率口径**：只统计 `.ts/.js` 逻辑层（`.vue` 计入会稀释全局指标）；阈值 = floor(实测基线) − 2pp，**只升不降**。注意 Vitest 4 的 coverage include 会把未执行文件按 0% 拉进分母——`shared/` 的 .mjs 多数无覆盖，纳入会明显稀释全局指标，故暂不纳管（技术债 §9）。
- CI（GitHub Actions，南洋自托管 runner `[self-hosted, dljy-linux]`，ChenShi-Tech/dljy#3266）跑 mirror-guard + lint + check + coverage + build，PR 必须全绿。runner 上没有 .git：源码以 runner 本机缓存（`~/.cache/ci-src/<仓>`，main push 时回写）为基准经 API 只拉改动文件，基准不可用时整包下载；镜像守卫经 API 读取 PR 改动文件。

## 6. 目录与代码约定

| 位置 | 约定 |
|---|---|
| `src/router/index.ts` | 全量路由，每条必须带 `meta.kind: real\|mixed\|forecast` |
| `src/views/**` | 页面组件；**禁止 import `shared/schema/**`**（分层守卫） |
| `src/components/common/**` | 公共组件权威实现：`MetricTile`（指标卡：数值+单位+tone，`as="button"` 可点击筛选卡）与 `CalloutBox`（说明框：info/warn/danger/mock 四档）为跨域唯一实现（#2954），复盘/中长期各自的同名组件只是薄包装，新页面一律直接用公共版 |
| `src/services/**` | 唯一取数出口；量化 TS 实现是后端 Python 权威实现的镜像，改公式要与维护者确认两端同步 |
| `src/data/navigation.ts` | 侧边栏（顶级分组是合成路径、子项才是真实路由） |
| `src/features/*/config.ts` | 特性开关（报表 / 云南交易 / grid-geo 等） |
| `shared/**` | 与后端共用的规则/schema，**只读**：dljy 是唯一事实源，只经 `npm run sync:web -- --dest ../dljy-web`（在 dljy 仓执行）单向更新，本仓不改（改了会被下次同步覆盖） |
| `vendor/**`、`shared/schema/generated/**` | 上游生成物镜像，**只读**（CI mirror-guard 会拒） |
| `src/attic/` | 停用区：已下架但保留的功能，不参与构建、类型检查与 lint（见该目录 README） |
| `docs/` | 功能与专题文档（客户交付版 `customer-edition.md`、平台后台入口迁移、练习空间、操作导引、市场洞察等），按需查阅 |
| 图表 | 真实呈现纪律：分时值用阶梯线（不做视觉平滑）、连续量直线、预测虚线/出清实线 |

## 7. ESLint 与分层守卫

配置在 `eslint.config.js`（flat config），设计取舍：

- **只取 correctness 规则**（`typescript-eslint` recommended + `eslint-plugin-vue` flat/essential），不引 stylistic/格式类——格式统一交给编辑器，避免海量格式 diff 淹没真实问题。
- **分层守卫是核心目的**（本配置存在的第一理由）：
  - `src/views/**`、`src/components/**` 禁直接 `import shared/schema/**`——schema 是前后端同构契约，视图消费必须经 `src/data/` 出口（如 `captureColumnLabels.ts` 的 re-export）；
  - `src/views/**`、`src/components/**` 禁直接 `fetch`——取数必须经 `src/services/`（散落取数无法统一治理，/pi-api 代理被误删后两页静默 404 即前车之鉴）。`features/` 不拦（geoJsonLoader 拉静态资源属合法），spec 文件不拦（mock fetch 是测试手段）；
  - `src/views/**`、`src/components/**` 禁直接内嵌对话内核 `AgentChatPanel.vue`（白名单 `EMBEDDED_CHAT_ALLOWLIST`，见 §3.4），并禁用已移除的旧全局 AI 面板接口（`useAiPanel` / `usePageInsight` / `AgentSidekick`）。
- **`no-explicit-any` 降为 warn**：存量较多（多为脏数据边界的手写守卫），列技术债渐进清零（§9），不在门禁里制造巨型 diff。
- **`_` 前缀约定**：有意保留的占位参数/变量（接口位置参数、响应式订阅读值等）以 `_` 开头，不按未使用报错。
- `vendor/`、`shared/`、`src/data/generated/`、`src/attic/`、`dist-customer-verify/`、构建产物不在 lint 范围（上游生成物由 dljy 侧门禁管）。

## 8. 任务与协作流

worktree、issue、提交与 PR 格式、合并条件等流程规则一律以 `AGENTS.md` 的「跨仓通用规则」块与工作区 `CLAUDE.md` 为准，本文不重复。本仓补充两点：

- PR 里改了页面或交互时，正文「验证记录」写清怎么验证（截图/录屏欢迎）；验证命令按 §5.1。
- 需要后端改动才能实现的功能：在 `ChenShi-Tech/dljy` 的 issue 里写清需要的接口/字段，先后端后前端；**不要在前端硬造假数据绕过**（违反 Mock 标注纪律）。

## 9. 已知技术债

技术债统一记在 Tech Debt 总账 `ChenShi-Tech/dljy#3085`；动到相关区域时顺手还，不专门开大工程。本节只留仍成立、且改动前值得知道的方向，新增债按总账流程开 issue，不在此扩表：

- **云南面板双家园**：`src/features/regions/yunnan/panels/` 与 `src/views/yunnan/panels/` 并存；方向是统一收进 features 侧，views 只留路由级页面。
- **`src/services/` 根级平铺**：大量 .ts 直接平铺在根下；方向是按域收进子目录（`agent/` 已示范）。
- **巨型 .vue**：仍有多个超 1000 行的页面组件；新页面禁止再写巨石，拆子组件/composable。
- **element-plus 与 echarts 全量引入**：未做按需引入，首包偏大；按需方案需评估与既有主题体系的兼容。
- **tsconfig 收紧**：`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 未开；试跑 `npx tsc --noEmit --noUncheckedIndexedAccess`，存量报错即工作量清单。
- **DOM 重 composables 无测试**：`useEChart` 等无 spec；先抽纯函数（option 构造）再测。
- **`shared/` 覆盖率未纳管**：见 §5.1 覆盖率口径；补测后再纳管。
- **`no-explicit-any` 存量**：动到相关文件时顺手收敛，不专项批量改。
