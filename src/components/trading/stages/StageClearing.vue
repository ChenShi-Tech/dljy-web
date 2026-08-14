<script setup lang="ts">
// S5 出清分析（出清结果公布后）—— 反馈环的当日中途站
//
// 两段动作：① 登记出清结果（96 点出清曲线，手工粘贴或按申报全额速填——速填会如实
// 标注为「按申报假定」，它只是无偏差日的快捷键，不是数据来源）；② 偏差判读
// （analyzeClearing 真算：中标率、最坏时段、是否需转实时调整），结论写回
// preflight.clearingReview——S1 明晨复盘与 S7 今晚日报都读它。
import { computed, ref } from 'vue'
import { Activity, Save, TriangleAlert } from 'lucide-vue-next'
import {
  markDeclarationCleared,
  savePreflight,
  STATUS_LABEL,
  type DeclarationOrder
} from '@/services/declarations'
import { analyzeClearing, type ClearingAnalysis } from '@/services/trading/clearingReview'
import type { StageId } from '@/data/workflowStages'

const props = defineProps<{ declaration: DeclarationOrder | null; targetDate: string }>()
const emit = defineEmits<{ updated: [d: DeclarationOrder]; go: [stage: StageId] }>()

const decl = computed(() => props.declaration)
const submitted = computed(() =>
  decl.value
    ? ['SUBMITTED', 'ACKNOWLEDGED', 'CLEARED', 'DEVIATION_TRACKING', 'SETTLED', 'REVIEWED'].includes(decl.value.status)
    : false
)
const clearedCurve = computed(() => decl.value?.clearing?.clearedCurveMwh96 ?? null)

// ── ① 登记出清结果 ──────────────────────────────────────────────────────────
const clearedText = ref('')
const parsedCleared = computed(() => {
  const parsed = clearedText.value
    .split(/[,，\s\n]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n))
  return parsed
})
const parseOk = computed(() => parsedCleared.value.length === 96)

const busy = ref(false)
const msg = ref('')
const error = ref('')

async function register(curve: number[], source: string, note: string) {
  if (!decl.value || busy.value) return
  busy.value = true
  msg.value = ''
  error.value = ''
  try {
    const updated = await markDeclarationCleared(decl.value.id, { clearedCurveMwh96: curve, note })
    emit('updated', updated)
    msg.value = `出清结果已登记（${source}）`
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登记失败'
  } finally {
    busy.value = false
  }
}

function registerPasted() {
  if (!parseOk.value) return
  void register(parsedCleared.value, '手工登记', '出清曲线手工登记（交易平台披露口径）')
}
function registerFullAward() {
  if (!decl.value) return
  void register(
    [...decl.value.energyCurveMwh96],
    '按申报假定',
    '按申报全额中标假定登记——非平台披露数据，偏差分析将恒为零'
  )
}

// ── ② 偏差判读与写回 ────────────────────────────────────────────────────────
const analysis = computed<ClearingAnalysis | null>(() => {
  if (!decl.value?.energyCurveMwh96?.length || !clearedCurve.value?.length) return null
  try {
    return analyzeClearing(decl.value.energyCurveMwh96, clearedCurve.value)
  } catch {
    return null
  }
})

const written = computed(() => decl.value?.preflight?.clearingReview ?? null)

async function writeBack() {
  if (!decl.value || !analysis.value || busy.value) return
  busy.value = true
  msg.value = ''
  error.value = ''
  try {
    const a = analysis.value
    const updated = await savePreflight(
      decl.value.id,
      'clearingReview',
      {
        clearRate: a.clearRate,
        maxGapSlot: a.worstSlots.length ? a.worstSlots[0].slot : null,
        needsRealtimeAction: a.needsRealtimeAction,
        summary: a.summary
      },
      `S5 出清分析：${a.summary.split('；')[0]}`
    )
    emit('updated', updated)
    msg.value = '偏差结论已写回，S6 补仓与 S7 日报可直接读取'
  } catch (e) {
    error.value = e instanceof Error ? e.message : '写回失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="cl">
    <section v-if="!decl" class="cl-wait">未绑定单据。</section>
    <section v-else-if="!submitted" class="cl-wait">
      申报还没出门（当前 {{ STATUS_LABEL[decl.status] }}）——出清无从谈起。
      <button type="button" class="cl-jump" @click="emit('go', 'declare')">回 S4 完成申报</button>
    </section>

    <template v-else>
      <!-- ① 登记出清结果 -->
      <section v-if="!clearedCurve" class="cl-panel">
        <h3><Activity :size="14" /> ① 登记出清结果</h3>
        <p class="cl-tip">
          交易平台披露出清后，把 96 点出清电量（MWh/15min）粘贴进来。逗号/空格/换行分隔均可，
          当前已识别 <strong :class="parseOk ? 'cl-good' : ''">{{ parsedCleared.length }}</strong>/96 点。
        </p>
        <textarea v-model="clearedText" rows="4" class="cl-paste" placeholder="8.2, 8.1, 8.3, …（96 个值）" />
        <div class="cl-actions">
          <button type="button" class="cl-btn primary" :disabled="!parseOk || busy" @click="registerPasted">
            登记出清曲线
          </button>
          <button type="button" class="cl-btn" :disabled="busy" @click="registerFullAward">
            按申报全额中标速填
          </button>
          <span class="cl-muted">速填只是无偏差日的快捷键，会在单据里如实标注「按申报假定」</span>
        </div>
      </section>

      <!-- ② 偏差判读 -->
      <section v-if="analysis" class="cl-panel">
        <h3>
          <Activity :size="14" /> ② 中标偏差判读
          <span v-if="decl.clearing" class="cl-source">来源：{{ decl.clearing.source }}</span>
        </h3>
        <div class="cl-stats">
          <div class="cl-stat">
            <strong>{{ analysis.clearRate === null ? '—' : (analysis.clearRate * 100).toFixed(1) + '%' }}</strong>
            <span>中标率</span>
          </div>
          <div class="cl-stat">
            <strong>{{ analysis.totalDeclaredMwh.toFixed(1) }}</strong>
            <span>申报 MWh</span>
          </div>
          <div class="cl-stat">
            <strong>{{ analysis.totalClearedMwh.toFixed(1) }}</strong>
            <span>出清 MWh</span>
          </div>
          <div class="cl-stat" :class="analysis.needsRealtimeAction ? 'bad' : 'ok'">
            <strong>{{ analysis.needsRealtimeAction ? `${analysis.triggeredSlots.length} 时段` : '无' }}</strong>
            <span>需实时调整</span>
          </div>
        </div>
        <p class="cl-summary" :class="{ warn: analysis.needsRealtimeAction }">
          <TriangleAlert v-if="analysis.needsRealtimeAction" :size="13" />
          {{ analysis.summary }}
        </p>
        <table v-if="analysis.worstSlots.length" class="cl-table">
          <thead><tr><th>时段</th><th>申报</th><th>出清</th><th>偏差</th><th>偏差率</th></tr></thead>
          <tbody>
            <tr v-for="w in analysis.worstSlots" :key="w.slot">
              <td>#{{ w.slot + 1 }}（{{ String(Math.floor(w.slot / 4)).padStart(2, '0') }}:{{ String((w.slot % 4) * 15).padStart(2, '0') }}）</td>
              <td>{{ w.declaredMwh }}</td>
              <td>{{ w.clearedMwh }}</td>
              <td :class="w.deltaMwh < 0 ? 'cl-bad-cell' : ''">{{ w.deltaMwh }}</td>
              <td>{{ w.deltaPct === null ? '—' : (w.deltaPct * 100).toFixed(1) + '%' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="cl-muted">逐时段零偏差（全额中标口径）。</p>

        <div class="cl-actions">
          <button type="button" class="cl-btn primary" :disabled="busy" @click="writeBack">
            <Save :size="13" /> {{ written ? '更新写回' : '写回并进入 S6 补仓' }}
          </button>
          <button type="button" class="cl-jump" @click="emit('go', 'contract')">跳到 S6 中长期补仓</button>
          <span v-if="written" class="cl-good">已写回（{{ written.writtenBy }}）</span>
        </div>
      </section>

      <p v-if="msg" class="cl-good">{{ msg }}</p>
      <p v-if="error" class="cl-err">{{ error }}</p>
    </template>
  </div>
</template>

<style scoped>
.cl { display: flex; flex-direction: column; gap: 12px; }
.cl-wait { padding: 14px; border: 1px dashed var(--el-border-color, #dcdfe6); border-radius: 10px; font-size: 12px; color: var(--el-text-color-secondary, #667); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cl-panel { padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.cl-panel h3 { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; font-size: 13px; }
.cl-source { margin-left: auto; font-size: 10px; padding: 1px 8px; border-radius: 8px; background: #f1f5f9; color: #475569; }
.cl-tip { margin: 0 0 6px; font-size: 12px; line-height: 1.6; color: var(--el-text-color-secondary, #667); }
.cl-paste { width: 100%; font-family: ui-monospace, monospace; font-size: 11px; padding: 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; }
.cl-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.cl-btn { padding: 4px 14px; border: 1px solid #2563eb; border-radius: 5px; background: #eff6ff; color: #1d4ed8; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.cl-btn.primary { background: #2563eb; color: #fff; }
.cl-btn:disabled { opacity: .45; cursor: not-allowed; }
.cl-jump { padding: 0; border: none; background: none; color: #1d4ed8; font-size: 12px; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.cl-muted { font-size: 11px; color: var(--el-text-color-secondary, #667); }
.cl-good { font-size: 12px; color: #15803d; }
.cl-err { margin: 0; padding: 6px 10px; border-radius: 6px; background: #fef2f2; color: #991b1b; font-size: 12px; }

.cl-stats { display: flex; gap: 10px; flex-wrap: wrap; }
.cl-stat { display: flex; flex-direction: column; align-items: center; padding: 8px 16px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; }
.cl-stat strong { font-size: 18px; font-variant-numeric: tabular-nums; }
.cl-stat span { font-size: 10px; color: var(--el-text-color-secondary, #667); }
.cl-stat.ok { border-color: #86efac; background: #f0fdf4; }
.cl-stat.bad { border-color: #fca5a5; background: #fef2f2; }

.cl-summary { display: flex; align-items: flex-start; gap: 5px; margin: 8px 0; padding: 7px 10px; border-radius: 6px; background: #f8fafc; font-size: 12px; line-height: 1.6; }
.cl-summary.warn { background: #fef2f2; color: #991b1b; }

.cl-table { width: 100%; border-collapse: collapse; font-size: 11px; font-variant-numeric: tabular-nums; }
.cl-table th, .cl-table td { padding: 4px 6px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: right; }
.cl-table th:first-child, .cl-table td:first-child { text-align: left; }
.cl-table th { color: var(--el-text-color-secondary, #667); font-weight: 600; }
.cl-bad-cell { color: #b91c1c; }
</style>
