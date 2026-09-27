// ============================================================================
// capture-families.mjs — 采集/回放数据源的「数据库结构」单一权威注册表
// ----------------------------------------------------------------------------
// 目标：为 /api/real 回放层的每一个数据源（family）声明其落库结构，使其拥有
// 一等公民的数据库归宿，支撑「未来接入真实数据的有效管理 + 备份」。
//
// 与既有 `shared/schema/generated/rowFieldTypes.mjs` 的关系：
//   - rowFieldTypes：59 个数据族的「归一化业务行」结构（喂 /api/* 业务端点）。
//   - 本文件：同一批数据源的「采集回放」结构（喂 /api/real，前端图表直接消费）。
//   二者是同一数据源的两种表示，互补。本注册表是 capture.sqlite 的建表 + 校验 +
//   编目依据，并通过 NORMALIZED_FAMILIES 关联 rowFieldTypes 做全量编目。
//
// 每个数据集（dataset）落库为两种结构之一：
//   - row      ：行式族（如 zptjg 每日每类型一行 {date,type,jz,p1..p96}）→ capture_row 表
//   - document ：对象式族（如 actualLoad {system,misplace}）→ capture_document 表
// 同一 family 可按 match 同时含 row 与 document 两类数据集（如 zgnrx：list=row，
// qxyc_wide=document）。`describeDataset(code, match)` 负责按 match 归类并给出
// 数据集键、校验 schema 与自然键列。
// ============================================================================

import { str, num, object } from '../define.mjs'
import { rowFieldTypes } from '../generated/rowFieldTypes.mjs'
import { DISCLOSURE_DATASET_KEYS } from '../disclosure-table-specs.mjs'

// —— p1..pN 数值列（96 点/24 点时序） ——
function pFields(n) {
  const f = {}
  for (let i = 1; i <= n; i++) f['p' + i] = num()
  return f
}
const P96 = pFields(96)
const P24 = pFields(24)

// —— 回放行 schema（matchesSchema 校验用；p 列允许 null 故非 required） ——
const ROW_SCHEMAS = {
  // 价格/负荷/竞价/火电/省间预测（zptjg，按 tag 区分数据集）
  zptjg_price: object({ date: str({ required: true }), type: num(), jz: num(), ...P96 }),
  zptjg_daily: object({ date: str({ required: true }), hj: num(), jz: num(), ...P96 }),
  zptjg_interprov: object({ date: str({ required: true }), drrq: str(), jz: num(), ...P96 }),
  zptsj_misplace: object({ riqi: str({ required: true }), hjz: num(), pjz: num(), zxz: num(), zdz: num(), ...P96 }),
  zptqx_estimate: object({ sdgs: str(), date: str({ required: true }), type: num(), total: num(), ...P96 }),
  zfsdjy_trade: object({
    sdgs: str(), jyrq: str({ required: true }), bdrq1: str(), bdrq2: str(),
    jylx: str(), sjlx: str(), czry: str(), czsj: str(), heji: num(), ...P24
  }),
  zjyap_calendar: object({ jyrq: str({ required: true }), sj1: str(), sj2: str() }),
  zptwd_doc: object({ id: str({ required: true }), scrq: str(), wdmc: str({ required: true }), wdjb: str(), wddx: num(), downloadPath: str() }),
  elninolanina: object({
    year: num({ required: true }),
    djf: num(), jfm: num(), fma: num(), mam: num(), amj: num(), mjj: num(),
    jja: num(), jas: num(), aso: num(), son: num(), ond: num(), ndj: num()
  }),
  system_dict: object({ dictValue: str({ required: true }), dictLabel: str({ required: true }) }),

  // —— 云南厂站日损益分解（策略/预测/电网三段损失，已由结算系统预计算，无需重算） ——
  // 数据来源：plant_spot_settlement/plant_daily_loss_analysis.csv（真实导出，落 region=yunnan）。
  // grid_loss_* 在 2026-05 导出全为空 → numericValue→0；schema 数值字段非必填，允许 0/null。
  yn_loss_attribution: object({
    id: str({ required: true }),
    date: str({ required: true }),
    plant: str({ required: true }),
    area: str({ required: true }),
    totalGenerationMwh: num(),
    strategyLossTotal: num(),
    strategyLossPerMwh: num(),
    forecastLossTotal: num(),
    forecastLossPerMwh: num(),
    gridLossTotal: num(),
    gridLossPerMwh: num(),
    originalValueTotal: num()
  }),

  // —— 南网系统预测 vs 实际（长表熔化：宽表分区/current-previous 双值/滚动预测 D-1 切片） ——
  // 数据来源：plant_power_forecast_actual/system_{forecast,actual}_*.csv 10 张表经 yn-fact-forecast
  // 熔化为统一长表（真实导出，默认 region=yunnan，可按南网区域实例参数化）。targetDate 仅新能源
  // 滚动预测表有（operate×target 双日期，as-of 防泄漏物理基础），其余单日期表如实置 null 不臆造；
  // valuePrev=上一快照值（无则 null）。
  // 新能源滚动预测 12.5 万行只收 D-1 切片进回放族，完整滚动序列由预测 ETL（E1）直读原始 CSV。
  yn_system_forecast: object({
    id: str({ required: true }),
    operateDate: str({ required: true }),
    targetDate: str(),
    timePoint: str({ required: true }),
    metric: str({ required: true }),
    region: str({ required: true }),
    value: num(),
    valuePrev: num()
  }),

  // —— 云南快速上屏：自有节点电价日聚合（node×date×market，非 96 点时序，B06 专用族） ——
  // 数据来源：node_prices/{day_ahead,real_time}/*.csv 经 yn-fact-quickwin 日聚合（真实导出，region=yunnan）。
  // 行形状与 96 点 sdpt_zptjg（{date,drrq,jz,p1..p96}）不兼容，故单列独立 family yn_node_price，
  // 不再与 sdpt_zptjg 96 点曲线同目录共存（B06：避免通用浏览器/回放按文件大小混淆两种列结构）。
  yn_node_price: object({
    id: str({ required: true }),
    date: str({ required: true }),
    granularity: str({ required: true }),
    marketType: str({ required: true }),
    module: str({ required: true }),
    product: str({ required: true }),
    nodeName: str({ required: true }),
    area: str({ required: true }),
    price: num(),
    avgPrice: num(),
    maxPrice: num(),
    minPrice: num(),
    deviation: num(),
    volume: num(),
    clearEnergyMWh: num()
  }),

  // —— 南网快速上屏：系统供需实际日内时序（date×time_point，非 96 点宽表，B06 专用族） ——
  // 数据来源：plant_power_forecast_actual/system_actual_*.csv 经 yn-fact-quickwin 合并（真实导出，默认 yunnan，可按南网区域实例参数化）。
  // 行形状与错位负荷 96 点 sdpt_zptsj（{riqi,hjz,pjz,p1..p96}）不兼容，故单列独立 family yn_system_supply。
  yn_system_supply: object({
    id: str({ required: true }),
    date: str({ required: true }),
    time: str({ required: true }),
    module: str({ required: true }),
    product: str({ required: true }),
    area: str({ required: true }),
    loadMWh: num(),
    newEnergyMWh: num(),
    hydropowerMWh: num(),
    noMarketUnitMWh: num(),
    frequencyHz: num(),
    price: num(),
    volume: num(),
    deviation: num()
  }),

  // —— 云南气象要素（Open-Meteo，region=yunnan，hourly 时序） ——
  // 数据来源：yn-fact-weather.mjs::normalizeHourly 的 meteo 行（温度/湿度/风速/云量/降水/气压）。
  // 数值字段允许 null（站点/变量整列缺失时写 null，B07：区别于假零）；不声明 mock/productionWrite
  // （boolean）——define.mjs 无 bool 类型且 matchesSchema 对 string 字段拒绝 boolean，而行完整 payload
  // 照落 capture_row，故只校验已声明字段即可放行 boolean 行。
  yn_meteo: object({
    id: str({ required: true }),
    datetime: str({ required: true }),
    date: str(),
    time: str(),
    area: str({ required: true }),
    stationId: str({ required: true }),
    lat: num(),
    lon: num(),
    apiFamily: str(),
    module: str(),
    product: str(),
    basis: str(),
    sourceType: str(),
    temp: num(),
    humidity: num(),
    windSpeed: num(),
    windSpeed100: num(),
    windDirection: num(),
    cloudCover: num(),
    precipitation: num(),
    pressure: num(),
    status: str(),
    sourceApi: str(),
    operationFamily: str()
  }),

  // —— 云南辐照（Open-Meteo，region=yunnan，hourly 时序） ——
  // 数据来源：yn-fact-weather.mjs::normalizeHourly 的 irradiance 行（GHI/DNI/DHI/直射/POA）。
  yn_irradiance: object({
    id: str({ required: true }),
    datetime: str({ required: true }),
    date: str(),
    time: str(),
    area: str({ required: true }),
    stationId: str({ required: true }),
    lat: num(),
    lon: num(),
    apiFamily: str(),
    module: str(),
    product: str(),
    basis: str(),
    sourceType: str(),
    ghi: num(),
    dni: num(),
    dhi: num(),
    directRadiation: num(),
    poa: num(),
    status: str(),
    sourceApi: str(),
    operationFamily: str()
  }),

  // —— 历史当时气象预报（Open-Meteo Previous Runs，固定 lead-time 归档） ——
  // 原始响应版本落 data/private/weather-asof/；本族只是可由原始版本恢复的归一化回放视图。
  // forecastAt/validAt/ingestedAt 三时间均带时区。values/licence/mock/productionWrite 等复杂或
  // boolean 字段由 source-registry target.requiredFields 强制，本 schema 校验稳定标量字段。
  weather_asof: object({
    id: str({ required: true }),
    provider: str({ required: true }),
    forecastRunId: str({ required: true }),
    modelVersion: str({ required: true }),
    featureVersion: str({ required: true }),
    forecastTimeBasis: str({ required: true }),
    regionId: str({ required: true }),
    stationId: str({ required: true }),
    forecastAt: str({ required: true }),
    validAt: str({ required: true }),
    ingestedAt: str({ required: true }),
    date: str(),
    leadHours: num({ required: true }),
    lat: num(),
    lon: num(),
    temp: num(),
    humidity: num(),
    windSpeed: num(),
    windSpeed100: num(),
    windDirection: num(),
    cloudCover: num(),
    precipitation: num(),
    pressure: num(),
    ghi: num(),
    dni: num(),
    dhi: num(),
    directRadiation: num(),
    licenseId: str({ required: true }),
    attribution: str({ required: true }),
    sourceType: str({ required: true }),
    basis: str({ required: true }),
    rawVersionId: str(),
    rawResponseSha256: str()
  }),

  // —— 云南厂站日结算（申报偏差 + 三段式：中长期/日前/实时） ——
  // 数据来源：plant_spot_settlement/plant_daily_settlement_raw.csv（仅 result_type='formal' 权威行）。
  yn_spot_settlement: object({
    id: str({ required: true }),
    date: str({ required: true }),
    plant: str({ required: true }),
    area: str({ required: true }),
    ltmEnergy: num(),
    ltmPrice: num(),
    daClearedEnergy: num(),
    daDevEnergy: num(),
    daPrice: num(),
    daDevFee: num(),
    rtDevEnergy: num(),
    rtPrice: num(),
    rtDevFee: num(),
    actualOnGridEnergy: num(),
    totalEnergy: num(),
    avgPrice: num(),
    totalFee: num()
  }),

  // —— 云南厂站出力预测 vs 实际（8 源长表） ——
  // 数据来源：plant_spot_settlement/plant_integrated_power_forecast_actual.csv
  // （power_plant × record_date × hour_slot × data_type × value）。data_type 保留原始中文，
  // seriesRole 只做展示分组：forecast / actual / plan / available / theoretical / other。
  yn_plant_output: object({
    id: str({ required: true }),
    date: str({ required: true }),
    plant: str({ required: true }),
    standardPlant: str(),
    unitName: str(),
    point: num(),
    timePoint: str({ required: true }),
    dataType: str({ required: true }),
    seriesRole: str({ required: true }),
    valueMw: num()
  }),

  // —— 云南电厂主数据 DIM（中广核四路映射权威·G2，region=yunnan） ——
  // 数据来源：data/yunnan/derived/parquet/dim/{dim_plant,dim_plant_alias,dim_plant_node}.json
  //   （import:spot-export 从 plant_master_mapping CSV 归一化 + import:cgn-mapping 从
  //    data/yunnan/source/master-data/cgn/中广核电厂映射关系表格.xlsx 人工权威补第四路 mid_long 别名与字段）。
  // 此前 dim_*.json 零消费方；G2 把三族接入 capture 体系（capture.sqlite + capture-raw
  // region=yunnan），让 DIM 层第一次有 /api/real 回放消费方，供 B1/B4a 后续富化。
  // 注：dim_plant.mechRatio 是厂站级属性（≠ 省级 SettlementRuleSpec，勿混）；
  //     与 rowFieldTypes 的「归一化业务行族」不同——这是采集回放表示（见文件顶注释）。
  yn_dim_plant: object({
    id: str({ required: true }),
    standardName: str({ required: true }),
    plantType: str(),
    plantId: str(),
    mechRatio: num(),
    isQuoteBased: num(),
    isActive: num(),
    displayOrder: num()
  }),
  // 四路 sourceType：control_energy(集控实际) / control_forecast(集控预测) /
  // integrated(一体化) / mid_long(中长期，第四路，仅 cgn Excel 补全后存在)。
  yn_dim_plant_alias: object({
    id: str({ required: true }),
    sourceType: str({ required: true }),
    rawName: str(),
    standardName: str({ required: true }),
    ratio: num(),
    isActive: num()
  }),
  yn_dim_plant_node: object({
    id: str({ required: true }),
    nodeName: str(),
    standardName: str({ required: true }),
    isActive: num()
  }),

  // —— 云南用户侧统一电价（日前/实时，region=yunnan） ——
  // 数据来源：user_price/tb_{da,rt}_user_price*.csv。独立于 yn_system_forecast 的披露长表，
  // 保留 market=da/rt，供后续 S3/S4/S5 面板按用户侧结算价直接回放。
  yn_user_price: object({
    id: str({ required: true }),
    operateDate: str({ required: true }),
    timePoint: str({ required: true }),
    market: str({ required: true }),
    area: str({ required: true }),
    region: str({ required: true }),
    price: num(),
    sourceTable: str()
  }),

  // —— 云南厂站绑定节点多价型结算电价（保留 data_type 维度） ——
  // 数据来源：plant_spot_settlement/plant_nodal_price_data.csv。
  yn_plant_nodal_price: object({
    id: str({ required: true }),
    date: str({ required: true }),
    timePoint: str({ required: true }),
    plant: str({ required: true }),
    nodeName: str({ required: true }),
    dataType: str({ required: true }),
    area: str({ required: true }),
    price: num(),
    sourceTable: str()
  }),

  // —— 云南月结 JSON 加工产物拆分行（summary/charge/project/source） ——
  // 数据来源：prepared_files/settlement_json/*_rows_*.csv；rawJson 保留未建模列，数值缺测落 null。
  yn_settlement_detail: object({
    id: str({ required: true }),
    recordType: str({ required: true }),
    month: str(),
    date: str(),
    plant: str(),
    project: str(),
    chargeType: str(),
    sourceTable: str(),
    sourceField: str(),
    metric: str(),
    resultType: str(),
    value: num(),
    amount: num(),
    quantity: num(),
    price: num(),
    unit: str(),
    rawJson: str()
  }),

  // —— 云南参与优化出清水电机组群电量上限 ——
  // 数据来源：information_disclosure 或 market_boundary_disclosure/
  // tb_disclosure_forecast_yn_hydro_group_energy_limit*.csv；宽表时段列会熔为 timePoint 长表。
  yn_hydro_group_limit: object({
    id: str({ required: true }),
    operateDate: str({ required: true }),
    timePoint: str(),
    hydroGroup: str(),
    plant: str(),
    unitName: str(),
    metric: str({ required: true }),
    value: num(),
    limitMWh: num(),
    limitMw: num(),
    ratio: num(),
    unit: str(),
    sourceFile: str()
  }),

  // —— 市场经营分析（手录·链路 A：ImportHub 投递 → capture-raw → fetchCaptured）——
  // 数据来源：运维/业务方经 ImportHub UI 手录 CSV（或 import:market-export 命令行投递）。
  // 9 个 datasetKey 覆盖 6 tab + 跨 tab 共用月度趋势 + 公共/套餐 KPI 指标卡（spec：market-ops-data-spec.md）。
  // 全省公共数据落扁平 capture-raw/market_analysis/（基线回退）；云南专属落 capture-raw/yunnan/market_analysis/。
  market_trade_summary: object({
    id: str({ required: true }), area: str({ required: true }),
    tradeType: str({ required: true }), quantity: num({ required: true }),
    avgPrice: num(), tradeCount: num(), percentage: num()
  }),
  market_monthly_trend: object({
    id: str({ required: true }), area: str({ required: true }),
    month: str({ required: true }), quantity: num({ required: true }),
    avgPrice: num(), mediumLong: num(), spot: num(), ancillary: num()
  }),
  market_generation: object({
    id: str({ required: true }), area: str({ required: true }),
    name: str({ required: true }), quantity: num({ required: true }),
    avgPrice: num(), count: num(), percentage: num(),
    category: str() // 'powerType'(发电类型聚合) | 'detail'(电厂明细)；同族分流两套 CategoryRow
  }),
  market_sales: object({
    id: str({ required: true }), area: str({ required: true }),
    name: str({ required: true }), quantity: num({ required: true }),
    avgPrice: num(), count: num(), percentage: num()
  }),
  market_storage: object({
    id: str({ required: true }), area: str({ required: true }),
    name: str({ required: true }), quantity: num({ required: true }),
    avgPrice: num(), count: num(), percentage: num()
  }),
  market_packages: object({
    id: str({ required: true }), area: str({ required: true }),
    companyName: str({ required: true }), userName: str({ required: true }),
    packageType: str({ required: true }), status: str(),
    flatPrice: num(), peakPrice: num(), valleyPrice: num(), volume: num()
  }),
  market_price: object({
    id: str({ required: true }), area: str({ required: true }),
    month: str({ required: true }), mediumLongPrice: num({ required: true }),
    spotPrice: num({ required: true }), retailPrice: num(), deviation: num()
  }),
  market_metrics: object({
    id: str({ required: true }), area: str({ required: true }),
    tab: str({ required: true }), label: str({ required: true }),
    value: num({ required: true }), unit: str(), tone: str()
  }),
  market_retail_package_metrics: object({
    id: str({ required: true }), area: str({ required: true }),
    tab: str({ required: true }), label: str({ required: true }),
    value: num({ required: true }), unit: str(), tone: str()
  }),

  // —— 南网披露表通用度量长表（issue #2825）——
  // 数据来源：数据运维台上传中心 17 张 tb_disclosure_* 披露表（表头形状单一来源
  // shared/schema/disclosure-table-specs.mjs，datasetKey=源表短名，共 17 键共享本 schema）。
  // 宽表（96 点）熔为 timePoint 行；标量表按值列拆 metric/value 行（枚举列走 textValue）；
  // 维度列池是 17 张表维度列的并集（单表只用其中 2-4 列，长表稀疏是常态）。落点判据
  // （为何不进 grid.disclosure_events）见 issue #2825 归类结论评论。
  yn_disclosure_metric: object({
    id: str({ required: true }),
    operateDate: str({ required: true }),
    sourceTable: str({ required: true }),
    metric: str({ required: true }),
    value: num(),
    textValue: str(),
    timePoint: str(),
    regionName: str(),
    channelName: str(),
    sectionName: str(),
    categoryName: str(),
    itemName: str(),
    groupName: str(),
    plantName: str(),
    unitName: str(),
    dataType: str(),
    segmentNo: num(),
    innerDate: str(),
    tagText: str(),
    noteText: str(),
    unit: str(),
    sourceFile: str()
  }),
  // —— 中广核月包导出表上传契约（issue #2824，kind='cgn-spot-export'）——
  // 数据来源：data/yunnan/source/monthly-export/<YYYY-MM>/plant_spot_settlement|plant_master_mapping/
  // 经上传中心直传（月包独有数据，不与整年导出重复）。schema 只声明「锚点字段」（normalizer
  // 保证在场），matchesSchema 不拒绝额外字段——保真行（C/D 类）的整行原始列随 payload 落库，
  // 展开与口径加工归消费/派生层，raw 层不加工。
  // A 类厂站时段长表归一 camelCase（与 yn_plant_output 风格一致）：
  //   id/power_plant→plant/record_date→date/hour_slot→hour/data_type→dataType/value/updated_at|created_at→updatedAt。
  yn_plant_timeseries: object({
    id: str({ required: true }),
    plant: str({ required: true }),
    date: str({ required: true }),
    hour: num(),
    dataType: str(),
    value: num(),
    updatedAt: str()
  }),
  // B 类厂站日报指标宽表（plant_daily_report_metrics，34 列）→ camelCase 保真数值化。
  yn_plant_daily_metrics: object({
    id: str({ required: true }),
    date: str({ required: true }),
    plant: str({ required: true }),
    inReportScope: num(),
    totalGenerationMWh: num(), marketGenerationMWh: num(),
    dayAheadDeclaredMwh: num(), integratedForecastMwh: num(), longTermTotalMwh: num(),
    threePartPriceYuanPerMwh: num(), marketPriceYuanPerMwh: num(),
    settlementRevenueYuan: num(), originalValueYuan: num(),
    dayAheadStrategyLossYuan: num(), powerForecastLossYuan: num(), longTermLossYuan: num(),
    annualLtMwh: num(), annualLtPriceYuanPerMwh: num(), annualLtLossYuan: num(),
    monthlyLtMwh: num(), monthlyLtPriceYuanPerMwh: num(), monthlyLtLossYuan: num(),
    intramonthLtMwh: num(), intramonthLtPriceYuanPerMwh: num(), intramonthLtLossYuan: num(),
    dailyRollingLtMwh: num(), dailyRollingLtPriceYuanPerMwh: num(), dailyRollingLtLossYuan: num(),
    ltResidualMwh: num(), ltResidualLossYuan: num(),
    missingDataJson: str(), calculationVersion: str(), createdAt: str(), updatedAt: str()
  }),
  // C 类结算单据（7 表保真，原列名落 payload）。dateField 各表不同（日/月粒度），由
  // describeDataset 按 datasetKey 分支声明——增量窗口按本批日期/月份标记集合替换。
  // plant_daily_settlement_raw 是日结原始证据（48 列中文表头，含 result_type formal/temp
  // 状态列，2026-05 月包各 992 行）：保真行 payload 键=原始列名，日期列就是「日期」，
  // 正式读模型（yn_spot_settlement）不含暂结行，暂结与正式/暂结差异从这里提取（D7、ST01）。
  yn_settle_plant_spot_data: object({ id: str({ required: true }), data_date: str({ required: true }) }),
  yn_settle_daily_raw: object({ id: str({ required: true }), 日期: str({ required: true }) }),
  yn_settle_bill_excel_cells: object({
    settle_month: str({ required: true }), file_name: str({ required: true }),
    sheet_name: str({ required: true }), row_index: num(), col_index: num()
  }),
  yn_settle_daily_split_raw: object({ id: str({ required: true }), data_date: str({ required: true }) }),
  // 账单索引行锚点 = id + settle_month（#3088 实测 2026-05 包：32/64 行账单未到发布月
  // 时 billmonth 为空，而 settle_month 全量在场——月标记锚点选恒在列，billmonth 留在
  // 保真 payload 里如实为空，不改写源值）。
  yn_settle_bill_records_raw: object({ id: str({ required: true }), settle_month: str({ required: true }) }),
  yn_settle_bill_file_downloads: object({ source_record_id: str({ required: true }), settle_month: str({ required: true }) }),
  yn_settle_monthly_raw: object({ account_id: str({ required: true }), settlemonth: str({ required: true }) }),
  // plant_daily_settlement_raw（issue #3088，design D7「暂结日结的具体承载」）：原始日结
  // 载荷 formal/temp 全量保存的证据层锚点——既有 yn_spot_settlement/yn_settlement_daily
  // 只收 formal 行的正式读模型语义不变，暂结与正式/暂结差异从本证据层读取。
  // 源表日期列是中文原列名「日期」（保真载荷原样保留）；schema/增量窗口统一用 ASCII 别名
  // data_date（上传契约 date 锚点带 alias，归一后两键同值）——DDL 生成器按 schema 字段
  // 物化列，非 ASCII 标识符拒绝生成。
  yn_settle_daily_settlement_raw: object({
    id: str({ required: true }),
    data_date: str({ required: true }),
    result_type: str({ required: true })
  }),
  // D 类合同与曲线（2 表保真；curves 24 买方点 + 24 价点宽表原样存，unpivot 归消费层）。
  yn_contract_electricity: object({
    guid: str({ required: true }), contractId: str({ required: true }),
    deliveryPeriodBegin: str({ required: true })
  }),
  yn_contract_curves: object({
    guid: str({ required: true }), contractId: str({ required: true }),
    day: str({ required: true })
  }),
  // E 类余量维度表（plant_master_mapping 月包独有 3 表；行形状与 import:spot-export DIM_FAMILIES
  // 的 normalize 输出同形——dim_plant_capacity/dim_node/dim_self_owned_plant）。
  yn_dim_plant_capacity: object({
    id: str({ required: true }), plantName: str({ required: true }), installedCapacityMW: num()
  }),
  yn_dim_node: object({
    id: str({ required: true }), nodeName: str({ required: true }),
    province: str(), city: str(), district: str()
  }),
  yn_dim_self_owned_plant: object({
    id: str({ required: true }), tradeCenter: str(), capacityMW: num(),
    businessType: str(), controlCenter: str(), nodeName: str()
  }),

}

// 云南 PnL 行 schema 单独导出，供 normalizer（yn-fact-pnl.mjs）按字段名做 matchesNormalizedRow 校验。
export const ynLossAttributionSchema = ROW_SCHEMAS.yn_loss_attribution
export const ynSpotSettlementSchema = ROW_SCHEMAS.yn_spot_settlement
export const ynPlantOutputSchema = ROW_SCHEMAS.yn_plant_output

// 云南快速上屏行 schema 单独导出，供 normalizer（yn-fact-quickwin.mjs）按字段名做质检（B06）。
export const ynNodePriceSchema = ROW_SCHEMAS.yn_node_price
export const ynSystemSupplySchema = ROW_SCHEMAS.yn_system_supply

// 云南系统预测 vs 实际行 schema 单独导出，供 normalizer（yn-fact-forecast.mjs）做 matchesNormalizedRow 校验。
export const ynSystemForecastSchema = ROW_SCHEMAS.yn_system_forecast

// 云南气象行 schema 单独导出，供 normalizer（yn-fact-weather.mjs）按字段名做 matchesNormalizedRow 校验。
export const ynMeteoSchema = ROW_SCHEMAS.yn_meteo
export const ynIrradianceSchema = ROW_SCHEMAS.yn_irradiance
export const weatherAsOfSchema = ROW_SCHEMAS.weather_asof

// 云南电厂主数据 DIM 行 schema 单独导出，供 normalizer（yn-fact-dim.mjs）与 verify:cgn-mapping
// 按字段名做 matchesSchema 校验（G2：DIM 层第一次接入 capture 体系）。
export const ynDimPlantSchema = ROW_SCHEMAS.yn_dim_plant
export const ynDimPlantAliasSchema = ROW_SCHEMAS.yn_dim_plant_alias
export const ynDimPlantNodeSchema = ROW_SCHEMAS.yn_dim_plant_node
export const ynUserPriceSchema = ROW_SCHEMAS.yn_user_price
export const ynPlantNodalPriceSchema = ROW_SCHEMAS.yn_plant_nodal_price
export const ynSettlementDetailSchema = ROW_SCHEMAS.yn_settlement_detail
export const ynHydroGroupLimitSchema = ROW_SCHEMAS.yn_hydro_group_limit

// 南网披露表通用长表 schema 单独导出，供上传归一化器（yn-disclosure-upload.mjs）与
// verify:data-upload 的披露契约行为断言按字段名做 matchesSchema 校验（issue #2825）。
export const ynDisclosureMetricSchema = ROW_SCHEMAS.yn_disclosure_metric

// 市场经营分析（手录）公共口径 7 个 datasetKey 的行 schema 映射，供 normalizer（yn-fact-market.mjs）
// 与 ImportHub 投递层按 datasetKey 做 matchesNormalizedRow 校验（单一来源、零漂移）。
// #669 路线①：售电套餐经营口径 market_packages 已拆出为独立 company 私有族（见下 marketRetailPackageSchemas），
// 不再属公共口径，故从本映射与 MARKET_DATASET_KEYS 中移出。
export const marketAnalysisSchemas = {
  market_trade_summary: ROW_SCHEMAS.market_trade_summary,
  market_monthly_trend: ROW_SCHEMAS.market_monthly_trend,
  market_generation: ROW_SCHEMAS.market_generation,
  market_sales: ROW_SCHEMAS.market_sales,
  market_storage: ROW_SCHEMAS.market_storage,
  market_price: ROW_SCHEMAS.market_price,
  market_metrics: ROW_SCHEMAS.market_metrics
}
export const MARKET_DATASET_KEYS = Object.keys(marketAnalysisSchemas)

// —— 月包导出表上传契约（#2824）多 datasetKey 族的 schema 映射 ——
// 与 marketAnalysisSchemas 同款出口：describeDataset 按 key 分支消费，build-data-type-ddl
// 生成器按 dataset 分表。C 类 7 表（dateField 各异，含 #3088 暂结承载 plant_daily_settlement_raw）
// 与 D 类 2 表。
export const settlementDocSchemas = {
  plant_spot_settle_data: ROW_SCHEMAS.yn_settle_plant_spot_data,
  plant_daily_settlement_raw: ROW_SCHEMAS.yn_settle_daily_settlement_raw,
  plant_daily_split_settlement_raw: ROW_SCHEMAS.yn_settle_daily_split_raw,
  settlement_bill_excel_cells: ROW_SCHEMAS.yn_settle_bill_excel_cells,
  settlement_bill_records_raw: ROW_SCHEMAS.yn_settle_bill_records_raw,
  settlement_bill_file_downloads: ROW_SCHEMAS.yn_settle_bill_file_downloads,
  plant_monthly_settlement_raw: ROW_SCHEMAS.yn_settle_monthly_raw
}
export const contractSchemas = {
  electricity_contracts: ROW_SCHEMAS.yn_contract_electricity,
  contract_curves: ROW_SCHEMAS.yn_contract_curves
}

// —— 售电套餐公司经营口径（#669 + #815）——
// market_packages 含售电公司/客户/套餐类型/三段价；market_retail_package_metrics 含套餐数、
// 客户覆盖、加权均价/毛利等聚合 KPI。二者均能反推公司经营状况，统一放入 company 私有族
// market_retail_packages（族级 owner comp-cgn-yunnan，见 CAPTURE_FAMILIES 登记），与 public
// market_analysis 彻底解耦，回放层按 getFamilyVisibility=company 授权闸门保护（enforceCaptureVisibility）。
export const MARKET_RETAIL_PACKAGES_FAMILY = 'market_retail_packages'
export const marketRetailPackageSchemas = {
  market_packages: ROW_SCHEMAS.market_packages,
  market_retail_package_metrics: ROW_SCHEMAS.market_retail_package_metrics
}
export const MARKET_RETAIL_DATASET_KEYS = Object.keys(marketRetailPackageSchemas)
export const MARKET_PUBLIC_METRIC_TABS = Object.freeze(['overview', 'generation', 'sales', 'storage'])

// #815 存量/旁路防御：历史 public market_metrics 可能已有 tab=packages 行；新 normalizer
// 虽会拒绝，但回放层仍须过滤旧文件/旧库，受管 DB 写入也须拒绝非公共 tab。
export function filterPublicMarketMetricRows(family, datasetKey, rows) {
  if (family !== 'market_analysis' || !String(datasetKey ?? '').includes('market_metrics') || !Array.isArray(rows)) return rows
  const allowed = new Set(MARKET_PUBLIC_METRIC_TABS)
  return rows.filter((row) => allowed.has(String(row?.tab ?? '').trim()))
}

// ImportHub 手录投递（/api/v1/market-analysis/import）接受的全部 datasetKey：
// 7 公共键 → market_analysis(public)；套餐明细/KPI 两键 → market_retail_packages(company)。
export const ALL_MARKET_DATASET_KEYS = [...MARKET_DATASET_KEYS, ...MARKET_RETAIL_DATASET_KEYS]
const ALL_MARKET_SCHEMAS = { ...marketAnalysisSchemas, ...marketRetailPackageSchemas }

// datasetKey → 落库 family 归属：公共 7 键 → market_analysis；套餐两键 → market_retail_packages。
// 归一化器与投递层据此把同一手录入口按 datasetKey 分流到两个族；未登记 datasetKey 返回 null（调用方显式失败）。
export function marketFamilyForDataset(datasetKey) {
  if (Object.hasOwn(marketRetailPackageSchemas, datasetKey)) return MARKET_RETAIL_PACKAGES_FAMILY
  if (Object.hasOwn(marketAnalysisSchemas, datasetKey)) return 'market_analysis'
  return null
}
// datasetKey → 校验 schema（跨两族，单一来源）。未登记 datasetKey 返回 null。
export function marketSchemaForDataset(datasetKey) {
  return Object.hasOwn(ALL_MARKET_SCHEMAS, datasetKey) ? ALL_MARKET_SCHEMAS[datasetKey] : null
}

// —— datasetKey ↔ family 权威对应表（#1479）——
//
// 背景：「数据集合（datasetKey）↔ 采集族（family）」的对应关系此前分散在各归一化器
// 就地字面量里，verify:data-classification 第 ⑥ 项只能靠两条启发式（文件名前缀 / 同名
// 跨族）猜归属，注释自认「已记 follow-up；本项不宣称完备」。本表把对应关系收进注册表
// 成为单一事实源：归一化器/上传通道从这里取 datasetKey 常量，落盘目录归属按本表精确核对。
//
// 登记范围：**归一化产物固定命名**的族（datasetKey 是有限枚举）。平台原样切片族
// （sdpt_* 等，datasetKey = 采集文件词干，逐文件不同）不登记——无法预枚举，这些族的
// 落盘核对仍由 ⑥-c（未登记目录 fail-closed）与 ⑦（载荷主体标识）兜底。
//
// ⚠ `da_user_price`/`rt_user_price` 两键**合法双族**：南网整年导出把用户侧电价熔进
// yn_system_forecast 长表（yn-fact-forecast meltUserPrice），交易中心月度导出走
// yn_user_price 专用族（yn-fact-special）——同名不同 schema、都是正当落点。反向查找
// familyForDataset 对多命中返回 null（不判定），落盘核对改按宿主族键集判定，两族互不误伤。
export const FAMILY_DATASET_KEYS = Object.freeze({
  // —— yn-fact-* 归一化器产出（builder 缺源时仍保留 family/datasetKey 元信息，可运行时对拍） ——
  yn_loss_attribution: ['yn_loss_daily'],
  yn_spot_settlement: ['yn_settlement_daily'],
  yn_plant_output: ['yn_plant_output'],
  yn_system_forecast: [
    'load_forecast', 'load_actual',
    'non_market_forecast', 'non_market_actual',
    'new_energy_forecast_d1', 'new_energy_actual', 'hydro_actual',
    'total_generation_forecast', 'total_generation_actual',
    'inter_provincial_forecast',
    'da_user_price', 'rt_user_price' // 南网整年导出专属（与 yn_user_price 的同名键双族共存，见上）
  ],
  yn_node_price: ['yn_node_price_daily'],
  yn_system_supply: ['yn_system_supply_demand'],
  yn_meteo: ['yn_meteo_hourly'],
  yn_irradiance: ['yn_irradiance_hourly'],
  yn_dim_plant: ['yn_dim_plant'],
  yn_dim_plant_alias: ['yn_dim_plant_alias'],
  yn_dim_plant_node: ['yn_dim_plant_node'],
  yn_user_price: ['da_user_price', 'rt_user_price'],
  yn_plant_nodal_price: ['plant_nodal_price'],
  yn_settlement_detail: ['summary', 'charge', 'project', 'source'],
  yn_hydro_group_limit: ['forecast_yn_hydro_group_energy_limit'],
  // —— 手录市场公报（键清单已有注册表来源，引用不复制） ——
  market_analysis: MARKET_DATASET_KEYS,
  market_retail_packages: MARKET_RETAIL_DATASET_KEYS,
  // —— 南网披露表（datasetKey=源表短名，单一来源 disclosure-table-specs） ——
  yn_disclosure_metric: [...DISCLOSURE_DATASET_KEYS],
  // —— 中广核月包导出表上传契约（#2824/#3088 plans 的 capture 落点；upload-contracts
  //    的 plan 校验对拍本表，谁漏登另一侧拦） ——
  yn_plant_timeseries: [
    'plant_spot_business_summary', 'plant_spot_summary_data',
    'plant_mid_long_term_data', 'plant_control_center_generation'
  ],
  yn_plant_daily_metrics: ['plant_daily_report_metrics'],
  yn_settlement_docs: [
    'plant_spot_settle_data', 'plant_daily_settlement_raw', 'plant_daily_split_settlement_raw',
    'settlement_bill_excel_cells', 'settlement_bill_records_raw',
    'settlement_bill_file_downloads', 'plant_monthly_settlement_raw'
  ],
  yn_contracts: ['electricity_contracts', 'contract_curves'],
  yn_dim_plant_capacity: ['yn_dim_plant_capacity'],
  yn_dim_node: ['yn_dim_node'],
  yn_dim_self_owned_plant: ['yn_dim_self_owned_plant'],
  // —— 气象 as-of 归档恢复视图（etl/import-weather-asof ← open-meteo-previous-runs） ——
  weather_asof: ['open_meteo_previous_runs_hourly'],
})

// datasetKey → datasetKey 平铺常量表：归一化器 `CAPTURE_DATASET_KEYS.<key>` 取键常量，
// 不再就地写字面量（拼错=undefined，写入侧立刻暴露；注册表删声明=门禁静态引用对拍红）。
export const CAPTURE_DATASET_KEYS = Object.freeze(Object.fromEntries(
  Object.entries(FAMILY_DATASET_KEYS).flatMap(([family, keys]) => keys.map((key) => [key, key]))
))

/** 正向查找：族 → 登记的 datasetKey 集（未登记固定键集的族返回 null，如动态词干的 sdpt_*）。 */
export function datasetKeysForFamily(family) {
  return FAMILY_DATASET_KEYS[String(family ?? '')] ?? null
}

/** 反向查找：datasetKey → 权威族。唯一命中才返回 family；未登记或多族命中（da_user_price 型
 *  合法双族）返回 null——调用方不得把 null 当「无此键」，只当「本函数不判定归属」。 */
export function familyForDataset(datasetKey) {
  const key = String(datasetKey ?? '')
  let hit = null
  for (const [family, keys] of Object.entries(FAMILY_DATASET_KEYS)) {
    if (keys.includes(key)) {
      if (hit !== null) return null // 多命中：不判定（合法双族共存）
      hit = family
    }
  }
  return hit
}

// 文档族顶层必需键（document 校验用）
const DOC_KEYS = {
  zcqxhdl_listrs: ['rjz', 'rmx', 'dmx'],
  zcqxhdl_list: ['nameList', 'legend', 'yAxisIndexList', 'series'],
  zcqxhdl_fhlist24: ['xd', 'xnyzd'],
  zcqxhdl_list24: ['xd', 'xnyzd', 'xnyg', 'xnygd'],
  zcqxhdl_curve: [], // {p1..p96}
  actualLoad_query: ['system', 'misplace'],
  actualLoad_query2: ['system'],
  qxyc: ['fs', 'fz', 'wd'],
  zfsdjy_pos: ['nameList'],
  zrqsb: ['dl'],
  fshq: ['opData'],
  knn: ['results'],
  console_ne: ['dateList'],
  console_load: ['type', 'dateList'],
  console_avg: ['dayTime'],
  zsjfx_meta: ['dates', 'groups', 'yzConfig', 'defaults'],
  zsjfx_day: ['date', 'series']
}

// HomeConsoleView 交易平台负荷的 6 个 match 是硬编码 query sha1 前 10 位；日均价历史变体
// 文件名为 getAveragePriceChart__<hash>.json，但前端二次 fetch 时传入的 match 只有 <hash>。
// 因此 sdpt_console 下“非负荷 hash”需按 console_avg 校验/落库，否则 capture.sqlite 会误判为
// console_load。这里仅覆盖当前 HomeConsoleView 的固定负荷 hash，避免扩大到其他 family。
const SDPT_CONSOLE_LOAD_HASHES = new Set(['d859fbde03', '275c1ef9fa', '317f0f0bbd', '0b36fa2030', '0144aacb91', '7db3560c48'])
function isSdptConsoleAverageHash(match) {
  const m = String(match ?? '').trim().toLowerCase()
  return /^[0-9a-f]{10,40}$/.test(m) && !SDPT_CONSOLE_LOAD_HASHES.has(m)
}

// —— 数据可见性分级（Epic #516 Sub-1，设计见 docs/architecture/user-data-binding-isolation.md） ——
// visibility: 'public'  = 全网披露/系统级数据，全部用户通用（现状行为）；
//             'company' = 公司私有场站数据，须登录且数据归属公司 ∈ 账号授权公司集合
//                         （L4 授权集合，layer 见 server/company-context.mjs），闸门在 /api/real
//                         读路径（Sub-2 #518）按本注册表 fail-closed 判定。
// ownerCompanyId：visibility='company' 时必填，为数据归属公司主体（auth-store 公司种子内的 companyId）。
// 定级原则（谨慎面）：凡带 plantId/厂站映射/自有站点白名单聚合的族一律 company；
// 全省系统级披露（负荷/新能源/水电/用户侧电价/优化出清披露）为 public。
export const DATA_VISIBILITY = { PUBLIC: 'public', COMPANY: 'company' }
export const CGN_YUNNAN_COMPANY_ID = 'comp-cgn-yunnan' // 与 server/auth-store.mjs 公司种子一致（verify:data-classification 校验）
export const SANDE_SHANXI_COMPANY_ID = 'comp-sande-puhua' // 三德普华（山西私有数据宿主，Issue #575 PR-2）；同 auth-store 公司种子

// —— 数据源注册表：code → 元信息 ——
// kind: 'row' | 'document' | 'mixed'（mixed 由 describeDataset 按 match 再判）
//
// datasetOwners（可选，#667 / #656 决策记录方案 B「数据集级 owner 归属登记」）：仅 company 族可登记，
// 把同一 family 下不同数据集细分归属到不同公司。键有两种形式：'<datasetKey>'（地区无关）或
// '<region>/<datasetKey>'（地区限定，优先级更高，region 小写）；值为 auth-store 公司种子内的合法 companyId。
// 解析走 resolveCaptureOwner()：未覆盖的 datasetKey 回落 family 默认 ownerCompanyId，故已有 14 私有族
// 不写 datasetOwners 时行为零变化。本期仅建机制、不给任何真实族添加条目。
// datasetVisibility（可选，#1635「键级 visibility」）：与 datasetOwners 同形（键=前端 match 或文件词干，
// 值=visibility），把 family 级 public 的族里个别私有数据集（如 sdpt_zcqxhdl 的 `__list__` 键，含公司
// 出清电量）按键判私有，其余键保持 public。读路径闸门 getFamilyVisibility(code, datasetKey) 与
// resolveCaptureOwner 均按此键级判定；仅登记 datasetOwners 不影响 visibility（键级 visibility 必须显式
// 写 datasetVisibility）。
// 示例（仅注释、勿启用；同 family 两 datasetKey 分属两公司）：
//   yn_plant_output: { apiFamily: null, label: '…', kind: 'row', visibility: 'company',
//     ownerCompanyId: CGN_YUNNAN_COMPANY_ID,
//     datasetOwners: { 'yunnan/plantA_output': CGN_YUNNAN_COMPANY_ID, 'yunnan/plantB_output': SANDE_SHANXI_COMPANY_ID } },
export const CAPTURE_FAMILIES = {
  sdpt_zptjg: { apiFamily: '/sdpt/zptjg', label: '价格/负荷/竞价/火电/省间预测曲线', kind: 'row', visibility: 'public' },
  // 山西公司自有运营数据 → 三德普华私有（Issue #575 PR-2）：错位负荷/新能源出力预测/日前上报是山西
  // 主体自有运营数据（非国网通用/非全省披露），归三德普华，仅其账号+ADMIN 可读（enforceCaptureVisibility）。
  sdpt_zptsj: { apiFamily: '/sdpt/zptsj', label: '公司错位负荷', kind: 'row', visibility: 'company', ownerCompanyId: SANDE_SHANXI_COMPANY_ID },
  sdpt_zxztqa: { apiFamily: '/sdpt/zxztqa', label: '公司新能源出力预测1', kind: 'row', visibility: 'company', ownerCompanyId: SANDE_SHANXI_COMPANY_ID },
  sdpt_zgnrx: { apiFamily: '/sdpt/zgnrx', label: '公司新能源出力预测2 / 气象预测', kind: 'mixed', visibility: 'company', ownerCompanyId: SANDE_SHANXI_COMPANY_ID },
  // 日前电量预估：**曾误标 public**（无 ownerCompanyId），实测匿名 GET /api/real?family=sdpt_zptqx
  // 返回全部 888 行真实公司数据——含售电公司主体（sdgs/sdgsId=7）、逐日 96 点日前/实时/预估电量、
  // 多条 AI 策略曲线与经办人姓名。同平台同主体的兄弟族（zrqsb/zptsj/zxztqa/zgnrx）一直是 company，
  // 只有它漏标；成因推测是只看了页面消费的 type='4' 预估电量、当成公开预测。
  // 载荷里 type='2' 是**实时电量**（绝对量，非增量），即该主体的实际结算电量——按数据分级
  // （docs/architecture/user-data-binding-isolation.md）属 company 无疑。守卫见 verify:data-classification ⑦。
  sdpt_zptqx: { apiFamily: '/sdpt/zptqx', label: '日前电量预估', kind: 'row', visibility: 'company', ownerCompanyId: SANDE_SHANXI_COMPANY_ID },
  // 分时段交易 / 持仓监控：**曾误标 public**，与 sdpt_zptqx 同型。载荷是该售电公司的中长期
  // 合同台账（每行一笔成交：交易日期 / 标的起止 / 品种 / 合计电量 / 24 点分布，39 行全部
  // sdgs='致诚伟业'）与逐日持仓（各品种持仓电量 + 总持仓均价）——等同于把这家公司的交易
  // 底牌公开。另一半持仓监控载荷体内不带主体字段，但采集侧车的请求就是 `?sdgsId=7&month=…`，
  // 即以该公司身份取得，同样属其私有。故整族归 company。
  sdpt_zfsdjy: { apiFamily: '/sdpt/zfsdjy', label: '公司分时段交易 / 持仓监控', kind: 'mixed', visibility: 'company', ownerCompanyId: SANDE_SHANXI_COMPANY_ID },
  // crossRegion:true —— **电网无关的真·全球通用族**（Issue #569 PR-3）：ENSO 全球气候指数、系统级数据字典。
  // 切到非基线地区且本地无采集时可回退基线（shanxi）服务，全地区共享。
  // 注：交易月历/平台文档/价格/负荷/竞价等是**国网(SGCC)通用或山西市场专属**，非电网无关全球族，故不标
  //     crossRegion——「国网通用 vs 南网通用」的电网分层由后续「电网×地区×公司」数据架构处理（勿在此简单标全球）。
  // gridScope:'sgcc' —— 国网(SGCC)通用族（非省专属，Issue #575 电网分层）：交易月历/平台文档在国网各省通用。
  // 服务：国网地区无本地采集时回退国网基线(shanxi)；**南网地区不取**（绝不跨电网串读）。价格/负荷等
  // 省专属市场数据不标 gridScope，保持 region-strict。
  sdpt_zjyap: { apiFamily: '/sdpt/zjyap', label: '交易月历', kind: 'row', visibility: 'public', gridScope: 'sgcc' },
  sdpt_zptwd: { apiFamily: '/sdpt/zptwd', label: '交易平台文档', kind: 'row', visibility: 'public', gridScope: 'sgcc' },
  sdpt_elninolanina: { apiFamily: '/sdpt/elninolanina', label: '厄尔尼诺/拉尼娜 ENSO 指数', kind: 'row', visibility: 'public', crossRegion: true },
  system_dict: { apiFamily: null, label: '数据字典', kind: 'row', visibility: 'public', crossRegion: true },
  // 出清/价格关系分析：同族装着省级公开电价/负荷关系（listrs_full/listrs/list24/fhlist24，均无主体标识）
  // 与本公司出清现货电量（`__list__` 键，3 个文件带 sdgs_id=7，致诚伟业 31 行占比/电量数据，与 zptqx/zfsdjy
  // 同主体）。整族翻 company 会打断 #1531 接的山西价格路由与价格分析/关系三页，故用键级 visibility：
  // `__list__` 键私有（datasetVisibility + datasetOwners），其余键保持 family 级 public（#1635）。
  sdpt_zcqxhdl: { apiFamily: '/sdpt/zcqxhdl', label: '出清/价格关系分析', kind: 'document', visibility: 'public',
    datasetVisibility: { '__list__': 'company' },
    datasetOwners: { '__list__': SANDE_SHANXI_COMPANY_ID } },
  sdpt_actualLoad: { apiFamily: null, label: '逐日系统负荷 / 24 节气', kind: 'document', visibility: 'public' },
  sdpt_zrqsb: { apiFamily: '/sdpt/zrqsb', label: '日前上报', kind: 'document', visibility: 'company', ownerCompanyId: SANDE_SHANXI_COMPANY_ID },
  sdpt_fshq: { apiFamily: null, label: '分时行情', kind: 'document', visibility: 'public' },
  'knn-api_api': { apiFamily: null, label: '日滚动价格预测(KNN)', kind: 'document', visibility: 'public' },
  sdpt_console: { apiFamily: null, label: '首页控制台图表', kind: 'document', visibility: 'public' },
  sdpt_zsjfx_idx: { apiFamily: null, label: '数据分析索引', kind: 'document', visibility: 'public' },
  // —— 中广核云南场站私有族（plant-exports 导出，厂站级经营数据） ——
  yn_loss_attribution: { apiFamily: null, label: '云南厂站日损益分解(策略/预测/电网)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  yn_spot_settlement: { apiFamily: null, label: '云南厂站日结算(申报偏差/三段式)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  yn_plant_output: { apiFamily: null, label: '云南厂站出力预测vs实际(8源长表)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  // #3066（2026-09-18 拍板）：2026-07-02 之后经中广核渠道（#2370，行上 feed=cgn-api）写入本公共族的行，
  // 传输渠道不改变可见性——只对授权集合含中广核的账号可见（中广核公司、平台超管 ADMIN、显式获授权者）。
  // 按「日期之后 + 来源通道」双条件认定：同一日期之后的公共来源（南网披露包、公开送受电预测等）照常公开。
  // 不删数据，只在读路径过滤。
  yn_system_forecast: {
    apiFamily: null, label: '云南系统预测vs实际(负荷/新能源/水电/总发电/省间/用户电价·长表)', kind: 'row', visibility: 'public',
    restrictedSegments: [{ after: '2026-07-02', feed: 'cgn-api', ownerCompanyId: CGN_YUNNAN_COMPANY_ID, reason: '经中广核渠道取得后写入公共族（#3066）' }],
  },
  // yn_node_price 虽源自公共披露，但按自有厂站节点白名单聚合且带厂站映射 → 谨慎面定 company（#516 风险节定稿）。
  yn_node_price: { apiFamily: null, label: '云南自有节点电价(日聚合·快速上屏)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  yn_system_supply: { apiFamily: null, label: '云南系统供需实际(日内时序·快速上屏)', kind: 'row', visibility: 'public' },
  // 气象为 Open-Meteo 公开可得数据，定 public；站点清单含场站坐标（公开信息），多公司接入后按站点归属再评估。
  yn_meteo: { apiFamily: '/weather/meteo', label: '云南气象要素(Open-Meteo·hourly)', kind: 'row', visibility: 'public' },
  yn_irradiance: { apiFamily: '/weather/irradiance', label: '云南辐照(Open-Meteo·hourly)', kind: 'row', visibility: 'public' },
  weather_asof: { apiFamily: null, label: '历史当时气象预报(Open-Meteo Previous Runs·hourly)', kind: 'row', visibility: 'public' },

  // ── 补登记：磁盘有数据但此前未在本表登记的 6 个族（#1987 · 2026-08-14 用户拍板 public）──
  //
  // ⚠️ **未登记 ≠ 没有可见性**：`getFamilyVisibility()` 对未登记 family 返回 `public`，
  // 也就是说这 6 类此前一直是**匿名可读**的——只是没人显式声明过。
  // 「登记为 public」与「未登记默认 public」结果相同、性质不同：前者有据可查，
  // 后者是漏登记撞上了默认值。#1983 的 `meta.data_type_registry` 会随之把它们从
  // `source_system='unregistered'` / `visibility='UNCLASSIFIED'` 转为正式登记。
  //
  // 定级依据是**实际打开看过内容**，不是按族名猜：
  //   · sdpt_zsjfx 的 112 个文件里 107 个是 `singleData`——省调发布的新能源预测曲线图表；
  //     其余是节假日/节气配置与展示项配置。**它与「结算」无关**（早前按名字猜成
  //     「市场结算分析」是错的，已在 #1987 订正）。
  //     ⚠️ #1478 复核修正：`singleData` 的 dataMap 内混装「公司新能源预测/公司负荷预测」
  //     系列且行级带 `sdgs_id`（实测 224 文件中 72 个含主体标识），同文件混公私无法键级拆分
  //     ——⑦ 号规则（public 族载荷不得含公司主体标识）判红。改判 company（与同宿主
  //     sdpt_zrqsb 同构）；索引族 sdpt_zsjfx_idx 无主体载荷，维持 public。
  //   · profile_ptwd 是一个 Excel 附件：副高指数 1991-2025（公开气象指数）。
  //   · 三个 weather_* 与 sdpt_area 分别是气象预报/行政区树/区域字典。
  //
  // 全部 kind: 'document'——它们的响应是对象或数组整体消费（预测曲线的 dataMap、
  // 行政区树的嵌套 children、字典的 label 列表），拆成行式表会在登记阶段做口径变更。
  sdpt_zsjfx: { apiFamily: null, label: '数据分析单图数据(新能源预测曲线/节假日配置)', kind: 'document', visibility: 'company', ownerCompanyId: SANDE_SHANXI_COMPANY_ID },
  weather_hourlyData: { apiFamily: null, label: '逐小时天气预报(温度/风速/天气码)', kind: 'document', visibility: 'public' },
  weather_dayData: { apiFamily: null, label: '逐日天气预报(当前天气+多日展望)', kind: 'document', visibility: 'public' },
  weather_districtTree: { apiFamily: null, label: '气象行政区树(市/区县+中心坐标)', kind: 'document', visibility: 'public' },
  sdpt_area: { apiFamily: null, label: '交易中心区域/主体字典', kind: 'document', visibility: 'public' },
  profile_ptwd: { apiFamily: null, label: '平台文档附件(副高指数等公开资料)', kind: 'document', visibility: 'public' },
  yn_dim_plant: { apiFamily: null, label: '云南电厂主数据(DIM·四路映射权威)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  yn_dim_plant_alias: { apiFamily: null, label: '云南电厂别名(四路:集控实际/集控预测/一体化/中长期)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  yn_dim_plant_node: { apiFamily: null, label: '云南电厂↔节点映射(DIM)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  yn_user_price: { apiFamily: null, label: '云南用户侧统一电价(日前/实时)', kind: 'row', visibility: 'public' },
  yn_plant_nodal_price: { apiFamily: null, label: '云南厂站节点多价型结算电价', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  yn_settlement_detail: { apiFamily: null, label: '云南月结明细拆分(summary/charge/project/source)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  yn_hydro_group_limit: { apiFamily: null, label: '云南水电群电量上限(优化出清披露)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  // 手录市场公报（全省公共口径：概览/发电/售电/储能/价格/月度/指标）→ public。
  // 套餐明细及聚合 KPI 均拆到 company 私有族 market_retail_packages（下条）。
  market_analysis: { apiFamily: null, label: '市场经营分析(手录·公共口径)', kind: 'row', visibility: 'public' },
  // 售电套餐经营口径（#669 + #815）：含明细与聚合 KPI，属公司私有经营数据 → company，
  // 族级归属中广核云南（comp-cgn-yunnan）。仅归属公司+ADMIN 可读（enforceCaptureVisibility 授权闸门），
  // 非归属公司走前端 synthetic 授权态（标模拟数据、不泄漏）。
  market_retail_packages: { apiFamily: null, label: '售电套餐经营口径(手录·公司私有)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  // 南网披露表通用长表（issue #2825）：17 张 tb_disclosure_* 披露表共享一族（datasetKey=源表短名）。
  // public 定级依据：南网全网披露口径（省间联络线/备用/检修/调峰等，含广东/广西等行级区域字段，
  // 行内自述来源），非任何公司的经营数据——与 grid.disclosure_events 已接入的披露事件表同源公开。
  yn_disclosure_metric: { apiFamily: null, label: '南网披露表通用度量长表(17 键·备用/联络线/机组/价格权重等)', kind: 'row', visibility: 'public' },
  // —— 中广核月包导出表上传契约（issue #2824）——
  // 月包独有数据（不与整年导出重复）经上传中心 kind='cgn-spot-export' 直传。全部 company
  // 私有、owner=comp-cgn-yunnan（厂站级经营/结算数据，与 yn_loss_attribution 等兄弟族同定级）。
  // 写入语义：A–D 类增量（ingestRowsIncremental，feed='spot-export-upload'，#2744 dates 集合窗口
  // 替换——同月重传幂等、跨月追加，历史月物理不触碰）；E 余 3 族全量快照替换（同 cgn-mapping）。
  yn_plant_timeseries: { apiFamily: null, label: '云南厂站时段长表(出力/价差/中长期/集控发电·月包)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  yn_plant_daily_metrics: { apiFamily: null, label: '云南厂站日报指标宽表(月包)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  yn_settlement_docs: { apiFamily: null, label: '云南结算单据(结算明细/账单单元格/审批流·月包保真)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  yn_contracts: { apiFamily: null, label: '云南电力合同与曲线(月包·24点宽表保真)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  yn_dim_plant_capacity: { apiFamily: null, label: '云南电厂装机容量(DIM·月包)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  yn_dim_node: { apiFamily: null, label: '云南节点地理映射(DIM·月包)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
  yn_dim_self_owned_plant: { apiFamily: null, label: '云南自营厂映射(DIM·月包)', kind: 'row', visibility: 'company', ownerCompanyId: CGN_YUNNAN_COMPANY_ID },
}

// 全部已登记数据源 code
export const CAPTURE_FAMILY_CODES = Object.keys(CAPTURE_FAMILIES)

/**
 * 查询 family 的数据可见性分级（Sub-2 /api/real 闸门的判定依据）。
 * 未登记 family 返回 public（现状兼容零回归）——但静态门禁 verify:data-classification
 * 强制所有已登记族显式标注、所有 yn_* 归一化产出族必须登记，漏标在 CI 被拦而非运行时放行。
 * @param {string} code family code（如 'yn_plant_output'）
 * @returns {{ visibility: 'public'|'company', ownerCompanyId: string|null }}
 */
export function getFamilyVisibility(code, datasetKey) {
  const fam = CAPTURE_FAMILIES[code]
  if (!fam) return { visibility: DATA_VISIBILITY.PUBLIC, ownerCompanyId: null }
  // 键级 visibility 覆盖（#1635）：family 级 public、某 datasetKey 键级 company 的族（如
  // sdpt_zcqxhdl 的 `__list__` 键），读路径按 datasetKey 判私有，其余键保持 family 级 public。
  if (datasetKey != null && fam.datasetVisibility) {
    const keyed = datasetVisibilityFor(fam, datasetKey)
    if (keyed === DATA_VISIBILITY.COMPANY) {
      return { visibility: DATA_VISIBILITY.COMPANY, ownerCompanyId: keyedOwnerFor(fam, datasetKey) }
    }
    if (keyed === DATA_VISIBILITY.PUBLIC) {
      return { visibility: DATA_VISIBILITY.PUBLIC, ownerCompanyId: null }
    }
  }
  const visibility = fam.visibility === DATA_VISIBILITY.COMPANY ? DATA_VISIBILITY.COMPANY : DATA_VISIBILITY.PUBLIC
  return { visibility, ownerCompanyId: visibility === DATA_VISIBILITY.COMPANY ? (fam.ownerCompanyId ?? null) : null }
}

/**
 * 公共族里的受限段（#3066）：返回当前账号看不到的段 [{ after, feed }]——「业务日期晚于 after 且来源
 * 通道为 feed」的行。受限段只对授权公司集合含其归属公司的账号放行；集合缺省按空集合处理——调用方
 * 忘了传就过滤（fail-closed），不会把受限段当公共数据发出去。
 * @param {string} code family code
 * @param {readonly string[] | null | undefined} authorizedCompanyIds 账号授权公司集合（ADMIN 为全部公司）
 * @returns {readonly { after: string, feed: string }[]}
 */
export function captureHiddenSegments(code, authorizedCompanyIds) {
  const segments = CAPTURE_FAMILIES[code]?.restrictedSegments
  if (!Array.isArray(segments) || !segments.length) return Object.freeze([])
  const authorized = new Set((Array.isArray(authorizedCompanyIds) ? authorizedCompanyIds : []).filter(Boolean).map(String))
  return Object.freeze(segments
    .filter((segment) => !authorized.has(segment.ownerCompanyId))
    .map((segment) => Object.freeze({ after: segment.after, feed: segment.feed })))
}

/**
 * 只能按日期截断的载体（语义层 Parquet 公共视图：列里没有来源通道）用的保守边界：返回当前账号能
 * 完整看到的最后一个业务日，不受限返回 null。比按来源过滤更严——边界之后的公共行在这类载体里也不放。
 */
export function captureVisibleThrough(code, authorizedCompanyIds) {
  let through = null
  for (const segment of captureHiddenSegments(code, authorizedCompanyIds)) {
    if (through === null || segment.after < through) through = segment.after
  }
  return through
}

/** 该族是否登记了按业务日期划分的受限段（读路径据此决定要不要解析账号授权集合）。 */
export function hasRestrictedSegments(code) {
  const segments = CAPTURE_FAMILIES[code]?.restrictedSegments
  return Array.isArray(segments) && segments.length > 0
}

// 文件词干归一化（#1635）：去掉 .json 后缀 / 尾部内容 hash / 尾部日期，与 verify:data-classification
// ⑦ 扫描口径一致（该脚本原本自带同名私有函数，现统一引用本导出，避免两处词干规则漂移）。
export function captureDatasetStem(value) {
  return String(value ?? '')
    .replace(/\.json$/i, '')
    .replace(/__[0-9a-f]{6,}$/i, '')
    .replace(/__?\d{4}-\d{2}-\d{2}$/, '')
}

// 键级 visibility 命中：登记键是前端 match（如 `__list__`），运行时 datasetKey 可能是 match 原样、
// 也可能是文件词干（如 `sdpt__zcqxhdl__list`——去 hash 后以 `__list` 结尾）。命中规则：
//   1) 精确相等；2) 词干化后相等；3) 核心词段匹配：登记键去首尾下划线得核心（`__list__` → `list`），
//      词干以 `__核心` 结尾或含 `__核心__` 即命中（`sdpt__zcqxhdl__list`.endsWith(`__list`) ✓）。
//      该规则只匹配「登记键带下划线包裹」的键，纯字符串键（如 'list'）走 1/2 精确路径，不会误伤。
function matchKeyedVisibilityKey(fam, datasetKey) {
  const key = String(datasetKey ?? '')
  if (Object.hasOwn(fam.datasetVisibility, key)) return key
  const stem = captureDatasetStem(key)
  if (stem !== key && Object.hasOwn(fam.datasetVisibility, stem)) return stem
  for (const k of Object.keys(fam.datasetVisibility)) {
    const core = k.replace(/^_+|_+$/g, '')
    if (core && core !== k && (stem.endsWith(`__${core}`) || stem.includes(`__${core}__`))) return k
    if (stem === k) return k
    // #1724 收紧：登记键核心段以「下划线分隔段」出现在词干中（命名约定变化，如采集侧改
    // 单下划线连 hash：`sdpt__zcqxhdl__list_41d8e962f5`）→ 无法精确判定归属 → 按键级
    // company fail-closed，防命名漂移导致静默回落族级 public（安全闸门上的隐式假设）。
    // 用段边界而非 includes（`listrs_full` 含 'list' 子串但段不同，不误伤公共键）。
    if (core && stem.split('_').includes(core)) return k
  }
  return null
}

function datasetVisibilityFor(fam, datasetKey) {
  const k = matchKeyedVisibilityKey(fam, datasetKey)
  return k != null ? fam.datasetVisibility[k] : null
}

// 键级 company 的 owner：优先 datasetOwners[命中键]（无 region 限定形式），回落 family 默认 ownerCompanyId。
function keyedOwnerFor(fam, datasetKey) {
  const k = matchKeyedVisibilityKey(fam, datasetKey)
  if (k != null && fam.datasetOwners && Object.hasOwn(fam.datasetOwners, k)) return fam.datasetOwners[k]
  return fam.ownerCompanyId ?? null
}

/**
 * 数据集级 owner 归属解析（#667 / #656 决策记录方案 B）：以 (family, region, datasetKey) 为归属键，
 * 命中 family.datasetOwners 时返回键级归属，否则回落 family 默认 ownerCompanyId（getFamilyVisibility 同源）。
 * 归属键优先级：datasetOwners['<region>/<datasetKey>'] > datasetOwners['<datasetKey>'] > family 默认 ownerCompanyId。
 * 只有 company 族参与解析；public/未登记族恒返回 null（**visibility 判定仍保持 family 级，键级只做 owner**）。
 * 纯静态、零 DB 依赖。fail-closed 语义：company 族最终解析为 null 时，回放闸门 authorized.includes(null) 恒 false → 拒绝。
 * @param {string} family family code
 * @param {string|undefined} region 地区 id（可空；file/list 端点无 datasetKey 粒度时 datasetKey 传 undefined）
 * @param {string|undefined} datasetKey 数据集键（undefined → 直接回落 family 默认 owner，行为与旧 family 级一致）
 * @param {Record<string, object>} [familyMap=CAPTURE_FAMILIES] 注册表注入点（供 verify:data-classification 键级 fixture 静态自测）
 * @returns {string|null} 归属 companyId；无登记/非 company 族/无默认 owner → null
 */
export function resolveCaptureOwner(family, region, datasetKey, familyMap = CAPTURE_FAMILIES) {
  const fam = familyMap[String(family ?? '')]
  if (!fam) return null
  // 键级 company（#1635）：family 级 public 但某 datasetKey 键级 company（datasetVisibility）时，
  // owner 取 datasetOwners 键级登记（fallback family 默认 owner），与 family 级 company 族同语义。
  if (fam.visibility !== DATA_VISIBILITY.COMPANY) {
    if (datasetKey != null && fam.datasetVisibility && datasetVisibilityFor(fam, datasetKey) === DATA_VISIBILITY.COMPANY) {
      return keyedOwner(fam, region, datasetKey)
    }
    return null
  }
  return keyedOwner(fam, region, datasetKey)
}

// datasetOwners 键级归属解析：优先级 datasetOwners['<region>/<datasetKey>'] > datasetOwners['<datasetKey>'] > family 默认 ownerCompanyId。
// 命中键用 matchKeyedVisibilityKey 归一（#1635）：运行时传文件词干（如 `sdpt__zcqxhdl__list`）时，
// 仍能解析到登记在 `__list__` 键下的 owner。
function keyedOwner(fam, region, datasetKey) {
  const owners = fam.datasetOwners
  if (owners && datasetKey != null) {
    const key = fam.datasetVisibility ? (matchKeyedVisibilityKey(fam, datasetKey) ?? datasetKey) : datasetKey
    const reg = String(region ?? '').trim().toLowerCase()
    const scopedKey = reg ? `${reg}/${key}` : null
    if (scopedKey && Object.hasOwn(owners, scopedKey)) return owners[scopedKey]
    if (Object.hasOwn(owners, key)) return owners[key]
  }
  return fam.ownerCompanyId ?? null
}

// 真·全国/全球通用公共族（crossRegion:true）：非地区专属，允许跨地区回退基线服务（Issue #569 PR-3）。
// 仅 public 族可标 crossRegion；company 私有族恒地区+公司双严格，绝不跨地区。
export function isCrossRegionFamily(code) {
  const fam = CAPTURE_FAMILIES[code]
  return Boolean(fam && fam.crossRegion === true && fam.visibility !== DATA_VISIBILITY.COMPANY)
}

// 电网通用公共族的电网范围（gridScope:'sgcc'/'csg'，Issue #575）：仅在同电网地区间共享。
// 仅 public 族可标；company 私有族恒地区+公司双严格，绝不跨地区/跨电网。返回 null=非电网通用族。
export function getFamilyGridScope(code) {
  const fam = CAPTURE_FAMILIES[code]
  if (!fam || fam.visibility === DATA_VISIBILITY.COMPANY) return null
  return typeof fam.gridScope === 'string' ? fam.gridScope : null
}

// —— 内容日期索引（#1531）：文件名不含日期、但采集侧车记录了请求日期的族 ——
//
// 背景：capture-replay 的选文件逻辑是**文件名子串匹配**（`f.includes(match)`）。部分族的采集
// 文件名是内容 hash（`sdpt__zrqsb__list__03f18dff6d.json`），按日期 match 永远命不中 → 恒落
// mock 兜底，尽管磁盘上真有逐日数据。日期其实在配套 `.meta.json` 侧车里：POST 族在 `postData`
// （JSON 串），GET 族在 `query`（查询串）。
//
// 刻意做成**按族显式登记**而非全局启发式：侧车里出现的日期未必是「该文件代表哪一天」——
// `sdpt_zjyap` 的 `startDate/endDate` 是查询区间、`knn-api_api` 的 `train_ranges` 是训练窗口，
// 拿它们当内容日期会把不相干的文件配到某一天上。只有语义确为「这份文件就是这一天」的族才登记。
//
// field：侧车 postData(JSON) / query(querystring) 里的日期字段名。
export const CAPTURE_CONTENT_DATE_INDEX = {
  // 日前上报：postData `{"date":"2026-05-18","sdgsId":7,...}`，一文件一天，92 个文件
  // 覆盖 2026-04-01~06-30（其中 06-05 起 26 天为无申报的空壳，dl 为空数组）。
  sdpt_zrqsb: { field: 'date' }
}

/** 该族是否按内容日期建索引（见 CAPTURE_CONTENT_DATE_INDEX）；返回 { field } 或 null。 */
export function getContentDateIndex(code) {
  const spec = CAPTURE_CONTENT_DATE_INDEX[code]
  return spec && typeof spec.field === 'string' ? spec : null
}

// —— 59 个归一化业务行族（来自 rowFieldTypes）：纳入全量编目，便于「所有数据源」完整覆盖 ——
export const NORMALIZED_FAMILIES = Object.fromEntries(
  Object.entries(rowFieldTypes).map(([apiFamily, fields]) => [
    apiFamily,
    { apiFamily, code: apiFamily.replace(/^\//, '').replaceAll('/', '_'), kind: 'normalized-row', fields }
  ])
)

// 把日期型/列表型 match 归一为稳定 dataset_key。
function normalizeKey(match) {
  return String(match ?? 'default').trim() || 'default'
}

/**
 * 按 (code, match) 描述该数据集的落库结构。
 * @returns {{ kind:'row'|'document', datasetKey:string, schema?:object, dateField?:string, typeField?:string, docKeys?:string[], cadence?:'monthly', docDateFilter?:{containers:string[],dateField:string} }|null}
 *
 * docDateFilter（#1531）：document 族的 `data` 是 `{容器: 行数组}`，`dateField` 那套行级过滤
 * 用不上。声明后 filterReplayRows 会对**列出的容器**按 `dateField` 做闭区间切片，未列出的容器
 * 原样保留（如 listrs 的 `rjz` 是跨全历史的时点切面聚合，按日切会被整体抹掉）。
 */
export function describeDataset(code, match) {
  const fam = CAPTURE_FAMILIES[code]
  if (!fam) return null
  const m = String(match ?? '')
  const key = normalizeKey(match)

  switch (code) {
    case 'sdpt_zptjg': {
      if (m.includes('tag92')) return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.zptjg_interprov, dateField: 'date' }
      if (m.includes('tag61')) return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.zptjg_price, dateField: 'date', typeField: 'type' }
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.zptjg_daily, dateField: 'date' }
    }
    case 'sdpt_zptsj':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.zptsj_misplace, dateField: 'riqi' }
    case 'sdpt_zxztqa':
      return { kind: 'row', datasetKey: key, schema: object({ riqi: str({ required: true }), type: num(), jz: num(), ...P96 }), dateField: 'riqi', typeField: 'type' }
    case 'sdpt_zgnrx':
      if (m.includes('qxyc')) return { kind: 'document', datasetKey: key, docKeys: DOC_KEYS.qxyc }
      return { kind: 'row', datasetKey: key, schema: object({ yxrq: str({ required: true }), sjlx: num(), jz: num(), ...P96 }), dateField: 'yxrq', typeField: 'sjlx' }
    case 'sdpt_zptqx':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.zptqx_estimate, dateField: 'date', typeField: 'type' }
    case 'sdpt_zfsdjy':
      if (m.includes('ccljk')) return { kind: 'document', datasetKey: key, docKeys: DOC_KEYS.zfsdjy_pos }
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.zfsdjy_trade, dateField: 'jyrq', typeField: 'sjlx' }
    case 'sdpt_zjyap':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.zjyap_calendar, dateField: 'jyrq' }
    case 'sdpt_zptwd':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.zptwd_doc, dateField: 'scrq' }
    case 'sdpt_elninolanina':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.elninolanina }
    case 'system_dict':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.system_dict }
    case 'sdpt_zcqxhdl': {
      let docKeys = DOC_KEYS.zcqxhdl_curve
      if (m.includes('listrs')) {
        // listrs_full 是**单文件装全历史**（7.6MB，rmx/dmx 各 2868 行 = 1434 运行日 × 2 类型）。
        // 不按日切片就把 4 年数据整包推给调用方，抽取层再混成跨多天序列（#1531）。
        // 只切 rmx/dmx（逐运行日行，date=运行日）；rjz 是跨全历史的时点切面聚合、无运行日语义，
        // 按日切会被整体抹掉，故不列入。
        return {
          kind: 'document', datasetKey: key, docKeys: DOC_KEYS.zcqxhdl_listrs,
          docDateFilter: { containers: ['rmx', 'dmx'], dateField: 'date' }
        }
      }
      if (m.includes('fhlist24')) docKeys = DOC_KEYS.zcqxhdl_fhlist24
      else if (m.includes('list24')) docKeys = DOC_KEYS.zcqxhdl_list24
      else if (m.includes('__list__') || m === 'list') docKeys = DOC_KEYS.zcqxhdl_list
      return { kind: 'document', datasetKey: key, docKeys }
    }
    case 'sdpt_actualLoad':
      return { kind: 'document', datasetKey: key, docKeys: m.includes('query2') ? DOC_KEYS.actualLoad_query2 : DOC_KEYS.actualLoad_query }
    case 'sdpt_zrqsb':
      return { kind: 'document', datasetKey: key, docKeys: DOC_KEYS.zrqsb }
    case 'sdpt_fshq':
      return { kind: 'document', datasetKey: key, docKeys: DOC_KEYS.fshq }
    case 'knn-api_api':
      // 逐日 96 点中枢预测曲线（{drrq,p1..p96}，etl:yunnan-derive-families 派生）：
      // match 含 daily（派生文件名）或为纯运行日（spotPriceCore.loadForecastCurve 的 DB 精确查）。
      // 文件名刻意不含 predict——RollingPricePredictionView match='predict' 只命中汇总文档，
      // loadForecastCurve match=<date> 只命中逐日曲线，两者互不竞争。
      if (m.includes('daily') || /^\d{4}-\d{2}-\d{2}$/.test(m)) return { kind: 'document', datasetKey: key, docKeys: [] }
      return { kind: 'document', datasetKey: key, docKeys: DOC_KEYS.knn }
    case 'sdpt_console': {
      let docKeys = DOC_KEYS.console_load
      if (m.includes('getCorpNewEnergyChart')) docKeys = DOC_KEYS.console_ne
      else if (m.includes('getAveragePriceChart') || isSdptConsoleAverageHash(m)) docKeys = DOC_KEYS.console_avg
      return { kind: 'document', datasetKey: key, docKeys }
    }
    case 'sdpt_zsjfx_idx':
      return { kind: 'document', datasetKey: key, docKeys: m.includes('meta') ? DOC_KEYS.zsjfx_meta : DOC_KEYS.zsjfx_day }

    // ── 补登记那 6 个族的落库声明（#1987）────────────────────────────────────
    //
    // 全部 `docKeys: []`——**空数组不是「没查」，是「整个 payload 原样存」**
    // （同上面 knn 的逐日曲线分支）。这几族的响应结构各不相同且都被整体消费：
    // 预测曲线的 dataMap / 行政区树的嵌套 children / 字典的 label 列表 /
    // Excel 附件的二进制。声明具体 docKeys 等于在登记阶段替它们定结构，
    // 而本期只做「让它们有个正式归宿」，不做口径变更。
    case 'sdpt_zsjfx':
    case 'weather_hourlyData':
    case 'weather_dayData':
    case 'weather_districtTree':
    case 'sdpt_area':
    case 'profile_ptwd':
      return { kind: 'document', datasetKey: key, docKeys: [] }
    case 'yn_loss_attribution':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_loss_attribution, dateField: 'date' }
    case 'yn_system_forecast':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_system_forecast, dateField: 'operateDate' }
    case 'yn_spot_settlement':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_spot_settlement, dateField: 'date' }
    case 'yn_plant_output':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_plant_output, dateField: 'date' }
    case 'yn_node_price':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_node_price, dateField: 'date' }
    case 'yn_system_supply':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_system_supply, dateField: 'date' }
    case 'yn_meteo':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_meteo, dateField: 'date' }
    case 'yn_irradiance':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_irradiance, dateField: 'date' }
    case 'weather_asof':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.weather_asof, dateField: 'date' }
    case 'yn_dim_plant':
      // 维度表（非时序），无 dateField；单数据集，datasetKey 由 match 归一。
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_dim_plant }
    case 'yn_dim_plant_alias':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_dim_plant_alias }
    case 'yn_dim_plant_node':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_dim_plant_node }
    case 'yn_user_price':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_user_price, dateField: 'operateDate' }
    case 'yn_plant_nodal_price':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_plant_nodal_price, dateField: 'date' }
    case 'yn_settlement_detail':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_settlement_detail, dateField: 'month', cadence: 'monthly' }
    case 'yn_hydro_group_limit':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_hydro_group_limit, dateField: 'operateDate' }
    case 'market_analysis': {
      // public 7 个 datasetKey 按 match（即 datasetKey 名）精确匹配；未登记 key 拒收。
      const schema = marketAnalysisSchemas[key]
      if (!schema) return null
      if (key === 'market_monthly_trend' || key === 'market_price') {
        return { kind: 'row', datasetKey: key, schema, dateField: 'month', cadence: 'monthly' }
      }
      return { kind: 'row', datasetKey: key, schema }
    }
    case 'market_retail_packages': {
      // #669/#815：售电套餐公司私有族（明细 + 聚合 KPI）；match 即 datasetKey 名。
      const schema = marketRetailPackageSchemas[key]
      if (!schema) return null
      return { kind: 'row', datasetKey: key, schema }
    }
    case 'yn_disclosure_metric':
      // issue #2825：17 个披露表 datasetKey 共享同一 schema，match（源表短名）不限名单；
      // 未登记 datasetKey 的拒收由 source-registry target 解析与上传契约白名单承担。
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_disclosure_metric, dateField: 'operateDate' }
    // —— 月包导出表上传契约（#2824）——datasetKey = 月包表名（剥 _YYYYMM 后缀）。
    // 同族各表 dateField 不同（日粒度 data_date/day，月粒度 settle_month/settlemonth），
    // 按 key 精确匹配声明；未登记 key 拒收（与 market_analysis 同款「未登记拒收」）。
    case 'yn_plant_timeseries':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_plant_timeseries, dateField: 'date', typeField: 'dataType' }
    case 'yn_plant_daily_metrics':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_plant_daily_metrics, dateField: 'date' }
    case 'yn_settlement_docs': {
      const settleDocDateFields = {
        plant_spot_settle_data: 'data_date',
        plant_daily_settlement_raw: 'data_date',
        plant_daily_split_settlement_raw: 'data_date',
        settlement_bill_excel_cells: 'settle_month',
        settlement_bill_records_raw: 'settle_month',
        settlement_bill_file_downloads: 'settle_month',
        plant_monthly_settlement_raw: 'settlemonth',
      }
      const schema = {
        plant_spot_settle_data: ROW_SCHEMAS.yn_settle_plant_spot_data,
        plant_daily_settlement_raw: ROW_SCHEMAS.yn_settle_daily_settlement_raw,
        plant_daily_split_settlement_raw: ROW_SCHEMAS.yn_settle_daily_split_raw,
        settlement_bill_excel_cells: ROW_SCHEMAS.yn_settle_bill_excel_cells,
        settlement_bill_records_raw: ROW_SCHEMAS.yn_settle_bill_records_raw,
        settlement_bill_file_downloads: ROW_SCHEMAS.yn_settle_bill_file_downloads,
        plant_monthly_settlement_raw: ROW_SCHEMAS.yn_settle_monthly_raw,
      }[key]
      if (!schema) return null
      return { kind: 'row', datasetKey: key, schema, dateField: settleDocDateFields[key], cadence: 'monthly' }
    }
    case 'yn_contracts': {
      const contractSpec = {
        electricity_contracts: { schema: ROW_SCHEMAS.yn_contract_electricity, dateField: 'deliveryPeriodBegin' },
        contract_curves: { schema: ROW_SCHEMAS.yn_contract_curves, dateField: 'day' },
      }[key]
      if (!contractSpec) return null
      return { kind: 'row', datasetKey: key, schema: contractSpec.schema, dateField: contractSpec.dateField }
    }
    case 'yn_dim_plant_capacity':
      // 全量维度快照（非时序），无 dateField；datasetKey = 族名（schema 按族固定，
      // 不随 match 变——match 传空/传族名/传任意值同一 schema）。
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_dim_plant_capacity }
    case 'yn_dim_node':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_dim_node }
    case 'yn_dim_self_owned_plant':
      return { kind: 'row', datasetKey: key, schema: ROW_SCHEMAS.yn_dim_self_owned_plant }
    default:
      return null
  }
}

// —— 演示种子计划：每个数据源的代表性 (code, match)，供 db:seed 从 mock 生成器灌入 ——
export const CAPTURE_SEED_PLAN = [
  { code: 'sdpt_zptjg', match: 'list_tag61_full' },
  { code: 'sdpt_zptjg', match: 'list_tag12_full' },
  { code: 'sdpt_zptjg', match: 'list_tag27_full' },
  { code: 'sdpt_zptjg', match: 'list_tag28_full' },
  { code: 'sdpt_zptjg', match: 'list_tag92_full' },
  { code: 'sdpt_zptsj', match: 'list_tag61_full' },
  { code: 'sdpt_zxztqa', match: 'list_full' },
  { code: 'sdpt_zgnrx', match: 'list_full' },
  { code: 'sdpt_zgnrx', match: 'qxyc_wide' },
  { code: 'sdpt_zptqx', match: 'list' },
  { code: 'sdpt_zfsdjy', match: 'list' },
  { code: 'sdpt_zfsdjy', match: 'ccljkDay__2026-06' },
  { code: 'sdpt_zfsdjy', match: 'ccljkTime__2026-06-01' },
  { code: 'sdpt_zjyap', match: 'calendar' },
  { code: 'sdpt_zptwd', match: 'list' },
  { code: 'sdpt_elninolanina', match: 'list' },
  { code: 'system_dict', match: 'sdpt_zptjg_type_ycjg' },
  { code: 'sdpt_zcqxhdl', match: 'listrs_full' },
  { code: 'sdpt_zcqxhdl', match: '__list__' },
  { code: 'sdpt_zcqxhdl', match: 'fhlist24__2026-06-02' },
  { code: 'sdpt_zcqxhdl', match: '_list24__2026-06-02' },
  { code: 'sdpt_actualLoad', match: 'query__' },
  { code: 'sdpt_actualLoad', match: 'query2__' },
  { code: 'sdpt_zrqsb', match: '60e0650d2c' },
  { code: 'sdpt_fshq', match: 'rqlx0__2026-06-01' },
  { code: 'knn-api_api', match: 'predict' },
  { code: 'sdpt_console', match: 'getCorpNewEnergyChart' },
  { code: 'sdpt_console', match: 'd859fbde03' },
  { code: 'sdpt_console', match: '275c1ef9fa' },
  { code: 'sdpt_console', match: '317f0f0bbd' },
  { code: 'sdpt_console', match: '0b36fa2030' },
  { code: 'sdpt_console', match: '0144aacb91' },
  { code: 'sdpt_console', match: '7db3560c48' },
  { code: 'sdpt_console', match: 'getAveragePriceChart' },
  { code: 'sdpt_zsjfx_idx', match: 'zsjfx_meta' },
  { code: 'sdpt_zsjfx_idx', match: 'zsjfx_day__2026-04-01' }
]
