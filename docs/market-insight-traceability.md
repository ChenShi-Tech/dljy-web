# 市场洞察验收追溯与回滚汇总（OpenSpec 17.3，dljy#3112）

本页是市场洞察切片的**追溯入口**：从业务问题出发，向上追到分析目录里的 analysisId 与公式口径，向下追到源资料、文档、测试与交付 PR。对应 OpenSpec change `build-yunnan-regional-market-insight` 任务 17.3 的验收标准——「与最终实现一致，能从业务问题追溯公式和源资料」。

> **诚实边界（先读）**：本表与工作区 OpenSpec `openspec/changes/build-yunnan-regional-market-insight/verification-matrix.md`（A01—A24 证据矩阵）互链。矩阵三栏中「持续在线供数（任务 17.5 / dljy#2845）」与「目标实例浏览器核验（dljy#3010）」的未完成项**不在本表宣称完成**——本表只登记代码、文档、测试与 PR 层面已交付的事实；浏览器动线与在线验收结论以 #3010 / #2845 的记录为准。dljy 仓侧 docs-index / current-status 登记由独立分支另行处理，不在本仓文档内指认。

## 一、数据域（来源登记口径）

以下四域对应 `shared/insight/sources.mjs` 镜像登记（70 个来源），是追溯表中「源资料」列的分类依据：

| 数据域 | 登记特征 | 来源数 | 典型 sourceId |
| --- | --- | --- | --- |
| 公开年包 | `accessScope: public` + `ingestChannel: bulk-history` | 21 | `yn.system.*`、`yn.price.user.*`、`yn.price.node.public.*`、`csg.system.*` |
| 披露读模型 | 公开年包中经披露读模型落库的度量与送受曲线（`read: yn_disclosure_metric` 等） | 3 | `csg.disclosure.stable-section`、`csg.disclosure.reserve.forecast`、`csg.transfer.inter-provincial.forecast` |
| 获权 API | `accessScope: company` + `ingestChannel: cgn-api`（南网披露口径经获权通道） | 24 | `cgn.grid.*`、`cgn.hydro.*`、`cgn.reserve.*`、`cgn.units.*`、`cgn.price.node.*`、`cgn.price.plant-node.*` |
| 五月月包 | `accessScope: company` + `ingestChannel: monthly-export`（公司月包，freshness `monthly-package`） | 22 | `cgn.plant.*`、`cgn.settlement.*` |

## 二、业务问题追溯表

分析目录以 `shared/insight/analyses.mjs` 镜像为准：**只有登记在案的 analysisId 才能被查询**（#2993 任务 3.1）。下表逐行列出全部 24 个已登记分析；「核心公式/口径」引用 OpenSpec design D5《核心公式与手算对拍》表行与决策条目。

### 总览与供需

| 业务问题 | analysisId（页面） | 核心公式/口径 | 源资料（数据域） | 文档 | 测试 | 交付 PR |
| --- | --- | --- | --- | --- | --- | --- |
| 云南系统负荷/电源/非市场出力现状与明日预测如何？南网整体背景如何并列？ | `supply.system-series`（总览、供需） | 供需/预测配对、剩余需求代理「负荷＋净外送−新能源」、预测 MAE/Bias、电量误差（D5 表） | 公开年包 `yn.system.*`＋`csg.system.*`；送出预测 `yn.transfer.send-out.forecast`（共 16 源） | [供需页《四页签口径》](./market-insight-supply.md)、[总览页](./market-insight-overview.md) | `YunnanSupplyPage.component.spec.ts`、`YunnanOverviewPage.component.spec.ts` | dljy-web#143、#147 |
| 今天有哪些可证的重点事项？与昨日同进度比如何？ | `overview.key-items`（总览） | 规则与阈值在 `shared/insight/overview.mjs` 登记；同进度比较读前一日作参考期（OV03/OV04） | 公开年包 `yn.price.user.*`、`yn.system.load/new-energy.*` | [总览页《口径要点》](./market-insight-overview.md) | `YunnanOverviewPage.component.spec.ts` | dljy-web#147 |
| 获权水电的周出力预测按区域如何分布？ | `supply.hydro-weekly-output`（供需） | 逐日平均出力按区域分列，云南与其他省不相加（SH02、D5.6 跨期） | 获权 API `cgn.hydro.weekly-output.forecast` | [供需页《水电》](./market-insight-supply.md) | `YunnanSupplyPage.component.spec.ts` | dljy-web#143 |
| 云南水电机组群构成与出力占比如何？ | `supply.hydro-unit-groups`（供需） | 只有占比，不派生上限值（SH02） | 获权 API `cgn.hydro.yn-group-share` | [供需页《水电》](./market-insight-supply.md) | `YunnanSupplyPage.component.spec.ts` | dljy-web#143 |
| 一体化预测出力与实发执行偏差如何？ | `plants.business-forecast`（场站） | 预测与实际配对呈现，不跨供应商混合（D5 配对口径） | 五月月包 `cgn.plant.business-integrated-forecast` | [场站页《预测执行》](./market-insight-plants.md) | `YunnanPlantsPage.component.spec.ts` | dljy-web#153 |

### 价格与价差

| 业务问题 | analysisId（页面） | 核心公式/口径 | 源资料（数据域） | 文档 | 测试 | 交付 PR |
| --- | --- | --- | --- | --- | --- | --- |
| 用户侧日前/实时价格走势、价差、分布如何？ | `prices.user-series`（总览、价格） | 时长加权均价 `Σ(Pt×Δt)/ΣΔt`；DA−RT 逐项差；负价时长；分布页（D5 表；PR02 无节点维度） | 公开年包 `yn.price.user.day-ahead/real-time` | [价格页《四页签口径》](./market-insight-prices.md) | `YunnanPricesPage.component.spec.ts`、`prices/priceProfileModel.spec.ts` | dljy-web#141、#148、#151 |
| 公开历史节点价格与对象间价差/基差如何？ | `prices.public-node-series`（价格） | 节点基差 `Pnode−Preference`（参考对象显式）；节点时隙负价比与单节点负价小时分开（D5 表） | 公开年包 `yn.price.node.public.*` | [价格页《节点基差》](./market-insight-prices.md) | `YunnanPricesPage.component.spec.ts` | dljy-web#141、#148 |
| 获权厂侧节点价格如何？ | `prices.company-node-series`（价格） | 同上四视图＋基差；节点价唯一来源不双计（D5.5） | 获权 API `cgn.price.node.*` | [价格页《价格对象目录》](./market-insight-prices.md) | `YunnanPricesPage.component.spec.ts` | dljy-web#141、#148 |
| 场站关联节点价格如何？ | `prices.plant-node-series`（价格、场站） | 同上；作价格捕获参考输入（PP03） | 获权 API `cgn.price.plant-node.*`、`cgn.plant.nodal-price` | [价格页、场站页《价格出力》](./market-insight-prices.md) | `YunnanPricesPage.component.spec.ts`、`YunnanPlantsPage.component.spec.ts` | dljy-web#141、#148、#153 |
| 多日价格结构如何立体观察？ | （价格页时段走势多日视图，消费 `prices.*` 序列） | D6.2 三维交互：X=业务日期/Y=原生时段/Z=价格，负价可见、缺测断开、单日为剖面 | 同所选 `prices.*` 分析 | [价格页《多日展示》](./market-insight-prices.md)、[旧图表清单 §1](./market-insight-chart-inventory.md) | `prices/Price3DWorkspace.component.spec.ts`、`Price3DScene.component.spec.ts`、`priceModeStorage.spec.ts` | dljy-web#148 |

### 跨省与电网边界

| 业务问题 | analysisId（页面） | 核心公式/口径 | 源资料（数据域） | 文档 | 测试 | 交付 PR |
| --- | --- | --- | --- | --- | --- | --- |
| 省间联络线、重点通道实际流量与断面限值是否配对？ | `grid.channel-flows`（电网边界） | 通道/断面限值只在同名、同方向、同一时段配对（GB01/GB02、D5.4 身份） | 获权 API `cgn.grid.tie-line/key-channel/key-line-transformer/section-constraint/external-tie-line` | [电网页《通道断面》](./market-insight-grid.md) | `YunnanGridBoundariesPage.component.spec.ts` | dljy-web#150 |
| 送电电量下限、通道能力与断面负载逐日如何？ | `grid.transfer-daily`（电网边界） | 送受电方向与来源保留，不换算不抵消（方向/符号纪律，见电网页文档） | 获权 API `cgn.grid.priority-limit/transmission-capacity/stable-section/section-congestion/load-summary` | [电网页《送受电》](./market-insight-grid.md) | `YunnanGridBoundariesPage.component.spec.ts` | dljy-web#150 |
| 备用、检修容量与机组群构成如何？ | `grid.reserve-units`（电网边界） | 容量、占比、权重按原义分列，不换算出力（GB03） | 获权 API `cgn.reserve.*`、`cgn.units.*`（6 源） | [电网页《备用机组》](./market-insight-grid.md) | `YunnanGridBoundariesPage.component.spec.ts` | dljy-web#150 |
| 哪些机组当期参与调峰、哪些必开必停？ | `grid.unit-lists`（电网边界） | 是否/清单类只给记录视图，不与曲线混编（GB03、D5.1） | 获权 API `cgn.units.peak-regulation/must-run-stop` | [电网页《分析目录》](./market-insight-grid.md) | `YunnanGridBoundariesPage.component.spec.ts` | dljy-web#150 |
| 检修计划/实际如何分列对照？ | （电网页检修干预页签，消费 `grid.*` 披露） | 计划/实际分列、同期联看不归因（10.6） | 获权 API 检修来源（随 dljy 侧登记补齐） | [电网页《检修干预》](./market-insight-grid.md) | `YunnanGridBoundariesPage.component.spec.ts` | dljy-web#156 |
| 跨省送受趋势与公开披露度量（稳定断面、备用预测）如何？ | `grid.boundary-series`（总览、电网边界） | 公开披露度量为背景量，不与获权通道量混算（D5.1 来源选择） | 披露读模型 `csg.transfer.inter-provincial.forecast`、`csg.disclosure.stable-section`、`csg.disclosure.reserve.forecast` | [电网页、总览页](./market-insight-grid.md) | `YunnanOverviewPage`/`YunnanGridBoundariesPage.component.spec.ts` | dljy-web#147、#150 |

### 场站市场表现

| 业务问题 | analysisId（页面） | 核心公式/口径 | 源资料（数据域） | 文档 | 测试 | 交付 PR |
| --- | --- | --- | --- | --- | --- | --- |
| 获权场站八类出力曲线形态如何？供应商之间可比吗？ | `plants.output-series`（场站） | 供应商比较按共同场站×时段组织，共同样本不足只并列、<4 不排名（D5.9 排名资格） | 五月月包 `cgn.plant.output` | [场站页《组合总览》](./market-insight-plants.md) | `YunnanPlantsPage.component.spec.ts` | dljy-web#153 |
| 场站价格捕获参考是多少？ | `plants.price-capture`（场站） | 捕获参考价 `Σ(Et×Pnode,t)/ΣEt`，同口径上网电量；参考价不是收入（PP03、D5 表） | 五月月包 `cgn.plant.business-actual`、`cgn.plant.nodal-price` | [场站页《价格出力》](./market-insight-plants.md) | `YunnanPlantsPage.component.spec.ts` | dljy-web#153 |
| 场站日结算电量电费与源系统损失如何？ | `plants.settlement-daily`（场站） | 损失解释：源值照常展示、电网损失全空保持未提供、分项不齐只给「未解释差额」（ST03—ST04） | 五月月包 `cgn.plant.settlement-daily`、`cgn.plant.loss-daily` | [场站页《结算页签》](./market-insight-plants.md) | `YunnanPlantsPage.component.spec.ts` | dljy-web#153、#155 |
| 正式结算与暂结同键差异在哪？ | `plants.settlement-status-diff`（场站） | 正式读模型 vs 暂结原始证据，两态都在才比差异，不相加（ST01、A08、D5.5 状态轴） | 五月月包 `cgn.plant.settlement-daily`、`cgn.settlement.daily-settlement-temp` | [场站页《结算页签》](./market-insight-plants.md) | `YunnanPlantsPage.component.spec.ts` | dljy-web#155 |
| 申报、出清、上网、集控实发口径如何对照？ | `plants.clearing-actual`（场站） | 量纲同、口径分开：语义对照视图并列不相加；中长期电量以「合同口径引用」单独成列（PP06） | 五月月包 `cgn.plant.spot-clearing-*/business-declared/business-actual/control-generation/midlong-energy` | [场站页《申报出清实际》](./market-insight-plants.md) | `YunnanPlantsPage.component.spec.ts` | dljy-web#153 |
| 场站历史中长期电量与合同价如何引用？ | `plants.midlong-reference`（场站） | 只读引用、单独口径，不并入现货对照（PP06） | 五月月包 `cgn.plant.midlong-energy/midlong-price` | [场站页《申报出清实际》](./market-insight-plants.md) | `YunnanPlantsPage.component.spec.ts` | dljy-web#153 |
| 场站日报六字段有效样本与覆盖如何？ | `plants.daily-metrics`（场站） | 覆盖摘要按字段独立统计有效样本（11.1） | 五月月包 `cgn.plant.daily-metrics` | [场站页《组合总览》](./market-insight-plants.md) | `YunnanPlantsPage.component.spec.ts` | dljy-web#153 |
| 分时结算电量电费（正式/暂结）与量费加权均价如何？ | `plants.settlement-interval`（场站） | 结算均价 `Σ电费/Σ电量` 成对有效记录；formal/temp 分别算不互加（ST02、D5 表） | 五月月包 `cgn.plant.settlement-interval-formal/temp` | [场站页《结算页签》](./market-insight-plants.md) | `YunnanPlantsPage.component.spec.ts` | dljy-web#153、#155 |
| 结算单据原件、月结载荷与拆分审批在哪？ | `plants.settlement-docs`（场站） | 记录不是时序：只给记录视图（GB03） | 五月月包 `cgn.settlement.bill-*/monthly-doc/daily-split`（5 源） | [场站页《结算页签》](./market-insight-plants.md) | `YunnanPlantsPage.component.spec.ts` | dljy-web#155 |
| 日报、日结与月结同周期数字能对上吗？ | `plants.settlement-reconcile`（场站） | 不同周期不相加不互比；同周期差异列带来源引用（ST05） | 五月月包 `cgn.plant.daily-metrics/settlement-daily`、`cgn.settlement.monthly-total` | [场站页《结算页签》](./market-insight-plants.md) | `YunnanPlantsPage.component.spec.ts` | dljy-web#155 |

### 研究工作台（不新增 analysisId）

| 业务问题 | 消费方式 | 口径 | 源资料 | 文档 | 测试 | 交付 PR |
| --- | --- | --- | --- | --- | --- | --- |
| 常用研究问题（价格响应、供需与价格关系、同类日等）如何检验？ | 研究页 9 个预设消费上表已登记分析（镜像登记为准） | 白名单指标＋有限变换，不是 SQL 控制台；事前/事后模式分离（RS02、RS04、D9） | 随各预设引用的分析（上表各域） | [研究页《预设清单》《受控自定义》](./market-insight-research.md) | `YunnanResearchPage.component.spec.ts` | dljy-web#157 |

### 横切（不在单个分析内，但每个分析都经过）

| 关注点 | 口径/依据 | 测试 | 交付 PR |
| --- | --- | --- | --- |
| 下钻上下文与返回状态（可校验 URL 编解码） | D11.2 四键语义，超长按序丢弃 | `useInsightContext.spec.ts`、`insightHandoff.spec.ts`、`handoffLinks.spec.ts` | dljy-web#154、#158、#162 |
| 统一下钻入口（深链与资料维护返回重查） | 15.5 只读深链 | `businessLinks.component.spec.ts` | dljy-web#158、#162 |
| 导出与材料（版本绑定、冲突先重跑） | 14.5/15.2；引用散列含业务键+版本+算法（D5.5） | `InsightMaterialDialog.component.spec.ts`、`InsightResultTable.component.spec.ts` | dljy-web#151、#162 |
| 六页统一 AI 侧栏注册与取材纪律 | 15.3；AI 取材不越过已登记来源 | `useInsightAiPage.component.spec.ts` | dljy-web#159 |
| 总览接入真实电网事件摘要 | 10.7；纯新增 opt-in 区块，事件来自披露来源，无数据不硬凑 | `YunnanOverviewPage.component.spec.ts` | dljy-web#161 |
| 跨地区一致性（不借他省口径） | D2 矩阵八行；RW01/RW03/RW04/RW06 | `regionConsistencyMatrix.spec.ts`、`insightWorkspace.spec.ts`、`regionIsolation`（CI 原生负例） | dljy-web#135、#160 |
| 跨模块回归与四条链路（AI/深链/材料/handoff 往返） | 15.6/15.8；A14/A18/A19 | `crossModuleRegression.spec.ts`、`handoffLinks.spec.ts` | dljy-web#162 |
| 旧图表能力落位与统计一致性 | 16.8、A20、D6.1 | 保留清单核对用例（#163 引入） | dljy-web#163 |
| 旧入口兼容与导航翻转 | D2 兼容路由 11 条映射 | `insightLegacyLinks.spec.ts`、`regionNavigation.insight.spec.ts`、`navigation.insight-assembly.spec.ts` | dljy-web#135、各页 PR |

## 三、回滚汇总表

按 PR 提取各「风险与回滚」章节。合并顺序恒自底向上（stack 主线 #148→#150→#151→#153→#155→#157→#159，其余为同层或后续叠放支，顺序以各 PR 头部标注为准）；含契约镜像提交（`chore(sync)`）的支，其镜像随同支按 stack 顺序回退。

| PR | 交付内容 | 回滚方式与约束 |
| --- | --- | --- |
| dljy-web#133（已合并） | 云南真实性修正（示例冒充真实、跨地区读取、分时行情入口） | **不建议直接 revert**：会重新引入「示例冒充真实」「跨地区读取山西私有清单」两个红线。调整路径＝改 `marketInsightHeavyPagesClient.ts` 白名单＋`regionModules.ts` 能力声明＋文档＋测试 |
| dljy-web#135（已合并） | 地区工作区装配与兼容路由骨架 | revert 即可（装配开关默认关，无库/后端联动、无环境依赖） |
| dljy-web#138/#140/#142/#144/#145 等（已合并） | 公共件、契约镜像同步与修复 | 随对应功能支整体回退；镜像提交按各自上游支同步处理 |
| dljy-web#141（已合并） | 价格页四页签 | revert 本提交即可（开关默认关、delivered=false，无数据迁移与生产写入） |
| dljy-web#143（已合并） | 供需页四页签 | revert 本 PR 即可（供需页回占位、导航恢复原状） |
| dljy-web#147（已合并） | 总览页（重点事项、区块摘要、下钻） | revert 本 PR 即可（导航回到仅供需与水电） |
| dljy-web#148 | 价格多日立体与日期×时段热力 | revert revert 即可：导航收回两项、时段走势回单日；echarts-gl 为既有依赖按需 chunk，不进主包 |
| dljy-web#150 | 电网边界页（送受电、通道断面、备用机组） | revert 本 PR：电网边界回「正在建设」占位、导航收回三项；与 #148 交叠文件按 stack 顺序处理，#148 合并后重定 base |
| dljy-web#151 | 价格导出与材料入口 | revert 即可（InsightBlock 新 props 均可选，既有消费方不受影响） |
| dljy-web#153 | 场站市场表现页 | revert 即可（导航收回四项）；含契约镜像提交，依赖 stack 顺序 |
| dljy-web#154 | 统一下钻上下文与返回状态 | revert 即可（四键语义不变，既有页面行为零变化） |
| dljy-web#155 | 场站页结算页签 | revert 即可（结算页签回占位）；镜像提交依赖 stack 顺序 |
| dljy-web#156 | 电网边界页检修干预页签 | revert 即可（电网页回三页签） |
| dljy-web#157 | 研究工作台页 | revert 即可（研究页回占位、导航收回五项）；镜像提交依赖 stack 顺序 |
| dljy-web#158 | 只读深链与资料维护返回重查 | revert 即可（InsightBlock 改动 opt-in，既有消费方零影响） |
| dljy-web#159 | 六页统一 AI 侧栏 | revert 即可（六页入口 opt-in，未注册行为零变化） |
| dljy-web#160 | 跨地区一致性矩阵用例（22 例） | 纯新增 spec＋文档，revert 即可 |
| dljy-web#161 | 总览真实电网事件摘要 | revert 即可（纯新增区块，opt-in、独立 InsightBlock） |
| dljy-web#162 | 跨模块回归与四条链路用例（收口支） | revert 即可；注意本支含同层 union 拼接修复，回退需与各同层支一起评估 |
| dljy-web#163 | 旧图表保留清单六页落位核对 | 纯 spec＋文档，revert 即可 |
| dljy-web#164 | 切片门禁记录汇编 | 纯新增文档，revert 即可 |
| （不在洞察范围）dljy-web#149 套保工作台、dljy-web#152 开发指南文档 | 非洞察六页切片 | 见各自 PR「风险与回滚」 |

## 四、文档地图

「能从业务问题追溯公式和源资料」的入口页集合。dljy-web 侧（本仓 `docs/`）：

| 文档 | 一句话索引 |
| --- | --- |
| [market-insight.md](./market-insight.md) | 域总入口：数据口径说明、云南真实性修正（#2991）记录、跨地区一致性矩阵（16.2）。 |
| [market-insight-chart-inventory.md](./market-insight-chart-inventory.md) | 旧图表 13 类能力清单与云南六页落位核对、统计一致性用例（16.8/A20）。 |
| [market-insight-common-components.md](./market-insight-common-components.md) | 公共证据组件接口、错误/空态文案对照、AI 取材纪律、阶段 A 集成检查与跨模块回归用例索引。 |
| [market-insight-prices.md](./market-insight-prices.md) | 价格页（#3007）：价格对象目录、四页签口径、多日立体、导出与材料。 |
| [market-insight-supply.md](./market-insight-supply.md) | 供需页（#3008）：分析目录与四页签口径（全景/水电/预测与实际/历史比较）。 |
| [market-insight-grid.md](./market-insight-grid.md) | 电网边界页（#3024）：三页签口径、coverage objects 消费、方向/符号纪律、检修干预页签。 |
| [market-insight-plants.md](./market-insight-plants.md) | 场站页（#3083/#3029/#3032）：五页签口径、对象语义纪律、结算页签（ST01—ST06）。 |
| [market-insight-overview.md](./market-insight-overview.md) | 总览页（#3009）：区块清单、重点事项口径、同进度比较与下钻。 |
| [market-insight-research.md](./market-insight-research.md) | 研究工作台页（#3080）：9 个预设、同类日、受控自定义、事前事后纪律。 |
| [market-insight-gate-records.md](./market-insight-gate-records.md) | 各切片 PR 门禁命令与结果汇编（16.6/16.7，dljy#3110）。 |
| market-insight-traceability.md | 本文：业务问题 → analysisId → 公式 → 源资料 → 文档/测试/PR 追溯与回滚汇总（17.3）。 |

dljy 侧（上游契约与数据面，跨仓只经 `dljy/shared/` 单向同步，勿在下游改）：

| 文档 | 一句话索引 |
| --- | --- |
| `dljy/docs/api/market-insight-contract.md` | 读模型 HTTP 契约、错误码与访问范围口径（前端经 HTTP 取数的唯一上游定义）。 |
| `dljy/docs/data/yunnan-market-insight-data-baseline.md` | 云南公开年包/获权/月包数据基线、覆盖范围与缺口台账。 |
| `dljy/docs/data/yunnan-insight-perf-baseline.md` | 洞察查询性能基线（16.4；现挂 dljy `feat/perf-budget` 分支，随其 PR 合并生效）。 |
| `dljy/docs/data/cgn-yunnan-monthpack-insight-precheck.md` | 五月月包落库预检记录（#3026 预检通道；现挂 dljy 月包接入分支）。 |

## 五、验收边界声明

1. 本表登记的是「已交付事实」（分析已登记、页面已交付、用例已进仓库、PR 已提交）；**不宣称**：持续在线供数验收（任务 17.5 / dljy#2845）、目标实例浏览器核验（dljy#3010）、16.4 性能实测等未完成项完成——这些以 verification-matrix 三栏口径的更新为准。
2. verification-matrix 中 A01—A24 与本表分析行的对应关系：本表回答「能力在哪、公式是什么、数据从哪来」；矩阵回答「证据是什么、还缺什么」。两者互链、口径一致，若冲突以矩阵（滚动更新）为准并回到本仓修本表。
3. 分析目录、来源登记如有后续变更（如 dljy 侧新增 analysisId 或来源），以 `shared/insight/analyses.mjs`、`sources.mjs` 镜像为准同步更新本表，保持「与最终实现一致」。
