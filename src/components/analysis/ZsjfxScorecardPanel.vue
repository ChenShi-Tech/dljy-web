<script setup lang="ts">
// ZsjfxScorecardPanel — 预测×实际对拍结果面板（Epic #3591 S2 / dljy#3594，ZW-04）。
// 只渲染服务端确定性算好的指标（MAE/MAPE/方向命中率/逐时段误差/异动），不在前端重算；
// 「预测缺失 N 天未计入」作为一等展示；无可计分日/配对不可用时如实说明，不显示空指标卡。
import { computed } from 'vue'
import DataState from '@/components/common/DataState.vue'
import type { ZsjfxScorecard } from '@/services/insight/zsjfxScorecardClient'

const props = defineProps<{
  scorecard: ZsjfxScorecard | null
  loading: boolean
  error?: string
  /** 当前实际查询窗口（codex #238 R1-04：控件须反映真实状态，不固定 day） */
  window?: 'day' | '30d'
}>()

const emit = defineEmits<{
  (e: 'pair-change', pairId: string): void
  (e: 'window-change', window: 'day' | '30d'): void
}>()

const totals = computed(() => props.scorecard?.totals ?? null)
const skipNote = computed(() => {
  const t = totals.value
  if (!t) return ''
  const parts: string[] = []
  if (t.skippedDays.forecastMissing) parts.push(`预测缺失 ${t.skippedDays.forecastMissing} 天`)
  if (t.skippedDays.actualMissing) parts.push(`实际缺失 ${t.skippedDays.actualMissing} 天`)
  if (t.skippedDays.noData) parts.push(`双缺 ${t.skippedDays.noData} 天`)
  return parts.length ? `${parts.join('、')}未计入` : '窗口内全部日期参与计分'
})
const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)
const num = (v: number | null | undefined) => (v == null ? '—' : String(v))
</script>

<template>
  <div class="scorecard">
    <DataState :loading="loading" :error="error" :empty="!scorecard" empty-text="暂无对拍结果">
      <template v-if="scorecard">
        <div class="pair-row">
          <el-select
            :model-value="scorecard.pair.id"
            size="small"
            style="width: 320px"
            @update:model-value="emit('pair-change', String($event))"
          >
            <el-option
              v-for="p in scorecard.pairs"
              :key="p.id"
              :value="p.id"
              :label="p.available ? p.label : `${p.label}（缺 ${p.missingTypes.join('、')}）`"
              :disabled="!p.available"
            />
          </el-select>
          <el-radio-group
            size="small"
            :model-value="props.window ?? 'day'"
            @update:model-value="emit('window-change', String($event) === '30d' ? '30d' : 'day')"
          >
            <el-radio-button value="day">当日</el-radio-button>
            <el-radio-button value="30d">近 30 天</el-radio-button>
          </el-radio-group>
        </div>

        <el-alert
          v-if="scorecard.availability[0]?.status === 'missing'"
          type="info"
          :closable="false"
          :title="scorecard.availability[0].note"
          class="mb"
        />
        <template v-else>
          <div class="metric-cards">
            <div class="metric"><em>{{ num(totals?.mae) }}</em><span>MAE{{ scorecard.pair.id.includes('price') ? '（元/MWh）' : '' }}</span></div>
            <div class="metric"><em>{{ totals?.mape == null ? '—' : `${totals.mape.toFixed(1)}%` }}</em><span>MAPE（服务端百分数口径）</span></div>
            <div class="metric"><em>{{ pct(totals?.directionHitRate) }}</em><span>方向命中率</span></div>
            <div class="metric"><em>{{ num(totals?.scoredDays) }}</em><span>计分天数 / {{ totals?.slots }} 时段</span></div>
          </div>
          <p class="skip-note">{{ skipNote }}｜{{ totals?.directionHitRateNote }}</p>

          <h4>逐时段误差（{{ scorecard.pair.forecast }} − {{ scorecard.pair.actual }}，{{ scorecard.dateTo }}）</h4>
          <div class="slot-errors">
            <span
              v-for="(v, i) in scorecard.slotErrors"
              :key="i"
              class="bar"
              :class="{ neg: v != null && v < 0, pos: v != null && v >= 0, none: v == null }"
              :title="`时段 ${i}：${v == null ? '空值（未计入）' : v}`"
            ></span>
          </div>

          <h4>异动事件（口径对齐市场洞察驾驶舱，确定性派生）</h4>
          <el-empty v-if="!scorecard.anomalies.length" description="当日无负价 / 价差离群事件" :image-size="48" />
          <ul v-else class="anomaly-list">
            <li v-for="(a, i) in scorecard.anomalies" :key="i" :class="a.severity">
              <el-tag size="small" :type="a.severity === 'high' ? 'danger' : 'warning'">{{ a.type }}</el-tag>
              {{ a.message }}
            </li>
          </ul>
          <p v-for="(note, i) in scorecard.anomalyNotes" :key="'n' + i" class="anomaly-note">{{ note }}</p>
        </template>
      </template>
    </DataState>
  </div>
</template>

<style scoped>
.scorecard { display: flex; flex-direction: column; gap: 8px; }
.pair-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.metric-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.metric { background: var(--el-fill-color-light); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; }
.metric em { font-style: normal; font-size: var(--font-xl); font-weight: 700; color: var(--el-text-color-primary); }
.metric span { font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.skip-note { font-size: var(--font-sm); color: var(--el-text-color-secondary); margin: 0; }
h4 { margin: 8px 0 4px; font-size: var(--font-md); color: var(--el-text-color-primary); }
.slot-errors { display: flex; gap: 1px; align-items: flex-end; height: 56px; }
.bar { flex: 1; min-height: 2px; border-radius: 1px; background: var(--el-color-primary); opacity: .7; }
.bar.none { background: var(--el-fill-color-dark); min-height: 2px; opacity: .4; }
.anomaly-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.anomaly-list li { display: flex; align-items: center; gap: 8px; font-size: var(--font-sm); }
.anomaly-note { font-size: var(--font-sm); color: var(--el-text-color-secondary); margin: 0; }
.mb { margin-bottom: 8px; }
</style>
