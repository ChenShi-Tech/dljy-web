// 价格来源登记表（openspec build-midlong-spot-hedging，D17/HM-05）。
//
// 只登记云南。前瞻估值使用 dljy-infer 的地区级 price 目标（省级日前出清价，15 分钟）。
// 模型按登记顺序取第一个已晋级（promoted）的；查询时显式传入 modelId，系统绝不使用
// 「任意模型中最新的一次」（HF-03）。没有已晋级模型时价格腿为「未覆盖：无已晋级价格模型」。
// 估值一律提示：省级出清价与场站节点结算价存在基差（D17/风险表）。

export const PRICE_SOURCES_VERSION = 1

export const PRICE_SOURCES = Object.freeze([
  Object.freeze({
    regionId: 'yunnan',
    key: 'yunnan-infer-price',
    target: 'price',
    objectScope: 'region',
    label: '省级日前出清价预测（dljy-infer）',
    granularityMinutes: 15,
    horizonDays: 1,
    // 按登记顺序取第一个 promoted 的模型（D17）；把模型放进/移出本表走 PR。
    models: Object.freeze([
      Object.freeze({ modelId: 'flatlinear-yn-price-cov', label: 'FlatLinear（覆盖修正）' }),
      Object.freeze({ modelId: 'dlinear-yn-price', label: 'DLinear' }),
    ]),
    admission: 'MODEL_PROMOTED',
    // 最新运行超过 30 小时标注「过期」（D17）。
    staleRule: Object.freeze({ kind: 'RUN_AGE_HOURS', hours: 30 }),
    basisNote: '省级出清价与场站节点结算价存在基差；场站按节点价结算',
  }),
])

/** 取地区价格登记行；未登记地区返回 null（不回退）。 */
export function priceSourceFor(regionId) {
  return PRICE_SOURCES.find((row) => row.regionId === regionId) ?? null
}

/**
 * 按登记顺序取第一个已晋级模型（D17）。
 * promotedModelIds: 当前进级状态为 promoted 的模型 id 集合（由平台侧晋级记录给出）。
 * 返回 { model } 或 { model: null, reason: 'NO_PROMOTED_MODEL' }。
 */
export function resolvePriceModel({ regionId, promotedModelIds }) {
  const source = priceSourceFor(regionId)
  if (!source) return { model: null, reason: 'REGION_NOT_REGISTERED' }
  const promoted = new Set(promotedModelIds ?? [])
  const model = source.models.find((m) => promoted.has(m.modelId)) ?? null
  return model ? { model, reason: null } : { model: null, reason: 'NO_PROMOTED_MODEL' }
}
