# 市场洞察旧图表能力清单

> dljy#2995（云南地区市场洞察工作区，OpenSpec `build-yunnan-regional-market-insight` D6.1）阶段 A 产出。
> 逐项登记现有「市场洞察」域图表能力的**代码位置、业务问题、云南工作区新落点、数据资格、复用方式与验收要点**，
> 供后续阶段逐页交付时对照——旧能力一个不丢，不重做业务设计。
> 任务 16.8 的六页落位核对结论见文末「云南六页落位核对（16.8 / A20）」。
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
- **云南新位置**：不占洞察路由——从价格、跨省与电网边界、场站页的动作按钮进入 grid-geo 全屏场景（沿用现有模块）。
- **数据资格**：电网台账与厂站坐标（`dim_plant` 等维度族）；地形为公共地图源。
- **复用方式**：洞察页只加「在空间视图查看」动作链接，grid-geo 模块整体复用；登记见 `src/features/regions/yunnan/insight/spatialLinks.ts`，白名单+权限+出口的公共骨架在 `insightLinkGuard.ts`（与业务深链共用，dljy#3121）（接收侧仅披露检索词预填一处最小面）。
- **挂接状态（dljy#3106 核对行）**：**已挂接（2026-09-19）**，入口清单——
  - 价格页「节点基差」选中参考节点 → `/grid-assets/market`（节点对象绑定，objectDate 取窗口末日）；
  - 场站页「组合总览」选中单场站 → `/grid-assets/market`（场站对象绑定）；
  - 电网边界页「通道断面」选中单个通道/断面 → `/grid-assets/disclosures`（通道/断面无 grid-geo 对象类型，以披露检索词 + 业务日期承接）；
  - 显隐：`governance.canAccessPath` 既有口径 + 单对象 + 公司明确；多选不渲染（对象名数组不进 URL）。
- **验收要点**：从洞察页可跳入对应场站/节点的空间视图；token 缺失时走既有降级链（平面图）。

---

## 云南六页落位核对（16.8 / A20）

> 2026-09-19 对照 `feat/chart-inventory-check`（叠于 feat/ai-pages 之上）的六页实现逐行核对（dljy#3106）。
> 「资格」沿用 design.md D6.1 原始措辞；「实例可用性」据 dljy#3086 实测快照（洞察 API，2026-09-19）与
> 数据落库 #3088 现状——两者都只描述核验时点，不是持续供数承诺。浏览器动线的真实设备证据
> （A17—A20 真实设备部分）归 #3010，不在本核对范围。无数据能力如实标「未就绪＋原因」，
> 不以页面存在冒充能力。

| # | D6.1 旧能力 | 云南六页落位（新落点） | 资格 → 核对现状 | 测试位置 | 实例可用性 |
|---|---|---|---|---|---|
| 1 | 三维多日价格线 + 日内切面 + 日期切面 | `YunnanPricesPage.vue` 时段走势页签：单日走势 / 多日立体 / 日期×时段热力三模式（`Price3DWorkspace.vue` + `Price3DScene.vue`，纯模型 `priceProfileModel.ts`）；与「历史分布」页签共用同一份 profile 结果，不另发请求 | 必须保留并适配 → **已适配**：单日明确为单日剖面；多日默认 7 日窗、扩窗须用户显式确认（不悄悄扩窗）；超 6000 原生点不渲染三维也不静默截断 | `priceProfileModel.spec.ts`、`Price3DWorkspace.component.spec.ts`、`Price3DScene.component.spec.ts` | 可用（#3086：价格完整窗口 2026-05-01~08-17/18，5 月 complete、8 月边缘日 partial 如实标注） |
| 2 | 节点×时段热力、节点价曲线与基差 | 价格页「节点基差」页签（`basis` 视图，参考对象显式指定）+「历史分布」的日期×时段热力（热格点击 → 同步切面与证据表） | 必须保留 → **保留**：全量统计走 summary 指标与切面证据表，选择热格下钻到证据行；基差只在共同有效时段计算 | `Price3DWorkspace.component.spec.ts`（热力）、`YunnanPricesPage.component.spec.ts` | 可用（#3086：public/company-node 15 分钟原生粒度；user-price 无节点维度则不提供基差，如实说明） |
| 3 | 日前实时曲线、差值及异常时段 | 价格页「日前实时价差」页签（`spread` 视图）：配对曲线 + 异常时段表（行点击 → 图表定位）+ 配对统计卡 + 未配对原因逐条说明 | 必须保留 → **保留**：同一共同覆盖样本配对；异常规则原文展示；价差=日前−实时是价格差不是收益 | `YunnanPricesPage.component.spec.ts` | 可用（#3086：价差摘要实测；2026-05 起采集覆盖，覆盖外诚实空态） |
| 4 | 逐日负荷均值/极值、同期与连续历史 | 供需页「历史比较」页签（`history` 视图，`YunnanSupplyPage.vue`） | 保留适用能力 → **保留**：参考窗口由用户显式选择（不自动取去年同期），只比较两边都有的日期；云南缺年诚实断线不插值 | `YunnanSupplyPage.component.spec.ts` | 可用（窗口受披露实际/月包覆盖约束：#3086 供需完整窗口同 2026-05 起；窗口外空态） |
| 5 | 综合多指标、多轴、参考日和保存视图 | 研究页受控自定义：指标输入只有预设登记项的只读白名单下拉 + 有限变换；可保存研究定义（`definitionDraft`） | 必须保留适用能力 → **保留**：按云南指标目录；不是 SQL 控制台；保存承载为研究定义草稿而非自由视图快照 | `YunnanResearchPage.component.spec.ts`、`insightContractConsumers.spec.ts` | 可用（research/preview 实例已接，#3086 联调口径） |
| 6 | 价格×新能源/负荷关系散点 | 研究页预设 `research.price-new-energy-correlation`、`research.price-load-correlation`（`shared/insight/research.mjs` 登记） | 必须保留并扩充 → **已扩充**：同族共 9 个登记预设（水电出力、送受、价差-联络线、滞后对比、负荷进度、异常窗口、同类日） | `insightContractConsumers.spec.ts`、`YunnanResearchPage.component.spec.ts` | 可用（预设资格不足时页面标「输入不足」可见不可运行，不硬凑） |
| 7 | 结算趋势、场站 min/max 区间与均值点 | 场站页「结算表现」页签（`plants.settlement-daily` / `settlement-status-diff` / `settlement-interval` 三分析） | 必须保留适用能力 → **保留**：正式/暂结是显式状态轴（默认正式），区间不冒充箱线图，量费加权口径见 plants 文档 | `YunnanPlantsPage.component.spec.ts` | 部分可用（#3086 覆盖窗口内可用；暂结对照依赖 #3088 管线的 `plant_daily_settlement_raw` 数据集真实补录执行——管线与对拍已就绪，写库由主会话按授权另行执行，补录前暂结侧如实空态） |
| 8 | 量价叠加、结构堆叠、排序 | 场站页组合总览 / 价格出力页签（捕获参考价分桶、序列图表），供需页全景引用 | 保留表达形式、替换错误数据口径 → **已换口径**：可相加分项才堆叠，缺来源不造份额；缺出力场站诚实缺席不补零 | `YunnanPlantsPage.component.spec.ts` | 可用（#3086 覆盖窗口内；缺测字段按六字段独立统计覆盖天数） |
| 9 | 市场异动卡、按时段关注项 | 总览页重点事项区块（`OVERVIEW_BLOCKS` 确定性装配，`YunnanOverviewPage.vue`） | 保留发现与证据链 → **保留**：规则评估逐条在、文案带「这是价格差，不是收益」限定；无数据区块显示说明卡不出雷达分 | `YunnanOverviewPage.component.spec.ts` | 可用（#3086：总览 5/2 触发 1 条重点事项实测，规则评估逐条在） |
| 10 | 竞价空间×价格拟合、陡缓区间 | 研究页预设 `research.residual-proxy-price-correlation`；供需页「剩余需求代理」口径说明 | 按能力开放 → **按能力开放**：代理变量不冒充官方竞价空间（页面固定文案），复用已验证模型并展示样本/覆盖；输入资格不足禁用 | `YunnanResearchPage.component.spec.ts`、`YunnanSupplyPage.component.spec.ts` | 按资格（#3086 输入面以能力目录为准；缺输入则禁用不硬凑） |
| 11 | 价差卡中的套利收益/储能回测 | 价差事实留价格页「日前实时价差」（spread 视图）；套利测算不进洞察（无资金测算页内入口） | 不作为市场事实搬运 → **遵守**：价差固定「日前 − 实时」且标注价格差不是收益；未搬运任何收益测算 | `YunnanPricesPage.component.spec.ts` | 可用（价差为价格事实，非成交语义） |
| 12 | 撮合日 K、买卖盘逐笔 | **云南隐藏、山西保留**：导航菜单 `hiddenInRegionIds: ['yunnan']`（`src/data/navigation.ts`）；路由保持可达，云南直接访问显示 #2991 可解释降级卡 + 价格分析入口（`FshqView.vue`） | 云南无撮合来源则隐藏 → **一致**：绝不以节点价拼假盘口；山西原能力原样保留（组件零改动） | `governance.navigation-region.spec.ts` | 山西可用；云南按设计隐藏（云南、广东、四川无来源） |
| 13 | 三维地形、场站/节点空间位置 | grid-geo 模块整体保留（`CesiumPlantMap.vue` / `ProvinceFlatMap.vue` 在位，零改动）；**洞察页动作入口未挂接** | 保留入口与上下文 → **未就绪（如实登记）**：模块与旧入口保留 ✓；「从节点/电网/场站动作进入空间场景」的按钮尚未在六页挂接——不以「模块存在」冒充「入口已通」，挂接归后续切片 | grid-geo 既有测试（本切片不改该模块） | 旧入口可用；洞察内入口未就绪（待挂接） |

### 统计一致性用例（16.8「统计不随抽样改变」）

新增 8 例（16.8 / A20 自动化落点）：

- `priceProfileModel.spec.ts` 新 describe「统计不随抽样与呈现次序改变」5 例：
  1. rows 乱序输入：网格轴、热力极值与格子数与原序一致（行序是传输细节，不进统计）；
  2. 三维顶点合计 === 网格原生行数（阶梯与拆段只是表达，**不新增观测点**）；
  3. 缺测拆段无桥接顶点（段间不存在补出的连接点）；
  4. 全负价序列：热力极值两端均为负（轴 domain 可整体为负），切面与默认剖面照常解析；
  5. 同一网格下三维顶点、热力格子与证据表对同一时段给出同一值（各视图不各自抽样）。
- `insightContractConsumers.spec.ts`（新文件）3 例：
  6. research/preview 契约三层俱全：端点登记 → researchClient 真实 POST → 研究页真实消费；
  7. insights/query 契约：除研究页（走研究预览契约）外五页真实调用 queryInsight，六页全部消费 insightClient；
  8. 六页注册与页面文件一一对应（注册无孤儿、页面文件无未注册，运行时 readdir 列举不硬编码）。

引用既有（不重复造）：

- **GL 失败可降级**：`Price3DWorkspace.component.spec.ts`「三维预算与 WebGL 降级」——超 6000 原生点不画三维且不截断、WebGL 不可用自动降级热力（同一数据）且说明如实、页签切走不渲染三维；`Price3DScene.component.spec.ts`——初始化抛错 → emit initError 父级降级、卸载 dispose 释放 WebGL 上下文。
- **负价可见 / 缺测断开**：`priceProfileModel.spec.ts`（负价原样为负、缺测两侧拆段断开不跨缺测连线、visualMap 极值含负价）与 `Price3DWorkspace.component.spec.ts`（热力负价时色带以 0 为中心对称）。
- **渲染/切面性能**：三维只承担看多日结构（6000 原生点预算内不降采样、超预算明示切热力），二维切面与表格同一份规范结果；大屏/受限设备的真实测量归 #3010。

### 契约非「只有类型声明」

`insightContractConsumers.spec.ts` 把「契约有真实消费者」固化为门禁：三层断链（端点登记 → 客户端 POST → 页面源码消费）任一断开即红；六页注册与 `pages/Yunnan*Page.vue` 一一对应（readdir 运行时核对），孤儿注册或未注册文件都会失败。

---



- 迁移不改数据口径：每项复用的取数函数、字段映射原样保留；口径变化必须单独走数据口径变更流程并登记 `market-insight.md`。
- 地区隔离：上述任何能力在云南的新页面里只吃云南真实源；缺源诚实空态或说明卡，绝不串读山西/广东/四川（spec RW02/RW05 及地区隔离红线）。
- 请求代次：多页签共宿主的页面统一走 `useInsightRequestGeneration`，A→B→A 迟到响应按代次丢弃（spec RW04）。
- 旧入口不破坏：`insightLegacyLinks` 未启用前旧路径全部原样可用；启用某条映射后，目标页未交付仍回退旧入口（RW03）。
