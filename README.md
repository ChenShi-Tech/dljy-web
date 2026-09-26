# dljy-web

电力现货交易工作台前端（Vue 3 + Vite + Element Plus + ECharts + Cesium）。

本仓是上游平台仓的**前端镜像下游**：`src/`、`shared/`、`vendor/` 等目录由上游单向同步（见 CONTRIBUTING.md 的分界说明），后端服务不在本仓。

**开发前请读 [DEVELOPMENT.md](DEVELOPMENT.md)**——架构与前后端通讯、环境搭建、联调排错表、代码约定、任务协作流的完整指南。

## 快速开始

要求 Node >= 22.12。

```bash
npm ci
cp .env.example .env.local
# 编辑 .env.local：填入 DLJY_DEV_API_TARGET 与 DLJY_AGENT_API_TARGET
#（开发用后端地址向仓库维护者索取；两个地址是两个独立端点）
npm run dev          # http://localhost:5174（端口被占会直接报错，先关掉占用者）
```

登录账号由维护者发放（受限权限属正常——部分管理页与数据会 403/空态）。

## 本地验证（按影响面执行）

```bash
npm run lint:files -- src/foo.ts src/Bar.vue       # 检查改动文件
npm run check                                      # 全仓类型检查
npm run test:related -- src/foo.ts src/Bar.vue     # 自动运行相关测试
# 或：npm run test:unit -- src/foo.spec.ts          # 直接指定测试文件
```

开发与提交前不机械执行全量测试；按改动影响面扩大验证范围，无法可靠界定影响面时再运行全量 `npm run lint`、`npm run test:unit` 与 `npm run build`。PR CI 固定执行全量 lint、类型检查、覆盖率测试和生产构建。详细规则见 [DEVELOPMENT.md §5](DEVELOPMENT.md#5-测试与本地门禁)。

## 目录速览

| 目录 | 说明 |
|---|---|
| `src/views/` + `src/router/` | 路由页面与全量路由表（路由 meta 标注每页数据来源与可信度） |
| `src/components/` / `src/composables/` | 组件与组合式函数 |
| `src/services/` | 服务层：所有取数出口（api 信封、地区上下文、agent 客户端、图表） |
| `src/features/` | 特性包（gridGeo 空间资产、regions 地区扩展、reports、yunnanTrading） |
| `shared/` | 与后端共享的纯同构规则/schema（上游同步，改动须在 PR 里说明） |
| `vendor/` | 上游生成物快照（只读，CI 拒绝改动） |

## 常见问题

- **页面提示「模拟数据」**：平台约定——Mock 数据必须可见标注，属正常。
- **5174 被占**：本仓与既有约定统一固定 5174，`strictPort` 下直接失败；关掉占用进程再启动。
- **/agent-api 请求 404/超时**：检查 `.env.local` 的 `DLJY_AGENT_API_TARGET` 是否可达（它与 `DLJY_DEV_API_TARGET` 是两个不同端点）。

## 相关文档

- [平台后台旧入口迁移清单](docs/platform-admin-entry-migration.md) —— 客户前端旧管理入口的逐项分类与迁移待批准清单（ChenShi-Tech/dljy#3161，任务 11.4）
