# 云南结算价页：量费加权均价与默认日期（dljy#2992）

> 页面路由 `/xhjy/yunnan/settlement-price`，面板 `src/views/yunnan/panels/YunnanSettlementPricePanel.vue`。

## 背景

云南旧结算页有两个口径/体验问题（#2992）：

1. 「综合结算价」线在前端按日**跨厂等权平均**（`settlementClient.ts` 的 `meanOrNull`），周/月再对日值等权。等权会失真：甲厂 10 MWh/1000 元（100 元/MWh）、乙厂 30 MWh/6000 元（200 元/MWh），等权显示 150，量费加权正确值是 7000/40 = **175**。
2. 默认日期写死 2026-05，单日选区还会被强制拉回五月，且页面未说明是历史资料。

## 综合结算均价：只认服务端量费加权

- 数据来自服务端结算统计 `POST /api/v1/review/analysis/settlement`（契约由 dljy PR #2998 提供，**需后端先合并**），前端封装 `src/services/review/settlementAnalysis.ts` 的 `fetchSettlementAnalysis`，取数逻辑在 `src/services/market/yunnanSettlementAnalysis.ts`。
- 服务端口径：**成对有效记录 Σ电费 / Σ电量**（电量加权）。按日用 `current.daily[].averagePrice`；按周/月传 `granularity: 'week' | 'month'`，用 `current.buckets[].averagePrice`（`key` 为 ISO 周一日期 / `YYYY-MM`，与前端分组键一致，直接对齐图 x 轴）。无成对记录的桶该值为 `null`（不是 0），图表缺测断开（`connectNulls: false`）。
- 请求参数：`range: { start, end }`（与旧 `period` 二选一）；全部厂站不传 `plants`，单厂传 `[厂名]`；地区固定 `yunnan`；公司取 `companyContext` 的 `selectedCompanyId`（请求头带 `x-company-id` / `x-region-id`）。
- **前端不实现第二套加权公式**（红线）：服务端失败/无权（403/404/503/400）时展示 `结算统计不可用：<服务端中文原因>`，绝不回退到等权平均。
- 竞态防护：独立代次守卫 `weightedSeq` + `AbortController`；切日期/厂站/聚合粒度/公司时旧响应丢弃、旧请求取消。
- 公司切换联动：`watch(selectedCompanyId)` 重取（结算统计按公司授权隔离）。

## 样站等权线的命名

日前/实时/中长期三条线没有可加权的费用口径，仍是前端按厂等权（`settlementClient.ts`）：

| 场景 | 展示名 | 说明 |
| --- | --- | --- |
| 全部厂站 | 样站等权日前价 / 样站等权实时价 / 样站等权中长期价(参照) | 图例旁注明「按厂站等权，不是集团结算均价」 |
| 单厂 | 日前结算价 / 实时结算价 / 中长期电价(参照) | 单厂值，无跨厂平均 |
| 周/月聚合 | 同上 | 追加「（日均等权）」说明：先按日等权、再对日值等权 |

`SettlementPricePoint.avgPrice` 已改名 **`sampleAvgPrice`**（样站等权平均电价），防止任何页面把等权值当集团结算均价展示。受影响的其它消费点：

- `services/cockpitData.ts` + `SpotCockpitCore.vue`：驾驶舱 KPI「结算均价」实为跨厂等权，已改名「样站等权结算价」并在 tooltip 说明。
- `features/gridGeo/PlantBusinessAttributes.vue`：单厂单日的该厂平均电价，口径正确，仅字段跟随改名。

## 默认日期与历史资料

- 首次进入默认**北京时间「当天」**（`utils/beijingDate.todayBeijing`）；共享选中态（spotSelection store）里用户/其它面板主动选过的范围一律尊重，**不再把单日选区强制拉回五月**。store 出厂默认（写死的 2026-05-01）不被当作用户选择。
- 所选范围无已入库结算资料时显示诚实空态：「所选日期暂无已入库结算资料」，并经 `/api/real-coverage`（`fetchSettlementCoverage`，族 `yn_spot_settlement` / 集 `yn_settlement_daily`）查**实时覆盖区间**；拿到覆盖才出现「查看历史资料（起—止）」按钮，点击后范围设为覆盖区间并重拉。取不到覆盖只说暂无资料，不编造区间。
- 用户主动进入历史范围（末日早于今天）后，面板顶部显示「历史资料：YYYY-MM-DD 至 YYYY-MM-DD」。
- 节点电价快照日（峰谷水位）默认跟随范围末日，不再写死五月。

## 测试

- `src/services/market/yunnanSettlementAnalysis.spec.ts`：服务端值直通（175 不是 150）、403 失败透传且无等权回退、入参拼装（range/granularity/plants）、默认日期（固定系统时间的北京时间当天/尊重用户选区）、历史判定与覆盖跳转。
- `src/services/market/settlementClient.spec.ts`：字段改名 `sampleAvgPrice`、缺省不再内置演示月区间。
