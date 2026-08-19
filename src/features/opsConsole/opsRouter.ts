// 数据运维台路由（Epic #2169 P2-2b · #2174）。
//
// 边界：本控制台只承载「数据管理操作面」六页（上传中心/导入融合台/接入向导/摄取管理/
// 治理控制台/数据源接入）；读服务面与交易页面全在主前端（index.html）。API 经
// api.ts::dataServicePath 自动走 /data-svc 代理到 data-service :8190（P2-2a 已落）。
//
// 门禁：需主平台登录（token 共享 localStorage）且角色为 ADMIN/BOSS（与主前端
// adminOnlyRoutes 同口径）；未登录显示引导页（回主平台登录），非管理员 403
// 不在独立台复刻主前端的登录页与全量权限矩阵（身份根在平台，#2174 红线）。
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { getCurrentUser, getToken } from '@/services/auth'

const GuardPage = () => import('./OpsGuardPage.vue')

// 六页组件自主前端 views/ 原样复用（代码零改动迁移；主前端路由改桥接跳转）。
const upload = () => import('@/views/dataops/DataUploadView.vue')
const importHub = () => import('@/views/ImportHubView.vue')
const dataOnboarding = () => import('@/views/DataOnboardingView.vue')
const dataIngestion = () => import('@/views/DataIngestionView.vue')
const dataGovernance = () => import('@/views/DataGovernanceView.vue')
const dataSourceSettings = () => import('@/views/DataSourceSettingsView.vue')

export const OPS_PAGES: Array<{ path: string; title: string }> = [
  { path: '/ops/upload', title: '数据上传中心' },
  { path: '/ops/import-hub', title: '数据导入融合台' },
  { path: '/ops/data-onboarding', title: '数据接入向导' },
  { path: '/ops/ingest', title: '数据摄取管理' },
  { path: '/ops/data-governance', title: '数据治理控制台' },
  { path: '/ops/data-source-settings', title: '数据源接入' },
]

export const opsRouter = createRouter({
  // hash 模式：独立 html 入口下无需服务端路由配合，/ops-console.html#/ops/... 深链直达。
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/ops/upload' },
    { path: '/ops/guard', component: GuardPage },
    ...OPS_PAGES.map<RouteRecordRaw>((page) => ({
      path: page.path,
      component: {
        upload,
        'import-hub': importHub,
        'data-onboarding': dataOnboarding,
        ingest: dataIngestion,
        'data-governance': dataGovernance,
        'data-source-settings': dataSourceSettings,
      }[page.path.replace('/ops/', '')]!,
      meta: { title: page.title }
    })),
    { path: '/:pathMatch(.*)*', redirect: '/ops/upload' }
  ]
})

opsRouter.beforeEach((_to) => {
  if (!getToken()) {
    // 未登录：引导回主平台登录（登录态共享 localStorage，登录后回到本台即可用）。
    return { path: '/ops/guard', query: { reason: 'unauthenticated' } }
  }
  const role = getCurrentUser()?.role
  if (role !== 'ADMIN' && role !== 'BOSS') {
    return { path: '/ops/guard', query: { reason: 'forbidden', role: role ?? 'unknown' } }
  }
  return true
})
