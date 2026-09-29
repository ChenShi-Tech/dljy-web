// 已迁入口登记表（内部版）契约（ChenShi-Tech/dljy#3464，任务 12.3；角色闸门 dljy#3518）。
//
// 守什么：用户 2026-09-29 批准的四组入口在内部版全部隐藏、各自落在正确的宿主 tab / 面板 / 区块、
// 后台路径与 dljy-admin 路由表一致；按组回退只影响本组；后台地址未配置 / 不合法时不给链接；
// 提示链接只对平台人员（ADMIN）输出，客户账号下入口照隐藏但提示恒空（AI-06）。
// 坏掉的症状：内部版留着能点但会 403 的旧入口，或回退一组连带放出别组，或提示链接指到后台不存在的页面，
// 或客户账号看到「已迁至平台后台」提示 / 后台路径（越权泄露）。
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// registry 直读 localStorage 的治理用户存档判平台人员（不再经 @/services/auth——那条 import 链
// 会在 node 环境炸掉所有引入导航的测试，见 registry.ts 头注），故本文件须有 localStorage：
// 跑 happy-dom，存档按真实落盘形态写入（persistAuthUser 存的完整用户必含 roleCode），按用例切角色。
function loginAs(roleCode: string): void {
  localStorage.setItem('dljy_governance_user', JSON.stringify({ username: 'admin', roleCode }))
}

beforeEach(() => {
  loginAs('ADMIN')
})
afterEach(() => {
  localStorage.removeItem('dljy_governance_user')
  vi.unstubAllEnvs()
})

import {
  MIGRATED_ENTRIES,
  MIGRATION_GROUPS,
  hiddenEntriesOf,
  isEntryHidden,
  isTabHidden,
  migratedEntryLinks,
  migratedRouteComponent,
  platformAdminBaseUrl,
  type MigratedEntryId,
  type MigrationGroupId
} from './registry'

afterEach(() => {
  vi.unstubAllEnvs()
})

/** 临时回退某组（只改入口可见性），用完复原——登记表是模块级单例，不复原会串到后续用例。 */
function withGroupRolledBack<T>(group: MigrationGroupId, fn: () => T): T {
  const before = MIGRATION_GROUPS[group].hidden
  MIGRATION_GROUPS[group].hidden = false
  try {
    return fn()
  } finally {
    MIGRATION_GROUPS[group].hidden = before
  }
}

// 任务要求给出的后台路径（与 dljy-admin src/app/router.ts 只读核对一致）。
const EXPECTED_ADMIN_PATHS: Record<MigratedEntryId, string> = {
  'ai-llm': '/#/ai/llm',
  'ai-search': '/#/ai/search',
  'ai-mcp': '/#/ai/mcp',
  'ai-notify': '/#/ai/notify',
  'ai-skills': '/#/ai/skills',
  'ai-sub-agents': '/#/ai/sub-agents',
  'ai-dify': '/#/ai/dify',
  'ai-schedules': '/#/ai/schedules',
  'inference-models': '/#/inference/models',
  'data-onboarding': '/#/data/ingest',
  'data-ingest': '/#/data/ingest',
  'grid-credentials': '/#/data/grid-credentials',
  'role-matrix': '/#/access/role-matrix',
  'subject-registry': '/#/customers'
}

describe('登记表结构', () => {
  it('14 个已迁入口逐项对应后台 hash 路由，且全部归入四个已批准分组', () => {
    expect(Object.keys(MIGRATED_ENTRIES).sort()).toEqual(Object.keys(EXPECTED_ADMIN_PATHS).sort())
    for (const [id, entry] of Object.entries(MIGRATED_ENTRIES)) {
      expect(entry.adminPath, id).toBe(EXPECTED_ADMIN_PATHS[id as MigratedEntryId])
      expect(Object.keys(MIGRATION_GROUPS), id).toContain(entry.group)
      expect(entry.label.trim(), id).not.toBe('')
    }
  })

  it('四组默认都是「已批准隐藏」', () => {
    expect(Object.fromEntries(Object.entries(MIGRATION_GROUPS).map(([k, g]) => [k, g.hidden]))).toEqual({
      'ai-infra': true,
      'inference-models': true,
      'data-ingest': true,
      'access-registry': true
    })
  })

  it('长期记忆不在登记表里（个人自助，必须保留）', () => {
    expect(Object.values(MIGRATED_ENTRIES).map((e) => e.label).join()).not.toContain('记忆')
  })
})

describe('组1 AI 设施（/system/ai-studio）内部版隐藏', () => {
  it('八项 AI 设施全部隐藏，五个 tab（AI 模型设置 / 技能 / 子智能体 / Dify / 定时任务）整体隐藏', () => {
    for (const id of ['ai-llm', 'ai-search', 'ai-mcp', 'ai-notify', 'ai-skills', 'ai-sub-agents', 'ai-dify', 'ai-schedules'] as const) {
      expect(isEntryHidden(id), id).toBe(true)
    }
    for (const tab of ['models', 'skills', 'sub-agents', 'dify', 'schedules']) expect(isTabHidden('ai-studio', tab), tab).toBe(true)
    expect(hiddenEntriesOf('ai-studio')).toHaveLength(8)
  })

  it('未登记入口的 tab（如「个人设置」）不隐藏', () => {
    expect(isTabHidden('ai-studio', 'personal')).toBe(false)
  })
})

describe('组2 推理模型（/system/models）内部版隐藏', () => {
  it('整页入口隐藏；路由组件换成整页提示，原页面懒加载器不再被调用', async () => {
    expect(isEntryHidden('inference-models')).toBe(true)
    const original = vi.fn(async () => ({ default: { name: 'SystemModelsView', render: () => null } }))
    const loader = migratedRouteComponent('inference-models', original)
    expect(loader).not.toBe(original)
    const component = (await loader()) as { name?: string }
    expect(component.name).toBe('MigratedEntryPage')
    expect(original).not.toHaveBeenCalled()
  })
})

describe('组3 数据摄取与电网凭据（/data-ops/console）内部版隐藏', () => {
  it('接入向导、摄取管理两个面板与「数据源接入 › 电网官方平台」子 tab 隐藏', () => {
    expect(isTabHidden('data-ops', 'onboarding')).toBe(true)
    expect(isTabHidden('data-ops', 'ingest')).toBe(true)
    expect(isTabHidden('data-source', 'official')).toBe(true)
  })

  it('上传中心、导入融合台、运维总览、治理控制台、数据源接入面板与企业自建通道、受控接入子 tab 保留', () => {
    for (const panel of ['overview', 'upload', 'import-hub', 'governance', 'data-source']) expect(isTabHidden('data-ops', panel), panel).toBe(false)
    for (const tab of ['enterprise', 'restricted']) expect(isTabHidden('data-source', tab), tab).toBe(false)
  })
})

describe('组4 权限矩阵与注册立场内部版隐藏', () => {
  it('权限矩阵 tab 隐藏，用户管理、会话管理保留', () => {
    expect(isTabHidden('accounts', 'permissions')).toBe(true)
    expect(isTabHidden('accounts', 'users')).toBe(false)
    expect(isTabHidden('accounts', 'sessions')).toBe(false)
  })

  it('公司档案里只有注册立场块隐藏', () => {
    expect(hiddenEntriesOf('company-profile')).toEqual(['subject-registry'])
  })
})

describe('角色闸门（dljy#3518，AI-06）：提示只对平台人员（ADMIN）输出', () => {
  it('客户账号（BOSS / 交易负责人 / 交易员）不输出任何标签、后台路径或链接——即使配置了后台地址', () => {
    vi.stubEnv('VITE_PLATFORM_ADMIN_URL', 'http://127.0.0.1:5176')
    for (const role of ['BOSS', 'TRADE_LEAD', 'TRADER']) {
      loginAs(role)
      expect(migratedEntryLinks(['ai-llm', 'role-matrix', 'subject-registry']), role).toEqual([])
    }
  })

  it('入口隐藏不区分角色：客户账号下照常隐藏、照常不给已迁 tab，整页路由组件照样替换（原页面 setup 不跑）', () => {
    loginAs('BOSS')
    expect(isEntryHidden('ai-skills')).toBe(true)
    expect(isTabHidden('accounts', 'permissions')).toBe(true)
    expect(isTabHidden('ai-studio', 'models')).toBe(true)
    expect(hiddenEntriesOf('ai-studio')).toHaveLength(8)
    const original = async () => ({ default: {} })
    expect(migratedRouteComponent('inference-models', original)).not.toBe(original)
  })

  it('平台人员（ADMIN）照常输出提示与后台链接', () => {
    vi.stubEnv('VITE_PLATFORM_ADMIN_URL', 'http://127.0.0.1:5176')
    expect(migratedEntryLinks(['ai-llm']).map((l) => l.href)).toEqual(['http://127.0.0.1:5176/#/ai/llm'])
  })
})

describe('按组回退', () => {
  it('回退「AI 设施」只放出本组，其余三组仍隐藏', () => {
    withGroupRolledBack('ai-infra', () => {
      expect(isEntryHidden('ai-skills')).toBe(false)
      expect(isTabHidden('ai-studio', 'models')).toBe(false)
      expect(hiddenEntriesOf('ai-studio')).toEqual([])
      expect(isEntryHidden('inference-models')).toBe(true)
      expect(isTabHidden('data-ops', 'ingest')).toBe(true)
      expect(isTabHidden('accounts', 'permissions')).toBe(true)
    })
  })

  it('回退后整页路由原样返回原懒加载器，提示也不再列出本组入口', () => {
    withGroupRolledBack('inference-models', () => {
      const original = async () => ({ default: {} })
      expect(migratedRouteComponent('inference-models', original)).toBe(original)
      expect(migratedEntryLinks(['inference-models', 'role-matrix']).map((l) => l.id)).toEqual(['role-matrix'])
    })
  })
})

describe('后台地址 VITE_PLATFORM_ADMIN_URL', () => {
  it('未配置时不给链接（只显示文字）', () => {
    vi.stubEnv('VITE_PLATFORM_ADMIN_URL', '')
    expect(platformAdminBaseUrl()).toBeNull()
    expect(migratedEntryLinks(['ai-llm'])).toEqual([{ id: 'ai-llm', label: MIGRATED_ENTRIES['ai-llm'].label, hint: null, href: null }])
  })

  it('配置后拼出后台 hash 路由完整地址（去掉末尾斜杠，不出现双斜杠）', () => {
    vi.stubEnv('VITE_PLATFORM_ADMIN_URL', 'http://127.0.0.1:5176/')
    expect(platformAdminBaseUrl()).toBe('http://127.0.0.1:5176')
    const links = migratedEntryLinks(['role-matrix', 'subject-registry'])
    expect(links.map((l) => l.href)).toEqual(['http://127.0.0.1:5176/#/access/role-matrix', 'http://127.0.0.1:5176/#/customers'])
    expect(links[1].hint).toContain('注册立场')
  })

  it('非 http(s) 或不合法的地址一律不给链接（不把 javascript: 之类拼进 href）', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://example.com', 'not a url', '   ']) {
      vi.stubEnv('VITE_PLATFORM_ADMIN_URL', bad)
      expect(platformAdminBaseUrl(), bad).toBeNull()
      expect(migratedEntryLinks(['ai-mcp'])[0].href, bad).toBeNull()
    }
  })
})
