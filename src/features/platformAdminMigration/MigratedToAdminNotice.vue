<script setup lang="ts">
// 「已迁至平台后台」提示（ChenShi-Tech/dljy#3464，任务 12.3）。
//
// 内部版里被平台后台接管的旧入口（tab / 面板 / 区块 / 整页）原位置渲染本组件：说明这项管理已迁到
// 平台后台、由平台人员处理，并给出后台对应页面的链接。后台地址来自可选构建变量
// VITE_PLATFORM_ADMIN_URL，没配时只显示文字、不给链接。
//
// 传入的入口若未隐藏（按组回退后 / 客户版）会被过滤掉，全部未隐藏时整个组件不渲染。
// 客户版构建时本组件被重定向到 MigratedToAdminNotice.customer.vue 空壳，文字不进交付产物。
import { computed } from 'vue'
import CalloutBox from '@/components/common/CalloutBox.vue'
import { migratedEntryLinks, type MigratedEntryId } from '@/features/platformAdminMigration/registry'

const props = withDefaults(defineProps<{ entries: readonly MigratedEntryId[]; variant?: 'inline' | 'page' }>(), {
  variant: 'inline'
})

const links = computed(() => migratedEntryLinks(props.entries))
const linked = computed(() => links.value.some((l) => l.href))
</script>

<template>
  <div v-if="links.length" class="migrated-notice" :class="variant" data-testid="migrated-to-admin-notice">
    <CalloutBox tone="info" title="已迁至平台后台">
      <p>
        以下管理已迁到平台后台，由平台人员处理；本页不再提供这些操作。{{
          linked ? '需要处理时请前往平台后台对应页面。' : '需要处理时请联系平台人员。'
        }}
      </p>
      <ul class="entry-list">
        <li v-for="link in links" :key="link.id" :data-entry="link.id">
          <span class="entry-label">{{ link.label }}</span>
          <a v-if="link.href" :href="link.href" target="_blank" rel="noopener noreferrer" class="entry-link">前往平台后台 →</a>
          <span v-if="link.hint" class="entry-hint">{{ link.hint }}</span>
        </li>
      </ul>
    </CalloutBox>
  </div>
</template>

<style scoped>
.migrated-notice.page { max-width: 760px; padding: 8px 0; }
.entry-list { margin: 6px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.entry-list li { line-height: 1.7; }
.entry-label { color: var(--text); }
.entry-link { margin-left: 10px; color: var(--primary); text-decoration: none; }
.entry-link:hover { text-decoration: underline; }
.entry-hint { display: block; font-size: var(--font-sm); color: var(--muted); }
</style>
