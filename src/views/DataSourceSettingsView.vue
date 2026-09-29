<script setup lang="ts">
// 数据源接入设置（数据运维工作台 /data-ops/console?panel=data-source）：外部数据源凭据与采集运维的统一入口（#1896）。
//
// 2026-08-10 用户拍板（Epic #1893）：原先散落的「四川开放平台凭据」（本页）与「四川接入服务」
// （/sichuan-access，独立运维页）合并为单页多 tab，并拓展为「电网官方平台」通用框架
// 四川只是国网的一个省，后续网省加配置即接入。tab 三分：
//   电网官方平台 — 当前地区聚焦（凭据 + 采集运维合体）+ 全网就绪度概览
//   企业自建通道 — 企业方自建透传接口（中广核云南首个实例）
//   受控接入     — 授权网架 Provider 等需 Owner 交付的数据源
//
// tab 状态同步到 ?tab= query（宿主工作台用 ?panel= 另管一层，两级互不覆盖）：
// /sichuan-access 旧路由经两级 redirect 落到 official tab、刷新与深链保持位置。
// 子 tab 走 defineAsyncComponent + KeepAlive + v-if：进页只加载当前 tab 的 chunk，切走触发
// onDeactivated（运维面板据此停轮询，守 #1736），切回保留状态。
//
// 安全（沿用 #867/#1620 红线）：凭据仅服务端掩码存储、永不回明文、写清测仅 ADMIN/BOSS；
// #1925 起凭据按录入账号分记录，非本人连掩码不可见。整页仅 ADMIN/BOSS（governance adminOnlyRoutes）。
//
// 已迁至平台后台（ChenShi-Tech/dljy#3464）：内部版「电网官方平台」（接入点凭据 + 采集运维，全局生效）
// 由平台后台接管，登记在 features/platformAdminMigration/registry.ts；该子 tab 不渲染，默认落「企业自建
// 通道」，tab 栏上方原位置显示提示与后台链接（/sichuan-access 等旧深链因此也不会白屏）。客户交付版不受影响。
import { defineAsyncComponent, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { hiddenEntriesOf, isTabHidden } from '@/features/platformAdminMigration/registry'
import MigratedToAdminNotice from '@/features/platformAdminMigration/MigratedToAdminNotice.vue'

const ALL_TABS = [
  { name: 'official', label: '电网官方平台', component: defineAsyncComponent(() => import('./data-access/OfficialPlatformTab.vue')) },
  { name: 'enterprise', label: '企业自建通道', component: defineAsyncComponent(() => import('./data-access/EnterpriseAdapterTab.vue')) },
  { name: 'restricted', label: '受控接入', component: defineAsyncComponent(() => import('./data-access/RestrictedProviderTab.vue')) },
] as const

const TABS = ALL_TABS.filter((t) => !isTabHidden('data-source', t.name))
const MIGRATED_ENTRIES = hiddenEntriesOf('data-source')

const TAB_NAMES = TABS.map((t) => t.name) as readonly string[]
const DEFAULT_TAB = TABS[0].name

const route = useRoute()
const router = useRouter()

function normalizeTab(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && TAB_NAMES.includes(value) ? value : DEFAULT_TAB
}

const activeTab = ref(normalizeTab(route.query.tab))

// 外部改 query（旧路由 redirect、浏览器前进后退）时跟随；非法 tab 落默认值。
watch(
  () => route.query.tab,
  (raw) => {
    const next = normalizeTab(raw)
    if (next !== activeTab.value) activeTab.value = next
  },
)

// 用 replace 而非 push：tab 切换是页内视图切换，不该在浏览器历史里堆一串条目。
function onTabChange(name: string | number) {
  const tab = String(name)
  if (normalizeTab(route.query.tab) === tab) return
  void router.replace({ query: { ...route.query, tab } })
}
</script>

<template>
  <div class="ds-settings">
    <header class="page-head">
      <p class="sub">
        各数据源的凭据录入、连通测试与采集运维统一在此完成。凭据仅保存在服务端本地（data/private/，不入 git），
        接口只返回掩码，前端与仓库均不留明文；仅系统管理员(ADMIN/BOSS)可读写。
      </p>
    </header>

    <!-- 已迁至平台后台的子 tab 不渲染，原位置（tab 栏上方）给出提示与后台链接（#3464） -->
    <MigratedToAdminNotice v-if="MIGRATED_ENTRIES.length" :entries="MIGRATED_ENTRIES" />

    <el-tabs v-model="activeTab" class="ds-tabs" @tab-change="onTabChange">
      <el-tab-pane v-for="tab in TABS" :key="tab.name" :label="tab.label" :name="tab.name">
        <KeepAlive>
          <component :is="tab.component" v-if="activeTab === tab.name" />
        </KeepAlive>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.ds-settings { display: flex; flex-direction: column; gap: 12px; }
.page-head .sub { margin: 0; font-size: var(--font-md); line-height: 1.7; color: var(--el-text-color-secondary); }
/* 子 tab 自带 section/card 外距，tab 面板不再叠加内边距。 */
.ds-tabs :deep(.el-tab-pane) { padding: 0; }
</style>
