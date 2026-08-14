import type { RouteRecordRaw } from 'vue-router'

type PageMeta = {
  block: string
  title: string
  code: string
  endpoint: string
  dataPath: string
  scope?: string
  kind?: 'real' | 'mixed' | 'forecast'
  note?: string
  regionIds?: string[]
}

// 云南交易工作台（父 Issue #456）已并入「现货交易驾驶舱」/dashboard（分组首位，全国通用 + 云南增强）：
// 身份区域 hero + 分组 tab + 7 个真实数据 panel（cockpit/弹性/价差/损益/电厂出力/电价×出力/披露），
// 全部迁入 TradingCockpitView.vue。原 /xhjy/yunnan 单页（YunnanTradingWorkbenchView.vue）不再被路由引用，
// 其全部子路径（含 11 个 alias + 4 个已删文字 tab 兜底）逐条 redirect 到 /dashboard，按落地子路径
// 带 ?tab= 预选目标 panel，保深链/收藏夹/历史记录不 404、直达对应 tab（组件保留备查，便于回滚）。
const yunnanNodePrice = () => import('../../views/yunnan/YunnanNodePriceView.vue')
const yunnanSettlementPrice = () => import('../../views/yunnan/YunnanSettlementPriceView.vue')

// 旧工作台子路径 → /dashboard?tab= 映射（tab key 与 TradingCockpitView VALID_TABS 对齐）。
// 旧文字 tab（retail/settlement/quant/declaration）已删，统一落驾驶舱默认 tab（不带 query）。
type TabRedirect = { path: string; tab?: string }
const yunnanWorkbenchRedirects: TabRedirect[] = [
  { path: 'xhjy/yunnan/cockpit', tab: 'cockpit' },
  { path: 'xhjy/yunnan/elasticity', tab: 'elasticity' },
  { path: 'xhjy/yunnan/spread', tab: 'spread' },
  { path: 'xhjy/yunnan/spot-pnl', tab: 'spot-pnl' },
  { path: 'xhjy/yunnan/plant-output', tab: 'plant-output' },
  { path: 'xhjy/yunnan/price-output-linkage', tab: 'price-output-linkage' },
  { path: 'xhjy/yunnan/disclosure', tab: 'disclosure' },
  // 旧文字 tab 兜底（无对应 panel → 默认 cockpit，不带 query）
  { path: 'xhjy/yunnan/retail' },
  { path: 'xhjy/yunnan/settlement' },
  { path: 'xhjy/yunnan/quant' },
  { path: 'xhjy/yunnan/declaration' }
]

const workbenchRedirectRoutes: RouteRecordRaw[] = [
  // 主入口 /xhjy/yunnan → /dashboard（默认 cockpit tab）
  { path: 'xhjy/yunnan', redirect: { path: '/dashboard', query: { tab: 'cockpit' } } },
  // 逐条子路径 redirect，带 ?tab= 预选
  ...yunnanWorkbenchRedirects.map(({ path, tab }): RouteRecordRaw => ({
    path,
    redirect: tab ? { path: '/dashboard', query: { tab } } : '/dashboard'
  }))
]

const nodePriceMeta: PageMeta = {
  block: '市场洞察',
  title: '节点电价分析',
  code: 'yunnan-node-price',
  endpoint: 'GET /agent-api/v1/spot/cgn-yunnan/node-price/*',
  dataPath: 'dljy_private.latest_node_price',
  scope: '中广核云南厂侧节点价格曲线、价格热力图和当日节点日聚合明细（私有 PG，原生 15m/1h）',
  kind: 'real',
  note: '仅 comp-cgn-yunnan 集团账号 + yunnan；查询固定 GENERATOR-YN-CGN，非电网官方，失败不回落公共节点价',
  regionIds: ['yunnan']
}

const settlementPriceMeta: PageMeta = {
  block: '市场洞察',
  title: '结算价分析',
  code: 'yunnan-settlement-price',
  endpoint: 'GET /api/real yn_spot_settlement + GET /agent-api/v1/spot/cgn-yunnan/node-price/daily',
  dataPath: 'yn_spot_settlement',
  scope:
    '云南现货结算价分析：日前-实时-结算三价对比 + 中长期电价参照（yn_spot_settlement formal 行）+ 节点电价峰谷价差水位 + 最高/最低/均价/负价占比（现货权威后端）',
  kind: 'real',
  note: '市场洞察独立页（同 node-price 模式）；三价出清实线、中长期虚线、缺测断点；temp 不上屏（ETL 已 filter formal）',
  regionIds: ['yunnan']
}

export const yunnanTradingRoutes: RouteRecordRaw[] = [
  {
    path: 'xhjy/yunnan/node-price',
    name: 'YunnanNodePrice',
    component: yunnanNodePrice,
    meta: nodePriceMeta
  },
  {
    path: 'xhjy/yunnan/settlement-price',
    name: 'YunnanSettlementPrice',
    component: yunnanSettlementPrice,
    meta: settlementPriceMeta
  },
  // 原云南交易工作台 /xhjy/yunnan 及其 11 个子路径全部 redirect 到 /dashboard
  // （已并入现货交易驾驶舱，组件 YunnanTradingWorkbenchView.vue 保留备查）。
  ...workbenchRedirectRoutes
]
