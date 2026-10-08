<script setup lang="ts">
// 复盘待办徽标（Epic #2033 · M1 · #2040，S1 体系消费元素之三）
// ---------------------------------------------------------------------------
// 「今天应填 N 张复盘单」→ 跳驾驶舱待办箱。待办分母来自触发引擎（#2039）生成的
// template_instances，引擎未上线前探针降级为「触发引擎未上线」态（诚实空态，
// 不拿假分母）。点击在两种态下都跳 /xhjy/review?todo=1（待办箱有完整说明）。
// variant="row"（S1 复盘材料直达行）：整颗即列表行，样式随行式列表，交互不变。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronRight, ClipboardList } from 'lucide-vue-next'
import { fetchTemplateInstanceFeed } from '@/services/review/templateInstanceClient'
import type { TemplateInstanceFeed } from '@/services/review/templateInstanceApi'

withDefaults(defineProps<{ variant?: 'card' | 'row' }>(), { variant: 'card' })

const router = useRouter()
const feed = ref<TemplateInstanceFeed | null>(null)
const loading = ref(true)

onMounted(async () => {
  feed.value = await fetchTemplateInstanceFeed()
  loading.value = false
})

function jump() {
  router.push({ path: '/xhjy/review', query: { todo: '1' } })
}

/** 行变体的状态摘要（右侧灰字）：与卡变体同一批诚实态文案，压缩成一行 */
const rowStatus = computed(() => {
  if (loading.value) return '探针查询中…'
  if (feed.value && feed.value.available) {
    return feed.value.instances.length ? `今天应填 ${feed.value.instances.length} 张` : '今日待办已清'
  }
  if (feed.value && !feed.value.available && feed.value.reason === 'unauthorized') return '无权限查看'
  if (feed.value && !feed.value.available && feed.value.reason === 'unreachable') return '暂时不可达'
  return '触发引擎未上线'
})
</script>

<template>
  <button
    v-if="variant === 'row'"
    type="button"
    class="rtb-row"
    @click="jump"
  >
    <ClipboardList :size="14" class="rtb-row-ico" />
    <b>复盘待办</b>
    <span class="rtb-row-status" :class="{ 'is-attention': feed && feed.available && feed.instances.length > 0 }">
      {{ rowStatus }}
    </span>
    <ChevronRight :size="14" class="rtb-row-arr" />
  </button>

  <button
    v-else
    type="button"
    class="rtb"
    :class="`rtb-${feed && feed.available ? 'on' : 'off'}`"
    @click="jump"
  >
    <ClipboardList :size="13" />
    <template v-if="loading">复盘待办探针…</template>
    <template v-else-if="feed && feed.available">
      <template v-if="feed.instances.length">
        <b>今天应填 {{ feed.instances.length }} 张复盘单</b>
        <span class="rtb-sub">点击进待办箱</span>
      </template>
      <template v-else>今日复盘待办已清</template>
    </template>
    <template v-else-if="feed && !feed.available && feed.reason === 'unauthorized'">
      复盘待办：无权限查看
    </template>
    <template v-else-if="feed && !feed.available && feed.reason === 'unreachable'">
      复盘待办：暂时不可达
    </template>
    <template v-else>复盘待办：触发引擎未上线</template>
  </button>
</template>

<style scoped>
.rtb {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 12px; border: 1px solid var(--line, #ebeef5); border-radius: 10px;
  background: var(--panel, #fff); color: var(--text-soft, #606266); font-size: var(--font-sm); cursor: pointer;
  min-width: 0;
}
.rtb:hover { border-color: var(--accent, #2563eb); }
.rtb b { font-size: var(--font-12-5); color: var(--text, #303133); }
.rtb-sub { font-size: var(--font-xs); color: var(--muted, #666); }
.rtb-on { border-color: var(--primary-tint-border, #bfdbfe); background: var(--primary-tint, #f8fbff); }
.rtb-off { border-style: dashed; }

/* 行变体（S1 复盘材料列表）：与 .mr-mat-row 同款解剖——图标 + 标题 + 状态 + 箭头 */
.rtb-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; border: 0; background: none; text-align: left; font: inherit; font-size: var(--font-sm); color: var(--text, #1f2a37); cursor: pointer; }
.rtb-row:hover { background: var(--surface-hover, #f1f5f6); }
.rtb-row b { font-weight: 600; }
.rtb-row-ico { flex: none; color: var(--muted, #667085); }
.rtb-row-status { margin-left: auto; padding-left: 8px; font-size: var(--font-xs); color: var(--muted, #667085); font-variant-numeric: tabular-nums; }
.rtb-row-status.is-attention { color: var(--warning, #d97706); font-weight: 600; }
.rtb-row-arr { flex: none; margin-left: 8px; color: var(--muted, #667085); }
</style>
