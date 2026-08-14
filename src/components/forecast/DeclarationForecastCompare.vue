<script setup lang="ts">
// 申报台左栏：多模型出清价格预测叠加对比。
//
// 取代原先的 `loadForecastCurve(targetDate)` —— 那是硬编码回放 `knn-api_api` 采集族，请求里
// 连 model 字段都没有；云南该族只覆盖到 2026-07-01，默认目标日超区间就回 mock，前端判 mock
// 后落 `synth96()` 正弦合成。**那条线既不是 KNN，也不是真实数据。**
//
// 两条纪律（与 declarationForecast.ts 同源，此处是它的 UI 面）：
// 1. 失败不合成兜底——任一模型失败只显示原因；全失败给空态 + 可操作出口。
// 2. 占位/合成/未过门禁的结果不参与排名、不得设为决策模型。
//
// 原计划的「实际出清参照曲线 + 对目标日实际 MAE」实测后撤下：底层取数会返回错日、跨地区
// 回退、混入非曲线字段的序列却标成 captured，叠上去等于把编造的真值标成真实。详见
// declarationForecast.ts 顶部注释与配套文档。
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { AlertTriangle, CalendarClock, Loader2, Play, RefreshCw } from 'lucide-vue-next'

import UnifiedForecastChart from './UnifiedForecastChart.vue'
import DataBasisBadge from '../DataBasisBadge.vue'
import {
  ensureForecastCatalog,
  forecastCatalogState,
  providersForTarget,
  type ForecastBasis,
  type ForecastProvider,
} from '@/services/forecast/forecastProviders'
import {
  buildCompareRows,
  canBeDecisionModel,
  defaultSelection,
  isTrustworthyForecast,
  parsePredictableUntil,
  resolveDecisionModel,
  toChartSeries,
  type CompareRow,
  type ModelRunOutcome,
} from '@/services/forecast/declarationForecast'
import { currentRegion } from '@/services/region/regionContext'

const props = defineProps<{
  targetDate: string
  /** 当前决策模型 id（由父视图持有，供决策包/一键最优申报曲线使用） */
  decisionModel: string
}>()
const emit = defineEmits<{
  (e: 'update:decisionModel', modelId: string): void
  /** 请求父视图把目标日切到可预测日（空态出口①） */
  (e: 'suggest-date', date: string): void
  /** 请求父视图切演练模式做历史回溯（空态出口②） */
  (e: 'suggest-rehearsal'): void
  /**
   * 回吐给父视图落申报单据的口径与摘要。
   * 取**决策模型**那条曲线而非"所有模型平均"——申报单要记录的是它实际依据的那条预测，
   * 平均出来的数字不对应任何一个真实模型的输出，落进单据即失真。
   */
  (e: 'summary', payload: { basis: ForecastBasis; stats: { mean: number; spread: number } } | null): void
  /**
   * 本批预测是否已跑完并验真。父视图据此门控「生成申报决策包」——首次挂载与切目标日/地区
   * 后的运行期间，父视图手里还是初始或上一批的 decisionModel，若不门控，用户可以在新批
   * 结果尚未经过 basis / 单日门禁校验时就生成申报建议，拿到的是基于最终会被判负的模型
   * 算出来的报价。
   */
  (e: 'batch-ready', ready: boolean): void
}>()

const MAX_SELECTED = 4
const SELECTION_KEY = 'declaration_desk_forecast_models'

const catalog = forecastCatalogState()
const selected = ref<string[]>([])
const outcomes = ref<ModelRunOutcome[]>([])
const running = ref(false)

// 可选模型池：price 目标下的全部**计算型** provider（含 available:false，按契约"禁用不隐藏"）。
//
// 排除 `kind:'replay'`（山西下的 platformProvider）：它的 `parseCfgCurve` 在目标日不存在于
// 采集数据时会**静默取最新采集日**（forecastProviders.ts:145 `dates[dates.length - 1]`），
// 而申报台默认目标日是明天/后天，几乎必然落空 → 画出来是一条历史曲线挂在目标日标题下。
// 本面板也不渲染结果里的 dateUsed 警告，交易员会把错日曲线当成目标日预测。
// 它同时不是 `/forecast/predict` 支持的 model_type（后端报 Unsupported forecast model）。
// 官方披露曲线的正确去处是工作台/驾驶舱，那里有完整的日期口径标注。
// 不支持 price 目标的模型（如 physics_hybrid 仅 renewable——price 下缺 clearsky_ghi 特征列
// 稳定 400）已由后端目录按 supportedTargets 过滤，不会进 providersForTarget 的结果（#1461），
// 此处无需再前端补挡。
const pool = computed<ForecastProvider[]>(() =>
  providersForTarget('price', currentRegion.value.id)
    .filter((p) => p.kind !== 'replay')
)
const selectable = computed(() => pool.value.filter((p) => p.available !== false))
// ForecastProvider 的主键是 `id`，服务层（declarationForecast.ts）统一用 `modelId`。
// 在边界处显式映射，不把两套词汇混进服务层。
const selectableForPick = computed(() =>
  selectable.value.map((p) => ({ modelId: p.id, mock: p.mock, available: p.available }))
)

const rows = computed<CompareRow[]>(() => buildCompareRows(outcomes.value))
const chartSeries = computed(() => toChartSeries(outcomes.value))
const anySuccess = computed(() => outcomes.value.some((o) => o.result !== null))
const allFailed = computed(() => outcomes.value.length > 0 && !anySuccess.value)
// 仅当后端报错里真的自报了可用区间才给「切到最近可预测日」出口；解析不出就不显示，
// 不猜一个日期让用户点空。
// 出口日期有两个来源，缺一不可：
//  ① 本批越界报错里现学的（首次遇到越界）；
//  ② 已缓存的逐模型末日（第二次起走短路分支，报错是我们自己造的文案，parse 不出区间）。
// 只认 ①的话，短路一生效「切到最近可预测日」按钮就消失了——明明 knownRangeEnd 里就有精确
// 末日，却让用户自己猜日期。取两者中最晚的：选它至少有一个已选模型能跑。
const predictableUntil = computed(() => {
  const fromErrors = parsePredictableUntil(outcomes.value)
  const region = currentRegion.value.id
  const cached = selected.value
    .map((modelId) => knownRangeEnd.value[rangeKey(region, modelId)])
    .filter((v): v is string => !!v)
  const all = [...cached, ...(fromErrors ? [fromErrors] : [])]
  return all.length ? all.reduce((a, b) => (a >= b ? a : b)) : null
})

// 图例口径取所有成功结果里**最弱**的那个：一条 illustrative 占位线混进来，整张图就不能
// 按"真实"读。与 toolGrouping.ts 的分组口径同一原则。
const BASIS_RANK: Record<string, number> = {
  synthetic: 0, illustrative: 1, derived: 2, imported: 3, captured: 4, real: 5,
}
const overallBasis = computed<ForecastBasis>(() => {
  const list = outcomes.value.map((o) => o.result?.basis).filter(Boolean) as ForecastBasis[]
  if (!list.length) return 'synthetic'
  return list.reduce((weakest, b) =>
    (BASIS_RANK[b] ?? -1) < (BASIS_RANK[weakest] ?? -1) ? b : weakest
  )
})

// 已运行那一批用的模型集合。与 `selected` 比较即可知道「选择改了但还没跑」。
const ranSelection = ref<string[]>([])
const selectionDirty = computed(() => {
  const a = [...selected.value].sort().join('|')
  const b = [...ranSelection.value].sort().join('|')
  return a !== b
})

// 地区目录刷新期间仍需拦住选择：那时 pool 还是上一地区的，勾了也是错的。
// 但**运行期间不拦**——本次改造的要点就是"跑动时先把模型勾好，跑完再点运行"。
const catalogLoading = computed(() => catalog.loading.value)

function toggle(modelId: string) {
  // 勾选**只改选择、不触发运行**——/forecast/predict 是同步重训，选一个跑一次会让用户
  // 每点一下就等一轮，还会叠出多批后端 CPU 任务。改由「运行预测」按钮显式发起。
  // 故运行期间不拦（跑动时照样能先勾好），只在地区目录刷新期间拦——那时 pool 还是旧地区的。
  if (catalogLoading.value) return
  const i = selected.value.indexOf(modelId)
  if (i >= 0) selected.value.splice(i, 1)
  else {
    if (selected.value.length >= MAX_SELECTED) return
    selected.value.push(modelId)
  }
  // 持久化失败（隐私模式/配额满）只影响"下次记不住选择"，绝不能阻断本次重跑——否则
  // chip 显示的是新选择，图/排名/决策模型还是旧的，用户还能据此生成决策包。
  // 读取侧本来就有 try/catch，写入侧同样要有。
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(selected.value))
  } catch { /* 记不住选择即可，不影响本次运行 */ }
  // 取消最后一个模型时立刻作废旧批次：运行按钮在空选择下是禁用的，`run()` 里那条清空分支
  // 永远等不到人点。不作废的话，上一批 outcomes / 决策模型 / batch-ready 会一直留着，
  // 父视图仍可据此生成决策包——而对比区已经一个模型都没选了。
  if (!selected.value.length) requestRun()
}

/** 「运行预测」按钮：把当前选择跑一遍。 */
function runSelection() {
  requestRun()
}

// provider 侧的门禁事实，随每次运行结果一起交给服务层判可信度。
// 分开传而不是让服务层去查 provider：服务层是纯逻辑，不该依赖 Vue 响应式的 provider 注册表。
function gateFlags(provider: ForecastProvider) {
  // 只传 isBaseline。**不传目录侧 quality.passesSkillGate**——它的证据不带 target/basis
  // 限定（后端按地区取最新报告，文件名不含 target，也不校验报告 basis），拿它挡报价模型
  // 会既误杀又误放。见 declarationForecast.ts::canBeDecisionModel 注释与技术债 #1460。
  return { isBaseline: provider.tier === 'baseline' }
}

// 竞态守卫：改目标日/改选择/切地区都会重跑，慢的那次晚归会覆盖新结果。
let runGeneration = 0

// 目标日 debounce 定时器（声明在 run 之前，供 run 取消——见 run 首行）
let dateDebounce: ReturnType<typeof setTimeout> | undefined

// 「上下文已变、对应新批次尚未跑完验真」。它必须比 running 更早为真——改目标日要先等 400ms
// debounce，切地区要先 await 目录刷新，这两个窗口里 running 都是 false，只看 running 会让
// 页面在上下文已变时仍报「已就绪」：用户能拿上一批的 decisionModel 去生成决策包。
const pendingRun = ref(false)

/** 作废在途批次并清空结果。切地区/切目标日/清空选择等"必须立刻停"的场景先调它。 */
function invalidateRun() {
  runGeneration += 1
  outcomes.value = []
  running.value = false
}

// **真正在途的后端批次数**，与 UI 的 running 分开记。markContextChanged() 会把 running 置回
// false 以驱动界面，但后端那一批仍在跑且停不掉（/forecast/predict 同步重训，无取消入口）。
// 只看 running 会误判"现在空闲"，于是一次超过 400ms 的训练期间，用户每隔 400ms 换一个日期
// 就能叠出多批并发训练。
let inFlight = 0
// 在途时收到的新一批请求：只记一个「还欠一次」，等当前批次落地后串行补跑最新状态。
let queuedRun = false

// 已知的可用数据末日（从后端越界报错里学到，按地区记）。后端对超范围目标日的响应是
// **0.3s 内的 400 + 明确区间**，我们却会把它打给每一个选中模型——4 个模型就是 4 条控制台
// 红字 + 4 次无谓往返。学到一次就够：之后同地区的越界目标日直接给空态，不再发请求。
// 键为 `${regionId}::${modelId}` —— **按模型记**，不能只按地区。同一批里各模型的覆盖区间
// 可以不同：一个越界失败、另一个成功时，若按地区记末日，下次同一目标日会把**刚成功的那个
// 也一并短路**；用户之后改选覆盖更长区间的新模型，也永远发不出请求。
const knownRangeEnd = ref<Record<string, string>>({})
const rangeKey = (regionId: string, modelId: string) => `${regionId}::${modelId}`

/** 仅当**当前已选模型全部**已确认越界时才短路——只要有一个没被证伪，就照常发请求。 */
const knownOutOfRange = computed(() => {
  if (!props.targetDate || !selected.value.length) return false
  const region = currentRegion.value.id
  return selected.value.every((modelId) => {
    const end = knownRangeEnd.value[rangeKey(region, modelId)]
    return !!end && props.targetDate > end
  })
})

// 地区目录正在刷新。requestRun 必须一并检查它：切地区后目录刷新若超过 400ms，日期 debounce
// 的定时器会照常触发，而它只看 inFlight——于是拿**上一地区的 pool** 起一整批新地区训练，
// 甚至先于目录完成、暂时把批次标成就绪；目录返回后又起第二批。
let catalogSyncing = false

/**
 * 统一的运行入口：停用则记账、在途或正在同步地区目录则排队，空闲才真跑。
 *
 * 活动态检查必须放在**这里**而不是各 watcher 入口：日期 debounce 定时器与
 * `applyRegionChange()` 的目录 await 都是**异步回调**，完全可能在页面被 KeepAlive 停用
 * 之后才抵达——watcher 入口那时已经放行了。隐藏页起一整批同步重训纯属浪费共享 CPU。
 */
function requestRun() {
  if (!active.value) { missedRun = true; return }
  if (inFlight > 0 || catalogSyncing) { queuedRun = true; return }
  void run()
}

/** 上下文变更入口统一走它：立刻置未就绪 + 清空旧结果，再各自去等 debounce / 目录刷新。 */
function markContextChanged() {
  pendingRun.value = true
  invalidateRun()
}

async function run() {
  // 取消在途的日期 debounce：用户在那 400ms 里改了模型选择会直接触发 run()，若不取消，
  // 定时器随后还会再跑一次同样的批次，白白多耗一组后端同步重训。
  if (dateDebounce) { clearTimeout(dateDebounce); dateDebounce = undefined }
  // 每批新请求都必须**先作废并清空**，而不只是在空选择/切地区时清：
  // - 世代要在早退之前递增，否则用户在预测仍在跑时取消最后一个模型，旧批次回来照样通过
  //   检查写回，出现"没选任何模型却有图有表"；
  // - 旧结果要在等待期间就清掉，否则切目标日后标题已是新日期，图/均价/captured 口径却还是
  //   上一日的，用户可以据此建草稿或改申报单。宁可空白几秒，也不让错日数据挂在新标题下。
  invalidateRun()
  const generation = runGeneration
  // 已知越界：直接给空态，不再把注定 400 的请求打给每个模型（控制台 N 条红字 + N 次无谓往返）
  if (knownOutOfRange.value) {
    const shortCircuitSelection = [...selected.value]
    outcomes.value = shortCircuitSelection.map((modelId) => ({
      modelId,
      name: pool.value.find((p) => p.id === modelId)?.name ?? modelId,
      result: null,
      error: `目标日超出该模型可用数据范围（截至 ${knownRangeEnd.value[rangeKey(currentRegion.value.id, modelId)]}），未发起预测`,
    }))
    ranSelection.value = shortCircuitSelection
    pendingRun.value = false
    initialized.value = true
    return
  }
  if (!props.targetDate || !selected.value.length) {
    pendingRun.value = false // 无可跑内容也算"本批已了结"，否则按钮永久禁用
    initialized.value = true
    return
  }
  running.value = true
  inFlight += 1
  const regionId = currentRegion.value.id
  const targetDate = props.targetDate
  // 本批启动时的选择快照。运行期间用户可以继续改选择（这是本次改造有意放开的），
  // 若用完成时的 selected 发请求或记账，就会出现：跑的是 A/B、记成 A/C，
  // selectionDirty 随即为 false，用户再也看不到「C 尚未运行」的提示，
  // 而决策包仍在用旧模型的结果——预测口径静默错配。
  const batchSelection = [...selected.value]
  try {
    const runs = batchSelection.map(async (modelId): Promise<ModelRunOutcome> => {
      const provider = pool.value.find((p) => p.id === modelId)
      if (!provider) return { modelId, name: modelId, result: null, error: '模型不在当前地区可用目录中' }
      try {
        const result = await provider.run(
          { regionId, target: 'price', targetDate, granularity: 96, historyDays: 180 },
          { train_days: 180, probabilistic: false }
        )
        return { modelId, name: provider.name, result, ...gateFlags(provider) }
      } catch (err) {
        // 保留原因而非丢 null：用户要能看到"为什么这个模型没出结果"
        return {
          modelId, name: provider.name, result: null,
          error: err instanceof Error ? err.message : '预测失败',
          ...gateFlags(provider),
        }
      }
    })

    const results = await Promise.all(runs)
    if (generation !== runGeneration) return // 陈旧批次整体丢弃
    outcomes.value = results
    ranSelection.value = batchSelection // 记的是**本批实际跑的**模型集，不是当下的选择
    // 逐模型学出各自的数据末日，供下次短路（只记确实越界的那些）
    const learnedEntries: Record<string, string> = {}
    for (const o of results) {
      const end = parsePredictableUntil([o])
      if (end) learnedEntries[rangeKey(regionId, o.modelId)] = end
    }
    if (Object.keys(learnedEntries).length) {
      knownRangeEnd.value = { ...knownRangeEnd.value, ...learnedEntries }
    }
  } finally {
    inFlight -= 1
    if (generation === runGeneration) {
      running.value = false
      // 还欠一次时不清 pendingRun：上下文已变而最终那批尚未跑，此刻不算就绪。
      if (!queuedRun) pendingRun.value = false
      // 「首批已跑完」由 run 自己置，而非 onMounted——挂载时若页面已被停用，首跑会被
      // requestRun 记账推迟到 onActivated，那时也必须能把就绪态放出来。
      initialized.value = true
    }
    // 全部在途批次落地后才补跑，保证同一时刻只有一批在后端训练。
    // 走 requestRun 而非直接 run：停用 / 目录同步中等条件全在那一个入口判，
    // 在这里复写一遍迟早会与它分叉（本 PR 已因"同一规则写两处"栽过多次）。
    if (inFlight === 0 && queuedRun) {
      queuedRun = false
      requestRun()
    }
  }
}

function setDecisionModel(row: CompareRow) {
  if (decisionBlockReason(row)) return
  preferredModel.value = row.modelId // 记为用户偏好，重跑/换日后只要它仍可用就继续沿用
  emit('update:decisionModel', row.modelId)
}

function decisionBlockReason(row: CompareRow): string {
  const provider = pool.value.find((p) => p.id === row.modelId)
  if (provider?.id?.startsWith('store:')) {
    return '外部训练模型绑定了目标（target），而决策包需同一模型再跑一次负荷预测，必然失败；可用于价格对比，不能作决策模型'
  }
  if (provider?.mock) return '占位实现（StandardScaler+Ridge），不得作为申报决策依据'
  if (provider?.available === false) return provider.reason || '该模型当前不可用'
  if (row.error) return '本次运行失败，无结果可用于决策'
  // 本次结果口径不可信（真实数据缺失时后端合成兜底）——模型本身是真的，但这一次的结果不是
  if (!row.trustworthy) return row.notRankableReason || '本次结果口径不可作为报价依据'
  return ''
}

const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(2))

// 决策模型必须落在**本次真正跑出结果、且允许作决策依据**的模型里。父视图拿它去
// fetchCockpit/fetchOptimizeBid；若这里只把摘要回退到排名第一却不同步 id，就会出现
// 图与均价来自模型 A、申报决策包来自模型 B 的分裂，且用户无从察觉。
// 用户在对比表里显式选过的模型。必须与「本批当前有效的决策模型」分开保存：run() 开头会
// 清空 outcomes，那一瞬间没有任何可用模型；若此时就把父视图的决策模型抹掉，新结果回来时
// 只能回退到排名第一——用户手选的报价口径被静默改掉，而他毫无察觉。
const preferredModel = ref('')

const usableOutcomes = computed(() =>
  // 两道过滤缺一不可：
  // - `canBeDecisionModel` 看 provider 静态属性（占位 / 不可用 / 回放 / 目标专用 store）；
  // - `isTrustworthyForecast` 看**本次结果**——真实回放缺失时后端会用合成数据兜底，
  //   普通 KNN/XGBoost 的 result.mock 仍是 false，只看静态属性会让合成曲线当上决策模型。
  outcomes.value.filter(
    (o) => isTrustworthyForecast(o.result, { isBaseline: o.isBaseline })
      && canBeDecisionModel(pool.value.find((p) => p.id === o.modelId))
  )
)

const effectiveDecisionModel = computed(() =>
  resolveDecisionModel({
    usableIds: usableOutcomes.value.map((o) => o.modelId),
    rankedIds: rows.value.filter((r) => r.rank).sort((a, b) => a.rank - b.rank).map((r) => r.modelId),
    preferred: preferredModel.value,
    current: props.decisionModel,
  })
)

// 「本批是否已跑完」——outcomes 为空既可能是"跑完全失败"，也可能是"刚清空还没跑"，二者
// 绝不能混：后者回吐空串会把用户手选的口径抹掉（重跑/切目标日都会经过那一瞬间）。
// initialized 覆盖首次挂载：onMounted 里要先 await 目录再首跑，那之前一律视为未就绪。
const initialized = ref(false)
// 「正忙」= 在跑 或 上下文已变待跑。所有会触发新一批训练的入口都按它禁用，而不是只按 running。
const busy = computed(() => running.value || pendingRun.value)
const batchSettled = computed(() => initialized.value && !busy.value)
watch(batchSettled, (ready) => emit('batch-ready', ready), { immediate: true })

// 无可用模型时必须回吐空串，否则父视图继续持有上一批的模型 id：对比区明确"无结果"，
// 「生成」按钮却仍能拿那个隐藏模型算出一份申报建议，口径彻底分裂。但只在批次跑完后回吐。
watch([effectiveDecisionModel, batchSettled], ([id, settled]) => {
  if (!id && !settled) return
  if (id !== props.decisionModel) emit('update:decisionModel', id as string)
}, { immediate: true })

// 决策模型那条曲线的摘要 → 回吐父视图（创建草稿时落 basis + 均价/价差）。
const summarySource = computed(() =>
  outcomes.value.find((o) => o.modelId === effectiveDecisionModel.value)?.result ?? null
)
watch(summarySource, (r) => {
  const finite = r?.points.filter((v) => Number.isFinite(v)) ?? []
  if (!finite.length) {
    // 无可用预测（越界/全失败/清空选择）必须显式回吐 null。否则新目标日标题下仍挂着上一日
    // 的均价与口径，createDraft() 还会把上一轮的 basis 写进新草稿——单据口径与页面空态不符。
    emit('summary', null)
    return
  }
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length
  emit('summary', {
    basis: r!.basis,
    stats: {
      mean: Math.round(mean * 10) / 10,
      spread: Math.round((Math.max(...finite) - Math.min(...finite)) * 10) / 10,
    },
  })
}, { immediate: true })

onMounted(async () => {
  await ensureForecastCatalog()
  const saved = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(SELECTION_KEY) || 'null')
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : null
    } catch { return null }
  })()
  // 记忆的选择须与当前地区目录取交集：换地区后旧模型可能已不在池中，直接用会全军失败
  const usable = saved?.filter((id) => selectable.value.some((p) => p.id === id)) ?? []
  selected.value = usable.length ? usable.slice(0, MAX_SELECTED) : defaultSelection(selectableForPick.value)
  // 走统一入口而非直接 run()：目录请求是异步的，用户完全可能在它返回前离开申报台
  // （KeepAlive 只触发 deactivate），直接跑就会在隐藏页为默认模型起最多两项同步训练。
  // initialized 由 run() 自己置，故此处推迟到 onActivated 补跑时才放开就绪态。
  requestRun()
})

// 目标日变化做合并：父视图的日期输入在预测运行期间仍可操作（它驱动整页而不只是本面板，
// 锁死不合适），连续改几个日期就会叠出多组 /forecast/predict 同步重训——runGeneration 只
// 丢弃响应，停不掉后端 CPU 任务。400ms 合并窗口把连点收敛成一次。
watch(() => props.targetDate, () => {
  // 先置未就绪并清空：debounce 那 400ms 里 running 仍是 false，若不显式标记，旧曲线与摘要
  // 会继续挂在新日期标题下，「生成」按钮也仍可用上一批的决策模型。
  markContextChanged()
  if (dateDebounce) clearTimeout(dateDebounce)
  dateDebounce = setTimeout(() => { requestRun() }, 400)
})
onBeforeUnmount(() => { if (dateDebounce) clearTimeout(dateDebounce) })
// KeepAlive（AppLayout.vue:399 `<KeepAlive :max="20">`）会把申报台整页缓存下来：离开页面
// 只触发 deactivate 不会卸载，本组件的地区 watcher 因而一直活着。用户在别的页面切地区时，
// 隐藏的申报台会刷新目录并把所选模型整批同步重训——结果当前根本看不见，却实打实占用共享
// agent-backend 的 CPU。故停用时只作废结果、记下「欠一次刷新」，重新激活后再补。
// 父视图 DeclarationDeskView 对 1s 倒计时 ticker 用的也是这套 onActivated/onDeactivated。
const active = ref(true)
// 「欠一次运行」：停用期间被拒的运行（切地区、日期 debounce 迟到回调等），激活后统一补。
let missedRun = false

// 地区目录同步的世代。`catalogSyncing` 是个**共享布尔**，连续切地区会有多个
// applyRegionChange 并存：ensureForecastCatalog 内部只丢弃陈旧响应，陈旧调用照样正常返回，
// 于是它会抢先解锁、改写选择、清掉 queuedRun 并触发预测——最新目录仍在途时就按**上一地区
// 的 pool** 起当前地区的训练；最新目录已完成时则多排一次同样的全模型重训。
// 故每次调用领一个世代，只有最新那次有权解锁与推进。
let regionSyncGeneration = 0

async function applyRegionChange() {
  const generation = ++regionSyncGeneration
  // 目录刷新失败不得中断本函数：pendingRun 只由 run() 的 finally 清除，若这里抛出，
  // run() 永不执行，就绪态永远为假、「生成」按钮永久禁用。失败原因已由
  // forecastCatalogState().error 在面板上呈现，此处吞掉即可，后续 run() 会以空池早退。
  catalogSyncing = true
  try {
    await ensureForecastCatalog(true)
  } catch { /* 已由 catalog.error 呈现 */ }
  // 陈旧调用到此为止：不解锁、不改选择、不触发运行。解锁交给最新那次——否则它会把仍在
  // 同步中的最新一次的锁提前打开，日期 debounce 就又能拿旧 pool 起训练了。
  if (generation !== regionSyncGeneration) return
  // 无论目录成败，最新那次都要解锁，否则 requestRun 永远排队、面板再也跑不起来
  catalogSyncing = false
  // 地区切换后旧选择可能整组失效，回落到新地区的默认选择
  const usable = selected.value.filter((id) => selectable.value.some((p) => p.id === id))
  selected.value = usable.length ? usable : defaultSelection(selectableForPick.value)
  // 目录同步期间排下的队由这一次统一覆盖（它已带上最新的目标日与新地区 pool），
  // 先清标志再跑，否则本批 finally 会看到 queuedRun 为真而多跑一整批。
  queuedRun = false
  // 走 requestRun 而非直接 run：切地区时上一批可能仍在后端跑（markContextChanged 只把 UI 的
  // running 置回 false，停不掉后端），直接跑会并发出两批同步训练。
  requestRun()
}

onActivated(() => {
  active.value = true
  if (!missedRun) return
  missedRun = false
  // 用 applyRegionChange 而非直接 run：停用期间地区可能已经变过，目录需要按新地区重刷；
  // 它内部最后会走 requestRun()，此时 active 已为真。
  void applyRegionChange()
})
onDeactivated(() => { active.value = false })

watch(() => currentRegion.value.id, async () => {
  // 必须先作废并清空、并标记未就绪，再等目录：ensureForecastCatalog 是一次网络往返（可长达
  // 数秒），期间 running 是 false，旧地区的模型请求若完成会通过世代检查把旧地区曲线与摘要
  // 写到已切换的页面上，用户甚至能据此创建草稿——跨地区串显是本仓 P1 红线。
  markContextChanged()
  if (!active.value) {
    // 隐藏页：只作废旧结果，不刷目录也不跑训练；重新激活时再补。pendingRun 保持为真，
    // 使父视图在此期间不得生成决策包（此刻的 decisionModel 属于上一个地区）。
    missedRun = true
    return
  }
  await applyRegionChange()
})

defineExpose({ run })
</script>

<template>
  <div class="dfc">
    <div class="dfc-head">
      <div class="dfc-models">
        <button
          v-for="p in pool"
          :key="p.id"
          class="model-chip"
          :class="{ on: selected.includes(p.id), mock: p.mock, off: p.available === false }"
          :disabled="p.available === false || catalogLoading"
          :title="p.available === false ? (p.reason || '该模型当前不可用')
            : catalogLoading ? '正在按新地区刷新模型目录，稍候即可选择'
            : p.mock ? '占位实现（StandardScaler+Ridge），可看形状但不可作决策依据'
            : (selected.includes(p.id) || selected.length < MAX_SELECTED ? '' : `最多同时对比 ${MAX_SELECTED} 个模型`)"
          @click="toggle(p.id)"
        >
          {{ p.name }}<span v-if="p.mock" class="chip-tag">占位</span>
        </button>
      </div>
      <div class="dfc-actions">
        <DataBasisBadge v-if="anySuccess" :basis="overallBasis" />
        <button
          class="rerun primary"
          :class="{ dirty: selectionDirty }"
          :disabled="busy || !selected.length"
          :title="!selected.length ? '请先选择至少一个模型'
            : selectionDirty ? '模型选择已更改，点此按新选择运行' : '按当前选择重新运行'"
          @click="runSelection()"
        >
          <Loader2 v-if="busy" :size="12" class="spin" /><Play v-else-if="selectionDirty" :size="12" /><RefreshCw v-else :size="12" />
          {{ busy ? '运行中…' : selectionDirty ? '运行预测' : '重跑' }}
        </button>
      </div>
    </div>

    <p v-if="selectionDirty && !busy" class="dfc-note warn">
      <AlertTriangle :size="12" />
      模型选择已更改，下方结果仍是上一次运行的（{{ ranSelection.length ? ranSelection.join('、') : '尚未运行' }}）。点「运行预测」按新选择运行。
    </p>
    <p v-if="catalog.error.value" class="dfc-note warn">
      <AlertTriangle :size="12" /> 模型目录加载失败：{{ catalog.error.value }}
    </p>

    <!-- 诚实空态：全部模型失败时不落合成曲线，给两个可操作出口 -->
    <div v-if="allFailed" class="dfc-empty">
      <AlertTriangle :size="18" />
      <p class="empty-title">{{ targetDate }} 无可用预测结果</p>
      <ul class="empty-reasons">
        <li v-for="o in outcomes" :key="o.modelId"><b>{{ o.name }}</b>：{{ o.error }}</li>
      </ul>
      <p class="empty-hint">未合成任何曲线——宁可空着，也不给一条看起来像预测的假数据。</p>
      <div class="empty-exits">
        <!-- 解析出可用区间末日 → 真的切过去（该日若在今天之前，申报台会自动把草稿模式切成
             历史模拟）。解析不出就只给模式切换，且**文案不承诺切日期**——原先那个按钮只改
             模式不改日期，用户点完仍停在同一个没有结果的未来日，空态根本没解除。 -->
        <button v-if="predictableUntil" @click="emit('suggest-date', predictableUntil)">
          <CalendarClock :size="12" /> 切到最近可预测日 {{ predictableUntil }}
        </button>
        <button v-else @click="emit('suggest-rehearsal')">
          <CalendarClock :size="12" /> 转历史模拟模式（需自行改到有数据的日期）
        </button>
      </div>
    </div>

    <template v-else>
      <UnifiedForecastChart
        v-if="chartSeries.length"
        :results="chartSeries"
        :height="240"
      />
      <div v-else class="dfc-placeholder">
        <Loader2 v-if="running" :size="16" class="spin" /> {{ running ? '正在运行所选模型…' : '请选择至少一个模型' }}
      </div>

      <table v-if="rows.length" class="dfc-table">
        <thead>
          <tr>
            <th>模型</th>
            <th title="模型在训练窗口内自报的 holdout 误差，非目标日实际误差">holdout MAE</th>
            <th>口径</th>
            <th>决策模型</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.modelId" :class="{ mock: !r.trustworthy, failed: !!r.error }">
            <td>
              <span v-if="r.rank" class="rank">#{{ r.rank }}</span>
              <span v-else class="rank rank-none" :title="r.notRankableReason || '不参与排名'">—</span>
              {{ r.name }}
              <span v-if="r.trustTag" class="chip-tag" :title="r.notRankableReason">{{ r.trustTag }}</span>
            </td>
            <td>{{ fmt(r.holdoutMae) }}</td>
            <td><DataBasisBadge v-if="r.basis" :basis="(r.basis as ForecastBasis)" /><span v-else>—</span></td>
            <td>
              <label v-if="!decisionBlockReason(r)" class="pick">
                <input type="radio" :checked="decisionModel === r.modelId" @change="setDecisionModel(r)" >
                <span>设为</span>
              </label>
              <span v-else class="blocked" :title="decisionBlockReason(r)">不可用</span>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-if="rows.some((r) => r.error)" class="dfc-note warn">
        <AlertTriangle :size="12" />
        <span v-for="r in rows.filter((x) => x.error)" :key="r.modelId">{{ r.name }}：{{ r.error }}；</span>
      </p>
      <p class="dfc-note">
        holdout MAE 为模型在训练窗口内自报，是它在训练窗口留出集上的误差，<b>不是目标日实际误差</b>；
        本页暂不提供「对目标日实际 MAE」——底层出清曲线取数需按日期抽取的地区适配器，未就绪前不显示，也不用近似值顶替。
      </p>
    </template>
  </div>
</template>

<style scoped>
.dfc { display: flex; flex-direction: column; gap: 8px; }
.dfc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.dfc-models { display: flex; flex-wrap: wrap; gap: 4px; }
.model-chip {
  padding: 2px 8px; border: 1px solid var(--el-border-color); border-radius: 10px;
  background: var(--el-fill-color-blank); font-size: 12px; cursor: pointer; color: var(--el-text-color-regular);
}
.model-chip.on { border-color: var(--el-color-primary); color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.model-chip.mock { border-style: dashed; }
.model-chip.off { opacity: 0.45; cursor: not-allowed; }
.chip-tag { margin-left: 3px; font-size: 10px; color: var(--el-color-warning); }
.dfc-actions { display: flex; align-items: center; gap: 6px; }
.rerun {
  display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; font-size: 12px;
  border: 1px solid var(--el-border-color); border-radius: 4px; background: var(--el-fill-color-blank); cursor: pointer;
}
/* 选择已改但未运行 → 主色高亮，提示这一步需要用户确认 */
.rerun.dirty {
  border-color: var(--el-color-primary); color: var(--el-color-primary);
  background: var(--el-color-primary-light-9); font-weight: 600;
}
.rerun:disabled { opacity: 0.5; cursor: not-allowed; }
.spin { animation: dfc-spin 1s linear infinite; }
@keyframes dfc-spin { to { transform: rotate(360deg); } }
.dfc-placeholder {
  height: 240px; display: flex; align-items: center; justify-content: center; gap: 6px;
  color: var(--el-text-color-secondary); font-size: 13px;
}
.dfc-empty {
  border: 1px dashed var(--el-color-warning); border-radius: 6px; padding: 14px;
  display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center;
  color: var(--el-text-color-regular);
}
.empty-title { font-size: 13px; font-weight: 600; margin: 0; }
.empty-reasons { margin: 0; padding-left: 16px; font-size: 12px; text-align: left; align-self: stretch; }
.empty-hint { margin: 0; font-size: 12px; color: var(--el-text-color-secondary); }
.empty-exits { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.empty-exits button {
  display: inline-flex; align-items: center; gap: 3px; padding: 3px 10px; font-size: 12px;
  border: 1px solid var(--el-color-primary); color: var(--el-color-primary); border-radius: 4px;
  background: var(--el-fill-color-blank); cursor: pointer;
}
.dfc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.dfc-table th, .dfc-table td { padding: 3px 6px; text-align: left; border-bottom: 1px solid var(--el-border-color-lighter); }
.dfc-table th { color: var(--el-text-color-secondary); font-weight: 500; }
.dfc-table tr.mock { background: var(--el-fill-color-light); }
.dfc-table tr.failed { color: var(--el-text-color-disabled); }
.rank { display: inline-block; min-width: 20px; color: var(--el-color-success); font-weight: 600; }
.rank-none { color: var(--el-text-color-disabled); font-weight: 400; }
.pick { display: inline-flex; align-items: center; gap: 3px; cursor: pointer; }
.blocked { color: var(--el-text-color-disabled); cursor: help; }
.dfc-note { margin: 0; font-size: 11px; color: var(--el-text-color-secondary); line-height: 1.5; }
.dfc-note.warn { color: var(--el-color-warning); display: flex; align-items: flex-start; gap: 4px; flex-wrap: wrap; }
/* 窄屏折叠「口径」列（第 3 列）。**不能折叠第 4 列**——撤掉「对目标日实际 MAE」后第 4 列
   正是「决策模型」单选，隐藏它等于让移动端用户既不能切换报价模型、也看不出当前选的是哪个，
   却仍能生成决策包。口径信息在表格角标与图例里另有呈现，折叠它不丢关键信息。 */
@media (max-width: 900px) {
  .dfc-table th:nth-child(3), .dfc-table td:nth-child(3) { display: none; }
}
</style>
