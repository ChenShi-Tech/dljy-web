<script setup lang="ts">
// 复盘待办徽标（Epic #2033 · M1 · #2040，S1 体系消费元素之三）
// ---------------------------------------------------------------------------
// 「今天应填 N 张复盘单」→ 跳驾驶舱待办箱。待办分母来自触发引擎（#2039）生成的
// template_instances，引擎未上线前探针降级为「触发引擎未上线」态（诚实空态，
// 不拿假分母）。点击在两种态下都跳 /xhjy/review?todo=1（待办箱有完整说明）。
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ClipboardList } from 'lucide-vue-next'
import { fetchTemplateInstanceFeed } from '@/services/review/templateInstanceClient'
import type { TemplateInstanceFeed } from '@/services/review/templateInstanceApi'

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
</script>

<template>
  <button type="button" class="rtb" :class="`rtb-${feed && feed.available ? 'on' : 'off'}`" @click="jump">
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
  padding: 8px 12px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px;
  background: #fff; color: var(--el-text-color-regular, #606266); font-size: 12px; cursor: pointer;
  min-width: 0;
}
.rtb:hover { border-color: var(--el-color-primary, #2563eb); }
.rtb b { font-size: 12.5px; color: var(--el-text-color-primary, #303133); }
.rtb-sub { font-size: 11px; color: var(--el-text-color-secondary, #666); }
.rtb-on { border-color: #bfdbfe; background: #f8fbff; }
.rtb-off { border-style: dashed; }
</style>
