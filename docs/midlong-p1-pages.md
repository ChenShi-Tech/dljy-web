# 云南中长期售电合同 P1 页面

跟踪：[dljy #2939](https://github.com/ChenShi-Tech/dljy/issues/2939)（父 Epic [#2937](https://github.com/ChenShi-Tech/dljy/issues/2937)）。
后端接口与口径以主仓 `docs/midlong/midlong-contracts-p1.md`、`docs/api/midlong-endpoints.md`（[#2938](https://github.com/ChenShi-Tech/dljy/issues/2938)）为准；
共享契约 `shared/midlong/*` 由主仓单向同步，本仓只读。**必须在后端 PR 合并并部署后再合并本仓 PR**，否则新页面调用的接口不存在。

## 入口

| 路径 | 页面 | 说明 |
| --- | --- | --- |
| `/zcqjy/contracts` | 售电合同 | 服务端筛选/分页/统计/导出；录入草稿、标准导入、交易主体 |
| `/zcqjy/contracts/:id` | 售电合同详情 | 当前版本与月分解、版本历史、资料、事件与外部编号；核验、更正、作废、补资料、关联编号 |
| `/zcqjy/positions` | 月度持仓 | 按已确认版本汇总的月度持仓、跨期未分解池、价格覆盖与名义金额、历史认知时点、合同钻取与导出 |

- 导航「中长期交易」下新增「售电合同」「月度持仓」两项；计划、执行、复盘等未交付阶段不出现菜单。
- 可见范围与原「公司管理 › 合同管理」一致：所有登录用户看到自身公司；写入由后端公司写权限判定（`capabilities.canWrite`），页面不以角色自行放开写操作。
- 地区：只在云南显示入口；其他地区的导航不出现这两项，直接访问由地区路由守卫转回该地区默认页；若后端能力返回未开通（如前后端开通地区配置不一致），页面显示「当前地区未开通」。任何情况下都不回退读取其他地区的数据。
- 旧「合同管理」：已纳管合同只读，行内提供「前往中长期合同」；旧深链 `/gsgl/contracts?contractId=…` 指向已纳管合同时跳到新详情页，并把 `year` 转成交割期筛选；未纳管合同保持原有维护方式。

## 交互口径

- **三维状态分开**：确认状态（草稿/待核对/已确认/已作废）、交割进度（未开始/交割中/交割期已结束/未知）、质量缺口（可并存）。交割期结束不显示逾期或违约。
- **未知不当 0**：缺售电价显示「待核对」；缺月度分解的月份显示「未分解（非零持仓）」或「另有未分解」，图表中这类月份用半透明柱（高度仍是已明确到该月的电量）加虚线警示框标出，未分解电量只在「跨期未分解池」列一次。
- **价格**：只在同含税口径、同价格构成内给均价；不可比时分组展示，不给统一均价。金额一律称「名义金额」，价格不全时标「仅已知部分，总额不完整」；绿电环境价值单列不相加。
- **写入**：写请求的幂等键由「动作 + 公司 + 提交内容」派生，重试与双击落到同一次执行；有状态写入携带 `rowVersion`，他人先改时提示「已被他人更新」并提供刷新，不静默覆盖。
- **导入**：选择 Excel（合同主表 + 月度分解）或 CSV → 声明来源/单位/文件性质 → 预览（逐单元格错误定位、跳过/冲突/新增、候选重复）→ 提交。存在错误或冲突不能提交；提交时预览失效会刷新结果并要求重新预览；成功只登记为「待核对」。
- **切换公司/地区**：取数带代次守卫，旧请求迟到返回直接丢弃；未选公司、未开通、无权限、服务失败分别提示，不以空列表冒充。
- **测试数据**：来源以 `TEST` 开头的合同在列表与详情标「测试数据」，不作为业务验收依据。

## 实现文件

- 服务层：`src/services/midlong/midlongApi.ts`（接口客户端）、`midlongFormat.ts`（展示口径与取数守卫）、`economicsDraft.ts`（表单草稿）、`midlongTypes.ts`（契约出口）
- 页面：`src/views/midlong/MidlongContractsView.vue`、`MidlongContractDetailView.vue`、`MidlongPositionsView.vue`
- 组件：`src/components/midlong/`（说明框、经济内容编辑器、草稿表单、导入对话框、交易主体）
- 接入：`src/router/index.ts`、`src/data/navigation.ts`、`src/services/governance.ts`（可见范围）、`src/services/region/regionModules.ts`（云南试点能力）、`src/views/company/CompanyContractsView.vue`（旧页分流）

## 验证

```bash
npm run lint && npm run check && npm run test:unit
npx vitest run src/services/midlong src/views/midlong src/components/midlong src/views/company/CompanyContractsView.midlong.component.spec.ts
```

权限测试（`governance.access.spec.ts`）断言新入口对全部角色的可见性与旧「合同管理」一致、不外溢到前缀相似路径。

组件测试覆盖：切换公司迟到响应不污染、未开通/失败区分、交割期结束不显示逾期、缺价待核对、缺分解不显示为零、不可比价格分组、历史认知时点说明、导入错误定位与冲突不可提交、预览失效禁用提交、已确认合同只能更正/作废、并发更正冲突提示、旧深链分流与旧页只读。浏览器实机流程记录见 #2939 与主仓 PR。
