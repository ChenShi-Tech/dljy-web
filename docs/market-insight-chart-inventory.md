# 市场洞察旧图表能力清单

> dljy#2995（云南地区市场洞察工作区，OpenSpec `build-yunnan-regional-market-insight` D6.1）阶段 A 产出。
> 逐项登记现有「市场洞察」域图表能力的**代码位置、业务问题、云南工作区新落点、数据资格、复用方式与验收要点**，
> 供后续阶段逐页交付时对照——旧能力一个不丢，不重做业务设计。
> 数据口径总说明见 [market-insight.md](./market-insight.md)。

六页与页 id 的对应：市场总览 `overview`、价格与价差 `prices`、供需与水电 `supply`、跨省与电网边界 `grid-boundaries`、场站市场表现 `plants`、研究工作台 `research`（注册契约见 `src/services/region/insightWorkspace.ts`）。

---

## 1. 三维多日价格曲面 + 时段/日期双切面

- **现有位置**：`src/views/PriceAnalysisView.vue`（`render3D` :125、`renderTimeSlice` :161、`renderDateSlice` :183、`renderAll` :117；echarts-gl 引入 :9；取数 `load` :55）。
- **业务问题**：多日电价曲面观察价格水平与形态；双切面回答「某时段跨日怎么走」「某日跨时段怎么走」。
- **云南新位置**：价格与价差（`prices`）→ 时段走势页签（旧入口 `/sjfx/zrsjg` 的规范承接，兼容映射 `tab=periods`）。
- **数据资格**：`sdpt_zcqxhdl/listrs_full`（rjz/rmx/dmx 三序列）已有云南真实回放，不需新源。
- **复用方式**：整组件迁入云南包（`load` 指向该组件），视图层不动，仅外层由宿主分发；山西同步经兼容登记复用同一组件。
- **验收要点**：3D 曲面可旋转缩放；两切面随 brush/点击联动；空数据诚实显示空态，不渲染假点。

## 2. 节点热力与 96 点曲线

- **现有位置**：`src/views/yunnan/panels/YunnanNodePricePanel.vue`（`loadSeries` :83、`loadHeatmap` :120、`loadDaily` :138、`buildSeriesOption` :209、`buildHeatmapOption` :268）。
- **业务问题**：节点电价的空间（热力）与时间（96 点曲线）分布，识别阻塞与局部高价。
- **云南新位置**：价格与价差（`prices`）→ 节点页签（兼容映射保留 `source=company-node` 私有来源身份）。
- **数据资格**：agent-backend PostgreSQL 节点电价（云南真实，权威后端）。
- **复用方式**：面板组件原样嵌入页签容器；不改取数协议。
- **验收要点**：热力图 + 曲线 + 当日节点聚合明细三视图齐全；代次取消（`useInsightRequestGeneration`）切换不串台。

## 3. 日前-实时差值（三价对比）

- **现有位置**：`src/views/yunnan/panels/YunnanSettlementPricePanel.vue`（`buildPriceOption` :317 三价主线、`loadSettle` :658、`loadDaily` :692）。
- **业务问题**：日前/实时/中长期结算价对比与差值，支撑偏差与持仓视角。
- **云南新位置**：价格与价差（`prices`）→ 日前-实时页签；事实卡同时进市场总览。
- **数据资格**：结算导出链（云南真实；采集覆盖自 2026-05 起，覆盖外诚实空态）。
- **复用方式**：面板组件嵌入页签；差值计算保持在面板内，不另起口径。
- **验收要点**：三价同轴 + 差值带；日期窗越界显示覆盖范围说明而非拉空图。

## 4. 逐日负荷历史比较

- **现有位置**：`src/views/DailySystemLoadView.vue`（`load` :74；日历对齐 system + 错位 miscale 两种口径）。
- **业务问题**：多年逐日负荷的年际/季节比较，锚定供需基线。
- **云南新位置**：供需与水电（`supply`）→ 总览页签（兼容映射 `/sjfx/actualLoad` → `tab=overview`）。
- **数据资格**：`sdpt_actualLoad` 已有云南真实支撑。
- **复用方式**：整组件迁入；错位负荷口径保留原开关。
- **验收要点**：system/misplace 双口径可切换；跨年比较可用；云南缺年诚实断线不插值。

## 5. 综合多指标多轴 + 保存视图

- **现有位置**：`src/views/DataAnalysisView.vue`（`load` :72、`fetchDay` :127、`render` :173、视图保存 `onSaveView` :302 / `onApplyView` :309，按 `ROUTE_PATH` 挂 `AnalysisView`）。
- **业务问题**：63 类型指标自由组合成多轴自定义视图，是研究工作的底盘。
- **云南新位置**：研究工作台（`research`）→ 自定义模式（兼容映射 `/sjfx/singleZsjfx` → `mode=custom`）。
- **数据资格**：`sdpt_zsjfx_idx` 已有云南真实支撑。
- **复用方式**：组件迁入 + `ROUTE_PATH` 换为 `/insight/research`（旧 routePath 经 `canonicalInsightRoutePath` 识别为同一身份，已存视图不丢）。
- **验收要点**：多序列多轴渲染；保存/应用/删除视图闭环；旧书签视图在新路径下可检索。

## 6. 价格 × 新能源 / 负荷关系（散点 + 热力 + 敏感性）

- **现有位置**：`src/views/relation/RelationExplorer.vue`（`renderHeatmap` :128、`renderHour` :160、`renderSensitivity` :217、`renderAll` :242）；薄壳宿主 `PriceNewEnergyRelationView.vue` / `PriceLoadRelationView.vue`。
- **业务问题**：价格与出力/负荷的相关结构（时刻切片、敏感性），支撑策略归因。
- **云南新位置**：研究工作台（`research`）→ 预设 `price-new-energy`（`/sjfx/zrxgx`）与 `price-load`（`/sjfx/zrxgx2`）。
- **数据资格**：`list24` / `fhlist24` 与 `yn_system_forecast` 已有云南真实支撑；山西专有维度（xnyzd/xnyg/xnygd）在云南保持隐藏（regionModules subCapabilities）。
- **复用方式**：RelationExplorer 作为研究页预设渲染器，两预设只差初始维度配置。
- **验收要点**：三视图联动；云南不出现山西专有维度；维度切换不触发跨省取数。

## 7. 结算趋势与峰谷区间柱

- **现有位置**：`src/views/yunnan/panels/YunnanSettlementPricePanel.vue`（`buildPeakValleyOption` :437、`buildPeakValleyTrendOption` :547）。
- **业务问题**：结算价的月度趋势与峰谷区间结构，服务场站收益解读。
- **云南新位置**：场站市场表现（`plants`）→ 结算页签（兼容映射 `/xhjy/yunnan/settlement-price` → `tab=settlement`）。
- **数据资格**：结算导出（云南真实；同第 3 项覆盖范围）。
- **复用方式**：面板组件嵌入页签，保留厂站/正式-暂结选择参数。
- **验收要点**：趋势线 + 峰谷柱同屏；厂站过滤生效；正式/暂结切换不混算。

## 8. 量价叠加 / 堆叠 / 排序（电价×出力联动）

- **现有位置**：`src/features/regions/yunnan/panels/PriceOutputLinkagePanel.vue`（`buildMainOption` :446 量价同轴、`buildScatterOption` :568 关联散点、`loadPrice` :728）。
- **业务问题**：节点价与自有场站出力的联动（同轴叠加 + 相关散点），发电侧核心分析。
- **云南新位置**：场站市场表现（`plants`）→ 组合视图；同时供供需页全景引用。
- **数据资格**：节点电价 + `yn_plant_output`（云南真实）。
- **复用方式**：面板组件嵌入页签；已从云南交易工作台 tab 并入（父 Issue #456 口径不变）。
- **验收要点**：量价同轴 + 散点；场站多选聚合与单选排序；缺出力场站诚实缺席不补零。

## 9. 市场异动雷达卡

- **现有位置**：`src/components/agent/dljy-ui/insight/AnomalyRadarCard.vue`（驾驶舱装配见 `src/views/MarketInsightCockpitView.vue` :6，bundle 经 `fetchMarketInsightBundle`）。
- **业务问题**：当日价格/供需异动的一屏清单与 AI 解读入口。
- **云南新位置**：市场总览（`overview`）→ 异动区块；其余页可深链回总览。
- **数据资格**：`market_insight` bundle（云南 degraded 区块由 bundle gaps 标注，诚实空态）。
- **复用方式**：dljy-ui 卡片组件原样复用；总览页复用驾驶舱的确定性装配链（不经 LLM 出数）。
- **验收要点**：异动清单确定性渲染；「AI 解读」仅作解读不产出数值；云南缺源区块显示说明卡。

## 10. 竞价空间拟合（价格弹性）

- **现有位置**：`src/features/regions/yunnan/panels/ElasticityPanel.vue`（`loadRegions` :44、`buildCurveOption` :96、`buildPredictOption` :172、`buildBidSpaceOption` :227）。
- **业务问题**：竞价空间→出清价分段弹性，预判价格水平与陡峭度。
- **云南新位置**：研究工作台（`research`）→ 价格响应预设。
- **数据资格**：云南现货/气象计算链（分析参考，非结算依据——面板内既有警示保留）。
- **复用方式**：面板组件作为研究页预设之一；naive 对照逻辑不动。
- **验收要点**：弹性曲线 + 预测叠加 + 竞价空间输入三件套；「非结算依据」标注不丢。

## 11. 套利 / 储能动作卡

- **现有位置**：`src/features/regions/yunnan/panels/SpreadPanel.vue`（`loadRegions` :32、`buildSpreadOption` :85、`buildActionOption` :143）；驾驶舱侧 `SpreadArbitrageCard.vue`。
- **业务问题**：日前-实时价差带与跨期套利/储能充放建议。
- **云南新位置**：价差**事实**（价差带）留价格与价差页；套利**测算**动作引导至储能投资收益测算（`/xhjy/storage-copilot`），不在洞察页内做资金测算。
- **数据资格**：日前/实时价（云南真实）；测算输出为决策支持、非真实成交。
- **复用方式**：SpreadPanel 的价差视图并入价格页页签；动作建议保留跳转储能模块入口。
- **验收要点**：价差带渲染正确；动作卡保留「决策支持·上线前人工确认」提示；不产生任何成交语义。

## 12. 撮合行情日 K

- **现有位置**：`src/views/FshqView.vue`（`renderBuySell` :154、`renderMain` :179，candlestick 日 K :214）。
- **业务问题**：集中撮合市场的日内 K 线与买卖盘结构（仅撮合制市场有意义）。
- **云南新位置**：**不迁移**——`sdpt_fshq` 为山西三德私有族，云南无撮合分时行情来源（dljy#2991），兼容表只登记 notice 说明（节点价格不等同撮合行情）；该能力仅在有撮合来源的地区保留独立入口。
- **数据资格**：山西真实（`sdpt_fshq`，2563 文件）；云南、广东、四川无来源。
- **复用方式**：组件原地不动；云南导航已隐藏该入口（`hiddenInRegionIds`）。
- **验收要点**：云南访问旧路径仍得可解释降级卡；绝不以节点价数据伪造撮合 K 线。

## 13. 三维地形 / 场站空间位置

- **现有位置**：`src/features/gridGeo/CesiumPlantMap.vue`（三维）、`ProvinceFlatMap.vue`（平面回退）。
- **业务问题**：场站与节点的地理空间位置、地形遮挡直觉，配合价差/出力做空间归因。
- **云南新位置**：不占洞察路由——从价格（节点页签）、跨省与电网边界（`grid-boundaries`）、场站页的动作按钮进入 grid-geo 全屏场景（沿用现有模块）。
- **数据资格**：电网台账与厂站坐标（`dim_plant` 等维度族）；地形为公共地图源。
- **复用方式**：洞察页只加「在地图中查看」动作链接，grid-geo 模块整体复用、零改动。
- **验收要点**：从洞察页可跳入对应场站/节点的空间视图；token 缺失时走既有降级链（平面图）。

---

## 通用验收底线（适用全部条目）

- 迁移不改数据口径：每项复用的取数函数、字段映射原样保留；口径变化必须单独走数据口径变更流程并登记 `market-insight.md`。
- 地区隔离：上述任何能力在云南的新页面里只吃云南真实源；缺源诚实空态或说明卡，绝不串读山西/广东/四川（spec RW02/RW05 及地区隔离红线）。
- 请求代次：多页签共宿主的页面统一走 `useInsightRequestGeneration`，A→B→A 迟到响应按代次丢弃（spec RW04）。
- 旧入口不破坏：`insightLegacyLinks` 未启用前旧路径全部原样可用；启用某条映射后，目标页未交付仍回退旧入口（RW03）。
