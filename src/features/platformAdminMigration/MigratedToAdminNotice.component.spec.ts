// 「已迁至平台后台」提示组件契约（ChenShi-Tech/dljy#3464；角色闸门 dljy#3518）。
//
// 守什么：配置了 VITE_PLATFORM_ADMIN_URL 时逐项给出后台对应页面链接（新窗口打开、noopener）；
// 没配时只显示文字、不给任何链接；传入的入口若已按组回退则不列出，全部回退时整个组件不渲染；
// 提示只对平台人员（ADMIN）显示，客户账号（BOSS / 交易员等）即使配了后台地址也整个组件不渲染。
// 坏掉的症状：没配后台地址也渲染出坏链接，或链接指错后台页面，或回退后提示仍挂在页面上，
// 或客户账号看到提示 / 后台路径（AI-06 越权泄露）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@/test/mount'
import MigratedToAdminNotice from './MigratedToAdminNotice.vue'
import { MIGRATION_GROUPS } from './registry'

// 角色闸门的受众判定经 getCurrentUser（localStorage 治理用户 → demoProfiles 按用户名解析角色）。
// 默认显式以平台管理员登录；客户角色用例内自行覆盖。
beforeEach(() => {
  localStorage.setItem('dljy_governance_user', JSON.stringify({ username: 'admin' }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  localStorage.removeItem('dljy_governance_user')
  for (const g of Object.values(MIGRATION_GROUPS)) g.hidden = true
})

describe('提示组件：已配置后台地址', () => {
  it('逐项列出入口并链接到后台对应 hash 路由，新窗口打开', () => {
    vi.stubEnv('VITE_PLATFORM_ADMIN_URL', 'http://127.0.0.1:5176')
    const wrapper = mount(MigratedToAdminNotice, { props: { entries: ['ai-skills', 'role-matrix'] } })
    expect(wrapper.text()).toContain('已迁至平台后台')
    expect(wrapper.text()).toContain('由平台人员处理')
    const anchors = wrapper.findAll('a.entry-link')
    expect(anchors.map((a) => a.attributes('href'))).toEqual([
      'http://127.0.0.1:5176/#/ai/skills',
      'http://127.0.0.1:5176/#/access/role-matrix'
    ])
    for (const a of anchors) {
      expect(a.attributes('target')).toBe('_blank')
      expect(a.attributes('rel')).toContain('noopener')
    }
    expect(wrapper.text()).toContain('前往平台后台对应页面')
  })

  it('注册立场带补充说明（在后台客户详情的注册立场分区处理）', () => {
    vi.stubEnv('VITE_PLATFORM_ADMIN_URL', 'https://admin.example.com/')
    const wrapper = mount(MigratedToAdminNotice, { props: { entries: ['subject-registry'] } })
    expect(wrapper.get('a.entry-link').attributes('href')).toBe('https://admin.example.com/#/customers')
    expect(wrapper.get('.entry-hint').text()).toContain('注册立场分区')
  })
})

describe('提示组件：未配置后台地址', () => {
  it('只显示文字，不给任何链接，并提示联系平台人员', () => {
    vi.stubEnv('VITE_PLATFORM_ADMIN_URL', '')
    const wrapper = mount(MigratedToAdminNotice, { props: { entries: ['inference-models', 'grid-credentials'], variant: 'page' } })
    expect(wrapper.find('[data-testid="migrated-to-admin-notice"]').classes()).toContain('page')
    expect(wrapper.text()).toContain('已迁至平台后台')
    expect(wrapper.text()).toContain('推理模型管理')
    expect(wrapper.text()).toContain('电网官方平台')
    expect(wrapper.findAll('a')).toHaveLength(0)
    expect(wrapper.text()).toContain('请联系平台人员')
  })
})

describe('提示组件：按组回退', () => {
  it('已回退的入口不列出；全部回退时组件不渲染', () => {
    vi.stubEnv('VITE_PLATFORM_ADMIN_URL', 'http://127.0.0.1:5176')
    MIGRATION_GROUPS['access-registry'].hidden = false
    const partial = mount(MigratedToAdminNotice, { props: { entries: ['role-matrix', 'ai-mcp'] } })
    expect(partial.findAll('li').map((li) => li.attributes('data-entry'))).toEqual(['ai-mcp'])

    MIGRATION_GROUPS['ai-infra'].hidden = false
    const none = mount(MigratedToAdminNotice, { props: { entries: ['role-matrix', 'ai-mcp'] } })
    expect(none.find('[data-testid="migrated-to-admin-notice"]').exists()).toBe(false)
  })
})

describe('提示组件：客户账号不渲染（dljy#3518，AI-06）', () => {
  it.each(['boss', 'lead', 'trader'])('客户账号（%s）即使配置了后台地址，组件也不渲染任何提示文字、路径或链接', (username) => {
    vi.stubEnv('VITE_PLATFORM_ADMIN_URL', 'http://127.0.0.1:5176')
    localStorage.setItem('dljy_governance_user', JSON.stringify({ username }))
    const wrapper = mount(MigratedToAdminNotice, { props: { entries: ['ai-skills', 'role-matrix', 'subject-registry'] } })
    expect(wrapper.find('[data-testid="migrated-to-admin-notice"]').exists()).toBe(false)
    expect(wrapper.findAll('a')).toHaveLength(0)
    expect(wrapper.text()).toBe('')
  })
})
