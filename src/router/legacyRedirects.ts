// tab 化收编的旧路径重定向壳（从 router/index.ts 抽出，便于单测；ChenShi-Tech/dljy#3464）。
//
// 被「AI 工作室」「用户与权限」「数据运维工作台」「数据源接入」tab 化收编的旧页面：路径保留为重定向，
// 落到合并页对应 tab / 面板，原 query 透传。这些条目不进导航、不带 meta，因此不会出现在
// feature-map / manifest 的页面清单里。
//
// 已迁至平台后台的入口（features/platformAdminMigration/registry.ts）：重定向壳**跟着目标面板走**——
// 目标 tab / 面板在内部版已不渲染时，壳落到宿主页的默认 tab 并丢掉指向已迁面板的 query，宿主页
// 原位置的「已迁至平台后台」提示会点名这项入口并给出后台链接；绝不重定向到一个不渲染的面板（白屏）。
// 按组回退后登记表答「未迁移」，壳自动恢复落到原 tab；客户交付版恒为原行为。
import type { LocationQuery, RouteRecordRaw } from 'vue-router'
import { isTabHidden, type MigrationHostPage } from '@/features/platformAdminMigration/registry'

function omitKey(query: LocationQuery, key: string): LocationQuery {
  const { [key]: _omitted, ...rest } = query
  return rest
}

function tabRedirect(page: MigrationHostPage, hostPath: string, queryKey: 'tab' | 'panel', path: string, tab: string): RouteRecordRaw {
  return {
    path,
    redirect: (to) =>
      isTabHidden(page, tab)
        ? { path: hostPath, query: omitKey(to.query, queryKey) }
        : { path: hostPath, query: { ...to.query, [queryKey]: tab } }
  }
}

export const aiStudioRedirect = (path: string, tab: string): RouteRecordRaw =>
  tabRedirect('ai-studio', '/system/ai-studio', 'tab', path, tab)

export const accountsRedirect = (path: string, tab: string): RouteRecordRaw =>
  tabRedirect('accounts', '/system/accounts', 'tab', path, tab)

// 「数据源接入」tab 化收编的旧页面：路径保留为重定向，落到合并页对应 tab（#1896）。
// /data-source-settings 自身又是数据运维工作台的面板重定向壳，所以这里是两级重定向的第一级。
export const dataSourceSettingsRedirect = (path: string, tab: string): RouteRecordRaw =>
  tabRedirect('data-source', '/data-source-settings', 'tab', path, tab)

// 数据运维六页原独立路径 → 数据运维工作台对应面板（?panel=）。原查询参数原样带过去，
// 「数据源接入」的子 tab（?tab=official 等）因此在两级 redirect 后仍然生效。
export const opsPanelRedirects: RouteRecordRaw[] = ([
  ['yygl/data-onboarding', 'onboarding'],
  ['yygl/import-hub', 'import-hub'],
  ['yygl/data-governance', 'governance'],
  ['yygl/ingest', 'ingest'],
  ['data-ops/upload', 'upload'],
  ['data-source-settings', 'data-source']
] as const).map(([path, panel]) => tabRedirect('data-ops', '/data-ops/console', 'panel', path, panel))
