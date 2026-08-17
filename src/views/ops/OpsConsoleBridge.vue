<template>
  <div class="ops-bridge">
    <p>数据管理已迁至独立的「数据运维台」，正在跳转…</p>
    <p v-if="!jumped"><a :href="href">如果没有自动跳转，点这里手动前往</a></p>
  </div>
</template>

<script setup lang="ts">
// 主前端 → 数据运维台桥接页（#2174 P2-2b）：旧管理路径/导航入口由此跳独立控制台，
// 保深链与收藏可达。跳转失败时保留手动链接（不静默白屏）。
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const jumped = ref(false)
const target = computed(() => {
  const to = String(route.query.to ?? '/ops/upload')
  return to.startsWith('/ops/') ? to : '/ops/upload'
})
const href = computed(() => `/ops-console.html#${target.value}`)

onMounted(() => {
  jumped.value = true
  window.location.replace(href.value)
})
</script>

<style scoped>
.ops-bridge { padding: 48px 24px; text-align: center; color: var(--el-text-color-secondary); }
.ops-bridge a { color: var(--el-color-primary); }
</style>
