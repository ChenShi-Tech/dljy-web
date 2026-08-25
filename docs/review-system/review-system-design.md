# 交易复盘体系 · 前端设计稿（review-system-design）

> Epic [#2033](https://github.com/ChenShi-Tech/dljy/issues/2033)「web: 交易复盘体系（六维框架+模板+触发+案例库）」的前端权威设计稿。
> 按 Epic 约定随 M1 首 PR 落盘。本仓（dljy-web）为上游镜像仓：本文档先在本仓评审合入，
> 由维护者搬运回上游 `docs/review-system/` 并登记 `docs/docs-index.md`。
> 注册表单源：`shared/review-templates/registry.mjs`（#2036 已交付，31 项模板 + 六维 + 就绪度台账）。

## 1. 目标与边界

把复盘从 S1 日度晨会触点扩展为六维（结果/策略/市场/偏差/风险/决策）× 四周期（日/周/月/季）× 三主体（售电/新能源/储能）的体系。
前端落点两个：**复盘中心 `/xhjy/review` 升级为六维驾驶舱**（2026-08-13 拍板：升级现页，不另建）与 **S1 面板三个轻元素**（保持 <5 分钟不膨胀）。

**红线（全部机器可验）**

1. 判断栏（依据/结论/改进措施）AI 不可预填——注册表 `fill:'human'` 即机器表达；渲染器永不给 human 字段挂建议入口。
2. 未接入地区/缺数据模板诚实空态，不合成、不串读山西；就绪度台账即分期验收清单。
3. 触发引擎上线前不显示复盘覆盖率/填写率（不拿假分母凑数）。
4. 金额字段带 `caliber` 口径限制入库并随报表带出（当前一律 `self-computed`）。
5. 24 时段类模板（E1–E3/N1）底层 96 点、24 时段仅展示聚合；峰谷标识读 SettlementRuleSpec，未参数化省份显式提示不借用。

## 2. 现状盘点（2026-08-15 实勘）

### 2.1 前端已有资产

| 资产 | 位置 | 状态 |
|---|---|---|
| 模板注册表（31 项/六维/就绪度/来源目录） | `shared/review-templates/registry.mjs` | ✅ 可直接 import，前端零消费（本稿消费） |
| 复盘中心页（偏差图/结算三段式/回测卡/对账卡/智能体复盘/报告库） | `src/views/ReviewCenterView.vue` | ✅ 在用，无驾驶舱信息架构 |
| S1 晨会复盘面板（两段偏差+四因子归因+决策日志） | `src/components/trading/stages/StageMorningReview.vue` | ✅ 在用，无体系消费元素 |
| quant 客户端（review/settlement-review/reports） | `src/services/quant/quantClient.ts` | ✅ 类型与后端对齐 |
| 五档数据口径 + 徽章 | `src/services/dataBasis.ts` + `DataBasisBadge.vue` | ✅ 全站复用 |
| 报告阅读闭环（fetchReports → fetchReportContent → renderMarkdown） | ReviewCenterView | ✅ S1 报告卡直接复刻 |
| 96 点图表基建 | `useEChart` + `chartOptions` 工厂 | ✅ 复用 |
| 立场复盘焦点三框架（#2005） | `shared/trading-rules/position-review.mjs` | ✅ 规则就绪；运行时 `activePosition` 恒 null（接线归 #2005 收口） |

### 2.2 后端真实可用面（dljy 上游实勘结论）

**A. 现在就能真接（已存在）**

| 端点/模块 | 前端封装 | 用途 |
|---|---|---|
| `POST /agent-api/agent/quant/review` | `fetchReview` | 偏差考核权威口径：96 点 detail + backtest 段 + caliber_caveats |
| `POST /agent-api/agent/quant/settlement-review` | `fetchSettlementReview` | 云南三段式（其他地区诚实 503） |
| `GET /agent-api/agent/quant/reports?report_type=daily_review` | `fetchReports` | 报告列表（`sched_` 前缀=夜跑定时产出） |
| `GET /agent-api/agent/quant/reports/content` | `fetchReportContent` | 报告正文（公司+地区双重鉴权） |
| `shared/review-templates/registry.mjs` | 直接 import | 六维/模板/就绪度/helpers，双仓同文件零端点依赖 |
| `src/rules/settlement.ts` | 直接 import | SettlementRuleSpec 5 省；未沉淀返回 null（保留可见降级） |

**B. 不存在（表已建、端点未动工）——前端一律诚实降级**

| 缺口 | 归属 | 前端呈现 |
|---|---|---|
| ~~`review.template_instances` 读写端点~~ **已上线（#2037/#2039 M1）** | 触发引擎 + 实例读写 | 待办箱真数据；未部署环境探针 404 →「触发引擎未上线」空态 |
| ~~决策日志服务端化（SHA-256 链）~~ **已上线（#2037 M1）** | Node BFF `/api/v1/review/decision-logs` | S7 双模式：server 台账优先，端点未部署回落 localStorage 原型 + PROTOTYPE_STORAGE_NOTICE |
| ~~风险事件 / 改进措施端点~~ **已上线（#2046/#2047/#2049 接线）** | Node BFF `/api/v1/review/risk-events` + improvement-actions（经 agent 代理） | #2046 异常月登记入事件库；#2047 near_miss 落库+回显；#2049 纪要自动带入未闭环项+断言+行动项落库；端点缺席仍探针降级 |
| ~~案例库 `review.cases` 端点~~ **已上线（#2047 验收残留：GET/GET{id}/POST）** | Node BFF `/api/v1/review/cases`（经 agent 代理） | near_miss 事件落库后自动沉淀案例（case_type=risk、visibility 缺省 internal、case_no 回执；失败红字+重试不静默） |
| weekly/monthly 复盘调度 kind | #2044 | 周月模板只读预览，不显示「已生成」 |

**B2. #2037/#2039 M1 落地后的实际通道（双仓 PR 对齐）**

| 端点（浏览器视角） | 实际链路 | 前端消费点 |
|---|---|---|
| `GET/PATCH /agent-api/agent/review/template-instances[/{id}]` | Python 薄代理 → Node BFF `/api/v1/review/template-instances` | TodoInbox、ReviewTemplateForm（存草稿/提交） |
| `GET/POST /agent-api/agent/review/decision-logs[/{id}/backfill]` | 同上（决策日志权威存储在 Node，Python 无 PG 访问） | S7 决策日志双模式门面（decisionLogStore） |
| `GET /agent-api/agent/review/decision-logs/verify` | 服务端 SHA-256 链校验结论（前端不重算） | S7 链完整性徽标 |
| `POST /api/v1/review/trigger`（服务间） | scheduler `review_trigger` kind → X-Service-Token + Idempotency-Key | 待办分母生成（前端只读结果） |

**B2 部署/联调备忘（M1 端到端实测踩坑，Phase 3 于 5175 双栈验证）**

- `DLJY_REVIEW_SERVICE_TOKEN` 必须同时配在 Node BFF 与 Python agent 两个进程上（scheduler 携带、BFF 校验，不一致 fail-closed 403）。
- Node 网关对「匿名 + X-Service-Token」的 `/api/v1/review/trigger` 有窄豁免（复用 #1407 摄取通道形态），否则服务令牌调用落 ANON 被粗矩阵拦死、调度器静默失败——豁免不覆盖其余 review 路径（人类会话调用必须过完整矩阵）。
- Python 侧转发/触发一律 `httpx.Client(trust_env=False)`：Windows 注册表系统代理会把 `127.0.0.1` 的 BFF 请求拦成 502（与 authz.py/graphs.py 同款预防）。
- 链为**字节级**校验：任何直接改库（含「改回去」）都会被判 `brokenAtSeq`——更正只能走追加写，这是特性不是缺陷。

## 3. 与 dljy 后端的结合与通讯契约（核心章节）

### 3.1 通讯纪律（沿用全站既有约定，新增处显式列出）

- 取数只经 `src/services/`，页面不直接 fetch；agent 面统一走 `AGENT_API_BASE`（`/agent-api`），禁硬编码端口。
- 鉴权头三件套：`Authorization: Bearer` + `x-company-id` + `x-region-id`（`identityHeaders()`）；quant 面公司集合以 token 解析为准，前端不得伪造。
- **请求序号守卫**：日期/地区连续切换丢弃过期响应（本页既有 `settlementSeq` 模式，新组件沿用）。
- **软失败分层**：核心数字失败进错误分类卡（`classifyReviewError` 五态），辅助信息失败降级为提示不阻断。
- **Mock 红线**：`mock:true`/`sourceType:'MOCK'` 必须可见横幅；`illustrative` 价格必须页面明示（E1 注册表 notes 原文要求）。

### 3.2 能力探针降级模式（本次新增，供全站复用）

后端端点未上线时前端如何「诚实而不死板」：**capability probe + 单次会话内记忆**。

```ts
// src/services/review/templateInstanceApi.ts（纯逻辑，node 可测）
// fetchTemplateInstanceFeed(): Promise<TemplateInstanceFeed>
// TemplateInstanceFeed =
//   | { available: true; instances: TemplateInstanceSummary[] }
//   | { available: false; reason: 'endpoint-absent' | 'unauthorized' | 'unreachable' }
```

探针打 `GET /agent-api/agent/review/template-instances`（#2037 后为真列表通道；不带 status 过滤——待办要 pending+draft 两态，draft 是填了一半的待办）：
- 200 → available，渲染真待办；
- 404/405 → `endpoint-absent`（触发引擎未上线，展示就绪度台账替代内容）；
- 401/403 → `unauthorized`（提示权限）；
- 网络错/5xx → `unreachable`（可重试）。

会话内缓存探针结论（模块级 ref，5 分钟 TTL），避免每个组件重复打无效端点。**端点上线后前端零改动出数**——这是镜像仓等后端节奏的的标准姿势。决策日志同款探针（decisionLogStore.resolveDecisionLogMode）：**只有 endpoint-absent 才回落浏览器原型**；未授权/网络错按 server 模式走、把真实错误抛给页面——权威链存在时不允许伪造本地写入成功。

### 3.3 后端契约（#2037/#2039 M1 已按此落地；#2045 及之后仍为提议）

| 端点 | 方法 | 用途 | 前端消费点 |
|---|---|---|---|
| `/agent-api/agent/review/template-instances?status=&period_key=&template_id=` | GET | 待办箱/驾驶舱实例列表（含 deadline、overdue 推导）；**已上线** | TodoInbox、六维入口徽标 |
| `/api/v1/review/trigger` | POST | 触发引擎生成实例（幂等锚 template_id+period_key+company+region；服务令牌专用，前端不直接调） | scheduler `review_trigger` kind（驾驶舱只读结果） |
| `/agent-api/agent/review/template-instances/{id}` | GET/PATCH | 实例详情（autofill 快照）/人工字段提交（提交后锁定） | ReviewTemplateForm |
| `/agent-api/agent/review/decision-logs` | GET/POST | 决策日志服务端化（SHA-256 链追加写） | S7 收编 #1967 原型 |
| `/agent-api/agent/review/cases?visibility=&type=` | GET | 案例库（visibility 尊重 internal 默认） | 案例库列表（M3） |
| `/agent-api/agent/review/improvement-actions?status=open` | GET | 上期未落实项自动带入 | 周月模板「上期回查」 |

契约细节（#2037 已落地部分）：Node BFF 统一信封 `{code, msg, data}`（envelope + requestId），业务错 400（校验）/401（未登录）/403（权限·不可代签）/404（不存在）/409（状态机/重复回填）；Python 薄代理原样透传状态码与 JSON，网络故障 502 `{code:502, msg}`。前端 `templateInstanceApi`/`decisionLogApi` 的探针四态同族分类；案例库等 #2045 端点沿用 quant 面 `detail.kind` 风格待实现时对齐。

### 3.4 前端层数据流（M1 落地形态）

```
registry.mjs ──────────────┐
quant /review ──┐          │
quant /reports ─┼─ cockpitModel.ts（纯函数） ─→ DimensionGrid / TodoInbox / MetricCards
探针(§3.2) ─────┘          │
                           └─ ReviewTemplateForm（schema 驱动渲染：auto/human/ai_suggest）
```

## 4. 八个前端任务 · 体验优化系列

### 4.1 #2038 复盘中心六维驾驶舱 v1（M1，本次实现）

痛点：页面是「一堆平铺卡片」，没有体系入口；模板 31 项在前端不可见；无待办心智。

| # | 优化项 | 说明 |
|---|---|---|
| U1 | 顶部指标卡两真一占位 | 偏差率（当日 /review，仅覆盖区出数）+ 风险事件（M3 前占位空态）；覆盖率/填写率**不上**（无分母） |
| U2 | 六维入口卡导航 | 每维一卡：就绪度徽章（ready/data_gap 计数）+ 模板清单下钻；「偏差复盘/结果复盘」锚到既有区块（图/回测卡归入维度，不搬家） |
| U3 | 待办箱 | 探针真数据：按时限排序、逾期标红、点击进模板；未上线→就绪度台账替代（分期验收清单即内容） |
| U4 | 通用 ReviewTemplateForm | 读注册表 schema 渲染：auto 字段只读+来源徽章（SOURCE_CATALOG desc 悬浮）、human 可编辑、ai_suggest「建议→人点采纳」交互；slots24 模板 24 时段聚合表+96 点底座说明 |
| U5 | 峰谷标识读 SettlementRuleSpec | 未参数化省份显式「本省峰谷未参数化，不借用他省」 |
| U6 | 报告阅读体验 | 昨夜定时报告置顶标「昨夜」；阅读器沿用弹层 |
| U7 | 深链不回归 | `?declarationId=` 基准带入、`?todo=1` 直开待办箱 |
| U8 | dljy-ui 预留位 | `review/PnLWaterfall`、`review/DeviationAttribution` 按 artifact 渲染件落地（props+basis，空态诚实） |

### 4.2 #2040 S1 面板三件套（M1，本次实现）

痛点：S1 只有过程数据没有「一句话结论」；昨夜智能体报告看不到；复盘单待办无触达。

| # | 优化项 | 说明 |
|---|---|---|
| U1 | 复盘三问结论条 | 成交没成交（中标率）/ 偏差怎么样（执行偏差+环比昨日）/ 赚亏多少（回测收益或购电成本）——三行只读结论；数字全部复用既有取数（analyzeClearing + fetchReview + 写回链上的昨日值），零新口径；按 #2005 立场换措辞（售电=成本/电厂=收入，立场未接线时用中性措辞） |
| U2 | 昨夜智能体报告卡 | `fetchReports('daily_review')` 取 24h 内最新 `sched_` 报告：摘要+点开全文（复刻复盘中心阅读器）；无报告→「昨夜未生成」+跳复盘中心手动触发入口（S1 不内嵌对话面板，防膨胀） |
| U3 | 复盘待办徽标 | 探针：真数「今天应填 N 张」跳 `/xhjy/review?todo=1`；未上线→「触发引擎未上线」态（也算诚实空态） |
| U4 | 计时验证 | S1 全流程 <5 分钟的实机计时归 #1961 收口项，本单组件保持只读/跳转零写回，不新增填写负担 |

### 4.3 M2–M4 六单（规划，依赖后端里程碑）

| 单 | 关键体验点 | 依赖 |
|---|---|---|
| #2042 偏差周月聚合 | 周报=逐日 /review 之和恒等断言；责任归因二轴仅周聚合人工补填，AI 只给映射建议；上期未落实项自动带入本期 | b06 三部制口径（#2041） |
| #2043 收益三层拆解 | 三层合计恒等；Top5 与拆解同源同口径；「策略对比」视图显著标注「决策参考，非结算依据」 | S6 持仓线（#1966）、b09 monthly kind（#2044） |
| #2046 月度市场归因 | 自动行来源标注；政策行无自动因果声明；「下月关注点」一键转行动项 | 披露库 + policy_intel |
| #2047 风险事件库 | near_miss 不计损失但入案例库；阈值触发幂等负例；站内不外发 | b12 风险事件端点、b04 全量触发 |
| #2048 三主体专属模板 | 每批交付翻转就绪度台账（data_gap→ready 须写数据来源）；无数据模板呈现「等待数据接入」 | D1–D5 数据清单（梁总） |
| #2049 情绪化识别 | 整体可停用且无残留；「学习辅导非考核」声明+不做排名；纪要自动带入 improvement_actions | 决策复盘单情绪栏数据积累 |

## 5. M1 实现拆解（本 PR）

**新增文件**

| 文件 | 职责 | 测试 |
|---|---|---|
| `src/services/review/cockpitModel.ts` | 纯函数：六维卡模型（维度×模板聚合、就绪度计数、入口锚点）、待办排序/逾期推导、指标卡模型 | `cockpitModel.spec.ts`（node） |
| `src/services/review/slots24.ts` | 纯函数：96 点→24 时段聚合、峰谷标识（读 SettlementRuleSpec，未参数化返回 null+提示） | `slots24.spec.ts`（node） |
| `src/services/review/templateInstanceApi.ts` | 探针纯逻辑：响应→Feed 分类（available/endpoint-absent/unauthorized/unreachable）、数字 id 容忍、payload 草稿透传 | `templateInstanceApi.spec.ts`（node） |
| `src/services/review/templateInstanceClient.ts` | 传输层：实例列表 + PATCH 存草稿/提交（幂等键）+ 会话内 TTL 缓存（quantClient 同款 fetch 纪律） | —（传输层不进 node 测试，纯逻辑已覆盖） |
| `src/services/trading/decisionLogApi.ts` | 决策日志服务端数据面纯逻辑：探针分类、服务端行→共享 DecisionLogEntry、SHA-256 verdict 透传、原型导入计划 | `decisionLogApi.spec.ts`（node） |
| `src/services/trading/decisionLogClient.ts` | 传输层：GET 列表/verify、POST 追加/backfill（author 由会话落名，不代签） | —（同上） |
| `src/services/trading/decisionLogStore.ts` | 双模式门面：探针决定 server/local，写路径按模式分发；原型→服务端显式导入 | —（纯逻辑在 decisionLogApi；localStorage 路径不进 node 测试） |
| `src/components/review/DimensionGrid.vue` | 六维入口卡 | —（渲染逻辑在 cockpitModel，纯函数已测） |
| `src/components/review/TodoInbox.vue` | 待办箱（探针四态） | `TodoInbox.component.spec.ts` |
| `src/components/review/ReviewTemplateForm.vue` | schema 驱动模板渲染器 + slots24 聚合视图 | `ReviewTemplateForm.component.spec.ts` |
| `src/components/agent/dljy-ui/review/PnLWaterfall.vue` | 损益瀑布 artifact 渲染件（预留位） | — |
| `src/components/agent/dljy-ui/review/DeviationAttribution.vue` | 偏差归因 artifact 渲染件（预留位） | — |
| `src/components/trading/stages/ReviewThreeQuestions.vue` | S1 三问结论条 | `ReviewThreeQuestions.component.spec.ts` |
| `src/components/trading/stages/OvernightReportCard.vue` | S1 昨夜报告卡 | `OvernightReportCard.component.spec.ts` |

**修改文件**

| 文件 | 改动 |
|---|---|
| `src/views/ReviewCenterView.vue` | 顶部驾驶舱段（指标卡+六维入口）、右列待办箱、模板抽屉、锚点 |
| `src/components/trading/stages/StageMorningReview.vue` | 挂三件套（只读/跳转） |
| `src/router/index.ts` | review 路由 meta endpoint/scope 更新 |
| `src/data/pageHelp.ts` | 复盘中心帮助卡更新（六维驾驶舱语义） |

**提交切分**：① 服务层纯函数+node 测试 → ② S1 三件套+组件测试 → ③ 驾驶舱组件+集成+组件测试 → ④ 设计稿与文档。每步过 `npm run check && npm run test:unit`。

## 6. 验收对照（#2038/#2040 逐条）

| Epic 验收 | 本设计落点 |
|---|---|
| 未接入地区/缺数据诚实空态不合成 | §3.2 探针四态 + cockpitModel data_gap 标注 |
| 申报台深链 declarationId 带入不回归 | U7（既有逻辑不动，集成测试守卫） |
| 组件测试覆盖待办箱与模板渲染器主路径 | TodoInbox/ReviewTemplateForm component.spec |
| S1 新增元素全部只读/跳转无新写回口径 | 三件套零 savePreflight |
| 空态齐全（无报告/无待办/身份未知） | 三问条立场兜底、报告卡昨夜未生成、徽标引擎未上线 |
| 覆盖率/填写率不上假分母 | 指标卡只上偏差率+风险事件占位 |

## 7. 路线图（对齐 Epic 四期）

- **M1（已交付）**：驾驶舱 v1 + S1 三件套 + 探针降级框架 + 模板渲染器。
- **M2（已交付，前端侧）**：#2042 周月聚合（恒等断言进测试、二轴仅周聚合人工补填）、
  #2043 收益三层拆解（PnLWaterfall 喂真数据、Top5 以日为笔、环比强制归因）。
- **M3（已交付，前端侧）**：#2046 市场归因（市场经营分析真取数 + 异常月 2σ 规则 + 政策行无自动因果）、
  #2047 风险与压测（阈值触发真判级 + /quant/cvar 真引擎；near_miss 已接 risk-events 端点落库+处置回填，端点缺席回落本地草稿）。
- **M4（已交付，前端侧）**：#2048 三主体驾驶舱（批 1 售电 R1/R4 公司级真数、E1 MOCK 明示）、
  #2049 情绪化识别（规则 v1 + 停用零残留）与会议纪要（归档提醒 + 未闭环项自动带入/回写 + 落库断言，端点缺席诚实占位）。
- **M2–M4 的服务端深化**：模板实例提交/待办分母（#2037/#2039 已上线）、
  风险事件与改进措施端点（#2046/#2047/#2049 已上线并接线：`reviewStoreApi.ts` 纯逻辑 +
  `reviewStoreClient.ts` 传输层，读探针降级/写抛错；后端契约见 dljy `docs/api/review-store-endpoints.md`）、
  案例库端点（#2045 部分）、胜率服务端化（#2045）、周月调度预填（#2044）——
  未上线项前端探针/占位均已就位，端点上线零改动或小改出数。
- **验收残留清零（Epic #2033 收口，前后端对齐 PR）**：决策时点 `decisionTime`
  （迁移 044 非哈希列；S7 决策日志表单选填）、追涨/杀跌 R3/R4 打标（决策时点小时价
  较前一小时波动 ≥15% 且 judgement 同向；decisionTime/小时价/方向缺任一不打标——宁缺勿滥）、
  阈值触发自动事件库草稿（幂等双保险：确定性键 `trigger-{eventType}-{periodKey}` + GET 去重；
  未越限不 POST）、risk-events `extremeValue/durationHours`（#2046 结构化；月粒度数据无逐时
  口径时如实 null+data_gap 注明）、S1 实机计时（`stageTimer.ts` 纯逻辑，sessionStorage per
  申报单+日期；>5 分钟黄标只呈现，**零写回**——U4 红线，测量协议=进入 S1 记时戳 →
  writeBack 成功读 elapsed）。
- **前端侧已实现的口径注记**：单笔 Top5 以日为笔（逐笔归集待 S6 #1966）；
  连续未达预期价差以「价差盈亏为负」为代理（正式定义待 P2）；追涨/杀跌已按
  decisionTime×小时价联动打标（缺任一前置不打标，宁缺勿滥）；节假日表未接入前归档提醒按周末顺延保守口径。
