# 市场洞察数据口径说明

本页记录「市场洞察」域（导航分组：市场洞察，路由前缀 `/insight`、`/sjfx/*`）的数据来源约定与真实性修正记录。面向业务与开发，避免「示例数据冒充真实」「跨地区读取他省数据」两类问题再次出现。

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
