# dljy-web

电力现货交易工作台前端（Vue 3 + Vite + Element Plus + ECharts + Cesium）。

本仓是上游平台仓的**前端镜像下游**：`src/`、`shared/`、`vendor/` 等目录由上游单向同步（见 CONTRIBUTING.md 的分界说明），后端服务不在本仓。

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

## 本地质量门禁（提 PR 前必须全绿）

```bash
npm run check          # vue-tsc 类型检查
npm run test:unit      # vitest（纯函数 + 组件双环境）
npm run test:coverage  # 覆盖率阈值门禁
npm run build          # 生产构建（含 index 与 grid-geo 双入口）
```

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
