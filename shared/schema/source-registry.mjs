// 声明式数据源注册表（Issue #660）。
//
// 目标：把「源输入形状、字段映射、单位、时间轴、目标 family、归属、质量规则」从
// 各导入脚本中抽出，供 Node 脚本、ImportHub 与验证门禁共享。执行层仍复用
// scripts/private-cache-adapters/* normalizer 与 server/ingestion/adapters.mjs::commitFamily。

import {
  CAPTURE_FAMILIES,
  CGN_YUNNAN_COMPANY_ID,
  DATA_VISIBILITY,
  getFamilyVisibility
} from './entities/capture-families.mjs'
import { REGION_GRID_OPERATOR } from '../region/constants.mjs'
import { listGridDatasetCodes } from './grid-dataset-catalog.mjs'

export const SOURCE_INPUT_TYPES = Object.freeze({
  API: 'api',
  COOKIE_REPLAY: 'cookie-replay',
  EXPORT_PKG: 'export-pkg',
  XLSX: 'xlsx',
  MANUAL: 'manual'
})

export const SOURCE_OWNERSHIP = Object.freeze({
  PUBLIC: 'public',
  COMPANY: 'company'
})

export const TIME_AXIS = Object.freeze({
  HOUR: 'hour',
  POINT: 'point',
  TIME: 'time'
})

// ——— 分层字段（层 3：源实例）———
// 电网体系数据集目录（层 1，`shared/schema/grid-dataset-catalog.mjs`）拥有「逻辑数据集语义」；
// 本注册表是层 3，拥有「通道」——凭据、协议、落库后端、接入成熟度。两层只以引用键相连，
// 不复制字面值（同 serving-route-registry ADR 的防发散原则）。

/** 合法电网体系值域：引用 REGION_GRID_OPERATOR 的取值，不另立词汇。 */
export const GRID_OPERATORS = Object.freeze([...new Set(Object.values(REGION_GRID_OPERATOR))])

/**
 * 落库后端。与 `ingestControl` **正交**，不要合并成一个判据：
 *   前者答「数据落在哪、要不要公司级隔离域」，后者答「取数过程要不要摄取控制面」。
 * 反例（正是二者不能合并的证据）：`csg-disclosure-cookie-replay` 是外部直连、需登录态凭据，
 *   但内容是南网**公开**披露、无公司隔离需求——落私有 PG 等于把公共数据锁进单公司域。
 */
export const STORAGE_BACKENDS = Object.freeze({
  CAPTURE_SQLITE: 'capture-sqlite',
  PRIVATE_PG: 'private-pg'
})

/**
 * 摄取控制面：取数过程是否需要凭据/批次台账/断点续跑/隔离区/原文归档这一整套。
 *   none    = 一次性导入包、手录、无状态公开 API——失败重跑即可，无需批次身份
 *   batched = 外部 API 直连持续采集——需 claim 批次、推进 checkpoint、脏行进隔离区
 */
export const INGEST_CONTROLS = Object.freeze({
  NONE: 'none',
  BATCHED: 'batched'
})

/**
 * 接入成熟度。**只声明契约、未接真实凭据的骨架不得显示为「已接入」**——
 * 服务运维页与数据目录按此字段渲染，避免把 skeleton 当成可用数据源。
 *   skeleton = 只有契约声明，无实现或无凭据协议
 *   wired    = 实现完成，等真实凭据/数据到位
 *   live     = 真实数据已在流动
 */
export const SOURCE_READINESS = Object.freeze({
  SKELETON: 'skeleton',
  WIRED: 'wired',
  LIVE: 'live'
})

/** 分层字段默认值：存量声明不写即取此值，语义等同改动前的现状。 */
const DECLARATION_DEFAULTS = Object.freeze({
  // 所属电网体系。null = 不适用（气象、通用手录等非电网体系数据），不是「未声明」。
  gridScope: null,
  // 业务地域口径（这条数据讲的是哪一片），**不是**隔离地域。二者可以不同：
  // 中广核那条通道的隔离键恒为 yunnan，但它取回的南网披露覆盖五省。
  businessRegionScope: null,
  storageBackend: STORAGE_BACKENDS.CAPTURE_SQLITE,
  ingestControl: INGEST_CONTROLS.NONE,
  readiness: SOURCE_READINESS.LIVE,
  // ingestControl 与 storageBackend 的组合偏离常规时写明理由（门禁警告级）
  backendRationale: null
})

function target({
  family,
  datasetKey,
  ownership,
  ownerCompanyId = null,
  requiredFields = [],
  valueFields = [],
  expectedPointsPerDay = null,
  capturedAtField = null,
  qualityRules = {}
}) {
  const visibility = getFamilyVisibility(family)
  const resolvedOwnership = ownership ?? visibility.visibility
  return {
    family,
    datasetKey,
    ownership: resolvedOwnership,
    ownerCompanyId: resolvedOwnership === SOURCE_OWNERSHIP.COMPANY
      ? (ownerCompanyId ?? visibility.ownerCompanyId ?? null)
      : null,
    requiredFields,
    valueFields,
    expectedPointsPerDay,
    capturedAtField,
    qualityRules
  }
}

/**
 * 私有 PG 落库目标（配 `storageBackend: 'private-pg'`）。与 capture target 三点不同：
 *
 *   1. **没有 family/datasetKey**——不落 capture.sqlite。两条存储路径单轨隔离，
 *      `assertSourceDeclaration` 会拒绝 private-pg 源复用 capture family。
 *   2. 用 `resourceKind` 对应 PG 的 `resource_kind`：批次、checkpoint、隔离区都按它分组。
 *   3. **不含 SQL**。INSERT 语句属执行层（`factInsertSql` 由摄取器传入），声明层只说
 *      「落哪张表、该表收哪些逻辑数据集」，避免注册表变成 SQL 仓库。
 *
 * `datasetRefs` 是**引用键**——指向层 1 `grid-dataset-catalog` 的 datasetCode，调用方应
 * 用 `listGridDatasetCodes()` 派生而不是手写清单，否则层 1 增删数据集时这里会静默漂移。
 */
function privatePgTarget({
  resourceKind,
  factTable,
  datasetRefs = null,
  datasetRefsNote = null,
  checkpointKeyShape,
  requiredFields = [],
  qualityRules = {}
}) {
  return {
    backend: STORAGE_BACKENDS.PRIVATE_PG,
    resourceKind,
    factTable,
    // null = 该资源在层 1 无对应登记，必须用 datasetRefsNote 写明原因（例如上游未授予该 scope）
    datasetRefs: datasetRefs ? Object.freeze([...datasetRefs]) : null,
    datasetRefsNote,
    checkpointKeyShape,
    requiredFields,
    qualityRules
  }
}

const weatherTargets = [
  target({
    family: 'yn_meteo',
    datasetKey: 'yn_meteo_hourly',
    ownership: SOURCE_OWNERSHIP.PUBLIC,
    requiredFields: ['id', 'datetime', 'area', 'stationId', 'basis', 'sourceType', 'mock', 'productionWrite'],
    valueFields: ['temp', 'humidity', 'windSpeed', 'cloudCover', 'precipitation', 'pressure'],
    expectedPointsPerDay: 24,
    capturedAtField: 'datetime',
    qualityRules: { guardEmpty: true }
  }),
  target({
    family: 'yn_irradiance',
    datasetKey: 'yn_irradiance_hourly',
    ownership: SOURCE_OWNERSHIP.PUBLIC,
    requiredFields: ['id', 'datetime', 'area', 'stationId', 'basis', 'sourceType', 'mock', 'productionWrite'],
    valueFields: ['ghi', 'dni', 'dhi', 'directRadiation', 'poa'],
    expectedPointsPerDay: 24,
    capturedAtField: 'datetime',
    qualityRules: { guardEmpty: true }
  })
]

const weatherAsOfTargets = [
  target({
    family: 'weather_asof',
    datasetKey: 'open_meteo_previous_runs_hourly',
    ownership: SOURCE_OWNERSHIP.PUBLIC,
    requiredFields: [
      'id', 'provider', 'forecastRunId', 'modelVersion', 'featureVersion',
      'forecastAt', 'validAt', 'ingestedAt', 'regionId', 'stationId',
      'leadHours', 'values', 'licenseId', 'attribution',
      'basis', 'sourceType', 'mock', 'productionWrite'
    ],
    valueFields: [
      'temp', 'humidity', 'windSpeed', 'windSpeed100', 'windDirection',
      'cloudCover', 'precipitation', 'pressure', 'ghi', 'dni', 'dhi',
      'directRadiation'
    ],
    expectedPointsPerDay: 24,
    capturedAtField: 'validAt',
    qualityRules: { guardEmpty: true }
  })
]

const spotTargets = [
  target({
    family: 'yn_dim_plant',
    datasetKey: 'yn_dim_plant',
    ownership: SOURCE_OWNERSHIP.COMPANY,
    ownerCompanyId: CGN_YUNNAN_COMPANY_ID,
    requiredFields: ['id', 'standardName'],
    qualityRules: { guardEmpty: true }
  }),
  target({
    family: 'yn_dim_plant_alias',
    datasetKey: 'yn_dim_plant_alias',
    ownership: SOURCE_OWNERSHIP.COMPANY,
    ownerCompanyId: CGN_YUNNAN_COMPANY_ID,
    requiredFields: ['id', 'sourceType', 'standardName'],
    qualityRules: { guardEmpty: true }
  }),
  target({
    family: 'yn_dim_plant_node',
    datasetKey: 'yn_dim_plant_node',
    ownership: SOURCE_OWNERSHIP.COMPANY,
    ownerCompanyId: CGN_YUNNAN_COMPANY_ID,
    requiredFields: ['id', 'standardName'],
    qualityRules: { guardEmpty: true }
  }),
  target({
    family: 'yn_node_price',
    datasetKey: 'yn_node_price_daily',
    ownership: SOURCE_OWNERSHIP.COMPANY,
    ownerCompanyId: CGN_YUNNAN_COMPANY_ID,
    requiredFields: ['id', 'date', 'granularity', 'marketType', 'nodeName', 'area'],
    valueFields: ['price', 'avgPrice', 'maxPrice', 'minPrice'],
    capturedAtField: 'date',
    qualityRules: { guardEmpty: true }
  }),
  target({
    family: 'yn_loss_attribution',
    // datasetKey 与 yn-fact-pnl.mjs::buildLossAttribution 实际输出一致（勿写成 family 同名）。
    datasetKey: 'yn_loss_daily',
    ownership: SOURCE_OWNERSHIP.COMPANY,
    ownerCompanyId: CGN_YUNNAN_COMPANY_ID,
    requiredFields: ['id', 'date', 'plant', 'area'],
    valueFields: ['totalGenerationMwh', 'strategyLossTotal', 'forecastLossTotal', 'gridLossTotal'],
    capturedAtField: 'date',
    qualityRules: { guardEmpty: true }
  }),
  target({
    family: 'yn_spot_settlement',
    datasetKey: 'yn_settlement_daily',
    ownership: SOURCE_OWNERSHIP.COMPANY,
    ownerCompanyId: CGN_YUNNAN_COMPANY_ID,
    requiredFields: ['id', 'date', 'plant', 'area'],
    valueFields: ['totalEnergy', 'avgPrice', 'totalFee'],
    capturedAtField: 'date',
    qualityRules: { guardEmpty: true }
  }),
  target({
    family: 'yn_plant_output',
    datasetKey: 'yn_plant_output',
    ownership: SOURCE_OWNERSHIP.COMPANY,
    ownerCompanyId: CGN_YUNNAN_COMPANY_ID,
    requiredFields: ['id', 'date', 'plant', 'timePoint', 'dataType', 'seriesRole'],
    valueFields: ['valueMw'],
    expectedPointsPerDay: 24,
    capturedAtField: 'date',
    qualityRules: { guardEmpty: true }
  }),
  target({
    family: 'yn_plant_nodal_price',
    datasetKey: 'plant_nodal_price',
    ownership: SOURCE_OWNERSHIP.COMPANY,
    ownerCompanyId: CGN_YUNNAN_COMPANY_ID,
    requiredFields: ['id', 'date', 'timePoint', 'plant', 'nodeName', 'dataType'],
    valueFields: ['price'],
    expectedPointsPerDay: 96,
    capturedAtField: 'date',
    qualityRules: { guardEmpty: true }
  }),
  target({
    family: 'yn_settlement_detail',
    // 月结明细按 summary/charge/project/source 四个动态 datasetKey 落盘（yn-fact-special.mjs）。
    datasetKey: '*',
    ownership: SOURCE_OWNERSHIP.COMPANY,
    ownerCompanyId: CGN_YUNNAN_COMPANY_ID,
    requiredFields: ['id', 'recordType'],
    valueFields: ['value', 'amount', 'quantity', 'price'],
    capturedAtField: 'month',
    qualityRules: { guardEmpty: true }
  }),
  target({
    family: 'yn_hydro_group_limit',
    datasetKey: 'forecast_yn_hydro_group_energy_limit',
    ownership: SOURCE_OWNERSHIP.COMPANY,
    ownerCompanyId: CGN_YUNNAN_COMPANY_ID,
    requiredFields: ['id', 'operateDate', 'metric'],
    valueFields: ['value', 'limitMWh', 'limitMw', 'ratio'],
    expectedPointsPerDay: 96,
    capturedAtField: 'operateDate',
    qualityRules: { guardEmpty: true }
  }),
  target({
    family: 'yn_system_supply',
    datasetKey: 'yn_system_supply_demand',
    ownership: SOURCE_OWNERSHIP.PUBLIC,
    requiredFields: ['id', 'date', 'time', 'area'],
    valueFields: ['loadMWh', 'newEnergyMWh', 'hydropowerMWh'],
    expectedPointsPerDay: 96,
    capturedAtField: 'date',
    qualityRules: { guardEmpty: true }
  }),
  target({
    family: 'yn_system_forecast',
    datasetKey: '*',
    ownership: SOURCE_OWNERSHIP.PUBLIC,
    requiredFields: ['id', 'operateDate', 'timePoint', 'metric', 'region'],
    valueFields: ['value', 'valuePrev'],
    expectedPointsPerDay: 96,
    capturedAtField: 'operateDate',
    qualityRules: { guardEmpty: true }
  }),
  target({
    family: 'yn_user_price',
    datasetKey: '*',
    ownership: SOURCE_OWNERSHIP.PUBLIC,
    requiredFields: ['id', 'operateDate', 'timePoint', 'market', 'area', 'region'],
    valueFields: ['price'],
    expectedPointsPerDay: 96,
    capturedAtField: 'operateDate',
    qualityRules: { guardEmpty: true }
  })
]

export const EXCEL_TEMPLATE_DECLARATIONS = Object.freeze({
  'yn-t0-node-price': {
    templateId: 'yn-t0-node-price',
    tier: 'T0',
    label: '日前/实时节点电价按天分片',
    inputType: SOURCE_INPUT_TYPES.XLSX,
    ownership: SOURCE_OWNERSHIP.PUBLIC,
    parser: 'csv.nodePriceDaily',
    columns: [
      { name: 'operate_date', type: 'date', format: 'YYYY-MM-DD', required: true },
      { name: 'region', type: 'string', required: true },
      { name: 'node_name', type: 'string', required: true },
      { name: 'time_point', type: 'time', format: 'HH:mm', required: true },
      { name: 'price', type: 'number', unit: '元/MWh', required: true }
    ],
    // sampleRows：数组按 columns 顺序对齐，值符合各列 type/format/unit；供模板生成器写「示例行」，
    // 也供 verify:source-registry 断言「示例值与列声明类型/格式合规」。company 模板示例不含公司信息。
    sampleRows: [
      ['2026-06-01', 'yunnan', '昆明北_500kV', '00:00', 352.4],
      ['2026-06-01', 'yunnan', '昆明北_500kV', '00:15', 348.9]
    ]
  },
  'yn-t0-system-load': {
    templateId: 'yn-t0-system-load',
    tier: 'T0',
    label: '统调负荷 96 点',
    inputType: SOURCE_INPUT_TYPES.XLSX,
    ownership: SOURCE_OWNERSHIP.PUBLIC,
    parser: 'csv.systemActualLoad',
    columns: [
      { name: 'operate_date', type: 'date', format: 'YYYY-MM-DD', required: true },
      { name: 'time_point', type: 'time', format: 'HH:mm', required: true },
      { name: 'region_yn', type: 'number', unit: 'MW', required: true }
    ],
    sampleRows: [
      ['2026-06-01', '00:00', 24850.6],
      ['2026-06-01', '00:15', 24710.2]
    ]
  },
  'yn-t1-station-node': {
    templateId: 'yn-t1-station-node',
    tier: 'T1',
    label: '自有厂站-节点映射',
    inputType: SOURCE_INPUT_TYPES.XLSX,
    ownership: SOURCE_OWNERSHIP.COMPANY,
    ownerCompanyId: CGN_YUNNAN_COMPANY_ID,
    parser: 'csv.stationNodeMapping',
    note: 'company 模板不设「公司」列；归属由上传者会话或批处理 ownerCompanyId 决定。',
    columns: [
      { name: '场站名称', type: 'string', required: true },
      { name: '节点名称', type: 'string', required: true }
    ],
    // company 模板：示例行只含场站/节点名，绝不含公司信息（归属走会话）；verify:source-registry 断言。
    sampleRows: [
      ['富民光伏电站', '富民_35kV'],
      ['寻甸风电场', '寻甸_110kV']
    ]
  },
  'yn-t1-hydro': {
    templateId: 'yn-t1-hydro',
    tier: 'T1',
    label: '水电出力长表',
    inputType: SOURCE_INPUT_TYPES.XLSX,
    ownership: SOURCE_OWNERSHIP.PUBLIC,
    parser: 'csv.systemActualHydro',
    columns: [
      { name: 'operate_date', type: 'date', format: 'YYYY-MM-DD', required: true },
      { name: 'time_point', type: 'time', format: 'HH:mm', required: true },
      { name: 'region', type: 'string', required: true },
      { name: 'current_actual', type: 'number', unit: 'MW', required: true }
    ],
    sampleRows: [
      ['2026-06-01', '00:00', 'yunnan', 8120.5],
      ['2026-06-01', '00:15', 'yunnan', 8095.3]
    ]
  }
})

// 原始声明。分层字段不写即取 DECLARATION_DEFAULTS，故存量声明保持原样即等价于改动前行为；
// 导出前统一注入，避免每条手写一遍默认值（也避免新增源漏写时静默取到 undefined）。
const SOURCE_DECLARATIONS = {
  'weather-open-meteo-previous-runs': {
    sourceId: 'weather-open-meteo-previous-runs',
    label: 'Open-Meteo Previous Runs 历史当时气象预报',
    inputType: SOURCE_INPUT_TYPES.API,
    parser: 'weather.openMeteoPreviousRuns',
    endpoint: 'https://previous-runs-api.open-meteo.com/v1/forecast',
    timeSemantics: {
      forecastAt: 'validAt - previous_dayN 固定 lead；表示该值在目标时点前 N×24h 形成的预报时点',
      validAt: 'hourly.time 对应的预报目标时点（UTC）',
      ingestedAt: '本仓实际取得并版本化 Provider 响应的时点（UTC，不倒填）'
    },
    fieldMappings: {
      suffix: '<variable>_previous_dayN -> values.<feature>',
      temperature_2m: 'temp',
      relative_humidity_2m: 'humidity',
      wind_speed_10m: 'wind_speed',
      wind_speed_100m: 'wind_speed_100m',
      wind_direction_10m: 'wind_direction',
      cloud_cover: 'cloud_cover',
      precipitation: 'precipitation',
      surface_pressure: 'pressure',
      shortwave_radiation: 'ghi',
      direct_normal_irradiance: 'dni',
      diffuse_radiation: 'dhi',
      direct_radiation: 'direct_radiation'
    },
    unitConversions: { weather: 'Open-Meteo 响应单位直传；null 保持 null，不填假零' },
    timeAxis: TIME_AXIS.TIME,
    targets: weatherAsOfTargets,
    ownership: SOURCE_OWNERSHIP.PUBLIC,
    basis: 'captured',
    sourceType: 'REAL',
    mock: false,
    productionWrite: false,
    license: {
      id: 'CC-BY-4.0',
      name: 'Creative Commons Attribution 4.0 International',
      url: 'https://creativecommons.org/licenses/by/4.0/',
      providerTerms: 'https://open-meteo.com/en/licence',
      attribution: 'Weather data by Open-Meteo.com',
      freeApiUse: 'non-commercial only; fewer than 10,000 calls/day',
      commercialSeam: '当前未接付费端点；切换前须显式扩展 provider 配置并保留许可/署名'
    }
  },
  'weather-open-meteo': {
    sourceId: 'weather-open-meteo',
    label: 'Open-Meteo 云南气象与辐照',
    inputType: SOURCE_INPUT_TYPES.API,
    parser: 'weather.openMeteoHourly',
    // provider 适配层（#846）：文档性契约，声明免费/商用端点差异——运行期 provider 由环境变量解析
    // （Node 采集线 yn-fact-weather.mjs::providerEndpoints / Python NWP weather_service.py::_resolve_base_url），
    // 本字段不参与声明式解析、不改 commitDeclaredFamily 行为。默认免费档零配置行为不变。
    providerModes: {
      'open-meteo-free': 'api.open-meteo.com（forecast）+ archive-api.open-meteo.com（archive），无 key（默认）',
      'open-meteo-commercial': 'customer-api.open-meteo.com（forecast+archive）+ apikey 查询参数（订阅 key）',
      keyParam: 'apikey',
      switchEnv: 'WEATHER_PROVIDER（默认 open-meteo-free）+ OPEN_METEO_API_KEY（商用必填，落 .env.local）',
    },
    fieldMappings: {
      time: 'hourly.time -> datetime/date/time',
      meteo: {
        temperature_2m: 'temp',
        relative_humidity_2m: 'humidity',
        wind_speed_10m: 'windSpeed',
        wind_speed_100m: 'windSpeed100',
        wind_direction_10m: 'windDirection',
        cloud_cover: 'cloudCover',
        precipitation: 'precipitation',
        surface_pressure: 'pressure'
      },
      irradiance: {
        shortwave_radiation: 'ghi',
        direct_normal_irradiance: 'dni',
        diffuse_radiation: 'dhi',
        direct_radiation: 'directRadiation',
        global_tilted_irradiance: 'poa'
      }
    },
    unitConversions: { weather: 'Open-Meteo 原单位直传；缺测写 null，不填假零' },
    timeAxis: TIME_AXIS.TIME,
    targets: weatherTargets,
    ownership: SOURCE_OWNERSHIP.PUBLIC,
    basis: 'captured',
    sourceType: 'REAL',
    mock: false,
    productionWrite: false
  },
  'yunnan-spot-monthly-export': {
    sourceId: 'yunnan-spot-monthly-export',
    label: '云南现货月度导出包',
    gridScope: 'csg',
    businessRegionScope: ['yunnan'],
    inputType: SOURCE_INPUT_TYPES.EXPORT_PKG,
    parser: 'spot.monthlyExportManifest',
    manifest: 'export_manifest.csv',
    fieldMappings: {
      manifest: ['category', 'dataset', 'source', 'file', 'rows'],
      quickwin: 'node_prices/* + plant_power_forecast_actual/* -> yn_node_price/yn_system_supply',
      pnl: 'plant_spot_settlement/* -> yn_loss_attribution/yn_spot_settlement/yn_plant_output',
      forecast: 'plant_power_forecast_actual/* -> yn_system_forecast',
      dim: 'plant_master_mapping/* -> yn_dim_*'
    },
    unitConversions: {
      price: '元/MWh',
      power: 'MW',
      energy: 'MWh',
      currency: '元；展示端按万元时另行格式化'
    },
    timeAxis: TIME_AXIS.POINT,
    targets: spotTargets,
    ownership: 'mixed',
    basis: 'captured',
    sourceType: 'IMPORT',
    mock: false,
    productionWrite: false
  },
  'import-hub-market-analysis': {
    sourceId: 'import-hub-market-analysis',
    label: 'ImportHub 市场经营分析手录投递',
    inputType: SOURCE_INPUT_TYPES.MANUAL,
    parser: 'importHub.marketAnalysisCsv',
    fieldMappings: { datasetKey: 'marketSchemaForDataset(datasetKey)（套餐明细/KPI → marketRetailPackageSchemas）' },
    unitConversions: { quantity: 'MWh', price: '元/MWh' },
    timeAxis: TIME_AXIS.TIME,
    targets: [
      // 公共口径 7 键 → public market_analysis 族。
      target({
        family: 'market_analysis',
        datasetKey: '*',
        ownership: SOURCE_OWNERSHIP.PUBLIC,
        requiredFields: ['id', 'area'],
        qualityRules: { guardEmpty: true }
      }),
      // #669 路线①：售电套餐经营口径 market_packages → company 私有族 market_retail_packages，
      // 归属中广核云南。在线投递用会话 companyId 定 owner（assertSourceTargetOwnership），
      // 非归属公司会话写入被拒（422），杜绝跨公司投递他司经营数据。
      target({
        family: 'market_retail_packages',
        datasetKey: 'market_packages',
        ownership: SOURCE_OWNERSHIP.COMPANY,
        ownerCompanyId: CGN_YUNNAN_COMPANY_ID,
        requiredFields: ['id', 'area'],
        qualityRules: { guardEmpty: true }
      }),
      // #815：套餐聚合 KPI 与明细同属公司经营敏感口径，禁止落 public market_metrics。
      target({
        family: 'market_retail_packages',
        datasetKey: 'market_retail_package_metrics',
        ownership: SOURCE_OWNERSHIP.COMPANY,
        ownerCompanyId: CGN_YUNNAN_COMPANY_ID,
        requiredFields: ['id', 'area', 'tab'],
        qualityRules: { guardEmpty: true }
      })
    ],
    // 声明含公共 + 公司两类 target，故 source 级归属标 mixed（与 yunnan-spot-monthly-export 同例）。
    ownership: 'mixed',
    basis: 'captured',
    sourceType: 'IMPORT',
    mock: false,
    productionWrite: false
  },
  // 市场经营分析手录「批量」摄取入口（issue #769）：与 import-hub-market-analysis 同族（market_analysis
  // public），区别在投递通道——本源是 import:market-export 批处理（--dir/--file + --region），
  // 在线 ImportHub 投递仍走 import-hub-market-analysis。归一化同源 yn-fact-market::normalizeMarketDataset
  // （已内置 matchesSchema），声明式 prepareDeclaredFamily 不会再额外隔离行，落盘逐字段一致。
  // 仅公共 7 键（MARKET_DATASET_KEYS）落 public market_analysis；套餐明细/KPI 私有键不从此入口落。
  'market-export-batch': {
    sourceId: 'market-export-batch',
    label: '市场经营分析手录批量摄取',
    inputType: SOURCE_INPUT_TYPES.MANUAL,
    parser: 'importHub.marketAnalysisCsv',
    fieldMappings: {
      datasetKey: 'marketSchemaForDataset(datasetKey)（MARKET_DATASET_KEYS 公共 7 键 → market_analysis）'
    },
    unitConversions: { quantity: 'MWh', price: '元/MWh' },
    timeAxis: TIME_AXIS.TIME,
    targets: [
      target({
        family: 'market_analysis',
        // 本入口只投 market_analysis 公共 7 键，用 '*' 通配；family 已阻止私有套餐键误命中。
        datasetKey: '*',
        ownership: SOURCE_OWNERSHIP.PUBLIC,
        requiredFields: ['id', 'area'],
        qualityRules: { guardEmpty: true }
      })
    ],
    ownership: SOURCE_OWNERSHIP.PUBLIC,
    basis: 'captured',
    sourceType: 'IMPORT',
    mock: false,
    productionWrite: false
  },
  // 南网整年现货披露导出包（issue #769）：information_disclosure/tb_*_partNNN.csv + user_price/tb_*_partNNN.csv
  // 表头与交易中心月度导出包 plant_power_forecast_actual/system_*.csv 逐字段同构（见 import-southern-export.mjs
  // SOUTHERN_FILE_MAP），故熔化逻辑复用 yn-fact-forecast::buildSystemForecastFamilies +
  // yn-fact-quickwin::buildSystemZptsj（经 resolveFiles 注入 tb_* 寻址）。与 yunnan-spot-monthly-export 同族
  // （yn_system_forecast/yn_system_supply public），区别在输入源（南网整年披露 vs 交易中心月度导出）。
  // 入口独有的双向日期覆盖度自检（coverageIssue，拦局部目录整族替换丢历史）保留在 import-southern-export.mjs
  // 入口层——声明式执行器的 guardObsolete 不等价（本源是历史回填，不挂 guardObsoleteDays）。
  'csg-southern-annual-export': {
    sourceId: 'csg-southern-annual-export',
    label: '南网整年现货披露导出包',
    gridScope: 'csg',
    businessRegionScope: ['guangdong', 'guangxi', 'yunnan', 'guizhou', 'hainan'],
    inputType: SOURCE_INPUT_TYPES.EXPORT_PKG,
    parser: 'spot.systemForecastSupply',
    manifest: 'information_disclosure/tb_*_partNNN.csv + user_price/tb_*_partNNN.csv（README/manifest 自述 database=electricity_spot_market）',
    fieldMappings: {
      // SOUTHERN_FILE_MAP：交易中心逻辑名（归一化器寻址键）→ 南网整年导出表词干（_partNNN.csv 分片）。
      disclosure: 'information_disclosure/tb_{forecast,actual}_*.csv ↔ system_{forecast,actual}_*.csv 逻辑名',
      userPrice: 'user_price/tb_{da,rt}_user_price.csv ↔ user_price_{da,rt}.csv 逻辑名',
      forecast: '10 张系统级表熔化 → yn_system_forecast（12 datasetKey，按指标分）',
      quickwin: 'system_actual_{load,new_energy,hydro}.csv 合并 → yn_system_supply'
    },
    unitConversions: {
      power: 'MW',
      energy: 'MWh'
    },
    timeAxis: TIME_AXIS.POINT,
    targets: [
      target({
        family: 'yn_system_forecast',
        // 12 datasetKey（load_forecast/load_actual/non_market_*/new_energy_*/hydro_actual/total_generation_*/inter_provincial_forecast/user_price_{da,rt}）按指标分，用 '*' 通配。
        datasetKey: '*',
        ownership: SOURCE_OWNERSHIP.PUBLIC,
        requiredFields: ['id', 'operateDate', 'timePoint', 'metric', 'region'],
        capturedAtField: 'operateDate',
        qualityRules: { guardEmpty: true }
      }),
      target({
        family: 'yn_system_supply',
        datasetKey: 'yn_system_supply_demand',
        ownership: SOURCE_OWNERSHIP.PUBLIC,
        requiredFields: ['id', 'date', 'time', 'area'],
        capturedAtField: 'date',
        qualityRules: { guardEmpty: true }
      })
    ],
    ownership: SOURCE_OWNERSHIP.PUBLIC,
    basis: 'captured',
    sourceType: 'IMPORT',
    mock: false,
    productionWrite: false
  },
  // 广东第三省声明式接入试点（issue #770）：南网整年现货披露导出的广东专属骨架声明。
  // 与 csg-southern-annual-export 同族（yn_system_forecast/yn_system_supply public，南网公共族），
  // 区别在输入源是广东电力交易中心披露导出（广东专属口径）。parser 复用 spot.systemForecastSupply
  // 熔化器标识（骨架假设广东披露 tb_* 与南网整年同构，待真实包对拍验证）。
  // ⚠️ 本声明是骨架（声明接入意图），不实现凭据/cookie-replay——南网披露 cookie 重放接入属
  // #771/#867 范围（另一并行 PR）；本源走 export-pkg（离线导出包），核心链路零新脚本，待广东真实
  // 披露导出包到位后复用 import-southern-export.mjs 的 SOUTHERN_FILE_MAP 寻址 +
  // buildSystemForecastFamilies/buildSystemZptsj 熔化（同族同构假设须真实包验证）。
  'guangdong-disclosure-export': {
    sourceId: 'guangdong-disclosure-export',
    label: '广东现货披露导出包（声明骨架·#770）',
    gridScope: 'csg',
    businessRegionScope: ['guangdong'],
    readiness: SOURCE_READINESS.SKELETON,
    inputType: SOURCE_INPUT_TYPES.EXPORT_PKG,
    parser: 'spot.systemForecastSupply',
    manifest: 'information_disclosure/tb_*_partNNN.csv + user_price/tb_*_partNNN.csv（广东电力交易中心披露导出，骨架假设与南网整年同构，待真实包验证）',
    fieldMappings: {
      disclosure: 'information_disclosure/tb_{forecast,actual}_*.csv ↔ system_{forecast,actual}_*.csv 逻辑名（复用 SOUTHERN_FILE_MAP，待广东表词干对拍）',
      userPrice: 'user_price/tb_{da,rt}_user_price.csv ↔ user_price_{da,rt}.csv 逻辑名',
      forecast: '系统级表熔化 → yn_system_forecast（按指标分 datasetKey）',
      quickwin: 'system_actual_{load,new_energy,hydro}.csv 合并 → yn_system_supply'
    },
    unitConversions: {
      power: 'MW',
      energy: 'MWh'
    },
    timeAxis: TIME_AXIS.POINT,
    targets: [
      target({
        family: 'yn_system_forecast',
        // 与 csg-southern-annual-export 同族通配：12 datasetKey 按指标分，广东同构假设待真实包验证。
        datasetKey: '*',
        ownership: SOURCE_OWNERSHIP.PUBLIC,
        requiredFields: ['id', 'operateDate', 'timePoint', 'metric', 'region'],
        capturedAtField: 'operateDate',
        qualityRules: { guardEmpty: true }
      }),
      target({
        family: 'yn_system_supply',
        datasetKey: 'yn_system_supply_demand',
        ownership: SOURCE_OWNERSHIP.PUBLIC,
        requiredFields: ['id', 'date', 'time', 'area'],
        capturedAtField: 'date',
        qualityRules: { guardEmpty: true }
      })
    ],
    ownership: SOURCE_OWNERSHIP.PUBLIC,
    basis: 'captured',
    sourceType: 'IMPORT',
    mock: false,
    productionWrite: false
  },
  // 四川第三省声明式接入试点（issue #770，跨体系·国网）：国网「新一代电力交易平台」(pmos.sc.sgcc.com.cn)
  // 的四川现货导出包骨架声明。与广东（南网披露导出 → yn_system_*）跨体系不同——四川属国网 SGCC 体系，
  // pmos 导出落 sdpt_* 国网族（与山西基线同构假设：同为国网「新一代平台」RuoYi 系统一底座，见
  // 原采集代理的省份配置，待真实包对拍验证）。
  // ⚠️ 本声明是骨架（声明接入意图），不实现凭据/采集——原采集代理已随 #1894 删除，国网方向统一走官方开放平台
  // 协议范围（原采集代理已随 #1894 删除；国网方向统一走官方开放平台，见 Epic #1618）。
  // 核心链路零新脚本，待四川真实 pmos 导出包到位后复用既有 sdpt_* normalizer/熔化器（同构假设须真实包验证）。
  // ⚠️ 跨体系摩擦点：国网 sdpt_* 熔化器与南网 spot.systemForecastSupply 不同，不能直接复用广东骨架的 parser。
  'sichuan-pmos-export': {
    sourceId: 'sichuan-pmos-export',
    label: '四川现货 pmos 导出包（声明骨架·#770 跨体系·国网）',
    gridScope: 'sgcc',
    businessRegionScope: ['sichuan'],
    readiness: SOURCE_READINESS.SKELETON,
    inputType: SOURCE_INPUT_TYPES.EXPORT_PKG,
    parser: 'sdpt.stateGridPmosExport',
    manifest: 'pmos.sc.sgcc.com.cn 国网「新一代平台」RuoYi 系导出包（出清/预测/申报等 sdpt_* 表，骨架假设与山西基线同构，待真实包验证）',
    fieldMappings: {
      clearing: 'sdpt_zcqxhdl 出清/价格关系分析（P0 现货核心，document 族）',
      forecast: 'sdpt_zptjg 价格/负荷/竞价/火电/省间预测曲线（P0，row 族多 list_tag*_full）',
      gridNote: '四川属国网 SGCC，与广东（南网 csg）跨体系；pmos 导出 shape 与山西基线同构假设待真实包对拍'
    },
    unitConversions: {
      price: '元/MWh',
      power: 'MW',
      energy: 'MWh'
    },
    timeAxis: TIME_AXIS.POINT,
    targets: [
      target({
        family: 'sdpt_zcqxhdl',
        // document 族（出清/价格关系分析），多 datasetKey，用 '*' 通配；四川同构假设待真实包验证。
        datasetKey: '*',
        ownership: SOURCE_OWNERSHIP.PUBLIC,
        requiredFields: ['id'],
        qualityRules: { guardEmpty: true }
      }),
      target({
        family: 'sdpt_zptjg',
        // row 族（价格/负荷/竞价/火电/省间预测），多 list_tag*_full datasetKey，用 '*' 通配。
        datasetKey: '*',
        ownership: SOURCE_OWNERSHIP.PUBLIC,
        requiredFields: ['id'],
        qualityRules: { guardEmpty: true }
      })
    ],
    ownership: SOURCE_OWNERSHIP.PUBLIC,
    basis: 'captured',
    sourceType: 'IMPORT',
    mock: false,
    productionWrite: false
  },
  // 中广核云南厂侧数据 API（#1697/#1699/#1536）——**首个 storageBackend:'private-pg' 源**。
  //
  // 它此前完全不在本注册表里：有凭据存储、有私有 PG schema、有 RLS、有 Python 读路径、有三个
  // 专属门禁，唯独没有接入契约声明。那是「四套注册表互不知情」最实质的一处——一条生产链路
  // 整个绕开了声明式注册表。本条把它登记进来，使它与其它条目受同一套纪律约束。
  //
  // 注意它与南网官方披露的关系：这批数据的权威来源是南网官方披露，本通道只是取得它的一种
  // 方式；官方通道一旦接通，重叠部分以官方为准，本通道退为该公司的自有副本。跟进见 #1343。
  'cgn-yunnan-data-api-v1': {
    sourceId: 'cgn-yunnan-data-api-v1',
    label: '中广核云南厂侧数据 API v1（私有 PG·四维隔离）',
    inputType: SOURCE_INPUT_TYPES.API,
    parser: 'cgnYunnan.privatePgIngestion',
    manifest: '数据提供方/厂侧部署、经 HTTPS 轮询取数的外部服务，**不是电网官方接口**；'
      + '凭据经「数据源接入设置」页录入（runtime 存储 > env），基址与 API Key 均不进仓库',
    gridScope: 'csg',
    // 业务地域覆盖南网五省——实测 26 类披露里 15 条 regionScope 是「南方电网整体」，
    // 数据本身讲的是整个南网。这与隔离地域（恒 yunnan，见 isolation）是两回事。
    businessRegionScope: ['guangdong', 'guangxi', 'yunnan', 'guizhou', 'hainan'],
    storageBackend: STORAGE_BACKENDS.PRIVATE_PG,
    ingestControl: INGEST_CONTROLS.BATCHED,
    backendRationale: '外部 API 直连持续采集：需凭据、批次台账（追溯某行事实来自哪次响应）、'
      + 'checkpoint 断点续跑、脏行隔离区与原文归档；且数据落该公司专属隔离域',
    // 代码链路完整（摄取/读路径/门禁齐备）但尚未启用真实采集，故 wired 而非 live。
    // 启用需四重显式激活，见 docs/data/cgn-yunnan-api-ingestion.md。
    readiness: SOURCE_READINESS.WIRED,
    // 隔离键**只存引用**，不复制字面值——四元组的权威在
    // server/cgn-yunnan-data-source-store.mjs::CGN_YUNNAN_DATA_SOURCE 与 PG 的 CHECK 约束两处，
    // 注册表再抄一遍就会变成第三处漂移源。
    isolation: {
      mode: 'dedicated-schema',
      dataSourceInstanceRef: 'cgn-yunnan-data-api-v1',
      pgSchema: 'dljy_private',
      roleSet: 'dljy_cgn_private',
      scopeKeys: ['source_instance_id', 'owner_group_id', 'company_id', 'region_id'],
      // 恒 false：通用业务库的公司授权即便命中该公司，也不得因此获得本链路的事实访问权。
      // 这条是 docs/data/pg-migration-campaign.md 明文边界的机器可读形式。
      generalCompanyScopeInherits: false
    },
    fieldMappings: {
      seam: '上游三套响应骨架各自适配后落同一批事实表：market-series 是 series[].points[] 两层、'
        + 'node-prices 是 items[] + cursor 分页、disclosures 是 items[] + 中文字段名 + 字符串数值',
      disclosureValues: 'JSON number 写 numeric_value、JSON string（即使长得像数字）写 text_value，'
        + '不强制转数、不补零、不插值',
      unknownFields: '上游新增/改名字段先进 quarantine（DISCLOSURE_SHAPE_UNRECOGNIZED），'
        + '经人工确认后扩表，不静默塞进错误指标'
    },
    unitConversions: {
      price: 'CNY/MWh',
      power: 'MW'
    },
    timeAxis: TIME_AXIS.POINT,
    targets: [
      privatePgTarget({
        resourceKind: 'node_price',
        factTable: 'dljy_private.fact_node_price',
        datasetRefs: listGridDatasetCodes('csg', 'node_price'),
        checkpointKeyShape: '<market>:<interval>',
        requiredFields: ['node_name', 'time_point', 'price'],
        qualityRules: { guardEmpty: true }
      }),
      privatePgTarget({
        resourceKind: 'plant_node_price',
        factTable: 'dljy_private.fact_plant_node_price',
        // 层 1 只登记上游 catalog 实际暴露的 38 个数据集；场站映射价需要 plant:node-price:read，
        // 当前密钥无此 scope（实测该端点 403），故上游 catalog 不返回它、层 1 也不登记。
        datasetRefs: null,
        datasetRefsNote: '需 plant:node-price:read scope；当前密钥未获授权，上游 catalog 未暴露，故层 1 未登记',
        checkpointKeyShape: '<market>:1h',
        requiredFields: ['plant', 'node_name', 'hour_slot', 'price'],
        qualityRules: { guardEmpty: true }
      }),
      privatePgTarget({
        resourceKind: 'market_series',
        factTable: 'dljy_private.fact_company_market_series',
        // 从层 1 派生而非手写：层 1 增删曲线时这里自动跟随，不会静默漂移
        datasetRefs: listGridDatasetCodes('csg', 'market_series'),
        checkpointKeyShape: '<series>',
        requiredFields: ['series', 'date', 'time_point'],
        qualityRules: { guardEmpty: true }
      }),
      privatePgTarget({
        resourceKind: 'disclosure',
        factTable: 'dljy_private.fact_disclosure',
        datasetRefs: listGridDatasetCodes('csg', 'disclosure'),
        checkpointKeyShape: '<dataset>',
        requiredFields: ['operate_date'],
        qualityRules: { guardEmpty: true }
      })
    ],
    ownership: SOURCE_OWNERSHIP.COMPANY,
    ownerCompanyId: CGN_YUNNAN_COMPANY_ID,
    basis: 'captured',
    sourceType: 'REAL',
    mock: false,
    // 未启用真实采集前恒 false；启用由四重显式激活控制，不由本声明决定
    productionWrite: false
  },
}

export const SOURCE_REGISTRY = Object.freeze(
  Object.fromEntries(
    Object.entries(SOURCE_DECLARATIONS).map(([sourceId, spec]) => [
      sourceId,
      Object.freeze({ ...DECLARATION_DEFAULTS, ...spec })
    ])
  )
)

export function listSourceDeclarations() {
  return Object.values(SOURCE_REGISTRY)
}

export function getSourceDeclaration(sourceId) {
  const declaration = SOURCE_REGISTRY[sourceId]
  if (!declaration) throw new Error(`未知 sourceId：${sourceId}`)
  return declaration
}

export function getSourceTarget(declarationOrId, family, datasetKey = null) {
  const declaration = typeof declarationOrId === 'string' ? getSourceDeclaration(declarationOrId) : declarationOrId
  const exact = declaration.targets.find((target) => target.family === family && target.datasetKey === datasetKey)
  if (exact) return exact
  const wildcard = declaration.targets.find((target) => target.family === family && target.datasetKey === '*')
  if (wildcard) return { ...wildcard, datasetKey }
  // 不做 family-only 回退：datasetKey 拼错或未声明必须显式失败，多 datasetKey 族用 '*' 声明。
  return null
}

export function assertSourceDeclaration(declaration) {
  if (!declaration?.sourceId) throw new Error('source declaration 缺 sourceId')
  if (!Object.values(SOURCE_INPUT_TYPES).includes(declaration.inputType)) {
    throw new Error(`${declaration.sourceId} inputType 非法：${declaration.inputType}`)
  }
  if (!declaration.parser) throw new Error(`${declaration.sourceId} 缺 parser`)
  if (!Array.isArray(declaration.targets) || declaration.targets.length === 0) {
    throw new Error(`${declaration.sourceId} 缺 targets`)
  }
  // ——— 分层字段值域 ———
  const { gridScope, businessRegionScope, storageBackend, ingestControl, readiness } = declaration
  if (gridScope !== null && gridScope !== undefined && !GRID_OPERATORS.includes(gridScope)) {
    throw new Error(`${declaration.sourceId} gridScope 非法：${gridScope}（值域引用 REGION_GRID_OPERATOR，不得另立词汇）`)
  }
  if (businessRegionScope !== null && businessRegionScope !== undefined) {
    if (!Array.isArray(businessRegionScope) || businessRegionScope.length === 0) {
      throw new Error(`${declaration.sourceId} businessRegionScope 须是非空数组或 null`)
    }
    for (const region of businessRegionScope) {
      if (!REGION_GRID_OPERATOR[region]) {
        throw new Error(`${declaration.sourceId} businessRegionScope 含未登记地区：${region}`)
      }
      // 业务地域必须落在本源所属电网内——跨电网串读是数据完整性红线（Issue #575）。
      if (gridScope && REGION_GRID_OPERATOR[region] !== gridScope) {
        throw new Error(
          `${declaration.sourceId} businessRegionScope 含跨电网地区：${region} 属 ${REGION_GRID_OPERATOR[region]}，本源 gridScope=${gridScope}`
        )
      }
    }
  }
  if (storageBackend !== undefined && !Object.values(STORAGE_BACKENDS).includes(storageBackend)) {
    throw new Error(`${declaration.sourceId} storageBackend 非法：${storageBackend}`)
  }
  if (ingestControl !== undefined && !Object.values(INGEST_CONTROLS).includes(ingestControl)) {
    throw new Error(`${declaration.sourceId} ingestControl 非法：${ingestControl}`)
  }
  if (readiness !== undefined && !Object.values(SOURCE_READINESS).includes(readiness)) {
    throw new Error(`${declaration.sourceId} readiness 非法：${readiness}`)
  }

  // ——— 按落库后端分叉；capture 分支逻辑与改动前逐字一致 ———
  const backend = storageBackend ?? STORAGE_BACKENDS.CAPTURE_SQLITE
  if (backend === STORAGE_BACKENDS.CAPTURE_SQLITE) {
    for (const t of declaration.targets) {
      if (!CAPTURE_FAMILIES[t.family]) throw new Error(`${declaration.sourceId} target family 未登记：${t.family}`)
      if (t.ownership === DATA_VISIBILITY.COMPANY && !t.ownerCompanyId) {
        throw new Error(`${declaration.sourceId}/${t.family} 是 company target 但缺 ownerCompanyId`)
      }
    }
  } else if (backend === STORAGE_BACKENDS.PRIVATE_PG) {
    // 私有 PG 落库意味着公司级隔离域，必须显式声明摄取控制面：外部 API 直连若无批次台账，
    // 就无法追溯「这行事实来自哪次响应」，失败时也无法做到不推进 checkpoint。
    if (ingestControl !== INGEST_CONTROLS.BATCHED) {
      throw new Error(`${declaration.sourceId} storageBackend=private-pg 必须配 ingestControl=batched`)
    }
    // target 形状与隔离键声明由后续阶段的 privatePgTarget 引入；此处先守住「不得混用 capture family」。
    for (const t of declaration.targets) {
      if (t.family && CAPTURE_FAMILIES[t.family]) {
        throw new Error(
          `${declaration.sourceId} private-pg 源不得复用 capture family（${t.family}）——两条存储路径必须单轨隔离`
        )
      }
    }
  }
  return true
}

export function listExcelTemplateDeclarations() {
  return Object.values(EXCEL_TEMPLATE_DECLARATIONS)
}

export function getExcelTemplateDeclaration(templateId) {
  const declaration = EXCEL_TEMPLATE_DECLARATIONS[templateId]
  if (!declaration) throw new Error(`未知 Excel 模板：${templateId}`)
  return declaration
}

// ── 模板注释/示例行约定（Issue #768）────────────────────────────────────────
// 模板生成器把「填写说明行」与「示例行」的首列以 `#` 开头写出；上传解析侧统一过滤
// 任何首个非空单元格以 `#` 开头的行（说明/示例/用户注释），只把真实数据行喂校验。
// 该约定是模板下载与上传解析的**唯一契约**，两侧都从此常量派生，勿各写各的魔法值。
export const TEMPLATE_COMMENT_PREFIX = '#'

export function isTemplateCommentCells(cells) {
  const first = Array.isArray(cells) ? cells[0] : cells
  return String(first ?? '').trim().startsWith(TEMPLATE_COMMENT_PREFIX)
}

// 单元格级校验：按列声明的 type/format/required 判定，返回 null（合规）或中文原因短语。
// 复用于服务端上传端点（逐行 reason）与 verify:source-registry（示例值合规断言）。
export function validateTemplateCell(column, rawValue) {
  const raw = rawValue === undefined || rawValue === null ? '' : String(rawValue).trim()
  if (raw === '') {
    return column.required ? `「${column.name}」为空` : null
  }
  switch (column.type) {
    case 'date': {
      const normalized = raw.replaceAll('/', '-')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        return `「${column.name}」需为 ${column.format ?? 'YYYY-MM-DD'}：${raw}`
      }
      // 形状合规还不够：加真实历法校验（构造 UTC Date 回读对拍），拦 2026-99-99 / 2026-02-30 /
      // 2026-13-01 等以 IMPORT 身份污染时序口径的假日期（roborev job636）。
      const [y, m, d] = normalized.split('-').map(Number)
      const dt = new Date(Date.UTC(y, m - 1, d))
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
        return `「${column.name}」非法日期（不存在的年月日）：${raw}`
      }
      return null
    }
    case 'time': {
      if (!/^\d{1,2}:\d{2}$/.test(raw)) {
        return `「${column.name}」需为 ${column.format ?? 'HH:mm'}：${raw}`
      }
      // 时/分范围真实校验：拦 25:99 / 12:60 等形状合规但不存在的时间（roborev job636）。
      const [hh, mm] = raw.split(':').map(Number)
      if (hh > 23 || mm > 59) {
        return `「${column.name}」非法时间（HH<24, mm<60）：${raw}`
      }
      return null
    }
    case 'number': {
      const num = Number(raw.replaceAll(',', ''))
      if (!Number.isFinite(num)) return `「${column.name}」非数值：${raw}`
      return null
    }
    default:
      return null
  }
}

// 把合规单元格归一为落库值：date 斜杠→短横、number 去千分位转数值，其余 trim 后原样。
export function coerceTemplateCell(column, rawValue) {
  const raw = rawValue === undefined || rawValue === null ? '' : String(rawValue).trim()
  if (raw === '') return column.required ? raw : null
  if (column.type === 'date') return raw.replaceAll('/', '-')
  if (column.type === 'number') return Number(raw.replaceAll(',', ''))
  return raw
}

// 行级校验：records 为 [{ [列名]: 原始值 }]，rowNumbers 为各行在源文件中的 1-based 行号。
// 返回 { declaration, columns, valid:[{rowNumber,values}], invalid:[{row,reason}] }，
// reason 形如「第 N 行：「列名」为空；「列名」非数值：x」，直达前端逐行回显。
export function validateTemplateRecords(templateId, records, options = {}) {
  const declaration = getExcelTemplateDeclaration(templateId)
  const { columns } = declaration
  const rowNumbers = options.rowNumbers ?? []
  const valid = []
  const invalid = []
  records.forEach((record, index) => {
    const rowNumber = rowNumbers[index] ?? index + 2 // 默认：第1行表头，数据从第2行起
    const reasons = []
    const values = {}
    for (const column of columns) {
      const raw = record?.[column.name]
      const reason = validateTemplateCell(column, raw)
      if (reason) reasons.push(reason)
      else values[column.name] = coerceTemplateCell(column, raw)
    }
    if (reasons.length) invalid.push({ row: rowNumber, reason: `第 ${rowNumber} 行：${reasons.join('；')}` })
    else valid.push({ rowNumber, values })
  })
  return { declaration, columns, valid, invalid }
}
