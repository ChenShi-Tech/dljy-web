// ============================================================================
// forecast-target-registry —「预测标的 → 单位/粒度/取数/特征/防泄漏」唯一权威
// ----------------------------------------------------------------------------
// 立项背景（dljy#2446）：同一份「有哪些预测标的」的知识此前散落 6 个文件 + 2 个包，
// 写成 8 份互不一致的清单（ForecastTarget=11 / ALL_TARGETS=7 / TARGET_EXO=8 /
// _TARGET_SOURCES=10 / POWER_TARGETS=5 / dljy_contracts.ForecastTarget=3 …）。
// 不一致已造成三个真实缺陷：
//   ① 目录空洞：GET /forecast/models?target=hydro 返回空数组，但 POST /predict 能跑
//   ② 量纲错标：hydro/generation 曾被标成「元/MWh」（MW 量纲），页面单位全错（#1917）
//   ③ 目标泄漏：TARGET_EXO 缺 hydro 键 → 静默回落，叠加地区驱动追加同值别名列（#2444）
//
// 消费方（全部由生成器派生，不再各写各的）：
//   - Python：packages/agent-runtime/.../contracts/forecast_targets_gen.py（checkin）
//             → ml_prediction/target_spec.py 解析后供 feature_pipeline / registry /
//               remote_inference / rolling_report / forecast_task 消费
//   - 前端：dljy-web 经 SHARED_WHITELIST 直接 import 本文件（ML_TARGETS 同源）
//   - 文档：docs/forecast/target-registry.md
//
// 漂移由 verify:forecast-targets 拦截（Node 半 + pytest 半，两半都挂 CI）。
//
// ── 三条设计红线 ──────────────────────────────────────────────────────────
//
// 1. **quantity 与 skillFamily 是正交的两件事，不合并。**
//    `temp` 的量纲是 °C（quantity=temperature），但它的 skill 门禁分母走的是现货电价族
//    （含 LEAR）——这是 rolling_report 的既有行为（它不在 POWER_TARGETS 也不在
//    DAILY_PRICE_TARGETS，故落默认分支）。把两者压成一个 `dimension` 字段会逼着二选一，
//    从而**改变既有门禁口径**。它们本来就是两个维度：量纲决定单位，序列形态决定分母。
//
// 2. **unit 由 quantity 派生，不逐条写。** 缺陷 ② 的本质是「量纲信息重复了一遍所以能
//    打架」；派生之后那一类 bug 在结构上不可能再发生。
//
// 3. **aliasColumns 是防泄漏的载体，不是元数据装饰。** 它登记「与本标的同值或可由其精确
//    推出」的列。feature_pipeline 的 `_excluded` 判据比的是**字面量**（feat == target_col），
//    拦不住换了名的同一列——缺陷 ③ 正是这么发生的。每条 spec 的 aliasColumns 必须含自身
//    column，且与 exoFeatures 交集必须为空（门禁 A6/A8 断言）。
// ============================================================================

export const FORECAST_TARGET_REGISTRY_VERSION = 'forecast-target/v1'

/**
 * 时间粒度词汇。`slotsPerDay` 一律由 intervalMinutes 推导，注册表不重复存
 * ——两处存同一个事实就会打架（同红线 2）。
 * `fieldRegistryName` 是 dljy-infer FIELD_REGISTRY.json 的 granularity 写法（对拍用）。
 */
export const GRANULARITIES = Object.freeze({
  '15min': Object.freeze({ intervalMinutes: 15, fieldRegistryName: '15min' }),
  '60min': Object.freeze({ intervalMinutes: 60, fieldRegistryName: '1h' }),
  daily: Object.freeze({ intervalMinutes: 1440, fieldRegistryName: '1d' }),
})

/** 一天多少个槽位。60min→24、15min→96、daily→1。 */
export function slotsPerDay(granularity) {
  const g = GRANULARITIES[granularity]
  if (!g) throw new Error(`未知粒度 ${granularity}（可选 ${Object.keys(GRANULARITIES).join('/')}）`)
  return 1440 / g.intervalMinutes
}

/** 物理量纲 → 单位。unit 只在这里定义一次。 */
export const QUANTITIES = Object.freeze({
  price: Object.freeze({ unit: '元/MWh' }),
  power: Object.freeze({ unit: 'MW' }),
  temperature: Object.freeze({ unit: 'C' }),
})

/**
 * skill 门禁的分母族（rolling_report 的既有三分法，逐字复刻，本次不改口径）：
 *   - spot_price：现货电价线，参照 LEAR（该模型就是为 96 点/天电价序列设计的）
 *   - power：功率类，LEAR 对 MW 量纲无意义，改用季节朴素（量纲无关的领域标准基准）
 *   - daily_price：日频价格，量纲同电价但粒度不同，LEAR 的特征管道前提不成立（#2025）
 * 详细论证见 rolling_report.py 的 POWER_TARGETS / DAILY_PRICE_TARGETS 注释块。
 */
export const SKILL_FAMILIES = Object.freeze({
  spot_price: Object.freeze({ labelZh: '现货电价族', referencesRef: 'SKILL_GATE_REFERENCES' }),
  power: Object.freeze({ labelZh: '功率族', referencesRef: 'POWER_SKILL_GATE_REFERENCES' }),
  daily_price: Object.freeze({ labelZh: '日频价格族', referencesRef: 'DAILY_PRICE_SKILL_GATE_REFERENCES' }),
})

/** dataSource.kind 词汇 —— 与 remote_inference._TARGET_SOURCES 的值前缀一一对应。 */
export const DATA_SOURCE_KINDS = Object.freeze(['normalized', 'synth', 'module'])

/**
 * 地区主导因素 → 该省追加的特异特征（迁自 feature_pipeline.REGION_DRIVER /
 * REGION_EXTRA_FEATURES）。**必须与标的注册表放在一起**：泄漏门禁要做
 * 「地区追加特征 × 标的别名列」的交叉断言，分开放就抓不到 water_inflow 那一条（#2444）。
 */
export const REGION_DRIVERS = Object.freeze({
  shanxi: 'thermal', shandong: 'renewable', gansu: 'renewable',
  guangdong: 'external', sichuan: 'hydro', yunnan: 'hydro',
  // 明确的新能源/水电主导省，避免落入 thermal 默认而误用煤价特征（污染非火电省模型）
  xinjiang: 'renewable', 'inner-mongolia': 'renewable', ningxia: 'renewable',
  qinghai: 'renewable', tibet: 'hydro',
})

export const REGION_EXTRA_FEATURES = Object.freeze({
  hydro: Object.freeze(['water_inflow']),        // 水电省：来水(丰枯)
  thermal: Object.freeze(['coal_price']),        // 火电省：煤价(边际成本)
  renewable: Object.freeze(['renewable_ratio']), // 新能源省：渗透率
  external: Object.freeze([]),                   // 外购省：外来电(待接入)
})

/**
 * 预测标的全集。**顺序即 ForecastTarget 枚举顺序**（门禁 C2 断言含顺序）——
 * 它是可见行为：from_str 的报错文案、前端下拉、目录错误提示都按此顺序。
 *
 * 每条字段：
 *   id            标的键（= ForecastTarget 的 value）
 *   enumName      Python Enum 成员名（= id.toUpperCase()）
 *   labelZh       中文名
 *   quantity      物理量纲 → unit
 *   skillFamily   skill 门禁分母族
 *   granularity   时间粒度 → slotsPerDay
 *   column        取数宽表里的列名；null = 需独立 loader（见 loaderRef）
 *   loaderRef     非宽表标的的取数入口；column 为 null 时必填其一（或 blocked）
 *   dataSource    { kind, ref, status }：平台取数路径与是否可供给
 *   blockedReason status='blocked' 时必填，须含 dljy#NNNN
 *   exoFeatures   外生特征（不含目标当期值）
 *   weatherDerived 追加的派生气象特征
 *   aliasColumns  与本标的同值/可精确推出的列（防泄漏，见红线 3）
 *   coreTarget    CORE-CAP-014 契约的对应枚举值；null = Core 不覆盖
 */
export const FORECAST_TARGETS = [
  {
    id: 'price',
    enumName: 'PRICE',
    labelZh: '现货出清电价',
    quantity: 'price',
    skillFamily: 'spot_price',
    granularity: '15min',
    column: 'price',
    loaderRef: null,
    dataSource: { kind: 'normalized', ref: 'price', status: 'available' },
    blockedReason: null,
    exoFeatures: ['load', 'wind', 'solar', 'net_load', 'net_load_norm',
      'renewable', 'renewable_ratio', 'temp', 'coal_price',
      'ghi', 'wind_speed', 'cloud_cover', 'humidity'],
    weatherDerived: ['clearness_index', 'wind_power_frac'],
    aliasColumns: ['price'],
    coreTarget: 'price',
    noteZh: '日前 96 点现货电价，主线标的',
  },
  {
    id: 'load',
    enumName: 'LOAD',
    labelZh: '统调负荷',
    quantity: 'power',
    skillFamily: 'power',
    granularity: '15min',
    column: 'load',
    loaderRef: null,
    dataSource: { kind: 'normalized', ref: 'load', status: 'available' },
    blockedReason: null,
    exoFeatures: ['temp', 'humidity'],
    weatherDerived: ['hdd', 'cdd', 'apparent_temp'], // 温度→负荷的 V 形非线性
    aliasColumns: ['load'],
    coreTarget: 'load',
    noteZh: '',
  },
  {
    id: 'temp',
    enumName: 'TEMP',
    labelZh: '气象温度',
    quantity: 'temperature',
    // ⚠️ 如实复刻既有行为：temp 不在 POWER_TARGETS / DAILY_PRICE_TARGETS，落 rolling_report
    // 的默认分支 = 现货电价族（含 LEAR）。拿 LEAR 当温度预测的分母其实并不合理，但那是
    // 既有口径，本次收敛只做「同源」不做「改口径」——要改另开 issue，避免混在一起无法判断
    // 数字变化是收敛引起的还是改口径引起的。
    skillFamily: 'spot_price',
    granularity: '15min',
    column: 'temp',
    loaderRef: null,
    dataSource: { kind: 'synth', ref: 'temp', status: 'available' },
    blockedReason: null,
    exoFeatures: ['load', 'wind', 'solar', 'net_load'],
    weatherDerived: [],
    aliasColumns: ['temp'],
    coreTarget: null,
    noteZh: '气象预测的最小可运行标的',
  },
  {
    id: 'renewable',
    enumName: 'RENEWABLE',
    labelZh: '新能源出力',
    quantity: 'power',
    skillFamily: 'power',
    granularity: '15min',
    column: 'renewable',
    loaderRef: null,
    dataSource: { kind: 'normalized', ref: 'wind+solar', status: 'available' },
    blockedReason: null,
    exoFeatures: ['temp', 'ghi', 'wind_speed', 'cloud_cover', 'humidity'],
    weatherDerived: ['clearness_index', 'wind_power_frac',
      'dhi_est', 'cell_temp_est', 'clearsky_ghi'],
    aliasColumns: ['renewable'],
    // Core 的 generation 语义历史上就是给 renewable 用的（_TARGET_ALIASES 的由来）
    coreTarget: 'generation',
    noteZh: '风+光合计；平台分列存储，取数时求和',
  },
  {
    id: 'hydro',
    enumName: 'HYDRO',
    labelZh: '水电出力',
    quantity: 'power',
    skillFamily: 'power',
    granularity: '15min',
    column: 'hydro',
    loaderRef: null,
    dataSource: { kind: 'normalized', ref: 'water_inflow', status: 'available' },
    blockedReason: null,
    // 水电出力~降水链（湿度/云量是降水代理）。不放 ghi/wind_speed：那是光伏/风电的驱动，
    // 与水电无物理关联。**绝不能放 water_inflow**——见下方 aliasColumns。
    exoFeatures: ['temp', 'humidity', 'cloud_cover'],
    weatherDerived: [],
    // ⭐ water_inflow 与 hydro 是同一列的两个名字（data_loader 建的别名，该列语义实为
    // hydropowerMWh，列名是历史遗留，见 #2065）。不登记这条就是 #2444 那个 P1 泄漏。
    aliasColumns: ['hydro', 'water_inflow'],
    coreTarget: null,
    noteZh: '取 normalized 的 water_inflow 列，该列语义实为水电出力（#2065）',
  },
  {
    id: 'bidding_space',
    enumName: 'BIDDING_SPACE',
    labelZh: '竞价空间',
    quantity: 'power',
    skillFamily: 'power',
    granularity: '15min',
    column: 'bidding_space',
    loaderRef: null,
    dataSource: { kind: 'normalized', ref: 'net_load', status: 'available' },
    blockedReason: null,
    // 移除 load/renewable：bidding_space = load − renewable 是精确等式，同时入特征即泄漏
    exoFeatures: ['temp', 'ghi', 'wind_speed'],
    weatherDerived: ['clearness_index', 'wind_power_frac'],
    // ⭐ 同 hydro 的形态：feature_pipeline 里 df["bidding_space"] = df["net_load"]，两列同值。
    // 当前 exoFeatures 未含 net_load 故无泄漏，登记在此是为了防住将来有人加进去。
    aliasColumns: ['bidding_space', 'net_load'],
    coreTarget: null,
    noteZh: '近似 = 统调负荷 − 新能源（外来电/必开未接入）',
  },
  {
    id: 'reg_price',
    enumName: 'REG_PRICE',
    labelZh: '调频出清价',
    quantity: 'price',
    skillFamily: 'spot_price',
    granularity: '15min',
    column: 'reg_price',
    loaderRef: null,
    dataSource: { kind: 'synth', ref: 'reg_price', status: 'available' },
    blockedReason: null,
    exoFeatures: ['net_load', 'ramp', 'temp'], // 调频价~净负荷爬坡
    weatherDerived: [],
    aliasColumns: ['reg_price'],
    coreTarget: null,
    noteZh: '辅助服务；真实列缺时由合成兜底，basis=synthetic 如实标注',
  },
  {
    id: 'reserve_price',
    enumName: 'RESERVE_PRICE',
    labelZh: '备用容量价',
    quantity: 'price',
    skillFamily: 'spot_price',
    granularity: '15min',
    column: 'reserve_price',
    loaderRef: null,
    dataSource: { kind: 'synth', ref: 'reserve_price', status: 'available' },
    blockedReason: null,
    exoFeatures: ['net_load', 'renewable', 'temp'], // 备用价~净负荷紧张度
    weatherDerived: [],
    aliasColumns: ['reserve_price'],
    coreTarget: null,
    noteZh: '辅助服务；同 reg_price 的合成兜底机制',
  },
  {
    id: 'zonal_spread',
    enumName: 'ZONAL_SPREAD',
    labelZh: '区域价差',
    quantity: 'price',
    skillFamily: 'spot_price',
    granularity: '15min',
    column: 'zonal_spread',
    loaderRef: null,
    dataSource: { kind: 'synth', ref: 'zonal_spread', status: 'available' },
    blockedReason: null,
    exoFeatures: ['solar', 'wind', 'renewable', 'net_load', 'temp',
      'ghi', 'wind_speed'], // 区域价差~新能源集中度
    weatherDerived: ['clearness_index', 'wind_power_frac'],
    aliasColumns: ['zonal_spread'],
    coreTarget: null,
    noteZh: '节点阻塞代理',
  },
  {
    id: 'midlong_price',
    enumName: 'MIDLONG_PRICE',
    labelZh: '中长期成交价',
    quantity: 'price',
    skillFamily: 'daily_price', // 日频序列，LEAR 的特征管道前提不成立（#2025）
    granularity: 'daily',
    column: null, // 不在 load_price 宽表里
    loaderRef: 'data/midlong_price.py::load_midlong_price',
    dataSource: { kind: 'module', ref: 'data/midlong_price.py', status: 'available' },
    blockedReason: null,
    exoFeatures: [],
    weatherDerived: [],
    aliasColumns: ['midlong_price'],
    coreTarget: null,
    // 诚实说明：独立 loader 已实现但生产代码零调用，load_price 也不产该列，故实际请求会走
    // build_features 的目标列守卫 → 200 + available:false。管道接线见后续 issue。
    noteZh: '日频；独立取数模块已实现但未接入预测管道，实际请求当前诚实空态',
  },
  {
    id: 'generation',
    enumName: 'GENERATION',
    labelZh: '总发电出力',
    quantity: 'power',
    skillFamily: 'power',
    granularity: '15min',
    column: 'generation',
    loaderRef: null,
    // dljy#2457 解锁：ETL 直接接官方 total_generation_actual(yn)（35136 行零缺失），不再拼分量
    dataSource: { kind: 'normalized', ref: 'generation', status: 'available' },
    blockedReason: null,
    // 与 hydro 同样的坑：此前无登记 → 静默回落 ['temp']。它现在 blocked 跑不起来所以没暴露，
    // 但解锁那天就会踩，故一并登记（dljy#2446）。
    exoFeatures: ['temp', 'humidity', 'cloud_cover'],
    weatherDerived: [],
    aliasColumns: ['generation'],
    // ⚠️ 裁决（dljy#2446）：**不设 Core 转发**。renewable 已占用 Core 的 'generation'，
    // 两者都映射过去会让「风+光」与「总出力」两条口径不同的曲线撞在一起且不报错
    // （反单射门禁 C10 抓的正是这个）。平台的 generation 走本地路径。
    coreTarget: null,
    noteZh: '口径 = 官方 total_generation_actual(region=yn) 直接接入（dljy#2457）；不拼分量——'
      + '四分量和与官方值平均差 3385 MW，口径有重叠',
  },
  // ── 用户侧结算电价线（60 分钟，dljy#2458；数据接线 dljy#2457）──────────────────────
  // 南洋 8 个 bundle 模型（Dynamic TMoE / TFPS）的标的。此前标「平台无用户侧结算电价序列」
  // 是按族名找关键字得出的误判——数据在长表族 yn_system_forecast 的 datasetKey 那一层，
  // 一年前就在（367 天 × 24 零缺失）。取数走小时分片 hourly/，与 15 分钟帧物理隔离。
  // 刻意不把同日现货 price 放进特征：与用户侧日前价属同一出清周期，不是 D-1 已知量。
  {
    id: 'price_user_da_settlement',
    enumName: 'PRICE_USER_DA_SETTLEMENT',
    labelZh: '用户侧日前统一结算电价',
    quantity: 'price',
    skillFamily: 'spot_price',
    granularity: '60min',
    column: 'price_user_da_settlement',
    loaderRef: 'data_loader.load_hourly_market',
    dataSource: { kind: 'normalized', ref: 'price_user_da_settlement', status: 'available' },
    blockedReason: null,
    exoFeatures: ['load', 'wind', 'solar', 'net_load', 'temp', 'humidity', 'precipitation',
      'cloud_cover', 'wind_speed', 'ghi', 'transfer_plan_yunnan_export'],
    weatherDerived: ['clearness_index', 'wind_power_frac'],
    aliasColumns: ['price_user_da_settlement'],
    coreTarget: null,
    noteZh: 'yn_system_forecast/da_user_price，region=all 全网结算口径，原生小时级',
  },
  {
    id: 'price_user_rt_settlement',
    enumName: 'PRICE_USER_RT_SETTLEMENT',
    labelZh: '用户侧实时统一结算电价',
    quantity: 'price',
    skillFamily: 'spot_price',
    granularity: '60min',
    column: 'price_user_rt_settlement',
    loaderRef: 'data_loader.load_hourly_market',
    dataSource: { kind: 'normalized', ref: 'price_user_rt_settlement', status: 'available' },
    blockedReason: null,
    exoFeatures: ['load', 'wind', 'solar', 'net_load', 'temp', 'humidity', 'precipitation',
      'cloud_cover', 'wind_speed', 'ghi', 'transfer_plan_yunnan_export'],
    weatherDerived: ['clearness_index', 'wind_power_frac'],
    aliasColumns: ['price_user_rt_settlement'],
    coreTarget: null,
    noteZh: 'yn_system_forecast/rt_user_price，region=all 全网结算口径，原生小时级',
  },
]

// ── 派生索引与查询 ──────────────────────────────────────────────────────────

const _BY_ID = Object.freeze(Object.fromEntries(FORECAST_TARGETS.map((t) => [t.id, t])))

/** 标的 id 有序列表（= ForecastTarget 枚举顺序）。 */
export const FORECAST_TARGET_IDS = Object.freeze(FORECAST_TARGETS.map((t) => t.id))

export function forecastTarget(id) {
  return _BY_ID[String(id ?? '').trim()] ?? null
}

/** 标的单位（由 quantity 派生，全仓唯一定义处）。 */
export function targetUnit(id) {
  const spec = forecastTarget(id)
  return spec ? QUANTITIES[spec.quantity].unit : null
}

/** 该标的每日槽位数。 */
export function targetSlotsPerDay(id) {
  const spec = forecastTarget(id)
  return spec ? slotsPerDay(spec.granularity) : null
}

/** 平台有取数路径的标的（= 目录该列出的集合）。blocked 的仍进目录但标不可用。 */
export function suppliableTargetIds() {
  return FORECAST_TARGETS.filter((t) => t.dataSource.status === 'available').map((t) => t.id)
}

/**
 * 泄漏的**第二种形态**：由当期量派生的比值/差值列，它不与任何标的同值，但含目标当期真值。
 * 例：renewable_ratio = renewable / load —— 预测 load 或 renewable 时，这一列把目标日实际值
 * 带进特征（指标虚高、验收门槛失真）；对 price 则安全（price 不是它的分子分母）。
 *
 * 与 aliasColumns 的区别：别名是「同一列换个名」（逐值相同），派生是「由目标算出来的另一个量」
 * （逐值不同但含目标信息）。两者都是泄漏，但只有前者能靠逐值比对自动发现，后者必须显式登记。
 */
export const DERIVED_LEAKS = Object.freeze({
  renewable_ratio: Object.freeze(['load', 'renewable', 'bidding_space']),
})

/**
 * 反向索引：列名 → 该列会泄漏的标的集合（feature_pipeline.FEATURE_TARGET_LEAKS 由此派生）。
 * 语义 = 「这一列若进了这些标的的特征集，就是把答案喂给模型」。
 * 两个来源合并：① aliasColumns 反转（同值别名）② DERIVED_LEAKS（派生量）。
 */
export function leakedTargetsByColumn() {
  const out = {}
  for (const t of FORECAST_TARGETS) {
    for (const col of t.aliasColumns) {
      // 目标自身由 `feat == target_col` 判据拦下，无需重复登记。注意要同时比 column 与 id：
      // column 为 null 的标的（如 midlong_price 走独立 loader）取数列名即其 id，
      // 只比 column 会让它把自己登记成自己的泄漏源。
      if (col === t.column || col === t.id) continue
      ;(out[col] ??= new Set()).add(t.id)
    }
  }
  for (const [col, ids] of Object.entries(DERIVED_LEAKS)) {
    for (const id of ids) (out[col] ??= new Set()).add(id)
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()]))
}

// ── 自洽校验（verify:forecast-targets 半 A 调用）────────────────────────────

/**
 * 返回错误描述数组（空 = 自洽）。断言按「能抓住哪个真实缺陷」设计，逐条对应门禁矩阵：
 *   A6/A7/A8 → 缺陷 ③ 目标泄漏；C10 → _CORE_TARGETS 别名撞车。
 */
export function validateForecastTargetRegistry(targets = FORECAST_TARGETS) {
  const errors = []
  const seen = new Set()

  for (const t of targets) {
    const at = `target ${t.id}`
    // A1 标识
    if (!/^[a-z][a-z0-9_]*$/.test(t.id ?? '')) errors.push(`${at}: id 非法（须 ^[a-z][a-z0-9_]*$）`)
    if (seen.has(t.id)) errors.push(`${at}: id 重复`)
    seen.add(t.id)
    if (t.enumName !== String(t.id ?? '').toUpperCase()) {
      errors.push(`${at}: enumName 应为 ${String(t.id).toUpperCase()}，实为 ${t.enumName}`)
    }
    // A2/A3 词汇
    if (!GRANULARITIES[t.granularity]) errors.push(`${at}: 未知 granularity ${t.granularity}`)
    if (!QUANTITIES[t.quantity]) errors.push(`${at}: 未知 quantity ${t.quantity}`)
    if (!SKILL_FAMILIES[t.skillFamily]) errors.push(`${at}: 未知 skillFamily ${t.skillFamily}`)
    if (!DATA_SOURCE_KINDS.includes(t.dataSource?.kind)) {
      errors.push(`${at}: 未知 dataSource.kind ${t.dataSource?.kind}`)
    }
    // A4 取数路径完备：宽表列 / 独立 loader / blocked，三者必居其一
    const blocked = t.dataSource?.status === 'blocked'
    if (t.column === null && !t.loaderRef && !blocked) {
      errors.push(`${at}: column 为 null 时必须给 loaderRef 或标 blocked（否则无取数路径却宣称可用）`)
    }
    // A5 blocked 必须给可读原因且指向 issue
    if (blocked && !/dljy#\d+/.test(t.blockedReason ?? '')) {
      errors.push(`${at}: blocked 必须给 blockedReason 且含 dljy#NNNN（原因要可追溯）`)
    }
    if (!blocked && t.blockedReason) errors.push(`${at}: 非 blocked 不应有 blockedReason`)
    // A8 别名闭包必含自身列
    if (t.column && !t.aliasColumns.includes(t.column)) {
      errors.push(`${at}: aliasColumns 须含自身 column ${t.column}`)
    }
    // A6 ★ 防泄漏：别名列不得出现在自己的特征集里
    const alias = new Set(t.aliasColumns)
    for (const f of [...t.exoFeatures, ...t.weatherDerived]) {
      if (alias.has(f)) errors.push(`${at}: 特征 ${f} 是本标的的同值别名列，入特征即目标泄漏`)
    }
    // A6b ★ 地区追加特征 × 别名列的交叉 —— #2444 那个 P1 正是死在这个交叉上。
    //
    // 注意断言的方向：REGION_EXTRA_FEATURES 里出现某标的的别名列**本身不是错**
    // （云南跑 price 时 water_inflow 是完全合法的地区特征），错的是缺少运行时排除。
    // 所以这里断言的是「危险组合必须已被泄漏索引覆盖」，而不是「危险组合不许存在」。
    // 它防的是将来有人改坏 leakedTargetsByColumn 的跳过判据把某条漏出去。
    const leaks = leakedTargetsByColumn()
    for (const [driver, extras] of Object.entries(REGION_EXTRA_FEATURES)) {
      for (const f of extras) {
        if (!alias.has(f) || f === t.column || f === t.id) continue
        if ((leaks[f] ?? []).includes(t.id)) continue
        const regions = Object.entries(REGION_DRIVERS)
          .filter(([, d]) => d === driver).map(([r]) => r)
        errors.push(`${at}: 地区驱动 ${driver}（${regions.join('/')}）会追加 ${f}，`
          + `它是本标的的同值别名列，但泄漏索引未覆盖 ${t.id}——这些省跑 ${t.id} 会目标泄漏`)
      }
    }
  }

  // A7 ★ 派生泄漏：登记的派生列不得出现在它所泄漏的那些标的的特征集里
  const ids = new Set(targets.map((t) => t.id))
  for (const [col, leaked] of Object.entries(DERIVED_LEAKS)) {
    for (const id of leaked) {
      if (!ids.has(id)) { errors.push(`DERIVED_LEAKS[${col}] 引用了未登记的标的 ${id}`); continue }
      const t = targets.find((x) => x.id === id)
      if ([...t.exoFeatures, ...t.weatherDerived].includes(col)) {
        errors.push(`target ${id}: 特征 ${col} 由当期目标派生（DERIVED_LEAKS 已登记），入特征即泄漏`)
      }
    }
  }

  // C10 ★ coreTarget 反单射：两个标的映射到同一个 Core 枚举 = 两条口径撞车且不报错
  const byCore = {}
  for (const t of targets) {
    if (!t.coreTarget) continue
    ;(byCore[t.coreTarget] ??= []).push(t.id)
  }
  for (const [core, ids] of Object.entries(byCore)) {
    if (ids.length > 1) {
      errors.push(`coreTarget ${core} 被多个标的占用：${ids.join(', ')}`
        + '——转发 Core 时两条口径不同的曲线会撞在一起且不报错')
    }
  }
  return errors
}
