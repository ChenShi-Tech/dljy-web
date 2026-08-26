<script setup lang="ts">
// 策略适配评分：按“本地区 + 本主体”给各策略原型打分排序。
import { computed } from 'vue'
import type { RegionSpotProfile, SubjectKind } from '../../data/regionSpotProfiles'
import { scoreStrategyFit, type SubjectProfile } from '@/services/region/regionStrategyAdvisor'

const props = defineProps<{ profile: RegionSpotProfile }>()
const subject = defineModel<SubjectProfile>('subject', { required: true })

const subjectOptions: Array<{ value: SubjectKind; label: string }> = [
  { value: 'trader', label: '交易组合' },
  { value: 'generator-thermal', label: '火电厂' },
  { value: 'generator-renewable', label: '新能源场站' },
  { value: 'generator-hydro', label: '水电厂' },
  { value: 'retailer', label: '售电公司' },
  { value: 'storage', label: '储能' }
]

const scores = computed(() => scoreStrategyFit(props.profile, subject.value))

function scoreColor(score: number) {
  if (score >= 70) return '#0f766e'
  if (score >= 45) return '#d99a2b'
  return '#9aa7b1'
}
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <div class="section-kicker">策略适配评分</div>
    </div>

    <div class="subject-form">
      <label>
        <span>主体类型</span>
        <el-select v-model="subject.kind" size="small">
          <el-option v-for="opt in subjectOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
      </label>
      <label>
        <span>装机/可调容量(MW)</span>
        <el-input-number v-model="subject.capacityMw" :min="1" :max="5000" :step="10" size="small" controls-position="right" />
      </label>
      <label>
        <span>中长期合约覆盖率 {{ Math.round(subject.contractCoverage * 100) }}%</span>
        <el-slider v-model="subject.contractCoverage" :min="0" :max="1" :step="0.05" :show-tooltip="false" />
      </label>
      <label class="switch-row">
        <span>是否具备储能</span>
        <el-switch v-model="subject.hasStorage" />
      </label>
    </div>

    <div v-if="scores.length" class="score-list">
      <article v-for="item in scores" :key="item.archetype.id" class="score-card">
        <header>
          <strong>{{ item.archetype.title }}</strong>
          <span class="score-num" :style="{ color: scoreColor(item.score) }">{{ item.score }}</span>
        </header>
        <el-progress :percentage="item.score" :show-text="false" :color="scoreColor(item.score)" :stroke-width="8" />
        <p class="rationale">{{ item.archetype.rationale }}</p>
        <div class="signals">
          <span v-for="signal in item.archetype.keySignals" :key="signal">{{ signal }}</span>
        </div>
        <div class="links">
          <el-button
            v-for="link in item.archetype.linkedRoutes"
            :key="link.path"
            size="small"
            text
            type="primary"
            @click="$router.push(link.path)"
          >{{ link.title }} →</el-button>
        </div>
      </article>
    </div>
    <p v-else class="empty">该地区暂无可推荐的策略原型。</p>
  </section>
</template>

<style scoped>
.panel {
  padding: 16px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel);
}
.panel-head {
  margin-bottom: 12px;
}
.section-kicker {
  color: var(--primary);
  font-size: var(--font-md);
  font-weight: 650;
}
.subject-form {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.subject-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--font-sm);
  color: var(--text-soft);
}
.switch-row {
  justify-content: space-between;
}
.score-list {
  display: grid;
  gap: 12px;
}
.score-card {
  padding: 14px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel-sub);
}
.score-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.score-card strong {
  color: var(--text);
}
.score-num {
  font-size: var(--font-20);
  font-weight: 700;
}
.rationale {
  margin: 10px 0 8px;
  color: var(--text-soft);
  line-height: 1.6;
}
.signals {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.signals span {
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--surface-hover);
  color: var(--text-soft);
  font-size: var(--font-sm);
}
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.empty {
  margin: 0;
  color: var(--muted);
}
@media (max-width: 1180px) {
  .subject-form {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 768px) {
  .subject-form {
    grid-template-columns: 1fr;
  }
}
</style>
