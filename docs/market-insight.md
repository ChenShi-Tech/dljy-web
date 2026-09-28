# 市场洞察数据口径说明

本页记录「市场洞察」域（导航分组：市场洞察，路由前缀 `/insight`、`/sjfx/*`）的数据来源约定与真实性修正记录。面向业务与开发，避免「示例数据冒充真实」「跨地区读取他省数据」两类问题再次出现。

> 相关文档：[市场洞察旧图表能力清单](./market-insight-chart-inventory.md)——dljy#2995 云南地区工作区迁移时逐项保留的旧图表能力（现有组件位置、云南新落点、复用方式与验收要点）；[市场洞察公共证据组件与图表选区](./market-insight-common-components.md)——dljy#2996 公共件（区块容器、证据抽屉、历史候选、图表选区、明细表与导出）的接口、文案对照与阶段 A 集成检查；[云南市场洞察价格与价差页](./market-insight-prices.md)——dljy#3007 价格页（价格对象目录、四页签口径与页面状态纪律）；[云南市场洞察供需与水电页](./market-insight-supply.md)——dljy#3008 供需与水电页（分析目录、四页签口径与页面状态纪律）；[云南水电分析页](./market-insight-hydro.md)——dljy#3389 并入旧版体系的云南专属单页（页面结构、整洁纪律、登记面与数据情况）；[云南市场洞察市场总览页](./market-insight-overview.md)——dljy#3009 总览页（区块清单、重点事项与同进度比较口径、下钻与页面状态纪律）；[云南市场洞察跨省与电网边界页](./market-insight-grid.md)——dljy#3024 电网边界页（三页签口径、coverage objects 消费方式、方向/符号纪律与页面状态纪律）；[云南市场洞察场站市场表现页](./market-insight-plants.md)——dljy#3083 场站页（五页签口径、对象语义纪律、不派生承诺与页面状态纪律）。；[云南市场洞察研究工作台页](./market-insight-research.md)——dljy#3080 研究页（预设目录、同类日与受控自定义、事前事后纪律、超限与拒绝原文）；[市场洞察切片门禁记录汇编](./market-insight-gate-records.md)——dljy#3110 云南洞察各切片 PR 的门禁命令、结果与适用面汇编（OpenSpec 16.6/16.7 核销依据）；[市场洞察验收追溯与回滚汇总](./market-insight-traceability.md)——dljy#3112 业务问题 → analysisId/公式 → 源资料 → 文档/测试/PR 追溯总表与按 PR 回滚方式（OpenSpec 17.3，验收追溯入口页）

## 背景速览

- 市场洞察各页按「地区」取数：山西走三德普华采集族（`sdpt_*`），云南走云南真实族（`sdpt_console`、`sdpt_zsjfx_idx`、`sdpt_zcqxhdl/listrs_full`、`sdpt_actualLoad`、`yn_*` 等），广东/四川为第三省声明式试点、尚无 `sdpt_*` 专属采集。
- 能力状态在 `src/services/region/regionModules.ts` 登记：`available`（可用）/ `degraded`（降级，路由可达、页面诚实说明）/ `hidden`（不展示且路由拦截）。
- 每个页面通过 `DataBasisBadge` / `TrustBadge` 等标注数据口径；Mock 必须可见标注，非山西地区缺数据只能诚实为空或标 Mock，绝不串读山西口径。

## 云南真实性修正（dljy#2991）

### 问题（修复前）

云南「市场洞察」有三处会误导用户的展示：

1. **市场经营分析（`/sjfx/market-ops`）示例冒充真实**：页面并行取 9 个数据集（7 个公共键 + 售电套餐私有 2 键）。旧逻辑是「只要有一个数据集真实，整页就标成『真实 captured』，其余没有真实数据的字段回落到硬编码示例」。于是云南可能出现：市场价（`market_price`）真实落盘，而页面同时展示「318 家交易对手」「约 1258.6 亿千瓦时（856.2+286.4+116 示例求和）」「示例售电份额」等山西示例值，全部顶着「真实」徽章。
2. **出清电量页（`/sjfx/zcqxhdl`）跨地区读取**：云南会去请求 `sdpt_zcqxhdl/__list__`。这个键在后端注册表（dljy 仓 `shared/schema/entities/capture-families.mjs` 的 `datasetOwners`）里登记为**山西三德公司私有清单**，云南（及任何非山西地区）根本没有这个键。旧实现等于跨地区读取他省公司私有数据。
3. **导航残留「分时行情」（`/sjfx/fshq`）**：云南没有撮合分时行情来源（`sdpt_fshq` 为山西私有族），但云南菜单仍显示该入口。

### 修复后的行为（无条件生效）

以下修正是底线行为，**不挂任何界面开关**——关闭未来的新工作区也不会退回旧行为。

1. **市场经营分析逐数据集真实性**（`src/services/market/marketAnalysis.ts`）：
   - `loadMarketAnalysis` 返回新增 `realByKey`（逐数据集是否真实）与 `sectionBasis`（逐页签口径：页面有真实数据时，页签至少一个数据集真实为 captured、全无为 empty 诚实空态；整页无真实数据时全部 synthetic 示例）与 `sectionPartial`（页签部分数据集缺失，缺失部分显示为空并提示）。
   - 只要页面**不是**纯示例（有任一真实数据集）：没有真实数据的字段一律返回**空**（空数组 / 空指标列表），`hourData` 恒为空（它从来没有真实来源）；**绝不回落示例**。
   - 只有 9 个数据集全部不真实时，才保持「整页示例 + synthetic 徽章 + 可见模拟数据提示」的原行为（这是合规的整页演示态）。
   - 页面层（`MarketOperationsAnalysisView.vue`）每个页签按自己的口径显示徽章；页签数据为空时显示「暂无该项真实数据，未用示例补齐」，不画空坐标冒充有数据。月度市场归因面板（`MarketAttributionPanel.vue`）同样按 `market_price` / `market_monthly_trend` 各自真实性标注，缺失行显示为空并说明。
2. **出清电量不再跨地区读取**：
   - 契约客户端（`src/services/data/contracts/marketInsightHeavyPagesClient.ts`）硬编码：只有 `region === 'shanxi'` 才请求 `sdpt_zcqxhdl/__list__`；其他地区在客户端层直接返回「本地区不适用」空态，**不发任何请求**（不依赖视图层自觉）。
   - 视图（`ClearingSpotAnalysisView.vue`）在非山西地区显示停用说明卡：「旧出清电量实现已停用：原实现读取的是山西公司专属清单，不代表云南全省出清。获权场站的申报、出清与实际对照将在『场站市场表现』中提供。」不画空图。
   - 能力注册表（`regionModules.ts`）：`/sjfx/zcqxhdl` 云南状态为 `degraded`（路由可达、页面停用说明），云南数据支撑措辞改为准确描述——`sdpt_zcqxhdl` 仅 `listrs_full` 支撑价格分析页，不含出清电量清单。
   - 山西行为不变。
3. **分时行情入口与解释**：
   - `NavItem` 新增可选字段 `hiddenInRegionIds`（`src/data/navigation.ts`、`src/services/governance.ts`）：**只影响菜单显示，不影响路由可达与权限**。`/sjfx/fshq` 设为云南隐藏；云南菜单不再出现「分时行情」，山西/广东/四川菜单不变，旧链接在云南仍可直接访问。
   - 分时行情页（`FshqView.vue`）云南降级卡补充说明：「云南没有撮合分时行情来源，节点价格不能代替撮合行情」，并提供「查看价格分析」按钮跳转 `/sjfx/zrsjg`。注意：**不是**「分时行情已被价格页替代」——两者口径不同（撮合行情 vs 现货节点价格），价格分析只是当前可用的替代入口。

### 测试位置

| 测试文件 | 覆盖 |
| --- | --- |
| `src/services/market/marketAnalysis.spec.ts` | 反例（仅 `market_price` 真实 → 其余字段空、无示例值 318/1258.6/856.2/286.4/116）、正例（公共键全真实 → captured）、全不真实 → 整页示例旧行为 |
| `src/services/data/contracts/marketInsightHeavyPagesClient.clearing.spec.ts` | 云南/广东/四川不发请求且返回「本地区不适用」空态；山西仍请求 `__list__` 并正常转换；能力声明与拦截口径一致 |
| `src/services/governance.navigation-region.spec.ts` | 云南菜单不含 `/sjfx/fshq`，山西/广东/四川菜单仍含；云南路由保持可达 |

### 回滚说明

这三处修正属于**地区隔离与数据真实性红线**（非山西地区不串读山西口径、Mock 不冒充真实），不是可试验的新功能：

- 不存在对应的界面开关或 feature flag，回滚任何一个新界面都不会恢复旧行为。
- 如确需调整（例如云南接入全省出清清单真实来源后放开出清页），应修改客户端地区白名单（`marketInsightHeavyPagesClient.ts` 的 `CLEARING_LIST_REGION_ALLOWED`）并同步 `regionModules.ts` 能力声明与本文档，配套调整上述测试——而不是简单 revert #2991 的提交（revert 会重新引入跨地区读取与示例冒充真实两个红线问题）。

## 跨地区一致性矩阵（dljy#3103，OpenSpec 任务 16.2）

市场洞察的页面地址不含省份（`/insight/<pageId>`），具体内容由当前全局地区的工作区注册决定（`src/services/region/insightWorkspace.ts`）。design D2 的「跨地区一致性矩阵」逐行约定了地区切换时的一致行为，本节记录每行的产品语义与验收位置；实现退化（跨省 import、切省后请求沿用旧地区等）必须能让对应用例失败，不允许恒绿假用例。

### 矩阵逐行语义

| D2 矩阵行 | 一致行为 | 主要断言 |
| --- | --- | --- |
| 云南价格页/总览切到山西 | 规范地址保持，加载**山西现有组件**（价格分析、洞察驾驶舱） | 同 pageId 两省解析到不同 workspaceId；山西页 `load` 指向 `PriceAnalysisView.vue` / `MarketInsightCockpitView.vue` |
| 云南专属页切到已登记但不支持此页的地区 | 落到**该地区登记的默认入口**并提示，不套云南页面 | 山西对 supply/grid-boundaries/plants/research 解析 `page-not-supported`，`resolveRegionSwitchRoute` 落山西默认入口 + 白名单 query（date 保留） |
| 切到未登记洞察的可选地区 | 留在市场洞察显示「未开通」，不读取他省数据 | 广东/四川六页全 `not-registered`、导航不替换、无 `load` 句柄可借数；六条规范路径切区原地停留 |
| 山西旧 `/sjfx/zrsjg` 等旧链接 | 兼容映射按 D2 迁移表登记（阶段 A 只登记不启用），山西旧入口原样可用 | `insightLegacyLinks` 11 条与 `canonicalInsightRoutePath` 全表回归；山西访问旧路径不重定向 |
| 非市场洞察模块切地区 | 完全沿用当前行为 | 洞察六页装配后非洞察分组引用与路径集合不变；`/sjfx/zrsjg` 等非规范路径切区仍走通用 landing 逻辑 |
| 山西业务布局/口径不变 | 兼容登记不重排山西产品 | 山西 `replacesNavigation` 为假、只登记 overview/prices 两页、侧边栏沿用旧入口 |

两条负例底线（对应 RW04 与地区隔离红线）：

- **跨省 import 静态断言**：`src/features/regions/yunnan/**` 不得 import 任何含 `shanxi` 的模块（含 `../shanxi/` 相对路径），反向亦然；`src/services/region/` 内核产码不得 import 任何具体省包，装配只经 `features/regions` 聚合入口。检测器带自检样例，防止恒绿。
- **请求负例**：切省后洞察请求上下文必须跟随全局地区——`useInsightContext::toQueryContext().regionId` 跟随 `selectedRegionId`、contextVersion 递增、对象选择清空（不跨省沿用）；`api.ts` 的 `x-region-id` 头来源 `currentRegion.id` 与全局地区同步。

### 测试位置

| 测试文件 | 覆盖 |
| --- | --- |
| `src/services/region/regionConsistencyMatrix.spec.ts` | 矩阵逐行验收（22 例）：同地址异省、专属页回落默认入口、未登记地区无借数、山西布局不变、非洞察导航不变、跨省 import 负例、请求 regionId 跟随负例、旧深链全表回归 |
| `src/services/region/regionIsolation.spec.ts` | 既有：请求/缓存/能力层面的地区隔离运行时矩阵（含「规范入口未登记地区不借数」） |
| `src/services/region/insightWorkspace.spec.ts` | 既有：工作区注册契约（三种解析结果、重复注册抛错、真包装配） |
| `src/services/region/regionNavigation.insight.spec.ts` | 既有：地区切换洞察分支三态与非洞察路径回归 |
| `src/data/navigation.insight-assembly.spec.ts` | 既有：洞察分组原位替换与权限过滤链组合 |
| `src/services/governance.insight-aliases.spec.ts` | 既有：规范入口权限等价（RW05 不扩权） |

回退纪律（RW06）：云南工作区受 `VITE_YUNNAN_INSIGHT_WORKSPACE` 装配开关控制，关闭时云南按未开通处理、山西解析原样可用；矩阵用例对开关两种状态分别核对，回退云南界面装配不得改变山西或非洞察模块的任何行为。
