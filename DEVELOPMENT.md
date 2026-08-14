# 开发指南（前端 × 后端）

> 本文是 dljy-web 的开发权威指南：架构、前后端通讯、环境搭建、联调、约定与排错。
> 快速开始见 README.md；提交流程与红线见 CONTRIBUTING.md。

## 1. 架构总览

本仓是**纯前端**（Vue 3 + Vite + Element Plus + ECharts + Cesium），后端服务不在本仓，通过 HTTP 访问两个独立后端面：

```
浏览器 ──► Vite dev server (5174)
              │  代理（vite.config.ts server.proxy）
              ├── /api/*        ──► Node BFF        （DLJY_DEV_API_TARGET，默认 127.0.0.1:4174）
              │   /dify-*、/console、/_next 同走此面
              └── /agent-api/*  ──► Python FastAPI  （DLJY_AGENT_API_TARGET，默认 127.0.0.1:8000）
                  （路径会被 rewrite：/agent-api/xxx → /api/xxx）
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
cp .env.example .env.local        # 填 DLJY_DEV_API_TARGET / DLJY_AGENT_API_TARGET（向维护者索取）
npm run dev                        # http://localhost:5174
```

- dev server 只监听本机回环（刻意不开 `--host 0.0.0.0`）；需要给别人演示时再临时加。
- 端口 5174 固定（`strictPort`），被占用会直接报错——先关掉占用者。
- 登录：账号密码由维护者发放；滑块验证拖到最右。权限受限（部分管理页 403 / 部分数据空态）属正常。

## 3. 前后端通讯约定（写代码必读）

### 3.1 取数只经服务层

页面组件**不直接 `fetch`**，一律经 `src/services/`：

- `src/services/api.ts` —— `/api` 面的统一出口：响应信封解析、Token 注入（`Authorization: Bearer`）、**自动注入 `x-region-id` 请求头**（全局地区上下文）。
- `src/services/agentClient.ts` / `studioClient.ts` 等 —— `/agent-api` 面的出口，基址统一走 `AGENT_API_BASE` 常量（默认 `/agent-api`），**不得硬编码 `http://…:8000`**（生产会 404）。
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

### 3.4 智能体聊天面板

`AgentChatPanel.vue` 多处复用；每个接入点必须给**静态且全仓唯一**的 `history-key`，且不得关闭历史持久化（`:persist-history="false"` 被门禁禁止）。

## 4. 联调与排错

常见响应状态判读（联调时先查这张表再报 bug）：

| 现象 | 含义 | 是前端 bug 吗 |
|---|---|---|
| `/api/*` 连不上 / 502 | `.env.local` 的 `DLJY_DEV_API_TARGET` 不可达 | 否，检查配置/网络 |
| `/agent-api/*` 404 或超时 | `DLJY_AGENT_API_TARGET` 没配对（它与 `/api` 是两个端点） | 否 |
| `/api/real?family=…` 404 | 该地区该数据族无真实采集 → 空态兜底 | 否（设计行为） |
| 401 / 403 | 未登录 / RBAC 无权限（你的账号权限受限属正常） | 否 |
| `/agent-api/agent/quant/*` 503 | Python 侧该子服务未就绪 | 否，报给维护者 |
| 页面顶部「智能体服务未就绪」 | dev server 冷启动时探活超时的假阳性 | 刷新即恢复 |
| 页面白屏 / 控制台异常 | 前端问题 | **是**，带控制台报错提 issue |

## 5. 测试与本地门禁

```bash
npm run check          # vue-tsc 类型检查（0 错误才能提 PR）
npm run test:unit      # vitest：纯函数 *.spec.ts（node 环境）+ 组件 *.component.spec.ts（happy-dom）
npm run test:coverage  # 覆盖率阈值门禁（lines 24 / functions 20 / statements 23 / branches 19）
npm run build          # 生产构建（index + grid-geo 双入口）
```

- 新增服务层逻辑应配套 `*.spec.ts`；组件测试用 `src/test/mount.ts` 辅助挂载。
- 覆盖率阈值随上游仓同步，不要在本仓调低。
- CI（GitHub Actions）跑同样四步 + mirror-guard，PR 必须全绿。

## 6. 目录与代码约定

| 位置 | 约定 |
|---|---|
| `src/router/index.ts` | 全量路由，每条必须带 `meta.kind: real\|mixed\|forecast` |
| `src/views/**` | 页面组件；**禁止 import `shared/schema/**`**（分层守卫） |
| `src/services/**` | 唯一取数出口；量化 TS 实现是后端 Python 权威实现的镜像，改公式要与维护者确认两端同步 |
| `src/data/navigation.ts` | 侧边栏（顶级分组是合成路径、子项才是真实路由） |
| `src/features/*/config.ts` | 特性开关（报表 / 云南交易 / grid-geo 等） |
| `shared/**` | 与后端共用的规则/schema（上游同步）；改动须在 PR 描述显式说明 |
| `vendor/**`、`shared/schema/generated/**` | 上游生成物镜像，**只读**（CI 会拒） |
| 图表 | 真实呈现纪律：分时值用阶梯线（不做视觉平滑）、连续量直线、预测虚线/出清实线 |

## 7. 任务与协作流

- **Issue 建在本仓**（dljy-web），会自动/由维护者纳入 org 看板「电力现货交易」统一排期；标题格式 `web: 一句话简述`。
- 分支从 `main` 拉（`feat/…`、`fix/…`），PR 小而聚焦；本仓是镜像下游，合入的 PR 由维护者搬运回上游后经下一次同步回流（你的 commit 可能被 `sync: mirror from dljy@…` 提交覆盖重放，内容不丢）。
- PR 说明写清：改了哪个页面/行为、怎么验证（截图/录屏欢迎）、是否碰了 `shared/`。
- 遇到需要后端改动才能实现的功能：在 issue 里描述清楚需要的接口/字段，由维护者在上游仓排期，**不要在前端硬造假数据绕过**（违反 Mock 标注纪律）。
