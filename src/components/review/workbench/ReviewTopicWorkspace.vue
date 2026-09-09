<script setup lang="ts">
import { computed } from 'vue'
import TopicAnalysisPanel from './TopicAnalysisPanel.vue'
import SettlementAnalysisPanel from './SettlementAnalysisPanel.vue'
import ReviewDataMaintenance from './ReviewDataMaintenance.vue'
import type { ReviewEvidenceSnapshot } from '@/services/review/reviewEvidence'
import type { ReportEvidence } from '@/services/review/workpapers'
import { prioritizeAvailableBases, reviewBusinessViews, type ReviewBusinessView, type ReviewTopic, type SettlementSelection } from '@/services/review/reviewTopics'
const props = defineProps<{ snapshot: ReviewEvidenceSnapshot | null; company: string; companyLabel: string; region: string; date: string; view: ReviewBusinessView; topic: ReviewTopic; busy: boolean; standalone?: boolean; selection?: SettlementSelection }>()
const emit = defineEmits<{ 'update:view': [value: ReviewBusinessView]; 'update:topic': [value: ReviewTopic]; 'update:selection': [value: SettlementSelection]; busy: [value: boolean]; material: [value: ReportEvidence]; independent: [] }>()
const lens = computed(() => reviewBusinessViews[props.view])
const bases = computed(() => prioritizeAvailableBases(props.snapshot, lens.value.bases))
const titles: Partial<Record<ReviewTopic, string>> = { energy: '电量偏差', price: '价格与市场', settlement: '结算与历史比较' }
</script>
<template>
  <section class="topic-workspace" aria-label="复盘专题工作区">
    <header><label>业务视角<select :value="view" :disabled="busy" @change="emit('update:view', ($event.target as HTMLSelectElement).value as ReviewBusinessView)"><option v-for="(item, key) in reviewBusinessViews" :key="key" :value="key">{{ item.title }}</option></select></label><div><button v-if="!standalone" :disabled="busy" @click="emit('independent')">独立打开专题</button><button :disabled="busy" :aria-pressed="topic === 'maintenance'" @click="emit('update:topic', 'maintenance')">维护资料</button></div></header>
    <nav aria-label="专题选择"><button v-for="(title, key) in titles" :key="key" :aria-pressed="topic === key" :disabled="busy" @click="emit('update:topic', key)">{{ title }}</button></nav>
    <template v-if="topic === 'energy' || topic === 'price'">
      <p>{{ topic === 'energy' ? lens.energy : lens.price }}</p>
      <TopicAnalysisPanel v-if="snapshot?.intervals.length" :key="`${view}:${topic}`" :snapshot="snapshot" :active-topic="topic" :bases="bases" @material="emit('material', $event)" />
      <div v-else class="empty"><h3>当前对象缺少可用分时资料</h3><p>请选择有留存曲线的申报记录，或先维护对应资料；公司结算增量不能替代实际分时电量。</p><button @click="emit('update:topic', 'maintenance')">查看资料维护</button></div>
    </template>
    <SettlementAnalysisPanel v-else-if="topic === 'settlement'" :key="`${company}:${region}:${date}`" :company="company" :company-label="companyLabel" :region="region" :date="date" :selection="selection" @selection="emit('update:selection', $event)" @material="emit('material', $event)" />
    <ReviewDataMaintenance v-else :company-id="company" :company-label="companyLabel" :region="region" @busy="emit('busy', $event)" />
  </section>
</template>
<style scoped>
.topic-workspace{display:grid;gap:16px;padding:16px;min-width:0}header,header>div,nav,label{display:flex;align-items:center;gap:12px;flex-wrap:wrap}header{justify-content:space-between}nav{border-bottom:1px solid var(--line);padding-bottom:10px}button,select{font:inherit;font-size:var(--font-sm);padding:8px 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text)}button{cursor:pointer}button[aria-pressed=true]{color:var(--primary);background:var(--primary-tint);border-color:var(--primary)}button:disabled{opacity:.5;cursor:default}p{margin:0;line-height:1.7;color:var(--muted);font-size:var(--font-sm)}.empty{padding:20px;background:var(--panel-sub);border-radius:8px}.empty button{margin-top:12px}button:focus-visible,select:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
</style>
