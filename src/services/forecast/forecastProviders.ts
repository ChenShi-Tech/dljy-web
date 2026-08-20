// 预测「深度融合」统一抽象层（Phase 1 / PR-A）。
// 把「平台官方回放(replay) / KNN(replay→Phase4 compute) / ML 6 模型(compute)」统一到一套
// ForecastProvider 契约下：选目标→选算法→配该算法参数→出统一结果(UnifiedForecastResult)，
// 让不同算法同台可选、同台对比。本文件只做契约 + 注册表 + 三类实现，不接入任何页面（PR-B 起接入）。
//
// 数据口径(basis)：platform/knn 回放真实采集=captured，缺数据=synthetic；ml 由后端透传。
// 全程不伪装 Mock：合成链路 basis=synthetic，调用方据此显示「仅验链路，非真实精度」。
import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
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
  run(ctx: SharedTaskContext, params: Record<string, unknown>): Promise<UnifiedForecastResult>
}

// 通用工具
const PTS = Array.from({ length: 96 }, (_, i) => `p${i + 1}`)

// 24/96 粒度对齐：96 点 → 24 点（每 4 个 15min 槽聚合为 1 个整点，取均值）。
// Phase 4 后端原生支持 granularity 后此前端聚合可下沉，contract 保持不变。
function aggregate96to24(points: number[]): number[] {
  const out: number[] = []
  for (let h = 0; h < 24; h++) {
    const slice = points.slice(h * 4, h * 4 + 4).filter((v) => Number.isFinite(v))
    out.push(slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : NaN)
  }
  return out
}

function applyGranularity(result: UnifiedForecastResult, granularity: 24 | 96): UnifiedForecastResult {
  if (granularity === 96 || result.granularity === 24) return result
  return {
    ...result,
    points: aggregate96to24(result.points),
    lower: result.lower ? aggregate96to24(result.lower) : undefined,
    upper: result.upper ? aggregate96to24(result.upper) : undefined,
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
    return adaptMlResult(r, 'knn', ctx.granularity)
  },
}

// ML：6 个后端模型（compute）。包 mlForecastClient.runForecastPredict，适配 ForecastResult→统一契约。
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
const mlCatalog: Ref<ForecastModel[]> = ref([])
const catalogLoading = ref(false)
const catalogError = ref('')
let catalogLoaded = false
// 已加载目录对应的地区（#763 job646 修复）：catalog 的 quality/skill 是地区维，缓存必须按地区分键
// 否则切 shanxi 仍复用云南目录（全局缓存放大跨地区串读）。地区不匹配即视为需重载。
let catalogRegion = ''
// 世代序号（#1173）：切地区 watch 每次都强制刷新，快切即产生并发 in-flight 请求。
// 无守卫时晚归的陈旧响应会覆盖 mlCatalog 并把 catalogRegion 认领成自己的地区
// 目录残留他区 skill/quality，且因地区已被认领，后续同地区调用命中缓存不再纠正，
// 脏状态一直持续到下次切地区。故 await 后只有最新一次请求可写入。
let catalogReq = 0

// 加载后端模型目录（幂等，按地区缓存于 mlCatalog）。/models 的 quality 依赖 region（skill 相对该地区回测基线）。
// 诚实降级（#762 验收）：加载失败置空 + 记录 error，绝不回退硬编码假列表冒充可用。
export async function ensureForecastCatalog(force = false): Promise<void> {
  const regionId = currentRegion.value.id
  if (catalogLoaded && !force && catalogRegion === regionId) return
  const req = ++catalogReq
  catalogLoading.value = true
  catalogError.value = ''
  try {
    const res = await fetchForecastModels('price', regionId)
    if (req !== catalogReq) return    // 已被更新的请求取代：陈旧结果一律丢弃，不写入、不认领地区
    mlCatalog.value = Array.isArray(res?.models) ? res.models : []
    catalogLoaded = true
    catalogRegion = regionId          // 认领本次加载的地区，供下次同地区命中缓存
  } catch (e) {
    if (req !== catalogReq) return    // 陈旧失败不得清空新地区已取回的结果
    mlCatalog.value = []
    catalogError.value = e instanceof Error ? e.message : '模型目录加载失败'
    catalogLoaded = false             // 失败不认领地区，下次（含同地区）仍重试
    catalogRegion = ''
  } finally {
    // 加载态只由最新请求熄灭：否则先归的陈旧请求会提前熄灯，新请求仍在途却显示「已加载完」。
    if (req === catalogReq) catalogLoading.value = false
  }
}

// 全局地区切换 → 目录按新地区强制刷新（quality/skill 地区维；否则切 shanxi 仍显云南 skill/quality，job646）。
// 仅在目录已加载过时才刷新，未挂载任何消费方时不预取（消费方 onMounted 的 ensureForecastCatalog 会按当前地区首载）。
watch(() => currentRegion.value.id, () => { if (catalogLoaded) void ensureForecastCatalog(true) })

// 供页面读取 catalog 加载态（选择器空态/失败提示）。
export function forecastCatalogState(): { models: Ref<ForecastModel[]>; loading: Ref<boolean>; error: Ref<string> } {
  return { models: mlCatalog, loading: catalogLoading, error: catalogError }
}

// 后端 registry tier（core/neural/deep/official/baseline/…）→ ForecastProvider tier，未知归 core。
function normalizeTier(tier: unknown): ForecastProvider['tier'] {
  const t = String(tier ?? '')
  return (t === 'official' || t === 'baseline' || t === 'core' || t === 'neural' || t === 'deep') ? t : 'core'
}

const ML_TARGETS = ['price', 'load', 'renewable', 'bidding_space', 'reg_price', 'reserve_price', 'zonal_spread']

function adaptMlResult(r: ForecastResult, modelId: string, granularity: 24 | 96): UnifiedForecastResult {
  const hasBand = r.lower?.length === 96 && r.upper?.length === 96
  return applyGranularity(
    {
      points: r.points,
      lower: hasBand ? r.lower : undefined,
      upper: hasBand ? r.upper : undefined,
      unit: r.unit,
      basis: r.basis,
      mock: r.mock,
      granularity: 96,
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
    paramsSchema: ML_PARAMS,
    async run(ctx, params) {
      const r = await runForecastPredict({
        region_id: ctx.regionId,
        target: ctx.target,
        model_type: model.modelId,
        train_days: Number(params.train_days ?? ctx.historyDays ?? 180),
        data_source: 'auto',
        probabilistic: params.probabilistic === true,
        conformal: params.probabilistic === true && params.conformal === true,
        target_date: ctx.targetDate,
      })
      assertUsableForecast(r)
      const out = adaptMlResult(r, model.modelId, ctx.granularity)
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
function withCatalogQuality(provider: ForecastProvider): ForecastProvider {
  const entry = mlCatalog.value.find((m) => m.modelId === provider.id)
  if (!entry) return provider
  return {
    ...provider,
    quality: entry.quality ?? provider.quality,
    stage: entry.stage ?? provider.stage,
    shadowGate: entry.shadowGate ?? provider.shadowGate,
    basisVersion: entry.basisVersion ?? provider.basisVersion,
  }
}

export const PROVIDERS: ComputedRef<ForecastProvider[]> = computed(() => [
  withCatalogQuality(platformProvider),
  withCatalogQuality(knnProvider),
  // 排除与前端固定 provider 重复的 catalog id：knn/platform 由固定 provider 承担自定义逻辑
  // （如 knn 的 extra.k、platform 的回放），否则重复 Vue key + PROVIDER_MAP 覆盖丢失固定行为。
  ...mlCatalog.value.filter((m) => m.modelId !== 'knn' && m.modelId !== 'platform').map(makeMlProvider),
])

export const PROVIDER_MAP: ComputedRef<Record<string, ForecastProvider>> = computed(() =>
  Object.fromEntries(PROVIDERS.value.map((p) => [p.id, p])),
)

export function getProvider(id: string): ForecastProvider | undefined {
  return PROVIDER_MAP.value[id]
}

// 某目标下可用的算法（用于工作台算法选择器按目标过滤）。available:false 模型仍返回（选择器禁用展示，不隐藏）。
export function providersForTarget(target: string, regionId?: string): ForecastProvider[] {
  return PROVIDERS.value.filter((p) => {
    if (!p.supportedTargets.includes(target)) return false
    if (p.id !== 'platform') return true
    return platformTargetsForRegion(regionId).includes(target)
  })
}

// 按 schema 生成参数默认值（工作台切换算法时初始化参数对象）。
export function defaultParams(provider: ForecastProvider): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of provider.paramsSchema) out[f.key] = f.default
  return out
}
