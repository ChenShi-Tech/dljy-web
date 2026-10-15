// 客户交付版不受「已迁至平台后台」影响（ChenShi-Tech/dljy#3464，任务 12.3）——页面级对照。
//
// 守什么：用 vi.mock('@/services/edition') 切到客户交付版后，四组入口全部照旧——AI 工作室五个 tab、
// 推理模型菜单与页面、数据运维七面板与电网官方平台子 tab、权限矩阵 tab、注册立场块都在，页面上没有
// 任何迁移提示；旧路径重定向壳照旧落到原 tab / 面板。
// 坏掉的症状：内部版的隐藏逻辑漏进交付版，客户丢了入口。内部版对照见 migratedEntries.internal.component.spec.ts。
//
// ⚠ 2026-10-15 起数据接入页群按 yunnan-launch-readiness 的 customer-edition-page-gating spec
// 在客户档整组门控（regionModules.editionModuleCapabilities，fail-closed）：数据运维工作台/
// 通用数据浏览器及其旧路径重定向壳不再注册路由，重定向壳用例里相应移除并改为断言不可达；
// 组件级「七面板无提示」用例保留——它守的是组件本身不夹带迁移提示，与页群是否进客户档正交。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@/test/mount'

const company = vi.hoisted(() => ({ fetchCompanySubjectTypes: vi.fn(async () => ['GENERATOR']) }))

vi.mock('@/services/edition', () => ({ IS_CUSTOMER_EDITION: true, IS_INTERNAL_EDITION: false }))
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  apiGet: vi.fn(async () => ({ code: 200, data: null }))
}))
vi.mock('@/services/data/uploadClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/data/uploadClient')>()),
  fetchUploadBatches: vi.fn(async () => [])
}))
vi.mock('@/services/company/companyApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/company/companyApi')>()),
  fetchProfile: vi.fn(async () => ({ contact: '张三', address: '昆明', businessScope: '售电' })),
  fetchCompanySubjectTypes: company.fetchCompanySubjectTypes
}))
vi.mock('@/views/UserManagementView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-users" />' } }))
vi.mock('@/views/SessionManagementView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-sessions" />' } }))
vi.mock('@/views/PermissionMatrixView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-permissions" />' } }))
vi.mock('@/components/ai/ModelServicesPanel.vue', () => ({ __esModule: true, default: { template: '<div class="stub-model-services" />' } }))
vi.mock('@/views/SkillStudioView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-skills" />' } }))
vi.mock('@/views/SubAgentStudioView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-sub-agents" />' } }))
vi.mock('@/views/strategy/DifyWorkflowStudioView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-dify" />' } }))
vi.mock('@/views/ScheduleManagementView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-schedules" />' } }))
vi.mock('@/views/dataops/DataUploadView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-upload" />' } }))
vi.mock('@/views/ImportHubView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-import-hub" />' } }))
vi.mock('@/views/DataOnboardingView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-onboarding" />' } }))
vi.mock('@/views/DataIngestionView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-ingest" />' } }))
vi.mock('@/views/DataGovernanceView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-governance" />' } }))
vi.mock('@/views/data-access/OfficialPlatformTab.vue', () => ({ __esModule: true, default: { template: '<div class="stub-official" />' } }))
vi.mock('@/views/data-access/EnterpriseAdapterTab.vue', () => ({ __esModule: true, default: { template: '<div class="stub-enterprise" />' } }))
vi.mock('@/views/data-access/RestrictedProviderTab.vue', () => ({ __esModule: true, default: { template: '<div class="stub-restricted" />' } }))
vi.mock('@/views/SystemModelsView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-system-models" />' } }))

import { navigation } from '@/data/navigation'
import router from '@/router'
import OpsOverviewPanel from '@/views/dataops/OpsOverviewPanel.vue'
import { activeTabLabels, mountHost, routeComponentOf, settle, tabLabels, terminalOf } from '@/test/platformAdminMigration'

beforeEach(() => {
  // 即便构建环境里配了后台地址，客户版也不读它、页面上不出现提示。
  vi.stubEnv('VITE_PLATFORM_ADMIN_URL', 'http://127.0.0.1:5176')
  vi.clearAllMocks()
})

function expectNoNotice(wrapper: { find: (s: string) => { exists: () => boolean }; text: () => string }) {
  expect(wrapper.find('[data-testid="migrated-to-admin-notice"]').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('平台后台')
}

describe('组1 AI 设施（客户版照旧）', () => {
  it('/system/ai-studio 五个 tab 齐全（模型服务档位面），没有「个人设置」也没有提示', async () => {
    const { wrapper } = await mountHost('/system/ai-studio')
    expect(tabLabels(wrapper)).toEqual(['模型服务', '技能工作室', '子智能体工作室', 'Dify 工作流工作室', '定时任务调度'])
    expect(wrapper.find('.stub-model-services').exists()).toBe(true)
    expectNoNotice(wrapper)
  })
})

describe('组2 推理模型（客户版照旧）', () => {
  it('菜单保留推理模型管理，路由仍是原管理页', async () => {
    const system = navigation.find((g) => g.path === '/system')
    expect(system?.children?.map((c) => c.path)).toEqual(['/system/ai-studio', '/system/accounts', '/system/models'])
    const component = await routeComponentOf('/system/models')
    const wrapper = mount(component as never)
    await settle()
    expect(wrapper.find('.stub-system-models').exists()).toBe(true)
    expectNoNotice(wrapper)
  })
})

describe('组3 数据摄取与电网凭据（客户版照旧）', () => {
  it('/data-ops/console 七面板齐全、无提示', async () => {
    const { wrapper } = await mountHost('/data-ops/console')
    expect(tabLabels(wrapper)).toEqual(['运维总览', '数据上传中心', '数据导入融合台', '数据接入向导', '数据摄取管理', '数据治理控制台', '数据源接入'])
    expectNoNotice(wrapper)
  })

  it('数据源接入三个子 tab 齐全，默认电网官方平台', async () => {
    const { wrapper } = await mountHost('/data-ops/console?panel=data-source')
    expect(tabLabels(wrapper, '.ds-tabs')).toEqual(['电网官方平台', '企业自建通道', '受控接入'])
    expect(wrapper.find('.stub-official').exists()).toBe(true)
    expectNoNotice(wrapper)
  })

  it('运维总览行动按钮全部保留（含接入向导 / 摄取管理 / 定时任务）', async () => {
    const memoryRouter = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }] })
    const wrapper = mount(OpsOverviewPanel, {
      global: { plugins: [memoryRouter], stubs: { RegionDataBanner: true, DataBasisBadge: true } }
    })
    await settle()
    const labels = wrapper.findAll('.stage-actions .stage-link').map((n) => n.text().replace(/\s*→$/, ''))
    expect(labels).toEqual(['数据源接入', '接入向导', '上传中心', '导入融合台', '摄取管理', '定时任务', '治理控制台', '数据浏览器'])
  })
})

describe('组4 权限矩阵与注册立场（客户版照旧）', () => {
  it('/system/accounts 三个 tab 齐全', async () => {
    const { wrapper } = await mountHost('/system/accounts')
    expect(tabLabels(wrapper)).toEqual(['用户管理', '会话管理', '权限矩阵'])
    expectNoNotice(wrapper)
  })

  it('/gsgl/profile 注册立场块照常渲染并读取', async () => {
    const { wrapper } = await mountHost('/gsgl/profile')
    expect(wrapper.text()).toContain('交易中心登记')
    expect(company.fetchCompanySubjectTypes).toHaveBeenCalled()
    expectNoNotice(wrapper)
  })
})

describe('重定向壳（客户版照旧落原 tab / 面板）', () => {
  const CASES: Array<[string, string, string, string]> = [
    ['/ai-settings', '/system/ai-studio?tab=models', '模型服务', '.stub-model-services'],
    ['/ai-skills', '/system/ai-studio?tab=skills', '技能工作室', '.stub-skills'],
    ['/system/schedules', '/system/ai-studio?tab=schedules', '定时任务调度', '.stub-schedules'],
    ['/xhjy/dify-studio', '/system/ai-studio?tab=dify', 'Dify 工作流工作室', '.stub-dify'],
    ['/system/permissions', '/system/accounts?tab=permissions', '权限矩阵', '.stub-permissions']
  ]

  it.each(CASES)('%s → %s', async (legacy, expected, activeLabel, content) => {
    const terminal = terminalOf(legacy)
    expect(terminal).toBe(expected)
    const { wrapper } = await mountHost(terminal)
    expect(activeTabLabels(wrapper)).toContain(activeLabel)
    expect(wrapper.find(content).exists(), content).toBe(true)
  })

  // 数据接入页群旧路径（原落在数据运维工作台面板）：customer-edition-page-gating 起
  // 随页群整组不注册路由——resolve 只能落到 catch-all（/:pathMatch(.*)* → /dashboard），
  // 即直连不可达、非渲染期隐藏。
  it('数据接入页群旧路径重定向壳在客户档不可达（全部落 catch-all）', () => {
    for (const legacy of ['/yygl/ingest', '/yygl/data-onboarding', '/sichuan-access', '/data-ops/console', '/yygl/data-browser', '/data-ops/upload']) {
      const resolved = router.resolve(legacy)
      expect(resolved.matched[0]?.path, legacy).toBe('/:pathMatch(.*)*')
    }
  })
})
