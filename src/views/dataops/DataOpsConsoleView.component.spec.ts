// 数据运维工作台容器契约：七面板齐全 + 面板状态走 ?panel=（不是 ?tab=）。
// 后者是本页的关键取舍——子页「数据源接入」自身用 ?tab= 同步它的三个子 tab，父子同名会互相
// 覆盖（父被切走 / 子回落默认值）；这里钉死「父写 panel、切面板时丢掉上一个面板的子 tab」。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { mount } from '@/test/mount'

// 容器契约在「七面板齐全」的形态下验证：内部版已把接入向导、摄取管理迁至平台后台（ChenShi-Tech/dljy#3464，
// 内部版隐藏与提示见 features/platformAdminMigration/migratedEntries.internal.component.spec.ts），
// 这里切到客户交付版——入口一律照旧，也正是「客户版不受影响」这条要求。
vi.mock('@/services/edition', () => ({ IS_CUSTOMER_EDITION: true, IS_INTERNAL_EDITION: false }))
// 总览面板会在挂载时取数：本 spec 只关心容器行为，接口一律给空信封（渲染空态即可）。
vi.mock('@/services/api', () => ({ apiGet: () => Promise.resolve({ code: 200, data: null }) }))
vi.mock('@/services/data/uploadClient', () => ({ fetchUploadBatches: () => Promise.resolve([]) }))
vi.mock('@/composables/useRegionReload', () => ({ onRegionChange: () => {} }))
// 六个业务面板换成轻量替身：容器契约与它们的内部实现无关，真加载会把六页（含各自样式与
// 服务依赖）拖进本 spec，异步 import 还可能在环境拆除后才落地（unhandled rejection）。
// （工厂逐个内联写：vi.mock 会被提升到 import 之前，引用外部辅助函数会踩 TDZ。
//   __esModule 必须显式给：缺了它 defineAsyncComponent 会把整个 mock 命名空间当组件用，
//   而 vitest 的命名空间代理对未声明导出一律抛错。）
vi.mock('./DataUploadView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-upload" />' } }))
vi.mock('../ImportHubView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-import-hub" />' } }))
vi.mock('../DataOnboardingView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-onboarding" />' } }))
vi.mock('../DataIngestionView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-ingest" />' } }))
vi.mock('../DataGovernanceView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-governance" />' } }))
vi.mock('../DataSourceSettingsView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-data-source" />' } }))

import DataOpsConsoleView from './DataOpsConsoleView.vue'

const stubs = {
  RouterLink: { template: '<a><slot /></a>' },
  RegionDataBanner: true,
  DataBasisBadge: true,
  ElTable: { template: '<div><slot /></div>' },
  ElTableColumn: { props: ['label'], template: '<div>{{ label }}</div>' }
}

async function mountConsole(initialRoute = '/data-ops/console') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/data-ops/console', component: DataOpsConsoleView }]
  })
  await router.push(initialRoute)
  await router.isReady()
  const wrapper = mount(DataOpsConsoleView, { global: { plugins: [router], stubs } })
  await flushPromises()
  return { wrapper, router }
}

describe('数据运维工作台容器（客户交付版：七面板照旧）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('七个面板标签齐全（总览 + 六个管理页）', async () => {
    const { wrapper } = await mountConsole()
    const labels = wrapper.findAll('.el-tabs__item').map((n) => n.text())
    expect(labels).toEqual([
      '运维总览', '数据上传中心', '数据导入融合台', '数据接入向导', '数据摄取管理', '数据治理控制台', '数据源接入'
    ])
  })

  it('深链 ?panel= 直达对应面板；非法值落总览', async () => {
    const { wrapper } = await mountConsole('/data-ops/console?panel=ingest')
    expect(wrapper.find('.el-tabs__item.is-active').text()).toBe('数据摄取管理')

    const bogus = await mountConsole('/data-ops/console?panel=不存在的面板')
    expect(bogus.wrapper.find('.el-tabs__item.is-active').text()).toBe('运维总览')
  })

  it('切面板写 ?panel= 并丢掉上一个面板的子 tab（父子 query 不互相踩）', async () => {
    const { wrapper, router } = await mountConsole('/data-ops/console?panel=data-source&tab=official')
    expect(wrapper.find('.el-tabs__item.is-active').text()).toBe('数据源接入')

    await wrapper.findAll('.el-tabs__item')[4].trigger('click') // 数据摄取管理
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ panel: 'ingest' })
  })
})
