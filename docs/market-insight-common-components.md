# 市场洞察公共证据组件与图表选区（dljy#2996）

本文档是市场洞察公共件（OpenSpec 任务 5.4—5.8）的使用说明：页面开发者如何用这套组件搭一个「区块 + 证据 + 图表选区 + 明细表」的标准洞察页，以及各组件守住的口径红线。契约与接口本身的定义在后端仓（`dljy/shared/insight/`，经 `npm run sync:web` 镜像到本仓 `shared/insight/`，只读），本文只讲前端消费方式。

> 相关文档：[市场洞察数据口径说明](./market-insight.md)、[市场洞察旧图表能力清单](./market-insight-chart-inventory.md)、[云南市场洞察价格与价差页](./market-insight-prices.md)。

## 模块清单

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| HTTP 客户端 | `src/services/insight/insightClient.ts` | `queryInsight` / `fetchInsightCapabilities` / `fetchInsightCoverage`；把后端信封归一成 `InsightRequestError`（status/message/details）；`assertInsightResult` 前置校验 |
| AI 上下文客户端 | `src/services/insight/insightAiContextClient.ts` | `assembleInsightAiContext`：调 `POST /api/v1/insight-ai-context/assemble`（dljy#3097 约束层）组装四段纪律信封；出参形状自检 |
| 查询上下文 | `src/composables/useInsightContext.ts` | 地区 × 公司 × 业务日期窗 × 对象 × 来源的统一状态；地址参数互转；`contextVersion` 与请求代次联动 |
| 下钻上下文 | `src/services/region/insightHandoff.ts` | 页面间下钻的统一可校验 URL 编解码（共享四键 + `hx_` 扩展键）、超长丢弃清单与返回状态（dljy#3087） |
| 区块容器 | `src/components/insight/InsightBlock.vue` | 结果/错误/空态/部分数据的统一外壳，来源标签与证据/导出/材料入口 |
| 证据抽屉 | `src/components/insight/InsightEvidenceDrawer.vue` | 逐来源证据行 + 序列覆盖明细（期望/有效/缺失/冲突时段） |
| 历史候选 | `src/components/insight/InsightHistoryCandidates.vue` | 「查看可分析日期」：按来源覆盖求完整日期候选，用户显式选择 |
| 对象选择 | `src/components/insight/InsightObjectPicker.vue` | 多选分析对象，`maxObjects` 上限与「请先选择」引导 |
| 日期窗 | `src/components/insight/InsightDateRange.vue` | 业务日期区间选择，`maxDays` 超限不自动截断 |
| 图表容器 | `src/components/insight/chart/InsightSeriesChart.vue` | 结果 → 按单位分组的若干图；点击/框选 → 语义选区 `select` 事件 |
| 图表内核 | `src/components/insight/chart/useInsightSeriesChart.ts` | 结果长表 → ECharts option 的纯转换（阶梯线、缺测断开、单位分轴） |
| 选区构建 | `src/components/insight/chart/useInsightSelection.ts` | 图事件命中 → `insight-selection/v1` 语义选区（校验、合并、迟到守卫、防回环） |
| 明细表 | `src/components/insight/InsightResultTable.vue` | 语义列明细表、本页/全量标注、选区联动高亮、CSV 导出 |
| CSV 口径 | `src/components/insight/insightCsv.ts` | `buildInsightCsv` / `downloadInsightCsv`（本页与全量导出共用） |
| 材料窗口 | `src/components/insight/InsightMaterialDialog.vue` | 洞察区块 → 复盘底稿材料：选择既有底稿、冻结保存（409 先重跑）、入稿 |
| 空间查阅深链 | `src/features/regions/yunnan/insight/spatialLinks.ts` | 洞察页「在空间视图查看」→ 既有 grid-geo 空间场景：目标登记、query 白名单、权限显隐与出口双保险（dljy#3106） |
| 文案中枢 | `src/components/insight/insightText.ts` | 错误/可用性/派生/阶段/价格对象/访问范围/字段的全部业务话术 |
| 测试夹具 | `src/components/insight/insightFixtures.ts` | 能过契约校验的最小合法结果构造，各 spec 复用 |
| AI 侧栏注册 | `src/features/regions/yunnan/insight/useInsightAiPage.ts` | 六页统一 AI 解读注册与取材纪律（任务 15.3）；签名纪律 `insightAiBlockOf` 也在此 |

## 组件接口

### InsightBlock（区块容器）

```
props:  title: string                      区块标题
        result: InsightBlockResult | null  规范结果（null = 尚未查询）
        error: InsightRequestError | null  请求错误，与 result 可同时出现（409 冲突）
        loading?: boolean
        onRetry?: () => void               「重试」回调（503/网络/参数类）
        onRefresh?: () => void             「刷新」回调（409 版本冲突取新版本）
        sourceTitles?: Record<string, InsightSourceTitle>   来自 capabilities.sources
        exportable?: boolean               头部「导出 CSV」开关（仅全量口径 page.scope==='all' 实际可导）
        materializable?: boolean           头部「加入材料」开关（页面按公司写权限决定显隐）
        maintenance?: boolean              空态「前往资料维护」开关（页面按 governance 判定资料维护权限；
                                           仅空态原因为 未接入/超覆盖 时出现）
        stale?: boolean                    页面声明结果已过期（与查询键同步）：入口禁用并提示
emits:  open-candidates                    「查看可分析日期」→ 页面打开历史候选
        open-evidence                      「证据」→ 页面打开证据抽屉
        add-material                       「加入材料」→ 页面打开材料窗口
        open-maintenance                   「前往资料维护」→ 页面跳转上传中心（dljy#3096）
slot:   默认插槽放区块内容（图表、明细表等）；result 为 null 且无错误时插槽不渲染
```

行为要点：

- **错误优先级**：`error` 存在且 result 为 null → 错误态（文案见下表）；`error.status === 409` 且 result 仍在 → 顶部警告条「资料已更新…」，**旧内容继续显示**，换不换版本由用户点「刷新」决定，绝不静默替换。
- **来源标签**：头部按 `result.sourceRefs` 显示业务标题 + 公开/获权样式，不显示 sourceId 原文。
- **部分数据**（`runtime.availability.state === 'partial'`）：提示条说明缺的部分，内容照常显示，不把部分数据藏起来冒充空。
- **导出与材料入口**（dljy#3078）：「导出 CSV」对全量口径开放（版本绑定、文件名含业务窗口），「加入材料」emit 后由页面打开 `InsightMaterialDialog`；页面声明 `stale` 或区块处于 409 冲突（旧结果仍在）时两者禁用并提示「结果已过期，请刷新后再导出」。
- **维护入口**（dljy#3096）：只在空态出现，原因为「未接入 / 超覆盖」（补录资料能解决的缺口）；部分缺数不引导维护，其余空态（未发布、不适用等）引导维护是误导。

### InsightEvidenceDrawer（证据抽屉）

```
props:  modelValue: boolean                v-model 开关
        result: InsightBlockResult | null
        sourceTitles?: Record<string, InsightSourceTitle>
emits:  update:modelValue
slot:   默认插槽（可选）：页面级补充说明，如「该视图与明细来自同一份读取」（dljy#3007
        价格页按 readSetRef 相等时显示）；不传不影响现有用法
```

字段口径：

| 展示字段 | 来源 | 说明 |
| --- | --- | --- |
| 来源标题 / 访问范围 | `sourceRefs` + `insightSourceTitle` | 业务标题；「公开」/「获权」 |
| 版本短码 | `sourceRefs[].versionToken` | `shortRef` 取前 12 位（对得上后端日志即可） |
| 有效时段数 | `coverage[sourceId].series[].validSlots` 求和 | 后端不下发「读取行数」，用覆盖序列的有效时段数表达同一口径 |
| 期望/有效/缺失/冲突时段 | `coverage` 逐序列明细 | 缺测与冲突分开列，不合并成一个「问题数」 |
| 派生程度 | `derivation` | 原样 / 仅对齐 / 汇总 / 计算（`DERIVATION_TEXT`） |

### InsightHistoryCandidates（历史候选）

```
props:  modelValue: boolean                v-model 开关
        analysisId: string                 分析标识（决定求交集的来源集）
        context: InsightContextInput       当前地区/公司上下文
        filters?: Record<string, unknown>  与主查询一致的过滤条件
        requiredSourceIds?: string[]       只按这些来源求交集；缺省按分析全部来源
        sourceTitles?: Record<string, InsightSourceTitle>
emits:  update:modelValue
        select: [{ start, end }]           用户点击候选日期（单日或区段）
```

行为要点：打开才发 `fetchInsightCoverage` 请求（挂载不请求）；关闭即 abort 在途请求；候选只经用户点击生效——**页面不得自动跳到「有数据的日子」**（A02）。离散日期窗显示「所选日期不连续」提示；某来源从未覆盖时如实显示「来源尚未启用，无完整日期」。

### InsightObjectPicker / InsightDateRange

```
InsightObjectPicker   props: modelValue: string[]（对象 id 数组）；options: InsightObjectOption[]
                      maxObjects?: number（analysis.limits.maxObjects）
                      requiresObjects?: boolean（未选对象时占位提示「请先选择节点或场站」）
                      remote?: boolean（远程检索模式，dljy#3007 价格页节点搜索）
                      remoteMethod?: (query: string) => void（输入触发；结果由页面写回 options）
                      remoteLoading?: boolean（检索进行中 → el-select loading 态）
                      emits: update:modelValue

InsightDateRange      props: modelValue: { start, end }（业务日 YYYY-MM-DD）
                      maxDays?: number（analysis.limits.maxDays；缺省 366）
                      emits: update:modelValue
```

远程模式下本组件不持检索状态：检索回调、失败重试、选项写回都由页面负责（组件只透传 el-select 的 remote 能力）。

日期窗超限时提示「单次分析最多 N 天，当前 M 天；请缩小范围（未自动截断）」，维持原窗口——不静默截断用户的选择。

### InsightSeriesChart（图表容器）

```
props:  result: InsightBlockResult | null
        current: { regionId, companyId, contextVersion }   页面当前上下文（useInsightContext）
        height?: string | number
emits:  select: [selection: InsightSelection | null]       null = 清除选区
expose: applySelection(selection | null)                   外部（表格行点击等）回写高亮
```

内部：结果按单位分组（一张图最多两种单位、每种单位一根 y 轴），每组一个 `InsightChartPane`（内部组件，页面不直接用）。点击一个点或框选一片 → 经 `useInsightSelection` 构建语义选区上抛；清除框选 → 上抛 null。空结果不画空坐标轴，显示「暂无可绘制的序列」。

序列名经 `insightText` 的 `fieldText` 拼业务名：价差 / 基差等视图合成序列没有来源字段，其字段名同样在 `FIELD_TEXT` 登记（`spread` = 「日前−实时价差」、`basis` = 「节点基差」，dljy#3007 价格页）。

### InsightResultTable（明细表）

```
props:  result: InsightBlockResult | null
        fetchAll?: () => Promise<InsightBlockResult | null>   导出全量用（不带 page 重查）
        selection?: InsightSelection | null                   图表选区联动高亮；null 清除
        sourceTitles?: Record<string, InsightSourceTitle>
emits:  row-click: [{ series: InsightSeriesMeta, row: 原始行 }]  点击行只上抛，页面决定是否转选区
```

### InsightMaterialDialog（材料窗口，dljy#3078 任务 14.5）

```
props:  modelValue: boolean                     v-model 开关
        region / companyId: string              复盘材料的公司与地区范围
        subject: string                         区块业务标题（提示与成功文案）
        request: { analysisId; context; filters? } | null
                                               冻结请求（context 不含 contextVersion，保证幂等键稳定）
        result: InsightBlockResult | null       期望版本（resultVersion/readSetRef）与业务窗口来源
emits:  update:modelValue / saved               saved 仅在冻结并入稿成功（含幂等命中）时发出
```

行为要点：

- **两步复用既有协议**：冻结 `POST /api/v1/review/evidence`（`kind: 'market_insight'`，dljy#3020）+ 入稿（底稿 GET + PATCH）。请求只带登记分析、上下文、筛选与期望版本，服务端重算核验并冻结。
- **冲突语义**：源更新 409 →「资料已更新，请先重新运行再保存」；底稿刚被他人保存（PATCH 409）→ 如实说明材料已冻结但未加入，不称已保存。未成功绝不提示成功。
- **幂等**：幂等键按业务内容派生（`idempotencyKeyOf`），重复保存返回同一份材料；材料已在所选底稿中时提示「未重复创建」。
- **权限**：底稿只允许主笔修改（`canEdit`），非主笔不发起冻结；入口显隐由页面按 `governance.hasCompanyAdmin` 决定。
- **材料用途**：窗口覆盖复盘对象且日期窗在底稿周期内为「本次依据」，否则「比较依据」（与服务端 `validateMaterialReferences` 同口径）。

## 错误与空态文案对照表（insightErrorCopy / availabilityReasonText）

界面只出现左列业务话术；改 `insightText.ts` 要同步本表。

| 触发条件 | 文案 | 动作 |
| --- | --- | --- |
| 403 FORBIDDEN | 当前公司没有这类资料的查看权限 | 无（不透露资料是否存在） |
| 409 VERSION_CONFLICT | 资料已更新，当前看到的不是最新版本 | 「刷新」（用户决定换版本） |
| 404 | 该地区暂未开通这项分析 | 无 |
| 400 / 422 | 后端 message（范围过大、需先选对象等） | 「重试」 |
| 503 / 网络失败 / 未知 | 资料读取失败 | 「重试」 |
| availability: empty + not-enabled | 功能未开通 | — |
| empty + not-applicable | 该地区不适用 | — |
| empty + not-onboarded | 来源里没有所选对象或尚未接入 | 「查看可分析日期」；有资料维护权限时另有「前往资料维护」（见下节） |
| empty + not-published | 尚未发布 | — |
| empty + beyond-coverage | 所选日期没有已入库资料 | 「查看可分析日期」；有资料维护权限时另有「前往资料维护」（见下节） |
| partial + partial-missing | 部分时段或来源缺数 | 内容照常显示 |
| partial + quality-rejected / source-disabled / upstream-failure | 质量不合格已剔除 / 来源尚未启用 / 上游故障 | 同上 |

## 上下文与地址参数（useInsightContext）

写进 URL 的键只有四个：`start` / `end`（`YYYY-MM-DD`）、`objects` / `sources`（逗号分隔、逐项 URL 编码）。其余 query 键原样保留。

- **还原**：进页面按 query 还原（刷新/分享可恢复）；逐参数校验（经共享契约 `parseInsightContext`），非法参数丢弃并提示「已忽略不合法参数：…」——宁可回默认值，不带口径不明的条件查询。
- **写回**：字段变化 `router.replace` 写回（不产生历史堆积）；浏览器后退/前进按 query 恢复状态；空集合删键。
- **默认窗口**：北京时间当日。**不自动跳到有数据的日子**（A02）。
- **地区/公司变化**：清空对象选择（对象属于原地区/公司，跨地区沿用等于串读），日期保留；`contextVersion` +1 并作废在途请求（迟到响应不写入新状态）。
- `objectIds` 不进 context，由页面放进 `filters.objectIds` 组装请求（后端按 `requiresObjects` 校验）；`toQueryContext()` 出口经契约校验，不合法直接抛中文错误。

## 下钻上下文与返回状态（insightHandoff，dljy#3087 任务 15.1）

洞察页面之间下钻（总览 → 价格/供需等）不再各写一套 `{ start, end }`，统一经 `src/services/region/insightHandoff.ts` 编解码（OpenSpec `insight-context-handoff` CH01：日期/来源/对象/时段一致；A15：不支持字段明确提示）。纯函数、零 Vue 依赖，规格上是 `shared/insight/handoff.mjs` 交接契约（D11.1）的 URL 承载层。

```
buildInsightDrilldownQuery(payload) -> { query, dropped }   // payload: { start, end, objects?, sources?, priceObject?, marketPhase?, view?, from? }
parseInsightDrilldownQuery(query)   -> { payload, ignored } // 逐字段校验；非法/不支持字段进 ignored
returnStateOf(payload)              -> { pageId, path, query } | null  // from 页 + 可恢复四键上下文
hasInsightDrilldownParams(query)    -> boolean              // URL 是否带 hx_ 下钻参数
```

**编码规则（键命名空间设计决策）**：

- 共享四键 `start` / `end` / `objects` / `sources` 直写——业务窗与对象/来源是「四键还原层」与「下钻层」的共同语义，同一信息只写一处，目标页既有的 `useInsightContext` 四键还原免费生效；**下钻参数与四键同名时以四键语义为准**：下钻层不另造 `hx_start` / `hx_objects` 等重复键，解析遇到这类键一律丢弃并提示。
- 扩展字段带 `hx_` 前缀（handoff）：`hx_priceObject` / `hx_marketPhase` / `hx_view` / `hx_from`，camelCase 对应 D11.1 契约字段名；`from` 是发起页 pageId（返回锚点）。未登记的 `hx_*` 键进 ignored 提示（CH06：不静默忽略影响口径的未知字段）；非 `hx_` 的其他 query 键（页签、分页等）不归本层管。
- 对象/来源逐项 `encodeURIComponent` 后逗号连接（与四键同规则）；**原始数据数组、行数据一律不进 URL**——列表只是可验证 ID 串，值中不出现 `[`（D3/D11.1 红线）。
- **超长丢弃策略**：序列化估长（URLSearchParams 口径，对已编码值偏保守）超过 1800 字符时，按业务影响从小到大丢弃可选字段 `view → marketPhase → priceObject → objects → sources`，被丢弃字段名进 `dropped` 清单返回给调用方，**不静默截断**；窗口与 `from` 是必需字段不参与丢弃。构造期非法输入（坏窗口、坏对象、未登记 view/from）直接抛契约错误，不写进 URL。

**解析校验（目标页，A15）**：窗口与四键同规则（成对且经共享契约 `parseInsightContext` 校验；对象/来源逐项过契约，任一项非法整参数丢弃，不悄悄缩窄选区）；`hx_` 扩展字段逐字段校验逐字段丢弃（`view` 必须是已登记页签枚举，数据驱动自 `shared/insight/analyses.mjs` 的 views 联集）。所有被丢弃字段汇总进 `ignored`，「不支持字段明确提示」，其余字段照常还原。

**恢复入口（useInsightContext 可选能力）**：进页面时若 URL 带 `hx_` 参数，`useInsightContext` 自动解析——共享四键已由既有四键还原覆盖（同规则、四键语义为准），`hx_` 扩展字段暴露在 `ctx.drilldownRestore`（`{ from, view, priceObject, marketPhase }`）由目标页按需落状态；`ignored` 与四键解析合并成同一条「已忽略不合法参数」一次性提示（复用 ignoredParamsNotice 模式）。URL 不带 `hx_` 参数时行为与既有完全一致。

**返回状态**：`returnStateOf` 从解析出的 payload 取 `from` 页与共享四键上下文，供目标页「返回」恢复发起页筛选（CH01 返回闭环）；`view` / `priceObject` / `marketPhase` 是目标页视角的口径，不带回发起页。`from` 缺失或未登记返回 `null`——没有可验证的返回位置就不显示返回入口，不猜。

**当前接线范围**：总览页 `YunnanOverviewPage.vue` 的 `drilldown()` 已改用 `buildInsightDrilldownQuery`（带 `from: 'overview'`，并随窗口携带对象/来源）；价格/供需页签名不变。目标页消费 `drilldownRestore.view/priceObject` 激活页签随对应页面切片交付。

对应测试：`src/services/region/insightHandoff.spec.ts`（round-trip、命名空间、逐字段丢弃、超长 dropped、原始数组不进 URL、returnState、与 insightWorkspace 页 id 同步）；`useInsightContext.spec.ts` 下钻恢复用例；`YunnanOverviewPage.component.spec.ts` 下钻 query 形状断言。

## 图表选区规则（useInsightSelection）

图事件 → `insight-selection/v1` 语义选区，守四条：

1. **只有业务身份**：对象引用、时段（北京时间，带 `+08:00`）、来源、市场阶段、价格对象、上下文代次、结果版本引用。**绝不出现** `dataIndex` / `seriesIndex` / 像素 / 下标（契约 `POSITIONAL_KEYS` 全量拒绝）——下标会随数据更新漂移，坐标离了这张图无处解读。构建完经 `parseSelection` 全量校验。
2. **时段合并**：命中点按时段排序，起点不晚于上一段终点即合并；上限 2000 段。
3. **迟到事件守卫**：选区构建时与页面当前上下文比对（`isSelectionCurrent`：地区 / 公司 / 代次 / 结果版本），不一致直接丢弃——A→B 切换期间迟到的旧事件、B 上下文里到达的 A 事件都作废。
4. **防回环**：与上一次相同（规范化后）的选区不重复上抛；图表↔表格联动来回触发时第二跳被吞。结果更换或 `reset()` 后允许重选同一段。

对象维度值不是合法契约 id（如中文显示名）时不进 `objectRefs`，时段仍承载选区——不让整条选区被校验拒绝。多序列市场阶段/价格对象不一致时该字段置 null（不硬造单一口径）。

## 跨模块深链（spatialLinks，dljy#3106）

洞察页动作按钮跳入既有业务模块的只读页面，模式沿用 businessLinks（#3096 登记+白名单+权限+出口双保险；该登记文件在 `feat/insight-deeplink` 分支）。当前登记：**空间查阅深链** `src/features/regions/yunnan/insight/spatialLinks.ts`——design D6.1「三维地形、场站/节点空间位置：从节点/电网/场站动作进入已有空间资产，保留入口与上下文，不在洞察复制 Cesium」。入口清单：

| 来源页 | 触发条件 | 目标（既有只读路径） | query 承接 |
| --- | --- | --- | --- |
| 价格与价差「节点基差」 | 选中参考节点 | `/grid-assets/market` 电力市场空间态势 | 节点对象绑定（objectKind/objectId + 地区/公司归属）+ 窗口末日 objectDate + from |
| 场站市场表现「组合总览」 | 选中单场站 | `/grid-assets/market` 电力市场空间态势 | 场站对象绑定 + objectDate + from |
| 跨省与电网边界「通道断面」 | 选中单个通道/断面 | `/grid-assets/disclosures` 公开披露空间层 | 通道/断面无 grid-geo 对象类型，以披露检索词 keyword + objectDate 承接（不伪造对象绑定） |

红线（与 businessLinks 一致）：query 白名单只有对象上下文键 / keyword / from，值均为非空标量字符串——对象名数组、时段序列与可写动词不进 URL；入口显隐走 `governance.canAccessPath` 既有口径，无权限、多对象选中或公司未选时不渲染；`openSpatialViewLink` 出口再校验一遍（不合法不 push）。

## 导出规则（insightCsv）

- 列为语义身份：`对象,字段,区间起,区间止,值,单位,来源`；头部注释写来源业务标题与原生粒度。
- 值为**原始字符串**（原生精度），导出层不做数值加工；缺测行写「缺测」，不写空白或 0。
- UTF-8 BOM 起（Excel 直接打开不乱码）；单元格含逗号/引号/换行按 RFC 4180 转义。
- **导出本页**导出当前行；**导出全量**必须经 `fetchAll` 重新发起不带 `page` 的查询，拿到全量口径再落 CSV——分页结果（`page.scope === 'page'`）只标「本页 x 行 / 全量 y 行」，不冒充全量。
- **区块级入口（dljy#3078 任务 15.2）**：`InsightBlock` 头部「导出 CSV」只对全量口径（`page.scope === 'all'` 且有 `resultVersion`/`readSetRef`）开放，导出同版本全量行，文件名含业务窗口；结果过期（页面声明或 409 冲突）时禁用并提示刷新。**服务端导出端点未建，当前为同版本全量前端导出**。
- **值直出，不改写单元格**（含以 `=` 开头的字符串）：精度不被前端改写优先于 Excel 公式注入前缀改写；服务端分析产物是可信输入，转义只按 RFC 4180 处理逗号/引号/换行。

## 业务模块深链（dljy#3096，OpenSpec 任务 15.5）

洞察接已有交易、中长期、结算业务模块与资料维护的**只读深链**：进入只传证据（期间/对象名）与授权入口，不自动创建/提交交易，不更改合同/电费，不增加无权限操作（design D11 表、insight-context-handoff CH04、yunnan-plant-market-performance PP07）。登记与出口集中在 `src/features/regions/yunnan/insight/businessLinks.ts`。

### 入口清单

| 页面 × 位置 | 入口 | 目标路由 | 权限判定（governance 既有口径） |
| --- | --- | --- | --- |
| 场站页 · 结算页签区块头部 | 前往结算业务 | `/xhjy/review`（复盘中心：结算复盘、日报核验） | `canAccessPath('/xhjy/review')`，无权限不渲染 |
| 场站页 · 申报出清实际页签（语义对照含「中长期电量（合同口径引用）」列时） | 前往中长期模块 | `/zcqjy/positions`（月度持仓，只读台账） | `canAccessPath('/zcqjy/positions')`，无权限不渲染 |
| 场站页/价格页 · 区块空态（原因为 未接入/超覆盖） | 前往资料维护 | `/data-ops/console?panel=upload`（上传中心） | `canAccessPath('/data-ops/console')`（数据运维岗既有权限），无权限不渲染 |

### 只读红线

- **query 白名单**：只允许 `start` / `end`（期间）、`object`（单个对象名）、`from`（来源标记 `insight-plants` / `insight-prices`）、`panel`（仅资料维护跳转的 `upload`）。原始数据数组、嵌套对象与白名单外键一律不进 URL（CH05）。
- **无写动作**：深链键与值不允许出现 `submit` / `create` / `confirm` / `approve` 等可写动词；跳转目标是既有业务模块的只读页面路径，不是任何写端点。目标模块二次鉴权，洞察不代其执行操作。
- **显隐在页面**：入口按 `canFollowDeepLink(目标路径)`（即 `governance.canAccessPath` + 当前登录用户）决定渲染与否——无权限不渲染，而不是渲染后再靠目标页拦截；读取用户失败按无权限处理。跳转出口 `openBusinessDeepLink` 再做一次白名单与动词双保险，不合法直接不动。

### 返回重查语义

- 深链跳转带 `from` 标记；从业务页返回（浏览器后退/地址恢复）后，页面依赖既有 `useInsightContext` 机制：route query 恢复 → 签名变化 → `contextVersion` +1 → 全部区块状态作废并重查（含覆盖清单）。
- **返回不视为已补齐**：资料维护成功与否以返回后重新查询 coverage 的结果为准，离开页面本身不改变任何覆盖状态（PP07）。

### 测试位置

- `src/features/regions/yunnan/insight/businessLinks.component.spec.ts`：query 白名单/无原始数据数组/无可写动词/目标只读路径/双保险出口。
- `src/features/regions/yunnan/insight/pages/YunnanPlantsPage.component.spec.ts`、`YunnanPricesPage.component.spec.ts` 的「业务模块只读深链」用例：入口显隐 × 权限、跳转参数、返回重查、业务语言扫描。
## AI 取材纪律（useInsightAiPage，dljy#3100 任务 15.3）

六页（总览/价格/供需/电网边界/场站/研究工作台）经统一 AI 侧栏协议（`defineAiPage`）注册「解读本页」；
点击时采集当前有效证据切片，先交 `POST /api/v1/insight-ai-context/assemble`（dljy#3097 约束层）
组装为四段纪律信封（事实→可能因素→已明确相关对象→待核实项；事实必须带 evidenceRefs；来源缺失
与过期随上下文显式传入），成功才随问题派发。规则：

1. **签名纪律**：`insightAiBlockOf` 只收「当前签名一致」的结果——`queriedKey !== currentKey`
   的过期区块返回 null，绝不进上下文（切页/切公司/keep-alive 后不提交旧资料的机械落点）；
   无权（denied）区块整块退出，不泄露私有资料存在性。
2. **只传摘要与版本引用**：区块带 analysisId、view、业务窗、`resultVersion`/`readSetRef`、
   access/availability/freshness 六维、序列目录（来源/字段/单位/粒度）与筛选摘要；
   **绝不传原始行数据数组**——payload 体积不随结果行数增长（测试断言）。
3. **组装失败诚实报错**：/assemble 单次尝试、不自动重试；失败 `ElMessage.error` 原因原文，
   本次解读不发起；无已就绪结果时提示先等查询完成，不拿空切片冒充解读。
4. **组装期间守卫**：/assemble 往返期间上下文签名变化（切公司/改窗）或页面失活/卸载，
   本次解读作废——信封属于点击时刻的旧读取，不带旧资料派发。
5. **未就绪纪律（D9）**：模型离线（`useAgentHealth` 探活 offline）只隐藏 AI 入口按钮；
   数据页查询、分析、保存、导出完整工作，不依赖模型。探活 unknown（未返回）视为可用。
6. **派发上下文双件套**：证据正文在 `blocks`（约束信封的注册表只含 id 与元数据），
   纪律面在 `insight_ai_context`（四段契约、反例纪律、渲染提示词）；两者随同一轮下发。



## 跨模块回归与链路用例（dljy#3104，任务 15.6/15.8）

两条组件/集成级用例链把上述能力串成链路回归（服务层打桩，不改产品代码），守 design D11.2 的
扩展性验收——「能消费，也能拒绝」：

- `src/features/regions/yunnan/insight/crossModuleRegression.spec.ts`（15.6，验收 A14）：
  模型探活 offline 与 /assemble 503/网络失败下，AI 入口诚实不可用、不派发、无重试风暴；
  同刻数据查询、同版本 CSV 导出与材料保存照常（模型不是数据页依赖）。专题服务不可用
  （冻结 503/底稿列表 500）在材料窗口诚实报服务端原因、未保存绝不提示成功、分析页不受影响。
  私有撤权（切公司签名过期 / denied / 保存 403 / 查询 403）：旧证据不进 AI 上下文（签名纪律
  + denied 整块退出，不泄露私有块存在性）、403/409 按原语义上抛或透传，不吞成空图。

- `src/features/regions/yunnan/insight/handoffLinks.spec.ts`（15.8，验收 A18/A19）四条链路：
  ① 选区→AI：图表选区构建语义选区（版本三元组/来源一致、北京时间时段、无位置键）→ 同一
  证据与签名经 insightAiBlockOf 采集（AI 证据=选区）→ 切公司后旧选区 build=null、旧签名
  采集=null；带 from 的下钻可还原发起页位置。
  ② 对象深链往返：businessDeepLinkQuery 只含白名单键、无原始数组、无可写动词；出口双保险
  （非法 query 直接不动）；入口显隐按 governance 既有口径（读取用户失败=无权限）；返回后
  共享四键还原、coverage 按返回窗口重查、资料维护带 panel。
  ③ 材料保存链：同版本保存带期望版本+幂等键 → 幂等命中「未重复创建」不二次入稿 → 源更新
  409 诚实报错 → 重跑（新结果版本）后再保存，期望版本与幂等键随之更新。
  ④ 下钻编码往返：build/parse round-trip 在六页 pageId 逐一成立、返回状态可恢复；未知 hx_
  键与命名空间重复键进 ignored 提示；超长按 view→marketPhase→priceObject→objects→sources
  顺序丢弃并给 dropped 清单（窗口与 from 必需不丢）；非法对象 build 抛契约错误、parse 整参
  丢弃（能拒绝，不静默缩窄）。

## 阶段 A 集成检查

公共件自身的回归测试覆盖以下检查项；业务页面接入时按「怎么验证」逐条过一遍。

### A01 地区隔离

- **守什么**：切换地区即作废旧结果与旧选区，绝不串读他省口径。
- **怎么验证**：切地区后观察 contextVersion 递增、对象被清空、在途请求作废；图事件携带旧地区的选区被丢弃。
- **对应测试**：`useInsightContext.spec.ts`（地区变化清对象、contextVersion 递增）；`useInsightSelection.spec.ts`（regionId 不一致丢弃、contextVersion 不一致丢弃）。

### A02 默认日期与历史候选

- **守什么**：默认窗口为北京时间当日，本层不自动跳日；入口锚定（dljy#3134）在无窗口参数进入时把默认落点锚到最新有数据日并给提示与「切回今天」，候选日期面板仍只能由用户显式选择。
- **怎么验证**：空库日期进页面显示 beyond-coverage 空态 + 「查看可分析日期」入口，日期不变；候选面板打开才请求、点候选才写窗口。
- **对应测试**：`useInsightContext.spec.ts`（默认当日）；`InsightBlock.component.spec.ts`（beyond-coverage 候选入口 emit）；`InsightHistoryCandidates.component.spec.ts`（挂载不请求、点击才 emit）。

### A03 真实性

- **守什么**：partial / empty 如实说明，不藏部分数据、不冒充全量；真实零与缺测分开（`0` 显示 0，缺测显示「—」、图上断开、CSV 写「缺测」）。
- **怎么验证**：构造 partial 结果看提示条与内容同时出现；值列空串/null 显示「—」而非 0。
- **对应测试**：`InsightBlock.component.spec.ts`（partial 提示）；`InsightResultTable.component.spec.ts`（缺测「—」、CSV「缺测」）；`useInsightSeriesChart.spec.ts`（缺测插 null 断开）。

### A04 时间与粒度

- **守什么**：区间值画阶梯线（`step:'end'`，值是 `[start, end)` 整段口径、起点标注；连续段末尾补区间终点的边界点，边界点不进提示、不参与选区）；缺测断开（`connectNulls:false`、`smooth:false`）；同单位共轴、不同单位各成一轴，一张图最多两根轴。
- **怎么验证**：看 option 断言或目视阶梯形状；价格（yuan/MWh）与功率（MW）同图时各用一根 y 轴；第三种单位拆第二张图。
- **对应测试**：`useInsightSeriesChart.spec.ts`（step / connectNulls / smooth 三断言、缺测断开、价格功率两轴、三单位拆图）。

### A05 可比性

- **守什么**：不同价格对象（用户侧 / 公开节点 / 获权厂侧…）不共轴、不求和；市场阶段不同的序列分开表达。
- **怎么验证**：选区混选不同 marketPhase / priceObject 的序列时，选区该字段置 null（不硬造口径）；图表按单位分组天然分轴。
- **对应测试**：`useInsightSelection.spec.ts`（混 phase 的 unanimous 行为由 `useInsightSeriesChart` 分组测试间接覆盖）；`useInsightSeriesChart.spec.ts`（单位分组）。

### A07 权重说明

- **守什么**：均价等加权口径由后端在结果里给出（derivation 标注），前端只显示不重算——数值加工只发生在显示层 `Number()` + `toFixed`，不做任何统计。
- **怎么验证**：前端代码无加权求和逻辑；证据抽屉按 derivation 如实标注「原样/仅对齐/汇总/计算」。
- **对应测试**：`useInsightSeriesChart.spec.ts`（tooltip 按来源精度显示）；`InsightEvidenceDrawer` 的字段口径测试；红词扫描类用例保证界面与 CSV 不暴露内部词。

## 测试位置

| 测试文件 | 覆盖 |
| --- | --- |
| `src/services/insight/insightClient.spec.ts` | 成功路径、422/403/409/503 归一、abort 透传、capabilities/coverage 形状自检 |
| `src/composables/useInsightContext.spec.ts` | 地址参数还原/写回/非法丢弃、默认当日、地区/公司变化清对象、contextVersion |
| `src/components/insight/InsightBlock.component.spec.ts` | 错误态文案与动作、409 保留旧结果、partial 提示、来源标签、红词扫描 |
| `src/components/insight/InsightHistoryCandidates.component.spec.ts` | 打开才请求、点击才 emit、离散提示、无交集提示、失败重试、关闭 abort |
| `src/components/insight/chart/useInsightSeriesChart.spec.ts` | 阶梯/断开/不平滑、缺测插 null、首尾外不画点、单位分轴拆图、tooltip 口径 |
| `src/components/insight/chart/useInsightSelection.spec.ts` | 语义字段、位置键拒绝、时段合并、迟到守卫、防回环、reset |
| `src/components/insight/InsightResultTable.component.spec.ts` | 列与缺测、本页/全量标注、导出本页/全量、CSV 口径（含 RFC 4180 转义与精度直出）、选区高亮、row-click |
| `src/components/insight/InsightMaterialDialog.component.spec.ts` | 底稿列表失败、冻结请求期望版本与幂等键、非主笔不冻结、成功入稿、幂等不重复入稿、409 先重跑、入稿冲突如实说明（dljy#3078） |
| `src/features/regions/yunnan/insight/useInsightAiPage.component.spec.ts` | 签名纪律（过期/无权/空结果不进上下文）、payload 无原始行、注册 KeepAlive 生命周期、/assemble 组装派发与失败诚实报错（dljy#3100） |
| 六页 `*.component.spec.ts` 内「AI 解读注册（15.3）」用例 | 每页注册声明、入口按钮、当前签名采集、上下文变化后不采集旧资料 |
| `src/features/regions/yunnan/insight/crossModuleRegression.spec.ts` | 15.6 跨模块回归：模型离线/组装失败/专题不可用/撤权四类故障下「AI 诚实不可用、查询导出保存照常、错误不伪装成功」（A14） |
| `src/features/regions/yunnan/insight/handoffLinks.spec.ts` | 15.8 四条链路：选区→AI、对象深链往返、材料保存幂等与 409 重跑、下钻编码六页往返与未知字段丢弃提示（A18/A19） |

## 口径说明与总览来源收纳（dljy#3135）

`InsightNote.vue` 用原生 details/summary 收纳次要静态口径，支持键盘和焦点提示。不要把错误、缺测、无权、历史模式或运行资格放入默认收起区。

`InsightBlock.compactSources` 仅在总览启用：来源摘要保留数量与公开/含获权标识，展开查看原始业务标题；证据按钮始终独立，状态处理与默认的其他页面不变。
