# 平台后台旧入口迁移清单（四组已批准落地，其余待逐项批准）

> 源自 ChenShi-Tech/dljy#3161（openspec `complete-platform-admin` 任务 11.4，父 Epic #3122）。
> 盘点日期 2026-09-25，基于本仓分支 `glm/issue-3161-entry-migration-list` 代码**只读**核实；
> 旧后端入口的权威归属与门禁结论凡引自《平台后台管理路由矩阵》（任务 2.1 副本，下称「矩阵」）均已标注——矩阵基于主仓 main `69f7a2cda`。
> 2026-09-26 修订（分支 `glm/issue-3161-migration-list-fix`，同属任务 11.4）：总表补「新路径（dljy-admin）」列并把「对拍」列改为能力级「对照结果」；新增运行时对拍方法（§2.1）与范围外相邻入口（§4）；按 dljy 主仓 main 代码更正会话与摄取权限事实（附录 A-2/A-3，会话 #3168、摄取角色集与 cgn-* 公司归属）；回退口径统一为仅前端可见性（AI-06「回退不得恢复已确认的越权路径」）；AI 模型设置页补 MCP 服务器/通知渠道/长期记忆/语音四个面板（§2、§3.3）；补重定向壳明细（§2 表下）。dljy 主仓代码核实均为只读。
> 成文时本文只是清单、**不含任何代码改动**；2026-09-29 用户已批准四组并当日落地（见下条批准记录），其余条目仍须逐项批准后在任务 11.5 另开 PR。
> **2026-09-29 批准记录**：用户批准内部版隐藏四组——AI 设施整组（**长期记忆保留为个人设置**，不随组迁移）；推理模型；数据摄取与电网凭据；权限矩阵与注册立场——依据 ChenShi-Tech/dljy#3464（任务 12.3），当日在 dljy-web#217 落地；实现与回退见 §2.2，对拍结论见 §2.1。
> 2026-09-29 修订（分支 `glm/issue-3518-notice-role-gate`，ChenShi-Tech/dljy#3518）：迁移提示与后台链接补角色闸门——只对平台人员（内部版 ADMIN）显示，客户账号只隐藏入口、不见任何提示文字 / 后台路径 / 链接（规格 AI-06）；注册立场块按 §3.7 恢复客户侧只读展示（所有角色可看、不可编辑、照常读取）。

## 0. 待用户裁决事项（汇总）

除逐项批准外，以下判断点需用户显式裁决（各处标「待用户裁决」，理由见对应小节）：

1. **总表 30 项逐项批准**（§2，含对每项「建议分类」的确认；删除入口或权限收窄的 PR 合并前须再次同意）。
2. **注册立场归属**（§3.7）：权威面平台级（写全局公司主数据表）vs 影响面单公司，平台内部或客户自助二选一。
3. **cgn-\* 摄取 kind 归属**（§3.5）：与「企业自建通道」（客户自助）分类存在口径张力，随面板归平台内部还是单列客户自助。（2026-09-29 面板已随组隐藏，处置见下方裁决记录与 §3.5。）
4. **MCP 服务器面板分类**（§3.3）：倾向平台内部，但写鉴权依赖浏览器持有管理令牌，与「管理令牌永不下发浏览器」红线有既有张力。
5. **通知渠道面板分类**（§3.3）：全局推送凭据倾向平台内部，任务级推送开关属自助，是否拆分处置。
6. **长期记忆管理分类**（§3.3）：删除的是当前用户自己的跨会话记忆，倾向客户自助；但入口嵌在 AI 模型设置页内，整页收走会连带消失。
7. **/grid-assets/\* 是否纳入本次范围**（§4）：判断不在（只读地区网架/披露展示），待确认。
8. **/yygl/ops 是否纳入本次范围**（§4）：判断不在（业务角色日常运营面），待确认。
9. **/yygl/data-browser 是否纳入本次范围**（§4）：判断不在（只读回放+导出），但其「任意已注册数据族」读取面较宽，是否另行审视待确认。

2026-09-29 裁决：第 1 条中四组 13 项批准隐藏并已落地（§2.2）；第 2 条注册立场、第 4 条 MCP、第 5 条通知渠道（连同任务级开关所在的定时任务 tab 整块随 AI 设施组隐藏）归平台内部；第 6 条长期记忆归客户自助、保留。第 3 条 cgn-\* 摄取归属相应落地：包含 cgn-\* 按钮的「数据摄取管理」面板已随数据摄取组在内部版整体隐藏（§2 总表、registry `data-ingest`），cgn-\* 摄取改在平台后台数据摄取页（`/#/data/ingest`）操作，客户交付版不变；「企业自建通道」数据源配置面板本身保留客户侧（§2，待批准）。其余裁决事项（第 7–9 条范围判断）不变。

## 1. 本清单是什么

**用途**：平台后台（独立仓 dljy-admin，仅我方运营人员）逐步接管「平台内部」管理操作。客户前端（本仓 dljy-web）现存一批旧管理入口，本清单把每个入口（到 tab/面板粒度）的**实际动作、当前可见角色、建议归属、后台替代、新路径、对照结果与回退**核实登记，供用户逐项批准。

**分类口径**：

| 分类 | 定义 | 迁移动向 |
| --- | --- | --- |
| **平台内部** | 操作影响整个部署或跨客户（全局配置、共享模型、全局凭据、平台公司主数据），操作者应为我方运营/平台管理员 | 迁往 dljy-admin（或后台接管后客户侧隐藏/只读/提示跳转） |
| **客户自助** | 操作只影响本公司（`companyId` 隔离的业务数据），属客户日常业务操作 | 留在 dljy-web，不迁移 |
| **共享展示** | 只读聚合/监控展示，无写操作，平台运营与客户都需看到 | 不删除；后台提供同源只读视图即可，客户侧原样保留 |

**批准流程**：用户按本清单逐项批准（当前共 30 项，§2 总表）→ 任务 11.5 **每项一个 PR** 落地；**删除入口或权限收窄的 PR，合并前须用户再次同意**。本清单的「建议分类」只是核实后的推荐，不是决定。

**回退口径（AI-06/D13，全文统一）**：本清单所有「回退方式」一律只指**前端入口可见性/路由的回退**（恢复旧入口显示）；**后端越权修复（#3164、#3168、#3226 等）不随任何回退恢复**——AI-06 规定「回退不得恢复已确认的越权路径」，D13「只回退已验收的安全入口，不恢复被确认越权的路径」。

**当前状态**：2026-09-29 起四组 13 项「已批准并落地」、长期记忆「已批准保留」，其余仍「待批准」（以第 2 节总表「状态」列为准）。

**可见角色读法（先读这段再看表）**：

- 路由层 `adminOnlyRoutes = ['/system/ai-studio', '/system/accounts', '/system/models', '/data-ops/console']`（`src/services/governance.ts:138`）。但 `canAccessPath` **先**判管理员层级再查该名单（`src/services/governance.ts:694-695`）：BOSS 与 ADMIN 都属管理员层级（`adminLevelRoleCodes`，governance.ts:127），**对这四条「ADMIN-only」路由，任意公司的 BOSS 一律放行**——名单实为「管理员层级专用」，只拦交易员/分析师等业务角色。
- `/gsgl/*` 前端对所有登录用户开放（governance.ts:701），写操作由后端 `/api/company/*` 公司写闸门裁决。
- 交付档差异：`canWriteSharedResources`（governance.ts:560-564）内部版仅 ADMIN、客户交付版 ADMIN/BOSS——只管共享资源**写按钮显隐**，后端（#3226/#3238）才是唯一裁决。
- 表中「后端」行的门禁现状：#3164 已把账号/公司表写收窄为客户 BOSS 本公司树、全局角色矩阵/授 ADMIN/建顶层公司仅平台超管；#3226 已把推理启停与网关服务凭据写收窄（内部版平台超管，客户交付版 ADMIN/BOSS）；#3168 已把会话查看/撤销收窄到管理范围（附录 A-2）；**采集触发、接入凭据、调度仍放行任意公司 BOSS；摄取触发放行角色更宽（七个角色含 TRADER 等业务角色，附录 A-3）**。

## 2. 总表

「动作」列读法：R=读，W=写；接口路径为前端实际发起的路径（`/api/*` → Node BFF :4174，`/agent-api/*` → agent-backend :8000，经 `dataServicePath` 改道的 `→ data-svc` → data-service :8190）。

「新路径」列读法：平台内部项写 dljy-admin 目标路由（后台路由表 = dljy-admin `src/app/router.ts:24-42`，下称「admin 路由表」；受控动作接口为主仓 `POST /api/v1/admin/service-actions`，动作执行进展落 `/operations/:operationId`）；**已落地隐藏的四组入口以迁移登记表 `src/features/platformAdminMigration/registry.ts` 的 `MIGRATED_ENTRIES` 后台 hash 路径为准**（2026-09-29 后台已建对应页面）。无对应页面才写「暂无（平台后台缺该能力）」。客户自助/共享展示项写「保留（原路径）」或「保留，隐藏/只读」。

「对照结果」列读法：能力级静态结论——对齐/部分/缺失 + 缺什么 + 依据（后台页面或接口文件:行号）；运行时对拍另见 §2.1——已落地四组经 2026-09-29 一次性实例演练对拍一致（登记表见 §2.1），其余项获准迁移前仍须执行 §2.1 对拍并登记回本文档。

| 入口（tab/面板） | 实际动作（读/写，接口） | 当前可见角色（前端 / 后端） | 建议分类 | 平台后台替代 | 新路径（dljy-admin） | 对照结果（能力级） | 回退方式 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/system/accounts` › 用户管理 | W：`POST/PATCH /api/auth/users`、`/reset-password`、`/status`、`/revoke-sessions`；R：`GET /api/auth/users`、`GET /api/company/stations?scope=group`（预测厂站绑定选项） | 页：BOSS+ADMIN（任意公司）；后端：#3164 后客户 BOSS 仅本公司树，平台超管全量（矩阵 §4） | 客户自助（本公司树） | 有：M2 客户详情账号摘要（admin.read）+ M4 开通步骤「身份绑定」（customer.manage），后台不开通用账号编辑（矩阵 §2.1） | 保留（原路径）；平台侧只读摘要 `/customers/:id` | 部分：只读摘要+身份绑定有，通用账号编辑无（admin 路由表无账号编辑页；矩阵 §2.1） | revert 11.5 对应 PR（旧入口代码保留不动） | 待批准 |
| `/system/accounts` › 会话管理 | R：`GET /api/auth/sessions?scope=mine\|all`、`GET /api/auth/audit?limit=120`；W：`DELETE /api/auth/sessions/:id` | 页：BOSS+ADMIN；后端：#3168 后 `scope=all` 仅返回管理范围内账号会话（客户 BOSS=本公司树，平台超管=全部），撤销他人会话须目标账号在管理范围内、范围外 404（`dljy/server/auth-store.mjs:395-412,414-434`，附录 A-2） | 客户自助（矩阵 §2.1：不接入，留客户侧与运维流程） | 无 | 保留（原路径） | —（不迁移；越权面已由 #3168 关闭，不再构成迁移阻塞） | 同上 | 待批准 |
| `/system/accounts` › 权限矩阵 | R：`GET /api/auth/directory`；W：`POST /api/auth/role-access`、`POST /api/auth/role-access/reset` | 页：BOSS+ADMIN；后端：#3164 后改全局角色矩阵仅平台超管（矩阵 §4）；前端保存按钮**无**对应闸门（见附录 A-4） | 平台内部（全局角色矩阵，影响整个部署全部客户） | 有：角色权限矩阵页（registry `role-matrix`；矩阵 §2.1 原判「不接入」，2026-09-29 后台已建页承接） | `/#/access/role-matrix` | 已对拍一致（见 §2.1） | 按组回退：`src/features/platformAdminMigration/registry.ts` 的 `MIGRATION_GROUPS['access-registry'].hidden` 改为 `false` 后重新构建（只恢复内部版前端入口可见性；后端门禁收窄**不回退**） | 已批准（2026-09-29）并落地于 dljy-web#217（ChenShi-Tech/dljy#3464） |
| `/system/models` 推理模型管理 | R：`GET /agent-api/v1/forecast/remote/{health,models,models/:id/versions,fields}`；W：`POST …/models/:id/{enable,disable,reload,unload,activate/:v}`、`POST …/rescan` | 页：BOSS+ADMIN；后端写：#3226 后内部版仅平台超管 ADMIN、客户交付版 ADMIN/BOSS（矩阵 §4；前端按钮闸门 `canWriteSharedResources`，governance.ts:560-564） | 平台内部（南洋共享推理模型，启停影响全部客户） | 有：推理模型管理页（registry `inference-models`）；启停/重载走 M4 受控动作 `inference.model.start/stop/reload`（任务 9.4/9.5，`POST /api/v1/admin/service-actions`），`unload/activate/rescan` 仍不经后台开放（矩阵 §2.3） | `/#/inference/models`；受控动作进展 `/operations/:operationId` | 已对拍一致（见 §2.1；演练环境推理未配，两侧一致地不可用） | 按组回退：`src/features/platformAdminMigration/registry.ts` 的 `MIGRATION_GROUPS['inference-models'].hidden` 改为 `false` 后重新构建（只恢复内部版前端入口可见性；后端门禁收窄**不回退**） | 已批准（2026-09-29）并落地于 dljy-web#217（ChenShi-Tech/dljy#3464） |
| `/system/ai-studio` › AI 模型设置 › LLM 服务与凭据（内部版）/ 模型服务档位（客户交付版） | W：`PUT /agent-api/llm/services`、`PUT/DELETE /agent-api/llm/services/credential`、`POST /agent-api/llm/search/test`、denylist 增删；R：`GET /agent-api/llm/services`、`/services/usage`。语音播报为**纯前端 localStorage**（`src/services/voice.ts:14-35`，键 `dljy_voice_config`），无后端接口，不属迁移项 | 页：BOSS+ADMIN；后端网关凭据写：#3226 后同上（矩阵 §4）；内部版页面含供应商/密钥面（客户交付版编译期剔除，仅剩档位启用+角色路由，`src/views/AiStudioView.vue:24-26`） | 平台内部（部署级 LLM 供应与凭据，客户不可见供应商信息——#2410/#2668） | 有：模型服务页（registry `ai-llm`）与搜索黑名单页（registry `ai-search`）；管理令牌由服务端持有、永不下发浏览器（矩阵 §2.4） | `/#/ai/llm`、`/#/ai/search` | 已对拍一致（见 §2.1） | 按组回退：`src/features/platformAdminMigration/registry.ts` 的 `MIGRATION_GROUPS['ai-infra'].hidden` 改为 `false` 后重新构建（只恢复内部版前端入口可见性；后端门禁收窄**不回退**） | 已批准（2026-09-29）并落地于 dljy-web#217（ChenShi-Tech/dljy#3464） |
| `/system/ai-studio` › AI 模型设置 › MCP 服务器面板 | W：`POST/PUT/DELETE /agent-api/agent/llm/mcp-servers[/:name]`、`POST …/:name/test`（写带 `x-admin-token`，`src/services/agent/mcpClient.ts:8,57-85`；挂载 `src/views/AiSettingsView.vue:612-615`）；R：清单 | 页：BOSS+ADMIN；后端：agent-backend，写鉴权 `x-admin-token`（服务端未配 token 时放行——单机/演示，mcpClient.ts:2-3） | 倾向平台内部（部署级共享外部能力边界；**待用户裁决**，§3.3） | 有：MCP 服务器页（registry `ai-mcp`） | `/#/ai/mcp` | 已对拍一致（见 §2.1） | 按组回退：`src/features/platformAdminMigration/registry.ts` 的 `MIGRATION_GROUPS['ai-infra'].hidden` 改为 `false` 后重新构建（只恢复内部版前端入口可见性；后端门禁收窄**不回退**） | 已批准（2026-09-29）并落地于 dljy-web#217（ChenShi-Tech/dljy#3464） |
| `/system/ai-studio` › AI 模型设置 › 调度结果推送渠道 | W：`PUT /agent-api/agent/notify`（webhook/smtp/feishu/wecom/dingtalk 全局渠道凭据，写带 `x-admin-token`，`src/services/agent/notifyClient.ts:57-65`）、`POST /agent-api/agent/notify/test`；R：`GET /agent-api/agent/notify`（挂载 `src/views/AiSettingsView.vue:617-620`；任务级开关在「定时任务调度」tab） | 页：BOSS+ADMIN；后端：agent-backend，同 MCP 的 `x-admin-token` 写鉴权（notifyClient.ts:3,30-39） | 倾向平台内部（部署级推送凭据；任务级开关属自助；**待用户裁决**，§3.3） | 有：调度结果推送渠道页（registry `ai-notify`） | `/#/ai/notify` | 已对拍一致（见 §2.1） | 按组回退：`src/features/platformAdminMigration/registry.ts` 的 `MIGRATION_GROUPS['ai-infra'].hidden` 改为 `false` 后重新构建（只恢复内部版前端入口可见性；后端门禁收窄**不回退**） | 已批准（2026-09-29）并落地于 dljy-web#217（ChenShi-Tech/dljy#3464） |
| `/system/ai-studio` › AI 模型设置 › 长期记忆管理 | W：`DELETE /agent-api/agent/memory[/:key]`（清空/删单条，仅登录身份 `identityHeaders`，`src/services/agent/memoryConfig.ts:7,28-48`）；R：`GET /agent-api/agent/memory`（挂载 `src/views/AiSettingsView.vue:639-662`） | 页：BOSS+ADMIN；后端：agent-backend，**按当前登录账号隔离**（AiSettingsView.vue:646「按你的登录账号隔离」） | 倾向客户自助（当前用户自己的跨会话记忆；**待用户裁决**——入口嵌在本页，整页收走会连带消失，§3.3） | 无 | 保留（原路径或随自助面保留） | —（若留客户侧则不迁移；裁决见 §3.3） | 不适用（保留；内部版随 AI 设施组迁移改由「个人设置」tab 承载，按组回退后回到原页） | 已批准保留（2026-09-29，个人自助）；内部版移入 AI 工作室「个人设置」tab，落地于 dljy-web#217（ChenShi-Tech/dljy#3464） |
| `/system/ai-studio` › 技能工作室 | W：`PUT/PATCH/POST/DELETE /agent-api/agent/skills/*`（SKILL.md 增删改启停）；R：清单 | 页：BOSS+ADMIN；后端：agent-backend 技能库为部署级共享（矩阵未单列收窄） | 平台内部（技能库全体客户共用，写影响所有会话可用能力） | 有：技能工作室页（registry `ai-skills`） | `/#/ai/skills` | 已对拍一致（见 §2.1） | 按组回退：`src/features/platformAdminMigration/registry.ts` 的 `MIGRATION_GROUPS['ai-infra'].hidden` 改为 `false` 后重新构建（只恢复内部版前端入口可见性；后端门禁收窄**不回退**） | 已批准（2026-09-29）并落地于 dljy-web#217（ChenShi-Tech/dljy#3464） |
| `/system/ai-studio` › 子智能体工作室 | W：`PUT/DELETE/PATCH/POST /agent-api/agent/sub-agents/*`；R：清单 | 同上 | 平台内部（同上，部署级共享） | 有：子智能体工作室页（registry `ai-sub-agents`） | `/#/ai/sub-agents` | 已对拍一致（见 §2.1） | 按组回退：`src/features/platformAdminMigration/registry.ts` 的 `MIGRATION_GROUPS['ai-infra'].hidden` 改为 `false` 后重新构建（只恢复内部版前端入口可见性；后端门禁收窄**不回退**） | 已批准（2026-09-29）并落地于 dljy-web#217（ChenShi-Tech/dljy#3464） |
| `/system/ai-studio` › Dify 工作流工作室 | R：`GET /dify-sso/status`；W：`POST /dify-sso/session`；同源嵌入 `/dify-studio/*` | 页：BOSS+ADMIN；后端：Dify 原生 Studio 会话 | 平台内部（部署级编排设施治理面） | 有：Dify 工作流工作室页（registry `ai-dify`） | `/#/ai/dify` | 已对拍一致（见 §2.1；Dify 签发成功路径未在演练覆盖，见 §2.1 局限） | 按组回退：`src/features/platformAdminMigration/registry.ts` 的 `MIGRATION_GROUPS['ai-infra'].hidden` 改为 `false` 后重新构建（只恢复内部版前端入口可见性；后端门禁收窄**不回退**） | 已批准（2026-09-29）并落地于 dljy-web#217（ChenShi-Tech/dljy#3464） |
| `/system/ai-studio` › 定时任务调度 | W：`POST/PUT/PATCH/DELETE /agent-api/agent/schedules/*`（CRUD+立即执行）；R：清单+执行历史 | 页：BOSS+ADMIN；后端：部署实例调度器（矩阵 §2.2，service.operate 仅登记动作，不开放通用编辑） | 平台内部（调度任务可触发全部署级 ETL/报告产出） | 有：定时任务调度页（registry `ai-schedules`）；补数/重跑类需要时仍作为受控动作登记（矩阵 §2.2） | `/#/ai/schedules`；受控动作进展 `/operations/:operationId` | 已对拍一致（见 §2.1） | 按组回退：`src/features/platformAdminMigration/registry.ts` 的 `MIGRATION_GROUPS['ai-infra'].hidden` 改为 `false` 后重新构建（只恢复内部版前端入口可见性；后端门禁收窄**不回退**） | 已批准（2026-09-29）并落地于 dljy-web#217（ChenShi-Tech/dljy#3464） |
| `/data-ops/console` › 运维总览 | R：`GET /v1/governance/{catalog,quality,backup}`（→ data-svc）；面板跳转按钮 | 页：BOSS+ADMIN；后端：治理只读（业务角色可达端点，仅 ADMIN 看全平台，矩阵 §2.5） | 共享展示（只读聚合：链路四段/告警/批次台账） | 有：M3 服务状态/数据健康聚合（admin.read，按作用域过滤） | 保留（原路径）；后台同源视图 `/services`、`/data` | 部分：聚合同源有（按作用域过滤），明细面板跳转按钮无（admin 路由表无对应明细页） | 不删除；后台视图独立回退 | 待批准 |
| `/data-ops/console` › 数据上传中心 | W：`POST /api/v1/data-upload/precheck`、`/commit`；R：`GET /api/v1/data-upload/{contracts,batches}`（→ data-svc，带 `companyId` scope） | 页：BOSS+ADMIN；后端：业务导入角色，限本公司（矩阵 §2.5） | 客户自助（本公司数据上传，五步预检-确认-台账闭环） | 无（矩阵 §2.5：不接入，客户自助导入留 dljy-web） | 保留（原路径） | —（不迁移） | 不适用 | 待批准 |
| `/data-ops/console` › 数据导入融合台 | W：`POST /v1/import-templates/upload`、模板端点写链（`/v1/{market/trades,settlements,power,customer-load,market-analysis}/import` 等，→ data-svc）；售电结算 FormData 走 `/agent-api`；R：`GET /v1/import-{templates,hub}/records` | 页：BOSS+ADMIN；后端：业务导入角色，限本公司 | 客户自助（手录/模板导入） | 无（同上） | 保留（原路径） | —（不迁移） | 不适用 | 待批准 |
| `/data-ops/console` › 数据接入向导 | W：`triggerIngest('spot-ingest'\|'forecast-etl')`（见附录 A-1，当前 404）；R：`GET /api/v1/governance/catalog`、`GET /api/v1/import-templates/records` | 页：BOSS+ADMIN；后端：`POST /api/v1/ingest/:kind` 为服务令牌或 `INGEST_ROLES` 七角色之一（SETTLEMENT/RETAIL_MANAGER/TRADER/TRADE_LEAD/PLANT_OPERATOR/ADMIN/BOSS，比矩阵 §2.5 记载的「任意 BOSS」更宽，`dljy/server/ingestion-api.mjs:36,460-461`，附录 A-3） | 平台内部（T0/T1 模板投递后一键生效触发 ETL，写平台全局目录与回放层） | 有：数据摄取页（registry `data-onboarding`）；补数/重跑走 M4 受控动作（矩阵 §2.5） | `/#/data/ingest`；受控动作进展 `/operations/:operationId` | 已对拍一致（见 §2.1；摄取真实执行未在演练覆盖，见 §2.1 局限） | 按组回退：`src/features/platformAdminMigration/registry.ts` 的 `MIGRATION_GROUPS['data-ingest'].hidden` 改为 `false` 后重新构建（只恢复内部版前端入口可见性；后端门禁收窄**不回退**） | 已批准（2026-09-29）并落地于 dljy-web#217（ChenShi-Tech/dljy#3464） |
| `/data-ops/console` › 数据摄取管理 | W：`triggerIngest` 四个 kind：`weather-export`、`spot-export`、`cgn-yunnan-prices`、`cgn-yunnan-market`（原 `market-export` 随市场经营分析页下线删除，ChenShi-Tech/dljy#3391）（同附录 A-1，当前 404） | 页：BOSS+ADMIN；后端：同上七角色；`cgn-*` 三个 kind（含前端未列出的 `cgn-series-to-capture`）固定 `ownerCompanyId: 'comp-cgn-yunnan'`，非中广核公司账号触发被拒（`dljy/server/ingestion-api.mjs:145-151,201-216,463-466`） | 平台内部（多数 kind 写平台全局目录；`cgn-*` 写中广核私有库——**归属存争议待用户裁决**，§3.5） | 有：数据摄取页（registry `data-ingest`）；补数/重跑走 M4 受控动作 | `/#/data/ingest`；受控动作进展 `/operations/:operationId` | 已对拍一致（见 §2.1；cgn-\* 摄取改在后台数据摄取页操作、客户交付版不变——§0 裁决第 3 条） | 按组回退：`src/features/platformAdminMigration/registry.ts` 的 `MIGRATION_GROUPS['data-ingest'].hidden` 改为 `false` 后重新构建（只恢复内部版前端入口可见性；后端门禁收窄**不回退**） | 已批准（2026-09-29）并落地于 dljy-web#217（ChenShi-Tech/dljy#3464） |
| `/data-ops/console` › 数据治理控制台 | R：`GET /v1/governance/{catalog,quality,backup,db-health}`（→ data-svc） | 页：BOSS+ADMIN；后端：治理只读（仅 ADMIN 看全平台，矩阵 §2.5） | 共享展示（只读体检：目录/质量/备份/库健康） | 有：M3 数据健康聚合（admin.read，分母未知显示未知） | 保留（原路径）；后台同源视图 `/data` | 部分：数据健康聚合有；目录/备份/库健康明细页无（admin 路由表无） | 不删除；后台视图独立回退 | 待批准 |
| `/data-ops/console` › 数据源接入 › 电网官方平台 | W：`PUT/DELETE /api/v1/grid-access/points/:id/credentials`、`POST …/credentials/test`、`POST /api/v1/sichuan-ingest/trigger`；R：`GET /api/v1/grid-access/points`、`GET …/credentials`（掩码）、`GET /api/v1/sichuan-ingest[/health]` | 页：BOSS+ADMIN；后端：接入点凭据=全局生效集、采集触发放行任意 BOSS（矩阵 §2.2/§4，未收窄） | 平台内部（国网开放平台凭据全局生效；采集触发影响部署数据链路） | 有：电网官方平台页（接入点凭据与采集运维，registry `grid-credentials`）；采集重跑走 M4 受控动作 `grid-ingest.capture.rerun`（任务 9.3/9.5） | `/#/data/grid-credentials`；重跑进展 `/operations/:operationId` | 已对拍一致（见 §2.1；曾发现的「生效集更新时间」1 毫秒差异 #3491 已由 #3505 修复） | 按组回退：`src/features/platformAdminMigration/registry.ts` 的 `MIGRATION_GROUPS['data-ingest'].hidden` 改为 `false` 后重新构建（只恢复内部版前端入口可见性；后端门禁收窄**不回退**） | 已批准（2026-09-29）并落地于 dljy-web#217（ChenShi-Tech/dljy#3464） |
| `/data-ops/console` › 数据源接入 › 企业自建通道 | W：`PUT/DELETE /api/v1/data-sources/cgn-yunnan?company=…`、`POST …/test`；R：`GET …`、`GET …/plant-bindings` | 页：BOSS+ADMIN；后端：公司上下文 + ADMIN/BOSS，**某公司**外部数据源（矩阵 §2.2） | 客户自助（中广核云南自建透传为本公司数据源配置） | 无（矩阵 §2.2：不接入，只读摘要可在 M3 评估；客户自助设置留 dljy-web） | 保留（原路径） | —（不迁移；与 `cgn-*` 摄取 kind 的归属张力见 §3.5 裁决项） | 不适用 | 待批准 |
| `/data-ops/console` › 数据源接入 › 受控接入 | 无接口（静态受控空态：授权网架 Provider 等待 Owner 交付，`src/views/data-access/RestrictedProviderTab.vue:4-7`） | 页：BOSS+ADMIN | 共享展示（占位，无操作） | 无 | 保留（原路径） | — | 不适用 | 待批准 |
| 重定向壳（收编旧路径，明细见表下） | 无独立动作：redirect 到合并页对应 tab/panel，不带 meta、不进 feature-map/manifest（`src/router/index.ts:139-177`）；明细见下 | 随目标面板 | —（重定向壳，随目标面板走） | — | 随目标面板 | — | 随目标面板 | 随目标面板：上述四组的壳已于 dljy-web#217 改为「目标已迁则落宿主页默认 tab + 提示」（ChenShi-Tech/dljy#3464） |
| `/gsgl/overview` 经营总览 | R：`GET /api/company/dashboard` | 页：全员（governance.ts:701）；后端：RBAC+subjectType+companyId 过滤 | 客户自助（本公司经营指标总览，只读） | 无（矩阵 §2.1：客户业务数据留客户工作台） | 保留（原路径） | —（不迁移） | 不适用 | 待批准 |
| `/gsgl/profile` 公司档案（本体） | W：`POST /api/company/profile`；R：`GET /api/company/profile`、`GET /api/company/list`；公司切换 `canSwitchCompany`（ADMIN/BOSS 角色，#2898 起提权只认角色不认层级，GROUP 层级不再自动可切换，`src/services/company/companyContext.ts`） | 页：全员；写闸门：公司写权限（hasCompanyAdmin=BOSS/ADMIN 显隐，后端最终权威）；#3164 后客户 BOSS 公司写仅本公司树 | 客户自助（本公司档案维护） | 无（矩阵 §2.1：平台客户目录只「引用」既有公司 ID，不复制不改写公司主数据） | 保留（原路径） | —（不迁移） | 不适用 | 待批准 |
| `/gsgl/profile` › 注册立场（立场登记） | W：`PATCH /api/company/companies/:id`（subjectTypes，`src/services/company/companyApi.ts:136-138`；`src/views/company/CompanyProfileView.vue:62`） | 页：全员可见，写按钮 BOSS/ADMIN；后端：#3164 后客户 BOSS 仅本公司树（矩阵 §4）；**落点为平台全局公司表** | 平台内部（立场登记是 TRADER/GROUP 账号立场切换授权的服务端权威，写平台全局公司主数据；矩阵 §2.1 归 `customer.manage`。影响面单公司、但权威面平台级，详见 §3.7） | 有：客户目录客户详情的注册立场分区（registry `subject-registry`） | `/#/customers`（打开对应客户的注册立场分区） | 已对拍一致（见 §2.1；重启持久化经补演 19 项验证） | 按组回退：`src/features/platformAdminMigration/registry.ts` 的 `MIGRATION_GROUPS['access-registry'].hidden` 改为 `false` 后重新构建（只恢复内部版前端入口可见性；后端门禁收窄**不回退**） | 已批准（2026-09-29）并落地于 dljy-web#217（ChenShi-Tech/dljy#3464） |
| `/gsgl/assets` 场站机组台账 | W：`POST/PATCH/DELETE /api/company/stations\|units`（+`/import`）；R：`GET` | 页：全员；写闸门同上 | 客户自助（本公司台账） | 无（矩阵 §2.1） | 保留（原路径） | —（不迁移） | 不适用 | 待批准 |
| `/gsgl/output` 机组出力 | W：`POST /api/company/unit-output`（+`/import`）；R：`GET` | 同上 | 客户自助 | 无 | 保留（原路径） | —（不迁移） | 不适用 | 待批准 |
| `/gsgl/trades` 历史交易 | W：`POST/PATCH/DELETE /api/company/trades`（+`/import`）；R：`GET` | 同上 | 客户自助 | 无 | 保留（原路径） | —（不迁移） | 不适用 | 待批准 |
| `/gsgl/contracts` 合同管理 | W：`POST/PATCH/DELETE /api/company/contracts`（+`/import`）；R：`GET`（云南已纳管合同分流至 `/zcqjy/*`，路由 meta 注） | 同上 | 客户自助 | 无 | 保留（原路径） | —（不迁移） | 不适用 | 待批准 |
| `/gsgl/report-workshop` 报告工坊 | W：`POST /dify-api/v1/workflows/run`；R：`GET /dify-api/health`（Dify 不可用回退本地模板） | 页：全员；后端：Dify 应用 API | 客户自助（业务报告工具，非管理操作；Dify 为部署级设施但页面不涉治理面） | 无 | 保留（原路径） | —（不迁移） | 不适用 | 待批准 |

**重定向壳明细**（统一规则：被 tab 化收编的旧路径保留 redirect、原 query 透传，不带 meta、不进 feature-map/manifest，迁移/回退随目标面板走；`src/router/index.ts`，2026-09-26 核实）：

- → `/system/accounts?tab=`（辅助函数 `:146-149`；注册 `:222,230-231`）：`/system/permissions`、`/system/users`、`/system/sessions`。
- → `/system/ai-studio?tab=`（`:141-144`；注册 `:232,303-304,384,393-394`）：`/system/schedules`、`/xhjy/ai-orchestration-studio`、`/xhjy/dify-studio`、`/ai-settings`、`/ai-skills`、`/ai-sub-agents`。
- → `/data-ops/console?panel=`（`opsPanelRedirects` `:167-177`）：`/yygl/data-onboarding`、`/yygl/import-hub`、`/yygl/data-governance`、`/yygl/ingest`、`/data-ops/upload`、`/data-source-settings`；另 `/sichuan-access` 两级重定向（先落 `/data-source-settings?tab=official` 再落 console 的 data-source 面板，`:160-163,385`）。

### 2.1 运行时对拍：方法与已执行对拍登记

「对照结果」列是**静态能力级**结论（读代码得出）；真正切换前还须做**运行时对拍**（AI-06：新旧链路 SHALL 对齐**同身份、客户、地区和日期**的结果，存在差异即停止切换）。对拍四维度：

1. **同身份**：同一操作者账号（平台超管做平台内部项、受影响客户 BOSS 做客户侧保留项）分别走旧入口与 dljy-admin 新路径，比对可见数据集合与操作结果一致。
2. **逐公司**：对每家受影响公司（含跨树子公司）分别对拍，验证公司隔离口径一致（`companyId`/管理范围过滤、本公司树推导）。
3. **逐地区**：按数据地区维度（yunnan/sichuan 等）分别对拍，验证地区工作区分发与口径一致；非基线地区保持诚实为空，不串读山西口径。
4. **逐日期**：对同一样本日期区间（含最新批次与历史回看窗口）对拍，验证数据新鲜度、批次与计数口径一致。

**已执行对拍（2026-09-29，已落地四组）**：发生在任务 12.4 一次性实例 B 类演练（本机临时实例，跑完即拆，不代表任何真实客户），比的是**配置生效值**——写前、写后、清理后各比一轮，16 类资源、21 个对比项业务生效值两侧一致；18 次「后台写 → 旧入口读」全部读到新值；推理模型演练环境未配推理，两侧一致地不可用。证据：ChenShi-Tech/dljy#3282 评论 5884334217。**局限（如实登记）**：该对拍未按上述四维度逐公司、逐地区、逐日期展开（单实例、种子公司），也不含前端界面与真正访问外部的执行路径（模型连通、搜索、通知、MCP 测试、Dify 签发成功路径、摄取服务令牌通道、采集重跑与推理启停的真实执行）；演练发现的 #3490、#3491 已分别由 #3504、#3505 修复合并，注册立场重启持久化经补演复验 19 项全部通过（ChenShi-Tech/dljy#3282 评论 5885283669）。

其余待批准项仍按原时机执行：11.5 **每项获准迁移前**执行本节四维度对拍；对拍结果（含差异与处置）登记到下表，逐项追加。存在差异的项保持未迁移并记录差异，修复与复验前不关闭该项（AI-06 场景「对照出现权限或数据差异」）。

| 日期 | 入口项 | 对拍身份 | 公司 | 地区 | 日期窗口 | 结果（一致/差异） | 差异与处置 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-29 | 已落地四组（16 类资源、21 对比项，配置生效值，写前/写后/清理后各一轮） | 平台超管（种子账号 demo）与客户 BOSS（sande-admin） | 单实例种子公司（未逐公司） | 未分地区 | 未分日期窗口 | 一致 | 业务生效值两侧一致；18 次「后台写 → 旧入口读」全部读到新值；推理未配、两侧一致地不可用（ChenShi-Tech/dljy#3282 评论 5884334217） |
| 2026-09-29 | 电网凭据清单「生效集更新时间」 | 同上 | 同上 | 同上 | 同上 | 差异（已闭环） | 两侧差 1 毫秒，登记 #3491（低危），已由 #3505 修复 |
| 2026-09-29 | 注册立场（重启持久化补演，19 项检查） | 平台超管 | comp-sande-puhua | 未分地区 | 三次启动（含连续两次重启） | 一致 | 后台改后后台页、`/api/company/list`、数据库三处读到新值，审计 +1，重启后保持，启动种子只补缺不覆盖（#3490 已由 #3504 修复；ChenShi-Tech/dljy#3282 评论 5885283669） |
| （其余待批准项获准迁移前按四维度执行后逐项登记） | | | | | | | |

### 2.2 内部版隐藏落地（2026-09-29，任务 12.3，ChenShi-Tech/dljy#3464，PR dljy-web#217）

- **范围**：用户按组批准的四组，**只影响内部版，客户交付版一律不变**。
  - AI 设施（`/system/ai-studio`）：模型服务（含 LLM 服务与凭据、采样参数、角色路由、工作流参数、用量）、搜索与出网黑名单、MCP、通知渠道、技能工作室、子智能体工作室、Dify 工作流工作室、定时任务调度。
  - 推理模型：`/system/models` 整页。
  - 数据摄取与电网凭据（`/data-ops/console`）：数据接入向导、数据摄取管理、数据源接入 › 电网官方平台。上传中心、导入融合台、企业自建通道、受控接入、运维总览、治理控制台保留。
  - 权限矩阵与注册立场：`/system/accounts` 的权限矩阵 tab、`/gsgl/profile` 的注册立场块。用户管理、会话管理、公司档案本体保留。
- **做法**：`src/features/platformAdminMigration/registry.ts` 是唯一登记表（入口 → 宿主 tab / 面板 / 区块 → 后台路径，按组开关）；页面、菜单、旧路径重定向壳只问它。被迁入口不渲染，原位置显示 `MigratedToAdminNotice`：说明已迁到平台后台、由平台人员处理，并逐项链接后台页面。整页迁走的 `/system/models` 从菜单摘除，路由换成整页提示（直接访问不报错、不白屏）。运维总览里指向已迁面板的按钮一并摘除。
- **后台链接**：可选构建变量 `VITE_PLATFORM_ADMIN_URL`（如 `http://127.0.0.1:5176`）拼登记表里的 hash 路径（`/#/ai/llm`、`/#/inference/models`、`/#/data/ingest`、`/#/data/grid-credentials`、`/#/access/role-matrix`、`/#/customers` 等）；未配置时只显示文字、不给链接。
- **长期记忆**：个人自助，抽成独立卡片 `MemoryManagementCard`；内部版 AI 工作室只剩「个人设置」tab（长期记忆 + 本机语音播报），原页回退后照旧嵌着同一组件。
- **重定向壳**：目标面板已迁时落到宿主页默认 tab，并丢掉指向已迁面板的 query，宿主页的提示会点名该入口；不会重定向到不渲染的面板（`src/router/legacyRedirects.ts`）。
- **回退**：按组把 `MIGRATION_GROUPS['<组>'].hidden` 改为 `false` 后重新构建，入口原样回来。**只恢复前端入口可见性**，后端门禁收窄（#3164、#3226、任务 12.1 ChenShi-Tech/dljy#3466、12.2 ChenShi-Tech/dljy#3463）不随之回退。
- **客户版不受影响的保障**：运行期判断都先过 `IS_INTERNAL_EDITION`；客户版构建由 `vite.config.ts` 把登记表与提示组件重定向到空壳；`npm run verify:customer-edition-build` 扫交付产物，出现提示短语、后台路径或后台地址（自建产物时注入金丝雀地址）即红。

## 3. 「平台内部」入口明细

### 3.1 权限矩阵（`/system/accounts?tab=permissions`）

- **为什么是平台内部**：角色矩阵（各业务角色的路由/动作授权覆写）是**整个部署**的授权配置，改一处影响全部客户的全部该角色账号，与任何单一客户无关。矩阵 §2.1 明确「平台全局角色矩阵、不接入」。
- **现状**：#3164 后写端点仅平台超管可写（矩阵 §4）；但客户 BOSS 的页面仍呈现完整编辑界面，点保存 403 后**静默降级保存到浏览器本地**（附录 A-4）。
- **迁移后客户侧看到什么**：建议客户交付版整 tab 隐藏（写权限本就不在客户手上，展示可编辑矩阵是误导）。**2026-09-29 落地**：内部版该 tab 已随组隐藏、由后台角色权限矩阵页（`/#/access/role-matrix`）承接（§2.2）；客户交付版现状不变，整 tab 隐藏待后续批准。
- **风险**：本地降级矩阵只影响本浏览器，会与服务器权威漂移，排查权限问题时是干扰源；隐藏入口前应先处理 A-4。

### 3.2 推理模型管理（`/system/models`）

- **为什么是平台内部**：南洋推理服务的模型是**跨部署共享**资产，enable/disable/reload 直接改变全部客户的预测能力与显存占用（矩阵 §2.3）。
- **现状**：读路径页面级 BOSS+ADMIN 可达；写按钮已按 `canWriteSharedResources` 预闸（内部版仅 ADMIN），后端 #3226 收窄同步落地。
- **迁移后客户侧看到什么**：客户交付版页面隐藏或转只读（健康/清单/版本保留只读有排障价值）；写动作由后台 M4 受控动作承接（任务 9.4/9.5）。
- **风险**：受控动作未上线前隐藏写入口会造成「无人能启停模型」的运维真空——顺序必须是后台动作先可用、再收客户侧；`unload/activate/rescan` 后台不开放，需保留部署运维通道。

### 3.3 AI 模型设置 / 模型服务（`/system/ai-studio?tab=models`）

- **为什么是平台内部**：LLM 供应商凭据、采样与路由是部署级供应配置（矩阵 §2.4：部署侧凭据留运维流程）；客户交付版本就编译期剔除供应商面（#2410/#2668），仅剩「模型服务」档位面板。
- **本页除 LLM 服务与凭据外还有四个面板（2026-09-26 盘点补漏，均经代码核实）**：
  - **MCP 服务器面板**（挂载 `src/views/AiSettingsView.vue:612-615`）：CRUD+连通测试，接口 `/agent-api/agent/llm/mcp-servers*`（`src/services/agent/mcpClient.ts:8,57-85`），写操作复用 LLM 同款 `x-admin-token`（mcpClient.ts:2-3）——部署级共享外部能力边界，**倾向平台内部**；但其写鉴权依赖浏览器持有管理令牌，与矩阵 §2.4「管理令牌永不下发浏览器」红线存在既有张力，迁移方案须一并解决。**待用户裁决**。
  - **调度结果推送渠道**（挂载 `src/views/AiSettingsView.vue:617-620`）：全局渠道凭据（webhook/smtp/feishu/wecom/dingtalk）+ 测试，接口 `PUT/POST /agent-api/agent/notify[/test]`（`src/services/agent/notifyClient.ts:52-69`），写同样带 `x-admin-token`（notifyClient.ts:3,30-39）；任务级推送开关在「定时任务调度」tab 属自助。凭据面**倾向平台内部**，是否与任务级开关拆分处置**待用户裁决**。
  - **长期记忆管理**（挂载 `src/views/AiSettingsView.vue:639-662`）：查看/删除**当前登录账号自己**的跨会话记忆（按账号隔离，AiSettingsView.vue:646），接口 `GET/DELETE /agent-api/agent/memory[/:key]`（`src/services/agent/memoryConfig.ts:7,28-48`），仅登录身份、不带管理令牌——**倾向客户自助（个人自助数据）**；但入口嵌在本页，若整页收进后台须为它保留客户侧入口。**待用户裁决**。
  - **语音播报**（`src/views/AiSettingsView.vue:304-309,622-637`）：**纯前端 localStorage**（`src/services/voice.ts:14-35`，键 `dljy_voice_config`；Web Speech API，不联网、不上传），无后端接口——**不属迁移项**，随宿主页面前端处置连带走。
- **迁移后客户侧看到什么**：客户交付版「模型服务」面板保留（档位启用+角色路由是客户侧合理自助）；内部版 2026-09-29 已随 AI 设施组隐藏本页模型服务相关面板、由后台对应页承接（§2.2），AI 工作室仅剩「个人设置」tab（长期记忆+语音）。
- **风险**：网关管理令牌永不下发浏览器（矩阵 §2.4）——后台接管必须由主仓服务端持令牌代理，任何「前端填管理令牌」的迁移方案都违反红线；额度发布属任务 9.2，不在本项范围。

### 3.4 技能 / 子智能体 / Dify 工作流 / 定时任务（`/system/ai-studio` 其余 tab）

- **为什么是平台内部**：技能库与子智能体是全体客户会话共享的能力面（改一个 SKILL.md 影响所有客户的 agent 行为）；定时任务调度可触发部署级 ETL 与报告产出（矩阵 §2.2：调度器按部署实例归属）；Dify Studio 是部署级编排设施。
- **迁移后客户侧看到什么**：整组从客户交付版隐藏（客户无改技能/调度的正当场景，尚未批准）；内部版 2026-09-29 已整组隐藏、由后台对应页承接（§2.2）。
- **风险**：调度任务承载「定时自动摄取」（DataIngestionView 页内链接直达）——收窄前先确认无人依赖客户侧配置的摄取调度，否则数据链路断更；后台无替代项，迁移=可见性收窄而非能力搬迁。

### 3.5 数据接入向导与摄取管理（`/data-ops/console?panel=onboarding|ingest`）

- **为什么是平台内部**：`POST /api/v1/ingest/:kind` 多数 kind 写**平台全局**目录与 capture 回放层（矩阵 §2.5），触发即跑 ETL 子进程，影响全部客户的数据新鲜度。
- **现状**：后端放行 `INGEST_ROLES` 七角色（含 TRADER 等业务角色，比矩阵 §4 记载「任意 BOSS」更宽，`dljy/server/ingestion-api.mjs:36,460-461`，附录 A-3）；前端触发请求当前 404（附录 A-1，已实测，ChenShi-Tech/dljy#3251）。
- **cgn-\* 归属存争议（待用户裁决）**：`cgn-yunnan-prices`、`cgn-yunnan-market` 写中广核私有库，`cgn-series-to-capture`（前端面板未列出，由调度跑）写共享采集族，三者固定只允许中广核公司（`ownerCompanyId: 'comp-cgn-yunnan'`）触发（`dljy/server/ingestion-api.mjs:145-151,201-216,463-466`）——单公司数据链路。张力：同类配置入口「企业自建通道」（cgn-yunnan 数据源配置，§2）本清单归**客户自助**，若自建通道配置属客户自助，用该配置触发摄取是否也偏客户自助？本表暂随面板整体归平台内部（触发的是平台侧 ETL 子进程），**交用户裁决**（2026-09-29 面板已随组隐藏，处置见 §0 裁决记录）。
- **迁移后客户侧看到什么**：内部版两面板 2026-09-29 已随组隐藏、由后台数据摄取页承接（§2.2）；补数/重跑由后台 M4 受控动作承接（仅登记的动作）。客户上传/导入动线（upload/import-hub 面板）不受影响；客户交付版不变（cgn-\* 摄取改在平台后台数据摄取页操作，见 §0 裁决第 3 条）。
- **风险**：受控动作未登记前隐藏 = 数据断更无人能补；A-1 已坐实，这两面板的「立即摄取」当前本来就是坏的——迁移前先修（#3251），避免「迁移把坏功能藏起来」掩盖问题。

### 3.6 电网官方平台（`/data-ops/console?panel=data-source&tab=official`）

- **为什么是平台内部**：国网开放平台接入点凭据是**全局生效集**（改一处影响整个部署的采集），凭据录入本就走安全交付流程、后台不接收明文（矩阵 §2.2）；采集触发影响部署数据链路。
- **现状**：凭据写与采集触发后端放行任意 BOSS（矩阵 §4 未收窄）。
- **迁移后客户侧看到什么**：服务健康状态保留只读（与 M3 服务状态同源）；内部版凭据与采集运维 2026-09-29 已随组隐藏、由后台电网凭据页（`/#/data/grid-credentials`）承接（§2.2）；客户交付版不变（隐藏待后续批准），凭据交付继续走既有安全流程，由我方运营在后台登记步骤引用。
- **风险**：新网省接入的凭据交付依赖人工流程，隐藏前端入口前须确认交付流程文档同步更新；`sichuan-ingest/trigger` 有「单数据集手动触发」场景（#2501 修复过 query 丢参），受控动作须覆盖该粒度否则运维降级。

### 3.7 注册立场（`/gsgl/profile` 内的立场登记块）

- **为什么是平台内部（存保留意见，请用户裁决）**：写入落点是**平台全局公司主数据表** `PATCH /api/company/companies/:id`（`src/services/company/companyApi.ts:136-138`），矩阵 §2.1 把该端点归为平台级 `customer.manage`，且立场登记是 TRADER/GROUP 账号立场切换授权的**服务端权威**（`src/views/company/CompanyProfileView.vue:13-15`）——这是授权面而非普通业务台账。反方意见：其影响面只在单公司（本公司账号的立场允许集合），#3164 后客户 BOSS 也只能改本公司树。**权威面平台级、影响面单公司**，两者张力交用户裁决；若判客户自助，至少应把「写」从档案页拆出独立小节并保持现状门禁。
- **迁移后客户侧看到什么**：若迁后台：客户侧只读展示已登记立场（账号立场切换本身不受影响，`stances` 允许集合仍由服务端按登记推导下发）；若留客户侧：现状不动。**已按前者落地（ChenShi-Tech/dljy#3518，2026-09-29）**：`/gsgl/profile` 注册立场块对所有角色恢复渲染并照常读取（读接口未收窄），内部版恒只读（无保存按钮，`saveCompanySubjectTypes` 不再调用）；「已迁至平台后台」提示只对平台人员（内部版 ADMIN）显示。
- **风险**：后台「不改写公司主数据」（矩阵 §2.1）与「接管立场登记」存在原则冲突——若迁，需要在后台为此单开一个经 `customer.manage` 裁决的立场登记接口，而不是转调旧端点；否则应明确「留客户侧」。
- **2026-09-29 裁决与落地**：归平台内部（§0 裁决第 2 条）；内部版立场登记块已随组隐藏，由后台客户目录客户详情的注册立场分区承接（registry `subject-registry`，`/#/customers`），重启持久化经补演验证（§2.1）。

## 4. 范围外相邻入口（判断与理由，待用户确认）

以下入口与「平台内部管理操作」相邻但**初步判断不在本次迁移范围**，判断与理由登记如下，逐项待用户确认（§0 第 7–9 条）：

- **`/grid-assets/*`（空间资产 8 页）**：路由 `src/features/gridGeo/routes.ts:15-118`（command/plants/nodes/topology/disclosures/market/weather-impact/operator-profile），菜单与路由受 `VITE_DISABLE_GRID_GEO` 反向开关门控、默认开启（`src/features/gridGeo/config.ts:4`；governance.ts:124）。**判断：不在本次范围**——电网网架/披露/气象影响等为**只读地区资产展示**（数据分析块，`/insight/grid-boundaries` 是其等价新入口，governance.ts:683），无部署级写操作、非平台管理面。待用户确认。
- **`/yygl/ops` 运营中枢**：路由 `src/router/index.ts:371`，电站、合同、结算、风险、统计、数据导入、模型配置、智能体监控的运营面（meta scope），授权给 TRADER/SETTLEMENT/STORAGE_OPERATOR 等业务角色（governance.ts:379,438,509,530）。**判断：不在本次范围**——业务角色日常运营工作台，属客户业务面而非平台管理面。待用户确认。
- **`/yygl/data-browser` 通用数据浏览器**：路由 `src/router/index.ts:372`，`GET /api/real?family=&match=&region=` 任意已注册数据族归一化回放 + 动态列筛选 + CSV 导出。**判断：不在本次范围**——只读、无写操作，共享展示性质。但其「任意已注册数据族」的读取面较宽（跨族读取是否需要按业务角色收敛属数据可见性议题、非入口迁移议题），是否另行立项审视**待用户确认**。

## 5. 已知问题附录（只登记，本任务不修）

### A-1 摄取触发用裸 fetch，绕开 data-service 改道（**已实测 404**，Bug ChenShi-Tech/dljy#3251）

**现象推断**：「数据摄取管理」「数据接入向导」两个面板的触发请求**没有**经 `dataServicePath` 改道，按代码推断会落到平台 BFF（:4174）`/api/v1/ingest/:kind`；而本仓的路由面声明该路径族已归 data-service（:8190）。若平台 BFF 已随 #2169 P2-2a/#2189 退役该处理器，现网点「立即摄取/一键生效」会得到 404（页面显示「摄取失败（HTTP 404）」）。

**证据链**：

1. 触发走裸 fetch，不经统一取数出口的改写点：`src/services/data/ingestClient.ts:65` `fetch(\`/api/v1/ingest/${kind}\`, …)`。改写只发生在 `src/services/api.ts:311`（`pathBase` 内调 `dataServicePath`），仅 `apiGet/apiPost/...` 走该路径。
2. `/v1/ingest/` 明确在 data-service 改道名单：`src/services/dataServiceRoutes.ts:30`（`DATA_SVC_PREFIXES` 含 `'/v1/ingest/'`）。
3. 本仓对该路径族的权威声明即「经 dataServicePath → /data-svc → data-service :8190」：`src/router/index.ts:376`（`/data-ops/console` 路由 meta）与 `src/services/dataServiceRoutes.ts:2-3`（注释列明「摄取触发」属 data-service 装配面）。
4. 同族先例：`src/services/dataServiceRoutes.ts:4-7` 记载 `/v1/settlements` 平台侧处理器已随 full-suite 演示域退役（#1642/#1637），「不改道即落平台 BFF 的 `/api/v1` 下未匹配任何已注册域 404」，实测复现过（#2501 同类）。ingest 族是否同样退役，本仓代码不可见（后端在主仓），无法就此断言 404 必现。
5. 现有 spec 把**未改道**的 URL 固化为预期行为：`src/services/data/ingestClient.spec.ts:73` `expect(url).toBe('/api/v1/ingest/weather-export')`——若修此问题须同步改 spec。
6. 调用方：`src/views/DataIngestionView.vue:44`、`src/views/DataOnboardingView.vue:268`（接入向导的读取类调用 `:201,:207` 走 `apiGet`，**有**被正常改道，唯独触发绕开）。

**实测结论（2026-09-25，本机）**：带管理员登录态 `POST /api/v1/ingest/quality-scan` 打到平台 BFF（:4174）返回 404「/api/v1 下未匹配任何已注册域」；同路径打 data-service（:8190）返回 428（端点存在、幂等键门禁生效）。即平台 BFF 已退役该处理器，「数据摄取管理」「数据接入向导」两个面板的写动线当前是断的。已立 Bug ChenShi-Tech/dljy#3251，修复与本清单的迁移决定解耦：无论入口最终放哪，都要先修。

### A-2 会话查看/撤销曾对任意公司 BOSS 全量放行——**已由 #3168 修复**（2026-09-26 按 dljy main 代码更正）

矩阵 §2.1 记载的旧门禁「GET/DELETE /api/auth/sessions：登录；ADMIN/BOSS 可看/删全部」已过时。dljy 主仓 main 现状（本任务只读核实）：

- **查看**：`server/auth-store.mjs:395-412`（`listAuthSessions`）——非管理员或 `scope=mine` 一律只看自己（`:399-403`）；`scope=all` 按管理范围（`resolveAccountManagementScope`）过滤：平台超管（`isPlatformManager`）返回全部，客户 BOSS 仅返回管理范围内（本公司树，`listManageableUsers`）账号的会话（`:404-411`）。
- **撤销**：`server/auth-store.mjs:414-434`（`deleteAuthSession`）——撤销**他人**会话要求目标账号在管理范围内（`canManageAccount`，`:421-429`）；范围外与「会话不存在」同形 404，且拒绝留痕不写会话属主账号名（`:425-427` 注释：防操作者从审计读到他司账号名）。
- **修复提交**：dljy main `46551f3dd`「fix: 客户 BOSS 只能管理本公司树内的账号与公司 (#3168)」。

前端侧事实（不变）：`src/views/SessionManagementView.vue:15-16`（isAdminLevel → scope=all）、`:65`（`deleteAuthSession`），页面宿主 `/system/accounts` 对任意公司 BOSS 放行（`src/services/governance.ts:694`）——页面可达性未变，但后端已按管理范围裁决，**跨公司枚举/撤销会话的越权面已关闭，本项不再构成迁移阻塞**；会话管理维持客户自助分类（§2）。

### A-3 摄取/采集触发、接入凭据、调度旧入口未收窄；摄取触发实际放行角色比矩阵记载更宽（2026-09-26 按 dljy main 代码更正）

矩阵 §4：「其余旧入口（……采集触发与接入凭据、调度、摄取）仍放行任意 BOSS，收窄归 M5 旧入口迁移（任务 11.4/11.5）逐项批准」。按 dljy 主仓代码核实：

- **摄取触发（`POST /api/v1/ingest/:kind`）**：比「任意 BOSS」更宽——`server/ingestion-api.mjs:36` 定义 `INGEST_ROLES = ['SETTLEMENT', 'RETAIL_MANAGER', 'TRADER', 'TRADE_LEAD', 'PLANT_OPERATOR', 'ADMIN', 'BOSS']`，`:460-461` 人类用户具备其一即放行（**TRADER、PLANT_OPERATOR 等业务角色均可触发全量 ETL**）；SERVICE token（scheduler 携带 `X-Service-Token`）单独放行（`:30,223-232,452-454`；未配置 token 时 fail-closed）；无公司归属的账号拒绝（`:456-458`）。
- **cgn-\* 三个 kind 固定公司归属**：`cgn-series-to-capture`（写共享采集族）、`cgn-yunnan-prices`、`cgn-yunnan-market`（写中广核私有 PostgreSQL）均声明 `ownerCompanyId: 'comp-cgn-yunnan'`（`:145-151,201-216`），非中广核公司账号触发被拒（`:463-466`）。
- **采集触发与接入凭据、调度**：仍按矩阵 §4 记载放行任意 BOSS（本任务未复查到对应主仓代码改动，按矩阵记载保留结论）。

前端侧对应事实：这些入口所在的 `/data-ops/console` 与 `/system/ai-studio` 虽列 `adminOnlyRoutes`（governance.ts:138），但该名单只拦非管理员角色——BOSS 在 `canAccessPath` 开头已全放行（governance.ts:694-695），**任意公司的 BOSS 都能进入并操作**这些全局设施；摄取触发则连部分业务角色也被后端放行（见上）。本清单 §3.5/§3.6 的迁移建议以此为前提。

### A-4 权限矩阵保存无服务端写权限前置判定，失败静默降级「本地矩阵」；降级后仍弹成功提示（已登记 #3265）

#3164 后 `POST /api/auth/role-access` 仅平台超管可写（矩阵 §4），但 `src/views/PermissionMatrixView.vue` 的保存/重置按钮**没有**类似 `canWriteSharedResources` 的前置闸门（对比 `src/views/SystemModelsView.vue:29-31` 的做法）：客户 BOSS 点保存 → 后端 403 → 页面捕获后**把覆写写入浏览器 localStorage** 并提示「后端同步失败，已保存本地矩阵」（`src/views/PermissionMatrixView.vue:295-300`，重置同款 `:313-318`）；且**无论后端成败，随后仍弹绿色成功提示**「XX 权限矩阵已保存」（`:301`，重置同款 `:320`）——用户无从感知后端实际未生效，已登记 ChenShi-Tech/dljy#3265。后果：①点了才 403 的挫败体验；②本地覆写只影响本浏览器（`getAccessOverrides` 读 localStorage，governance.ts:566-575），与服务器权威漂移，是权限问题排查的干扰源；③成功提示误导用户以为已生效。建议 11.5 收窄该入口时一并处理（本任务未修）。
