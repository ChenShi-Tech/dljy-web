// 已迁入口登记表（ChenShi-Tech/dljy#3464，任务 12.3；清单见 docs/platform-admin-entry-migration.md）。
//
// 平台后台（独立仓 dljy-admin，仅我方运营人员）已接管一批平台内部管理操作。内部版前端把这些旧入口
// 隐藏，原位置换成「已迁至平台后台」提示并给出后台对应页面的链接；客户交付版一律不变。
//
// ## 一张表、按组开关
//
// 隐藏哪些入口、它们挂在哪个页面的哪个 tab / 面板 / 区块、对应后台哪个页面，全部登记在本文件。
// 页面、菜单、旧路径重定向壳只问本表，不各自写判断——回退时只改 MIGRATION_GROUPS 里对应组的
// `hidden`，入口就原样回来。**回退只恢复前端入口可见性**，后端门禁（主仓 #3164/#3226/12.1/12.2
// 等收窄）不随之回退：那些旧写接口在内部版照样 403，回退后的按钮点了也会被后端拒绝。
//
// ## 客户交付版为什么完全不受影响
//
// 1. 运行期：每个判断都先过 IS_INTERNAL_EDITION，客户版恒为「未迁移」。
// 2. 产物：客户版构建时 vite.config.ts 的 dljy-customer-edition 插件把本模块重定向到
//    `registry.customer.ts`（全部返回「未迁移」、不含任何标签 / 后台路径 / 后台地址），提示组件也
//    重定向到空壳——提示文字与 VITE_PLATFORM_ADMIN_URL 根本不进交付产物。
//    `npm run verify:customer-edition-build` 扫产物兜底（判据之一就是下面每条 adminPath）。
//
// 因此：**任何页面只能经本模块导出的函数取用登记表**，不要直接 import 表常量（客户版的空壳里
// 没有这些常量，构建会因缺导出而失败——这正是想要的绊线）。
import { defineComponent, h, type Component } from 'vue'
import { IS_INTERNAL_EDITION } from '@/services/edition'

/** 迁移分组（用户 2026-09-29 按组批准，也按组回退）。 */
export type MigrationGroupId = 'ai-infra' | 'inference-models' | 'data-ingest' | 'access-registry'

/** 已迁入口所在的宿主页面（到 tab / 面板 / 区块粒度）。 */
export type MigrationHostPage = 'ai-studio' | 'system-models' | 'data-ops' | 'data-source' | 'accounts' | 'company-profile'

export type MigratedEntryId =
  | 'ai-llm'
  | 'ai-search'
  | 'ai-mcp'
  | 'ai-notify'
  | 'ai-skills'
  | 'ai-sub-agents'
  | 'ai-dify'
  | 'ai-schedules'
  | 'inference-models'
  | 'data-onboarding'
  | 'data-ingest'
  | 'grid-credentials'
  | 'role-matrix'
  | 'subject-registry'

export interface MigrationGroup {
  label: string
  /** true = 内部版隐藏本组入口。按组回退：改为 false 并重新构建。 */
  hidden: boolean
}

export interface MigratedEntry {
  group: MigrationGroupId
  /** 提示里显示的入口名 */
  label: string
  /** 平台后台（hash 路由）对应页面，拼在 VITE_PLATFORM_ADMIN_URL 之后 */
  adminPath: `/#/${string}`
  /** 可选补充说明（如「在客户详情里的注册立场分区处理」） */
  hint?: string
  /** 旧入口在内部版前端的位置；tab 缺省 = 整页或页内区块 */
  host: { page: MigrationHostPage; tab?: string }
}

export const MIGRATION_GROUPS: Record<MigrationGroupId, MigrationGroup> = {
  'ai-infra': { label: 'AI 设施', hidden: true },
  'inference-models': { label: '推理模型', hidden: true },
  'data-ingest': { label: '数据摄取与电网凭据', hidden: true },
  'access-registry': { label: '权限矩阵与注册立场', hidden: true }
}

// 后台路径核对自 dljy-admin src/app/router.ts（2026-09-29 只读核对）。
export const MIGRATED_ENTRIES: Record<MigratedEntryId, MigratedEntry> = {
  // —— AI 设施（/system/ai-studio）；「长期记忆」属个人自助，不在本表 ——
  'ai-llm': {
    group: 'ai-infra',
    label: '模型服务（LLM 服务与凭据、采样参数、角色路由、工作流参数、用量）',
    adminPath: '/#/ai/llm',
    host: { page: 'ai-studio', tab: 'models' }
  },
  'ai-search': { group: 'ai-infra', label: '搜索与出网黑名单', adminPath: '/#/ai/search', host: { page: 'ai-studio', tab: 'models' } },
  'ai-mcp': { group: 'ai-infra', label: 'MCP 服务器', adminPath: '/#/ai/mcp', host: { page: 'ai-studio', tab: 'models' } },
  'ai-notify': { group: 'ai-infra', label: '调度结果推送渠道', adminPath: '/#/ai/notify', host: { page: 'ai-studio', tab: 'models' } },
  'ai-skills': { group: 'ai-infra', label: '技能工作室', adminPath: '/#/ai/skills', host: { page: 'ai-studio', tab: 'skills' } },
  'ai-sub-agents': { group: 'ai-infra', label: '子智能体工作室', adminPath: '/#/ai/sub-agents', host: { page: 'ai-studio', tab: 'sub-agents' } },
  'ai-dify': { group: 'ai-infra', label: 'Dify 工作流工作室', adminPath: '/#/ai/dify', host: { page: 'ai-studio', tab: 'dify' } },
  'ai-schedules': { group: 'ai-infra', label: '定时任务调度', adminPath: '/#/ai/schedules', host: { page: 'ai-studio', tab: 'schedules' } },

  // —— 推理模型（/system/models 整页）——
  'inference-models': { group: 'inference-models', label: '推理模型管理', adminPath: '/#/inference/models', host: { page: 'system-models' } },

  // —— 数据摄取与电网凭据（/data-ops/console 的三块）——
  'data-onboarding': {
    group: 'data-ingest',
    label: '数据接入向导（一键生效触发摄取）',
    adminPath: '/#/data/ingest',
    host: { page: 'data-ops', tab: 'onboarding' }
  },
  'data-ingest': { group: 'data-ingest', label: '数据摄取管理', adminPath: '/#/data/ingest', host: { page: 'data-ops', tab: 'ingest' } },
  'grid-credentials': {
    group: 'data-ingest',
    label: '电网官方平台（接入点凭据与采集运维）',
    adminPath: '/#/data/grid-credentials',
    host: { page: 'data-source', tab: 'official' }
  },

  // —— 权限矩阵与注册立场 ——
  'role-matrix': { group: 'access-registry', label: '角色权限矩阵', adminPath: '/#/access/role-matrix', host: { page: 'accounts', tab: 'permissions' } },
  'subject-registry': {
    group: 'access-registry',
    label: '注册立场',
    adminPath: '/#/customers',
    hint: '在客户目录中打开对应客户，于客户详情的注册立场分区处理',
    host: { page: 'company-profile' }
  }
}

const ENTRY_IDS = Object.keys(MIGRATED_ENTRIES) as MigratedEntryId[]

/** 该入口在当前构建里是否隐藏（内部版 + 所在组已批准隐藏）。客户交付版恒为 false。 */
export function isEntryHidden(id: MigratedEntryId): boolean {
  if (!IS_INTERNAL_EDITION) return false
  const entry = MIGRATED_ENTRIES[id]
  return Boolean(entry && MIGRATION_GROUPS[entry.group]?.hidden)
}

/**
 * 宿主页的某个 tab / 面板是否整体隐藏：该 tab 登记了入口、且登记在它上面的入口全部隐藏。
 * 未登记任何入口的 tab（上传中心、用户管理……）恒为 false。
 */
export function isTabHidden(page: MigrationHostPage, tab: string): boolean {
  const hosted = ENTRY_IDS.filter((id) => MIGRATED_ENTRIES[id].host.page === page && MIGRATED_ENTRIES[id].host.tab === tab)
  return hosted.length > 0 && hosted.every(isEntryHidden)
}

/** 宿主页上当前隐藏的入口（按登记顺序），供页面在原位置渲染提示。 */
export function hiddenEntriesOf(page: MigrationHostPage): MigratedEntryId[] {
  return ENTRY_IDS.filter((id) => MIGRATED_ENTRIES[id].host.page === page && isEntryHidden(id))
}

/**
 * 平台后台地址（构建变量 VITE_PLATFORM_ADMIN_URL，可选）。只接受 http(s) 绝对地址，去掉末尾斜杠；
 * 未配置或不合法时返回 null——提示只显示文字、不给链接。每次调用现读，便于测试切换。
 */
export function platformAdminBaseUrl(): string | null {
  const raw = String(import.meta.env.VITE_PLATFORM_ADMIN_URL ?? '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  } catch {
    return null
  }
  return raw.replace(/\/+$/, '')
}

export interface MigratedEntryLink {
  id: MigratedEntryId
  label: string
  hint: string | null
  /** 后台对应页面完整地址；未配置后台地址时为 null */
  href: string | null
}

/** 提示组件用：入口标签 + 后台链接。未隐藏的入口不输出（回退后提示自然消失）。 */
export function migratedEntryLinks(ids: readonly MigratedEntryId[]): MigratedEntryLink[] {
  const base = platformAdminBaseUrl()
  return ids.filter(isEntryHidden).map((id) => {
    const entry = MIGRATED_ENTRIES[id]
    return { id, label: entry.label, hint: entry.hint ?? null, href: base ? `${base}${entry.adminPath}` : null }
  })
}

type RouteComponentLoader = () => Promise<Component | { default: Component }>

/**
 * 整页迁走的路由（如 /system/models）：内部版隐藏时把路由组件换成整页提示，原页面的 setup 与取数
 * 根本不跑；未隐藏（回退 / 客户版）时原样返回原懒加载组件。直接访问路由不报错、不白屏。
 */
export function migratedRouteComponent(id: MigratedEntryId, loader: RouteComponentLoader): RouteComponentLoader {
  if (!isEntryHidden(id)) return loader
  // 动态 import：提示组件本身 import 本模块，静态引用会成环。用 `@/` 别名而非相对路径：
  // 客户版的模块重定向按说明符后缀匹配（见 vite.config.ts CUSTOMER_EDITION_STUBS）。
  return () =>
    import('@/features/platformAdminMigration/MigratedToAdminNotice.vue').then(({ default: Notice }) =>
      defineComponent({
        name: 'MigratedEntryPage',
        setup: () => () => h('div', { class: 'migrated-entry-page' }, [h(Notice, { entries: [id], variant: 'page' })])
      })
    )
}
