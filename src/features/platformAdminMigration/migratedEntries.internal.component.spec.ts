// 内部版隐藏已迁至平台后台的旧入口（ChenShi-Tech/dljy#3464，任务 12.3；角色闸门 dljy#3518）——页面级契约。
//
// 守什么（按用户 2026-09-29 批准的四组；提示与后台链接只对平台人员 ADMIN 显示，客户账号只隐藏入口）：
//   组1 AI 设施：/system/ai-studio 的五个 tab 不渲染、原位置提示 8 项并给后台链接；长期记忆（个人自助）照常可用
//   组2 推理模型：/system/models 菜单摘除，直接访问显示整页提示、原页面不加载
//   组3 数据摄取与电网凭据：/data-ops/console 的接入向导、摄取管理面板与电网官方平台子 tab 不渲染；
//       上传中心、导入融合台、企业自建通道、受控接入、运维总览、治理控制台照常；总览不再给指向已迁面板的按钮
//   组4 权限矩阵与注册立场：/system/accounts 权限矩阵 tab 不渲染；/gsgl/profile 注册立场块对所有角色恢复
//       只读展示并读取（迁移清单 §3.7），无编辑控件；提示只对平台人员显示
//   重定向壳：旧路径跟着目标面板走，落到宿主页有内容的 tab，不白屏
//   客户账号（BOSS / 交易负责人 / 交易员）：四处宿主页与整页深链都不出现提示文字、后台路径或链接（AI-06）；
//       整页深链落中性说明页（「该页面在当前账号下不可用」+ 返回工作台），不空白页（#217）
// 坏掉的症状：内部版留着能点但会 403 的旧入口；旧深链落到空白面板；长期记忆跟着整页一起消失；
//             客户账号看到「已迁至平台后台」提示 / 后台路径（越权泄露）；注册立场整块消失不可见；
//             客户账号深链整页已迁路由得到空白页（#217「直接访问不报错不白屏」被破）。
// 客户版对照见 migratedEntries.customer.component.spec.ts。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@/test/mount'

const memory = vi.hoisted(() => ({
  list: vi.fn(async () => ({ username: 'u1', count: 1, memories: [{ key: 'k1', content: '偏好先看日前价', topic: 'preference' }] }))
}))
const company = vi.hoisted(() => ({ fetchCompanySubjectTypes: vi.fn(async () => ['GENERATOR']) }))

vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  apiGet: vi.fn(async () => ({ code: 200, data: null }))
}))
vi.mock('@/services/data/uploadClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/data/uploadClient')>()),
  fetchUploadBatches: vi.fn(async () => [])
}))
vi.mock('@/services/agent/memoryConfig', () => ({
  listMemories: memory.list,
  deleteMemory: vi.fn(async () => true),
  clearMemories: vi.fn(async () => true)
}))
vi.mock('@/services/company/companyApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/company/companyApi')>()),
  fetchProfile: vi.fn(async () => ({ contact: '张三', address: '昆明', businessScope: '售电' })),
  fetchCompanySubjectTypes: company.fetchCompanySubjectTypes
}))
// 各 tab 子页换成轻量替身（容器契约与子页实现无关；__esModule 必须显式给，见 DataOpsConsoleView spec 注释）。
vi.mock('@/views/UserManagementView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-users" />' } }))
vi.mock('@/views/SessionManagementView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-sessions" />' } }))
vi.mock('@/views/PermissionMatrixView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-permissions" />' } }))
vi.mock('@/views/AiSettingsView.vue', () => ({ __esModule: true, default: { template: '<div class="stub-ai-settings" />' } }))
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
import OpsOverviewPanel from '@/views/dataops/OpsOverviewPanel.vue'
// 「个人设置」tab 由 AI 工作室经 defineAsyncComponent 动态加载；先静态加载一次进模块缓存，
// 挂载后的动态 import 才能在 settle() 的几轮 tick 内落地。
import '@/components/ai/PersonalAiSettingsPanel.vue'
import { activeTabLabels, mountHost, noticeEntries, routeComponentOf, settle, tabLabels, terminalOf } from '@/test/platformAdminMigration'

beforeEach(() => {
  vi.stubEnv('VITE_PLATFORM_ADMIN_URL', 'http://127.0.0.1:5176')
  vi.clearAllMocks()
  // 提示受众 = 平台人员（内部版 ADMIN，dljy#3518）：显式以平台管理员登录，不依赖
  // 「无登录态时默认用户恰为 ADMIN」的隐式行为；客户账号用例在用例内自行覆盖。
  localStorage.setItem('dljy_governance_user', JSON.stringify({ username: 'admin' }))
})
afterEach(() => {
  vi.unstubAllEnvs()
  localStorage.removeItem('dljy_governance_user')
})

describe('组1 AI 设施（内部版）：/system/ai-studio 只剩「个人设置」，其余 tab 原位置提示', () => {
  it('五个 AI 设施 tab 不渲染，只剩「个人设置」', async () => {
    const { wrapper } = await mountHost('/system/ai-studio')
    expect(tabLabels(wrapper)).toEqual(['个人设置'])
    for (const stub of ['.stub-ai-settings', '.stub-skills', '.stub-sub-agents', '.stub-dify', '.stub-schedules']) {
      expect(wrapper.find(stub).exists(), stub).toBe(false)
    }
  })

  it('原位置提示列出 8 项 AI 设施并链接到后台对应页面', async () => {
    const { wrapper } = await mountHost('/system/ai-studio')
    expect(noticeEntries(wrapper)).toEqual(['ai-llm', 'ai-search', 'ai-mcp', 'ai-notify', 'ai-skills', 'ai-sub-agents', 'ai-dify', 'ai-schedules'])
    const hrefs = wrapper.findAll('[data-testid="migrated-to-admin-notice"] a').map((a) => a.attributes('href'))
    expect(hrefs).toContain('http://127.0.0.1:5176/#/ai/llm')
    expect(hrefs).toContain('http://127.0.0.1:5176/#/ai/schedules')
  })

  it('长期记忆（个人自助）照常可用：「个人设置」默认打开并读取当前账号的记忆', async () => {
    const { wrapper } = await mountHost('/system/ai-studio')
    expect(activeTabLabels(wrapper)).toEqual(['个人设置'])
    const card = wrapper.get('[data-testid="memory-management-card"]')
    expect(card.text()).toContain('偏好先看日前价')
    expect(memory.list).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="voice-broadcast-card"]').exists()).toBe(true)
  })

  it('深链到已迁 tab（?tab=skills / ?tab=models）落「个人设置」，不白屏', async () => {
    for (const tab of ['skills', 'models', 'schedules']) {
      const { wrapper } = await mountHost(`/system/ai-studio?tab=${tab}`)
      expect(activeTabLabels(wrapper), tab).toEqual(['个人设置'])
      expect(wrapper.find('[data-testid="personal-ai-settings"]').exists(), tab).toBe(true)
    }
  })
})

describe('组2 推理模型（内部版）：/system/models 菜单摘除，直接访问显示整页提示', () => {
  it('侧边栏「系统管理」不再有推理模型管理，其余两项照常', () => {
    const system = navigation.find((g) => g.path === '/system')
    expect(system?.children?.map((c) => c.path)).toEqual(['/system/ai-studio', '/system/accounts'])
  })

  it('直接访问路由得到整页提示（含后台链接），原管理页不加载', async () => {
    const component = await routeComponentOf('/system/models')
    expect((component as { name?: string }).name).toBe('MigratedEntryPage')
    const wrapper = mount(component as never)
    await settle()
    expect(wrapper.text()).toContain('已迁至平台后台')
    expect(wrapper.text()).toContain('推理模型管理')
    expect(wrapper.get('a').attributes('href')).toBe('http://127.0.0.1:5176/#/inference/models')
    expect(wrapper.find('.stub-system-models').exists()).toBe(false)
  })
})

describe('组3 数据摄取与电网凭据（内部版）：/data-ops/console 三块不渲染，客户自助面板照常', () => {
  it('接入向导、摄取管理面板不渲染；运维总览、上传中心、导入融合台、治理控制台、数据源接入照常', async () => {
    const { wrapper } = await mountHost('/data-ops/console')
    expect(tabLabels(wrapper)).toEqual(['运维总览', '数据上传中心', '数据导入融合台', '数据治理控制台', '数据源接入'])
    expect(noticeEntries(wrapper)).toEqual(['data-onboarding', 'data-ingest'])
  })

  it('数据源接入里电网官方平台子 tab 不渲染，企业自建通道（默认）与受控接入照常，原位置提示电网凭据', async () => {
    const { wrapper } = await mountHost('/data-ops/console?panel=data-source&tab=official')
    expect(tabLabels(wrapper, '.ds-tabs')).toEqual(['企业自建通道', '受控接入'])
    expect(activeTabLabels(wrapper)).toEqual(['数据源接入', '企业自建通道'])
    expect(wrapper.find('.stub-enterprise').exists()).toBe(true)
    expect(wrapper.find('.stub-official').exists()).toBe(false)
    expect(noticeEntries(wrapper)).toContain('grid-credentials')
    const hrefs = wrapper.findAll('[data-testid="migrated-to-admin-notice"] a').map((a) => a.attributes('href'))
    expect(hrefs).toContain('http://127.0.0.1:5176/#/data/grid-credentials')
  })

  it('运维总览不再给指向已迁面板的按钮（接入向导 / 摄取管理 / 定时任务），其余按钮照常', async () => {
    const memoryRouter = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }] })
    const wrapper = mount(OpsOverviewPanel, {
      global: { plugins: [memoryRouter], stubs: { RegionDataBanner: true, DataBasisBadge: true } }
    })
    await settle()
    const labels = wrapper.findAll('.stage-actions .stage-link').map((n) => n.text().replace(/\s*→$/, ''))
    expect(labels).toEqual(['数据源接入', '上传中心', '导入融合台', '治理控制台', '数据浏览器'])
  })
})

describe('组4 权限矩阵与注册立场（内部版）', () => {
  it('/system/accounts 权限矩阵 tab 不渲染，用户管理、会话管理照常，原位置提示并链接后台角色权限矩阵', async () => {
    const { wrapper } = await mountHost('/system/accounts')
    expect(tabLabels(wrapper)).toEqual(['用户管理', '会话管理'])
    expect(wrapper.find('.stub-users').exists()).toBe(true)
    expect(noticeEntries(wrapper)).toEqual(['role-matrix'])
    expect(wrapper.get('[data-testid="migrated-to-admin-notice"] a').attributes('href')).toBe('http://127.0.0.1:5176/#/access/role-matrix')
  })

  it('深链 ?tab=permissions 落用户管理，不白屏', async () => {
    const { wrapper } = await mountHost('/system/accounts?tab=permissions')
    expect(activeTabLabels(wrapper)).toEqual(['用户管理'])
    expect(wrapper.find('.stub-permissions').exists()).toBe(false)
  })

  it('/gsgl/profile 注册立场恢复只读展示并读取（迁移清单 §3.7），平台人员另见提示与后台链接；公司档案本体照常', async () => {
    const { wrapper } = await mountHost('/gsgl/profile')
    expect(wrapper.text()).toContain('档案信息')
    expect(wrapper.text()).toContain('交易中心登记')
    expect(company.fetchCompanySubjectTypes).toHaveBeenCalled()
    // 内部版立场恒只读：选择器禁用、无保存按钮（编辑只落平台后台，写接口不再调用）
    expect(wrapper.find('.el-select__wrapper').classes()).toContain('is-disabled')
    expect(wrapper.text()).not.toContain('保存注册立场')
    expect(noticeEntries(wrapper)).toEqual(['subject-registry'])
    expect(wrapper.get('[data-testid="migrated-to-admin-notice"] a').attributes('href')).toBe('http://127.0.0.1:5176/#/customers')
  })
})

describe('客户账号（非平台人员，dljy#3518，AI-06）：入口照隐藏，但不出现任何迁移提示、后台路径或链接', () => {
  // 角色经 localStorage 治理用户切换（getStoredUser → demoProfiles 按用户名解析角色）。
  function loginAs(username: string) {
    localStorage.setItem('dljy_governance_user', JSON.stringify({ username }))
  }

  it.each(['boss', 'lead', 'trader'])('客户账号（%s）在四处宿主页都看不到提示、后台路径与链接', async (username) => {
    loginAs(username)
    for (const path of ['/system/ai-studio', '/data-ops/console', '/system/accounts', '/gsgl/profile']) {
      const { wrapper } = await mountHost(path)
      expect(wrapper.find('[data-testid="migrated-to-admin-notice"]').exists(), path).toBe(false)
      expect(wrapper.text(), path).not.toContain('平台后台')
      expect(wrapper.text(), path).not.toContain('前往平台后台')
      expect(wrapper.findAll('a.entry-link'), path).toHaveLength(0)
    }
  })

  it('客户 BOSS 的入口隐藏照旧（提示没有，已迁 tab 也没回来）', async () => {
    loginAs('boss')
    const ai = await mountHost('/system/ai-studio')
    expect(tabLabels(ai.wrapper)).toEqual(['个人设置'])
    const ops = await mountHost('/data-ops/console')
    expect(tabLabels(ops.wrapper)).toEqual(['运维总览', '数据上传中心', '数据导入融合台', '数据治理控制台', '数据源接入'])
    const accounts = await mountHost('/system/accounts')
    expect(tabLabels(accounts.wrapper)).toEqual(['用户管理', '会话管理'])
  })

  it('客户 BOSS 深链 /system/models 得到中性说明页（无「平台后台」与后台路径，原管理页不加载）', async () => {
    loginAs('boss')
    const component = await routeComponentOf('/system/models')
    expect((component as { name?: string }).name).toBe('MigratedEntryPage')
    // 中性说明里的「返回工作台」是 RouterLink，挂载需 router 上下文（与 OpsOverviewPanel 用例同法）
    const memory = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }] })
    await memory.push('/system/models')
    await memory.isReady()
    const wrapper = mount(component as never, { global: { plugins: [memory] } })
    await settle()
    expect(wrapper.get('[data-testid="migrated-entry-unavailable"]').text()).toContain('该页面在当前账号下不可用')
    expect(wrapper.text()).not.toContain('平台后台')
    expect(wrapper.text()).not.toContain('127.0.0.1')
    expect(wrapper.text()).not.toContain('/#/')
    const back = wrapper.get('a')
    expect(back.text()).toBe('返回工作台')
    expect(back.attributes('href')).toBe('/dashboard')
    expect(wrapper.find('[data-testid="migrated-to-admin-notice"]').exists()).toBe(false)
    expect(wrapper.find('.stub-system-models').exists()).toBe(false)
  })

  it.each(['boss', 'lead', 'trader'])('客户账号（%s）在公司档案看到只读注册立场：读取发生、无编辑控件、无提示', async (username) => {
    loginAs(username)
    const { wrapper } = await mountHost('/gsgl/profile')
    expect(wrapper.text()).toContain('交易中心登记')
    expect(company.fetchCompanySubjectTypes).toHaveBeenCalled()
    expect(wrapper.find('.el-select__wrapper').classes()).toContain('is-disabled')
    expect(wrapper.text()).not.toContain('保存注册立场')
    expect(wrapper.find('[data-testid="migrated-to-admin-notice"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('平台后台')
  })
})

describe('重定向壳（内部版）：跟着目标面板走，不落到不渲染的面板', () => {
  // [旧路径, 真实路由表追到的终点, 终点页应渲染出的内容]
  const CASES: Array<[string, string, string]> = [
    ['/ai-settings', '/system/ai-studio', '[data-testid="personal-ai-settings"]'],
    ['/ai-skills', '/system/ai-studio', '[data-testid="personal-ai-settings"]'],
    ['/ai-sub-agents', '/system/ai-studio', '[data-testid="personal-ai-settings"]'],
    ['/system/schedules', '/system/ai-studio', '[data-testid="personal-ai-settings"]'],
    ['/xhjy/dify-studio', '/system/ai-studio', '[data-testid="personal-ai-settings"]'],
    ['/xhjy/ai-orchestration-studio', '/system/ai-studio', '[data-testid="personal-ai-settings"]'],
    ['/system/permissions', '/system/accounts', '.stub-users'],
    ['/system/users', '/system/accounts?tab=users', '.stub-users'],
    ['/system/sessions', '/system/accounts?tab=sessions', '.stub-sessions'],
    ['/yygl/data-onboarding', '/data-ops/console', '.ops-overview'],
    ['/yygl/ingest', '/data-ops/console', '.ops-overview'],
    ['/yygl/import-hub', '/data-ops/console?panel=import-hub', '.stub-import-hub'],
    ['/yygl/data-governance', '/data-ops/console?panel=governance', '.stub-governance'],
    ['/data-ops/upload', '/data-ops/console?panel=upload', '.stub-upload'],
    ['/data-source-settings', '/data-ops/console?panel=data-source', '.stub-enterprise'],
    ['/sichuan-access', '/data-ops/console?panel=data-source', '.stub-enterprise']
  ]

  it.each(CASES)('%s → %s，终点有内容且提示在场', async (legacy, expected, content) => {
    const terminal = terminalOf(legacy)
    expect(terminal).toBe(expected)
    const { wrapper } = await mountHost(terminal)
    expect(activeTabLabels(wrapper).length).toBeGreaterThan(0)
    expect(wrapper.find(content).exists(), content).toBe(true)
  })

  it('指向已迁面板的壳终点页都挂着对应提示', async () => {
    for (const [legacy, entry] of [['/ai-skills', 'ai-skills'], ['/system/permissions', 'role-matrix'], ['/yygl/ingest', 'data-ingest'], ['/sichuan-access', 'grid-credentials']]) {
      const { wrapper } = await mountHost(terminalOf(legacy))
      expect(noticeEntries(wrapper), legacy).toContain(entry)
    }
  })
})
