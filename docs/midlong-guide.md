# 操作导引引擎与「合同入门」导引

> ChenShi-Tech/dljy#3404 · 纯前端实现。导引在页面上以「高亮环 + 悬浮箭头卡片」逐步带用户
> 操作，本 PR 落地通用引擎（`src/features/guide/`）与第一条导引「合同入门」；另外三条
> （分解与场站 / 计划与交易执行 / 调整与复盘账单）在面板里显示「规划中」不可点。
> 练习空间（公司钉住与顶栏徽标）是前置 PR（ChenShi-Tech/dljy#3403），见
> [practice-space.md](practice-space.md)。

## 用户看到什么

「中长期售电合同」页（`/zcqjy/contracts`）页头右侧有「操作导引」按钮（`GuideLauncher`）：

- **未运行**显示「操作导引」；**运行中**显示「导引中 n/N」；**暂停**显示「导引已暂停」，
  点开面板可继续 / 暂停 / 退出。
- 面板顶部固定说明练习空间数据口径：练习数据不计入集团汇总、不能删除、再练一遍会追加新的一批。
- **不可用时按钮保持可见但禁用**，原生 tooltip 说明原因。原因按固定顺序取第一条命中
  （`midlong/availability.ts`）：地区非云南 → 当前角色不能进练习空间 → 尚未选择公司 →
  中长期能力未加载 → 模块总开关关闭 → 合同/持仓子模块未开 → 无写权限。

「合同入门」共 37 步（`steps` 数组长 37），五章：进入练习空间 → 登记交易主体 → 录框架协议
与电量合同 → 补依据并核验确认 → 在月度持仓里看它生效。三条用户决策的落地：

1. **用户亲手填写**：每步的推进条件检测「填对了 / 保存成功」自动进下一步，不替用户操作；
   每步带「帮我填示例值 / 帮我点」兜底按钮（`AssistSpec`）。
2. **只做一条**：`registry.listGuides('midlong')` 返回 `contractBasicsGuide` + 三条
   `status: 'planned'` 的占位（`plannedGuides.ts`），后者灰显「规划中」。
3. **只在练习空间写数据**：开始导引自动进入练习空间（`enterGuidePracticeSpace`）；
   结束时可选「留在练习空间看看成果」或退出回原公司。

## 引擎结构（`src/features/guide/`）

| 模块 | 职责 |
| --- | --- |
| `bridge.ts` | 页面与导引之间的叶子桥（运行时只 import vue）：`useGuideForm` / `useGuideState` / `emitGuideSignal`（页面侧），`fillGuideForm` / `readGuideForm` / `onGuideSignal`（运行器侧） |
| `types.ts` | `GuideDefinition` / `GuideStep` / `AdvanceCondition` / `AssistSpec` / `GuideSession` 等全部形状 |
| `storage.ts` | localStorage 持久化（键 `dljy.guide.v1|<user>|<originCompanyId>`）；损坏数据一律丢弃；localStorage 抛错时内存 Map 兜底（当次会话可用） |
| `targets.ts` | `data-guide` 锚点查找：`within: 'dialog'` 只认 z-index 最高遮罩内（KeepAlive 缓存的旧对话框抢不走），`within: 'page'` 优先页面内容区；`waitForGuideTarget` 超时按 target-missing 语义 reject |
| `advance.ts` | 推进条件 watcher：`form`（稳定窗口）/ `state` / `signal` / `route` / `visible` / `manual` / `any` 组合 |
| `runner.ts` | 会话生命周期：start / next / back / skip / assist / pause / resume / exit / restore / retryTarget；watch 公司与地区自动暂停；250ms 防抖持久化 |
| `registry.ts` | 按 group 动态 import 导引定义（带缓存），引擎启动不加载内容层 |
| `components/GuideHost.vue` | 挂在 AppLayout：接真 router / 目标查找器，渲染浮层与卡片，处理 Esc / target-missing |
| `components/GuideOverlay.vue` | 高亮环：`position: fixed; pointer-events: none`，让开目标元素的洞 |
| `components/GuideCard.vue` | 指引卡片：@floating-ui/dom 定位（offset/flip/shift/arrow + autoUpdate），正文纯文本渲染（white-space: pre-line，禁 v-html），`aria-live="polite"`，prefers-reduced-motion 时关脉冲动画 |
| `components/GuideLauncher.vue` / `GuidePicker.vue` | 入口按钮与选择面板（见上） |
| `composables/useAnchoredPosition.ts` | floating-ui 计算封装（层级用 `useZIndex().nextZIndex()`） |
| `midlong/` | 中长期内容层：`anchors.ts`（锚点/表单键/信号名唯一真值清单）、`contractBasics.ts`（37 步定义）、`plannedGuides.ts`、`examples.ts`（示例值生成）、`evidenceFile.ts`（教学示例依据文件）、`availability.ts` |

### 锚点命名规则

锚点即模板里的 `data-guide="<name>"`，命名 `ml-<区域>-<元素>`（ml = midlong）：
`ml-head-subjects`（页头按钮）、`ml-subject-key`（主体对话框字段）、`ml-contract-submit`
（表单保存按钮）、`ml-positions-stations-link`（持仓页链接）……`ANCHOR.launcher`
（`ml-guide-launcher`）是入口按钮自身，`ANCHOR.practiceBadge` 归 #3403 练习空间，只借同一查找机制。

`midlong/anchors.ts` 的 `ANCHOR / FORM / STATE / SIGNAL` 是唯一真值清单，`.vue` 模板与它
**双向核对**（`anchors.spec.ts`）：清单里的锚点必须真的挂在某个模板上；模板里出现的每个
`data-guide` 必须在清单里；每个表单/状态/信号键必须有组件真的接上
`useGuideForm / useGuideState / emitGuideSignal`。改版删锚点时清单同步收敛，不会静默漂移。

### 推进条件（`AdvanceCondition`）

| kind | 语义 |
| --- | --- |
| `manual` | 用户点「下一步」 |
| `form` | 表单值满足 `done(values)` 且稳定过 `settleMs`（默认 800ms，窗口内再变重新计时）——避免用户还在输入时就跳步 |
| `state` | 页面状态快照满足（如「合同列表里出现了 runTag 的合同」），immediate 评估 |
| `signal` | 页面在成功分支发信号（如 `contractSaved`），可带 `match` 校验载荷——**保存成功才推进**，失败不动 |
| `route` | 路由变化满足 `match({ path })` |
| `visible` / `hidden` | 锚点元素出现 / 消失 |
| `any` | 组合子条件，任一满足 |

### 练习空间关系

导引的数据安全靠 #3403 的练习公司隔离，本引擎补充会话级纪律：

- **开始**：`enterGuidePracticeSpace` 幂等开通并切到练习公司，会话记下
  `originCompanyId` / `practiceCompanyId` / `regionId`。
- **自动暂停**：进入练习空间后用户切走公司 → 暂停（reason: company）；切出导引地区 →
  暂停（reason: region）。`resume` 先把地区切回去、再回练习公司，保证写操作始终落在练习公司。
- **退出**：`exit()` 退出练习空间并切回原公司，清 active 指针与会话；`exit({ stay: true })`
  留在练习空间看成果（完成时记入 done 列表，面板按钮变「再来一遍」）。
- **恢复**：刷新后 `restore()` 按 localStorage 的 stepId 回到原步（定义里已失效的 stepId
  回退第 0 步），恢复期对目标有 1.5s 宽限，之后走 target-missing。
- **示例数据口径**：导引生成的合同 `sourceNamespace = 'TEST-GUIDE'`，
  `midlongFormat.testDataKind` 渲染「教学演示」标签（不计入集团汇总）；其它 `TEST*` 前缀
  显示「测试数据」。示例依据文件由 `evidenceFile.ts` 生成，文件名与正文都标明
  「教学示例文件，非真实依据」，带练习公司 / 合同编号 / 运行标签可追溯。

## 新增一条导引的步骤

1. **挂锚点**：在目标 `.vue` 模板加 `data-guide="ml-<区域>-<元素>"`，并在
   `midlong/anchors.ts` 的 `ANCHOR` 登记（双向核对 spec 会强制两边一致）。
2. **接桥**：表单组件 `useGuideForm(FORM.<key>, formReactive)`（「帮我填」直接写进真实表单；
   原生 `input[type=file]` 无法程序赋值，直接写 `file` 字段并给一行「已选择：」展示）；
   页面级状态 `useGuideState(STATE.<key>, snapshot)`；成功分支 `emitGuideSignal(SIGNAL.<name>, payload)`。
3. **写定义**：`midlong/` 下新建 `xxx.ts` 用 `GuideStep[]` 写步骤（target / advance / assist），
   `registry.listGuides` 加入返回列表，`status: 'ready'` 上线（`planned` 先占位）。
4. **示例值**：涉及演示数据的在 `examples.ts` 加生成函数（编号从 runTag 派生、带
   `TEST-GUIDE` 口径、时间用北京时间跨零点安全口径）。
5. **验证**：`npm run check`（锚点清单与类型）；新锚点跑
   `npx vitest run --project node src/features/guide`；受影响组件跑
   `npm run test:related -- <源文件>`。

## 测试守卫

- `src/features/guide/` 引擎层：bridge 注销纪律、storage 降级、targets 遮罩层级、runner
  会话生命周期（node + dom 共 6 文件）。
- `midlong/anchors.spec.ts`：锚点/表单键/信号名与模板双向一致（改版漂移即红）。
- `midlong/examples.spec.ts` / `evidenceFile.spec.ts`：示例值不变量（分解电量与合同电量
  严格相等、BOM 与 text/plain 走真实上传通道等）。
- 组件层：`GuideLauncher.component.spec.ts`（可用性顺序 tooltip、面板、planned 不可点）、
  `MidlongSubjectDialog.component.spec.ts`（fill 写进真实表单、成功才发信号）、
  FormDialog / DetailView spec 补 fill 与 `contractSaved` / `evidenceAdded` /
  `contractVerified` 信号断言。

## 依赖

新增运行时依赖 `@floating-ui/dom`（卡片定位），无其余新依赖；浮层全部用项目内既有
令牌与颜色变量。
