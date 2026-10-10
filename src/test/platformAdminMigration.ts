// 「已迁至平台后台」入口隐藏（ChenShi-Tech/dljy#3464）组件 spec 的共享挂载辅助。
// 内部版与客户版两份 spec 共用：宿主页挂载、按真实路由表追重定向壳终点、读 tab 状态。
// 各子页替身与服务层 mock 必须写在各 spec 文件里（vi.mock 按文件提升），本文件只放不依赖 mock 形态的辅助。
import { defineComponent, h } from 'vue'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView, type RouteLocationRaw } from 'vue-router'
import { mount } from '@/test/mount'
import router from '@/router'
import AiStudioView from '@/views/AiStudioView.vue'
import AccountsView from '@/views/AccountsView.vue'
import DataOpsConsoleView from '@/views/dataops/DataOpsConsoleView.vue'
import DataSourceSettingsView from '@/views/DataSourceSettingsView.vue'
import CompanyProfileView from '@/views/company/CompanyProfileView.vue'

export const HOST_STUBS = {
  RegionDataBanner: true,
  DataBasisBadge: true,
  CompanyScopeBar: true,
  ElTable: { template: '<div><slot /></div>' },
  ElTableColumn: { props: ['label'], template: '<div>{{ label }}</div>' }
}

/** 等异步子组件（defineAsyncComponent + KeepAlive）落地：真实 SFC 的动态 import 要走一次模块加载，
 *  光冲微任务不够，穿插几轮宏任务。 */
export async function settle() {
  for (let i = 0; i < 6; i++) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** 在内存路由里挂载宿主页（与生产路由同路径），并停在 path（可带 query）。 */
export async function mountHost(path: string): Promise<{ wrapper: VueWrapper; memory: ReturnType<typeof createRouter> }> {
  const memory = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/system/ai-studio', component: AiStudioView },
      { path: '/system/accounts', component: AccountsView },
      { path: '/data-ops/console', component: DataOpsConsoleView },
      { path: '/data-source-settings-host', component: DataSourceSettingsView },
      { path: '/gsgl/profile', component: CompanyProfileView }
    ]
  })
  await memory.push(path)
  await memory.isReady()
  const App = defineComponent({ render: () => h(RouterView) })
  const wrapper = mount(App, { global: { plugins: [memory], stubs: HOST_STUBS } })
  await settle()
  return { wrapper, memory }
}

/**
 * 按真实路由表（@/router）追重定向壳到终点：router.resolve 只做匹配、不追 redirect，
 * 这里手工沿记录级 redirect 走到底（与 governance.default-route spec 同法），返回带 query 的终点。
 */
export function terminalOf(path: string): string {
  let current: RouteLocationRaw = path
  for (let hop = 0; hop < 10; hop++) {
    const resolved = router.resolve(current)
    if (!resolved.matched.length) throw new Error(`${String(current)} 未注册为路由`)
    const record = resolved.matched[resolved.matched.length - 1]
    const redirect = (record as { redirect?: unknown }).redirect
    if (!redirect) return resolved.fullPath
    const target = typeof redirect === 'function' ? redirect(resolved) : redirect
    current = target as RouteLocationRaw
  }
  throw new Error(`redirect 链超过 10 跳: ${path}`)
}

/** 真实路由表里某路径的页面组件（懒加载器求值后的组件）。 */
export async function routeComponentOf(path: string) {
  const resolved = router.resolve(path)
  const record = resolved.matched[resolved.matched.length - 1]
  const raw = record?.components?.default as unknown
  if (typeof raw !== 'function') return raw
  const loaded = (await (raw as () => Promise<unknown>)()) as { default?: unknown }
  return loaded && typeof loaded === 'object' && 'default' in loaded ? loaded.default : loaded
}

export function tabLabels(wrapper: VueWrapper, scope = '.el-tabs'): string[] {
  const tabs = wrapper.find(scope)
  return tabs.exists() ? tabs.findAll('.el-tabs__item').map((n) => n.text()) : []
}

export function activeTabLabels(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.el-tabs__item.is-active').map((n) => n.text())
}

export function noticeEntries(wrapper: VueWrapper): string[] {
  return wrapper.findAll('[data-testid="migrated-to-admin-notice"] li').map((li) => li.attributes('data-entry') ?? '')
}
