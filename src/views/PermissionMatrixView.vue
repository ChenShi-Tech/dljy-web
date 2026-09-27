<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Layers, Lock, MapPin, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Users } from 'lucide-vue-next'
import { navigation, type NavItem } from '../data/navigation'
import { getRegionStatusLabel, regionProfiles, type RegionRuleSet } from '../data/regions'
import {
  accessRules,
  adminOnlyRoutes,
  demoProfiles,
  getAccessOverrides,
  getEffectiveAccessRule,
  isAdminLevelRole,
  resetRoleAccessOverride,
  roleLabels,
  saveRoleAccessOverride,
  subjectTypeLabels,
  type AccessRule,
  type RoleCode
} from '@/services/governance'
import {
  type AuthUser,
  getAuthDirectory,
  resetServerRoleAccessOverride,
  saveServerRoleAccessOverride
} from '@/services/auth'
import { getRegionBusinessModules, type RegionBusinessModule } from '@/services/region/regionModules'

type MenuRoute = {
  block: string
  title: string
  path: string
}

type TagType = 'success' | 'warning' | 'info' | 'danger' | 'primary'

type RegionModuleAccess = {
  module: RegionBusinessModule
  accessRoutes: string[]
  landingRoutes: string[]
}

const roleCodes = Object.keys(roleLabels) as RoleCode[]
const selectedRoleCode = ref<RoleCode>('TRADER')
const draftRoutes = ref<string[]>([])
const draftDefaultRoute = ref('/dashboard')
const draftActions = ref<string[]>([])
const overrideRevision = ref(0)
const authSyncStatus = ref<'checking' | 'synced' | 'local'>('checking')
const authDatabaseFile = ref('')
const directoryUsers = ref<AuthUser[]>(demoProfiles as AuthUser[])

// 菜单收敛为预测中心后仍保留五个 tab 的授权粒度，避免保存覆盖配置时丢失子能力。
const FORECAST_CENTER_TABS: MenuRoute[] = [
  { block: '预测数据', title: '预测中心 · 官方回放', path: '/ycsj/hub' },
  { block: '预测数据', title: '预测中心 · 建模工作台', path: '/ycsj/workbench' },
  { block: '预测数据', title: '预测中心 · 厂站预测', path: '/ycsj/station-generation' },
  { block: '预测数据', title: '预测中心 · 质量记分牌', path: '/ycsj/scoreboard' },
  { block: '预测数据', title: '预测中心 · 申报决策', path: '/ycsj/decision-cockpit' },
]
const menuRoutes = computed(() => {
  const rows = flattenNavigation(navigation)
  const index = rows.findIndex((row) => row.path === '/ycsj/center')
  return index >= 0 ? [...rows.slice(0, index + 1), ...FORECAST_CENTER_TABS, ...rows.slice(index + 1)] : rows
})
const actionOptions = computed(() => {
  const actions = new Set<string>()
  for (const rule of Object.values(accessRules)) {
    rule.actions.forEach((action) => actions.add(action))
  }
  return [...actions].sort()
})
const accessOverrides = computed(() => {
  // 订阅用：override revision 变化时让本 computed 重算
  const _overrideRevision = overrideRevision.value
  return getAccessOverrides()
})
const selectedIsAdminLevel = computed(() => isAdminLevelRole(selectedRoleCode.value))
const selectedHasOverride = computed(() => Boolean(accessOverrides.value[selectedRoleCode.value]))
const authSyncLabel = computed(() => {
  if (authSyncStatus.value === 'checking') return '认证库校验中'
  if (authSyncStatus.value === 'synced') return '已同步认证库'
  return '本地权限回退'
})
const draftAllowedRoutes = computed(() => new Set(draftRoutes.value))
const allowedDefaultOptions = computed(() => {
  if (selectedIsAdminLevel.value) return menuRoutes.value
  return menuRoutes.value.filter((route) => draftAllowedRoutes.value.has(route.path))
})
// 页内分段：本页原先把「角色路由开关 + 地区入口表 + 认证目录表」一路平铺，
// 光路由区就是 20 个 block × 73 条开关（每行 58px 两列铺开 ≈ 2500px），整页要拉很久。
// 拆成三段，一屏只呈现一件事；与「AI 模型设置」「数据源接入设置」同一套 el-segmented 范式。
const MATRIX_SECTIONS = [
  { label: '角色权限', value: 'roles' },
  { label: '地区入口', value: 'regions' },
  { label: '认证目录', value: 'directory' },
] as const
const section = ref<string>('roles')

// 路由开关区：73 条里找一条太痛苦，给个按页面名/路径的过滤。
const routeKeyword = ref('')
// 默认全折叠，折叠态每个 block 一行（20 × ~44px，两列 ≈ 440px），
// 比原先 2500px 的全展开可用得多；要改哪个 block 就展开哪个。
const expandedBlocks = ref<string[]>([])

const routesByBlock = computed(() => {
  const kw = routeKeyword.value.trim().toLowerCase()
  const groups = new Map<string, MenuRoute[]>()
  for (const route of menuRoutes.value) {
    if (kw && !route.title.toLowerCase().includes(kw) && !route.path.toLowerCase().includes(kw)) continue
    const rows = groups.get(route.block) ?? []
    rows.push(route)
    groups.set(route.block, rows)
  }
  return [...groups.entries()].map(([block, routes]) => ({ block, routes }))
})

// 折叠态也要能看出「这个 block 开了几个」，否则全折叠等于把信息藏死。
function blockGrantedCount(routes: MenuRoute[]) {
  return routes.filter((route) => draftAllowedRoutes.value.has(route.path)).length
}

// 搜索时自动展开命中的 block：否则输入关键词后看到的还是一排折叠头，等于没搜。
// 用可写 computed 而非 watch 副作用，watch 在 routesByBlock 重算前后的时序不可靠，
// 实测会出现「筛出 3 组但仍全折叠」。这里直接由关键词推导展开集，无时序问题；
// 清空关键词即回到用户手动展开的那一组。
const activeBlocks = computed<string[]>({
  get: () => (routeKeyword.value.trim() ? routesByBlock.value.map((g) => g.block) : expandedBlocks.value),
  set: (value) => {
    // 搜索态下的手动折叠是临时视图，不写回用户的常驻展开集
    if (!routeKeyword.value.trim()) expandedBlocks.value = value
  }
})
const matrixStats = computed(() => ({
  roles: roleCodes.length,
  users: directoryUsers.value.length,
  routes: menuRoutes.value.length,
  adminRoles: roleCodes.filter((roleCode) => isAdminLevelRole(roleCode)).length
}))
const regionalAccessRows = computed(() => {
  return regionProfiles.map((region) => {
    const modules = getRegionBusinessModules(region.id)
    const moduleAccesses = modules.map((module) => buildModuleAccess(module, selectedRoleCode.value))
    return {
      region,
      modules,
      moduleAccesses
    }
  })
})

watch(
  selectedRoleCode,
  () => {
    loadSelectedRole()
  },
  { immediate: true }
)

onMounted(async () => {
  try {
    const directory = await getAuthDirectory()
    authDatabaseFile.value = directory.database.file
    directoryUsers.value = directory.users.length ? directory.users : (demoProfiles as AuthUser[])
    authSyncStatus.value = 'synced'
    overrideRevision.value += 1
    loadSelectedRole()
  } catch {
    authSyncStatus.value = 'local'
  }
})

function flattenNavigation(items: NavItem[]): MenuRoute[] {
  const rows: MenuRoute[] = []
  for (const item of items) {
    if (item.children?.length) {
      item.children.forEach((child) => {
        rows.push({ block: item.title, title: child.title, path: child.path })
      })
      continue
    }
    rows.push({ block: item.title, title: item.title, path: item.path })
  }
  return rows
}

function loadSelectedRole() {
  const roleCode = selectedRoleCode.value
  const rule = getEffectiveAccessRule(roleCode)
  if (isAdminLevelRole(roleCode)) {
    draftRoutes.value = menuRoutes.value.map((route) => route.path)
    draftDefaultRoute.value = rule.defaultRoute
    draftActions.value = [...rule.actions]
    return
  }

  draftRoutes.value = menuRoutes.value
    .filter((route) => isRouteAllowed(route.path, rule, roleCode))
    .map((route) => route.path)
  draftDefaultRoute.value = draftRoutes.value.includes(rule.defaultRoute)
    ? rule.defaultRoute
    : draftRoutes.value[0] ?? '/dashboard'
  draftActions.value = [...rule.actions]
}

function isRouteAllowed(path: string, rule: AccessRule, roleCode: RoleCode) {
  if (isAdminLevelRole(roleCode)) return true
  if (adminOnlyRoutes.includes(path)) return false
  if (path === '/dashboard') return true
  if (rule.routes?.includes(path)) return true
  return Boolean(rule.groups?.some((group) => path === group || path.startsWith(`${group}/`)))
}

function isRouteLocked(path: string) {
  return selectedIsAdminLevel.value || path === '/dashboard' || adminOnlyRoutes.includes(path)
}

function toggleRoute(path: string, checked: boolean) {
  if (isRouteLocked(path)) return
  const next = new Set(draftRoutes.value)
  if (checked) {
    next.add(path)
  } else {
    next.delete(path)
    if (path === '/ycsj/center') {
      FORECAST_CENTER_TABS.forEach((tab) => next.delete(tab.path))
    }
  }
  next.add('/dashboard')
  draftRoutes.value = [...next]
  if (!next.has(draftDefaultRoute.value)) {
    draftDefaultRoute.value = draftRoutes.value[0] ?? '/dashboard'
  }
}

function toggleBlock(routes: MenuRoute[], checked: boolean) {
  if (selectedIsAdminLevel.value) return
  const next = new Set(draftRoutes.value)
  routes.forEach((route) => {
    if (isRouteLocked(route.path)) return
    if (checked) {
      next.add(route.path)
    } else {
      next.delete(route.path)
    }
  })
  next.add('/dashboard')
  draftRoutes.value = [...next]
}

function toggleBlockFromInput(routes: MenuRoute[], value: string | number | boolean) {
  toggleBlock(routes, Boolean(value))
}

function toggleRouteFromInput(path: string, value: string | number | boolean) {
  toggleRoute(path, Boolean(value))
}

function blockChecked(routes: MenuRoute[]) {
  return routes.every((route) => draftAllowedRoutes.value.has(route.path) || isRouteLocked(route.path))
}

function blockIndeterminate(routes: MenuRoute[]) {
  const editableRoutes = routes.filter((route) => !isRouteLocked(route.path))
  if (!editableRoutes.length) return false
  const selectedCount = editableRoutes.filter((route) => draftAllowedRoutes.value.has(route.path)).length
  return selectedCount > 0 && selectedCount < editableRoutes.length
}

async function saveSelectedRole() {
  if (selectedIsAdminLevel.value) {
    ElMessage.info('管理员层级角色保持全局权限，无需保存覆盖配置')
    return
  }
  let routes = [...new Set(['/dashboard', ...draftRoutes.value.filter((path) => !adminOnlyRoutes.includes(path))])]
  const centerTabs = FORECAST_CENTER_TABS.map((tab) => tab.path)
  const hasCenter = routes.includes('/ycsj/center')
  const grantedTabs = centerTabs.filter((path) => routes.includes(path))
  if (grantedTabs.length && !hasCenter) routes = [...routes, '/ycsj/center']
  else if (hasCenter && !grantedTabs.length) routes = [...routes, ...centerTabs]
  else if (!hasCenter) routes = routes.filter((path) => !centerTabs.includes(path))
  routes = [...new Set(routes)]
  const defaultRoute = routes.includes(draftDefaultRoute.value) ? draftDefaultRoute.value : routes[0] ?? '/dashboard'
  const override = {
    defaultRoute,
    groups: [],
    routes,
    actions: [...draftActions.value]
  }
  try {
    await saveServerRoleAccessOverride(selectedRoleCode.value, override)
    authSyncStatus.value = 'synced'
    overrideRevision.value += 1
    ElMessage.success(`${roleLabels[selectedRoleCode.value]}权限矩阵已保存`)
  } catch (error) {
    // 后端失败只降级到本地暂存：成功提示必须在 try 分支内，否则失败也弹「已保存」误导管理员（#3265）
    authSyncStatus.value = 'local'
    saveRoleAccessOverride(selectedRoleCode.value, override)
    overrideRevision.value += 1
    ElMessage.warning(error instanceof Error ? `后端同步失败，未在服务端生效，已保存本地矩阵：${error.message}` : '后端同步失败，未在服务端生效，已保存本地矩阵')
  }
}

async function resetSelectedRole() {
  try {
    await resetServerRoleAccessOverride(selectedRoleCode.value)
    authSyncStatus.value = 'synced'
    overrideRevision.value += 1
    ElMessage.success(`${roleLabels[selectedRoleCode.value]}已恢复默认矩阵`)
  } catch (error) {
    // 后端失败只降级到本地覆盖：成功提示必须在 try 分支内（#3265）
    authSyncStatus.value = 'local'
    resetRoleAccessOverride(selectedRoleCode.value)
    overrideRevision.value += 1
    ElMessage.warning(error instanceof Error ? `后端同步失败，未在服务端生效，已恢复本地矩阵：${error.message}` : '后端同步失败，未在服务端生效，已恢复本地矩阵')
  }
  loadSelectedRole()
}

async function resetAllRoles() {
  try {
    await resetServerRoleAccessOverride()
    authSyncStatus.value = 'synced'
    overrideRevision.value += 1
    ElMessage.success('所有角色已恢复默认矩阵')
  } catch (error) {
    // 后端失败只降级到本地覆盖：成功提示必须在 try 分支内（#3265）
    authSyncStatus.value = 'local'
    resetRoleAccessOverride()
    overrideRevision.value += 1
    ElMessage.warning(error instanceof Error ? `后端同步失败，未在服务端生效，已恢复本地矩阵：${error.message}` : '后端同步失败，未在服务端生效，已恢复本地矩阵')
  }
  loadSelectedRole()
}

function routeScopeLabel(roleCode: RoleCode) {
  if (isAdminLevelRole(roleCode)) return '全部'
  const rule = getEffectiveAccessRule(roleCode)
  const groupCount = rule.groups?.length ?? 0
  const routeCount = rule.routes?.length ?? 0
  return groupCount ? `${groupCount}组 + ${routeCount}页` : `${routeCount}页`
}

function getSubjectTypeLabel(subjectType: keyof typeof subjectTypeLabels) {
  return subjectTypeLabels[subjectType]
}

function buildModuleAccess(module: RegionBusinessModule, roleCode: RoleCode): RegionModuleAccess {
  return {
    module,
    accessRoutes: isAdminLevelRole(roleCode)
      ? module.entryRoutes.map((route) => route.path)
      : module.accessRoutesByRole?.[roleCode] ?? [],
    landingRoutes: module.roleLandingRoutes?.[roleCode] ?? []
  }
}

function accessStatusLabel(access: RegionModuleAccess) {
  if (isAdminLevelRole(selectedRoleCode.value)) return '管理员可见'
  if (access.accessRoutes.length) return `${access.accessRoutes.length} 个入口`
  if (access.landingRoutes.length) return '仅落地规则页'
  return '未开放'
}

function accessStatusType(access: RegionModuleAccess): TagType {
  if (isAdminLevelRole(selectedRoleCode.value)) return 'danger'
  if (access.accessRoutes.length) return 'success'
  if (access.landingRoutes.length) return 'warning'
  return 'info'
}

function moduleStageLabel(stage: RegionBusinessModule['stage']) {
  const labels: Record<RegionBusinessModule['stage'], string> = {
    active: '已启用',
    trial: '样板建设',
    planned: '规划中'
  }
  return labels[stage]
}

function regionStatusType(status: RegionRuleSet['spotRuleStatus']): TagType {
  const types: Record<RegionRuleSet['spotRuleStatus'], TagType> = {
    generic: 'primary',
    draft: 'warning',
    trial: 'warning',
    active: 'success',
    'to-be-customized': 'info'
  }
  return types[status]
}
</script>

<template>
  <div class="permission-page">
    <section class="permission-hero">
      <div>
        <div class="hero-kicker">
          <ShieldCheck :size="16" />
          <span>管理员层级</span>
        </div>
        <p>角色、人员、菜单和操作权限在这里统一维护。</p>
      </div>
      <div class="hero-metrics">
        <div>
          <strong>{{ matrixStats.roles }}</strong>
          <span>角色</span>
        </div>
        <div>
          <strong>{{ matrixStats.users }}</strong>
          <span>人员</span>
        </div>
        <div>
          <strong>{{ matrixStats.routes }}</strong>
          <span>页面</span>
        </div>
        <div>
          <strong>{{ matrixStats.adminRoles }}</strong>
          <span>管理层级</span>
        </div>
      </div>
    </section>

    <el-segmented v-model="section" :options="MATRIX_SECTIONS" class="section-nav" />

    <section v-show="section === 'roles'" class="matrix-layout">
      <aside class="role-list">
        <button
          v-for="roleCode in roleCodes"
          :key="roleCode"
          :class="['role-item', { active: selectedRoleCode === roleCode }]"
          type="button"
          @click="selectedRoleCode = roleCode"
        >
          <span>
            <strong>{{ roleLabels[roleCode] }}</strong>
            <small>{{ directoryUsers.filter((user) => user.roleCode === roleCode).length }} 人</small>
          </span>
          <el-tag v-if="isAdminLevelRole(roleCode)" size="small" type="danger">全局</el-tag>
          <el-tag v-else-if="accessOverrides[roleCode]" size="small" type="warning">已配置</el-tag>
        </button>
      </aside>

      <section class="matrix-panel">
        <div class="panel-heading">
          <div>
            <div class="section-kicker">
              <SlidersHorizontal :size="16" />
              <span>{{ roleLabels[selectedRoleCode] }}</span>
            </div>
            <h3>{{ selectedIsAdminLevel ? '全局管理员权限' : '业务角色权限' }}</h3>
          </div>
          <div class="panel-actions">
            <el-tag :type="authSyncStatus === 'synced' ? 'success' : 'warning'" :title="authDatabaseFile">
              {{ authSyncLabel }}
            </el-tag>
            <el-tag v-if="selectedIsAdminLevel" type="danger">
              <Lock :size="13" />
              全部可见
            </el-tag>
            <el-tag v-else-if="selectedHasOverride" type="warning">使用本地配置</el-tag>
            <el-button :icon="RotateCcw" @click="resetSelectedRole">恢复默认</el-button>
            <el-button :icon="Save" type="primary" @click="saveSelectedRole">保存矩阵</el-button>
          </div>
        </div>

        <div class="config-strip">
          <label>
            <span>默认进入页面</span>
            <el-select v-model="draftDefaultRoute" :disabled="selectedIsAdminLevel" filterable>
              <el-option
                v-for="route in allowedDefaultOptions"
                :key="route.path"
                :label="`${route.block} / ${route.title}`"
                :value="route.path"
              />
            </el-select>
          </label>
          <label>
            <span>操作权限</span>
            <el-select v-model="draftActions" :disabled="selectedIsAdminLevel" multiple collapse-tags collapse-tags-tooltip>
              <el-option v-for="action in actionOptions" :key="action" :label="action" :value="action" />
            </el-select>
          </label>
        </div>

        <div class="route-toolbar">
          <el-input
            v-model="routeKeyword"
            clearable
            placeholder="按页面名或路径筛选（如「申报」或 /xhjy）"
            class="route-search"
          />
          <span class="route-count">
            共 {{ menuRoutes.length }} 个页面 · 已授权 {{ draftRoutes.length }}
          </span>
        </div>

        <!-- 折叠而非平铺：73 条开关全展开约 2500px，页面要拉很久。折叠头带「已开 N/M」，
             信息不藏死；搜索时自动展开命中分组（见 script 里的 watch）。 -->
        <el-collapse v-model="activeBlocks" class="route-collapse">
          <el-collapse-item v-for="group in routesByBlock" :key="group.block" :name="group.block">
            <template #title>
              <div class="route-group-title">
                <strong>{{ group.block }}</strong>
                <span class="route-group-count">
                  已开 {{ blockGrantedCount(group.routes) }}/{{ group.routes.length }}
                </span>
                <el-checkbox
                  :model-value="blockChecked(group.routes)"
                  :indeterminate="blockIndeterminate(group.routes)"
                  :disabled="selectedIsAdminLevel"
                  @click.stop
                  @update:model-value="toggleBlockFromInput(group.routes, $event)"
                >
                  全选
                </el-checkbox>
              </div>
            </template>
            <div class="route-grid">
              <div v-for="route in group.routes" :key="route.path" class="route-row">
                <div>
                  <strong>{{ route.title }}</strong>
                  <small>{{ route.path }}</small>
                </div>
                <el-switch
                  :model-value="draftAllowedRoutes.has(route.path)"
                  :disabled="isRouteLocked(route.path)"
                  @update:model-value="toggleRouteFromInput(route.path, $event)"
                />
              </div>
            </div>
          </el-collapse-item>
        </el-collapse>
        <p v-if="!routesByBlock.length" class="route-empty">没有匹配「{{ routeKeyword }}」的页面。</p>
      </section>
    </section>

    <section v-show="section === 'regions'" class="region-access-panel">
      <div class="people-heading">
        <div>
          <div class="section-kicker">
            <MapPin :size="16" />
            <span>地区业务权限矩阵</span>
          </div>
          <h3>地区入口</h3>
          <p>{{ roleLabels[selectedRoleCode] }}作为独立角色，按当前选择地区匹配业务入口。</p>
        </div>
        <el-tag type="primary">角色不绑定地区</el-tag>
      </div>

      <el-table :data="regionalAccessRows" border height="430">
        <el-table-column label="地区" min-width="170">
          <template #default="{ row }">
            <strong>{{ row.region.name }}</strong>
            <small class="table-sub">{{ row.region.gridLabel }} · {{ row.region.regionGroup }}</small>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="regionStatusType(row.region.ruleSet.spotRuleStatus)" size="small">
              {{ getRegionStatusLabel(row.region.ruleSet.spotRuleStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="专属业务模块" min-width="250">
          <template #default="{ row }">
            <div v-if="row.modules.length" class="module-tags">
              <span v-for="module in row.modules" :key="module.id">
                <Layers :size="13" />
                {{ module.title }}
                <em>{{ moduleStageLabel(module.stage) }}</em>
              </span>
            </div>
            <span v-else class="muted-cell">建设中</span>
          </template>
        </el-table-column>
        <el-table-column label="当前角色入口" min-width="330">
          <template #default="{ row }">
            <div v-if="row.moduleAccesses.length" class="regional-access-list">
              <div v-for="access in row.moduleAccesses" :key="access.module.id" class="regional-access-item">
                <div>
                  <strong>{{ access.module.title }}</strong>
                  <small>{{ access.accessRoutes.length ? access.accessRoutes.join(' / ') : '无专属业务页' }}</small>
                </div>
                <el-tag :type="accessStatusType(access)" size="small">{{ accessStatusLabel(access) }}</el-tag>
              </div>
            </div>
            <span v-else class="muted-cell">未接入专属模块，仅保留通用交易与规则框架</span>
          </template>
        </el-table-column>
      </el-table>
      <p class="matrix-note">
        地区专属模块由地区注册表控制；权限矩阵只决定当前角色能否进入对应入口。未定制地区保持建设中，不复用云南交易逻辑。
      </p>
    </section>

    <section v-show="section === 'directory'" class="people-panel">
      <div class="people-heading">
        <div>
          <div class="section-kicker">
            <Users :size="16" />
            <span>人员矩阵</span>
          </div>
          <h3>认证目录人员</h3>
        </div>
        <el-button :icon="RotateCcw" @click="resetAllRoles">恢复全部默认</el-button>
      </div>
      <el-table :data="directoryUsers" border>
        <el-table-column prop="displayName" label="人员" width="140" />
        <el-table-column label="角色" width="130">
          <template #default="{ row }">
            <el-tag :type="isAdminLevelRole(row.roleCode) ? 'danger' : 'info'">{{ row.role }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="主体" min-width="220">
          <template #default="{ row }">
            <strong>{{ row.subjectName }}</strong>
            <small class="table-sub">{{ getSubjectTypeLabel(row.subjectType) }} · {{ row.area }}</small>
          </template>
        </el-table-column>
        <el-table-column label="默认页" min-width="190">
          <template #default="{ row }">
            {{ getEffectiveAccessRule(row.roleCode).defaultRoute }}
          </template>
        </el-table-column>
        <el-table-column label="页面范围" width="120">
          <template #default="{ row }">
            {{ routeScopeLabel(row.roleCode) }}
          </template>
        </el-table-column>
        <el-table-column label="操作权限" min-width="260">
          <template #default="{ row }">
            <div class="action-tags">
              <span v-for="action in getEffectiveAccessRule(row.roleCode).actions" :key="action">{{ action }}</span>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped>
/* 作为「用户与权限」的 tab 内容渲染：不再自带整页高度/内边距/底色，
   否则会在宿主页的容器里叠出第二层背景与多余留白。 */
.permission-page {
  color: var(--text);
}

.permission-hero,
.matrix-layout,
.region-access-panel,
.people-panel {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.permission-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px;
  gap: 18px;
  padding: 20px;
  background: linear-gradient(135deg, var(--panel) 0%, var(--primary-tint) 54%, var(--panel-sub) 100%);
}

.hero-kicker,
.section-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--primary);
  font-size: var(--font-md);
  font-weight: 650;
}

.permission-hero h2,
.panel-heading h3,
.people-heading h3 {
  margin: 7px 0 6px;
  color: var(--text);
  letter-spacing: 0;
}

.permission-hero h2 {
  font-size: var(--font-28);
}

.permission-hero p {
  margin: 0;
  color: var(--text-soft);
}

.hero-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.hero-metrics div {
  display: flex;
  min-height: 88px;
  flex-direction: column;
  justify-content: center;
  padding: 12px;
  border: 1px solid var(--primary-tint-border);
  border-radius: 8px;
  background: var(--panel);
}

.hero-metrics strong {
  font-size: var(--font-24);
  color: var(--primary);
}

.hero-metrics span {
  margin-top: 4px;
  color: var(--muted);
  font-size: var(--font-sm);
}

.matrix-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 0;
  margin-top: 14px;
  overflow: hidden;
}

.role-list {
  padding: 12px;
  border-right: 1px solid var(--line);
  background: var(--panel-sub);
}

.role-item {
  display: flex;
  width: 100%;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.role-item.active {
  border-color: var(--primary);
  box-shadow: inset 3px 0 0 var(--primary);
}

.role-item strong,
.role-item small {
  display: block;
}

.role-item small {
  margin-top: 3px;
  color: var(--muted);
}

.matrix-panel {
  padding: 16px;
}

.panel-heading,
.people-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.panel-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.panel-actions :deep(.el-tag__content) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.config-strip {
  display: grid;
  grid-template-columns: minmax(0, 260px) minmax(0, 1fr);
  gap: 12px;
  margin: 14px 0;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-sub);
}

.config-strip label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  color: var(--text-soft);
  font-size: var(--font-md);
  font-weight: 650;
}

.section-nav { align-self: flex-start; margin-bottom: 2px; }

.route-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.route-search { max-width: 360px; }
.route-count { font-size: var(--font-12-5); color: var(--el-text-color-secondary); }

/* 折叠头：block 名 + 已开计数 + 全选，三者一行排开 */
.route-group-title {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding-right: 12px;
}
.route-group-title strong { font-size: var(--font-md); font-weight: 650; }
.route-group-count {
  margin-right: auto;
  font-size: var(--font-sm);
  color: var(--el-text-color-secondary);
}
.route-collapse :deep(.el-collapse-item__content) { padding-bottom: 0; }
.route-empty { margin: 12px 2px; font-size: var(--font-md); color: var(--el-text-color-secondary); }

.route-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.route-group {
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}

.route-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  background: var(--panel-sub);
}

.route-grid {
  display: grid;
  gap: 0;
}

.route-row {
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-top: 1px solid var(--line-faint);
}

.route-row strong,
.route-row small {
  display: block;
}

.route-row small {
  margin-top: 3px;
  color: var(--muted);
}

.region-access-panel,
.people-panel {
  margin-top: 14px;
  padding: 16px;
}

.table-sub {
  display: block;
  margin-top: 4px;
  color: var(--muted);
}

.module-tags,
.regional-access-list,
.regional-access-item {
  display: grid;
  gap: 8px;
}

.module-tags span {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--primary-tint);
  color: var(--primary-strong);
  font-size: var(--font-sm);
}

.module-tags em {
  color: var(--muted);
  font-style: normal;
}

.regional-access-item {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel-sub);
}

.regional-access-item strong,
.regional-access-item small {
  display: block;
}

.regional-access-item small {
  margin-top: 3px;
  color: var(--muted);
  line-height: 1.4;
}

.muted-cell {
  color: var(--muted);
}

.matrix-note {
  margin: 12px 0 0;
  color: var(--muted);
  line-height: 1.6;
}

.action-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.action-tags span {
  padding: 3px 7px;
  border-radius: 5px;
  background: var(--panel-sub);
  color: var(--text-soft);
  font-size: var(--font-sm);
}

@media (max-width: 1180px) {
  .permission-hero,
  .matrix-layout,
  .route-groups,
  .config-strip {
    grid-template-columns: 1fr;
  }

  .role-list {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
}

@media (max-width: 720px) {
  .permission-page {
    padding: 10px;
  }

  .permission-hero {
    padding: 14px;
  }

  .hero-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .panel-heading,
  .people-heading {
    flex-direction: column;
  }
}

@media (max-width: 768px) {
  .permission-hero { grid-template-columns: 1fr; }
  .matrix-layout { grid-template-columns: 1fr; }
  .route-groups { grid-template-columns: 1fr; }
}
</style>
