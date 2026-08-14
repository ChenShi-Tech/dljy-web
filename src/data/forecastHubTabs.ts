// 预测中心整合（P3：8 页 → 1 页多 tab，项目路线图既定项）。
// cfg 在此单一维护：独立路由页（保留，深链/收藏不破坏）与整合页 tab 共用同一份配置。
// 整合页按 canAccessPath(sourceRoute) 过滤 tab —— 不扩大任何角色的原有可见范围。

export type ForecastCfg = {
  family: string
  match: string
  dateField?: string
  typeField?: string
  dict?: string
  typeLabels?: Record<number, string>
  totalField?: string
  meanField?: string
  valueLabel: string
  unit: string
  // 一句话基础功能介绍：渲染在页面顶部（ForecastIntro），平实语言说明本页是做什么的。
  intro?: string
  // 厂站绑定：置 true 时该页数据源绑定到 {地区 · 公司 · 厂站} profile，改走
  // /api/company/forecast(按厂站画像生成)，而非按地区回放公共采集数据。
  stationScoped?: boolean
  stationKind?: 'zxztqa' | 'zgnrx' | 'gsfhyc'
}

export const FORECAST_CFGS = {
  jgyc: { family: 'sdpt_zptjg', match: 'list_tag61_full', typeField: 'type', dict: 'sdpt_zptjg_type_ycjg', valueLabel: '电价预测', unit: '元/MWh', intro: '汇总现货出清电价的实际值与各机构日前预测曲线，可按日期、类型多选对比走势。' },
  gsfhyc: { family: 'sdpt_zptjg', match: 'list_tag12_full', valueLabel: '负荷预测', unit: 'MWh', stationScoped: true, stationKind: 'gsfhyc', intro: '预测所选厂站次日 96 点用电负荷曲线，作为电量申报与套餐结算的需求基线。' },
  gscwfh: { family: 'sdpt_zptsj', match: 'list_tag61_full', dateField: 'riqi', totalField: 'hjz', meanField: 'pjz', valueLabel: '错位负荷', unit: 'MWh', intro: '展示系统负荷扣减新能源、水电与非市场化机组出力后的错位（净）负荷，反映市场化机组的供给空间。' },
  zxztqa: { family: 'sdpt_zxztqa', match: 'list_full', typeField: 'type', typeLabels: { 10: '总', 11: '风', 12: '光' }, dateField: 'riqi', valueLabel: '新能源出力', unit: 'MW', stationScoped: true, stationKind: 'zxztqa', intro: '按厂站预测次日风/光/总新能源出力的 96 点曲线（模型A），数据绑定地区·公司·厂站。' },
  zgnrx: { family: 'sdpt_zgnrx', match: 'list_full', typeField: 'sjlx', typeLabels: { 10: '总', 11: '风', 12: '光' }, dateField: 'yxrq', valueLabel: '新能源出力', unit: 'MW', stationScoped: true, stationKind: 'zgnrx', intro: '按厂站预测次日风/光/总新能源出力的 96 点曲线（模型B，另一套来源与方法），可与模型A交叉验证。' },
  jjkj: { family: 'sdpt_zptjg', match: 'list_tag27_full', valueLabel: '日前竞价空间', unit: 'MWh', intro: '预测日前市场的可竞价空间（系统负荷减去优先发电后、由市场化机组承担的电量），衡量供需松紧。' },
  rqhdcl: { family: 'sdpt_zptjg', match: 'list_tag28_full', valueLabel: '日前火电出力', unit: 'MW', intro: '预测日前火电机组的计划出力 96 点曲线，辅助判断电价支撑与边际机组。' }
} satisfies Record<string, ForecastCfg>

export type ForecastHubTab = {
  key: string
  title: string
  // multi=ForecastMultiTypeCurve / daily=ForecastDailyCurve / rolling/weather=独立视图
  // renewable-ab=RenewableABCurve（新能源出力预测 A(zxztqa)/B(zgnrx) 内部切换对比合并 tab）
  kind: 'multi' | 'daily' | 'rolling' | 'weather' | 'renewable-ab' | 'yn-disclosure'
  cfg?: ForecastCfg
  // 原独立路由：tab 可见性按用户对该路由的权限过滤（最小权限不扩大）
  sourceRoute: string
  // 地区能力注册表中的 tab 级能力位；缺省时按 forecast.tab.${key} 约定查找。
  capabilityId?: string
}

// SP-4a：原 9 个 tab 中 zxztqa(模型A)+zgnrx(模型B) 合并为单个「新能源出力预测」tab
// （内部 A/B 切换对比，RenewableABCurve），故为 8 个 tab；其 cfg 取 A 仅供数据源
// 总览图例分组判定（stationScoped），实际渲染由 RenewableABCurve 内部按所选模型取 cfg。
export const FORECAST_HUB_TABS: ForecastHubTab[] = [
  { key: 'pricePrediction', title: '日滚动价格预测', kind: 'rolling', sourceRoute: '/ycsj/pricePrediction' },
  { key: 'jgyc', title: '价格预测', kind: 'multi', cfg: FORECAST_CFGS.jgyc, sourceRoute: '/ycsj/jgyc' },
  // 云南官方披露对照（epic #336 PR-B2）：南网官方 D-1 预测 vs 实际（yn_system_forecast 真实回放，
  // captured 非模型输出）；sourceRoute 用披露明细权限路径——与云南工作台「披露明细」tab/
  // 首页披露侧卡同一细粒度门控（PLANT/STORAGE 等只有 hub 权限的角色不得经本 tab 绕过读披露）。
  { key: 'yn-disclosure', title: '云南披露对照', kind: 'yn-disclosure', sourceRoute: '/xhjy/yunnan/disclosure' },
  { key: 'gsfhyc', title: '负荷预测', kind: 'daily', cfg: FORECAST_CFGS.gsfhyc, sourceRoute: '/ycsj/gsfhyc' },
  { key: 'gscwfh', title: '错位负荷', kind: 'daily', cfg: FORECAST_CFGS.gscwfh, sourceRoute: '/ycsj/gscwfh' },
  { key: 'renewable-ab', title: '新能源出力预测', kind: 'renewable-ab', cfg: FORECAST_CFGS.zxztqa, sourceRoute: '/ycsj/zxztqa' },
  { key: 'zgnrxqxyc', title: '气象预测', kind: 'weather', sourceRoute: '/ycsj/zgnrxqxyc' },
  { key: 'jjkj', title: '日前竞价空间', kind: 'daily', cfg: FORECAST_CFGS.jjkj, sourceRoute: '/ycsj/jjkj' },
  { key: 'rqhdcl', title: '日前火电出力', kind: 'daily', cfg: FORECAST_CFGS.rqhdcl, sourceRoute: '/ycsj/rqhdcl' }
]
