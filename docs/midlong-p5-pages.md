# 云南中长期售电 P5 页面：业务复盘/月报与外部账单/差异

跟踪：[dljy-web #3016](https://github.com/ChenShi-Tech/dljy-web/issues/3016)（前端，本仓）；后端与共享契约 [ChenShi-Tech/dljy #3015](https://github.com/ChenShi-Tech/dljy/issues/3015)（父 Epic [#2937](https://github.com/ChenShi-Tech/dljy/issues/2937)）；真实账单分项对账演练属 [#3017](https://github.com/ChenShi-Tech/dljy/issues/3017)，**不在本 PR**。
后端接口与口径以主仓 `docs/midlong/midlong-p5-review-bills.md` 为准；共享契约 `shared/midlong/settlement.*` 由主仓单向同步，本仓只读。
**必须在后端 P5 合并、迁移 061 执行并打开 `review`/`bills` 能力开关后再放行页面入口**，否则对应接口是 404。

## 入口（路由与导航由主执行者注册，本 PR 只交付组件）

| 建议路径 | 页面组件 | 标题 | 能力开关 |
| --- | --- | --- | --- |
| `/zcqjy/review`（建议新增） | `src/views/midlong/p5/MidlongReviewView.vue` | 业务复盘与月报 | `capabilities.modules.review` |
| `/zcqjy/bills`（建议新增） | `src/views/midlong/p5/MidlongBillsView.vue` | 外部账单与差异 | `capabilities.modules.bills` |

- 两个能力键由后端 capabilities.modules 运行时展开（`MIDLONG_P5_MODULES`）；类型侧经 `p5ModuleOn`（`midlongP5Api.ts`）按名称读取，与 P2/P4 的 `p2ModuleOn`/`p4ModuleOn` 同策略。**模块关闭 = 页面显示「尚未开放」、不渲染数据区、不发任何请求。**
- 导航建议放「中长期交易」组（与售电合同/月度持仓/售电计划/交易执行/合同调整同组），仅云南试点；写入以 `capabilities.canWrite` 为准。
- 查询参数：复盘页 `month`、`subject`、`page`；账单页 `tab=bills|discrepancies`、`subjectId`、`billKind`、`externalBillNo`、`billMonth`、`billPage`、`status`、`month`、`page`。

## 交互口径

### 复盘 / 月报（MR-01/02/05/06）

- **只陈述中长期量价事实**（MR-01）：指标 = 计划完成（复用 P3 口径，只读）、成交量价（复用 P1 持仓口径、同产品/交割期/曲线/币种/税口径分组）、对手方与交易方式分布（按电量事实分组）、绿电价格组成、未成交（方案终态）、错过窗口（公告截止已过且未登记提交）、变更统计（录入更正/调整/转让/部分终止）、资料缺口（未分解池、未知价电量、合同质量缺口）。页面固定提示不推断市场择时、套保或利润结论（`FORBIDDEN_REVIEW_TERMS` 测试红线），不读取现货、预测数据。
- **不可比分列不排名**（MR-01）：多个（币种、含税口径、价格构成）分组时各组**分列**展示各自的电量/金额/分组均价，不给统一均价与汇总金额，页面无任何优劣名次类结论；单一可比分组才显示汇总均价。
- **绿电组成**（MR-06）：总价已含环境价值（310 = 300 + 10）→ 名义金额按**总价 310** 计算，电能量/环境价值分项展示、不再次相加；电能量价另列环境价值（300 + 10）→ 单位合计 310 两分项分别展示；缺环境价值或构成未核对只标资料缺口，不模拟机制差价、绿证收益或核销结果。
- **三种金额分离**（MR-02）：名义（持仓口径）/ 账单（当前有效版本分项，未分项综合账单只计数）/ 收款（仅有凭证部分）逐项附来源与覆盖状态；**无凭证不显示到账（不显示 0）**；`independentlyRecomputed: NOT_PERFORMED` 只能显示「未独立复算」，**绝不显示「复算通过」类结论**。
- **生成月报即冻结**（MR-05）：生成 = 冻结输入版本集合（合同/计划/成交确认/账单）+ 完整指标快照落档；输入版本未变化回 `REPORT_INPUTS_UNCHANGED`（如实渲染，不生成空新版本）；迟到修订生成 v2+，changeReason 自动列出变化输入（如 `PLAN#7 v1→v2`）。
- **报告详情 = 冻结快照口径**：版本列表（旧版保留）+ 按版本查看冻结快照全文（旧版本数值不随当前数据漂移：目标 1000→1200 后 v1 仍显示 1000）；**导出从冻结快照渲染 CSV**，同一版本两次导出逐字一致、与归档一致。
- **受影响报告定位**：`/reports/affected` 按合同/计划/成交确认/账单四选一输入定位冻结了旧版本的报告版本（含是否当前版本、冻结版本号与当前版本号），提示旧报告数值保持不变。
- **缺资料与未完成交易明确列出**：未成交方案、错过窗口、资料缺口（未分解/未知价/质量缺口/排除在持仓外）都是显式区块，不用空数组伪装。

### 账单与差异（MR-02..04）

- **登记外部账单**（MR-03）：编号、来源、所属主体、期间（月粒度）、外部修订标识、金额与金额口径（CNY/含税口径/价格构成）、中长期明确分项（交割月可空 = 期间合计行，量/价/金额按外部账单明确给出的登记、不推算）、账单原件附件。业务键 =（公司+主体+来源+外部编号）：同键同内容重复登记回放（金额不重复累计），同键异内容回 `DUPLICATE_BILL_CONTENT` 引导走修订。
- **综合账单不猜分**（MR-03）：`UNITEMIZED` 表单不提供分项输入、提交 `lineItems` 恒为空数组（服务端 `UNITEMIZED_BILL_NO_SPLIT` 双保险），列表/详情标「未分项，仅归档」，复盘金额只增加未分项归档计数、不产生臆造中长期收入，不按比例拆分、不接现货计算填补。
- **账单修订不双计**（MR-03）：修订必填原因并带 `expectedRowVersion`；旧版保留可查（版本链含各版分项），金额聚合只读**当前有效版本**；相关差异（未解决与已解决）转 `RECHECK_REQUIRED`，修订结果里列出被转状态的差异。
- **收款凭证**（MR-02）：凭证编号、金额（>0）、收款日期必填，文件可选，只追加；**无凭证不显示到账**（凭证是到账依据，账单金额不代表已收款）。
- **差异登记**（MR-04）：只提交比对目标（主体+交割月+账单）与处理线索（原因/负责人/证据文件）；两侧快照与差值由服务端计算——台账侧 = P1 持仓该月正式分解，外部侧 = 账单当前版本该月中长期分项，差值**「外部 − 台账」如实**（1000 对 980 显示 -20）；价格差只在同币种、同含税口径且两侧价格已知时计算，否则只核对电量并标注不可比原因。登记不自动改台账；综合账单或该月无分项回 `INCOMPLETE_BASIS`；两侧一致回 `DISCREPANCY_NO_DIFFERENCE`；同目标已有未解决差异回 `DISCREPANCY_ALREADY_OPEN`。
- **差异闭环**（MR-04）：补充原因/负责人/证据（PATCH 带 `expectedRowVersion`；已解决后 409 冻结、不再提供操作）；关闭**必须填处理说明**（空说明按钮不可用，服务端 `DISCREPANCY_RESOLUTION_NOTE_REQUIRED` 的提示如实展示）；状态机 OPEN/RECHECK_REQUIRED→RESOLVED，账单修订转回「需重新核对」并固定提示；一致性核对与完整结算复算严格区分（页面无「复算通过」字样）。
- **导出**：账单/差异台账 CSV 同列表筛选（当前有效版本口径）；报告导出从冻结快照渲染。

### 通用

- **切换公司/地区**：两个页面都清空数据、关闭抽屉与对话框并回第一页；旧范围迟到请求由代次守卫丢弃；写会话用 `captureScope`/`createWriteSession`（打开快照、保存前核对，读附件期间点取消不写入）。
- **未知不显示 0**：金额/电量/价格/凭证为 null 显示「未知/缺资料/无凭证（未显示到账）」；负差量带符号原样显示。
- **隐藏按钮不是权限校验**：`canWrite=false` 只隐藏写入口，后端 403/404 照常以错误提示展示。

## 实现文件

- 服务层：`src/services/midlong/midlongP5Api.ts`（接口客户端：幂等键按内容派生、附件/证据只按指纹参与；`p5ModuleOn` 能力读取）、`midlongP5Types.ts`（共享契约出口 + 复盘/报告/账单/差异 DTO）、`midlongP5Format.ts`（三种金额行、绿电组成、差异口径与错误信封翻译、FORBIDDEN 词汇红线）
- 页面：`src/views/midlong/p5/MidlongReviewView.vue`（复盘/月报页，路由待注册）、`src/views/midlong/p5/MidlongBillsView.vue`（账单与差异双标签页，路由待注册）
- 组件：`src/components/midlong/p5/`：`ReviewMetricsPanel.vue`（指标面板，实时指标与报告冻结快照共用）、`ReviewReportDrawer.vue`（版本列表/冻结快照/导出）、`BillFormDialog.vue`（登记/修订 + 分项边界）、`BillDetailDrawer.vue`（当前版本金额/版本链/凭证/差异摘要 + 修订与凭证入口）、`VoucherFormDialog.vue`（收款凭证，只追加）、`DiscrepancyFormDialog.vue`（登记，服务端算差）、`DiscrepancyDetailDrawer.vue`（两侧快照/闭环操作）
- 测试：`midlongP5Api.spec.ts`、`midlongP5Format.spec.ts`、`MidlongReviewView.component.spec.ts`、`ReviewReportDrawer.component.spec.ts`、`MidlongBillsView.component.spec.ts`、`BillFormDialog.component.spec.ts`、`BillDetailDrawer.component.spec.ts`、`DiscrepancyFormDialog.component.spec.ts`、`DiscrepancyDetailDrawer.component.spec.ts`

## 验证方式

```bash
npm run lint && npm run check && npm run test:unit
```

组件测试只验证渲染与交互；真实账单分项的对账演练与覆盖范围登记属 #3017（后端仓），不在本 PR。
