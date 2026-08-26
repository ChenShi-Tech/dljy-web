# `src/attic/` —— 已下架但保留的功能（停用区）

> **这里的代码不参与构建、不参与类型检查、不参与 lint。** 它们从产品里摘掉了，但**没有删**——需要时按下面各条目的「恢复步骤」搬回去即可。

## 为什么要有这个目录

下架一个功能有三种做法，各有代价：

| 做法 | 问题 |
|---|---|
| 直接删 | 想恢复只能翻 git 历史，而"哪个 commit、当时叫什么名字"往往已经没人记得 |
| 注释掉 | 对人和大模型阅读都不友好——满屏死代码，读的人分不清哪些还在生效；且注释掉的代码不会被任何工具检查，烂得最快 |
| **挪进停用区** | 代码保持完整可读、位置固定可发现、恢复步骤写在案；代价是它不再被编译，会随主干演进而逐渐过时 |

**本目录选第三种。** 代价是明写的：**停用区的代码会过时**。恢复时请预期需要适配（下面每条都标了下架时的基线版本）。

## 规矩

1. **只进不改**：进了停用区就不再维护。要改就先恢复出去。
2. **不要从 `src/` 的活代码 import 停用区里的任何东西**——那等于把它偷偷复活，且因为不在类型检查范围内，出问题不会被提前发现。
3. **新增条目必须在本文件登记**：下架原因、下架日期、决策出处、依赖清单、恢复步骤。没登记的等于没人知道它为什么在这。
4. **恢复后从本文件删掉对应条目**，别留幽灵记录。

---

## 条目

### 1. 地区决策标定页（`region-decision-desk/`）

- **下架日期**：2026-08-26
- **下架时基线**：`dljy-web` main @ `6e94180`
- **决策出处**：用户拍板（AI 页面冗余合并盘点）——「可以删，但不能真删，挪到一个类似废弃但可恢复的地方」
- **下架原因**：纯前端本地规则引擎页，无大模型、无后端接口，数据来自静态地区画像表。它能回答的「这个地区适合什么策略」类问题，智能体工作台已经能答且能带真实数据。菜单入口此前已随「地区通用」分组冻结摘除，仅深链可达。

**包含文件**

| 文件 | 说明 |
|---|---|
| `RegionDecisionDeskView.vue` | 页面本体，原挂 `/xhjy/calibration` |
| `StrategyFitPanel.vue` | 策略适配评分面板 |
| `SpotPnlEstimator.vue` | 收益/风险快测面板 |
| `RegionParamCalibration.vue` | 地区参数校准与下发面板 |

**它依赖但仍在主干的东西**（恢复时无需一并搬回，注意核对签名有无漂移）

- `@/services/region/regionContext`（地区上下文）
- `@/services/region/regionStrategyAdvisor`（策略建议，主干另有 6 处消费者）
- `@/data/regionSpotProfiles`（地区现货画像，主干另有 13 处消费者）
- `@/composables/useRegionReload`、`@/components/region/RegionDataBanner.vue`

**恢复步骤**

1. 把 `region-decision-desk/` 下四个文件搬回：页面回 `src/views/RegionDecisionDeskView.vue`，三个面板回 `src/components/region/`。
2. 修 import 路径（停用区里用的是相对路径，搬回后按主干别名写法）。
3. `src/router/index.ts`：恢复懒加载常量与 `page('xhjy/calibration', …)` 那一行。
4. `src/services/governance.ts`：把 `/xhjy/calibration` 加回 `regionalTradingGroups`。
5. `src/data/manifest.json`：补回该页条目（注意主仓那侧的五源对拍）。
6. 需要菜单可见时，`src/data/navigation.ts` 的「地区通用」分组恢复该项（该分组本身受 `VITE_ENABLE_REGION_COMMON_NAV` 控制）。
7. 跑 `npm run check && npm run lint`。

---

### 2. 浮窗 AI 导航助手（`ai-navigator-panel/`）

- **下架日期**：2026-08-26
- **下架时基线**：`dljy-web` main @ `6e94180`
- **决策出处**：用户拍板（AI 页面冗余合并盘点）——同意「摘 nav 模式、留解读模式」
- **下架原因**：右上角浮窗原有两个身份合体——① **导航建议**：前端直连大模型 Key，问"我想看昨天的申报"给页面推荐并跳转；② **智能解读**：业务页点「✨AI 解读」时承载 agent 对话。①与统一工作台 `/ai-agent` 的能力明显重叠，且走的是 agent 体系之外的老路（前端直连 LLM，不经 `/agent-api`、不入审计、不受工具审批约束）；②必须保留，已留在主干。

**包含文件**

| 文件 | 说明 |
|---|---|
| `AiAssistant.legacy.vue` | 下架前的完整浮窗组件（导航 + 解读两模式合体）。主干现存的 `src/components/AiAssistant.vue` 是从它裁出来的「只剩解读」版本 |

**导航模式独有、但仍留在主干的依赖**（因为还有别的消费者，**不要**顺手删）

- `@/services/aiNavigator`：被 `services/slashCommands.ts`、`prompts/navigator.ts` 消费
- `@/services/voice`：被「AI 模型设置」页消费（语音开关）
- `@/composables/useSlashInput`、`@/services/slashCommands`、`@/components/agent/SlashCommandMenu.vue`：被 `AgentChatPanel` 消费（智能体对话的斜杠指令）

**恢复步骤**

1. 用 `AiAssistant.legacy.vue` 覆盖回 `src/components/AiAssistant.vue`（注意：主干版本在下架后可能已有解读侧的改动，需要合并而非直接覆盖）。
2. `src/composables/useAiPanel.ts`：把 `AiPanelMode` 恢复成 `'nav' | 'agent'`，恢复 `openNav()`、`setMode()`，初始 `mode` 改回 `'nav'`。
3. `src/layout/AppLayout.vue`：顶栏按钮改回 `openNav()`。
4. `src/components/agent/AiOrbLauncher.vue`：点击行为改回开合面板（`openNav()` / `close()`），而非跳转工作台。
5. 跑 `npm run check && npm run lint && npm run test:unit`。
