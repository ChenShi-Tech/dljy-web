// 已迁入口登记表在客户交付版下的契约（ChenShi-Tech/dljy#3464）。
//
// 守什么：① 客户版（vi.mock('@/services/edition') 切换）下真实登记表对所有入口都答「未迁移」——
// 客户入口一律照旧；② 客户版构建实际用的空壳 registry.customer.ts 同样恒答未迁移，且源码里没有
// 任何提示文字、后台路径或后台地址变量（它会进交付产物）。
// 坏掉的症状：客户交付版丢了技能 / 定时任务 / 推理模型等入口，或交付产物里出现平台后台的痕迹。
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('@/services/edition', () => ({ IS_CUSTOMER_EDITION: true, IS_INTERNAL_EDITION: false }))

import * as registry from './registry'
import * as stub from './registry.customer'

const ALL_IDS = Object.keys(registry.MIGRATED_ENTRIES) as registry.MigratedEntryId[]
const HOST_TABS: Array<[registry.MigrationHostPage, string]> = [
  ['ai-studio', 'models'],
  ['ai-studio', 'skills'],
  ['ai-studio', 'sub-agents'],
  ['ai-studio', 'dify'],
  ['ai-studio', 'schedules'],
  ['data-ops', 'onboarding'],
  ['data-ops', 'ingest'],
  ['data-source', 'official'],
  ['accounts', 'permissions']
]

describe('客户交付版：真实登记表恒答「未迁移」（四组入口照旧）', () => {
  it('14 个入口全部不隐藏，宿主 tab / 面板全部保留', () => {
    for (const id of ALL_IDS) expect(registry.isEntryHidden(id), id).toBe(false)
    for (const [page, tab] of HOST_TABS) expect(registry.isTabHidden(page, tab), `${page}:${tab}`).toBe(false)
  })

  it('没有需要提示的入口，整页路由原样返回原组件', () => {
    for (const page of ['ai-studio', 'system-models', 'data-ops', 'data-source', 'accounts', 'company-profile'] as const) {
      expect(registry.hiddenEntriesOf(page), page).toEqual([])
    }
    expect(registry.migratedEntryLinks(ALL_IDS)).toEqual([])
    const original = async () => ({ default: {} })
    expect(registry.migratedRouteComponent('inference-models', original)).toBe(original)
  })
})

describe('客户交付版空壳 registry.customer.ts', () => {
  it('与真实模块导出同一组函数，且恒答未迁移', () => {
    const functionExports = Object.entries(registry)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k)
      .sort()
    expect(Object.keys(stub).sort()).toEqual(functionExports)
    for (const id of ALL_IDS) expect(stub.isEntryHidden(id)).toBe(false)
    for (const [page, tab] of HOST_TABS) expect(stub.isTabHidden(page, tab)).toBe(false)
    expect(stub.hiddenEntriesOf('ai-studio')).toEqual([])
    expect(stub.migratedEntryLinks(ALL_IDS)).toEqual([])
    expect(stub.platformAdminBaseUrl()).toBeNull()
    const original = async () => ({ default: {} })
    expect(stub.migratedRouteComponent('inference-models', original)).toBe(original)
  })

  it('空壳源码不含提示文字、后台路径或后台地址变量（它会进交付产物）', () => {
    const src = readFileSync(new URL('./registry.customer.ts', import.meta.url), 'utf8')
    for (const needle of ['平台人员', '/#/', 'VITE_PLATFORM_ADMIN_URL', 'adminPath']) expect(src, needle).not.toContain(needle)
    const noticeStub = readFileSync(new URL('./MigratedToAdminNotice.customer.vue', import.meta.url), 'utf8')
    for (const needle of ['已迁至平台后台', '已迁到平台后台', '平台人员', '/#/']) expect(noticeStub, needle).not.toContain(needle)
  })
})
