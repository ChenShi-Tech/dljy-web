import type { RouteRecordRaw } from 'vue-router'
import { GRID_GEO_REGION_IDS } from './config'

const gridGeoAssets = () => import('./GridGeoAssetsView.vue')
const gridSpatialCommand = () => import('./GridSpatialCommandView.vue')
const gridGeoNodes = () => import('./GridGeoNodeManagerView.vue')
const gridTopologyProvider = () => import('./GridTopologyProviderView.vue')
const gridDisclosureSpatial = () => import('./GridDisclosureSpatialView.vue')
const gridOperatorProfile = () => import('./GridOperatorProfileView.vue')
const gridMarketSpatial = () => import('./GridMarketSpatialView.vue')
const gridWeatherImpact = () => import('./GridWeatherImpactView.vue')

export const gridGeoRoutes: RouteRecordRaw[] = [
  {
    path: 'grid-assets/command',
    name: 'GridSpatialCommand',
    component: gridSpatialCommand,
    meta: {
      block: '空间资产',
      title: '电力空间联动驾驶舱',
      code: 'grid-spatial-command',
      endpoint: 'GET /api/v1/grid/geo-assets/{plants,nodes,weather/current,disclosures/events,topology/manifest} + exact-only market loaders',
      dataPath: 'versioned grid geo assets + lazy real weather/market/disclosure layers + controlled topology manifest',
      scope: '按用户、公司、地区、电网和 DataScope 联动已有空间数据；只绘制权威 WGS84 点位，不推测拓扑',
      kind: 'real',
      note: '各层独立真实性信封；市场为历史回放、天气为当前格点，两者不合成实时风险或因果结论',
      regionIds: GRID_GEO_REGION_IDS,
    },
  },
  {
    path: 'grid-assets/plants',
    name: 'GridGeoAssets',
    component: gridGeoAssets,
    meta: {
      block: '空间资产',
      title: '电厂地理空间',
      code: 'grid-geo-assets',
      endpoint: 'GET /api/v1/grid/geo-assets/{manifest,plants,plants/:id,weather/current}',
      dataPath: 'yn_dim_plant + yn_dim_plant_node + curated public location evidence',
      scope: '云南电厂物理位置、位置精度、公开证据与未来业务属性引用；不含潮流计算',
      kind: 'real',
      note: 'IMPORT 主数据 + 公开位置证据；村镇/县域坐标以不确定性光圈显示，不代表精确厂址',
      regionIds: GRID_GEO_REGION_IDS,
    },
  },
  {
    path: 'grid-assets/nodes',
    name: 'GridGeoNodes',
    component: gridGeoNodes,
    meta: {
      block: '空间资产',
      title: '节点空间资产台',
      code: 'grid-geo-nodes',
      endpoint: 'GET|POST|PATCH /api/v1/grid/geo-assets/nodes',
      dataPath: 'versioned grid_geo_assets + node price family references',
      scope: '节点身份、位置状态、WGS84 坐标、版本历史与市场数据接口；不含敏感网架拓扑',
      kind: 'real',
      note: '未定位节点不伪造坐标；人工变更写入受管 SQLite 并形成审计版本',
      regionIds: GRID_GEO_REGION_IDS,
    },
  },
  {
    path: 'grid-assets/topology',
    name: 'GridTopologyProvider',
    component: gridTopologyProvider,
    meta: {
      block: '空间资产',
      title: '授权网架接入舱',
      code: 'grid-topology-provider',
      endpoint: 'GET /api/v1/grid/geo-assets/topology/{manifest,evidence,snapshot}',
      dataPath: 'authorized topology provider contract + fail-closed empty snapshot',
      scope: '按用户、公司、地区与电网运营商隔离的授权网架入口；未配置时不请求敏感快照、不绘制推测线路',
      kind: 'real',
      note: 'CONFIG/DB/IMPORT、mock=false、productionWrite=false；当前不执行潮流、断面或 N-1 计算',
      regionIds: GRID_GEO_REGION_IDS,
    },
  },
  {
    path: 'grid-assets/disclosures',
    name: 'GridDisclosureSpatial',
    component: gridDisclosureSpatial,
    meta: {
      block: '空间资产', title: '公开披露空间层', code: 'grid-disclosure-spatial',
      endpoint: 'GET /api/v1/grid/geo-assets/disclosures/{providers,overview,events} + /api/real scoped trading metrics',
      dataPath: 'CSG trading disclosure time series + evidence event aggregates + isolated company/user overlays',
      scope: '日前与日内指标趋势、披露时窗、事件证据联动；仅按已知时刻或业务日期展示，不作价格因果归因',
      kind: 'real', note: '真实采集与 IMPORT；缺测留白、未知发布时间不用于当时已知回测、坐标缺失保留区域绑定',
      regionIds: GRID_GEO_REGION_IDS,
    },
  },
  {
    path: 'grid-assets/market',
    name: 'GridMarketSpatial',
    component: gridMarketSpatial,
    meta: {
      block: '空间资产', title: '电力市场空间态势', code: 'grid-market-spatial',
      endpoint: 'GET /api/v1/grid/geo-assets/plants/:id/integrations + /agent-api/v1/spot/node-price/daily + scoped captured-data source',
      dataPath: 'grid geo stable mapping + region-exact node price + owner-registry verified output source',
      scope: '节点价差、场站出力偏差与描述性风险空间联动；不代表潮流、阻塞或因果归因',
      kind: 'real', note: 'exact-only、fallbackToPortfolio=false；缺测资产灰显，不生成替代指标',
      regionIds: GRID_GEO_REGION_IDS,
    },
  },
  {
    path: 'grid-assets/weather-impact',
    name: 'GridWeatherImpact',
    component: gridWeatherImpact,
    meta: {
      block: '空间资产', title: '气象交易影响时序', code: 'grid-weather-impact',
      endpoint: 'GET region-registered historical weather + owner-registry verified output source + /agent-api/v1/spot/node-price/series',
      dataPath: 'region-registered historical actual weather + scoped exact plant output + region-exact pricing node series',
      scope: '场站气象、出力与节点价格同小时回顾性相关；不含历史当时预报因果归因',
      kind: 'real', note: '当前历史天气 registry 仅云南；historical-actual / asOfSafeForForecastBacktest=false；其他地区不回退云南',
      regionIds: GRID_GEO_REGION_IDS,
    },
  },
  {
    path: 'grid-assets/operator-profile',
    name: 'GridOperatorProfile',
    component: gridOperatorProfile,
    meta: {
      block: '空间资产', title: '南网国网展示画像', code: 'grid-operator-profile',
      endpoint: 'GET /api/v1/grid/geo-assets/operator-profile',
      dataPath: 'REGION_GRID_OPERATOR + versioned grid operator profile manifest',
      scope: '南网/国网术语、字段、视觉、数据层状态、默认镜头与跨网禁回退策略',
      kind: 'real', note: 'CONFIG、mock=false；数据层状态按地区诚实显示 available/degraded/missing/not-configured',
      regionIds: GRID_GEO_REGION_IDS,
    },
  },
]
