<script setup lang="ts">
// 复盘待办箱（Epic #2033 · M1 · #2038）：template_instances status=pending/draft。
// 待办分母来自触发引擎（#2039）——引擎未上线前探针降级为就绪度台账替代视图
// （不拿假分母，Epic 验收红线）。引擎上线后本组件零改动出真数。
import { computed, onMounted, ref } from 'vue'
import { fetchTemplateInstanceFeed } from '@/services/review/templateInstanceClient'
import {
  FEED_ABSENT_NOTE,
  toTodoViews,
  type TemplateInstanceFeed
} from '@/services/review/templateInstanceApi'
import { enrichTodos, type TodoRow } from '@/services/review/cockpitModel'
import { readinessSummary } from 'shared/review-templates/registry.mjs'

const emit = defineEmits<{ (e: 'open-instance', row: TodoRow): void }>()

const loading = ref(true)
const feed = ref<TemplateInstanceFeed | null>(null)
const rows = ref<TodoRow[]>([])

async function load(force = false) {
  loading.value = true
  feed.value = await fetchTemplateInstanceFeed(force)
  rows.value =
    feed.value.available ? enrichTodos(toTodoViews(feed.value.instances, new Date().toISOString())) : []
  loading.value = false
}

onMounted(() => void load())

/** 供父组件在实例保存/提交后强制重取（缓存已被 patchTemplateInstance 作废）。 */
defineExpose({ reload: () => load(true) })

const reason = computed(() => (feed.value && !feed.value.available ? feed.value.reason : null))
const ledger = computed(() => readinessSummary())

function fmtDue(dueAt: string): string {
  const d = new Date(dueAt)
  return Number.isNaN(d.getTime())
    ? dueAt
    : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}
</script>

<template>
  <section id="review-todo" class="ti panel">
    <header class="ti-head">
      <b>复盘待办箱</b>
      <span v-if="feed && feed.available" class="ti-count">{{ rows.length }} 项待办</span>
    </header>

    <p v-if="loading" class="ti-muted">读取待办…</p>

    <template v-else-if="reason === 'endpoint-absent'">
      <p class="ti-note">{{ FEED_ABSENT_NOTE }}</p>
      <p class="ti-ledger">
        就绪度台账（注册表单源）：{{ ledger.total }} 项模板 —— 就绪 {{ ledger.ready }} ·
        缺数据 {{ ledger.data_gap }} · 后置 {{ ledger.deferred }}。台账即分期验收清单，
        数据到位按批翻转（见六维入口卡徽章）。
      </p>
    </template>

    <p v-else-if="reason === 'unauthorized'" class="ti-note">
      无权限读取复盘待办（review 读权限按公司隔离）。请联系管理员开通后重试。
    </p>

    <template v-else-if="reason === 'unreachable'">
      <p class="ti-note">待办服务暂时不可达（可能为网络或后端重启）。</p>
      <button type="button" class="ti-retry" @click="load(true)">重试</button>
    </template>

    <template v-else-if="rows.length">
      <button v-for="r in rows" :key="r.id" type="button" class="ti-row" :class="{ overdue: r.overdue }" @click="emit('open-instance', r)">
        <span class="ti-name">{{ r.templateName }}</span>
        <span class="ti-meta">
          {{ r.periodKey }}
          <template v-if="r.deadlineLabel"> · 时限 {{ r.deadlineLabel }}</template>
          <template v-if="r.dueAt"> · 截止 {{ fmtDue(r.dueAt) }}</template>
        </span>
        <i v-if="r.overdue" class="ti-overdue">已逾期</i>
      </button>
    </template>

    <p v-else class="ti-muted">今日待办已清：触发引擎生成的应填实例均已完成。</p>
  </section>
</template>

<style scoped>
.ti { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.ti-head { display: flex; align-items: center; justify-content: space-between; font-size: 13.5px; }
.ti-count { font-size: 11px; color: var(--el-text-color-secondary, #666); }
.ti-muted { margin: 0; font-size: 12px; color: var(--el-text-color-secondary, #666); }
.ti-note {
  margin: 0; padding: 8px 10px; border-radius: 6px;
  background: #f8fafc; border: 1px dashed var(--el-border-color, #dcdfe6);
  font-size: 12px; line-height: 1.7; color: #475569;
}
.ti-ledger { margin: 0; font-size: 11.5px; line-height: 1.7; color: var(--el-text-color-secondary, #666); }
.ti-retry { align-self: flex-start; padding: 4px 12px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: 12px; cursor: pointer; }
.ti-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; width: 100%;
  padding: 7px 10px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px;
  background: #fff; cursor: pointer; text-align: left;
}
.ti-row:hover { border-color: var(--el-color-primary, #2563eb); }
.ti-row.overdue { border-color: #fca5a5; background: #fef2f2; }
.ti-name { font-size: 12.5px; font-weight: 600; color: var(--el-text-color-primary, #303133); }
.ti-meta { font-size: 11px; color: var(--el-text-color-secondary, #666); font-variant-numeric: tabular-nums; }
.ti-overdue { margin-left: auto; font-style: normal; font-size: 10.5px; color: #b91c1c; border: 1px solid #fca5a5; border-radius: 999px; padding: 0 7px; }
</style>
