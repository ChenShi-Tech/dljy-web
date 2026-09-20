# 云南中长期售电 P4 页面：执行确认与合同调整

跟踪：[dljy-web #3014](https://github.com/ChenShi-Tech/dljy-web/issues/3014)（前端，本仓）；后端与共享契约 [ChenShi-Tech/dljy #3013](https://github.com/ChenShi-Tech/dljy/issues/3013)（父 Epic [#2937](https://github.com/ChenShi-Tech/dljy/issues/2937)）；真实确认单与转让/终止样本对拍属 [#3017](https://github.com/ChenShi-Tech/dljy/issues/3017)，**不在本 PR**。
后端接口与口径以主仓 `docs/midlong/midlong-p4-executions.md`、`midlong-p4-adjustments.md` 为准；共享契约 `shared/midlong/execution.*`、`adjustment.*` 由主仓单向同步，本仓只读。
**必须在后端 P4 合并、迁移 059/060 执行并打开 `executions`/`adjustments` 能力开关后再放行页面入口**，否则对应接口是 404。

## 入口（路由与导航由主执行者注册，本 PR 只交付组件）

| 建议路径 | 页面组件 | 标题 | 能力开关 |
| --- | --- | --- | --- |
| `/zcqjy/execution?tab=confirmations` | `src/views/midlong/p3/MidlongExecutionView.vue`（新增第四个标签「执行确认」，无需新路由） | 交易执行 · 执行确认 | `capabilities.modules.execution` + `capabilities.modules.executions` |
| `/zcqjy/adjustments`（建议新增） | `src/views/midlong/p4/MidlongAdjustmentsView.vue` | 合同调整 | `capabilities.modules.adjustments` |
| `/zcqjy/contracts/:id`（已有） | `MidlongContractDetailView.vue` 新增「合同调整」区块与版本时间线「影响对比」 | 售电合同详情 | `capabilities.modules.adjustments`（关闭时区块与「影响对比」按钮不出现、接口不请求） |

- 「合同调整」建议按上表双入口：独立页提供跨合同的登记/筛选/映射登记总视图，合同详情区块面向单合同（同一组组件）。
- 两个能力键由后端 capabilities.modules 运行时展开（`MIDLONG_P4_MODULES`）；类型侧经 `p4ModuleOn`（`midlongP4Api.ts`）按名称读取，与 P2 的 `p2ModuleOn` 同策略。
- 导航建议放「中长期交易」组（与售电合同/月度持仓/售电计划/交易执行同组），仅云南试点；写入以 `capabilities.canWrite` 为准。
- 查询参数：执行确认标签 `confirmationStatus`、`pendingReview=true`、`confirmationPage`；调整页 `status`、`adjustmentType`、`pendingDirection=true`、`page`。

## 交互口径

### 执行确认（MT-02..06，MS-04/05）

- **登记事实**：登记确认单只记录「结果状态（预成交/确认成交）、来源+确认编号、逐交割段量价、依据文件」；页面固定提示登记不等于平台已受理（`platformAcceptance: NOT_ASSERTED` 不显示「平台已受理」），本系统不自动登录或操作外部交易平台。确认成交必附依据文件；缺价格可登记真实量、价格保持未知（不编价）。
- **预成交**：只保留记录——不入正式持仓、不占用计划额度、不转换占用；预成交转确认成交走**修订**（新版本，旧版保留），确认成交不能退回预成交。
- **不双计**（MT-04）：同一确认单重复处理（导入后再确认 / 回执超时重试）链接既有记录，固定提示「持仓与占用转换不重复发生」；关联既有合同（含预成交阶段补纸质合同）只新增关联、`EXISTING_LINKED` 提示「不新增同一义务」，并给出合同跳转。
- **主体校验**（MT-05）：候选合同主体不一致（`SUBJECT_MISMATCH`）提示「拒绝自动关联、请核对归属；不同主体同号各自独立，不共享成交或持仓」；同号候选不止一份（`BUSINESS_KEY_CONFLICT`）提示以「关联既有合同」指定。
- **占用转换与计划偏差**：登记/修订结果逐月展示转换量与原因（已转换/部分转换/修订回退/无开放占用——迟到结果照常入账义务、占用保持 0）；计划偏差按适用目标展示本次成交、已售（已知）与剩余计划待售量，目标未确认显示「目标未确认」、已售不完整显示「待核验（不按零计）」，超计划如实显示负数并标「超计划」。
- **待核对**：来源不支持的产品填原文（`productKind` 留空），登记后停在待核对（不创建义务、不转占用、不推进方案状态），列表有「待核对」标签与筛选，详情展示原文并支持**修订**补齐品种后正常处理。
- **外部撤销冲正**：确认成交后的撤销依据走冲正——旧成交记录与合同版本保留、生成更正版本，占用不因冲正恢复；已冲正的确认单不再提供修订/撤销入口；重复撤销由服务端拒绝。
- **写会话与代次**：登记/修订表单打开时快照「公司+地区+写入目标」，关闭或重开让进行中的保存失效（读取依据文件期间点取消/换对象不写入）；详情抽屉取数按「公司+地区+确认单」代次，旧范围迟到结果丢弃；修订/冲正/关联带 `expectedRowVersion`。

### 合同调整（MA-01..05）

- **更正与业务变更分开**（MA-01）：录入更正仍在合同详情「录入更正」；外部调整/转让/部分终止走「合同调整」登记。后端对更正接口的三类业务变更回 `ADJUSTMENT_CHANNEL_REQUIRED`，前端翻译为引导到调整入口。
- **方向**（MA-02）：我方义务方向只能来自核验单据明确字段（表单显式选择）或显式映射登记（`/adjustments/mappings`，来源+产品代码 → 类型+方向，带依据）；留空登记 = `PENDING_VERIFICATION`（待核对、阻止生效、不改持仓），页面提示「人工核对后以修订补明确方向」。方向绝不从「买入/卖出」字样或电量正负推断；调整交割段填**变化量绝对值**，方向由版本统一给出。
- **可调余额**（MA-03）：登记表单打开即展示该合同当前版本各正式分解月份的可调量与是否已结束（`GET /adjustments/balance`）；超量减少回 `ADJUSTABLE_BALANCE_EXCEEDED`，逐月渲染「请求 X / 可调 Y」，原版本与持仓不变。
- **独立价款**（MA-02）：转让价款/补偿/手续费勾选后单列登记（金额、币种、含税口径、备注），展示为独立行并固定提示「不并入原合同售电价格、不进入持仓均价」；未勾选不提交。
- **确认生效**（MA-04）：详情抽屉「确认生效」带 `expectedRowVersion`，原子生成合同新版本+生效台账+解释事件；生效必须附核验依据（登记或确认时上传，无依据按钮不可用）。并发同基线回 409 `BASE_REVISION_MOVED`，提示「合同已被他人变更…以修订按原内容重新对准最新基线后提交」。已生效调整为终态：不再提供确认/修订（后续变化登记新的外部调整）。
- **影响与追溯**（MA-05）：详情抽屉展示逐月 before/after/delta（已生效取生效台账冻结快照、未生效给基线+拟变化）、受影响售电目标与方案占用（只读）、已结束片段与 asOf 视角说明；同一外部变更重复导入回放提示「不双计」（`BUSINESS_KEY_CONFLICT` 引导修订）。
- **合同详情集成**：详情页「合同调整」区块列出该合同调整并提供登记入口（仅已确认合同）；版本历史里**更正与调整产生的版本在同一条时间线**，变更版本（有 supersedes）都有「影响对比（变更前后快照）」（初始/基线版本没有，服务端对初始版本 422）。
- **独立页**：跨合同总视图——状态/类型/只看方向待核对筛选（服务端过滤、分页不截断）、登记（先选已核验确认的合同）、产品映射登记。

### 通用

- **切换公司/地区**：执行确认标签与调整页都清空数据、关闭抽屉与表单并回第一页；旧范围的迟到请求由代次守卫丢弃。
- **未知不显示 0**：总量/价格/可调量为 null 时显示「未知/待核对」；差量带符号（减少为负）原样显示。
- **隐藏按钮不是权限校验**：`canWrite=false` 只隐藏写入口，后端 403/404 照常以错误提示展示。

## 实现文件

- 服务层：`src/services/midlong/midlongP4Api.ts`（接口客户端：幂等键按内容派生、附件只按指纹参与；`p4ModuleOn` 能力读取）、`midlongP4Types.ts`（共享契约出口 + 调整 DTO）、`midlongP4Format.ts`（展示口径与错误信封翻译）
- 页面：`src/views/midlong/p3/MidlongExecutionView.vue`（新增「执行确认」标签）、`src/views/midlong/p4/MidlongAdjustmentsView.vue`（独立调整页，路由待注册）、`src/views/midlong/MidlongContractDetailView.vue`（合同调整区块 + 版本时间线影响对比）
- 组件：`src/components/midlong/p4/`：`ConfirmationFormDialog.vue`（确认单登记/修订）、`ConfirmationDetailDrawer.vue`（版本链/冲正/关联/转换与偏差 + 修订/冲正/关联操作）、`AdjustmentFormDialog.vue`（调整登记/修订 + 可调余额）、`AdjustmentDetailDrawer.vue`（影响对比/价款/版本链 + 确认生效与修订）、`AdjustmentMappingDialog.vue`（显式映射登记）、`MidlongContractAdjustmentsPanel.vue`（合同详情区块 + 版本影响查询）
- 测试：`midlongP4Format.spec.ts`、`midlongP4Api.spec.ts`、`ConfirmationFormDialog.component.spec.ts`、`ConfirmationDetailDrawer.component.spec.ts`、`AdjustmentFormDialog.component.spec.ts`、`AdjustmentDetailDrawer.component.spec.ts`、`AdjustmentMappingDialog.component.spec.ts`、`MidlongAdjustmentsView.component.spec.ts`，以及 `MidlongExecutionView.component.spec.ts` / `MidlongContractDetailView.component.spec.ts` 的新增用例

## 验证方式

```bash
npm run lint && npm run check && npm run test:unit
```

组件测试只验证渲染与交互；真实确认单、转让与部分终止单据的对拍验收属 #3017（后端仓），不在本 PR。
