<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PeriodDecisionPanel from './PeriodDecisionPanel.vue'
import ImportedIntervalPanel from './ImportedIntervalPanel.vue'
import type { DeclarationOrder } from '@/services/declarations'
import type { DailyEnergySelection } from '@/services/review/dailyEnergy'
import DailyEnergyAnalysisPanel from './DailyEnergyAnalysisPanel.vue'
import TopicAnalysisPanel from './TopicAnalysisPanel.vue'
import SettlementAnalysisPanel from './SettlementAnalysisPanel.vue'
import ReviewDataMaintenance from './ReviewDataMaintenance.vue'
import MarketPriceAnalysisPanel from './MarketPriceAnalysisPanel.vue'
import type { ReviewEvidenceSnapshot } from '@/services/review/reviewEvidence'
import type { ReportEvidence } from '@/services/review/workpapers'
import type { ImportedSelection } from '@/services/review/importedIntervals'
import { prioritizeAvailableBases, hasDecisionTopicData, reviewAnalysisSources, reviewBusinessViews, type ReviewAnalysisSource, type ReviewBusinessView, type ReviewTopic, type SettlementSelection, type PriceSelection } from '@/services/review/reviewTopics'
const props = defineProps<{ snapshot: ReviewEvidenceSnapshot | null; company: string; companyLabel: string; region: string; date: string; view: ReviewBusinessView; topic: ReviewTopic; busy: boolean; standalone?: boolean; selection?: SettlementSelection; priceSelection?: PriceSelection; energySelection?: DailyEnergySelection; analysisSource?: ReviewAnalysisSource; importedSelection?: ImportedSelection }>()
const emit = defineEmits<{ decision: [value: DeclarationOrder]; 'update:view': [value: ReviewBusinessView]; 'update:topic': [value: ReviewTopic]; 'update:selection': [value: SettlementSelection]; 'update:priceSelection': [value: PriceSelection]; 'update:energySelection': [value: DailyEnergySelection]; 'update:analysisSource': [value: ReviewAnalysisSource]; 'update:importedSelection': [value: ImportedSelection]; busy: [value: boolean]; material: [value: ReportEvidence]; independent: [] }>()
const analysisPeriod = ref<{ start: string; end: string } | null>(null)
watch(() => [props.topic, props.company, props.region, props.date, props.view], () => { analysisPeriod.value = null }, { flush: 'sync' })
const returnTopic = ref<ReviewTopic>('energy'), preferredDataset = ref('')
watch(() => props.topic, (next, previous) => { if (next === 'maintenance' && previous !== 'maintenance') returnTopic.value = previous })
function maintainIntervals() { preferredDataset.value = 'review-intervals'; emit('update:topic', 'maintenance') }
function maintainEnergy() { preferredDataset.value = 'cgn-plant-daily-metrics'; emit('update:topic', 'maintenance') }
const lens = computed(() => reviewBusinessViews[props.view])
const bases = computed(() => prioritizeAvailableBases(props.snapshot, lens.value.bases))
const sources = computed(() => reviewAnalysisSources(props.view, props.topic))
const source = ref<ReviewAnalysisSource>('daily'), returnSource = ref<ReviewAnalysisSource>('daily')
watch(() => [props.view, props.topic, props.snapshot?.scope.objectKey], (_next, previous) => {
  if (props.topic === 'maintenance') { returnSource.value = source.value; return }
  // 重新打开专题窗口时回到上次用的资料来源（仍适用于当前视角与专题才恢复），不再每次跳回默认来源。
  if (!previous && props.analysisSource && sources.value.some(item => item.id === props.analysisSource)) { source.value = props.analysisSource; return }
  if (previous?.[1] === 'maintenance' && previous[0] === props.view && sources.value.some(item => item.id === returnSource.value)) { source.value = returnSource.value; return }
  source.value = props.snapshot?.scope.objectKey && hasDecisionTopicData(props.snapshot, props.topic) && sources.value.some(item => item.id === 'decision') ? 'decision' : sources.value[0]?.id ?? 'imported'
}, { immediate: true })
watch(source, value => { analysisPeriod.value = null; emit('update:analysisSource', value) })
function openMaintenance() { preferredDataset.value = props.view === 'generator' ? '' : 'review-intervals'; emit('update:topic', 'maintenance') }
const titles: Partial<Record<ReviewTopic, string>> = { energy: '电量偏差', price: '价格与市场', settlement: '结算与历史比较' }
</script>
<template>
  <section class="topic-workspace" aria-label="复盘专题工作区">
    <header><label>业务视角<select :value="view" :disabled="busy" @change="emit('update:view', ($event.target as HTMLSelectElement).value as ReviewBusinessView)"><option v-for="(item, key) in reviewBusinessViews" :key="key" :value="key">{{ item.title }}</option></select></label><div><button v-if="!standalone" :disabled="busy" @click="emit('independent')">独立打开专题</button><button :disabled="busy" :aria-pressed="topic === 'maintenance'" @click="openMaintenance">维护资料</button></div></header>
    <nav aria-label="专题选择"><button v-for="(title, key) in titles" :key="key" :aria-pressed="topic === key" :disabled="busy" @click="emit('update:topic', key)">{{ title }}</button></nav>
    <nav v-if="sources.length > 1" aria-label="分析资料来源"><button v-for="item in sources" :key="item.id" :aria-pressed="source === item.id" :disabled="busy" @click="source = item.id">{{ item.label }}</button></nav>
    <p v-if="topic === 'energy'">{{ lens.energy }}</p><p v-else-if="topic === 'price'">{{ lens.price }}</p>
    <template v-if="topic === 'energy' || topic === 'price'">
      <DailyEnergyAnalysisPanel v-if="source === 'daily'" @period="analysisPeriod = $event" :key="`${company}:${region}:${date}`" :company="company" :region="region" :date="date" :selection="energySelection" @selection="emit('update:energySelection', $event)" @material="emit('material', $event)" @maintenance="maintainEnergy" />
      <MarketPriceAnalysisPanel v-else-if="source === 'market'" @period="analysisPeriod = $event" :key="`${company}:${region}:${date}`" :company="company" :region="region" :date="date" :selection="priceSelection" @selection="emit('update:priceSelection', $event)" @material="emit('material', $event)" />
      <ImportedIntervalPanel v-else-if="source === 'imported'" :key="`${company}:${region}:${date}:${view}:${topic}`" expanded :selection="importedSelection" @selection="emit('update:importedSelection', $event)" :company="company" :region="region" :view="view" :date="date" :topic="topic" @material="emit('material', $event)" @maintenance="maintainIntervals" @period="analysisPeriod = $event" />
      <template v-else-if="source === 'decision'"><TopicAnalysisPanel v-if="snapshot?.intervals.length" :key="`${view}:${topic}`" :snapshot="snapshot" :active-topic="topic" :bases="bases" @material="emit('material', $event)" /><div v-else class="empty"><h3>当前对象缺少可用分时资料</h3><p>请选择有留存曲线的申报记录，或切换到补充分时资料进行统计。补充资料不会自动成为当时决策的依据。</p><button @click="source = 'imported'">分析补充分时资料</button></div></template>
    </template>
    <template v-else-if="topic === 'settlement'"><SettlementAnalysisPanel v-if="view === 'generator'" @period="analysisPeriod = $event" :key="`${company}:${region}:${date}`" :company="company" :company-label="companyLabel" :region="region" :date="date" :selection="selection" @selection="emit('update:selection', $event)" @material="emit('material', $event)" /><div v-else class="empty"><h3>{{ view === 'retail' ? '售电结算资料尚未接入本专题' : '储能结算资料尚未接入本专题' }}</h3><p>{{ view === 'retail' ? '需要同范围的采购电费、零售收入和结算调整，才能比较经营结果。' : '需要充电费用、放电收入及适用费用，才能比较结算结果。' }}可先使用已维护的电量和价格资料进行历史比较。</p><button @click="emit('update:topic', 'energy')">比较电量</button><button @click="emit('update:topic', 'price')">比较价格</button></div></template>
    <ReviewDataMaintenance v-else :view="view" :company-id="company" :company-label="companyLabel" :region="region" :preferred-dataset="preferredDataset" @busy="emit('busy', $event)" @saved="emit('update:topic', returnTopic)" />
    <PeriodDecisionPanel v-if="analysisPeriod && topic !== 'maintenance'" :key="`${company}:${region}:${topic}`" :company="company" :region="region" :period="analysisPeriod" @select="emit('decision', $event)" />
  </section>
</template>
<style scoped>
.topic-workspace{display:grid;gap:16px;padding:16px;min-width:0}header,header>div,nav,label{display:flex;align-items:center;gap:12px;flex-wrap:wrap}header{justify-content:space-between}nav{border-bottom:1px solid var(--line);padding-bottom:10px}button,select{font:inherit;font-size:var(--font-sm);padding:8px 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text)}button{cursor:pointer}button[aria-pressed=true]{color:var(--primary);background:var(--primary-tint);border-color:var(--primary)}button:disabled{opacity:.5;cursor:default}p{margin:0;line-height:1.7;color:var(--muted);font-size:var(--font-sm)}.empty{padding:20px;background:var(--panel-sub);border-radius:8px}.empty button{margin-top:12px}button:focus-visible,select:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
</style>
