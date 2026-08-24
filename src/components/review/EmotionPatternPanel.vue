<script setup lang="ts">
// 情绪化识别面板（Epic #2033 · M4 · #2049：模板十一，季度）
// ---------------------------------------------------------------------------
// 数据源 = 决策日志（#2037 起服务端台账优先，端点未部署回落 localStorage 原型链）
// + 规则清单 v1（先规则后模型）。
// 页面明示学习辅导定位、不做排名；可整体停用（配置开关）且停用时无残留展示。
// 干预措施与效果跟踪（下季度逐人回查）落 improvement_actions（写入端点已接通；
// 失败保留本地草稿并提示，不静默丢弃）。
import { computed, onMounted, ref } from 'vue'
import { loadLogAsync } from '@/services/trading/decisionLogStore'
import type { DecisionLogEntry } from 'shared/trading-rules/decision-log.mjs'
import {
  detectEmotionPatterns,
  EMOTION_NOTE,
  EMOTION_TOGGLE_KEY
} from '@/services/review/emotionRules'
import { createImprovementAction } from '@/services/review/reviewStoreClient'

const disabled = ref(typeof localStorage !== 'undefined' && localStorage.getItem(EMOTION_TOGGLE_KEY) === '1')
function toggleDisabled() {
  disabled.value = !disabled.value
  localStorage.setItem(EMOTION_TOGGLE_KEY, disabled.value ? '1' : '0')
}

const entries = ref<DecisionLogEntry[]>([])
onMounted(async () => {
  entries.value = (await loadLogAsync()).log
})
const detection = computed(() => detectEmotionPatterns(entries.value))

// 干预措施：落库 improvement_actions（#2049：下季度逐人回查的跟踪载体）
const intervention = ref('')
const interventionSaving = ref(false)
const interventionSaved = ref(false)
const interventionError = ref('')
async function saveIntervention() {
  const action = intervention.value.trim()
  if (!action) return
  interventionSaving.value = true
  interventionSaved.value = false
  interventionError.value = ''
  try {
    await createImprovementAction({ action: `情绪化干预：${action}`, owner: null, dueDate: null })
    interventionSaved.value = true
  } catch (e) {
    interventionError.value = e instanceof Error ? e.message : '干预措施落库失败（保留本地草稿，可重试）'
  } finally {
    interventionSaving.value = false
  }
}
</script>

<template>
  <section class="emo">
    <header class="emo-head">
      <b>情绪化决策识别（模板十一 · 规则清单 v1）</b>
      <label class="emo-switch">
        <input type="checkbox" :checked="disabled" @change="toggleDisabled" />
        整体停用
      </label>
    </header>

    <template v-if="!disabled">
      <p class="emo-banner">{{ EMOTION_NOTE }}</p>

      <p v-if="detection.patterns.length" class="emo-list-title">
        识别结果（按规则打标，回查条目见决策日志 seq）：
      </p>
      <p v-for="p in detection.patterns" :key="p.kind" class="emo-pattern">
        <b>{{ p.label }}</b> {{ p.evidence }}
      </p>
      <p v-if="!detection.patterns.length" class="emo-muted">
        当前决策日志无高置信情绪化信号——宁缺勿滥，不打标不等于没有问题。
      </p>

      <p class="emo-note">{{ detection.coverageNote }}</p>

      <label class="emo-intervention">
        干预措施与效果跟踪（下季度逐人回查，落 improvement_actions；失败时保留本地草稿并提示）：
        <span class="emo-intervention-row">
          <input v-model="intervention" class="emo-input" placeholder="如：高波动时段决策前强制二次确认" />
          <button type="button" class="emo-save" :disabled="interventionSaving || !intervention.trim()" @click="saveIntervention">
            {{ interventionSaving ? '落库中…' : '落库' }}
          </button>
        </span>
      </label>
      <p v-if="interventionError" class="emo-warn">{{ interventionError }}</p>
      <p v-else-if="interventionSaved" class="emo-ok">已落库：干预措施进入 improvement_actions，下季度纪要自动带入回查。</p>
    </template>
    <p v-else class="emo-muted">情绪化识别已整体停用（无残留展示；勾选上方开关可恢复）。</p>
  </section>
</template>

<style scoped>
.emo { display: flex; flex-direction: column; gap: 7px; font-size: var(--font-12-5); }
.emo-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.emo-switch { display: inline-flex; align-items: center; gap: 5px; font-size: var(--font-11-5); color: var(--el-text-color-secondary, #666); }
.emo-banner { margin: 0; padding: 6px 9px; border-radius: 6px; background: #f8fbff; border: 1px solid #bfdbfe; color: #075985; font-size: var(--font-11-5); line-height: 1.6; }
.emo-list-title { margin: 0; font-size: var(--font-11-5); color: var(--el-text-color-secondary, #666); }
.emo-pattern { margin: 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: var(--font-11-5); line-height: 1.6; }
.emo-pattern b { margin-right: 6px; }
.emo-muted { margin: 0; color: var(--el-text-color-secondary, #909399); font-size: var(--font-11-5); }
.emo-note { margin: 0; font-size: var(--font-xs); color: var(--el-text-color-secondary, #909399); line-height: 1.6; }
.emo-intervention { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-11-5); color: var(--el-text-color-secondary, #666); }
.emo-intervention-row { display: flex; gap: 6px; align-items: center; }
.emo-input { flex: 1; padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-11-5); }
.emo-save { padding: 4px 12px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: var(--font-11-5); cursor: pointer; }
.emo-warn { margin: 0; color: #b45309; font-size: var(--font-11-5); }
.emo-ok { margin: 0; color: #15803d; font-size: var(--font-11-5); }
</style>
