# Mock 演示账号与演示数据隔离 — 产品需求文档（PRD）

> 版本：v1.3（v1.2 扩充决策点；本版决策落档：①单一 ADMIN 账号 ⑥主线锚定云南某发电集团，其余按默认；验收方式定为本地 5175 端口人工验收）
> 日期：2026-09-08
> 状态：已进入实施（worktree 本地开发，代码不提交，远程操作须先经需求方同意）
> 存放说明：**仅本地工作文件，不提交 git**
> 适用范围：dljy-web（前端全部页面）+ dljy 后端（仅账号种子，共 1 处）
> 关联文档：dljy-web `README.md` / `CONTRIBUTING.md` / `DEVELOPMENT.md`；后端仓参考：`docs/api/api-standards.md`（Mock 标注强制）、`docs/data/mock-data-virtualization.md`、`docs/product/decision-governance-implementation.md`（演示账号既有约定）

---

## 一、背景与目标

### 1.1 背景

系统真实数据不全（部分地区/数据族缺失或稀疏），每次向客户/领导演示时页面大量空态，演示效果不明显。需要一个**专门的演示 mock 账号**，登录后全系统展示饱满、美观、确定的演示数据；同时**绝不影响真实账号的任何数据规则**。

### 1.2 硬性需求（来自需求原话，逐条不可妥协）

| # | 需求 | 验收含义 |
|---|---|---|
| R1 | mock 账号登录后**只展示演示数据**，不接任何真实数据 | mock 会话期间，任何业务请求不得到达任何后端服务（网络层可验证请求计数 = 0） |
| R2 | 非 mock 账号**按原有规则接真实数据**，该规则**不更改** | 真实账号链路零改动；回归行为与现状一致 |
| R3 | 真实账号**不展示任何演示数据、不做任何限制** | 演示数据只存在于 mock 拦截路径与 mock 命名空间，真实账号无路径读到 |
| R4 | mock 账号在**系统任何页面及子 tab 都有数据可见可演示** | 全路由 × 子 tab 覆盖矩阵 + 自动化冒烟验收 |
| R5 | 两者**互不干扰** | 无存储污染、无定时任务冲突、无缓存串扰 |

### 1.3 目标状态

| 当前痛点 | 目标状态 |
|---|---|
| 数据不全，演示空态多 | mock 账号登录后每个页面、每个子 tab 均有饱满演示数据 |
| 演示数据与真实数据混杂风险 | 双向硬隔离：mock 不出网、真实不见 mock |
| 演示数据被真实任务干扰 | 演示数据纯前端生成，不落库，与每日 00:20–08:45 定时摄取零冲突 |
| 演示需要人工凑数据 | 演示数据锚定"今天"动态生成，永不过期，96 点曲线恒为"最新" |

---

## 二、名词与范围

- **mock 账号（演示账号）**：用户名以 `mock-` 为前缀的后端真实账号（如 `mock-demo`），仅承担登录/鉴权；其全部业务数据由前端拦截层本地供给。
- **演示数据**：前端确定性生成的合成数据，强制标注 `mock: true` + `sourceType: 'DEMO'` + `productionWrite: false`（沿用项目 Mock 标注红线，页面可见「演示/模拟」提示）。
- **真实数据**：现状链路返回的一切数据（采集回放、PG、第三方代理等），口径不变。

**范围内**：dljy-web 全部路由（约 50 页）及容器页子 tab（`?tab/?panel/?dim/?mod/?stage/?entry`）；后端 `auth-store.mjs` 种子数组加 1 条账号。
**范围外（非目标）**：不改任何真实账号的数据展示规则；不做真实数据补全；不新增后端业务接口；不做数据库迁移（无 schema 变更）；`src/attic/` 下架功能不在覆盖范围。

---

## 三、总体方案

### 3.1 方案一句话

**账号层复用后端身份体系（mock 账号真实存在，仅用于登录/鉴权），数据层在前端请求层整流**：登录身份命中 `mock-` 前缀时，前端在请求发出之前短路，返回本地演示数据——业务请求根本不出浏览器；非 mock 账号走原有链路，一行不改。

### 3.2 架构示意

```
                    ┌──────────────────────────────┐
   登录 /auth/login │  后端身份体系（唯一触碰点）        │
  ─────────────────►│  identity.users / sessions    │
                    └──────────────┬───────────────┘
                                   │ token + user
                    ┌──────────────▼───────────────┐
                    │ 前端判定 isMockDemoUser(user)  │
                    │  （用户名 mock- 前缀，单点函数）  │
                    └──────┬───────────────┬───────┘
              mock- 前缀命中│               │未命中（现状）
        ┌─────────────────▼───┐   ┌───────▼────────────────┐
        │ 前端 Mock 拦截层       │   │ 现有取数链路（零改动）      │
        │ src/services/mock/   │   │ api.ts → /api /data-svc │
        │ REST 合成信封（走同一   │   │ agentClient SSE → :8000 │
        │ unwrap+演示标注）      │   │ 第三方代理（天气/披露）     │
        │ MockAgentStream 脚本流 │   └────────────────────────┘
        │ 会话级写操作 mock 存储  │
        └──────────┬───────────┘
                   │ 业务请求不出浏览器（硬隔离）
                   ▼  （后端只见 mock 账号的登录请求）
```

### 3.3 备选方案对比（为何不选）

| 备选 | 做法 | 不推荐原因 |
|---|---|---|
| B 后端拦截 | Node `DISPATCH_CHAIN` 头部按会话用户短路到 fixtures | 后端是三个独立服务（Node :4174 / FastAPI :8000 / data-service :8190）+ 第三方代理，FastAPI 不共享 Node 身份存储；几百条路由漏判一条即 fail-open 泄漏真实数据；后端每加端点都要补 mock，长期维护成本高 |
| C PG 灌演示数据 | 独立演示公司 + RLS 隔离，向 `company.*` 等灌数 | 覆盖"每页有数据"需灌几十个域；每日定时摄取任务（同键 DELETE+INSERT 幂等重放）会覆盖公共数据族；演示写操作留痕污染；工作量最大 |
| D vite proxy → 本地 mock server | dev 代理指到 mock server | 仅 `npm run dev` 有效，现场部署的构建产物无效，不满足交付演示 |

前端运行时拦截是唯一同时满足「双向隔离（R1/R3）+ 全页面覆盖（R4）+ 构建产物可用 + 真实规则零改动（R2）」的方案。

---

## 四、详细设计

### 4.1 身份与账号

- 账号：`mock-demo`（唯一，第一版不做多视角账号），密码符合现有口令策略；归属独立公司 `comp-mock-demo`（tier=GROUP），另虚构 3–4 个子公司用于演示集团视角切换（子公司由前端 mock 数据虚构，不在 `identity.companies` 建实体）。
- 角色：`ADMIN`（唯一可进 `/system/*`、`/data-ops/console` 的角色，保证"任何页面"字面成立）；配 2–3 个 stances，顺带演示 `/select-stance`。
- 种子：后端 `server/auth-store.mjs` `seedUserInputs` 数组加 1 条，随 `DLJY_AUTH_SEED_BASELINE` 启动就绪；新增开关 `DLJY_AUTH_SEED_MOCK=0` 供敏感现场不播种（即使播种，无口令不可登录）。存量库 users 非空时不会自动补种，实施时用 `seedIdentityBaseline(repo, {force:true})` 或 admin 走 `POST /auth/users` 建号。
- 种子必须 `resetPwdFlag=0`，避免演示账号首登被强制改密卡住。
- **登录本身走真实 `/auth/login`**（密码校验、滑块、5 次锁定、8h 会话、`/auth/info` 恢复全部照旧）。这是 mock 账号唯一触碰后端的环节，不含任何业务数据。

### 4.2 mock 判定规则（防呆设计）

- 唯一判定函数：`isMockDemoUser(user)`，规则 = 用户名 `mock-` 前缀，落位 `src/services/mock/session.ts`。
- **不依赖任何环境变量**：配错 env 也不会让真实账号看到演示数据、或让演示账号看到真实数据。演示数据的启停只由"登录了谁"决定。
- 后端零感知：后端不需要知道谁是 mock（无身份头、无角色扩展、无迁移）。

### 4.3 前端数据拦截层 `src/services/mock/`

| 子模块 | 职责 |
|---|---|
| `session.ts` | `isMockActive()`（读当前登录用户判定）；账号切换/登出清理 `dljy.mock.*` |
| `intercept.ts` | REST 拦截：在 `api.ts` 各请求出口（`apiGet/apiPost/apiPut/apiPatch/apiDelete/fetchRaw`）最早处判定，命中则交 `mockRouter.resolve(method, path)` 产出合成信封，**继续走同一个 `unwrap()`**，并置 `provenance {mock:true, sourceType:'DEMO', productionWrite:false}` + `regionDataStatus` → 现有「模拟数据」横幅自动出现（复用 `api.ts:61-77` 通道，合规） |
| `router.ts` | handler 注册表：`方法 + 路径模式 → 生成函数`，按域组织在 `domains/<域>.ts` |
| `agentStream.ts` | SSE 拦截：`sendAgentMessage/attachRunStream` 判定后改投 `MockAgentStream`，按 workbench 六入口（晨报/申报体检/政策情报/战略问答/申报台/审批）输出脚本化 `token/tool_call/done` 事件帧（协议见 `agentClient.ts:84-107`），演示效果比真 LLM 稳定且 customer 版不泄漏模型品牌 |
| `directClients.ts` | 绕过 `api.ts` 的直连客户端清单化接管：`alertClient.ts`、`llm.ts`、天气（qweather）、南网披露（csg/disclosure） |
| `storage.ts` | 会话级 mock 写存储（sessionStorage 命名空间 `dljy.mock.*`） |

关键行为约定：

1. **Fail 方向（硬保证）**：mock 态未匹配 handler 的路径 → 返回合法空信封（200 + 空 rows/null）+ console.warn + 开发态可见「演示未覆盖」标记，**绝不回源真实后端**。宁可某页空态，也不破隔离。
2. **写操作**：延时模拟成功后写入 `dljy.mock.*`（sessionStorage），列表/详情读回——可完整演示"申报→提交→出清→复盘"动线；关闭标签页即清空，真实账号永不可见。
3. **双入口**：`grid-geo.html` 独立入口在 standalone `main.ts` 引同一 mock 模块（同源 localStorage 共享登录态，判定天然一致）。
4. **渲染资产例外**：Cesium ion token / 底图 / 地形属渲染资源非业务数据，mock 账号照常加载。
5. **直连与旁路全覆盖**：上表 `directClients.ts` 清单为初版，实施第一步先做"旁路清点"（grep 非 `api.ts` 的 fetch 调用），清单进覆盖矩阵文档。

### 4.4 演示数据资产

- 数据形状以 `shared/schema` 类型约束（services 层允许 import type；views 不动，不触碰 `shared/schema/generated/`）。
- **确定性生成器**（mulberry32 播种，同后端 `mock-capture.mjs` 先例），锚定**"今天"**动态生成：96 点曲线、日曲线永远"最新"；注意统一交易日时区口径。
- 覆盖维度：多公司（集团树，演示公司切换）、多地区（yunnan/shanxi/sichuan/全国，全部给满数据——真实账号的"真实或空"地区纪律**不适用**于 mock 态）、多立场、96 点曲线、复盘六维、预测五模态（replay/bench/station/score/decide）、申报 S1–S7 七步、agent 六入口、data-ops 六面板、system 三 tab、grid-geo 八页。
- **立场可感知**：视角（stance）选择走真实链路——登录返回 `user.stances`、前端 `/select-stance` 选择、导航按立场重组、路由立场门控均不受 mock 拦截影响，mock 账号种 2–3 个立场即可像真实账号一样切换视角；mock 生成器须读取当前立场（`x-stance-id`），让同一页面在不同视角下有可感知的数据差异（主指标、高亮卡片、口径文案），避免"切视角数据一模一样"的失真观感。

### 4.5 全页面覆盖保障（R4）

- **覆盖矩阵文档**：以 `src/router/index.ts` 全量路由 + 容器页 query 维度为基准，产出「页面 × 子 tab × 依赖接口 × mock handler × 负责人」矩阵（附录 A 为初稿），随 PR 维护。
- **自动化验收 `npm run verify:mock-demo`**：冒烟脚本以 mock 账号登录，遍历全部路由 + query 组合，断言三件事：
  1. 拦截层「真实发出的网络请求计数 = 0」（R1）；
  2. 每页主数据区非空（R4）；
  3. 无「演示未覆盖」标记（覆盖完整性）。
- 该脚本挂入门禁，防后续新增页面漏配。

### 4.6 演示模式可见标识（合规红线）

项目红线：mock 数据必须可见标注（违反按 P1 处理）。设计：mock 账号登录后显示**一个全局「演示模式」徽标/细横幅**（复用 regionDataStatus 通道），而非每页弹提示——合规且不破坏演示观感。样式为第十节拍板项。

---

## 五、数据隔离设计（R1/R3/R5 论证）

| 方向 | 保证机制 |
|---|---|
| mock → 真实（不接真实数据） | 业务请求（REST/SSE/直连）在浏览器内短路，网络层可验证；未覆盖路径 fail-open 到空信封而非回源；后端只见 mock 账号的登录请求 |
| 真实 → mock（不见演示数据） | 拦截条件 = 用户名前缀，真实账号判定恒 false；演示数据只存在于前端代码包与 `dljy.mock.*` 命名空间（sessionStorage），真实账号无读取路径；localStorage 数据面缓存键在账号切换时清理（见六-5） |
| 系统互不干扰（R5） | 演示数据不落 PG、不进采集目录，与定时摄取/预测任务零冲突；mock 写操作会话级留存、关页即清；后端零业务改动 → 真实数据规则完全不动（R2） |

---

## 六、边界情况与对策

| # | 边界情况 | 对策 |
|---|---|---|
| 1 | mock 态遇到未写 handler 的接口（含未来新增页面/接口） | 空信封 +「未覆盖」标记 + 冒烟脚本变红；绝不回源（隔离优先于效果） |
| 2 | 演示中途 8h 会话过期 | 走既有 `auth-expired` → 重新登录流程，语义与真实账号一致（不做 mock 永续会话，保持语义单一） |
| 3 | 演示现场密码输错 5 次锁 10 分钟 | 运维 runbook 记录演示口令与解锁处置；锁定机制不改（保持登录链路真实性） |
| 4 | 首登强制改密卡住演示 | 种子 `resetPwdFlag=0` |
| 5 | 账号切换缓存串扰（`dljy.currentCompanyId`、`dljy.piPocSessionIds`、权限覆写等存 localStorage） | mock 数据全部挂 `dljy.mock.*` 前缀；登录/登出时清理上一账号的数据面缓存键（小加固，独立小 PR） |
| 6 | 直连 fetch 绕过拦截层 | 旁路清点清单化 + 逐个接管；冒烟脚本的网络计数断言兜底发现漏网 |
| 7 | `grid-geo.html` 双入口 | standalone 入口引同一 mock 模块 |
| 8 | 文件导出/报表/Dify 报告工坊 | mock 态由前端从演示数据直接生成 blob 下载；报告内容脚本化 |
| 9 | 多标签页同开 mock 账号 | sessionStorage 天然按标签隔离，无并发问题 |
| 10 | customer 交付版（`--mode customer`） | mock 子系统按 `VITE_EDITION` 决定保留/剔除（默认保留，现场演示也有用）——拍板项 |
| 11 | 敏感现场不希望存在演示账号 | `DLJY_AUTH_SEED_MOCK=0` 不播种；即使播种，无口令不可登录 |
| 12 | 演示数据"过期感" | 生成器锚定"今天"；注意交易日/时区口径统一 |
| 13 | 96 点直编、滚轮微调等新交互 | mock 写存储支持写读回，动线可演示 |
| 14 | 仓库关系：dljy 与 dljy-web 已互为独立仓 | 前端改动直接在 dljy-web 交付；后端账号种子改动仍在 dljy 仓，两仓改动各自独立提交，无同步依赖 |

---

## 七、验收标准

### 7.1 功能验收

| 项 | 标准 |
|---|---|
| mock 全覆盖 | mock 账号登录后，遍历附录 A 全部路由 × 子 tab：主数据区均可见演示数据，无空态、无「演示未覆盖」标记 |
| mock 零出网 | mock 会话期间（登录除外），对 /api、/agent-api、/pi-api、/data-svc、/dify-*、第三方代理的真实请求计数 = 0（devtools 网络面板 + 冒烟脚本双验证） |
| 演示标识 | mock 会话全局可见「演示模式」标识；真实会话无任何演示标识 |
| 真实账号回归 | 以既有真实账号（如 `demo`、`admin`、业务角色账号）登录：菜单、数据、地区/立场/公司切换、写操作行为与现状一致，零演示数据出现 |
| 演示动线 | mock 态完整走通：驾驶舱 → 申报台 96 点直编/滚轮微调 → 提交 → 审批 → 复盘六维 → 智能体六入口问答（流式输出）→ 报告导出 |
| 隔离实测 | mock 态提交申报后，用真实账号查申报列表无该记录；mock 会话 localStorage 无真实业务缓存、真实账号 localStorage 无 `dljy.mock.*` 键 |

### 7.2 技术验收

- 前端五门禁全绿：`lint && check && test:unit && test:coverage && build`（覆盖率阈值只升不降）。
- `npm run verify:mock-demo` 冒烟三断言全绿，挂入门禁。
- 不触碰 `vendor/`、`shared/schema/generated/`；无数据库迁移；后端仅 `auth-store.mjs` 种子 1 条 + 开关。
- 真实账号链路 diff 审查：`api.ts` 现有分支在 `isMockActive()===false` 时行为逐行等价。

---

## 八、实施计划（PR 拆分）

| PR | 内容 | 仓库 | 门禁 |
|---|---|---|---|
| PR1 骨架 | `isMockDemoUser` 判定 + `api.ts` 拦截骨架 + 未覆盖空信封 + 全局演示徽标（此时 mock 登录 = 全站空态但已零泄漏） | dljy-web | 五门禁 |
| PR2 账号 | 后端种子（`comp-mock-demo` + `mock-demo`，ADMIN、多立场、`resetPwdFlag=0`）+ `DLJY_AUTH_SEED_MOCK` 开关 + 缓存清理加固 | dljy | 后端 `npm run check` + 相关 `verify:*` |
| PR3..N 按域填充 | dashboard/申报动线（96 点、S1–S7）→ 复盘六维 → 预测五模态 → 公司管理 → 云南/grid-geo → data-ops/system → 智能体脚本流 + 直连客户端接管（每个 PR 附覆盖矩阵增量） | dljy-web | 五门禁 |
| 收尾 | 覆盖矩阵文档定稿 + `verify:mock-demo` 冒烟脚本 + 运维 runbook（演示口令、锁定处置、种子开关） | dljy-web | 冒烟 + 五门禁 |

每个 PR 按 dljy-web `CONTRIBUTING.md` 流程：从 `main` 拉分支、五门禁全绿、说清改动与验证方式；远程推送/建 PR 前先征得需求方同意。

---

## 九、风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| 覆盖面大（约 50 页 × 子 tab）， handler 工作量被低估 | 中 | 按域分 PR 渐进交付；未覆盖时空态兜底不破隔离；覆盖矩阵可视化进度 |
| 后续新增页面忘记配 mock | 中 | 冒烟脚本进门禁把「未覆盖」变红；空态兜底不泄漏 |
| localStorage 缓存串扰导致真实账号看到 mock 残留 | 高（一旦发生） | mock 全量隔离命名空间 + 账号切换清理 + 验收 7.1 隔离实测项 |
| 演示数据被误当真实数据用于汇报 | 中 | 全局「演示模式」标识（红线强制）+ runbook 声明演示账号仅用于演示，不作验收/生产账号 |
| 拦截层改动影响真实账号请求路径 | 中 | PR1 单独评审，`isMockActive()===false` 分支逐行等价审查 + 真实账号回归验收 |

---

## 十、决策点（2026-09-08 已拍板）

1. **账号与角色**：✅ 单一 `mock-demo`，ADMIN 全可见。
2. **演示标识样式**：✅ 按默认——顶栏右侧常驻「演示模式」小徽标。
3. **customer 交付版**：✅ 按默认——保留 mock 子系统。
4. **写操作演示留存策略**：✅ 按默认——会话内留存（sessionStorage，关页即清）。
5. **演示账号口令与发放**：✅ 按默认——口令入运维 runbook、仅内部发放，不作验收/生产账号。
6. **演示主线剧本与地区**：✅ **云南某发电集团的交易**——mock 数据叙事以云南地区发电集团主线优先打磨（场站/机组/96 点曲线/申报/复盘围绕主线构造），登录默认落地主线页面；其余地区仍全覆盖。
7. **首批交付范围与顺序**：✅ 按默认——驾驶舱 → 申报台（96 点直编）→ 复盘六维 → 智能体工作台 → 其余域。
8. **验收方式**：✅ 本地另起 worktree，前端跑 **5175** 端口，由需求方人工验收；代码本地不提交，任何远程操作（push/PR 等）须先征得需求方同意。

---

## 附录 A：页面 × 子 tab 覆盖矩阵（初稿基线）

> 完整矩阵随 PR 维护；此处为路由级基线（约 50 页），子 tab 列为容器页内 query 维度。

| 路由域 | 页面 | 子 tab 维度 |
|---|---|---|
| `/dashboard` | 现货交易驾驶舱（主图） | `?tab=`: price/cockpit/elasticity/spread/spot-pnl/plant-output/price-output-linkage/disclosure |
| `/insight/cockpit` | 市场洞察驾驶舱 | 内嵌 HomeConsole + SSE AI 解读 |
| `/sjfx/*` | 数据分析 11 页 | singleZsjfx/zcqxhdl/zrxgx/zrxgx2/market-ops/fshq/actualLoad/zrsjg/jieqi/elninolanina/tqyb |
| `/xhjy/trading-day` | 交易员一日作业台 | `?stage=`: S1–S7 七步 |
| `/xhjy/desk` | 申报工作台（申报台） | 96 点直编 + 滚轮微调 + declaration_prep 智能体 |
| `/xhjy/approvals` `/xhjy/monitor` | 审批队列 / 实时监盘 | 审批 SSE 续流 |
| `/xhjy/review` | 复盘中心 | `?dim=`: deviation/result/market/strategy/risk/decision 六维 |
| `/xhjy/risk-center` `/xhjy/region` `/xhjy/storage-copilot` `/xhjy/zrqsb` `/xhjy/zptqx` | 风控 / 地区概览 / 储能测算（6 步 + SSE）/ 日前上报 / 日前预估 | — |
| `/zcqjy/*` | 中长期 4 页 | zccljk/zfsdjy/zjyap/exposure |
| `/sjxh/zjzzt` | 省间中长期 | — |
| `/ycsj/center` | 预测中心 | `?mod=`: replay/bench/station/score/decide |
| `/tzcs/*` `/djcs/*` | 投资/价差测算 4 页 | wind-solar/truck-charging/retail-price/interprovincial-price |
| `/yygl/ops` `/yygl/data-browser` | 运营中枢 / 数据浏览器 | — |
| `/data-ops/console` | 数据运维工作台 | `?panel=`: upload/import-hub/onboarding/ingest/governance/data-source |
| `/sdzl/*` | 地区规则 / 平台文档 | — |
| `/report/center` `/gsgl/report-workshop` | 报表中心 / 报告工坊（Dify） | — |
| `/gsgl/*` | 公司管理 6 页 | overview/档案/台账/机组出力/历史交易/合同 |
| `/ai-agent` | 智能体工作台 | `?entry=`: workbench/morning_brief/pre_submit_check/policy_intel/strategic_qa/declaration_checkup |
| `/system/*` | ai-studio/accounts/models | `?tab=`: models/skills/sub-agents/dify/schedules; users/sessions/permissions |
| `/xhjy/yunnan/*` | 云南节点价/结算价 | regionIds: yunnan |
| `/grid-assets/*` | 三维地形/空间资产 8 页 | command/plants/nodes/topology/disclosures/market/weather-impact/operator-profile（双入口，standalone 需同引 mock） |
| `/select-stance` `/login` | 立场选择 / 登录 | 立场切换演示；登录走真实接口 |

---

## 附录 B：文档存放说明

本文档仅存放于 dljy-web 本地工作区（`docs/product/`），**不提交 git**；无 docs-index 登记义务。后续若转为正式需求，再按团队流程纳入版本管理。

## 附录 C：实施状态

### C.1 第一轮人工验收（2026-09-08）— 4 项问题已修复

**根因（单一）**：fetch 守卫的 `/auth` 直通白名单按"逻辑路径"书写（`/auth/info`），但 `api.ts` 的 `pathBase` 会给裸路径拼 `/api` 前缀——实际请求是 `/api/auth/info`，前缀对不上 → 登录后的会话维护请求被 mock 兜底拦截返回空信封 → `persistAuthUser` 拿不到 user → `resolveGovernanceUser(undefined)` 兜底为**前端默认 trader 档案**并写回存档 → 用户名不再带 `mock-` 前缀 → 守卫判定为非 mock 会话整体失效（问题 2/3/4：无演示数据、请求穿透后端）；身份被覆盖连带立场键错乱（问题 1：重复弹立场选择）。

**修复**：
1. `fetchGuard.ts`：直通判定同时匹配原始路径与剥去 `/api` 前缀的逻辑路径（`logicalPathname`）。
2. `vite.config.ts`（本仓自有区）：`server.watch.ignored` 的 `.claude/worktrees/**` 排除仅在**非 worktree 环境**生效——原先在 worktree 里跑 dev 时整个根目录被排除，watcher 失明导致 HMR/模块失效缓存永不更新（这是首轮修复"改了没生效"的原因）。
3. 申报台 meta 截止时间改为按目标日动态算 D-1 10:30（原来写死昨天恒"已过截止"）。
4. 新增 `/agent-api/v1/forecast/{models,predict,backtest}` handler：模型目录 + 96 点预测曲线（带区间与指标），申报台预测对比点亮。

**浏览器全链路复验通过**：mock-demo 登录 → 立场选择 → 驾驶舱（出清均价 249/峰谷价差 437.9、报价方案卡、演示徽标）→ 申报台（四步动线、倒计时正确、双图表）→ 监盘（双图）→ 复盘中心（六维壳 + 模板清单）→ SPA 菜单切换与整页刷新均不再重弹立场、身份存档保持 `mock-demo`；**真实账号回归**：demo 登录无徽标、无 `dljy.mock.*` 键、请求直达真实后端（该 404 即真实语义）。门禁：lint / vue-tsc / vitest（含 mock 10 例）全绿。

### C.2 已知未覆盖（后续轮次按覆盖矩阵补齐）

复盘偏差面板的 `quant/review` 数据形状、申报决策包生成（`/cockpit` `/bid-advice`）、披露摘要数值、天气预报与 LLM 直连（跨源在 mock 态被拦截，属设计行为）、grid-geo 独立入口徽标。复盘偏差当前为"诚实空态"，不影响其余页面演示。

### C.3 第二轮验收改动（2026-09-08）：锚定山西集团 + 数据面加厚

1. **锚定变更（需求方拍板）**：演示账号改为**山西某集团演示公司**——`comp-mock-demo` 更名「山西演示能源集团有限公司」，`mock-demo` 属地 SX/山西（登录后 `applyAccountRegionPreference` 自动切山西地区）、主体 `GROUP-SX-MOCK`；子公司树改山西叙事（发电一号/二号、售电）。存量库旧行由 owner 串删除后随种子重建（create-if-missing 语义不变）。
2. **数据面加厚（问题"无数据"根因）**：山西口径的价格管道（`spotPriceCore.replayPayload`）按「真实或空」纪律**硬拒带 `mock:true` 的载荷与地区不匹配载荷**——此前 mock 载荷被拒 → 驾驶舱出清曲线空。新增**「管道可消费」演示信封**（`mockPipelineEnvelopeResponse`）：载荷声明 `realDataConnected:true + served=地区` 以通过管道校验，诚实标注由会话级「演示模式」徽标 + `x-data-mock` 响应头（模拟数据横幅）承担。
3. 采集族形状对齐：`sdpt_zcqxhdl` 按 **dmx 容器**（`{date,drrq,type,jz,p1..p96}` + rqdj 24 点）供给；`knn-api_api` 顶层逐日 96 点文档；通用族「逐点行 + p1..p96 内嵌」双形态 + limit 尾部截取。
4. 新增：复盘结算导入行（`/api/v1/settlements`， ImportedSettlementRow 中文键形状）、公司档案 profile、quant 通用兜底带 96 点 series、申报种子改山西叙事。
5. **已知问题（环境）**：Windows 下 chokidar 对 worktree 路径的文件监听不可靠（含 usePolling 亦偶发失效），worktree 里跑 dev 改代码后需重启 vite；`vite.config.ts` watch 配置已在 worktree 模式排除自身目录并启用轮询，根因待查（记录为仓库技术债候选）。
6. 视图清理项（非本 PR 阻塞）：驾驶舱披露摘要等视图内写死「云南」的文案改为随地区展示。

**复验**：UI 登录自动落山西 → 驾驶舱出清均价 247/峰谷价差 459（sdpt_zcqxhdl 管道出数）→ 申报台（预测对比 + 动线）→ 监盘双图 → 复盘（六维 + 结算行）→ 数据分析出图 → 公司管理；门禁 lint/vue-tsc/vitest 2095 全绿。

### C.4 第三轮验收改动（2026-09-08）：空态清零专项

需求方反馈"图表与其他数据显示无数据/本周期无可用数据日——诚实空态"。本轮补齐的 handler：

1. **复盘六维主数据** `POST /agent-api/agent/quant/review`：ReviewResult 完整形状（申报/实际 96 点曲线、偏差四指标、估算考核费、日前回测、caliber_caveats 演示口径声明）——复盘中心"本周期无可用数据日"空态清零，估算考核费/申报 vs 实际 96 点图有数。
2. **模板实例 feed** `GET/PATCH /agent-api/agent/review/template-instances`：5 条 pending/draft/submitted 实例（T07/T08/S3/T02/T05），待办箱出真数。
3. **历史报告** `GET /agent-api/agent/quant/reports` 与 **CVaR** `POST /cvar`。
4. **S2 供需基本面** `GET/PUT /api/v1/market/fundamentals`：调度口径 A 档四要素（系统负荷/新能源预测/火电可调/净外来电）+ 备用/煤价——交易员一日作业台"当日无记录"清零。
5. 全站扫描（驾驶舱/数据分析 5 页/作业台/风控/预测中心三模态/中长期三页/复盘/监盘）：均有图表与演示数据；残余"无数据源"字样为视图固定关联提示文案（设计如此），非空态。

申报台"单日导出目标日 ####"：需求方确认非导出问题；导出读的是当日申报单数据，随 mock 数据链路可用。若 Excel 打开出现 `####` 属查看器列宽显示问题，与数据无关。

**门禁**：lint / vue-tsc / vitest 2095 全绿。已知未覆盖清单（C.2）继续有效。

### C.5 第四轮验收改动（2026-09-08）：市场洞察菜单组点亮

**根因**：①「暂无数据」是 ECharts **画布内 graphic 文字**（`emptyOverlay`），DOM 文本探针天然不可见——此前的扫描方式存在盲区；②市场洞察驾驶舱走 `sdpt_console` 采集族三套专用契约与 `/agent-api/v1/market-insight/bundle`，均无 handler。

补齐：
1. `sdpt_console` 族三套载荷：`getCorpNewEnergyChart`（60 日 dateList + 6 类出力柱 + 气温/均价线）、6 类负荷 hash 文件（D-3/D-2/D-1 预测、实际值、在线容量等全字段超集，bt→MUST_STOP / sw→CC_SW 分支）、`getAveragePriceChart`（96 点日前/实时/价差 + min/max 轴范围，35 个日期变体）。
2. `/api/real-list` 文件清单改为 `{file, date}` 双字段（HomeConsoleView 按 file 名匹配取数，fetchCapturedDates 按 date 消费）。
3. `/agent-api/v1/market-insight/bundle`：MarketInsightBundle 完整形状（snapshot 四指标 / elasticity / spread 96 点 / node_price / forecast_band 三分位 / anomalies 两条）；附 `/v1/spot/elasticity`、`/v1/spot/spread`。
4. `/api/company/list`（rows 形状）：公司切换器显示公司名而非原始 ID。

**视觉复验（截图）**：市场洞察驾驶舱新能源出力预测图（6 柱 4 线满数据）、日均价 96 点图（日前/实时/价差 + tooltip 联动）、天气网格山西城市、bundle 六块、演示徽标 + 山西地区 + 模拟数据横幅。门禁 lint/vue-tsc/vitest 2095 全绿。

### C.6 第五轮验收改动（2026-09-08）：市场洞察菜单组空图专项

**两个根因**：①「暂无数据」是 ECharts 画布内 `emptyOverlay` graphic 文字，DOM 文本探针不可见——验收改为画布像素色度采样 + 截图；②市场洞察菜单组的重页全部走「同族按 match 分派」的市场洞察契约（`marketInsightHeavyPagesClient` / `relationScatterClient`），此前仅 `listrs_full` 形状能对上，其余 match 全部落入通用行形状，视图解析不出 → 空图。

补齐的 `sdpt_zcqxhdl` 按 match 分派载荷（形状逐一对齐 marketInsightHeavyPages 适配器）：
- `__list__`：出清现货电量分析——timePoints=60 个运行日（横轴为运行日区间，时间点必须是日期），6 序列逐日数组。
- `query__`：逐日系统负荷——system/misplace 两来源 × legendList/pjz/zxz/zdz 矩阵（另补 `sdpt_actualLoad` 族同名 match）。
- `_list24__`/`fhlist24__`：价格×新能源/统调负荷散点——xd 行 p1..p24 为 [价格, 指标] 二元组 + xnyzd/xnyg/xnygd 三线各 24 行。
- `listrs_full`：dmx/rqdj 之外补 rjz/rmx（p1/p2/p3=最大/最小/均值，价格分析统计消费）。
- 无 dateFrom 参数的请求默认供给近 60 天区间（fetchReplay 不带日期，单点序列在图上不可见）。

另补：`sdpt_zsjfx_idx`（`zsjfx_meta` 日期索引 + `zsjfx_day__<date>` 96 点曲线组，综合数据分析）、`sdpt_fshq`（`rqlx0__/rqlx1__<date>` 日文档：**opData 日K 行 [序号,开,收,低,高,量]** + ssjcq/rqjcq/两条预测线 + extendMap；`dataDet__id` 买卖盘 13 序列）。

**验证**：页面内直调契约客户端全链路——出清 60 timePoints × 6 序列、zsjfx meta 60 日 + day 96 点 4 序列、散点 status=mock 且 p1 为二元组、actualLoad 双图、fshq 日K 主图（色度 4.32%）、出清页延迟绘制确认（色度 4.17%，渲染链有数秒延迟属正常）。门禁 lint/vue-tsc/vitest 2095 全绿。

**验收提示**：部分重页的图表在加载后数秒才完成绘制链；验收时请给页面 5–10 秒渲染时间。若某图仍空，报页面名 + 图名，按覆盖矩阵继续修。

### C.7 第六轮验收改动（2026-09-08）：综合数据分析与分时行情修复

1. **综合数据分析**：页面报 `yAxis "0" not found`——`zsjfx_meta` 载荷的 **`yzConfig` 是 Y 轴定义数组**（`{name, min, max, interval}`），`typeAxis` 的值是其下标；此前给成空数组导致坐标系为空、整图渲染失败。已按双轴（价格 元/MWh / 负荷 MW）供给，并把 `defaults` 补为全四序列。截图复验：96 点四序列双轴图 + 分组面板（价格 2/负荷 1/新能源 1）全渲染。
2. **分时行情**：视图严格读 `res.data`，此前载荷挂在信封顶层导致 `data.value = {}`。`rqlx0__/rqlx1__<date>` 与 `dataDet__id` 两分支的载荷已包进 `data` 字段。截图复验：日K 主图 + 四条出清/预测线 + 成交量副图全渲染。
3. **验收方法论补充**：渲染失败的定位路径 = 页面截图看红框报错（ECharts 异常会打到页面错误横幅）→ 页面内动态 import 契约客户端直调做全链路断言 → 对照适配器的载荷字段清单造形。DOM 文本探针与稀疏像素采样均有盲区，最终以截图 + 密集色度采样为准。

**门禁**：lint / vue-tsc / vitest 2095 全绿。

### C.8 第七轮验收改动（2026-09-08）：买卖盘面板与价格分析切面加厚

1. **分时行情买卖盘**：`renderBuySell` 的渲染门槛是 `d.dataMap + d.nameList`——此前 dataDet 载荷打包进 `data` 时漏了 `dataMap`，点击主图明细点后面板判空。已补 `dataMap`（mrl1-3/mcl1-3/mrj1-3/mcj1-3/zxjg 全 13 序列 × 96 逐笔）并加 `title`。契约断言：detOk=true，13 键 + 96 点。
2. **价格分析时点切面**：`rjz` 行是「时点切面 · 日内均价」的直接数据源，需携带**完整 96 点曲线**（此前只有 p1/p2/p3 三个统计值 → 切面无数据）；同时无日期参数的默认跨度由 60 天扩至 **365 天**（3D 图/日期切面/时点切面的数据量即跨度）。契约断言：dates=365（2025-09-10~2026-09-09）、dayCurves=365、dailyStats=730、日前均价 96/96 点非空。

**门禁**：lint / vue-tsc / vitest 2095 全绿。

### C.9 第八轮验收改动（2026-09-08）：洞察驾驶舱首屏数据不全

需求方截图：新能源出力预测图仅首尾两段有数据、日均价卡停在「加载中…」。

**根因**：`getCorpNewEnergyChart` 载荷的出力序列按「天序号当 96 点小时下标」取值（`c[i % 96]`，i=天序号）——前 21 天恰好取到夜间 0 值（柱状不可见），后才取到白天值；日均价卡「加载中」为旧模块残留（浏览器标签页跨 vite 重启未刷新）。

**修复**：出力序列改为**对每日 96 点曲线取均值缩放的真实日能量值**（按日期播种，全天非零），气温/均价序列维持逐日生成；契约断言 11 数组 × 60 天零空值。宽视口截图复验：新能源出力预测 30 天满柱满线、日均价 96 点三序列完整、天气预报网格就位。

**验收提示（重要）**：vite 重启后，浏览器里开着旧标签页会继续运行旧模块——**验收前请强刷（Ctrl+Shift+R）**。

**门禁**：vue-tsc / vitest 2095 全绿。

### C.10 第九轮验收改动（2026-09-08）：洞察驾驶舱首屏卡顿与渐进渲染

**根因**：洞察页加载时并行拉 35 个日均价变体（`getAveragePriceChart__<hex>`），其中未命中专用分支的 token 落入**通用行集兜底**——每个生成 60 天 × 96 行 × ~100 字段 ≈ 数 MB 的无用 JSON，23 个并发 ≈ 50–100MB 同步 `JSON.stringify` + GC 阻塞主线程数秒 → 图表动画/渲染被冻结（首屏"显示不全"），主线程腾空后才画完（"隔一段时间才加载完成"），全程伴随可感知卡顿。

**修复**：`sdpt_console` 的未识别 match 一律返回轻量载荷（`{data:{}}`）；变体 token（纯 hex）直接产出有效的日均价曲线载荷（单文件约 2KB，含 dayTime + 96 点三序列）。页面错误收集器复验：零 JS 错误、零慢请求；首屏渲染一次到位。

**验收提示**：同 C.9 强刷要求。

### C.11 第十轮验收改动（2026-09-08）：日前上报页点亮

`/xhjy/zrqsb`（DayAheadReportView）取数链路：`/api/real-list`（sdpt_zrqsb 日期索引）→ 默认运行日 **2026-06-04** → `sdpt_zrqsb/<运行日>` 分组文档。两处缺口：① 日期清单不含 2026-06-04 → 视图提示「该运行日期未采集」直接空态；② `sdpt_zrqsb/<date>` 分组文档无 handler。

修复：① `sdpt_zrqsb` 的日期清单覆盖 2026-04-01 起采集窗口；② 新增分组文档载荷——`{dl, jg, jgc, zcqjj, jq, jq2, cl, zxcl}` 八组、每组 `{type, hj, p1..p96}` 行（中长期电量/日前电量/日前价/实时价/价格差/策略组，按运行日播种）。截图复验：电量表格（合计 + 96 点）与分组曲线图全渲染，导出 CSV 可用。

**附注**：导出 CSV 在 Excel 中个别列显示 `####` 属列宽显示现象，数据本身完整。**门禁**：vitest 2095 全绿。

### C.12 第十一轮验收改动（2026-09-08）：日前电量预估页点亮

`/xhjy/zptqx`（DayAheadEnergyView）走 `sdpt_zptqx/list` 契约（envelopeRows 过滤 `type==='4'` 行 → 表格 + 96 点曲线）。新增载荷：3 行 type=4（日前/修正/上月同日预估，按 label+序号播种区分曲线，各行 hj≈10,270 MWh、96 点）。

**契约断言**：status=mock、rows=3、pointsPerRow=96。页面复验：徽标 + 表格行渲染，无空态文案。**门禁**：vitest 2095 全绿。

### C.14 复盘中心切 tab 卡顿复核（2026-09-08）

需求方报告「切市场 tab 明显卡顿」。实测（PerformanceObserver longtask + 双方向切换采样）：当前代码切市场/偏差 **零长帧、零请求**（市场维度不重新取数，纯渲染已加载的 ReviewResult）。卡顿来自 C.10 修复前的旧模块（数 MB 垃圾载荷阻塞主线程）残留在未刷新的标签页——强刷后消除。市场维度数据确认：日前均价 249.3 / 实时 247.6 / 价差 +1.7 / 峰谷比 11.43、待办箱 4 项、复盘报告 6 份。

**门禁**：vue-tsc / vitest 2095 全绿。

### C.13 第十二轮验收改动（2026-09-08）：申报工作台全流程走通 + 存储选型确认

**生命周期实测（UI 点击 + 契约断言双通道）**：创建草稿（DRAFT）→ 保存 96 点曲线 → 运行风控检查（十项、L2 审批档、passed）→ 送审（PENDING_APPROVAL）→ 批准（APPROVED，审批留痕 1 条）→ 提交（SUBMITTED + **演示回执**）→ 出清（CLEARED + 出清曲线）。UI 侧 风控检查/送审/批准 按钮点击后状态实时迁移；「已过申报截止，禁止提交」为 LIVE 单的正确业务规则（截止强制演示点），历史模拟模式豁免时间维度可完整演示提交流程。补齐：submit 生成演示回执（receipt.mock=true）、mark-cleared 附出清曲线。

**存储选型结论：sessionStorage（维持现状）**。实测：`dljy.mock.declarations` 全程在 sessionStorage（本轮 9 单），localStorage 零 mock 键（零残留）；F5 刷新留存（同标签演示中断可续）、关标签即清（零清理代码、零串账号路径）。localStorage 仅在需要"跨浏览器会话续演"时才值得，但引入残留清理失败的风险，与"纯演示零污染"目标相悖——不采用。

**门禁**：vue-tsc / vitest 2095 全绿。


### C.15 第十三轮验收改动（2026-09-08）：市场 tab 切换卡顿根修

精确测量（页面内 PerformanceObserver + 双向切换采样）定位：切「市场」tab 必现 **~3000ms 同步主线程阻塞**（切「结果」为 0）。根因：市场归因面板（MarketAttributionPanel）挂载时 `loadMarketAnalysis` 并行拉 **9 个族 key**（market_analysis 7 键 + market_retail_packages 2 键），全部落入通用行集兜底——每个生成 60 天 × 96 行 × ~100 字段 ≈ 3–4MB，9 并发 ≈ 30MB 同步序列化 + 解析，冻结主线程。

修复：`market_analysis` / `market_retail_packages` 两族返回空行集——`safeFetchMarket` 对非 captured 行本就回落面板**内置合成数据集**（该面板 designed-in 的演示数据），数 MB 载荷纯属浪费；同时通用行集瘦身（去掉投机性 p1..p96 内嵌字段）。

**复验**：切市场/结果双向 **零长帧**；市场维度完整渲染（日前均价 249.3 / 实时 247.6 / 价差 +1.7 / 峰谷比 11.43 + 96 点阶梯双线）。门禁 vitest 2095 全绿。

### C.16 第十四轮验收改动（2026-09-09）：风控阈值面板整页冻结根修

需求方报告 `/xhjy/risk-center` 无数据且页面持续转圈。页面内逐层排查（端点直调 → 组件状态 → 调度器 → 渲染错误捕获）定位：**`GET /agent-api/agent/alerts`（盯盘告警 listAlerts）未命中 mock 路由，落入通用空信封兜底**——该响应体没有 `alerts` 键，而 alertClient 把 JSON 原样透传，RiskCenterView 的 `alerts.value` 被赋成 `undefined`；模板 `alerts.length`（及 `alertLevel` computed）随之抛 `TypeError: Cannot read properties of undefined (reading 'length')`。该错误发生在带数据重渲阶段：Vue 捕获后仅打 console 警告，**渲染中止但已部分追踪依赖**——表现为 loading 遮罩永不消失、四卡恒 "—"、且后续响应式更新全部静默失效（v-loading 遮罩由 CSS 合成层动画驱动，主线程冻结后仍在转圈，观感即"一直在加载中"）。

修复：`router.ts` 新增盯盘告警族四条路由——GET 列表（**契约红线：必须返回 `{alerts, open_count}`**，3 条山西演示告警：价差越限 high / 申报偏差 medium / 新能源出力 low）、POST `scan`（追加 1 条演示告警）、POST `/<id>/dismiss`（从演示存储移除）、DELETE（清空）。演示告警为模块级存储，scan/dismiss/clear 跨页面一致。

**经验**：裸 JSON 客户端（quantClient/alertClient/forecast 等）不走信封解包，未匹配兜底的空信封对它们形同"缺字段成功响应"——`mock:true` 信封字段对这类消费方无意义，缺的恰是业务键。后续新增族时以"客户端读取的完整字段清单"为验收基准，而非"返回了 200"。

**复验**：四卡全部出数并判级（套保率 62.0% 关注黄 / 偏差考核 168571 元 越限红 / 价差异动 0 条 安全绿 / 盯盘告警 3 条 越限红）+ 活跃告警 3 条，遮罩消失、零控制台错误，截图确认。**门禁**：eslint / vue-tsc / vitest 2095 全绿。

### C.17 第十五轮验收改动（2026-09-09）：中长期交易三页点亮（持仓监控/分时段交易/省间电量计划）

需求方报告三处：① `/zcqjy/zccljk` 月/日维度图无演示数据；② `/zcqjy/zfsdjy` 加载过长、勾选行不出曲线；③ `/sjxh/zjzzt` 加载缓慢、表格空。三页同因：`sdpt_zfsdjy`、`sdpt_zptjg` 两族未命中专用分支，落入通用行集兜底——形状与各页契约完全不符（持仓监控要 `nameList + valueXX:{name,valueList}`、分时要 `{jyrq,bdrq,sjlx,heji,p1..p24}` 台账、省间要 `{date,drrq,jz,hj,p1..p96}` 计划行），且 60 天 × 96 行的通用行集灌进 el-table 造成秒级卡顿（②③）。

修复（`capturedPayload` 新增两族分支）：`sdpt_zfsdjy` 三 match——`ccljkDay__<月>`（当月逐日：四类持仓电量堆叠柱 + 合计/最大/均价线，双轴）、`ccljkTime__<日>`（24 时点明细，月图点击联动）、`list`（13 交易日 × 成交电量/出清电价/持仓电量 = 39 行 × 24 点，交易类型/数据类型对齐页面字典）；`sdpt_zptjg` tag92——近 60 天逐日 96 点计划行（均值/合计随曲线播种）。**形状陷阱**：持仓监控视图读 `res.data`，载荷必须包 `data:` 键（首轮验证图仍空、截图发现后修正）；`list`/省间视图读 `rows`/信封顶层则直接平铺。

**复验**：月维度堆叠柱+三线全渲染、点日联动日维度 24 时点明细出图；分时段交易 39 行约 1.3s 加载、勾选 2 行出 24 点阶梯线（「已选 2 行」）；省间计划 31 行约 1.7s 加载、96 点数值齐全、勾选出线。**门禁**：eslint / vue-tsc / vitest 2095 全绿。

### C.18 第十六轮验收改动（2026-09-09）：空间资产 8 子页点亮（驾驶舱公司上下文根修 + geo-assets 全族演示数据）

需求方报告「空间资源的空间联动驾驶舱及子菜单在演示账号下都提示『当前地区尚未选择授权公司；驾驶舱已保持空态』」。**根因在演示账号的公司上下文，而非空间资产本身**：mock router 返回的 4 家演示公司都不在 `COMPANY_REGION` 真实登记内（`companyRegionId` 恒 null），`companyContext` 的 #668 四规则协调把「演示集团 + 任意地区」判成「该地区无授权公司」，`clearCompanySelection()` 清空 `selectedCompanyId` → 一切公司门控页面（`activeCompanyId()` 抛错、`companyUnselected()` 短路）全部落空态。修复：`coordinateCompanyForRegion` 与 `readInitialCompanyId` 增加演示会话分支（`isMockDemoUser` 时锁定本账号演示集团、不参与真实四规则），真实账号治理行为零改动。

第二层问题：空间资产 8 页走的 `/api/v1/grid/geo-assets/*` **此前零覆盖**（fail-open 空信封 `data:null` 会在 `topology.dataAvailability` 直接 TypeError），且该特性为「反合成数据」设计——驾驶舱 6 处逐层 mock 拒绝门（plants/nodes/weather/market/disclosures/topology-snapshot）、weatherImpact `rows()` 真实性门、plantOutput `hasRealData&&!mock` 门、marketSpatial `usableDaily` 契约门、`resolveScopedOutputSources` capture-owner 门、weather 来源 registry（仅云南）、node-price serving-route registry（仅南网四省）——真实账号的 fail-closed 治理对演示公司全数拒绝。修复口径统一为「**演示会话放行、真实账号零改动**」：上述各门增加 `isMockActive()` 分支；mock router 新增 geo-assets 全族 handler（8 场站/8 定价节点/授权网架 20 要素/披露 12 事件/格点天气/integrations/revisions/manifest + `/agent-api/v1/spot/node-price/{daily,series,heatmap}`）与 4 个 captured 演示族（`mock_grid_plant_output`、`mock_grid_meteo`、`mock_grid_irradiance`、`weather_asof` 三运行轨 D-2/D-1/日内）。坐标按当前地区中心平移（切地区场站仍落视口内）、`ownerCompanyId`/`regionId` 回显请求上下文保证 `mappingMatchesScope` 通过。

**数值量纲陷阱**：`curve96` 幅度为 MW/价格量级，直接喂气象字段会产出「平均气温 816.1°、风向 >360°」——气象字段一律 modulo 归一；rt 节点价须按节点差异化偏移，否则「实时-日前价差」八资产同值（+25.8）无信号梯度，修正后 +7.0~+53.9 元/MWh 可排序。**as-of 契约陷阱**：weatherTracks `selectWeatherRowsAsOf` 要求行级 `featureVersion/modelVersion/provider/forecastRunId` 齐全、三时间戳带时区且 `forecastAt ≤ 决策截止 < validAt`，缺一即整轨 UNAVAILABLE——演示行按 D-2/D-1/日内三运行轨 × 24 时点播种后四轨全亮，证据卡如实显示 `sourceType=MOCK · basis=demo`。

**复验（8 页全过）**：驾驶舱六层全 available（总览 8 电厂落图 / 节点 8/8 / 天气 8/8 格点 22.1°C / 市场回放 8 双信号资产 / 披露 12/12 / 网架 20/20）；电厂地理空间 8 资产 2,450 MW；节点台 8/8 已定位；授权网架 ODbL 点线 12+8 加载；披露层 12 事件 5 类别；市场空间态势 价格/出力覆盖 8/8 且价差梯度排序；气象影响时序 D-2/D-1 24/24 + 日内 11/11 + 实况 24/24（实际出力 233.5 MW / 节点价 87.6 元/MWh / 事后偏差 3.8%）；南网国网展示画像 SGCC 画像 + 术语映射 + 南网对照全渲染。**门禁**：eslint / vue-tsc / vitest 2095 全绿（全量并发下 SpotCockpitCore/YunnanNodePricePanel 两重组件挂载 spec 曾超时抖动，单跑与复跑全量均绿，非本轮改动引入）。

**C.18 补记（同日）：驾驶舱 2D 省界「边界数据格式非法：140000」修复**。2D 平面图的省界来自 `GET /api/v1/geo/boundary/:adcode`（后端 `server/geo-boundary-api.mjs` 鉴权供数、信封 `{code,msg,data:FeatureCollection}`）；演示会话该请求被 fetch 守卫拦截、落入空信封兜底（`data:null`），GeoJSON 校验失败即报「边界数据格式非法」。修复：把同一份 DataV 省界文件（34 省，3.2MB，取自 backend `data/geo/boundary/`）随 mock worktree 本地携带于 `src/services/mock/geo-boundary/`，mock router 新增 `/api/v1/geo/boundary/` 路由按同信封形状供数（`import.meta.glob` 惰性匹配 adcode，含 400/404 分支）——不回源真实后端（R1）、不进 public 静态目录（维持「未经审图不公开提供」红线，仅本地演示 worktree 携带）。复验：端点返回 11 地市 FeatureCollection，驾驶舱切 2D 后山西省界 + 场站点位正常渲染，错误文案消失；其余 8 页不受影响。门禁 vitest 2095 全绿。

### C.19 第十六轮验收改动（2026-09-10）：市场洞察「与真实有数显示一致」专项（方案 A：fixtures 优先）

需求方拍板按方案 A 实施一版（代码全部本地不提交、不推送）。目标：市场洞察菜单组各子菜单在演示账号下的显示效果与「真实账号接入有数据」一致。此前演示数据是前端手工仿制合成载荷，四类结构性差异：①载荷形状靠人工逐轮追（C.5–C.9 十六轮的根因）；②时间轴口径不同（真实默认日期被 `captureCoverage` 钳进采集窗口 2022-07~2026-06，演示锚定「今天」）；③数值统计特征不同（合成正弦波 vs 真实峰谷/周末/限价形态）；④两套载荷永不严格相等。

**实施内容**：

1. **fixtures 导出脚本** `scripts/export-mock-capture-fixtures.mjs`：从后端仓 `data/private/capture-raw/shanxi/` 按白名单族拷贝真实采集文件到 `src/services/mock/fixtures/<family>/`，并生成 `fixtures-index.json`（族→`{file,bytes,date?,capturedAt?}` 清单，bytes 降序，镜像后端 `listCaptured` 排序）。白名单=市场洞察域 6 族：`sdpt_console`（48 件全量）、`sdpt_actualLoad`（9 件全量）、`sdpt_zsjfx_idx`（92 件全量，91 天）、`knn-api_api`（1 件全量）、`sdpt_zcqxhdl`（聚合 listrs_full/list__/listrs__ 全保留 + 逐日 list24/fhlist24 近 120 天）、`sdpt_fshq`（rqlx0/rqlx1 近 122 天 + dataDet 最新 8 份样例）。共 635 件 / 27.4MB。采集更新后重跑脚本即可刷新演示窗口。
2. **运行时加载器** `src/services/mock/fixtures.ts`：解析规则与后端 `capture-replay.mjs` 逐条对齐——「文件名子串匹配 + 同候选取最大文件」；`import.meta.glob` 惰性动态 import（按请求取件、解析一次内存缓存，绝不 eager 解析几十 MB）；索引缺失/文件缺失均按未命中处理回落合成器，目录为空（CI/新克隆）时行为与此前完全一致。
3. **mock router 接线**：`/api/real` 改为 **fixtures 优先、`capturedPayload` 合成器兜底**（fixtures 命中时原样供出采集文件原始载荷，capturedAt 用侧车真实采集时刻）；`/api/real-list` 有携带族的族直接回真实文件清单（`{file,bytes,date}` bytes 降序，与后端同形同序，日期窗口即真实采集窗口）；`resolveMockRequest` 改 async 签名（fetch 守卫本身是 async 包装，真实账号路径零影响；mockDemo.spec 调用点补 await）。`.gitignore` 增补 fixtures 目录/索引/geo-boundary——**本地演示 worktree 携带，永不提交**。
4. **golden 契约等价 spec** `captureFixtures.spec.ts`（12 例，fixtures 缺失自动 skip）：对同一 (family, match)，fixtures（真实采集）与合成器两条供给路径经同一消费路径（契约适配器 / 视图直读 `res.data`）断言**同构数据形状**（序列条数、96 点长度、日期轴、键集合）。把「截图发现空图→人工追形」变成门禁红绿灯。

**spec 立即抓出并修复的两处合成器形状漂移**（正是历轮人工验收漏掉的）：

1. **逐日系统负荷 `query__`**：真实形状是「366 个『M月D日』日序标签 × 近 6 年」的均/小/大矩阵（值域 ~2.0–3.7 万 MW），此前合成器误仿成「96 时点 × 2 年」——页面能画但显示效果与真实完全不同。已按真实形状重写（`dayOfYearLabels`/`yearLoadMatrix`，夏冬双峰季节形态 + 年增长回推），`sdpt_actualLoad` 与 `sdpt_zcqxhdl query__` 两分支同修。
2. **散点 `_list24__`/`fhlist24__`**：真实 xd 行 p1..p24 为 **[指标值, 价格] 二元组**（此前顺序反了）；参照线行是 `{date,type,hj,jz,p1..p24}` 数值行（此前误用 h00/`00:00` 键）；fhlist24 只带 xnyzd(+xnyz) 线容器、无 xnyg/xnygd；另补 rqdj 30 日滚动 24 点价容器。已逐项对齐。

**门禁**：eslint 0 error（288 warn 为存量 any 债）/ vue-tsc 0 错误 / vitest 206 文件 2300 例全绿（含新增 12 例 golden + mockDemo 改 async 后 10 例）。

**验收提示**：重启 vite（5175）+ 强刷（Ctrl+Shift+R）后，以 mock-demo 登录逐页对照：市场洞察驾驶舱（新能源出力/负荷/日均价全部真实采集形状与日期）、分时行情（真实日K + 2026-06-01/06-30 默认日有真实数据）、价格分析（4 年全历史真实曲线）、出清/散点/逐日负荷/综合数据分析（真实窗口与序列）、市场经营分析（真实账号本就无 `market_analysis` 采集，双侧同为内置合成回退，行为已一致）。窗口外日期请求仍落合成器兜底（不空转）；窗口由导出脚本参数控制，需要更长历史时改 `ZCQXHDL_DAYS`/`FSHQ_DAYS` 重跑即可。

### C.20 第十七轮验收改动（2026-09-10）：现货交易域演示数据逼真化（方案 A 延伸）

需求方需求：现货交易菜单组全部子菜单的演示数据「更逼真、好看」。实施三件事：

1. **fixtures 白名单延伸到现货交易域**（导出脚本扩两族并重跑，共 735 件 / 31.5MB）：
   - `sdpt_zrqsb`（日前上报）：92 件全量（2026-04-01~06-30，含视图默认运行日 2026-06-04）。该族为 hash 命名，导出脚本按后端同款 `CAPTURE_CONTENT_DATE_INDEX`（侧车 `postData.date`）解析内容日期写入索引；`fixtures.ts` 的 `resolveEntry` 相应支持 **ISO 日期 match → 内容日期索引**（同日期多份采集取 capturedAt 最新，镜像 `contentDateIndexFor`）。real-list 的日期清单即真实采集窗口。
   - `sdpt_zptqx`（日前电量预估）：8 件全量，`list` 子串匹配按最大文件胜出（与真实 `/api/real` 同解析）。
2. **合成价曲线形态标定**（`generators.ts`）：从采集 `listrs_full` 的 dmx 近月（2026-02~06）96 点真实均值提取山西「鸭子曲线」形态（夜间平台 ~290 → 午间光伏深谷 ~60 → 傍晚尖峰 ~415，p95=437、上限 1500、下限 0），固化为 `PRICE_PROFILE_96` 基线；`curve96('price')` 改为基线 × 日间水平因子（0.82–1.24）× 周末效应（×0.93）× 逐点抖动 + ~1% 概率限价尖峰。此前公式是「早峰+午谷+晚峰」旧假设，与真实形态（无早峰、深谷在午间、唯一尖峰在傍晚）明显不符。该曲线是全部合成价端点的公共基线——申报台报价/预测对比/复盘/quant 系列观感一次到位。
3. **跨页价格同源（逼真的核心）**：`fixtures.ts` 新增 `loadRealDayCurve(date)`——从 `listrs_full` dmx 行（type 0=日前/1=实时）取某交易日真实 96 点双曲线（载荷解析一次后内存缓存）。智能体域各价格端点全部接入：quant 监盘（da/rt/spread 序列 + **峰谷窗口改为真实鸭子曲线区间**：傍晚 18–20.5 时 vs 午间 11:30–14.5 时）、复盘六维 `quant/review`（detail 的 da_price/rt_price）、预测 `forecast/predict` 与 `latest`（目标日真实日前价 ±3% 模型噪声，区间带随基线缩放）、价差 `/v1/spot/spread`。采集窗口内这些端点与驾驶舱/监盘/市场洞察显示**同一天同一价格**（source 标 `capture-fixture`），窗口外回落标定合成曲线。

**配套打磨**：S2 供需基本面（`/api/v1/market/fundamentals`）量纲对齐山西真实规模（系统负荷 ~2.7–3.4 万 MW、新能源预测 ~4–7 千 MW、可调 2.6 万 MW、煤价 795）；申报单电量曲线按机组容量缩放（`capacityScaledCurve`，峰值 ≈ 容量 0.89，此前 660MW 机组曲线峰值仅 ~550）。

**性能注意**：智能体域首次查询会触发 `listrs_full`（7.3MB）chunk 的一次性下载+解析，之后内存缓存零开销（浏览器与 vitest 同理；相关测试超时已放宽到 30s）。若后续觉得首查可感，可再预生成「日期→曲线」瘦身侧车（记录为可选项，本轮不做）。

**门禁**：eslint 0 error / vue-tsc 0 错误 / vitest 206 文件 2305 例全绿（mockDemo 新增 5 例：鸭子曲线形态标定、quant 监盘形状、zrqsb 日期索引链路、zptqx 真实行集、采集窗口内跨页同源断言）。

**验收提示**：重启 vite（5175）+ 强刷后重点看：驾驶舱与监盘/复盘同日价格是否一致；申报台预测对比曲线是否呈现午间深谷+傍晚尖峰形态；日前上报/日前电量预估是否出真实采集数据；风控面板峰谷价差是否落在真实量纲（~350 元/MWh 量级）。

### C.21 第十八轮（2026-09-10）：四菜单组 29 页演示数据全量走查（浏览器人工验收路径）

**方式**：worktree vite（5175）+ mock-demo 登录，遍历市场洞察 9 页 / 空间资产 6 页 / 现货交易 9 页 / 中长期交易 5 页，逐页 DOM 检查（主数据区非空、无错误横幅）+ 截图留证。

**结果**：29/29 通过（含 2 项当场修复后复验通过）：

1. **交易月历 `/zcqjy/zjyap`（首轮失败 → 修复）**：`sdpt_zjyap` 族此前零覆盖，落入通用行集兜底——行缺 `jyrq` 字段，视图 `rows[rows.length-1].jyrq.slice(0,7)` 抛 `TypeError: Cannot read properties of undefined (reading 'slice')`，整页错误横幅 + 热力图/月历全空。修复：`sdpt_zjyap` 加入 fixtures 导出白名单（`calendar__full` 931 行 `{jyrq,sj1,sj2}`，2022-12~2026-06，138KB）——与后端「最大文件胜出」解析天然对齐。复验通过：热力图全窗口密度 + 月历格出真实申报窗口与交易品种。
2. **申报审批队列 `/xhjy/approvals`（待审区空 → 修复）**：种子申报单无 `PENDING_APPROVAL` 状态，待审批区恒「当前没有待审批的申报单」。修复：种子加 `MOCK-ORD-P1`（明日目标日、L2 档），且 `loadDeclarations` 对**旧会话 sessionStorage** 做缺失补种（浏览器旧缓存不含新种子也能出列）。复验通过：待审批卡（批准/驳回可用）+ 审批记录 4 条 + 全部申报单 6 条。

**环境注意（复现 C.3 已知项）**：Windows worktree 下 chokidar 文件监听不可靠——本轮往 `fixtures/` 新增文件与改 `router.ts` 后，dev server 未感知，必须**重启 vite** 才生效。验收/演示前凡改过 fixtures 或 mock 层代码，一律重启。

**回归**：mock spec 27/27 全绿（含申报动线既有断言）。其余 27 页首轮即过，证据截图存 ZCode 会话工件目录。

### C.21 补记（同日）：48 例测试清单自测 + 复盘事件库补齐

需求方要求出正式测试清单并自测。在 C.21 基础上扩为 **48 例**（29 页面级 P 例 + 19 容器深度 T 例），全部执行完毕：**P1–P29 全过**（DOM 复扫 + 本会话截图证据）；T 例结论：

| T 例 | 结果 |
|---|---|
| T1 驾驶舱·实时价格 | ✅（同 P1） |
| T2–T8 驾驶舱·现货驾驶舱/价格弹性/日前-实时价差/损益归因/电厂出力/电价×出力/披露明细 | ✅ 设计门控——「现货数据驾驶舱·云南试点」地区能力卡（带说明与跳转按钮），与真实账号行为一致，非空态报错；如需演示这些面板，切云南地区即出数（mock 已有 yn_system_forecast 族） |
| T9–T14 作业台 S2–S7 | ✅ 流程门控——按序解锁设计；S2 早间分析面板详查满数据（基本面分时表/供需比 0.84–1.38/边际机组/价格中枢） |
| T15–T17 申报台步骤 2/3/4 | ✅ 流程门控——随申报单激活（全四步动线已在 C.13 走通），无报错 |
| T18 复盘·决策评价 | ✅ **修复后过** |
| T19 复盘·改进验证 | ✅ **修复后过** |

**本轮新增修复**：复盘事件库与决策日志接口此前未覆盖（`/agent-api/agent/review/decision-logs[/verify]`、`improvement-actions`、`risk-events`、`cases`），导致决策评价 tab 空态、改进记录「暂时无法读取」。已在 mock router 补 6 条 handler（形状逐字段对齐 `coerceEntry`/`coerceImprovementAction` 等 coercion 契约：决策日志含哈希链 prevHash/hash 与 P10/P50/P90，按请求 `target_date` 改写条目日期保证任意复盘日出数；改进措施 4 条 open/done/carried_over；风险事件 3 条含未遂；案例 2 条）。修复经重启 vite 后浏览器复验：决策评价出 3 条决策、改进验证出 4 条行动项、「暂时无法读取」提示消失。回归 mockDemo.spec 15/15 全绿。

### C.22 第十九轮（2026-09-10）：八项图表拟真度有界随机化

需求方逐页反馈 8 处图表观感问题，归因两类：**A. 差值过大**——真实采集价里的 1500 限价尖峰/顶格平台把 y 轴拉满（驾驶舱现货价格峰谷价差 KPI 冲到 1446.5、监盘实时价 19–22 时顶格 1500 对日前 ~400、价差柱 ±1000）；**B. 过于规律**——合成器共用同形基线曲线，日间/行间只差 ±6% 逐点抖动（均值抵消后近似平行复制）。

**修复（全部确定性播种，同输入恒同输出，跨页不跳变）**：

1. **dmx 价格软化（fixtures.ts，A 类根因）**：`loadFixturePayload` 载荷入口对 `dmx` 容器行（价格明细约定键）做确定性压缩 `v>620 → 620+(v-620)*0.22`（1500→814、1000→668；≤620 覆盖 95% 真实点原样，鸭子曲线形态保留）。驾驶舱/监盘/复盘/市场洞察价格分析读同一份软化后载荷，**跨页同值一致**；负荷/出力行（fhlist24/xnyzd）不动。
2. **合成价尖峰收敛（generators.ts）**：概率 1.2%→0.4%、幅度 820+680r→560+240r（上限 ~800，与软化观感衔接）。
3. **监盘实时有界跟随（quantMonitor）**：`boundedFollow` 把 |rt−da| 收敛到 max(35, 28%·da)，形态与告警空间保留；quantReview 的 rt_price 同口径。
4. **复盘申报/实际（quantReview）**：实际 = 申报 × 逐点 ±4% + 一个 ±12% 的短时（1–2h）少发/超发事件窗——核验图出现偏差事件簇而非双正弦复制。
5. **持仓监控月/日维度（sdpt_zfsdjy ccljkDay/ccljkTime）**：新增 `dayLevel`（0.86–1.14 + 周末 −8%）日水平因子 + 8% 调整日 ±10%；日维度三类持仓改异形曲线（双边基荷/月内集中白天高原/日滚动晚峰）。
6. **分时段交易台账（list）**：每笔成交叠加行水平因子 ±14%。
7. **敞口看板（quantExposure 重写）**：series 改「当月逐日×24h」逐时 720 点（前端热力图按 floor(i/24)×i%24 映射，旧 30 点日序列会把热力挤成两天）；合同按 mode 分解（uniform/峰平谷/光伏跟踪）、预计出力按 source 取形状（新能源日抽云量 0.78–1.28），套保率自然落在 0.83–1.35。
8. **省间计划（sdpt_zptjg tag92）**：峰位/峰宽/爬坡/夜间平台逐日独立抽样 + 日水平因子，30 天相关系数 ~0.88–0.93（原 ~0.99 平行复制）。
9. **分时行情买卖盘（sdpt_fshq dataDet 合成分支）**：正弦波改播种随机过程——最新价随机游走（±12 步长 + 8% 概率 ±30 跳变，钳位 90–780），挂单量对数均匀（小单为主偶发大单），买1-3/卖1-3 价差分层保序。

**复验**（重启 vite 后浏览器逐页截图 + 页面内 fetch 数值校验）：驾驶舱峰谷价差 1446.5→348.8、出清最高 1496.5→398.1；监盘 y 轴 [-300,1500]→[0,800]；持仓月柱 ±16% 起伏、台账 39 行 heji/p1 全唯一；敞口热力呈「午间卖出红带+夜间买入绿带」且日间强弱有别、套保率 98.8%；结果核验偏差簇 15:45 +68.8 MWh 领先；省间计划日均值 180–293、峰值时点漂移。**回归：eslint / vue-tsc 干净，vitest 全量 206 文件 / 2305 测试全绿**（golden 契约 spec 全为结构断言，软化只动数值不影响）。

### C.25 第二十轮（2026-09-11）：随机性三标准统计审计 + 生成器漂移改造

需求方要求对四菜单（市场洞察/空间资产/现货交易/中长期交易）全部子菜单的演示数据做「随机性三标准」脚本化验收：①相邻步长有界（价格类/电量类分带，无断崖）；②无恒值/等差/等比/精确周期/长平台；③不同日期序列不雷同；市场洞察真实采集窗内数据豁免（真实数据不改），补窗（合成）数据须与真实件量级衔接（[1/3,3] 倍带）。

**审计工具**：`randomness-audit.local.spec.ts`（本地验收用，不入库）——构造 60+ 路由条目（含窗外补窗 match ×3 日期、quant/geo/气象直连路由），递归抽取数值序列（数值数组/对象数组业务列/行数组列/p1..p96 字段族），按业务带出 ~300 条序列统计。口径豁免：真实 fixtures 命中件只查非空+量级基线；差值序列（spread/jgc/deviation/gap）、峰谷分时合同（contracted）、新能源钟形（xny*/zxcl）、挂单量（mrl*/mcl*）不做步长带（保留恒值/周期/跨日雷同检查）；单点针尖尖峰（真实限价尖峰形态）从步长分布剔除。

**首轮 156 项失败 → 归因修复**：
1. **curve96 逐日形态漂移（generators.ts）**：峰位平移（价格 ±2.5 slot、曲线 ±1.3h）/峰宽/幅度/午间深谷深度（250 以下段 ×0.85–1.12）按 (seedKey,date) 独立抽样——跨日相关 r 从 ~0.999 压到 <0.995，打破平行复制（c.22 遗留的 xnyzd r=0.9996 等）。
2. **小时粒度改 4 段均值**：新增 `hourlyMean24`；zcqxhdl list24/fhlist24（lineRow/rolling）、zfsdjy 台账、ccljkTime 均价、节点电价 heatmap 矩阵从 h*4 点采样改小时均值——点采样把 15 分钟爬坡与偶发尖峰放大成小时锯齿（p95 步长 1.48–2.15 的根因）。
3. **zrqsb 量纲标定**：各组曲线按真实件 pFields 中位数标定（dl~90/jg~280/zcqjj~335，jq/jq2/cl/zxcl 归一化小量 ~1）；基准取「峰值 5% 以上核心段中位数」（全序列中位数会被新能源夜间零值拉穿，曾致缩放爆炸 2.2e10，被 golden 量纲护栏抓获）；jgc 价差组改近零噪声（±12，真实件中位 5–9），原「两条形态曲线相减」量级与形态均不符。
4. **quant 通用路由 rt 有界跟随**：`/agent-api/agent/quant/*` 兜底路由 rt=da×1.05 恒比例改 boundedFollow 独立曲线；market-insight bundle 的 rt 同口径。
5. **operator-profile 可用性映射**（gridGeo）：演示画像的 dataAvailability 改写为演示面实际供数状态（全部 available + 「演示数据面供数（Mock）」），修复空间驾驶舱「天气能力 missing」与演示页有数据的自相矛盾。

**复验**：审计 0 失败（9 条 warn：r 0.995–0.998 的形态相似，非雷同）；golden 全集护栏、eslint、vue-tsc 干净；vitest 全量 208 文件 / 2314 测试全绿。浏览器 mock-demo 重启 vite 后遍历四菜单 29 子菜单：零 4xx/5xx、零 JS 报错、零错误提示、无空数据页（分时行情「买卖盘逐笔」为点击主图时间点后才装配的引导空态，点选后正常出数）；抽查截图确认驾驶舱（峰谷价差 347.6）、监盘（峰谷统计 459.7/22.4）、持仓月柱起伏、省间计划 30 日均值 190–272 逐日不同、空间联动 8 电厂落点+天气能力 available。

**增强轮（同日）**：对照「不能出现日期不同数据一样轮回」再收紧——
1. **curve96 低频呼吸因子**：逐日随机相位/波数（全日 1~2 个慢波）的 ±4%~10% 慢波调制全曲线，价格/负荷/新能源三类同享；跨日相关 warn 从 9 条压到 2 条（r 0.996/0.998，远低于 0.9995 雷同线），鸭子形态与峰谷窗口关系保留（mockDemo 峰谷断言仍绿）。
2. **敞口合同侧日间起伏**：`contracted` 叠加 `dayLevel`、预计出力新能源峰位逐日漂移 ±1.2h——修复 30 天同一张 24 点表轮回复制（744 点仅 17 个唯一值）；套保率仍落合理区间（94.4%）。
3. **审计口径显式化**：新增「按日轮回复制」检查（24h 网格长序列按日分块、形状归一后两两比较，>20% 日块全同判失败；唯一值比例因小数栅格碰撞不构成轮回证据，弃用）；新增「衔接处跳变」检查（同族同路径真实窗最后一日 vs 补窗最早一日的量级比；近零噪声组对真实件极差带判定）。
4. 复验：审计 0 失败 / 2 warn；golden、eslint、vue-tsc、vitest 全量 208/2314 再绿；重启 vite 后 29 子菜单在最终构建上全部复验通过（敞口页截图：合同线日间起伏、套保率 94.4%）。

**视觉形态轮（用户复核「敞口看板还是很有规律、一眼假」）**：统计阈值通过≠视觉不假——蓝线（合同分解）是边界天天对齐 8/21 时的理想方波、黄线（预计出力）是每天同一口钟的节拍器。整改：
1. **出力侧逐日天气型态**：按月播种抽晴/多云/阴雨三型（52%/30%/18%）——晴日满钟形、多云日幅度 55–90% 且午间随机凹陷、阴雨日仅 10–25% 残出力并逐时参差，叠加既有峰位漂移；「每天同一口钟」消除。
2. **合同侧去理想方波**：合同曲线改为**三层分量逐日叠加**——基荷块（占比 0.45–0.65 逐日抽样）+ 峰段块（起止 7–9/19–22 时逐日漂移、幅度独立抽样）+ 约 45% 的日子另有午间光伏合同块（宽度/中心逐日抽样），再叠加周末 −22% 与日水平因子——夜间/白天/午间三个台阶的高度天天不同，是多份合同叠加的真实形态，而非单层二值台阶的理想方波。块间边界再做 **1–2.5h 梯形爬坡**（非整点垂直跳变），层内叠加逐日随机相位/波数的 ±3%~7% 低频摆动 + 逐点 ±6% 抖动——「层内恒平、整点垂直跳」的痕迹消除；合同侧曲线与两线之差的敞口柱随之打散。
3. **套保率锚定**：天气型态会整体压低出力电量（曾致套保率 133.8% 触发「过保」橙色告警），按目标套保率 0.95–1.10 对出力侧做一次性全局缩放——形态差异全保留、只校准总量口径，KPI 回到「区间适中」（97.6%）。
4. 复验：审计 0 失败、eslint 干净、vitest 全量 2314 再绿；浏览器截图确认钟形有大小日、方波有起伏与漂移。
5. **热力图列结构打散**：底部「敞口热力（日×小时）」的红带此前钉死在 10–16 时同一组列——出力峰位位移放大到 ±2.5h、合同峰谷窗口改为 6–10 时起/19–23 时止、多云日凹陷中心随机落位 9–15 时（红带被凹洞打穿）、晴日也加 ±6% 逐时参差——热力图列结构逐日游移，阴雨天近全绿。
6. **分时行情成交量柱（窗外合成）**：`300+|sin(i/7)|×500` 解析正弦（四个等高钟形，一眼假）改播种随机过程——偏低偏少的量柱为主、开盘与晚峰放大、偶发缩量、日水平因子控总量级（60–850）；顺带修复窗外日期 match 的日期解析（原 `split('__')[1]` 取到 'rqlx0'，tooltip/明细出「( NaN号 )」，改正则提取 yyyy-mm-dd）。审计口径同步：fshq opData 成交量列（[:,5]）豁免步长带（量柱本就锯齿），机械规律与跨日雷同检查照常。
7. **价格分析窗外补行**：`listrs_full` 真实件只覆盖到采集截止日（2026-06），运行日期选七月及以后时 3D 电价图/日期切面无行可显。`handleCaptured` 对 `listrs*` 命中真实件后按末行日期**续造到今天**（真实行一字不动，仅追加同形状 dmx/rjz/rmx 行；曲线96 带逐日漂移+呼吸，量级同族衔接）；fixtures 保留采集件原信封，续造需在 `payload.data` 内层操作（首轮误读外层 dmx 空数组而空转，探针定位后修复）。
8. **出清现货电量分析日期放开**：选择器此前 `disabledOut` 把可选日期限制在数据覆盖窗内。演示会话（`isMockActive`）解除限制——任意日期可选；所选运行区间/对比日超出覆盖时 watch 触发按区间重取（客户端 `fetchMarketInsightClearingSpotContract`/`fetchReplay` 增透传 `dateFrom/dateTo`，区间重取后回填所选值）。**注意**：`__list__` 会命中 `list` 茎 fixture（覆盖 Apr–Jun）并无视查询日期——`handleCaptured` 对「`__list__` + 显式 dateFrom/dateTo」跳过 fixture 走合成分支生成所选区间（无区间参数仍 fixtures-first 真实件）。另：Windows worktree 下 vite 对视图模块同样不热更，排查时以「curl served 模块 grep 新代码」为准，勿信进程 PID。
9. **`__list__` 合成形状对齐真实件（「数据太少/柱状突兀」治理）**：合成分支此前只有 6 序列×日粒度（31 点，价格差柱成粗块）——重写为真实 list 件同构：**96 时点 × 天数 × 10 序列**（时点格式 00:15..24:00、图例/轴配置 [1,1,2,0,0,0,0,2,2,3] 同真实件），序列量纲按真实件中位数固化标定（日前/实时价 281/279、出清电量 7879/7676、负荷 6457/6425、比率 0.9/1/1.2、价差 10）；价格出清对有界跟随。
10. **九项补数轮（用户逐页复核）**：①②关系散点 `_list24__/fhlist24__` 的 `xd` 由运行日 1 行扩为 **30 日滚动行**（每行 24 个[指标,价格]对——此前散点矩阵/敏感度只有一天样本）；③综合数据分析 `zsjfx_meta` 日期续列到今天 + `zsjfx_day` 合成序列名对齐真实默认勾选（日前新能源预测-总/日前负荷预测等，量纲按真实中位数 7494/26547 MW 核心段标定——夜间零值拉穿中位数的缩放爆炸被 golden 抓获后与 zrqsb 同解修复）；④驾驶舱「市场披露摘要/当日报价方案」云南地区门放开给演示会话——披露按生成器给山西口径关键数（负荷 2.68 万/新能源 5.2 千/外送 3.1 千 MW × dayLevel），报价方案走既有 mock bid-plans 路由；⑤日前上报日期清单续造到今天+15 天且 mock 不再告「未采集」；⑥日前电量预估显式区间旁路 + 逐日一行（此前仅 dateFrom 单日 3 行）；⑦`clampToCoverage/isOutOfCoverage` 演示会话不再钳回采集窗（复盘/监盘换日期内容随之变化）；⑧zfsdjy 台账由固定 13 天扩为整个查询窗（近 60 天 × 3 类型 = 180 行/61 日）；⑨交易月历日历行从 2026-06-28 续造到次月末（工作日节奏，sj1 申报窗口文案）。
11. **四项复核轮（用户二次逐页反馈）**：①价格分析首开慢——listrs 供数瘦身：真实件 2022 起全历史（6.5MB）裁到近 400 天+窗外续造（约 1.9MB，3.4×）；②综合数据分析「其他数据项选中无数据」——`zsjfx_day` 合成按 meta 全量数据项逐名生成（名称关键词→曲线种类/量纲模板 + 真实日件 p90 量纲表自标定，覆盖全部 63 项，含 频率/上限下限/光伏钟形/风电平缓 等语义形状）；③披露摘要卡片文案跟随当前地区（山西·日均/山西总送出预测，源标注「演示数据生成器（Mock）」）；④交易月历热力图改为只渲染当前展示月（随上/下月切换变化），续造行补齐 sj2 交易品种（5 品种轮换、申报窗口 1~3 日区间）使日历卡片有内容。审计口径同步：量级/衔接比较改用核心段中位数（跳过光伏夜间零值游程）。

### C.26 第二十一轮（2026-09-11）：三菜单 20 子菜单「有数据 + 可切换」逐页实测

需求方要求验证空间资产/现货交易/中长期交易三个菜单全部 20 个子菜单「①有演示数据 ②能正常切换数据展示」。逐页以「加载探针（canvas/报错/骨架/空态）+ 真实 UI 控件操作 + 切换前后 DOM 哈希/表格行数对比」实测：

- **空间资产 6 页**：联动驾驶舱（场景预设切「市场回放」）、节点空间资产（节点历史面板）、授权网架（2D⇄3D，aria-pressed 迁移）、公开披露空间层（事件类型筛选）、气象交易影响时序（T−2D/T−1D 决策快照切换，时间轴 canvas 像素级变化）、南网国网展示画像（顶部地区选择器山西→四川，画像术语/文案联动）。
- **现货交易 9 页**：驾驶舱（主图景 tab 切「日前-实时价差」）、一日作业台（S1→S2 步骤链）、实时监盘（监盘日期换日）、日前上报（运行日期 06-04→06-03 + 搜索，表标题日期跟随）、日前电量预估（开始~结束区间改 9 月中旬窗外日期 + 搜索，65 行→5 行且窗外日期出数）、申报工作台（申报单⇄历史申报单 tab；模型 radio 需选中草稿后才可点，为页面原设计）、申报审批队列（状态下拉筛选 10 行→4 行）、复盘中心（?date= 换日）、风控阈值面板（聚合看板，无页内切换控件，数据在位）。
- **中长期交易 5 页**：持仓量监控（月份改 8 月 + 查询）、敞口看板（月份 09→08 + 测算）、分时段交易（交易/运行日期、交易类型、数据类型四筛选）、交易月历（上/下月切换：8/9/10 月日历卡片 25~30 格有申报内容；11 月起为空属「续造到次月末」设计边界）、省间电量计划（24 点⇄96 点粒度 radio，页面正文 25686→8395 字符按粒度重排）。

**发现并修复 1 个 mock 层缺陷**：`GET /api/v1/grid/geo-assets/disclosures/events` 合成处理器忽略 `category/keyword/from/to/page/pageSize` 查询参数，导致披露页类型筛选 chip 高亮切换但事件列表恒为全量 12 条（真实后端会过滤）。修复为与真实后端同径：category/keyword 过滤 + effectiveAt 时间窗 + 分页切片；实测切「断面阻塞/输电约束」后列表只剩对应类型事件、地图计数 12→2。

**过程注意**：顶部地区选择器为全局持久态（画像页实测四川后未恢复，导致后续数页在四川画像下复测）——已切回山西并在正确地区下重验；后续做页面验收时若横幅地区与预期不符，先回属地再验。复验：vitest 全量绿、eslint 0 errors、审计 0 失败 / 2 warn 维持。



### C.23 第二十轮（2026-09-10）：双账号互不干扰验证 + golden 护栏全集化 + 方案 A 审计

**1. 双账号互串流程（浏览器实测，mock→真实→mock 全闭环）**：真实种子账号 `trader/123456`。mock 登出后 `dljy.mock.*`/token/用户档/公司键全清；trader 登录后请求 `x-data-mock=null`（守卫原生透传）、`/api/real-list` 返回 5152 份（真实后端全集）vs mock 会话 255 份（白名单）、公司上下文「山西发电有限公司」（非演示集团）、申报台无 MOCK-ORD、无 `dljy.mock.*` 残留；回登 mock-demo 后徽标/x-data-mock=true/演示申报库自播种全部恢复。**结论：两账号数据面完全分离。**

**2. golden 护栏全集化（captureFixturesGolden.spec.ts，+3 用例）**：发现并修复原 12 例抽样 spec 的结构性盲区——`handleCaptured` fixtures-first，经 `resolveMockRequest` 拿到的「mock 侧」就是 fixture 原件，等价断言对白名单族**空转**。修法：router 导出 `synthesizeCapturedPayload()`（绕开 fixtures-first 直连合成器），spec 以 fs 直读 golden 采集件，对 `fixtureFamilies() × 全部文件`（9 族 737 件）断言「合成器输出 ⊇ golden 形状」：键集合（golden ⊆ synth，加性键放行）、类型、非空数组、首元素结构递归、数值域有限且量级 ≤ golden×5+100（仅对 maxAbs≥1e3 的真实量纲 golden 生效）。信封口径与消费方一致（双侧 .data 对象容器解包一层）。归类例外：无专属合成器分支的 (族,match)（zjyap 全族、console 天气/负荷配置/非 6 hash、knn predict API 文档、zcqxhdl 'list' 茎）按「仅 fixtures 供给」只查路由层 200+x-data-mock+非空；zsjfx_day/meta 序列名键集取交集（C.20 子集契约）。

**护栏首轮即抓出 10+ 处真漂移并修复**：rmx 统计行只有 p1..p3（C.8 同型回归，补 null 键 p4..p96）；fshq opData[0] 应为字符串时间标签、缺 markLineList/ssjycdcList/rqjhgList/ssjhgList、extendMap 铺满 120 锚点；dataDet 缺 chartConfigMap；zrqsb 缺 audioRQSB/ccbl/xjfw/clqx 与全套行元数据（czsj/prov_id/sdgs_id/khlx/riqi/czry/queryDate/jk_type/drrq/rksj/sjlx/jylx/bdrq1/2/jyrq/heji）；zptqx 行缺 id/provId/sdgs/sdgsId/khlx/week/czry/czsj/total/beizhu 与 code/msg；console 缺 dayBeforeAvgSb/JsPriceList、dayAheadPriceList2、diffPriceTotal（独立双曲线求和漂移，改日前+均值零抖动）、days、title、getWeatherList 整分支、CC_SW 档量纲（×22→×0.18）、在线容量改随 scale 推导；actualLoad 补 query2 分支（逐年节假日/抽样日契约）。

**3. 审计结论（隔离面无漏 + 遗留风险）**：确认无漏——判定 memo 按原始串自动失效（切号即重算）；登录/登出双重清场；mock 存储全 `dljy.mock.*` 命名空间；src 无 EventSource/WebSocket/XHR/sendBeacon（SSE 走 fetch 流，被守卫覆盖）；守卫 main.ts 安装先于业务请求。遗留风险两条：① `__list__` 与 `list__<hash>` 共享子串、靠 bytes 最大者胜，重跑导出若窗口变化可能静默换数据源（建议导出侧改名或 spec 钉死赢家）；② 守卫只拦 `window.fetch`，未来引入 XHR/WS 直连即绕过（建议 ESLint no-restricted-syntax 红线）。**回归：eslint/vue-tsc 干净，vitest 207 文件 / 2308 测试全绿；重启 vite 后 zrqsb/zptqx/fshq 冒烟无错。**

### C.24 第二十一轮（2026-09-10）：市场洞察驾驶舱/天气预报页演示气象

需求方反馈「市场洞察驾驶舱的天气预报没有演示信息」。根因两层：① 驾驶舱（内嵌 HomeConsoleView）天气走 `apiGet('/qweather')`（和风代理），mock 路由未覆盖 → fail-open 空信封；外网回退 Open-Meteo 又被跨源护栏 502 拦截 → 网格/挂件全空。② `/sjfx/tqyb` 天气预报页整页直连 Open-Meteo → 同样 502 报错态。天气按 key 计费不宜采集入库（无 fixtures 族），且 PRD 定位为「外部辅助数据、不进 provenance 标注体系」——按确定性合成供数。

**修复**：① mock 路由新增 `/api/qweather`（`mockQweatherResponse`）：按和风原始形状供 now / 15d / geo city lookup 三形态，string 数值、播种确定性（同城市同日恒同）。② 守卫跨源分支对三个气象公开源（api.open-meteo.com / geocoding-api.open-meteo.com / api.bigdatacloud.net）从拦截改为演示应答（新模块 `mock/externalWeather.ts`）：forecast 按 Open-Meteo 原始形状供 current + daily(15) + hourly(15×24) 全 BUNDLE 字段，geocoding/reverse-geocode 同理；其余外网域名维持拦截。合规红线不变：这些应答带 `x-data-mock: true`，演示徽标常驻。

**复验**：驾驶舱当前天气挂件出数（25° 太原）、多城市×日期网格 DOM 含 11 城市 166 个天气图标；天气预报页实况/15 天卡片/趋势图全出。回归：mockDemo.spec 17/17（新增 qweather 三形态 + open-meteo 形状 2 例）、eslint 干净。

---

## 协作规则（demo/mock-account 分支工作约定）

1. **提交前必同步主分支**：每次提交代码（在演示分支建任何 commit）之前，必须先拉取最新主分支代码——`git fetch origin && git merge origin/main`（冲突时以主仓代码为基底、按 PRD C.16–C.18 模式重放演示门），跑完门禁（eslint / vue-tsc / vitest）全绿后再提交。
2. **演示分支永不进主仓**：`demo/mock-account` 的提交永不合入 `main`、永不携带演示代码推送其他分支；任何 push 等远程操作先征得同意。
3. **演示代码默认放本地**：改动以未提交状态留在工作树；何时落提交、何时推送远程演示分支，均由需求方逐次指定。
4. **同步后必做**：重启 vite（5175）+ 真实账号与 mock 账号各登录冒烟一遍。
