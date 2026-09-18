<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Bell, ChevronDown, KeyRound, LogOut, Menu, RefreshCw, Sparkles } from 'lucide-vue-next'
import { applyInsightWorkspaceNavigation, navigation, type NavItem } from '../data/navigation'
import { getRegionStatusLabel } from '../data/regions'
import { getDashboard, type Notice } from '@/services/dashboard/dashboardData'
import { getCurrentUser, getInfo, logout, type AuthUser } from '@/services/auth'
import { refreshCompanyOptions } from '@/services/company/companyApi'
import {
  canSwitchCompany,
  companySelectionEmpty,
  currentCompany,
  selectableCompanies,
  selectedCompanyId,
  setCurrentCompanyId,
  type CompanyOption
} from '@/services/company/companyContext'
import { currentRegion, selectedRegionId, setCurrentRegionId } from '@/services/region/regionContext'
import { resolveRegionSwitchRoute } from '@/services/region/regionNavigation'
import {
  activeStanceKey,
  activeStanceType,
  isMultiStance,
  setActiveStance,
  stanceKeyOf,
  stances
} from '@/services/stance/stanceContext'
import { filterNavigationForStance, isPathAvailableInStance, resolveStanceSwitchRoute } from '@/services/stance/stanceNavigation'
import {
  canAccessPath,
  filterNavigationForUser,
  firstAccessiblePath,
  getDecisionGateHint,
  isPathAvailableInRegion,
  subjectTypeLabels
} from '@/services/governance'
import { AiSidebar, AiOrbLauncher } from '@/features/aiSidebar'
// 价带卡（峰/平/谷徽标 + 参考价）按验收反馈先隐藏；恢复时解开此处与模板中的 topbar-ticker 块
// import PriceTicker from '../components/PriceTicker.vue'
import RegionSwitcher from '@/components/region/RegionSwitcher.vue'
import RegionMigrationTip from '@/components/region/RegionMigrationTip.vue'
import AlertCenter from '../components/AlertCenter.vue'
import ThemeSwitcher from '../components/ThemeSwitcher.vue'
import CommandPalette from '../components/CommandPalette.vue'
import PageHelpTip from '../components/common/PageHelpTip.vue'
import { useTheme } from '../composables/useTheme'

const router = useRouter()
const route = useRoute()
const collapsed = ref(false)
// AI 面板只剩「解读」一个模式（导航助手已下架，见 src/attic/ai-navigator-panel/）：
// 面板由业务页「✨AI 解读」触发，顶栏这颗按钮改为直接进统一工作台。
const isMobile = ref(false)
const mobileMenuOpen = ref(false)
const currentUser = ref<AuthUser>(getCurrentUser())
const notices = ref<Notice[]>([])
// 公告是否为模拟数据：由服务端 provenance 判定，不在前端写死。
const noticesAreMock = ref(false)
const accessRevision = ref(0)
const companyOptionsLoading = ref(false)

// 侧边栏 el-menu 颜色需随主题变化(el-menu 吃 prop 而非 CSS 变量)。
// classic 档取值与改造前 props 完全一致,保证原版像素不变。
const { theme } = useTheme()
const menuColors = computed(() => {
  switch (theme.value) {
    case 'arc':
      return { bg: '#0a1322', text: '#8fa3bd', active: '#e6f6ff' }
    case 'neon':
      return { bg: '#04060f', text: '#9fc4e8', active: '#22d3ee' }
    case 'paper':
      return { bg: '#2a2620', text: '#cfc6b4', active: '#f3eee3' }
    default:
      return { bg: '#172b3a', text: '#c9d7e2', active: '#ffffff' }
  }
})

const activePath = computed(() => route.path)
const visibleNavigation = computed(() => {
  // 订阅用：权限/地区 revision 变化时让本 computed 重算
  const _accessRevision = accessRevision.value
  // 立场视图层（#2196）：角色×地区过滤后，再按当前立场出工作台（共享页恒可见，
  // 组合/集团视角全量；专职立场只看共享页 + 本立场专属页）。
  // 地区工作区装配（dljy#2995）：已启用装配型洞察工作区且有已交付页时，「市场洞察」
  // 分组 children 被原位替换；否则沿用现有入口，侧边栏与现状完全一致。
  const assembled = applyInsightWorkspaceNavigation(navigation, currentRegion.value.id)
  const byRoleAndRegion = filterNavigationForUser(assembled, currentUser.value, currentRegion.value.id)
  return withCurrentRegionTradingTitle(filterNavigationForStance(byRoleAndRegion, activeStanceType.value))
})
const currentGate = computed(() => getDecisionGateHint(route.path, currentUser.value))
const subjectTypeLabel = computed(() => subjectTypeLabels[currentUser.value.subjectType])
const selectedRegionModel = computed({
  get: () => selectedRegionId.value,
  set: (value: string) => switchRegion(value)
})
const regionStatusLabel = computed(() => getRegionStatusLabel(currentRegion.value.ruleSet.spotRuleStatus))
const topbarCompanySwitchable = computed(() => canSwitchCompany(currentUser.value))

const pageTitle = computed(() => {
  for (const item of visibleNavigation.value) {
    if (item.path === route.path) return item.title
    const child = item.children?.find((sub) => sub.path === route.path)
    if (child) return child.title
  }
  return String(route.meta.title ?? '首页')
})

async function signOut() {
  await logout()
  router.push('/login')
}

// 会话管理并入 ADMIN-only 的「用户与会话」后，本入口对非管理员只会被守卫弹回首页
// 故按同一套 canAccessPath 判定显隐，不再留一个点了没反应的菜单项（不硬编码角色）。
const canOpenSecurityCenter = computed(() => canAccessPath('/system/accounts', currentUser.value))

function openSecurityCenter() {
  router.push({ path: '/system/accounts', query: { tab: 'sessions' } })
}

function switchRegion(regionId: string) {
  if (regionId === selectedRegionId.value) return
  setCurrentRegionId(regionId)
  // 统一解析（dljy#2995）：洞察规范页按 目标地区支持/已登记未交付/未登记 三态落位，
  // 其余路径行为与旧版一致；带 query 的落点（原地停留保留日期等业务参数）。
  const next = resolveRegionSwitchRoute(regionId, currentUser.value, route.path, route.query)
  if (next.path !== route.path) {
    router.replace(next)
  }
}

function companyOptionLabel(company: CompanyOption) {
  return company.tier === 'GROUP' ? `${company.name}（集团）` : company.name
}

function switchCompany(companyId: string) {
  if (!setCurrentCompanyId(companyId)) {
    ElMessage.warning('无权切换到该公司')
  }
}

function stanceOptionLabel(stance: (typeof stances.value)[number]) {
  const label = subjectTypeLabels[stance.subjectType] ?? stance.subjectType
  return stance.crossView ? `${label}视角` : label
}

function switchStance(key: string) {
  if (key === activeStanceKey.value) return
  const next = stances.value.find((s) => stanceKeyOf(s) === key)
  if (!next || !setActiveStance(key)) {
    ElMessage.warning('该立场不在当前账号的允许集合内')
    return
  }
  ElMessage.success(`已切换到${stanceOptionLabel(next)}`)
  // 立场切换后的路由解析（#2196）：当前页在新立场仍可见则停留（共享页/系统页不踢人），
  // 否则落该用户的默认工作台。
  const nextPath = resolveStanceSwitchRoute(next.subjectType, currentUser.value, route.path)
  if (nextPath !== route.path) {
    router.replace(nextPath)
  }
}

async function refreshTopbarCompanyOptions() {
  if (!topbarCompanySwitchable.value) return
  companyOptionsLoading.value = true
  try {
    await refreshCompanyOptions()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载公司列表失败')
  } finally {
    companyOptionsLoading.value = false
  }
}

function updateViewportMode() {
  isMobile.value = window.matchMedia('(max-width: 768px)').matches
  if (!isMobile.value) {
    mobileMenuOpen.value = false
  }
}

function toggleNavigation() {
  if (isMobile.value) {
    mobileMenuOpen.value = !mobileMenuOpen.value
    return
  }
  collapsed.value = !collapsed.value
}

function closeMobileMenu() {
  mobileMenuOpen.value = false
}

function refreshAccessMatrix() {
  accessRevision.value += 1
  currentUser.value = getCurrentUser()
  if (
    !canAccessPath(route.path, currentUser.value)
    || !isPathAvailableInRegion(route.path, currentRegion.value.id)
    || !isPathAvailableInStance(route.path, activeStanceType.value)
  ) {
    router.replace(firstAccessiblePath(currentUser.value, currentRegion.value.id))
  }
}

function withCurrentRegionTradingTitle(items: NavItem[]): NavItem[] {
  return items.map((item) => ({
    ...item,
    title: resolveNavigationTitle(item.path, item.title),
    children: item.children ? withCurrentRegionTradingTitle(item.children) : undefined
  }))
}

function resolveNavigationTitle(path: string, fallback: string) {
  if (path !== '/xhjy/region') return fallback
  const region = currentRegion.value
  return region.kind === 'template' ? `${region.shortName}通用交易` : `${region.shortName}交易`
}

// B1 命令面板：Cmd/Ctrl+K 全局调出
const showCommandPalette = ref(false)
function onCmdK(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    showCommandPalette.value = !showCommandPalette.value
  }
}

onMounted(async () => {
  updateViewportMode()
  window.addEventListener('resize', updateViewportMode)
  window.addEventListener('governance-access-changed', refreshAccessMatrix)
  window.addEventListener('keydown', onCmdK)

  try {
    const [info, dashboard] = await Promise.all([getInfo(), getDashboard()])
    currentUser.value = info.user
    notices.value = dashboard.notices
    noticesAreMock.value = dashboard.provenance?.realDataConnected === false
    await refreshTopbarCompanyOptions()
  } catch (error) {
    await logout()
    ElMessage.error(error instanceof Error ? error.message : '登录状态已失效，请重新登录')
    router.replace({ path: '/login', query: { redirect: route.fullPath } })
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', updateViewportMode)
  window.removeEventListener('governance-access-changed', refreshAccessMatrix)
  window.removeEventListener('keydown', onCmdK)
})

watch(
  () => route.fullPath,
  () => {
    closeMobileMenu()
  }
)

watch(
  () => currentRegion.value.id,
  (regionId) => {
    // 路径仍可用（有权限且该地区放行）时不二次跳转，避免 landing 页来回弹；
    // 不可用时与 switchRegion 走同一个统一解析（含洞察页的原地停留/默认入口/未登记语义）。
    if (canAccessPath(route.path, currentUser.value) && isPathAvailableInRegion(route.path, regionId)) return
    router.replace(resolveRegionSwitchRoute(regionId, currentUser.value, route.path, route.query))
  }
)
</script>

<template>
  <div :class="['app-layout', { 'mobile-nav-open': mobileMenuOpen }]">
    <button
      v-if="isMobile && mobileMenuOpen"
      class="mobile-menu-mask"
      type="button"
      aria-label="关闭导航"
      @click="closeMobileMenu"
    ></button>

    <aside :class="['sidebar', { collapsed: !isMobile && collapsed, 'mobile-open': mobileMenuOpen }]">
      <div class="brand">
        <div class="brand-mark">电</div>
        <div v-if="isMobile || !collapsed" class="brand-copy">
          <strong>电力交易辅助</strong>
          <span>决策支持系统</span>
        </div>
      </div>

      <el-scrollbar class="menu-scroll">
        <el-menu
          :default-active="activePath"
          :collapse="!isMobile && collapsed"
          :background-color="menuColors.bg"
          :text-color="menuColors.text"
          :active-text-color="menuColors.active"
          router
          @select="closeMobileMenu"
        >
          <template v-for="item in visibleNavigation" :key="item.path">
            <el-sub-menu v-if="item.children" :index="item.path">
              <template #title>
                <component :is="item.icon" class="menu-icon" />
                <span>{{ item.title }}</span>
                <el-tag v-if="item.demo" size="small" type="info" effect="plain" class="menu-demo-tag">演示</el-tag>
              </template>
              <el-menu-item v-for="child in item.children" :key="child.path" :index="child.path">
                <component :is="child.icon" class="menu-icon" />
                <span>{{ child.title }}</span>
                <el-tag v-if="child.demo" size="small" type="info" effect="plain" class="menu-demo-tag">演示</el-tag>
              </el-menu-item>
            </el-sub-menu>
            <el-menu-item v-else :index="item.path">
              <component :is="item.icon" class="menu-icon" />
              <span>{{ item.title }}</span>
              <el-tag v-if="item.demo" size="small" type="info" effect="plain" class="menu-demo-tag">演示</el-tag>
            </el-menu-item>
          </template>
        </el-menu>
      </el-scrollbar>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <div class="topbar-left">
          <el-button :icon="Menu" text @click="toggleNavigation" />
          <div class="topbar-title">
            <div class="breadcrumb">首页 / {{ pageTitle }}</div>
            <div class="topbar-title-row">
              <h1>{{ pageTitle }}</h1>
              <!-- 页面核心说明「?」悬浮卡（#848）：按当前路由 name 查注册表，有内容才渲染 -->
              <PageHelpTip />
            </div>
          </div>
          <!-- 价带卡先隐藏（验收反馈），恢复时解开本块并还原上方 import
          <div class="topbar-ticker">
            <PriceTicker />
          </div>
          -->
          <div class="context-cards governance-strip">
            <el-tooltip placement="bottom-start" effect="light">
              <template #content>
                <div class="ctx-tip">
                  <strong>{{ currentRegion.name }}</strong>
                  <span>{{ currentRegion.gridLabel }} · {{ currentRegion.regionGroup }}</span>
                  <span>结算模式:{{ currentRegion.ruleSet.settlementModel }}</span>
                </div>
              </template>
              <div class="ctx-card ctx-card-rule">
                <small>交易体系</small>
                <strong>{{ currentRegion.ruleSet.label }}</strong>
              </div>
            </el-tooltip>
            <el-tooltip placement="bottom-start" effect="light">
              <template #content>
                <div class="ctx-tip">
                  <strong>{{ currentGate.label }}</strong>
                  <span>{{ currentGate.level }} · 复核 {{ currentGate.reviewer }}</span>
                  <span>{{ currentGate.note }}</span>
                </div>
              </template>
              <div class="ctx-card">
                <small>运行状态</small>
                <strong>{{ regionStatusLabel }} · {{ currentGate.label }}</strong>
              </div>
            </el-tooltip>
          </div>
        </div>

        <div class="topbar-actions">
          <RegionSwitcher v-model="selectedRegionModel" />
          <el-select
            v-if="isMultiStance"
            class="stance-switcher"
            :model-value="activeStanceKey"
            title="切换作业立场（发电/售电/储能…）"
            size="small"
            @update:model-value="switchStance"
          >
            <el-option
              v-for="stance in stances"
              :key="stanceKeyOf(stance)"
              :label="stanceOptionLabel(stance)"
              :value="stanceKeyOf(stance)"
            >
              <span class="stance-option">
                <span>{{ stanceOptionLabel(stance) }}</span>
                <el-tag v-if="stance.crossView" size="small" type="warning" effect="plain">切换视角</el-tag>
                <el-tag v-else size="small" type="success" effect="plain">主立场</el-tag>
              </span>
            </el-option>
          </el-select>
          <el-select
            v-if="topbarCompanySwitchable"
            class="company-switcher"
            :model-value="selectedCompanyId"
            :loading="companyOptionsLoading"
            :placeholder="companySelectionEmpty ? '请选择公司' : '选择公司'"
            :title="companySelectionEmpty ? '请选择公司' : currentCompany.name"
            size="small"
            @update:model-value="switchCompany"
          >
            <el-option
              v-for="company in selectableCompanies"
              :key="company.companyId"
              :label="companyOptionLabel(company)"
              :value="company.companyId"
            >
              <span class="company-option">
                <span>{{ company.name }}</span>
                <el-tag v-if="company.tier === 'GROUP'" size="small" type="warning" effect="plain">集团</el-tag>
              </span>
            </el-option>
          </el-select>
          <el-button class="ai-nav-btn" :icon="Sparkles" round @click="router.push('/ai-agent')">AI 助手</el-button>

          <span class="action-divider" aria-hidden="true" />

          <el-popover placement="bottom-end" width="320" trigger="click">
            <template #reference>
              <el-button class="icon-action" :icon="Bell" circle title="通知" />
            </template>
            <div class="notice-list">
              <div v-if="noticesAreMock" class="notice-mock-hint">
                模拟数据 · 平台公告源尚未接入，以下为示例内容
              </div>
              <div v-for="notice in notices" :key="notice.id" class="notice-item">
                <span>{{ notice.level }}</span>
                <strong>{{ notice.title }}</strong>
                <small>{{ notice.time }}</small>
              </div>
            </div>
          </el-popover>
          <AlertCenter />
          <ThemeSwitcher />
          <el-button class="icon-action" :icon="RefreshCw" circle title="刷新页面" @click="router.go(0)" />

          <span class="action-divider" aria-hidden="true" />

          <el-dropdown>
            <button class="user-button">
              <span class="user-avatar">{{ currentUser.displayName.slice(0, 1) }}</span>
              <span class="user-meta">
                <strong>{{ currentUser.displayName }}</strong>
                <span>{{ currentUser.role }}</span>
              </span>
              <ChevronDown :size="15" class="user-caret" />
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <div class="user-card">
                  <strong>{{ currentUser.role }}（{{ currentUser.roleGroup }}）</strong>
                  <span>{{ subjectTypeLabel }} · {{ currentUser.subjectName }}</span>
                  <span class="user-card-note">{{ currentUser.perspective }}</span>
                </div>
                <el-dropdown-item v-if="canOpenSecurityCenter" :icon="KeyRound" @click="openSecurityCenter">安全中心</el-dropdown-item>
                <el-dropdown-item :icon="LogOut" @click="signOut">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <main class="page-shell">
        <!-- keep-alive：切回页面保留筛选/图表状态与「在途智能体对话」（带定时器的视图自行在
             onActivated/onDeactivated 中恢复/暂停轮询）；out-in 淡入过渡消除硬切换。
             :max=20 是「应用内切页保活」经验容量（#565）：智能体对话页（工作台/政策情报/晨报/
             体检等）离开时 deactivate 而非 unmount，SSE 悬浮请求与 messages 均保留，切回即续看；
             20 覆盖单会话常见页面访问量，避免对话页在正常浏览中被 LRU 逐出、丢失在途那一轮。
             关标签/刷新/换设备的彻底保活属服务端后台化（阶段二 #566），前端 KeepAlive 不覆盖。 -->
        <RouterView v-slot="{ Component }">
          <Transition name="page-fade" mode="out-in">
            <KeepAlive :max="20">
              <component :is="Component" />
            </KeepAlive>
          </Transition>
        </RouterView>
      </main>
    </section>

    <AiSidebar />
    <!-- 右下角液态玻璃 AI 球：全站 AI 侧边栏入口，有解读能力的页面直接解读本页（WebGPU 渲染，不支持时 CSS 降级） -->
    <AiOrbLauncher />
    <RegionMigrationTip />
    <CommandPalette v-model="showCommandPalette" :user="currentUser" />
  </div>
</template>

<style scoped>
/* 路由切换淡入过渡（配合 RouterView 的 out-in 模式） */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.16s ease;
}
.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}

/* 侧边栏「演示」标签：标注 demo-only 菜单域（如全功能闭环企业 Mock 组） */
.menu-demo-tag {
  margin-left: 6px;
  height: 18px;
  padding: 0 5px;
  line-height: 16px;
  flex: 0 0 auto;
}
/* 折叠态仅留图标，隐藏演示标签避免溢出 */
.sidebar.collapsed .menu-demo-tag {
  display: none;
}

.ai-nav-btn {
  background: var(--ai-btn-bg);
  border: 0;
  color: var(--ai-btn-fg);
  font-weight: 600;
}
.ai-nav-btn:hover {
  opacity: 0.92;
}

.company-switcher {
  flex: 0 1 170px;
  width: 170px;
}

/* 立场切换器（#2193）：比公司切换器窄一档，多立场账号才渲染 */
.stance-switcher {
  flex: 0 0 120px;
  width: 120px;
}

.stance-option {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.company-option {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.company-option span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 顶栏标题组：面包屑 + 页面标题，可随空间收缩省略 */
.topbar-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
/* 标题行：h1 + 页面说明问号按钮（#848），问号不被 ellipsis 裁切 */
.topbar-title-row {
  display: flex;
  align-items: center;
  min-width: 0;
}
.topbar-title h1 {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
}

/* 动作区分组分隔线 */
.action-divider {
  flex: 0 0 auto;
  width: 1px;
  height: 22px;
  background: var(--line);
}

/* 统一图标按钮：通知 / 主题 / 刷新 等宽圆形 */
.icon-action {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
}

/* 用户控件：头像 + 姓名/角色，合并原 profile-chip 与下拉触发器 */
.user-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 8px 0 6px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.user-button:hover {
  border-color: var(--primary);
  background: var(--bg);
}
.user-avatar {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--primary);
  color: #fff;
  font-size: var(--font-tb-13);
  font-weight: 700;
}
.user-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  min-width: 0;
  max-width: 150px;
  line-height: 1.18;
}
.user-meta strong {
  max-width: 100%;
  font-size: var(--font-tb-13);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-meta span {
  max-width: 100%;
  color: var(--muted);
  font-size: var(--font-tb-11);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-caret {
  flex: 0 0 auto;
  color: var(--muted);
}

/* 用户下拉头部：承接原 profile-chip 的角色/主体/视角信息 */
.user-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 260px;
  margin: -5px -12px 4px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
}
.user-card strong {
  font-size: var(--font-md);
  color: var(--text);
}
.user-card span {
  font-size: var(--font-11-5);
  color: var(--muted);
  line-height: 1.45;
}

.context-cards {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* 空间吃紧时 tooltip 包裹层可收缩，由卡片内 ellipsis 兜底，防与动作区重叠 */
.context-cards > * {
  min-width: 0;
}

.ctx-card {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-width: 190px;
  padding: 3px 11px;
  border: 1px solid var(--chip-border);
  border-radius: 6px;
  background: var(--chip-bg);
  line-height: 1.25;
  cursor: default;
}

.ctx-card small {
  color: var(--chip-label);
  font-size: var(--font-tb-10);
}

.ctx-card strong {
  color: var(--chip-text);
  font-size: var(--font-tb-12-5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctx-tip {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 280px;
  font-size: var(--font-sm);
  line-height: 1.5;
}

.ctx-tip strong {
  color: var(--chip-text);
}

/* 渐进收缩：空间不足时按"价值低→先让位"顺序隐藏中段信息，动作区始终钉右不换行 */
@media (max-width: 1340px) {
  .context-cards {
    display: none;
  }
}
@media (max-width: 1140px) {
  .topbar-ticker {
    display: none;
  }
}
@media (max-width: 1024px) {
  /* 公司切换器收缩到 110px 腾位（el-select 的 width 控不了 wrapper，需 flex+max-width） */
  .company-switcher {
    flex: 0 1 110px;
    max-width: 110px;
    min-width: 0;
  }

  /* 立场切换器同步收缩（#2193），与公司切换器同节奏 */
  .stance-switcher {
    flex: 0 1 96px;
    max-width: 96px;
    min-width: 0;
  }

  .user-meta {
    display: none;
  }
  .user-caret {
    display: none;
  }
  .user-button {
    padding: 0 5px;
  }
}

/* ≤1280px：topbar-title 改横向（面包屑+标题同 1 行），避免 column 时独占两行。
   阈值 1280 非 1024：媒体查询按视口算，侧栏 236px 占位使 topbar 实际宽 < 视口。 */
@media (max-width: 1280px) {
  .topbar-title {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  .breadcrumb {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

/* ≤955px：公司切换器提前隐藏防挤换行；集团切换器维持 ≤850px */
@media (max-width: 955px) {
  .company-switcher {
    display: none;
  }
}

@media (max-width: 850px) {
  .stance-switcher {
    display: none;
  }
}

@media (max-width: 768px) {
  .company-switcher {
    display: none;
  }

  .stance-switcher {
    display: none;
  }
}

.topbar-ticker {
  display: flex;
  align-items: center;
  /* 价带不参与收缩：防「峰段/平段/谷段」徽标竖排换行 */
  flex: 0 0 auto;
}
</style>
