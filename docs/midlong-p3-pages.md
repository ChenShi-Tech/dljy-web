# 云南中长期售电 P3 页面：售电计划与交易执行

跟踪：[dljy #2973](https://github.com/ChenShi-Tech/dljy/issues/2973)（后端 [#2972](https://github.com/ChenShi-Tech/dljy/issues/2972)，父 Epic [#2937](https://github.com/ChenShi-Tech/dljy/issues/2937)，真实公告与演练 [#2974](https://github.com/ChenShi-Tech/dljy/issues/2974)）。
后端接口与口径以主仓 `docs/midlong/midlong-p3-planning.md` 为准；共享契约 `shared/midlong/planning.*` 由主仓单向同步，本仓只读。
**必须在后端 P3 合并、迁移执行并打开能力开关后再合并本仓页面入口**，否则页面调用的接口是 404。

## 入口（由集成方注册路由与导航）

| 路径 | 页面组件 | 标题 | 能力开关 |
| --- | --- | --- | --- |
| `/zcqjy/plans` | `src/views/midlong/p3/MidlongPlansView.vue` | 售电计划 | `capabilities.modules.plans` |
| `/zcqjy/execution` | `src/views/midlong/p3/MidlongExecutionView.vue` | 交易执行（交易日历为默认标签） | `capabilities.modules.execution` |

- 两页都在「中长期交易」导航组下，与「售电合同」「月度持仓」同组；地区与可见范围沿用 P1（仅云南试点，写入以 `capabilities.canWrite` 为准）。
- 页面自身会检查能力开关：未开放时显示「功能尚未开放」且不请求接口。
- 查询参数：计划页 `tab=targets|proposals`、`year`、`subjectId`、`periodType`、`planId`、`asOf`（历史视图）、`status`；执行页 `tab=calendar|windows|proposals`、`fromMonth`、`toMonth`、`status`。

## 交互口径

- **术语**：剩余计划待售量、完成率、未完成占用、可安排计划量、名义金额、方案测算。页面不出现套保率、现货敞口、预计利润。
- **售电目标**：页面固定提示「目标为人工确认的经营安排，不是物理可发电量，也不是法定额度」。新建与修改只保存待确认版本；发起更改必须填写原因，确认后生成新版本，旧版本与原因、确认人保留在「版本与占用」抽屉。
- **完成情况**：已核验时显示剩余计划待售量、完成率、可安排计划量；已售覆盖不完整显示「待核验（不按零计）」并在已售列标「另有未分解」；目标未确认显示「目标未确认」；目标为零显示「目标为零，不计算」；超计划显示负数、超过 100%，并标「超计划」。
- **历史视图（旧报告）**：版本历史中被取代的版本有「查看当时完成情况」，按该版本最后有效时刻重算，旧目标与旧完成率不变；历史视图不提供新建、修改、确认操作。
- **交易方案**：草稿可缺依据；「确认可执行」带上方案测算中看到的目标版本，由后端在事务内校验余额；余额不足时显示后端返回的最新可安排计划量，不在前端判定通过。撤销（外部提交前）与关闭（任何执行中状态）都要填写原因并释放占用。
- **方案测算**：交易前正式持仓 / 方案 / 交易后（模拟）的电量、名义金额与均价，以及适用目标交易前后的剩余计划待售量与完成率；已售不完整的月份交易后电量显示「已售不完整，不计算」；固定提示没有可比中长期行情、不判断价格优劣；方案仍引用旧目标版本时标「已换版」。
- **交易日历**：只列公告明确给出的申报开始、申报截止、确认时间，按北京时间分日；时间未知的公告列入「时间待补」，不生成提醒。
- **公告登记**：人工登记公告参数，缺失与不支持的参数显示待核对；登记更正生成新版本、原版保留，完成后列出引用旧版本的方案；方案详情显示新旧差异并提供「按新版本重新核对」（需填写核对说明）。
- **申报材料导出**：执行页方案详情中导出 CSV，文件内容来自方案当前版本（含版本号）；导出只读，不改变方案状态、不登记提交、不操作外部平台。
- **外部提交登记**：记录外部提交时间、外部操作人、渠道与回执依据（编号、回执时间、回执文件）；回执完整度「无回执 / 不完整 / 齐全」，页面始终提示「不代表平台已受理，也不形成持仓」。预成交、确认成交、撤单属于后续阶段，页面没有这些操作。
- **切换公司/地区**：取数带代次守卫，旧请求迟到返回直接丢弃；主体、目标、方案筛选随公司清空。
- **测试数据**：隔离测试里的主体、公告、方案均以 `TEST`/【测试数据】标注，不作为业务验收依据；没有真实公告时日历为空，不生成示意窗口。

## 场站与分时粒度

首期目标、占用与方案测算按「交易主体 + 年/月」。按场站或分时的目标、占用与比较等 P2 真实接口合并后再做，本期页面没有占位入口。

## 实现文件

- 服务层：`src/services/midlong/midlongP3Api.ts`（接口客户端，幂等键按内容派生）、`midlongP3Format.ts`（展示口径）、`midlongP3Types.ts`（契约出口）
- 页面：`src/views/midlong/p3/MidlongPlansView.vue`、`MidlongExecutionView.vue`
- 组件：`src/components/midlong/p3/`（目标表单、目标详情、方案表单、方案详情与测算、公告表单、公告详情、提交登记）
- 测试：`midlongP3Format.spec.ts`、`midlongP3Api.spec.ts`、`MidlongPlansView.component.spec.ts`、`MidlongExecutionView.component.spec.ts`、`ProposalDetailDrawer.component.spec.ts`、`PlanDetailDrawer.component.spec.ts`

## 验证方式

```bash
npm run lint && npm run check
npx vitest run --configLoader runner src/services/midlong/midlongP3Format.spec.ts src/services/midlong/midlongP3Api.spec.ts src/views/midlong/p3 src/components/midlong/p3
```

组件测试只验证渲染与交互，不等于真实网站、代理、登录与后端端到端验收；真实公告与人工计划的月度交易准备演练（#2974）尚未进行。
