<script setup lang="ts">
// 主体视角（Epic #2033 · #2048）：售电/新能源/储能三类身份驾驶舱。
// 与六维正交——它是「以谁的身份看」，故在标签栏单列一席，不混进任一维度。
import type { SubjectDaySummary } from '../SubjectCockpit.vue'
import SubjectCockpit from '../SubjectCockpit.vue'

defineProps<{ daySummary: SubjectDaySummary }>()
const emit = defineEmits<{ (e: 'open-template', templateId: string): void }>()
</script>

<template>
  <div class="dim">
    <SubjectCockpit :day-summary="daySummary" @open-template="(id: string) => emit('open-template', id)" />
  </div>
</template>

<style scoped>
.dim { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
</style>
