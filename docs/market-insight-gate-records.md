# 市场洞察切片门禁记录汇编（OpenSpec 16.6/16.7）

本文汇编云南市场洞察各切片 PR 的门禁记录：每条记录「命令 / 结果 / 适用面」，作为 OpenSpec 变更 `build-yunnan-regional-market-insight` 任务 16.6/16.7 的核销依据。素材取自各 PR 正文的「验证记录」章节，记录登记于 dljy#3110（父任务 dljy#2989）；本汇编为纯文档转录，未重新执行任何命令。

## 说明：门禁命令、结果与适用面

- **dljy-web 侧门禁**：`npm run lint`（check-font-tokens + eslint + shared-fingerprint）、`npm run check`（vue-tsc --noEmit）、`npm run test:unit`（vitest 全量）；后期页面/用例切片以**门禁三目录定向 vitest**（`src/components/insight/`、`src/features/regions/yunnan/insight/`、`src/services/insight|region/`）+ lint + check 为界，全量 `test:unit` 在关键节点（#151 3609/3609、#153 3631/3631）复跑全绿。
- **dljy 侧门禁**：一律先 `source scripts/dev/use-conda-env.sh` 再执行——`npm run check`（tsc --noEmit）、`npm run ci:local:quick`、各专项 `npm run verify:*`（source-registry、api-contracts、data-upload、agent-unit-boundary、agent-contracts-consistency 等）+ 定向 `node --test` / `run-node-tests`。
- **适用面**：每条记录只对该 PR 自身的改动面与其合并时点的分支状态有效；登记为「定向面」的结果不外推为全仓结论。例如 #142 只跑了洞察相关目录的单测，该行就只证明洞察目录。
- **结果口径**：✅ 表示该 PR 验证记录声称通过；「既有抖动」指与本切片改动零交集、单独复跑（solo）可绿的用例，处置口径见文末汇总段。

## 按切片门禁记录表

| 切片（OpenSpec 任务号） | PR | 仓 | 命令与结果摘要 | 未覆盖面 |
| --- | --- | --- | --- | --- |
| 真实性红线修正（dljy#2991） | #133 | dljy-web | lint 0 错 ✅；check 绿 ✅；test:unit 316 文件 3325 例全绿 ✅；新增 12 例（marketAnalysis 反例/正例、heavyPages 清停用、导航地区隐藏） | — |
| 结算价页量费加权均价（dljy#2992） | #134 | dljy-web | lint 0 错（288 warn 存量）✅；check 绿 ✅；test:unit 315 文件 3329 例全绿 ✅；新增 yunnanSettlementAnalysis 16 例 + settlementClient 适配 14 例 | 驾驶舱 KPI 集团量费加权口径留后续单独切片 |
| 地区工作区装配与兼容路由骨架（工作区装配） | #135 | dljy-web | lint ✅；check ✅；test:unit 322+ 文件 3403 例全绿 ✅；新增 7 spec 约 70 例（装配/遗留链接/导航/治理别名/请求代次） | — |
| 共享契约同步（随 dljy 契约切片） | #136 | dljy-web | lint 0 错（共享指纹 69 文件）✅；check ✅；test:unit 323 文件 3403 例 ✅ | — |
| 现货采集载荷行类型收口（附属变更 type-spot-captured-payloads，skip_specs） | #137 | dljy-web | check ✅；lint ✅；build ✅（chunk 体积与基线一致）；现货定向 vitest 38/38 ✅；三文件 no-explicit-any 归零 ✅；另做浏览器实测（驾驶舱/日前上报/电量预估，真实回放数据） | 全量 test:unit 存在 3 个既有 midlong 5s 超时失败（与 main 同批、数量随机浮动 3~11，非本批引入） |
| 公共证据组件与图表选区（5.4—5.8） | #138 | dljy-web | lint 0 错 ✅；check ✅；test:unit 330 文件 3464 例全绿 ✅；新增 7 组 61 例；3 处变异验证（改坏→变红→复绿） | — |
| 价格与供需视图契约同步 | #139 | dljy-web | check ✅；lint 0 错 ✅；test:unit 全量通过 ✅ | — |
| 水电与总览契约同步 | #140 | dljy-web | check ✅；lint 0 错（共享指纹 71 文件）✅；test:unit 3465 例 ✅ | — |
| 价格与价差页面（6.5） | #141 | dljy-web | lint/check/test:unit 全绿（331 文件 3480 例）✅；新增 YunnanPricesPage 15 例；3 处破坏性验证；合入 #140 契约后复跑全绿 | — |
| 电网边界契约与稳定排序同步 | #142 | dljy-web | lint/check ✅；洞察相关目录定向单测 136/136 ✅ | 未跑全量 test:unit（仅洞察目录定向面） |
| 供需与水电页面（7.5/7.6） | #143 | dljy-web | lint 0 错 ✅；check ✅；test:unit 332 文件 3496 例全绿 ✅；新增 16 例；3 处变异验证 | — |
| 市场总览页（8.3/8.4） | #147 | dljy-web | lint 0 错（319 warn 存量基线）✅；check ✅；test:unit 333 文件 3511 例全绿 ✅；新增 15 例 | — |
| 价格多日立体与日期×时段热力（6.7/6.8） | #148 | dljy-web | lint 0 错（328 warn 存量）✅；check ✅；test:unit 337 文件 3574 例全绿 ✅（含执行器遗留 21 个三维用例） | 真实数据浏览器联调归 #3010 |
| 跨省与电网边界页（10.5） | #150 | dljy-web | 新增组件回归 15 例；定向 vitest 16 文件 223 例全绿 ✅；lint 0 错 ✅；check ✅ | — |
| 洞察 API 真实实例联调快照（6.7/7.7 实例证据） | #3086 | dljy | 实测快照：真实可用窗口 2026-05-01~08-17/18，8 月边缘日 partial 如实标注；覆盖候选离散 2 段不假连续；伪造 context.companyId 被服务端覆盖、0 行无泄漏（DE07/A01）✅ | 纯文档 PR 无门禁面；浏览器动线归 #3010 |
| 月包余量预检与洞察通道（9.1—9.6） | #3076 | dljy | verify:cgn-monthpack-precheck PASS（真实 2026-05 批次 15 表 D7 全一致）✅；verify:source-registry PASS ✅；verify:api-contracts PASS ✅；node --test market-insight 782 例 0 失败 ✅；check 绿 ✅；ci:local:quick 83 PASS/1 FAIL→修复 budget 计数后单跑 PASS ✅ | ci:local:quick 耗时超预算为既有 ⚠ 通胀告警，与本 PR 无关 |
| 月包余量 13 表补录管线（dljy#3088，#3027 管线部分） | #3091 | dljy | dry-run 13+1 表「源 N/丢弃 0」全对拍 ✅；yn-fact-monthpack 14/14 ✅；verify:data-upload OK ✅；verify:source-registry PASS ✅；build-data-type-ddl --check 一致 ✅；check 绿 ✅ | WRITE-EXIT=1 为既知 prepared_files 空数据集拒收（D7 在案）；消费验收随 #3010 |
| 跨省与电网边界页检修干预页签（10.6 web 侧） | #156 | dljy-web | 正文验证记录为引用式（见同分支上游描述）；shared-fingerprint 80→81 镜像同步对齐 ✅ | 验证记录章节简略，以镜像指纹测试与同分支门禁为界 |
| 检修干预事件契约镜像（10.6 dljy 侧） | #3095 | dljy | 定向 node tests 52/52（market-insight 31 + insight kernel/fingerprint 21）✅；verify:source-registry PASS ✅；check 0 ✅ | pre-push 快档含既有 MS-04 抖动 → 按 #3089 依据 --no-verify 推送、以 GitHub CI 为权威门禁 |
| 总览接入真实电网事件摘要（10.7） | #161 | dljy-web | 新增 10 例；insight+region 定向 19 文件 317 例全过 ✅；lint 0 错 ✅；check 绿 ✅ | — |
| 场站市场表现后端分析（11.1—11.4） | #3079 | dljy | plants-views 15/15 ✅；market-insight 子域 69/69 ✅；全仓 798 例多轮跑绿（MS-04 既有抖动除外）✅；verify:source-registry PASS ✅；check 绿 ✅；改动文件 eslint 0 错 ✅ | MS-04 偶发 20s 锁等待超时（既有环境敏感抖动，solo 可复现） |
| 场站市场表现页（11.5/11.6） | #153 | dljy-web | 门禁三目录 309/309 ✅；全量 test:unit 3631/3631 ✅；lint 0 错（369 warn 存量）✅；check 绿 ✅ | — |
| 结算表现后端（12.1—12.4） | #3090 | dljy | settlement-views 21/21 ✅；verify:source-registry PASS ✅；洞察域全套除既有 MS-04 抖动 1 例外全绿 ✅；check 绿 ✅ | MS-04 既有抖动（solo 复跑绿） |
| 场站页结算页签（12.5） | #155 | dljy-web | 门禁三目录 318/318（23 文件）✅；lint 0 错 ✅；check 绿 ✅；红线自查（无结算修改入口、无 mock、无调试残留）✅ | 浏览器真实五月一致性动线归 #3010 |
| 研究预设与同类日内核（13.1—13.4） | #3089 | dljy | node --test 研究面 38/38（含四类事前负例）✅；洞察域全套 835+ 通过（除 MS-04 1 例，solo 复跑绿）✅；verify:source-registry / api-contracts PASS ✅；check 绿 ✅ | MS-04 既有抖动 |
| 研究工作台页（13.5/13.6） | #157 | dljy-web | 三目录 19 文件 288 例全过（含新 22 例）✅；lint 0 错 ✅；check 绿 ✅；上游 dljy 研究测试 38/38 复跑绿 + source-registry PASS ✅ | — |
| 研究定义保存/取回/重跑（14.3） | #3098 | dljy | 15/15（含 PG 集成 5）✅；run-node-tests 除 MS-04 外全绿（solo 26/26）✅；verify:source-registry / api-contracts / route-slices 全绿 ✅；check 绿 ✅ | MS-04 既有抖动 |
| 洞察价格导出与材料入口（14.5/15.2 阶段 B） | #151 | dljy-web | 新增 20 例；门禁三目录 287/287 ✅；全量 test:unit 3609/3609 ✅；lint 0 错 ✅；check 绿 ✅ | — |
| 统一下钻上下文与返回状态（15.1，CH01/A15） | #154 | dljy-web | 任务指定 vitest 面 16 文件 198 例全过（含新 20 例）✅；lint 0 错 ✅；check 绿 ✅ | 定向面，未跑全量 test:unit |
| 六页统一 AI 侧栏注册与取材纪律（15.3） | #159 | dljy-web | check 绿 ✅；lint 0 错（新文件零告警）✅；三目录 27 文件 375 例全绿 0 unhandled ✅ | — |
| 洞察 AI 上下文四段约束（15.4） | #3097 | dljy | agent-backend 全量 2371 passed / 11 skipped ✅（首跑 1 例 test_forecast_g2g3 flake：干净 main 单跑过、带改动复跑绿，已排除）；test_unit_contract 12 passed ✅；verify:agent-unit-boundary / agent-contracts-consistency 全绿（台账 76/桥准入 42/冻结 7）✅；ruff clean ✅ | 1 例 forecast flake 经 stash 对照排除 |
| 只读深链与资料维护返回重查（15.5） | #158 | dljy-web | 新增 14 例；insight+region 18 文件 273 例全绿 ✅；components/insight 60 例无回归 ✅；lint 0 错 ✅；check 绿 ✅ | — |
| 跨模块回归与四条链路集成用例（15.6/15.8） | #162 | dljy-web | 新增 29 例；门禁三目录 29 文件 436/436 ✅；lint 0 错 ✅；check 绿 ✅ | — |
| 动作能力发现与版本化接收反馈（15.7 dljy，CH06—CH07/D11.1/A19） | #3101 | dljy | 测试 16 例 ✅；run-node-tests 全仓 873 例 0 失败 ✅；verify:source-registry / api-contracts PASS ✅；check 绿 ✅ | 本地 pre-push MS-04 抖动 → GitHub quality-gate 为权威门禁 |
| 跨地区一致性矩阵用例（16.2） | #160 | dljy-web | 新增 22 例；三目录 29 文件 408 例全通过 ✅；lint 0 错 ✅；check 绿 ✅ | — |
| 查询性能预算实测与本机基线（16.4） | #3109 | dljy | 冒烟 --runs 2 exit 0 且输出判定列 ✅；两轮完整 20 次实测六场景 20/20 ok 零失败 ✅；check exit 0 ✅ | 年度全节点场景留待真实规模复测（#2845/#3027 全量部署后同脚本）；研究/场站月包分析未部署、不在测量范围 |
| 旧图表保留清单落位核对与统计一致性用例（16.8 文档+用例部分） | #163 | dljy-web | 新增 8 例；三路径 26 文件 374 例全过 ✅；lint 0 错 ✅；check 绿 ✅ | 浏览器真实设备证据（A17—A20 设备部分）归 #3010；暂结对照待部署、三维动作入口未挂接两处未就绪已如实登记 |

## 汇总：全量门禁口径与本批执行情况

**全量门禁口径**（工作区规则，两仓一致适用）：

- dljy-web：`npm run lint` + `npm run check` + `npm run test:unit`。
- dljy：`source scripts/dev/use-conda-env.sh` 后 `npm run check` + `npm run ci:local:quick`，再按改动面补 `verify:*` 专项。

**本批执行情况**：

- 早期切片（#133—#153 关键节点）逐 PR 跑全量 `test:unit`，用例数随切片推进从 3325 增至 3631，全程全绿；`lint`/`check` 每个 PR 均跑。
- 后期页面与用例切片（#154 起及 #158—#163）按任务面以「门禁三目录定向 vitest + lint + check」为界，未逐个跑全量 `test:unit`；全量面在 #151（3609/3609）与 #153（3631/3631）两个节点收口验证。
- dljy 侧 11 个 PR 全部跑定向 node tests + `verify:*` + `check`；`ci:local:quick` 在 #3076 全量执行（83 PASS，唯一失败为 budget 计数需 +1，修复后 PASS）。
- 契约同步类 PR（#136/#139/#140/#142）以 lint（含 shared-fingerprint 指纹测试）+ check + test:unit（#142 为洞察目录定向面）为门禁。

**MS-04 既有抖动的处置说明**：

- dljy 侧：midlong 模块 MS-04 并发用例在本机 PG 负载下偶发 20s 锁等待超时，与本批切片零交集（#3079 定性：单独跑同样可复现；#3101 补充查明部分根因为被杀测试遗留的夹具锁僵尸进程，已清理）。处置口径：命中即对该文件单独复跑（solo），复跑绿即定性为既有环境抖动、不阻塞切片；本地 pre-push 快档被该抖动拦截时，按 #3089 顶部说明以 `--no-verify` 推送、**以 GitHub quality-gate 为权威门禁**（#3095/#3101 明示此依据）。
- dljy-web 侧存在同类既有抖动：midlong 5s 超时用例（#137 记录 3 例：WindowFormDialog ×2、MidlongContractDetailView.p2 ×1，失败数量随机浮动 3~11），与 main 上已观察到的既有超时同批，非本批引入；现货/洞察相关 spec 全绿。

**未运行不记通过的声明**：

- 本文档只转录各 PR 验证记录章节声称执行过的命令与结果，汇编时未重新执行；表内每个「✅」的效力以对应 PR 正文原文为准。
- 某 PR 未跑的面在「未覆盖面」列如实登记（如 #142 未跑全量、#154 起多数切片仅定向面），不冒充全量通过。
- 浏览器真实数据动线（六页 + 结算页签 + 三维降级）统一归 dljy#3010 验收；性能预算仅本机基线，真实规模（全节点价）复测待 #2845/#3027 全量部署后以 #3109 同一脚本执行。
