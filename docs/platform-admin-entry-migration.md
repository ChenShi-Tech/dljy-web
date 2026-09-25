# 平台后台旧入口迁移清单（待逐项批准）

> 源自 ChenShi-Tech/dljy#3161（openspec `complete-platform-admin` 任务 11.4，父 Epic #3122）。
> 盘点日期 2026-09-25，基于本仓分支 `glm/issue-3161-entry-migration-list` 代码**只读**核实；
> 旧后端入口的权威归属与门禁结论凡引自《平台后台管理路由矩阵》（任务 2.1 副本，下称「矩阵」）均已标注——矩阵基于主仓 main `69f7a2cda`，后端门禁现状本仓未运行验证。
> 本文只是清单，**不含任何代码改动**；每项移除/收窄须经用户逐项批准后在任务 11.5 另开 PR。

## 1. 本清单是什么

**用途**：平台后台（独立仓 dljy-admin，仅我方运营人员）逐步接管「平台内部」管理操作。客户前端（本仓 dljy-web）现存一批旧管理入口，本清单把每个入口（到 tab/面板粒度）的**实际动作、当前可见角色、建议归属、后台替代、对拍与回退**核实登记，供用户逐项批准。

**分类口径**：

| 分类 | 定义 | 迁移动向 |
| --- | --- | --- |
| **平台内部** | 操作影响整个部署或跨客户（全局配置、共享模型、全局凭据、平台公司主数据），操作者应为我方运营/平台管理员 | 迁往 dljy-admin（或后台接管后客户侧隐藏/只读/提示跳转） |
| **客户自助** | 操作只影响本公司（`companyId` 隔离的业务数据），属客户日常业务操作 | 留在 dljy-web，不迁移 |
| **共享展示** | 只读聚合/监控展示，无写操作，平台运营与客户都需看到 | 不删除；后台提供同源只读视图即可，客户侧原样保留 |

**批准流程**：用户按本清单逐项批准 → 任务 11.5 **每项一个 PR** 落地；**删除入口或权限收窄的 PR，合并前须用户再次同意**。本清单的「建议分类」只是核实后的推荐，不是决定。

**当前状态：全部待批准**（第 2 节总表「状态」列全部为「待批准」）。

**可见角色读法（先读这段再看表）**：

- 路由层 `adminOnlyRoutes = ['/system/ai-studio', '/system/accounts', '/system/models', '/data-ops/console']`（`src/services/governance.ts:138`）。但 `canAccessPath` **先**判管理员层级再查该名单（`src/services/governance.ts:694-695`）：BOSS 与 ADMIN 都属管理员层级（`adminLevelRoleCodes`，governance.ts:127），**对这四条「ADMIN-only」路由，任意公司的 BOSS 一律放行**——名单实为「管理员层级专用」，只拦交易员/分析师等业务角色。
- `/gsgl/*` 前端对所有登录用户开放（governance.ts:701），写操作由后端 `/api/company/*` 公司写闸门裁决。
- 交付档差异：`canWriteSharedResources`（governance.ts:560-564）内部版仅 ADMIN、客户交付版 ADMIN/BOSS——只管共享资源**写按钮显隐**，后端（#3226/#3238）才是唯一裁决。
- 表中「后端」行的门禁现状引自矩阵 §2/§4：#3164 已把账号/公司表写收窄为客户 BOSS 本公司树、全局角色矩阵/授 ADMIN/建顶层公司仅平台超管；#3226 已把推理启停与网关服务凭据写收窄（内部版平台超管，客户交付版 ADMIN/BOSS）；**采集触发、接入凭据、调度、摄取、会话删除仍放行任意公司 BOSS**。

## 2. 总表

「动作」列读法：R=读，W=写；接口路径为前端实际发起的路径（`/api/*` → Node BFF :4174，`/agent-api/*` → agent-backend :8000，经 `dataServicePath` 改道的 `→ data-svc` → data-service :8190）。

| 入口（tab/面板） | 实际动作（读/写，接口） | 当前可见角色（前端 / 后端） | 建议分类 | 平台后台替代 | 迁移前对拍 | 回退方式 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/system/accounts` › 用户管理 | W：`POST/PATCH /api/auth/users`、`/reset-password`、`/status`、`/revoke-sessions`；R：`GET /api/auth/users`、`GET /api/company/stations?scope=group`（预测厂站绑定选项） | 页：BOSS+ADMIN（任意公司）；后端：#3164 后客户 BOSS 仅本公司树，平台超管全量（矩阵 §4） | 客户自助（本公司树） | 有：M2 客户详情账号摘要（admin.read）+ M4 开通步骤「身份绑定」（customer.manage），后台不开通用账号编辑（矩阵 §2.1） | 同一平台超管身份：旧入口 `GET /auth/users` 与后台客户详情的账号集合/角色/状态逐公司比对；客户 BOSS 登录比对本公司树过滤结果一致 | revert 11.5 对应 PR（旧入口代码保留不动） | 待批准 |
| `/system/accounts` › 会话管理 | R：`GET /api/auth/sessions?scope=mine\|all`、`GET /api/auth/audit?limit=120`；W：`DELETE /api/auth/sessions/:id` | 页：BOSS+ADMIN；后端：ADMIN/BOSS 可看/删**全部**会话（矩阵 §2.1，#3164 未含，见附录 A-2） | 客户自助（矩阵 §2.1：不接入，留客户侧与运维流程） | 无 | —（不迁移；若将来收窄「删全部」权限另行立项对拍） | 同上 | 待批准 |
| `/system/accounts` › 权限矩阵 | R：`GET /api/auth/directory`；W：`POST /api/auth/role-access`、`POST /api/auth/role-access/reset` | 页：BOSS+ADMIN；后端：#3164 后改全局角色矩阵仅平台超管（矩阵 §4）；前端保存按钮**无**对应闸门（见附录 A-4） | 平台内部（全局角色矩阵，影响整个部署全部客户） | 无（矩阵 §2.1：不接入——客户业务角色权限不属于平台后台范围；写已收平台超管） | 任一角色覆写集（`directory.accessOverrides`）改动前后快照一致；平台超管经旧入口写入与本地覆写回放不漂移 | revert 11.5 对应 PR；后端门禁回退 | 待批准 |
| `/system/models` 推理模型管理 | R：`GET /agent-api/v1/forecast/remote/{health,models,models/:id/versions,fields}`；W：`POST …/models/:id/{enable,disable,reload,unload,activate/:v}`、`POST …/rescan` | 页：BOSS+ADMIN；后端写：#3226 后内部版仅平台超管 ADMIN、客户交付版 ADMIN/BOSS（矩阵 §4；前端按钮闸门 `canWriteSharedResources`，governance.ts:560-564） | 平台内部（南洋共享推理模型，启停影响全部客户） | 部分：M4 受控动作 `inference.model.start/stop/reload`（任务 9.4/9.5，`POST /api/v1/admin/service-actions`）；`unload/activate/rescan` 不开放（矩阵 §2.3） | 同一模型：两条路径启停前后 `health/models/versions` 快照一致；受控动作与旧入口的审计留痕可互相核对 | revert 11.5 对应 PR；后端 #3226 门禁回退 | 待批准 |
| `/system/ai-studio` › AI 模型设置（内部版）/ 模型服务（客户交付版） | W：`PUT /agent-api/llm/services`、`PUT/DELETE /agent-api/llm/services/credential`、`POST /agent-api/llm/search/test`、denylist 增删；R：`GET /agent-api/llm/services`、`/services/usage`；另有语音配置/记忆管理（agent-backend） | 页：BOSS+ADMIN；后端网关凭据写：#3226 后同上（矩阵 §4）；内部版页面含供应商/密钥面（客户交付版编译期剔除，仅剩档位启用+角色路由，`AiStudioView.vue:24-26`） | 平台内部（部署级 LLM 供应与凭据，客户不可见供应商信息——#2410/#2668） | 无（矩阵 §2.4：网关凭据是部署侧凭据留运维流程；额度发布走任务 9.2 受控任务，管理令牌永不下发浏览器） | `GET /llm/services` 配置快照（脱敏字段）改动前后一致；用量计数口径一致 | revert 11.5 对应 PR | 待批准 |
| `/system/ai-studio` › 技能工作室 | W：`PUT/PATCH/POST/DELETE /agent-api/agent/skills/*`（SKILL.md 增删改启停）；R：清单 | 页：BOSS+ADMIN；后端：agent-backend 技能库为部署级共享（矩阵未单列收窄） | 平台内部（技能库全体客户共用，写影响所有会话可用能力） | 无 | 技能清单与启用态快照一致；改动后 agent 会话可用技能集合一致 | revert 11.5 对应 PR | 待批准 |
| `/system/ai-studio` › 子智能体工作室 | W：`PUT/DELETE/PATCH/POST /agent-api/agent/sub-agents/*`；R：清单 | 同上 | 平台内部（同上，部署级共享） | 无 | 子智能体清单/归属绑定快照一致 | 同上 | 待批准 |
| `/system/ai-studio` › Dify 工作流工作室 | R：`GET /dify-sso/status`；W：`POST /dify-sso/session`；同源嵌入 `/dify-studio/*` | 页：BOSS+ADMIN；后端：Dify 原生 Studio 会话 | 平台内部（部署级编排设施治理面） | 无 | —（嵌入页，无平台数据写；迁移仅涉入口可见性） | 同上 | 待批准 |
| `/system/ai-studio` › 定时任务调度 | W：`POST/PUT/PATCH/DELETE /agent-api/agent/schedules/*`（CRUD+立即执行）；R：清单+执行历史 | 页：BOSS+ADMIN；后端：部署实例调度器（矩阵 §2.2，service.operate 仅登记动作，不开放通用编辑） | 平台内部（调度任务可触发全部署级 ETL/报告产出） | 无（需要时作为受控动作登记，矩阵 §2.2） | 调度任务清单/cron/启停态快照一致；手动执行一次的任务产出与执行历史一致 | 同上 | 待批准 |
| `/data-ops/console` › 运维总览 | R：`GET /v1/governance/{catalog,quality,backup}`（→ data-svc）；面板跳转按钮 | 页：BOSS+ADMIN；后端：治理只读（业务角色可达端点，仅 ADMIN 看全平台，矩阵 §2.5） | 共享展示（只读聚合：链路四段/告警/批次台账） | 有：M3 服务状态/数据健康聚合（admin.read，按作用域过滤） | 同一样本批次/告警在旧页与后台视图计数、分母未知口径一致 | 不删除；后台视图独立回退 | 待批准 |
| `/data-ops/console` › 数据上传中心 | W：`POST /api/v1/data-upload/precheck`、`/commit`；R：`GET /api/v1/data-upload/{contracts,batches}`（→ data-svc，带 `companyId` scope） | 页：BOSS+ADMIN；后端：业务导入角色，限本公司（矩阵 §2.5） | 客户自助（本公司数据上传，五步预检-确认-台账闭环） | 无（矩阵 §2.5：不接入，客户自助导入留 dljy-web） | —（不迁移） | 不适用 | 待批准 |
| `/data-ops/console` › 数据导入融合台 | W：`POST /v1/import-templates/upload`、模板端点写链（`/v1/{market/trades,settlements,power,customer-load,market-analysis}/import` 等，→ data-svc）；售电结算 FormData 走 `/agent-api`；R：`GET /v1/import-{templates,hub}/records` | 页：BOSS+ADMIN；后端：业务导入角色，限本公司 | 客户自助（手录/模板导入） | 无（同上） | —（不迁移） | 不适用 | 待批准 |
| `/data-ops/console` › 数据接入向导 | W：`triggerIngest('spot-ingest'\|'forecast-etl')`（见附录 A-1 落点存疑）；R：`GET /api/v1/governance/catalog`、`GET /api/v1/import-templates/records` | 页：BOSS+ADMIN；后端：`POST /api/v1/ingest/:kind` 为服务令牌或 TRADE_LEAD/ADMIN/BOSS（矩阵 §2.5，任意 BOSS 放行未收窄） | 平台内部（T0/T1 模板投递后一键生效触发 ETL，写平台全局目录与回放层） | 部分：M4 受控动作（仅登记的补数/重跑，矩阵 §2.5）；通用「一键生效」无 | 同 kind+params 触发一次：exitCode/stdout、capture 回放层新增行数、幂等键去重行为（同键重复点击不重复 spawn）两端一致 | revert 11.5 对应 PR；后端摄取门禁回退 | 待批准 |
| `/data-ops/console` › 数据摄取管理 | W：`triggerIngest` 五个 kind：`weather-export`、`spot-export`、`market-export`、`cgn-yunnan-prices`、`cgn-yunnan-market`（落点存疑同附录 A-1） | 页：BOSS+ADMIN；后端：同上，任意 BOSS 放行未收窄（矩阵 §4） | 平台内部（多数 kind 写平台全局目录；`cgn-*` 写中广核私有库 dljy_private） | 部分：同上 M4 受控动作 | 同上，另加：`cgn-*` 私有库写入按公司隔离比对 | 同上 | 待批准 |
| `/data-ops/console` › 数据治理控制台 | R：`GET /v1/governance/{catalog,quality,backup,db-health}`（→ data-svc） | 页：BOSS+ADMIN；后端：治理只读（仅 ADMIN 看全平台，矩阵 §2.5） | 共享展示（只读体检：目录/质量/备份/库健康） | 有：M3 数据健康聚合（admin.read，分母未知显示未知） | 同一样本在旧页与后台聚合视图的指标/分母口径一致 | 不删除；后台视图独立回退 | 待批准 |
| `/data-ops/console` › 数据源接入 › 电网官方平台 | W：`PUT/DELETE /api/v1/grid-access/points/:id/credentials`、`POST …/credentials/test`、`POST /api/v1/sichuan-ingest/trigger`；R：`GET /api/v1/grid-access/points`、`GET …/credentials`（掩码）、`GET /api/v1/sichuan-ingest[/health]` | 页：BOSS+ADMIN；后端：接入点凭据=全局生效集、采集触发放行任意 BOSS（矩阵 §2.2/§4，未收窄） | 平台内部（国网开放平台凭据全局生效；采集触发影响部署数据链路） | 部分：M3 服务状态按登记部署读取（admin.read）；触发走 M4 受控动作 `grid-ingest.capture.rerun`（任务 9.3/9.5）；凭据录入无替代——后台不接收明文，走既有安全交付（矩阵 §2.2） | 非本人凭据掩码不可见（#1925 口径）两端一致；`sichuan-ingest` 状态/健康快照一致；触发幂等键去重行为一致 | revert 11.5 对应 PR；后端门禁回退 | 待批准 |
| `/data-ops/console` › 数据源接入 › 企业自建通道 | W：`PUT/DELETE /api/v1/data-sources/cgn-yunnan?company=…`、`POST …/test`；R：`GET …`、`GET …/plant-bindings` | 页：BOSS+ADMIN；后端：公司上下文 + ADMIN/BOSS，**某公司**外部数据源（矩阵 §2.2） | 客户自助（中广核云南自建透传为本公司数据源配置） | 无（矩阵 §2.2：不接入，只读摘要可在 M3 评估；客户自助设置留 dljy-web） | —（不迁移） | 不适用 | 待批准 |
| `/data-ops/console` › 数据源接入 › 受控接入 | 无接口（静态受控空态：授权网架 Provider 等待 Owner 交付，`RestrictedProviderTab.vue:5-7`） | 页：BOSS+ADMIN | 共享展示（占位，无操作） | 无 | — | 不适用 | 待批准 |
| `/data-source-settings`、`/sichuan-access` | 无独立动作：重定向壳 → `/data-ops/console?panel=data-source[&tab=official]`（`router/index.ts:167-177,385`） | 随目标面板 | —（重定向壳，随「数据源接入」面板走） | — | — | 随目标面板 | 待批准 |
| `/gsgl/overview` 经营总览 | R：`GET /api/company/dashboard` | 页：全员（governance.ts:701）；后端：RBAC+subjectType+companyId 过滤 | 客户自助（本公司经营指标总览，只读） | 无（矩阵 §2.1：客户业务数据留客户工作台） | —（不迁移） | 不适用 | 待批准 |
| `/gsgl/profile` 公司档案（本体） | W：`POST /api/company/profile`；R：`GET /api/company/profile`、`GET /api/company/list`；公司切换 `canSwitchCompany`（ADMIN/BOSS/GROUP 层级，companyContext.ts:64-66） | 页：全员；写闸门：公司写权限（hasCompanyAdmin=BOSS/ADMIN 显隐，后端最终权威）；#3164 后客户 BOSS 公司写仅本公司树 | 客户自助（本公司档案维护） | 无（矩阵 §2.1：平台客户目录只「引用」既有公司 ID，不复制不改写公司主数据） | —（不迁移） | 不适用 | 待批准 |
| `/gsgl/profile` › 注册立场（立场登记） | W：`PATCH /api/company/companies/:id`（subjectTypes，companyApi.ts:137；CompanyProfileView.vue:62） | 页：全员可见，写按钮 BOSS/ADMIN；后端：#3164 后客户 BOSS 仅本公司树（矩阵 §4）；**落点为平台全局公司表** | 平台内部（立场登记是 TRADER/GROUP 账号立场切换授权的服务端权威，写平台全局公司主数据；矩阵 §2.1 归 `customer.manage`。影响面单公司、但权威面平台级，详见 §3.7） | 无（后台客户目录不改写公司主数据，矩阵 §2.1） | 改某公司 subjectTypes 后：该公司 TRADER/GROUP 账号登录 payload 的 `stances` 允许集合在改动前后按登记推导一致；跨公司主数据零改动 | revert 11.5 对应 PR；后端门禁回退 | 待批准 |
| `/gsgl/assets` 场站机组台账 | W：`POST/PATCH/DELETE /api/company/stations|units`（+`/import`）；R：`GET` | 页：全员；写闸门同上 | 客户自助（本公司台账） | 无（矩阵 §2.1） | —（不迁移） | 不适用 | 待批准 |
| `/gsgl/output` 机组出力 | W：`POST /api/company/unit-output`（+`/import`）；R：`GET` | 同上 | 客户自助 | 无 | —（不迁移） | 不适用 | 待批准 |
| `/gsgl/trades` 历史交易 | W：`POST/PATCH/DELETE /api/company/trades`（+`/import`）；R：`GET` | 同上 | 客户自助 | 无 | —（不迁移） | 不适用 | 待批准 |
| `/gsgl/contracts` 合同管理 | W：`POST/PATCH/DELETE /api/company/contracts`（+`/import`）；R：`GET`（云南已纳管合同分流至 `/zcqjy/*`，路由 meta 注） | 同上 | 客户自助 | 无 | —（不迁移） | 不适用 | 待批准 |
| `/gsgl/report-workshop` 报告工坊 | W：`POST /dify-api/v1/workflows/run`；R：`GET /dify-api/health`（Dify 不可用回退本地模板） | 页：全员；后端：Dify 应用 API | 客户自助（业务报告工具，非管理操作；Dify 为部署级设施但页面不涉治理面） | 无 | —（不迁移） | 不适用 | 待批准 |

## 3. 「平台内部」入口明细

### 3.1 权限矩阵（`/system/accounts?tab=permissions`）

- **为什么是平台内部**：角色矩阵（各业务角色的路由/动作授权覆写）是**整个部署**的授权配置，改一处影响全部客户的全部该角色账号，与任何单一客户无关。矩阵 §2.1 明确「平台全局角色矩阵、不接入」。
- **现状**：#3164 后写端点仅平台超管可写（矩阵 §4）；但客户 BOSS 的页面仍呈现完整编辑界面，点保存 403 后**静默降级保存到浏览器本地**（附录 A-4）。
- **迁移后客户侧看到什么**：建议客户交付版整 tab 隐藏（写权限本就不在客户手上，展示可编辑矩阵是误导）；内部版保留给平台超管。
- **风险**：本地降级矩阵只影响本浏览器，会与服务器权威漂移，排查权限问题时是干扰源；隐藏入口前应先处理 A-4。

### 3.2 推理模型管理（`/system/models`）

- **为什么是平台内部**：南洋推理服务的模型是**跨部署共享**资产，enable/disable/reload 直接改变全部客户的预测能力与显存占用（矩阵 §2.3）。
- **现状**：读路径页面级 BOSS+ADMIN 可达；写按钮已按 `canWriteSharedResources` 预闸（内部版仅 ADMIN），后端 #3226 收窄同步落地。
- **迁移后客户侧看到什么**：客户交付版页面隐藏或转只读（健康/清单/版本保留只读有排障价值）；写动作由后台 M4 受控动作承接（任务 9.4/9.5）。
- **风险**：受控动作未上线前隐藏写入口会造成「无人能启停模型」的运维真空——顺序必须是后台动作先可用、再收客户侧；`unload/activate/rescan` 后台不开放，需保留部署运维通道。

### 3.3 AI 模型设置 / 模型服务（`/system/ai-studio?tab=models`）

- **为什么是平台内部**：LLM 供应商凭据、采样与路由是部署级供应配置（矩阵 §2.4：部署侧凭据留运维流程）；客户交付版本就编译期剔除供应商面（#2410/#2668），仅剩「模型服务」档位面板。
- **迁移后客户侧看到什么**：客户交付版「模型服务」面板保留（档位启用+角色路由是客户侧合理自助）；内部版「AI 模型设置」整页收进 dljy-admin 或运维流程，不再留前端配置面。
- **风险**：网关管理令牌永不下发浏览器（矩阵 §2.4）——后台接管必须由主仓服务端持令牌代理，任何「前端填管理令牌」的迁移方案都违反红线；额度发布属任务 9.2，不在本项范围。

### 3.4 技能 / 子智能体 / Dify 工作流 / 定时任务（`/system/ai-studio` 其余 tab）

- **为什么是平台内部**：技能库与子智能体是全体客户会话共享的能力面（改一个 SKILL.md 影响所有客户的 agent 行为）；定时任务调度可触发部署级 ETL 与报告产出（矩阵 §2.2：调度器按部署实例归属）；Dify Studio 是部署级编排设施。
- **迁移后客户侧看到什么**：整组从客户交付版隐藏（客户无改技能/调度的正当场景）；内部版可暂留 dljy-web 待后台承接，或先行收窄为平台超管可见。
- **风险**：调度任务承载「定时自动摄取」（DataIngestionView 页内链接直达）——收窄前先确认无人依赖客户侧配置的摄取调度，否则数据链路断更；后台无替代项，迁移=可见性收窄而非能力搬迁。

### 3.5 数据接入向导与摄取管理（`/data-ops/console?panel=onboarding|ingest`）

- **为什么是平台内部**：`POST /api/v1/ingest/:kind` 多数 kind 写**平台全局**目录与 capture 回放层（矩阵 §2.5），触发即跑 ETL 子进程，影响全部客户的数据新鲜度；`cgn-*` 两个 kind 写中广核私有库，属单客户但同样是运维操作而非业务操作。
- **现状**：后端任意 BOSS 放行（矩阵 §4 未收窄）；前端触发请求落点存疑（附录 A-1，可能已 404）。
- **迁移后客户侧看到什么**：两面板从客户交付版隐藏；补数/重跑由后台 M4 受控动作承接（仅登记的动作）。客户上传/导入动线（upload/import-hub 面板）不受影响。
- **风险**：受控动作未登记前隐藏 = 数据断更无人能补；A-1 若坐实，这两面板的「立即摄取」在现网可能本来就是坏的——迁移前先修或先实测，避免「迁移把坏功能藏起来」掩盖问题。

### 3.6 电网官方平台（`/data-ops/console?panel=data-source&tab=official`）

- **为什么是平台内部**：国网开放平台接入点凭据是**全局生效集**（改一处影响整个部署的采集），凭据录入本就走安全交付流程、后台不接收明文（矩阵 §2.2）；采集触发影响部署数据链路。
- **现状**：凭据写与采集触发后端放行任意 BOSS（矩阵 §4 未收窄）。
- **迁移后客户侧看到什么**：客户交付版隐藏凭据录入与触发按钮；服务健康状态可保留只读（与 M3 服务状态同源）。凭据交付继续走既有安全流程，由我方运营在后台登记步骤引用。
- **风险**：新网省接入的凭据交付依赖人工流程，隐藏前端入口前须确认交付流程文档同步更新；`sichuan-ingest/trigger` 有「单数据集手动触发」场景（#2501 修复过 query 丢参），受控动作须覆盖该粒度否则运维降级。

### 3.7 注册立场（`/gsgl/profile` 内的立场登记块）

- **为什么是平台内部（存保留意见，请用户裁决）**：写入落点是**平台全局公司主数据表** `PATCH /api/company/companies/:id`（companyApi.ts:137），矩阵 §2.1 把该端点归为平台级 `customer.manage`，且立场登记是 TRADER/GROUP 账号立场切换授权的**服务端权威**（CompanyProfileView.vue:14-15）——这是授权面而非普通业务台账。反方意见：其影响面只在单公司（本公司账号的立场允许集合），#3164 后客户 BOSS 也只能改本公司树。**权威面平台级、影响面单公司**，两者张力交用户裁决；若判客户自助，至少应把「写」从档案页拆出独立小节并保持现状门禁。
- **迁移后客户侧看到什么**：若迁后台：客户侧只读展示已登记立场（账号立场切换本身不受影响，`stances` 允许集合仍由服务端按登记推导下发）；若留客户侧：现状不动。
- **风险**：后台「不改写公司主数据」（矩阵 §2.1）与「接管立场登记」存在原则冲突——若迁，需要在后台为此单开一个经 `customer.manage` 裁决的立场登记接口，而不是转调旧端点；否则应明确「留客户侧」。

## 4. 已知问题附录（只登记，本任务不修）

### A-1 摄取触发用裸 fetch，疑似绕开 data-service 改道（重点核实项；**未运行验证**）

**现象推断**：「数据摄取管理」「数据接入向导」两个面板的触发请求**没有**经 `dataServicePath` 改道，按代码推断会落到平台 BFF（:4174）`/api/v1/ingest/:kind`；而本仓的路由面声明该路径族已归 data-service（:8190）。若平台 BFF 已随 #2169 P2-2a/#2189 退役该处理器，现网点「立即摄取/一键生效」会得到 404（页面显示「摄取失败（HTTP 404）」）。

**证据链**：

1. 触发走裸 fetch，不经统一取数出口的改写点：`src/services/data/ingestClient.ts:65` `fetch(\`/api/v1/ingest/${kind}\`, …)`。改写只发生在 `src/services/api.ts:311`（`pathBase` 内调 `dataServicePath`），仅 `apiGet/apiPost/...` 走该路径。
2. `/v1/ingest/` 明确在 data-service 改道名单：`src/services/dataServiceRoutes.ts:30`（`DATA_SVC_PREFIXES` 含 `'/v1/ingest/'`）。
3. 本仓对该路径族的权威声明即「经 dataServicePath → /data-svc → data-service :8190」：`src/router/index.ts:376`（`/data-ops/console` 路由 meta）与 `src/services/dataServiceRoutes.ts:2-3`（注释列明「摄取触发」属 data-service 装配面）。
4. 同族先例：`src/services/dataServiceRoutes.ts:4-7` 记载 `/v1/settlements` 平台侧处理器已随 full-suite 演示域退役（#1642/#1637），「不改道即落平台 BFF 的 `/api/v1` 下未匹配任何已注册域 404」，实测复现过（#2501 同类）。ingest 族是否同样退役，本仓代码不可见（后端在主仓），无法就此断言 404 必现。
5. 现有 spec 把**未改道**的 URL 固化为预期行为：`src/services/data/ingestClient.spec.ts:73` `expect(url).toBe('/api/v1/ingest/weather-export')`——若修此问题须同步改 spec。
6. 调用方：`src/views/DataIngestionView.vue:44`、`src/views/DataOnboardingView.vue:268`（接入向导的读取类调用 `:201,:207` 走 `apiGet`，**有**被正常改道，唯独触发绕开）。

**推断结论（未运行验证）**：请求落到平台 BFF（:4174）`/api/v1/ingest/:kind`。两种可能：平台 BFF 仍保留 ingestion 处理器（则功能当前正常，但与本仓声明拓扑不一致，属路由双轨债）；或已退役（则现网触发 404，摄取管理/接入向导两个面板的写动线已断）。**建议 11.5 处理前先起本地环境实测一次触发，确认落点与状态码**；`ingestClient.ts:2` 的注释（「经 Vite /api 代理 → Node 4174 ingestion-api.mjs」）写于改道之前，已不可信。

### A-2 会话查看/删除对任意公司 BOSS 全量放行（按矩阵记载；本仓未运行后端验证）

矩阵 §2.1 记载旧门禁「GET/DELETE /api/auth/sessions：登录；ADMIN/BOSS 可看/删全部」，且 §4 的 #3164 修复清单（账号与公司、角色矩阵、授 ADMIN、建顶层公司）未包含会话。前端证据：`src/views/SessionManagementView.vue:15-16`（isAdminLevel → scope=all）、`:65`（`deleteAuthSession`），页面宿主 `/system/accounts` 对任意公司 BOSS 放行（`src/services/governance.ts:694`）。影响：任一客户 BOSS 可枚举并撤销**其它公司**账号的登录会话（跨租户排障/搅扰面）。收窄与否归 11.5 逐项批准。

### A-3 采集触发、接入凭据、调度、摄取旧入口仍放行任意公司 BOSS（矩阵 §4 明示）

矩阵 §4：「其余旧入口（……采集触发与接入凭据、调度、摄取）仍放行任意 BOSS，收窄归 M5 旧入口迁移（任务 11.4/11.5）逐项批准」。前端侧对应事实：这些入口所在的 `/data-ops/console` 与 `/system/ai-studio` 虽列 `adminOnlyRoutes`（governance.ts:138），但该名单只拦非管理员角色——BOSS 在 `canAccessPath` 开头已全放行（governance.ts:694-695），**任意公司的 BOSS 都能进入并操作**这些全局设施。本清单 §3.5/§3.6 的迁移建议即以此为前提。

### A-4 权限矩阵保存无服务端写权限前置判定，失败静默降级「本地矩阵」

#3164 后 `POST /api/auth/role-access` 仅平台超管可写（矩阵 §4），但 `src/views/PermissionMatrixView.vue` 的保存/重置按钮**没有**类似 `canWriteSharedResources` 的前置闸门（对比 `SystemModelsView.vue:30` 的做法）：客户 BOSS 点保存 → 后端 403 → 页面捕获后**把覆写写入浏览器 localStorage** 并提示「后端同步失败，已保存本地矩阵」（`PermissionMatrixView.vue:291-300`，重置同款 `:305-320`）。后果：①点了才 403 的挫败体验；②本地覆写只影响本浏览器（`getAccessOverrides` 读 localStorage，governance.ts:566-575），与服务器权威漂移，是权限问题排查的干扰源。建议 11.5 收窄该入口时一并处理（本任务未修）。
