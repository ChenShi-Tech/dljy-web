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
  suiteDomain?: string
  regionIds?: string[]
}

const reportCenter = () => import('../../views/ReportCenterView.vue')

const meta: PageMeta = {
  block: '报表中心',
  title: '报表中心',
  code: 'report-center',
  endpoint: 'GET /api/v1/reports/* + local reportEngine',
  dataPath: 'api_v1_reports',
  scope: '报表模板库 + 参数化生成（时间/地区/主体/市场）+ 区块渲染 + 导出归档；口径来自受控结算能力',
  kind: 'mixed',
  note: '当前区块基于合成场景，sourceType=MOCK；结算/偏差/收益口径公式真实可验证（verify:report-formulas）',
  suiteDomain: 'reports'
}

export const reportsRoutes: RouteRecordRaw[] = [
  {
    path: 'report/center',
    name: 'ReportCenter',
    component: reportCenter,
    meta
  }
]
