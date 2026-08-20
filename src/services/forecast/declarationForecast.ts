// 申报台价格预测的多模型编排（纯逻辑，便于单测；UI 在 DeclarationForecastCompare.vue）。
//
// 申报台左侧原先是 `fetchReplay('knn-api_api', date)` ，硬编码读采集族回放，请求里
// 连 model 字段都没有；云南该族只覆盖到 2026-07-01，默认目标日（明天）超区间即回 mock，
// 前端判 mock 后落 `synth96()` 正弦合成。也就是说那条曲线既不是 KNN 也不是真实数据。
//
// 现改走 forecastProviders 契约，可多模型叠加对比。两条纪律：
// 1. 失败不合成兜底：任一模型失败只记原因、不填假数据；全失败则空态给可操作出口。
// 2. 占位模型不参与排名：tslib:* 实为 StandardScaler+Ridge，实测 MAE 45.87 比最简单的
// ridge(42.96) 还差；若按 MAE 排序且不排除，用户会误以为它只是"表现一般的真实模型"。
//
// 本 PR 不做「实际出清参照曲线」与「对目标日实际 MAE」（原计划有，实测后撤下）：
// 底层 `loadClearingCurve` 对 `sdpt_zcqxhdl` 这类 listrs_full 数据集取不到正确数据
// 该族是 24 点（p1..p24），`fetchReplay` 为凑够 96 个数会横跨 4 行即 4 天，还会把非曲线
// 字段 `jz` 一并扫进来；且实测请求 yunnan 会拿到 `served: 'shanxi'` 的回退结果。这样得到
// 的序列被标成 `basis:'captured'`，一旦作为「实际出清（真实采集）」叠图并据此算 MAE，
// 就是把编造的真值标成真实，正是本文件其余部分要杜绝的事。需要按日期+类型抽取的
// 地区适配器才能做对，已另开技术债；在那之前宁可不显示。

import type { UnifiedForecastResult } from '@/services/forecast/forecastProviders'

/** 单个模型的一次运行结果（成功或失败都保留，失败也要能显示原因）。 */
export type ModelRunOutcome = {
  modelId: string
  name: string
  /** 失败时为 null */
  result: UnifiedForecastResult | null
  /** 失败原因（成功时 undefined），不吞掉，UI 要显示"为什么这个模型没出结果" */
  error?: string
  /**
   * 是否基线模型（`tier==='baseline'`，即 KNN）。
   * 后端的 `passes_gate` 定义是「比 KNN 基线改善 ≥10%」，对 KNN 自身在定义上就不适用：
   * `run_forecast` 用同一个 k 的 KNN 算 `knn_mae`，于是 `improve_vs_knn_pct` 恒为 0、
   * `passes_gate` 恒为 false（实测云南 2026-06-20：knn 0.0/false，xgboost 10.48/true）。
   * 不豁免的话，默认恒可用的基线会被判"未过门禁"，目录加载失败时更是全军覆没。
   */
  isBaseline?: boolean
}

export type CompareRow = {
  modelId: string
  name: string
  /** 训练窗口 holdout MAE（模型自报），非目标日实际误差 */
  holdoutMae: number | null
  rmse: number | null
  basis: string
  mock: boolean
  /** 本次结果是否可信到能拿去排名/报价（见 isTrustworthyForecast） */
  trustworthy: boolean
  /** 不可信的短标签（占位/合成/示意/未过门禁），供表格角标；可信时 undefined */
  trustTag?: string
  /** 排名；0 = 不参与排名 */
  rank: number
  /** rank=0 的原因，供 UI tooltip 说明"为什么这行没有名次" */
  notRankableReason?: string
  error?: string
}

/** 不可作为报价依据的口径。synthetic=纯合成，illustrative=示意/占位。 */
const UNTRUSTWORTHY_BASIS = new Set(['synthetic', 'illustrative'])

/**
 * 这一次运行的结果是否可信到能参与排名、能被设为决策模型。
 *
 * 只看 provider 的静态 mock 标志是不够的：后端 `forecast_service.run_forecast` 在真实
 * 回放缺失时会用合成数据兜底（`data_loader.load_price` 返回 `basis='synthetic'`），而普通
 * KNN/XGBoost 的 `result.mock` 仍是 false。历史演练日很容易命中，合成曲线会排到 #1、被
 * 自动设成决策模型，再拿去生成申报决策包。这正是本仓 Mock 纪律要挡的事（P1）。
 * 故必须按本次结果的 basis 判，而不是模型的静态属性。
 */
export function isTrustworthyForecast(
  result: Pick<UnifiedForecastResult, 'basis' | 'mock' | 'metrics'> | null | undefined,
  opts?: { isBaseline?: boolean }
): boolean {
  if (!result) return false
  if (result.mock === true) return false
  if (UNTRUSTWORTHY_BASIS.has(result.basis)) return false
  // 单日 holdout 门禁明确判负 → 拦。两处例外：
  // - 基线自身豁免：门禁定义是"比 KNN 改善 ≥10%"，对 KNN 恒为 0，判它不过是定义错位；
  // - 字段缺省放行：表示后端没跑门禁，不能据此把模型判死。
  if (opts?.isBaseline) return true
  return result.metrics?.passes_gate !== false
}

/**
 * 不可信的短标签，供图例后缀与表格角标。
 *
 * 必须逐类精确，不能一律写「占位」：`mock` 是"这个模型本身是假的"，`synthetic` 是"模型是
 * 真的但这一次拿合成数据算的"，`passes_gate:false` 是"真数据真模型但没打过基线"。混成一个
 * 词会让用户对不同性质的问题做出同样的误判。
 */
export function untrustworthyTag(
  result: Pick<UnifiedForecastResult, 'basis' | 'mock' | 'metrics'> | null | undefined,
  opts?: { isBaseline?: boolean }
): string | undefined {
  if (!result) return undefined
  if (result.mock === true) return '占位'
  if (result.basis === 'synthetic') return '合成'
  if (result.basis === 'illustrative') return '示意'
  if (!opts?.isBaseline && result.metrics?.passes_gate === false) return '未过门禁'
  return undefined
}

/**
 * 组装对比表。
 *
 * 排名规则：只有真实模型且有 holdout MAE 才参与排名，按 MAE 升序；占位模型与无指标
 * 模型 rank=0 并排在末尾，否则占位的 Ridge 可能因简单反而"夺冠"，是最危险的误导。
 */
export function buildCompareRows(outcomes: readonly ModelRunOutcome[]): CompareRow[] {
  const rows: CompareRow[] = outcomes.map((o) => {
    const r = o.result
    const mock = !!r?.mock
    const gateOpts = { isBaseline: o.isBaseline }
    const trustworthy = isTrustworthyForecast(r, gateOpts)
    return {
      modelId: o.modelId,
      name: o.name,
      holdoutMae: r?.metrics?.mae ?? null,
      rmse: r?.metrics?.rmse ?? null,
      basis: r?.basis ?? '',
      mock,
      trustworthy,
      trustTag: untrustworthyTag(r, gateOpts),
      rank: 0,
      notRankableReason: o.error
        ? '本次运行失败'
        : !r
          ? '无结果'
          : mock
            ? '占位实现（StandardScaler+Ridge），非真实模型'
            : UNTRUSTWORTHY_BASIS.has(r.basis)
              ? `本次结果口径为 ${r.basis}（真实数据缺失时后端以合成数据兜底），不代表真实精度`
              : (!o.isBaseline && r.metrics?.passes_gate === false)
              ? '未通过质量门禁（MAE 未比 KNN 基线改善到阈值）'
              : typeof r.metrics?.mae !== 'number'
                ? '本次运行未返回 MAE 指标'
                : undefined,
      error: o.error,
    }
  })

  const rankable = rows
    .filter((r) => r.trustworthy && !r.error && typeof r.holdoutMae === 'number')
    .sort((a, b) => (a.holdoutMae as number) - (b.holdoutMae as number))
  rankable.forEach((r, i) => { r.rank = i + 1; r.notRankableReason = undefined })

  // 排序展示：有名次的在前（按名次），其余按原顺序垫后
  return [...rows].sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank
    if (a.rank) return -1
    if (b.rank) return 1
    return 0
  })
}

/**
 * 从「越界」报错里解析后端自报的可用数据区间末日，用作空态出口「切到最近可预测日」。
 *
 * 后端 `forecast_service.run_forecast` 对越界目标日抛的是固定格式：
 *   `target_date=2027-01-01 不在可用数据范围内（2026-05-03..2026-07-01）；该日尚无基本面数据…`
 * 这里按严格模式匹配，解析不出就返回 null，此时 UI 不显示该出口，绝不猜一个日期给用户点。
 *
 * 已知取巧：区间本应由后端以结构化字段返回，而非让前端读报错文案。改契约会牵动
 * ForecastResult 与两端生成物，留作后续；此处的严格匹配 + 失败即不显示保证不会误导。
 */
export function parsePredictableUntil(outcomes: readonly ModelRunOutcome[]): string | null {
  const ends: string[] = []
  for (const o of outcomes) {
    const m = o.error?.match(/（(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})）/)
    if (m) ends.push(m[2])
  }
  if (!ends.length) return null
  // 多个模型可能覆盖不同区间，取最晚的那个末日（选它至少有一个模型能跑）
  return ends.reduce((a, b) => (a >= b ? a : b))
}

/** 可叠加到图上的曲线（失败模型不进图，宁可少一条线，也不画假数据）。 */
export function toChartSeries(
  outcomes: readonly ModelRunOutcome[]
): { provider: string; result: UnifiedForecastResult; untrustedTag?: string }[] {
  return outcomes
    .filter((o): o is ModelRunOutcome & { result: UnifiedForecastResult } => o.result !== null)
    .map((o) => ({
      provider: o.name,
      result: o.result,
      // 图是最醒目的元素：单日门禁判负的模型可能返回 captured 数据，若不带标签进图，
      // 它会和真实可信模型画成一模一样的实线，只看曲线的申报人员会把系统已判负的模型
      // 当作可信报价依据。标签在此算好交给图层，图层据此画虚线并在图例标注。
      untrustedTag: untrustworthyTag(o.result, { isBaseline: o.isBaseline }),
    }))
}

/**
 * 解出本批应生效的决策模型。
 *
 * 关键是把用户偏好与本批有效性分开：`run()` 开头会清空 outcomes（避免旧目标日的
 * 数据挂在新标题下），那一瞬间没有任何可用模型。若此时就把父视图的决策模型抹成空，新结果
 * 回来时只能回退到排名第一，用户手选的报价口径被静默改掉，而他毫无察觉。
 *
 * 优先级：用户显式偏好 → 上一次生效的模型 → 本批排名第一 → 本批首个可用。
 * 全都不可用时返回空串（调用方须先确认本批确实跑完了再据此回吐）。
 */
export function resolveDecisionModel(opts: {
  /** 本批中可作决策依据的模型 id */
  usableIds: readonly string[]
  /** 本批有名次的模型 id，按名次升序 */
  rankedIds: readonly string[]
  /** 用户在对比表里显式选过的模型 */
  preferred?: string
  /** 当前生效的模型（父视图持有） */
  current?: string
}): string {
  const usable = new Set(opts.usableIds)
  if (!usable.size) return ''
  if (opts.preferred && usable.has(opts.preferred)) return opts.preferred
  if (opts.current && usable.has(opts.current)) return opts.current
  const top = opts.rankedIds.find((id) => usable.has(id))
  return top ?? opts.usableIds[0]
}

// 曾存在的前端临时挡板 isIncapableForTarget（挡 price→physics_hybrid）已删除
// #1461 根因已闭环：后端目录按模型声明 supportedTargets，不支持该 target 的模型不再进目录，
// providersForTarget 据 supportedTargets 过滤，申报台/工作台/驾驶舱三页统一生效。

/** 默认选中集：knn（基线、恒可用、便宜）+ 首个非占位可用模型，最多 2 个，避免首屏并发过多。 */
export function defaultSelection(
  models: readonly { modelId: string; mock?: boolean; available?: boolean }[]
): string[] {
  const usable = models.filter((m) => m.available !== false && !m.mock)
  const knn = usable.find((m) => m.modelId === 'knn')
  const picked: string[] = knn ? [knn.modelId] : []
  // 补到 2 个：一条曲线谈不上"对比"，无 knn 时也应给出两个可用模型
  for (const m of usable) {
    if (picked.length >= 2) break
    if (!picked.includes(m.modelId)) picked.push(m.modelId)
  }
  return picked
}

/**
 * 决策模型（供 fetchCockpit / fetchOptimizeBid 使用）是否可用。
 *
 * 注意这里比"能不能出一条价格曲线"更严：`/forecast/cockpit` 拿同一个 `model_type` 跑两条腿
 * 先 `target=PRICE`，再 `target=LOAD`（`routes/forecast.py:940,952`）。只要模型在第二条腿上
 * 跑不了，整个决策包就 400，用户看到的是"价格对比好好的，一点生成就失败"。
 *
 * 四道门：
 * - 占位模型绝不可作为申报决策依据，它的输出是 StandardScaler+Ridge，与模型名无关。
 * - 后端标 `available:false` 的（权重未下载 / GPU 未配）跑不出来。
 * - **回放 provider（`kind:'replay'`，如 platform）不是 `/forecast/predict` 支持的
 *   `model_type`**，传给后端稳定报 `Unsupported forecast model: platform`，决策包永远失败。
 */
export function canBeDecisionModel(
  model: {
    id?: string
    mock?: boolean
    available?: boolean
    kind?: string
    supportedTargets?: string[]
  } | undefined | null
): boolean {
  if (!model) return false
  if (model.mock || model.available === false) return false
  if (model.kind === 'replay') return false
  // 外部训练模型 store：注册时在 store_meta 里绑定了 target，`run_forecast` 会校验
  // target 不符即拒。驾驶舱的 LOAD 那条腿必然撞上「target=price 的模型跑 load」而失败，
  // 于是决策包稳定 400。它们仍可参与价格对比（那条腿是好的），只是不能当决策模型。
  if (model.id?.startsWith('store:')) return false
  // 通用判据（Epic #1898 引入 remote: 后收口）：目录带 supportedTargets（#1461）而声明
  // 不含 load 的目标专用模型（remote: 单 target 绑定等），LOAD 腿同样必败，一律不可
  // 作决策模型；缺省该字段 = 全目标支持，放行。
  if (model.supportedTargets && !model.supportedTargets.includes('load')) return false
  // 这里不消费目录侧 `quality.passesSkillGate`。它的证据不可靠
  // `scoreboard_store.latest_report_path` 只按地区取最新报告（文件名 `<region>-<d0>_<d1>-<ts>.json`
  // 不含 target），`model_quality_map` 也不校验报告 basis。于是一次
  // `rolling_report --target renewable` 或跑在合成数据上的报告，其判负会被当成价格模型的
  // 门禁：既可能误杀有效价格模型，也可能因该模型未出现在报告里而缺省放行。拿这种证据挡
  // 报价模型，和拿它放行一样不负责任。
  // 需要目录质量携带并校验 `target=price` + 可信 basis 后才能重新启用，见技术债 #1460。
  // 单日 holdout 门禁（`metrics.passes_gate`）不受影响，它是按本次 target 现算的，口径正确。
  return true
}
