# 云南水电分析页（dljy#3389）

`/sjfx/hydro`「水电分析」是并入旧版体系的云南专属单页（父 Epic dljy#3386）：新版工作区封存后，「供需与水电 › 水电」页签是旧版没有的能力，本页把它重新整理为一个页面、挂在「市场洞察」组「逐日系统负荷」之后，仅云南显示。路由 name `YunnanHydroAnalysis`，页面文件 `src/views/yunnan/YunnanHydroView.vue`。

## 页面结构（从上到下）

| 区块 | 数据 | 说明 |
| --- | --- | --- |
| 工具条 | 业务日期窗（单次 ≤31 天，`supply.system-series` limits）+「AI 解读本页」 | 默认窗口经 `useInsightEntryAnchor` 锚定到最新有数日（公开 capture 覆盖查询，不写死日期）；AI 走 `defineAiPage`（promptKey `market_data_analysis`） |
| 指标卡一行 | `supply.system-series` 的 `summary` 视图 | 水电平均出力、最高/最低（带出现时段）、水电占比（云南口径，`share:hydro:yunnan` 行）、数据截至日（窗口内主图曲线最新观测日期）；按登记精度显示，缺值「—」不显示 0 |
| 主图 | `series` 视图按来源裁剪（`yn.system.hydro.actual` / `yn.system.load.actual` / `yn.system.new-energy.actual`，云南范围、实际口径） | 水电实际与统调负荷、新能源出力**同轴叠线**：三者不是互斥分量，不堆叠、不相加；阶梯线（step end）、缺测断线不插值 |
| 获权两卡（并排） | `supply.hydro-weekly-output` / `supply.hydro-unit-groups` | 按 `GET /api/v1/market-insight/capabilities` 判定；无权整卡不渲染、不发请求，只留一个「需开通」短标签（悬浮说明）。周出力：区域多选默认只选「云南」，按区域分列不相加。机组群：业务日/电厂/机组/出力占比表，上游数据集名含「电量上限」但只有占比，**不展示也不推算上限值** |
| 来水·库容·弃水 | 无 | 只做一个短标签 + 悬浮说明（暂无数据来源，不展示、不推算），不画空图 |

## 页面整洁纪律（2026-09-28 用户拍板，验收硬条件）

- 不写任何系统生成的结论句/判断句。
- 必要说明（口径、数据缺口、获权说明等）一律「缩略标题 + el-tooltip 悬浮提示」，不用 `InsightNote` 一类大段说明框。指标卡的口径说明用 `MetricTile` 的 ⓘ 悬浮。
- 数据经契约校验（`assertInsightResult` 强制 `mock:false`），页面无模拟数据通道；如未来出现 Mock 通道，短标签常显「模拟数据」。

## 实现约束与登记面

- 数据只经 `src/services/insight/insightClient.ts` 三接口 + `shared/insight/*` 契约镜像；上下文复用 `src/composables/useInsightContext.ts`（地区 × 公司 × 业务窗、代次作废）；锚定复用 `src/composables/useInsightEntryAnchor.ts`。
- **禁止 import `src/features/regions/yunnan/insight/**`**（新版已封存、将整目录删除）；本页逻辑从 `YunnanSupplyPage.vue` 水电段抽取重写、代码独立。
- 开关 `VITE_YUNNAN_INSIGHT_WORKSPACE` 关闭（默认）时本页完整可用：不依赖工作区注册，路由/导航/能力为直接登记。
- 登记面：路由 `src/router/index.ts`（`page()` 行，meta `kind: 'mixed'`、`regionIds: ['yunnan']`）；导航 `src/data/navigation.ts`（`regionIds: ['yunnan']`）；能力 `src/services/region/regionModules.ts` market-insight 模块 `routeCapabilities` **云南 `available`，山西/广东/四川 `hidden`**（菜单不出现且路由拦截，四地区逐个显式声明）；页面说明 `src/data/pageHelp.ts`（key `YunnanHydroAnalysis`）。
- 权限：不改 `src/services/governance.ts` 与权限矩阵；可见范围由 `governance.insightPathAccessAliases` 补「与 `/sjfx/actualLoad` 等价」的别名（管理员角色下本页恒可用）。

## 已知数据情况

水电数据来自中广核渠道：公开曲线库止于 2026-08-17（2026-07-02 后仅中广核授权账号可见，dljy#3066），获权两块止于 2026-08-21；采集断供见 dljy#2368。页面按真实覆盖诚实展示，不因数据旧而补造：进页默认锚定到最后有数日并给一次性提示（可切回今天），窗口内无数据时区块显示诚实空态。

## 测试与验证

| 测试文件 | 覆盖 |
| --- | --- |
| `src/views/yunnan/YunnanHydroView.component.spec.ts` | 获权/公开两种渲染（公共账号不发获权请求、只留「需开通」标签；获权账号见两卡且区域默认云南）、区域切换重查（旧结果作废、新请求带新 objectIds）、缺值显示「—」不显示 0、窗口变化作废旧结果、主图不堆叠（无 stack/areaStyle）且缺测断线（connectNulls:false）、获权标签/说明均为短标签（无大段说明框） |

开发验证命令：`npm run check`、`npm run lint:files -- src/views/yunnan/YunnanHydroView.vue src/router/index.ts src/data/navigation.ts src/data/pageHelp.ts src/services/region/regionModules.ts`、`npm run test:related -- src/views/yunnan/YunnanHydroView.vue`。
