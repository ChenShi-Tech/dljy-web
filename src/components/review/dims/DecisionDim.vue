<script setup lang="ts">
// 决策维（Epic #2033 · #2038 外壳）：情绪化识别 + 复盘会议纪要（#2049 模板十一/十二）+ 本维模板清单。
// 决策复盘单（T01）的判断栏「严禁 AI 预填」是方案红线——填报走 ReviewTemplateForm，本区不代填。
import type { TemplateCard } from '@/services/review/cockpitModel'
import EmotionPatternPanel from '../EmotionPatternPanel.vue'
import MeetingMinutesForm from '../MeetingMinutesForm.vue'
import TemplateChips from '../TemplateChips.vue'

defineProps<{ templates: TemplateCard[] }>()
const emit = defineEmits<{ (e: 'open-template', template: TemplateCard): void }>()
</script>

<template>
  <div class="dim">
    <EmotionPatternPanel />
    <MeetingMinutesForm />
    <TemplateChips :templates="templates" label="决策复盘模板" @open-template="emit('open-template', $event)" />
  </div>
</template>

<style scoped>
.dim { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
</style>
