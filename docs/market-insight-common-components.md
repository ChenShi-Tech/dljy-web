# 市场洞察公共证据组件与图表选区（dljy#2996）

本文档是市场洞察公共件（OpenSpec 任务 5.4—5.8）的使用说明：页面开发者如何用这套组件搭一个「区块 + 证据 + 图表选区 + 明细表」的标准洞察页，以及各组件守住的口径红线。契约与接口本身的定义在后端仓（`dljy/shared/insight/`，经 `npm run sync:web` 镜像到本仓 `shared/insight/`，只读），本文只讲前端消费方式。

> 相关文档：[市场洞察数据口径说明](./market-insight.md)、[市场洞察旧图表能力清单](./market-insight-chart-inventory.md)、[云南市场洞察价格与价差页](./market-insight-prices.md)。

## 模块清单

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| HTTP 客户端 | `src/services/insight/insightClient.ts` | `queryInsight` / `fetchInsightCapabilities` / `fetchInsightCoverage`；把后端信封归一成 `InsightRequestError`（status/message/details）；`assertInsightResult` 前置校验 |
| 查询上下文 | `src/composables/useInsightContext.ts` | 地区 × 公司 × 业务日期窗 × 对象 × 来源的统一状态；地址参数互转；`contextVersion` 与请求代次联动 |
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
| 文案中枢 | `src/components/insight/insightText.ts` | 错误/可用性/派生/阶段/价格对象/访问范围/字段的全部业务话术 |
| 测试夹具 | `src/components/insight/insightFixtures.ts` | 能过契约校验的最小合法结果构造，各 spec 复用 |

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
        stale?: boolean                    页面声明结果已过期（与查询键同步）：入口禁用并提示
emits:  open-candidates                    「查看可分析日期」→ 页面打开历史候选
        open-evidence                      「证据」→ 页面打开证据抽屉
        add-material                       「加入材料」→ 页面打开材料窗口
slot:   默认插槽放区块内容（图表、明细表等）；result 为 null 且无错误时插槽不渲染
```

行为要点：

- **错误优先级**：`error` 存在且 result 为 null → 错误态（文案见下表）；`error.status === 409` 且 result 仍在 → 顶部警告条「资料已更新…」，**旧内容继续显示**，换不换版本由用户点「刷新」决定，绝不静默替换。
- **来源标签**：头部按 `result.sourceRefs` 显示业务标题 + 公开/获权样式，不显示 sourceId 原文。
- **部分数据**（`runtime.availability.state === 'partial'`）：提示条说明缺的部分，内容照常显示，不把部分数据藏起来冒充空。
- **导出与材料入口**（dljy#3078）：「导出 CSV」对全量口径开放（版本绑定、文件名含业务窗口），「加入材料」emit 后由页面打开 `InsightMaterialDialog`；页面声明 `stale` 或区块处于 409 冲突（旧结果仍在）时两者禁用并提示「结果已过期，请刷新后再导出」。

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
| empty + not-onboarded | 来源里没有所选对象或尚未接入 | — |
| empty + not-published | 尚未发布 | — |
| empty + beyond-coverage | 所选日期没有已入库资料 | 提供「查看可分析日期」 |
| partial + partial-missing | 部分时段或来源缺数 | 内容照常显示 |
| partial + quality-rejected / source-disabled / upstream-failure | 质量不合格已剔除 / 来源尚未启用 / 上游故障 | 同上 |

## 上下文与地址参数（useInsightContext）

写进 URL 的键只有四个：`start` / `end`（`YYYY-MM-DD`）、`objects` / `sources`（逗号分隔、逐项 URL 编码）。其余 query 键原样保留。

- **还原**：进页面按 query 还原（刷新/分享可恢复）；逐参数校验（经共享契约 `parseInsightContext`），非法参数丢弃并提示「已忽略不合法参数：…」——宁可回默认值，不带口径不明的条件查询。
- **写回**：字段变化 `router.replace` 写回（不产生历史堆积）；浏览器后退/前进按 query 恢复状态；空集合删键。
- **默认窗口**：北京时间当日。**不自动跳到有数据的日子**（A02）。
- **地区/公司变化**：清空对象选择（对象属于原地区/公司，跨地区沿用等于串读），日期保留；`contextVersion` +1 并作废在途请求（迟到响应不写入新状态）。
- `objectIds` 不进 context，由页面放进 `filters.objectIds` 组装请求（后端按 `requiresObjects` 校验）；`toQueryContext()` 出口经契约校验，不合法直接抛中文错误。

## 图表选区规则（useInsightSelection）

图事件 → `insight-selection/v1` 语义选区，守四条：

1. **只有业务身份**：对象引用、时段（北京时间，带 `+08:00`）、来源、市场阶段、价格对象、上下文代次、结果版本引用。**绝不出现** `dataIndex` / `seriesIndex` / 像素 / 下标（契约 `POSITIONAL_KEYS` 全量拒绝）——下标会随数据更新漂移，坐标离了这张图无处解读。构建完经 `parseSelection` 全量校验。
2. **时段合并**：命中点按时段排序，起点不晚于上一段终点即合并；上限 2000 段。
3. **迟到事件守卫**：选区构建时与页面当前上下文比对（`isSelectionCurrent`：地区 / 公司 / 代次 / 结果版本），不一致直接丢弃——A→B 切换期间迟到的旧事件、B 上下文里到达的 A 事件都作废。
4. **防回环**：与上一次相同（规范化后）的选区不重复上抛；图表↔表格联动来回触发时第二跳被吞。结果更换或 `reset()` 后允许重选同一段。

对象维度值不是合法契约 id（如中文显示名）时不进 `objectRefs`，时段仍承载选区——不让整条选区被校验拒绝。多序列市场阶段/价格对象不一致时该字段置 null（不硬造单一口径）。

## 导出规则（insightCsv）

- 列为语义身份：`对象,字段,区间起,区间止,值,单位,来源`；头部注释写来源业务标题与原生粒度。
- 值为**原始字符串**（原生精度），导出层不做数值加工；缺测行写「缺测」，不写空白或 0。
- UTF-8 BOM 起（Excel 直接打开不乱码）；单元格含逗号/引号/换行按 RFC 4180 转义。
- **导出本页**导出当前行；**导出全量**必须经 `fetchAll` 重新发起不带 `page` 的查询，拿到全量口径再落 CSV——分页结果（`page.scope === 'page'`）只标「本页 x 行 / 全量 y 行」，不冒充全量。
- **区块级入口（dljy#3078 任务 15.2）**：`InsightBlock` 头部「导出 CSV」只对全量口径（`page.scope === 'all'` 且有 `resultVersion`/`readSetRef`）开放，导出同版本全量行，文件名含业务窗口；结果过期（页面声明或 409 冲突）时禁用并提示刷新。**服务端导出端点未建，当前为同版本全量前端导出**。
- **值直出，不改写单元格**（含以 `=` 开头的字符串）：精度不被前端改写优先于 Excel 公式注入前缀改写；服务端分析产物是可信输入，转义只按 RFC 4180 处理逗号/引号/换行。

## 阶段 A 集成检查

公共件自身的回归测试覆盖以下检查项；业务页面接入时按「怎么验证」逐条过一遍。

### A01 地区隔离

- **守什么**：切换地区即作废旧结果与旧选区，绝不串读他省口径。
- **怎么验证**：切地区后观察 contextVersion 递增、对象被清空、在途请求作废；图事件携带旧地区的选区被丢弃。
- **对应测试**：`useInsightContext.spec.ts`（地区变化清对象、contextVersion 递增）；`useInsightSelection.spec.ts`（regionId 不一致丢弃、contextVersion 不一致丢弃）。

### A02 默认日期与历史候选

- **守什么**：默认窗口为北京时间当日，不自动跳到「有数据的日子」；候选日期只能由用户显式选择。
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
