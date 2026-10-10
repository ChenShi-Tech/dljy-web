<script setup lang="ts">
// 用户与权限（/system/accounts）：账号目录、登录会话与权限矩阵本是同一件事的三面
// （谁能登录 / 谁正登录着 / 能干什么），原先是三个并列菜单项，合并为单页 tab。
//
// 权限口径统一为 ADMIN-only（governance.ts::adminOnlyRoutes）：原 /system/sessions 未列入
// adminOnlyRoutes、非管理员经 /system 组可见，合并后随本页收紧，方向是收紧，无越权风险。
// 注意 SessionManagementView 内部另有 isAdminLevel 分支（非管理员只看自己的会话），
// 该分支代码保留不动：页面级已挡在 ADMIN 之外，组件级判断作为纵深防御。
//
// tab 状态同步到 ?tab= query，旧路由 redirect 落到对应 tab。
//
// 已迁至平台后台（ChenShi-Tech/dljy#3464）：内部版「权限矩阵」（全局角色矩阵）由平台后台接管，
// 登记在 features/platformAdminMigration/registry.ts；该 tab 不渲染，tab 栏上方原位置显示提示与后台链接。
// 用户管理、会话管理照常。客户交付版不受影响。
import { defineAsyncComponent, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { hiddenEntriesOf, isTabHidden } from '@/features/platformAdminMigration/registry'
import MigratedToAdminNotice from '@/features/platformAdminMigration/MigratedToAdminNotice.vue'

const ALL_TABS = [
  { name: 'users', label: '用户管理', component: defineAsyncComponent(() => import('./UserManagementView.vue')) },
  { name: 'sessions', label: '会话管理', component: defineAsyncComponent(() => import('./SessionManagementView.vue')) },
  { name: 'permissions', label: '权限矩阵', component: defineAsyncComponent(() => import('./PermissionMatrixView.vue')) },
] as const

const TABS = ALL_TABS.filter((t) => !isTabHidden('accounts', t.name))
const MIGRATED_ENTRIES = hiddenEntriesOf('accounts')
const PAGE_SUB = MIGRATED_ENTRIES.length
  ? '账号目录与登录会话——「谁能登录 / 谁正登录着」两面（仅系统管理员可见）。'
  : '账号目录、登录会话与角色权限矩阵——「谁能登录 / 谁正登录着 / 能干什么」三面（仅系统管理员可见）。'

const TAB_NAMES = TABS.map((t) => t.name) as readonly string[]
const DEFAULT_TAB = TABS[0].name

const route = useRoute()
const router = useRouter()

function normalizeTab(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && TAB_NAMES.includes(value) ? value : DEFAULT_TAB
}

const activeTab = ref(normalizeTab(route.query.tab))

watch(
  () => route.query.tab,
  (raw) => {
    const next = normalizeTab(raw)
    if (next !== activeTab.value) activeTab.value = next
  },
)

function onTabChange(name: string | number) {
  const tab = String(name)
  if (normalizeTab(route.query.tab) === tab) return
  void router.replace({ query: { ...route.query, tab } })
}
</script>

<template>
  <div class="accounts-page">
    <header class="page-head">
      <h1>用户与权限</h1>
      <p class="sub">{{ PAGE_SUB }}</p>
    </header>

    <!-- 已迁至平台后台的 tab 不渲染，原位置（tab 栏上方）给出提示与后台链接（#3464） -->
    <MigratedToAdminNotice v-if="MIGRATED_ENTRIES.length" :entries="MIGRATED_ENTRIES" />

    <el-tabs v-model="activeTab" class="accounts-tabs" @tab-change="onTabChange">
      <el-tab-pane v-for="tab in TABS" :key="tab.name" :label="tab.label" :name="tab.name">
        <!-- 同「AI 工作室」：只渲染当前 tab + KeepAlive 缓存，非活动面板进 deactivated 而非常驻挂载 -->
        <KeepAlive>
          <component :is="tab.component" v-if="activeTab === tab.name" />
        </KeepAlive>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.accounts-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.page-head h1 {
  margin: 0;
  font-size: var(--font-20);
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.page-head .sub {
  margin: 4px 0 0;
  font-size: var(--font-md);
  color: var(--el-text-color-secondary);
}

.accounts-tabs :deep(.el-tab-pane) {
  padding: 0;
}
</style>
