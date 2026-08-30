// 预测「深度融合」统一抽象层（Phase 1 / PR-A）。
// 把「平台官方回放(replay) / KNN(replay→Phase4 compute) / ML 6 模型(compute)」统一到一套
// ForecastProvider 契约下：选目标→选算法→配该算法参数→出统一结果(UnifiedForecastResult)，
// 让不同算法同台可选、同台对比。本文件只做契约 + 注册表 + 三类实现，不接入任何页面（PR-B 起接入）。
//
// 数据口径(basis)：platform/knn 回放真实采集=captured，缺数据=synthetic；ml 由后端透传。
// 全程不伪装 Mock：合成链路 basis=synthetic，调用方据此显示「仅验链路，非真实精度」。
import { ref, computed, watch, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { fetchCaptured } from '@/services/captured'
import {
  runForecastPredict,
  unavailableReasonOf,
  fetchForecastModels,
  type ForecastResult,
  type ForecastModel,
  type ModelQuality,
  type ModelShadowGate,
  type ModelStage,
} from '@/services/forecast/mlForecastClient'
import { FORECAST_CFGS, type ForecastCfg } from '@/data/forecastHubTabs'
import { getRegionModuleCapabilities, type RegionCapabilityDataSupport } from '@/services/region/regionModules'
import { currentRegion } from '@/services/region/regionContext'

// 契约
export type ProviderKind = 'replay' | 'compute' // 回放真实采集 | 后端实时计算

// ForecastBasis 单一权威定义在 services/data/types.ts（Phase 0 统一类型层，与
// dataBasis.ts::DataBasis 合并为 DataSourceBasis）。此处 re-export 保持兼容。
import type { ForecastBasis } from '../data/types'
// 预测标的注册表（主仓 shared/forecast/target-registry.mjs 经 sync:web 单向推送，本仓只读；dljy#2463）：
// 标的清单、中文名、原生粒度全部由它派生——此前 ML_TARGETS 与 Workbench TARGETS 各写一份 7 项硬编码，
// 与后端目录漂移（hydro/temp/用户侧结算电价缺）。
import { FORECAST_TARGETS, targetSlotsPerDay } from 'shared/forecast/target-registry.mjs'
import type { ModelIo, ModelLineage, ModelParamField } from '@/services/forecast/modelContract'
export type { ForecastBasis }

export type ParamFieldType = 'number' | 'slider' | 'select' | 'switch' | 'weight-group' | 'daterange'

export interface ParamField {
  key: string
  label: string
  type: ParamFieldType
  default: unknown
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: { label: string; value: unknown }[]
  // weight-group 的子项（多选维度，如 KNN 特征：风/光/负荷…）
  items?: { key: string; label: string }[]
  // 联动显隐：返回 false 时该控件隐藏（如 Conformal 仅在概率预测开启时可见）
  visibleWhen?: (params: Record<string, unknown>) => boolean
}

export interface UnifiedForecastResult {
  points: number[]
  lower?: number[]
  upper?: number[]
  unit: string
  basis: ForecastBasis
  mock?: boolean // true=占位/合成实现（如 tslib compat=Ridge），禁止当真实精度下注
  granularity: 24 | 96
  modelId: string
  metrics?: {
    mae?: number
    rmse?: number
    mase?: number
    improve_vs_knn_pct?: number
    passes_gate?: boolean
    // #764 共形校准标注（probabilistic 时后端 prob_metrics 透传），供区间带/工作台动态文案读取
    conformal?: boolean
    nominal_coverage?: number
    quantile_source?: string
    picp?: number
  }
  warnings?: string[]
  // 目标日**事后真值**与基线曲线（#2371）。后端本就用它们算 metrics/baseline_metrics，
  // 此前不返回，图上只有一条孤立的预测曲线——看图的人无从判断预测贴不贴、错在哪个时段。
  // 只有后端计算型算法（/predict）有；平台官方回放等 replay provider 不产出，留空。
  // 逐时段：已出清给数值、尚未出清给 null（#2389）。长度与 points 一致，null 不是「缺数据」
  // 而是「这个时段还没发生」——图上据此让实线在当前边界处自然断开。
  actual?: (number | null)[]
  // official：官方发布的日前预测（由页面按地区/目标另行取数注入，非后端产出）。
  // naive/knn 是「我们自己的最笨参照」，official 是「行业里已有的答案」——模型跑赢前者
  // 说明不了什么，跑赢后者才是能拿出去讲的结论。
  baselines?: { naive?: number[]; knn?: number[]; official?: number[] }
  // backtest = 目标日已完全出清、全天真值可得；partial = 只出清了一部分时段，指标只基于
  // 那部分；forecast = 尚未出清、没有真值，后端不给任何精度指标（#2387 / #2389）。
  evaluationMode?: 'backtest' | 'partial' | 'forecast'
}

export interface SharedTaskContext {
  regionId: string
  target: string
  targetDate?: string
  granularity: 24 | 96
  historyDays: number
}

export interface ForecastProvider {
  id: string // 'platform' | 'knn' | 'xgboost' | 'lightgbm' | 'random_forest' | 'mlp' | 'nbeats' | 'tft'
  name: string
  kind: ProviderKind
  tier: 'official' | 'baseline' | 'core' | 'neural' | 'deep'
  mock?: boolean // true=占位/合成实现（tslib compat=Ridge），UI 需显示占位角标，决策端应降权/拒用
  available?: boolean // 来自后端 catalog（#762）：false=不可用（权重未下载/GPU 未配等），选择器禁用；platform/knn 恒可用不设
  reason?: string     // available=false 时的原因说明（选择器 tooltip）
  stage?: ModelStage
  shadowGate?: ModelShadowGate
  quality?: ModelQuality
  basisVersion?: string
  supportedTargets: string[]
  paramsSchema: ParamField[]
  // dljy#2464：模型自述（远端模型有）——输入门槛（协变量 × 平台供给）、血统、来源、架构、单位
  io?: ModelIo
  lineage?: ModelLineage
  source?: string
  framework?: string
  unit?: string
  run(ctx: SharedTaskContext, params: Record<string, unknown>): Promise<UnifiedForecastResult>
}

/** 模型声明的 paramsSchema（可序列化子集）→ 面板控件；键与平台参数撞名时以平台为准（丢弃模型项并保留可见）。 */
export function modelParamFields(schema: ModelParamField[] | undefined, reserved: ReadonlySet<string>): ParamField[] {
  return (schema ?? []).filter((p) => !reserved.has(p.key)).map((p) => ({
    key: p.key,
    label: p.noteZh ? `${p.label}（${p.noteZh}）` : p.label,
    type: p.type,
    default: p.default,
    ...(p.min !== undefined ? { min: p.min } : {}),
    ...(p.max !== undefined ? { max: p.max } : {}),
    ...(p.step !== undefined ? { step: p.step } : {}),
    ...(p.unit ? { unit: p.unit } : {}),
    ...(p.options ? { options: p.options.map((o) => ({ label: o.label, value: o.value })) } : {}),
  }))
}

/** 只把模型声明过的键送进 /predict 的 extra.params（平台参数与未声明键不发——后端同样只转发声明键）。 */
export function modelParamsFromInputs(schema: ModelParamField[] | undefined, params: Record<string, unknown>): Record<string, unknown> | undefined {
  const keys = new Set((schema ?? []).map((p) => p.key))
  if (!keys.size) return undefined
  const out = Object.fromEntries(Object.entries(params).filter(([k, v]) => keys.has(k) && v !== undefined))
  return Object.keys(out).length ? out : undefined
}

// 通用工具
const PTS = Array.from({ length: 96 }, (_, i) => `p${i + 1}`)

// 24/96 粒度对齐：96 点 → 24 点（每 4 个 15min 槽聚合为 1 个整点，取均值）。
// Phase 4 后端原生支持 granularity 后此前端聚合可下沉，contract 保持不变。
/** 96 点 → 24 点（时段内取均值）。导出供页面注入官方基线时复用同一套聚合，避免两处口径漂移。 */
export function aggregate96to24(points: (number | null)[]): number[] {
  const out: number[] = []
  for (let h = 0; h < 24; h++) {
    const slice = points.slice(h * 4, h * 4 + 4).filter((v): v is number => Number.isFinite(v))
    // 整小时都没有真值（尚未出清）→ NaN，由图层画成断点。不补 0：一条贴地的实际值
    // 曲线看起来像「这小时电价为零」，而不是「这小时还没发生」。
    out.push(slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : NaN)
  }
  return out
}

/** 工作台可选标的：注册表里平台有取数路径、且是日内曲线（15/60 分钟）的标的。日频标的（中长期价）归中长期页。 */
export const FORECAST_TARGET_OPTIONS: { id: string; name: string; slotsPerDay: number }[] = FORECAST_TARGETS
  .filter((t) => t.dataSource.status === 'available' && (t.granularity === '15min' || t.granularity === '60min'))
  .map((t) => ({ id: t.id, name: t.labelZh, slotsPerDay: targetSlotsPerDay(t.id) ?? 96 }))

/** 标的原生每日点数（15 分钟 → 96、60 分钟 → 24）；未登记标的按 96 处理（旧行为）。 */
export function nativeSlotsForTarget(target: string): number {
  return targetSlotsPerDay(target) ?? 96
}

/**
 * 请求粒度：15 分钟标的按用户选择（96 原生 / 24 聚合）；60 分钟标的原生就是 24 点，**不能再聚合**
 * （dljy#2463：用户侧结算电价原生 24 点再走一次 96→24 聚合会被压成 6 点）。
 */
export function granularityForTarget(target: string, chosen: 24 | 96): 24 | 96 {
  return nativeSlotsForTarget(target) === 96 ? chosen : 24
}

function applyGranularity(result: UnifiedForecastResult, granularity: 24 | 96): UnifiedForecastResult {
  // 只有「结果是 96 点且要求 24 点」才聚合；结果本就是 24 点（60 分钟标的）或其它粒度一律原样返回
  if (granularity === 96 || result.granularity !== 96) return result
  return {
    ...result,
    points: aggregate96to24(result.points),
    lower: result.lower ? aggregate96to24(result.lower) : undefined,
    upper: result.upper ? aggregate96to24(result.upper) : undefined,
    // 真值/基线同样要降采样——漏掉这里，24 点模式下它们仍是 96 点，与横轴逐点错位，
    // 画出来是一条"看着像但对不上"的线，比不画更糟。
    actual: result.actual ? aggregate96to24(result.actual) : undefined,
    baselines: result.baselines
      ? {
          naive: result.baselines.naive ? aggregate96to24(result.baselines.naive) : undefined,
          knn: result.baselines.knn ? aggregate96to24(result.baselines.knn) : undefined,
          official: result.baselines.official ? aggregate96to24(result.baselines.official) : undefined,
        }
      : undefined,
    granularity: 24,
  }
}

// 平台官方回放：把采集 family 的某一日 96 点行(p1..p96)解析为曲线。
// 复刻 ForecastDailyCurve 的取数口径（rows/data + dateField + p1..p96）。
type PlatformCfg = ForecastCfg & { typeFilter?: string }
function parseCfgCurve(
  body: any,
  cfg: PlatformCfg,
  targetDate?: string,
): { points: number[]; unit: string; dateUsed: string | null; warnings: string[] } {
  const warnings: string[] = []
  const all: any[] = body?.rows || body?.data || []
  const dateField = cfg.dateField || 'date'
  let rows = all
  // 多类型 family（zxztqa/zgnrx）：默认取「总」(typeLabels 中文为「总」的那一档)。
  if (cfg.typeField && cfg.typeLabels) {
    const totalKey = Object.entries(cfg.typeLabels).find(([, v]) => v === '总')?.[0]
    if (totalKey != null) rows = rows.filter((r) => String(r[cfg.typeField!]) === String(totalKey))
  } else if (cfg.typeField) {
    // 单 dict 多 type（如 jgyc 价格预测）：PR-A 暂取该日期任一行，精确分型解析在 PR-C（模式 D 接入 Hub）完善。
    warnings.push('该目标为多类型采集，平台官方曲线的精确分型解析将在工作台「多目标总览」(PR-C) 完善')
  }
  const dates = [...new Set(rows.map((r) => r[dateField]))].filter(Boolean).sort() as string[]
  if (!dates.length) return { points: [], unit: cfg.unit, dateUsed: null, warnings }
  const pick = targetDate && dates.includes(targetDate) ? targetDate : dates[dates.length - 1]
  const row = rows.filter((r) => r[dateField] === pick).pop()
  const points = PTS.map((p) => Number(row?.[p] ?? NaN))
  return { points, unit: cfg.unit, dateUsed: pick, warnings }
}

// Provider 实现

// target → 平台官方采集 cfg 映射（缺失的 target 表示平台无官方采集，platform provider 不支持）。
const PLATFORM_TARGET_CFG: Record<string, PlatformCfg> = {
  price: FORECAST_CFGS.jgyc,
  load: FORECAST_CFGS.gsfhyc,
  renewable: FORECAST_CFGS.zxztqa,
  bidding_space: FORECAST_CFGS.jjkj,
  thermal: FORECAST_CFGS.rqhdcl,
}

function forecastDataSupports(regionId?: string): RegionCapabilityDataSupport[] {
  if (!regionId) return []
  return getRegionModuleCapabilities(regionId)
    .find(({ module }) => module.group === 'forecast')
    ?.module.dataSupportByRegion[regionId] ?? []
}

function hasRealForecastFamilySupport(regionId: string | undefined, family: string): boolean {
  if (!regionId) return true
  return forecastDataSupports(regionId).some((support) =>
    support.expectation === 'real' && (support.families ?? []).includes(family))
}

function platformTargetCfgForRegion(regionId: string | undefined, target: string): PlatformCfg | null {
  const cfg = PLATFORM_TARGET_CFG[target]
  if (!cfg) return null
  return hasRealForecastFamilySupport(regionId, cfg.family) ? cfg : null
}

export function platformTargetsForRegion(regionId?: string): string[] {
  return Object.entries(PLATFORM_TARGET_CFG)
    .filter(([, cfg]) => hasRealForecastFamilySupport(regionId, cfg.family))
    .map(([target]) => target)
}

export const platformProvider: ForecastProvider = {
  id: 'platform',
  name: '平台官方',
  kind: 'replay',
  tier: 'official',
  supportedTargets: Object.keys(PLATFORM_TARGET_CFG),
  paramsSchema: [], // 官方回放无可调参数
  async run(ctx) {
    const cfg = platformTargetCfgForRegion(ctx.regionId, ctx.target)
    if (!cfg) {
      return {
        points: [], unit: '', basis: 'synthetic', granularity: ctx.granularity, modelId: 'platform',
        warnings: [`当前地区暂无「${ctx.target}」目标的平台官方真实采集支撑`],
      }
    }
    const body = await fetchCaptured<any>(cfg.family, cfg.match)
    const parsed = parseCfgCurve(body, cfg, ctx.targetDate)
    const hasData = parsed.points.some((v) => Number.isFinite(v))
    return applyGranularity(
      {
        points: parsed.points,
        unit: parsed.unit,
        basis: hasData ? 'captured' : 'synthetic',
        granularity: 96,
        modelId: 'platform',
        warnings: [
          ...parsed.warnings,
          ...(parsed.dateUsed ? [`官方采集日：${parsed.dateUsed}`] : ['未命中采集数据']),
        ],
      },
      ctx.granularity,
    )
  },
}

// KNN：当前回放 knn-api 采集预测曲线（kind=replay）。Phase 4(PR-D) 后端计算化后改 kind=compute、
// 走 /predict?model_type=knn，参数面板真生效并返回分位数区间。当前 paramsSchema 已就位但回放不消费。
/**
 * 响应可用性校验，两条 provider 路径（固定 knn / 动态 ML）必须共用。
 *
 * Core 转发模式（`DLJY_FORECAST_FORWARD_CORE=1`）下 Core 不可达或公司上下文不可解析时，
 * `/forecast/predict` 返回 HTTP 200 + `available:false` + 空 points + `unavailable_reason`。
 * 不在此转成失败，消费方就把"服务不可用"当成一次成功预测（空曲线）：全失败空态不出现、
 * 真实原因丢失，还可能把真实模型误描述成占位实现。
 *
 * 尤其注意 knn 是申报台的默认选中模型，只修 makeMlProvider 等于漏掉最常走的那条路径。
 */
function assertUsableForecast(r: ForecastResult): void {
  if (r?.available === false) {
    throw new Error(unavailableReasonOf(r) || '预测服务当前不可用（Core 转发未返回结果）')
  }
  if (!r?.points?.some((v) => Number.isFinite(v))) {
    throw new Error('预测服务返回空曲线（无任何有效点位）')
  }
}

export const knnProvider: ForecastProvider = {
  id: 'knn',
  name: 'KNN 相似日（基线）',
  kind: 'compute',
  tier: 'baseline',
  supportedTargets: ['price', 'load', 'renewable'],
  paramsSchema: [
    { key: 'k1', label: '相似日数量 K1（价格区间）', type: 'slider', default: 8, min: 1, max: 30, step: 1 },
    { key: 'k2', label: '相似日数量 K2（火电出力）', type: 'slider', default: 3, min: 1, max: 30, step: 1 },
    { key: 'lowerPct', label: '下界分位 P下', type: 'number', default: 25, min: 0, max: 100, step: 5, unit: '%' },
    { key: 'upperPct', label: '上界分位 P上', type: 'number', default: 75, min: 0, max: 100, step: 5, unit: '%' },
    {
      key: 'features', label: '相似日特征维度', type: 'weight-group', default: ['wind', 'solar', 'load'],
      items: [
        { key: 'wind', label: '日前风电' }, { key: 'solar', label: '日前光伏' },
        { key: 'load', label: '日前负荷' }, { key: 'export', label: '日前外送' },
        { key: 'muststop', label: '日前必停' }, { key: 'others', label: '其他(含浮接量)' },
      ],
    },
  ],
  async run(ctx, params) {
    // Phase 4：KNN 已后端计算化，走 /predict?model_type=knn，k 经 extra 透传真生效（与 ML 同端点同契约）。
    const r = await runForecastPredict({
      region_id: ctx.regionId, target: ctx.target, model_type: 'knn',
      train_days: ctx.historyDays, data_source: 'auto', target_date: ctx.targetDate,
      extra: { k: Number(params.k1 ?? 8), features: params.features },
    })
    assertUsableForecast(r)
    return adaptMlResult(r, 'knn', ctx.granularity, nativeSlotsForTarget(ctx.target))
  },
}

// ML：6 个后端模型（compute）。包 mlForecastClient.runForecastPredict，适配 ForecastResult→统一契约。
const ML_PARAM_KEYS: ReadonlySet<string> = new Set(['train_days', 'probabilistic', 'conformal'])
const ML_PARAMS: ParamField[] = [
  { key: 'train_days', label: '训练回看(天)', type: 'number', default: 180, min: 30, max: 365, step: 30 },
  { key: 'probabilistic', label: '概率预测 P10–P90', type: 'switch', default: false },
  {
    key: 'conformal', label: 'Conformal 校准', type: 'switch', default: false,
    visibleWhen: (p) => p.probabilistic === true,
  },
]

// #762 模型清单动态化：ML 模型不再硬编码，从后端 /forecast/models（registry.catalog 单一权威）
// 拉取，新模型（含 fm:Chronos 基础模型）上线自动出现，不可用模型带 available:false + reason。
// 平台官方(platform)/KNN 基线(knn) 是前端专属 provider（非后端 catalog 模型），保留固定。
type CatalogTargetInput = string | readonly string[] | undefined

// #54：预测目录按「地区 + target」分桶缓存。否则首载 price 会吞掉小时用户电价 target，
// 或 price/load 共页时把 fixed provider 的 quality/available 串到另一条腿。
const catalogModelsByKey = ref<Record<string, ForecastModel[]>>({})
const catalogLoadingByKey = ref<Record<string, boolean>>({})
const catalogErrorByKey = ref<Record<string, string>>({})
const catalogLoadedByKey: Record<string, boolean> = Object.create(null)
const catalogReqByKey: Record<string, number> = Object.create(null)

function catalogKey(regionId: string, target: string): string {
  return `${regionId}::${target}`
}

function normalizeCatalogTargets(input: CatalogTargetInput): string[] {
  if (Array.isArray(input)) {
    const targets = [...new Set(input.map((v) => String(v ?? '').trim()).filter(Boolean))]
    return targets.length ? targets : ['price']
  }
  const target = String(input ?? 'price').trim()
  return [target || 'price']
}

function omitCatalogEntry<T>(source: Record<string, T>, key: string): Record<string, T> {
  if (!(key in source)) return source
  const { [key]: _dropped, ...rest } = source
  return rest
}

function readCatalogModels(regionId: string, target: string): ForecastModel[] {
  return catalogModelsByKey.value[catalogKey(regionId, target)] ?? []
}

function loadedTargetsForRegion(regionId: string): string[] {
  const prefix = `${regionId}::`
  return Object.keys(catalogLoadedByKey)
    .filter((key) => catalogLoadedByKey[key] === true && key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
}

function loadingTargetsForRegion(regionId: string): string[] {
  const prefix = `${regionId}::`
  return Object.keys(catalogLoadingByKey.value)
    .filter((key) => catalogLoadingByKey.value[key] === true && key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
}

function mergeCatalogModels(regionId: string, targets: readonly string[]): ForecastModel[] {
  const merged: ForecastModel[] = []
  const seen = new Set<string>()
  for (const target of targets) {
    for (const model of readCatalogModels(regionId, target)) {
      const key = `${target}::${model.modelId}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(model)
    }
  }
  return merged
}

function joinCatalogErrors(regionId: string, targets: readonly string[]): string {
  const errors = [...new Set(targets
    .map((target) => catalogErrorByKey.value[catalogKey(regionId, target)] ?? '')
    .filter(Boolean))]
  return errors.join('；')
}

function anyCatalogLoading(regionId: string, targets: readonly string[]): boolean {
  return targets.some((target) => catalogLoadingByKey.value[catalogKey(regionId, target)] === true)
}

function resolveEnsureCatalogArgs(
  targetOrForce: CatalogTargetInput | boolean = 'price',
  forceOrRegion?: boolean | string,
  regionIdArg?: string,
): { targets: string[]; force: boolean; regionId: string } {
  let targets: string[] = ['price']
  let force = false
  let regionId = currentRegion.value.id
  if (typeof targetOrForce === 'boolean') {
    force = targetOrForce
  } else {
    targets = normalizeCatalogTargets(targetOrForce)
  }
  if (typeof forceOrRegion === 'boolean') force = forceOrRegion
  if (typeof forceOrRegion === 'string') regionId = forceOrRegion
  if (regionIdArg) regionId = regionIdArg
  return { targets, force, regionId }
}

async function loadCatalogTarget(target: string, force: boolean, regionId: string): Promise<void> {
  const key = catalogKey(regionId, target)
  if (catalogLoadedByKey[key] && !force) return
  const req = (catalogReqByKey[key] ?? 0) + 1
  catalogReqByKey[key] = req
  catalogLoadingByKey.value = { ...catalogLoadingByKey.value, [key]: true }
  catalogErrorByKey.value = omitCatalogEntry(catalogErrorByKey.value, key)
  try {
    const res = await fetchForecastModels(target, regionId)
    if (catalogReqByKey[key] !== req) return
    catalogModelsByKey.value = {
      ...catalogModelsByKey.value,
      [key]: Array.isArray(res?.models) ? res.models : [],
    }
    catalogLoadedByKey[key] = true
  } catch (e) {
    if (catalogReqByKey[key] !== req) return
    catalogModelsByKey.value = omitCatalogEntry(catalogModelsByKey.value, key)
    catalogErrorByKey.value = {
      ...catalogErrorByKey.value,
      [key]: e instanceof Error ? e.message : '模型目录加载失败',
    }
    delete catalogLoadedByKey[key]     // 失败不缓存，下次同地区同 target 仍重试
  } finally {
    if (catalogReqByKey[key] === req) {
      catalogLoadingByKey.value = omitCatalogEntry(catalogLoadingByKey.value, key)
    }
  }
}

// 加载后端模型目录。保留 ensureForecastCatalog(true) 旧调用语义，同时允许显式指定 target/targets + region。
export async function ensureForecastCatalog(
  targetOrForce: CatalogTargetInput | boolean = 'price',
  forceOrRegion?: boolean | string,
  regionIdArg?: string,
): Promise<void> {
  const { targets, force, regionId } = resolveEnsureCatalogArgs(targetOrForce, forceOrRegion, regionIdArg)
  await Promise.all(targets.map((target) => loadCatalogTarget(target, force, regionId)))
}

// 全局地区切换 → 已消费过的 target 在新地区强制刷新（quality/skill 地区维；否则切区仍显旧区目录）。
watch(() => currentRegion.value.id, (regionId, prevRegionId) => {
  if (!prevRegionId || regionId === prevRegionId) return
  const targets = [...new Set([...loadedTargetsForRegion(prevRegionId), ...loadingTargetsForRegion(prevRegionId)])]
  if (targets.length) void ensureForecastCatalog(targets, true, regionId)
})

// 供页面读取 target-scope 的 catalog 加载态（选择器空态/失败提示）。
export function forecastCatalogState(
  targetsInput: MaybeRefOrGetter<CatalogTargetInput> = 'price',
  regionIdInput?: MaybeRefOrGetter<string | undefined>,
): { models: ComputedRef<ForecastModel[]>; loading: ComputedRef<boolean>; error: ComputedRef<string> } {
  const models = computed(() => {
    const regionId = toValue(regionIdInput) || currentRegion.value.id
    const targets = normalizeCatalogTargets(toValue(targetsInput))
    return mergeCatalogModels(regionId, targets)
  })
  const loading = computed(() => {
    const regionId = toValue(regionIdInput) || currentRegion.value.id
    const targets = normalizeCatalogTargets(toValue(targetsInput))
    return anyCatalogLoading(regionId, targets)
  })
  const error = computed(() => {
    const regionId = toValue(regionIdInput) || currentRegion.value.id
    const targets = normalizeCatalogTargets(toValue(targetsInput))
    return joinCatalogErrors(regionId, targets)
  })
  return { models, loading, error }
}

// 后端 registry tier（core/neural/deep/official/baseline/…）→ ForecastProvider tier，未知归 core。
function normalizeTier(tier: unknown): ForecastProvider['tier'] {
  const t = String(tier ?? '')
  return (t === 'official' || t === 'baseline' || t === 'core' || t === 'neural' || t === 'deep') ? t : 'core'
}

// 由注册表派生（顺序 = ForecastTarget 枚举顺序）；后端目录缺省 supportedTargets 时回退全集
const ML_TARGETS = FORECAST_TARGET_OPTIONS.map((t) => t.id)

function adaptMlResult(r: ForecastResult, modelId: string, granularity: 24 | 96, nativeSlots = 96): UnifiedForecastResult {
  // 区间带按本标的原生点数判齐全（此前写死 96：60 分钟标的的 24 点区间会被当成「没有区间」）
  const hasBand = r.lower?.length === nativeSlots && r.upper?.length === nativeSlots
  return applyGranularity(
    {
      points: r.points,
      lower: hasBand ? r.lower : undefined,
      upper: hasBand ? r.upper : undefined,
      unit: r.unit,
      basis: r.basis,
      mock: r.mock,
      granularity: (nativeSlots === 24 ? 24 : 96),
      modelId,
      metrics: {
        mae: r.metrics?.mae,
        rmse: r.metrics?.rmse,
        mase: r.metrics?.mase_vs_naive,
        improve_vs_knn_pct: r.metrics?.improve_vs_knn_pct,
        passes_gate: r.metrics?.passes_gate,
        // #764 共形校准标注透传（probabilistic 时后端 prob_metrics 产出）
        conformal: r.metrics?.conformal,
        nominal_coverage: r.metrics?.nominal_coverage,
        quantile_source: r.metrics?.quantile_source,
        picp: r.metrics?.picp,
      },
      warnings: r.warnings,
      // 后端缺字段（Core 转发模式、旧版本后端）时留空，图层据此不画真值线——
      // 不用空数组占位，否则消费方分不清「没有真值」与「真值全 0」。
      actual: r.actual?.length ? r.actual : undefined,
      baselines: (r.baseline_curves?.naive?.length || r.baseline_curves?.knn?.length)
        ? { naive: r.baseline_curves?.naive, knn: r.baseline_curves?.knn }
        : undefined,
      evaluationMode: r.evaluation_mode === 'backtest' ? 'backtest'
        : r.evaluation_mode === 'partial' ? 'partial'
          : r.evaluation_mode === 'forecast' ? 'forecast' : undefined,
    },
    granularity,
  )
}

// /predict（run_forecast）支持直算的 namespace + knn（baseline namespace 但后端有专用分支）。
// store: 外部生产模型也支持，经 base_models.create_model 的 store 分支（load_production_model），
// 运行时按 store_meta 校验 target/region（forecast_service）。
// 仅 baseline 的 naive/seasonal_naive 与 fm:（基础模型走 /forecast/foundation 端点）/predict 直算会
// ValueError，选择器标 available:false + reason 禁用不隐藏（工作台+驾驶舱共用）。
// remote：远程推理服务模型（Epic #1898），train no-op、predict 经 agent-backend 转发外部服务
const PREDICT_NAMESPACES = new Set(['base', 'deep', 'neural', 'tslib', 'store', 'remote'])
export function isPredictSupported(model: Pick<ForecastModel, 'modelId' | 'namespace'>): boolean {
  if (model.modelId === 'knn') return true
  return PREDICT_NAMESPACES.has(String(model.namespace ?? ''))
}

/**
 * 申报决策驾驶舱的「某腿能不能选这个模型」判据（#2324）。
 *
 * 三道门：后端能力位 available、/predict 直算支持、**该腿的 target 被声明**。
 * 第三道按腿判而不是要求一个模型两腿全覆盖——后者会把 remote: 与 store: 这类
 * 单 target 上架的真实模型整体挡在选择之外（#1461/#1898 的原限制），而那条限制的
 * 真实来源只是 /cockpit 聚合端点只收一个 model_type，不该扩散到四个带显式 target
 * 的调用点上。未声明 supportedTargets 的（core 模型）视为两腿都支持。
 */
export function isModelSelectableForTarget(
  model: Pick<ForecastModel, 'modelId' | 'namespace' | 'available' | 'supportedTargets'>,
  target: 'price' | 'load'
): boolean {
  if (!model.available || !isPredictSupported(model)) return false
  const declared = model.supportedTargets
  if (declared && !declared.includes(target)) return false
  return true
}

/**
 * 发预测请求前的「拦不拦」判定（#2326）：返回非空串即为拦截原因，空串表示可以发。
 *
 * 为什么要拦而不是让请求自己失败：不传 model_type 时后端会用它的默认模型，请求会成功、
 * 页面会出数字——但那不是用户选的模型，属于静默回落。目录空 / 目录加载失败 / 选中项已
 * 不在可选集合，三种情况都必须如实说，不能拿一个来路不明的默认结果冒充。
 */
export function predictBlockerReason(input: {
  catalogError: string
  selectable: ReadonlyArray<{ modelId: string }>
  selectedModelId: string
  targetLabel: string
}): string {
  if (input.catalogError) return `模型目录加载失败：${input.catalogError}`
  if (!input.selectable.length) return `当前地区没有可用于${input.targetLabel}的模型（模型目录为空或全部不可用）`
  if (!input.selectable.some((m) => m.modelId === input.selectedModelId)) return '所选预测模型当前不可用，请另选模型'
  return ''
}

function makeMlProvider(model: ForecastModel): ForecastProvider {
  const isMock = model.provenance.mock === true
  const predictSupported = isPredictSupported(model)
  return {
    id: model.modelId,
    name: model.name ?? model.modelId,
    kind: 'compute',
    tier: normalizeTier(model.tier),
    mock: isMock,
    available: predictSupported ? model.available : false,
    reason: predictSupported ? (model.unavailableReason ?? undefined) : (model.unavailableReason || '当前预测端点不支持（基线/基础模型走回测或专用端点）'),
    stage: model.stage,
    shadowGate: model.shadowGate,
    quality: model.quality,
    basisVersion: model.basisVersion,
    // #1461：逐模型支持的目标清单以后端目录为准（physics_hybrid 仅 renewable 等）；
    // 后端缺省该字段时回退 ML_TARGETS（全集），保旧目录兼容。
    supportedTargets: model.supportedTargets ?? ML_TARGETS,
    // 平台参数（训练回看/概率/共形）+ 模型自己声明的可调参数（dljy#2464：按 paramsSchema 渲染，不再一套配所有）
    paramsSchema: [...ML_PARAMS, ...modelParamFields(model.paramsSchema, ML_PARAM_KEYS)],
    io: model.io,
    lineage: model.lineage,
    source: model.source,
    framework: model.framework,
    unit: model.unit,
    async run(ctx, params) {
      const modelParams = modelParamsFromInputs(model.paramsSchema, params)
      const r = await runForecastPredict({
        region_id: ctx.regionId,
        target: ctx.target,
        model_type: model.modelId,
        train_days: Number(params.train_days ?? ctx.historyDays ?? 180),
        data_source: 'auto',
        probabilistic: params.probabilistic === true,
        conformal: params.probabilistic === true && params.conformal === true,
        target_date: ctx.targetDate,
        ...(modelParams ? { extra: { params: modelParams } } : {}),
      })
      assertUsableForecast(r)
      const out = adaptMlResult(r, model.modelId, ctx.granularity, nativeSlotsForTarget(ctx.target))
      if (isMock) {
        // 占位模型（tslib compat=Ridge）：前端兜底强制 illustrative + 占位警告，
        // 即便后端漏标也不会把占位结果当真实精度展示/下注。
        out.basis = 'illustrative'
        out.mock = true
        out.warnings = [
          `⚠️ ${model.name ?? model.modelId} 为 StandardScaler+Ridge 占位实现，非真实神经网络；仅作链路演示，禁止用于真实报价/申报。`,
          ...(out.warnings ?? []),
        ]
      }
      return out
    },
  }
}

// 注册表
// 响应式（#762）：platform/knn 固定 + ML 从后端 catalog（mlCatalog ref）动态构建；
// catalog 加载后消费方 computed 自动更新。页面须先 ensureForecastCatalog() 触发加载。
// 固定 provider（platform/knn）不走 makeMlProvider，但 catalog 里同 id 的条目仍带地区维
// quality（skill 门禁相对该地区回测基线）。不合并的话，knn 的 quality 永远是 undefined，
// 消费方据此判"目录未标注"而放行，记分牌明确 passesSkillGate=false 也拦不住（#1453）。
// 只并 quality/stage/shadowGate/basisVersion 这些目录侧事实，不动 available（knn 恒可用）
// 与 run（固定 provider 有自己的 extra.k 等自定义逻辑）。
function withCatalogQuality(provider: ForecastProvider, target = 'price', regionId = currentRegion.value.id): ForecastProvider {
  const entry = readCatalogModels(regionId, target).find((m) => m.modelId === provider.id)
  if (!entry) return provider
  return {
    ...provider,
    quality: entry.quality ?? provider.quality,
    stage: entry.stage ?? provider.stage,
    shadowGate: entry.shadowGate ?? provider.shadowGate,
    basisVersion: entry.basisVersion ?? provider.basisVersion,
  }
}

function providersFromCatalog(target = 'price', regionId = currentRegion.value.id): ForecastProvider[] {
  const models = readCatalogModels(regionId, target)
  return [
    withCatalogQuality(platformProvider, target, regionId),
    withCatalogQuality(knnProvider, target, regionId),
    // 排除与前端固定 provider 重复的 catalog id：knn/platform 由固定 provider 承担自定义逻辑
    // （如 knn 的 extra.k、platform 的回放），否则重复 Vue key + PROVIDER_MAP 覆盖丢失固定行为。
    ...models.filter((m) => m.modelId !== 'knn' && m.modelId !== 'platform').map(makeMlProvider),
  ]
}

// 向后兼容：无 target 上下文的旧调用仍视为默认 price。
export const PROVIDERS: ComputedRef<ForecastProvider[]> = computed(() => providersFromCatalog('price', currentRegion.value.id))

export const PROVIDER_MAP: ComputedRef<Record<string, ForecastProvider>> = computed(() =>
  Object.fromEntries(PROVIDERS.value.map((p) => [p.id, p])),
)

export function getProvider(id: string): ForecastProvider | undefined {
  return PROVIDER_MAP.value[id]
}

// 某目标下可用的算法（用于工作台算法选择器按目标过滤）。available:false 模型仍返回（选择器禁用展示，不隐藏）。
export function providersForTarget(target: string, regionId?: string): ForecastProvider[] {
  const activeRegionId = regionId ?? currentRegion.value.id
  return providersFromCatalog(target, activeRegionId).filter((p) => {
    if (!p.supportedTargets.includes(target)) return false
    if (p.id !== 'platform') return true
    return platformTargetsForRegion(activeRegionId).includes(target)
  })
}

// 按 schema 生成参数默认值（工作台切换算法时初始化参数对象）。
export function defaultParams(provider: ForecastProvider): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of provider.paramsSchema) out[f.key] = f.default
  return out
}
