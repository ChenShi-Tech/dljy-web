# 贡献指南

流程规则（worktree、issue、提交与 PR 格式、合并条件）以 `AGENTS.md` 的「跨仓通用规则」块与工作区 `CLAUDE.md` 为准，本文只写本仓专属的分界与红线。

## 本仓的定位（先读）

本仓是客户前端的**唯一开发权威**：页面、组件、服务层、样式与前端单测都在这里改，PR 在本仓合并即生效。与上游 `ChenShi-Tech/dljy` 之间只有一条单向同步：

- **只读区**（由 dljy 经 `npm run sync:web -- --dest ../dljy-web` 单向推送，含删除）：`shared/**`、`vendor/dljy-contracts/`。本仓**不改**，需要变更先改 dljy 再同步。
- **本仓自有区**：`src/**`、`index.html`、`grid-geo.html`、`package.json`、lockfile、`vite.config.ts`、`tsconfig.json`、`vitest.config.ts`、`.env.example`、`.gitignore`、README/CONTRIBUTING、`.github/**`。改构建、依赖与 CI 相关文件需在 PR 里单独说明动机。

## 红线

1. **不改 `vendor/`**——上游生成物快照，CI mirror-guard 直接红。
2. **不改 `shared/schema/generated/`**——上游生成物（生成器在 dljy），同上。
3. **不改 `shared/` 其它文件**——契约副本以 dljy 为唯一事实源，本仓改了也会被下次同步覆盖（此条 CI 不拦，靠自觉与审查）。

## 提交流程

1. 按通用规则在本仓 worktree 里建分支。
2. 本地验证按 `DEVELOPMENT.md` §5.1（分层验证）执行。
3. 开 PR：标题与四章节正文格式见通用规则；改了页面或交互时，正文里说明怎么验证，截图/录屏欢迎。
4. CI（`quality-gate`）全绿且行内审查评论处理完，才可合并。

## 开发约定

代码约定见 `DEVELOPMENT.md` §3（取数只经 `src/services/`、Mock 可见标注、地区隔离）、§6（目录与分层）、§7（ESLint 分层守卫）。
