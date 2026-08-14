# 贡献指南

## 本仓的定位（先读）

本仓是上游平台仓前端的**镜像下游**：

- **同步覆盖区**（上游同步脚本全权管理，含删除）：`src/**`、`shared/**`、`vendor/**`、`index.html`、`grid-geo.html`、`vitest.setup.dom.ts`。你的 PR 改这些是常态；合入后维护者会把改动搬运回上游，再经下一次同步回流。**PR 合并后短期内被一条 `sync: mirror from dljy@…` 提交覆盖重放属正常**（内容不丢，只是换了提交载体）。
- **本仓自有区**（不经同步，直接维护）：`package.json`、lockfile、`vite.config.ts`、`tsconfig.json`、`vitest.config.ts`、`.env.example`、`.gitignore`、README/CONTRIBUTING、`.github/**`。改这些需在 PR 里单独说明动机。

## 三条红线（CI 会拒）

1. **不改 `vendor/`**——上游生成物快照，改了也会被同步覆盖，CI mirror-guard 直接红。
2. **不改 `shared/schema/generated/`**——上游生成物（生成器在上游仓），同上。
3. **改 `shared/` 其它文件必须在 PR 描述显式说明**——这些文件与后端共用（双主），维护者要额外跑后端侧门禁评审，改动理由写清楚能显著加快合入。

## 提交流程

1. 从 `main` 拉分支（命名 `feat/…`、`fix/…`）。
2. 本地五门禁全绿：`npm run lint && npm run check && npm run test:unit && npm run test:coverage && npm run build`。
3. 提 PR：说清改了什么页面/行为、怎么验证；截图/录屏欢迎。
4. CI 绿 + 维护者 review 后合入。PR 保持小而聚焦——大 PR 在双轨同步下冲突概率高。

## 开发约定（与上游一致）

- 页面组件只经 `src/services/` 取数，不直接 `fetch`；agent 相关请求走 `AGENT_API_BASE`（`/agent-api`）。
- `src/views/**` 不得 import `shared/schema/**`（分层约束）；路由必须带 `meta.kind: real|mixed|forecast`。
- Mock 数据必须可见标注（`mock: true` + 页面「模拟数据」提示），不得伪装真实接入。
- 图表遵循真实呈现纪律：分时值用阶梯线、预测虚线/出清实线、不做视觉平滑。
