<script setup lang="ts">
// S1 风险复盘面板（Epic #2033 · 六维「维度五」· #2015）——从 StageMorningReview 抽出的子组件
// ---------------------------------------------------------------------------
// 呈现昨日窗口风险事件（类型/等级/仓位快照/损失/处置/有效性）+ near_miss「侥幸逃过」标注
// + 风控回顾提醒；两项无源监测（节点电价飙升自动识别、止损/仓位）data_gap 口径常驻。
// 数据由父组件注入（fetchRiskEvents 探针降级在父层完成），本组件零取数零写回。
import { computed } from 'vue'
import type { RiskEventSummary } from '@/services/review/reviewStoreApi'
import {
  NODE_PRICE_SPIKE_DATA_GAP_NOTE,
  riskReviewReminder,
  STOP_LOSS_DATA_GAP_NOTE
} from '@/services/review/morningRiskReview'

const props = defineProps<{
  /** 昨日窗口内的事件（父组件已过滤） */
  events: RiskEventSummary[]
  /** 事件库服务是否可用（不可用=父层探针降级，本组件不渲染数据面） */
  available: boolean
  /** 窗口描述（如「昨日 2026-08-25」），仅用于文案 */
  windowLabel: string
}>()

const emit = defineEmits<{ goRiskLibrary: [] }>()

const reminder = computed(() => riskReviewReminder(props.events))

const levelLabel: Record<string, string> = { high: '高', medium: '中', low: '低' }

function lossLabel(e: RiskEventSummary): string {
  if (e.nearMiss) return '未受损（侥幸）'
  return e.impactYuan === null ? '—（未记金额）' : `${e.impactYuan.toLocaleString()} 元`
}

/** 仓位状态（#2015 验收）：登记时留的快照对象，取其中字符串值紧凑呈现；未登记=—。 */
function positionLabel(e: RiskEventSummary): string {
  if (!e.positionSnapshot) return '—'
  const vals = Object.values(e.positionSnapshot)
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  return vals.length ? vals.join('；').slice(0, 40) : JSON.stringify(e.positionSnapshot).slice(0, 40)
}
</script>

<template>
  <section id="mr-panel-risk" class="mrp">
    <h3>风险复盘 · {{ windowLabel }}（六维⑤）</h3>

    <p v-if="!available" class="mrp-muted">
      风险事件服务未上线或暂不可达——本维保持占位，不合成假事件。
    </p>
    <template v-else>
      <p v-if="!events.length" class="mrp-muted">
        昨日无风险事件记录（平安日）——极端价格/平台异常如有人工登记会出现在这里。
      </p>
      <template v-else>
        <p v-for="(n, i) in reminder.notes" :key="i" class="mrp-remind">{{ n }}</p>
        <table class="mrp-table">
          <thead>
            <tr><th>时间</th><th>类型</th><th>等级</th><th>当时仓位</th><th>受损</th><th>处置</th><th>有效性</th></tr>
          </thead>
          <tbody>
            <tr v-for="e in events" :key="e.id" :class="{ 'mrp-near': e.nearMiss }">
              <td>{{ e.eventTime.slice(5, 16).replace('T', ' ') }}</td>
              <td>{{ e.nearMiss ? `${e.eventType}（侥幸逃过）` : e.eventType }}</td>
              <td>{{ e.riskLevel ? levelLabel[e.riskLevel] ?? e.riskLevel : '—' }}</td>
              <td>{{ positionLabel(e) }}</td>
              <td :class="!e.nearMiss && e.impactYuan !== null ? 'mrp-bad' : ''">{{ lossLabel(e) }}</td>
              <td>{{ e.disposal ?? '—（待补）' }}</td>
              <td>{{ e.effective === null ? '—（未评估）' : e.effective ? '有效' : '无效' }}</td>
            </tr>
          </tbody>
        </table>
      </template>
      <p class="mrp-muted">{{ NODE_PRICE_SPIKE_DATA_GAP_NOTE }}</p>
      <p class="mrp-muted">{{ STOP_LOSS_DATA_GAP_NOTE }}</p>
      <button type="button" class="mrp-jump" @click="emit('goRiskLibrary')">去风险事件库登记/回填处置 →</button>
    </template>
  </section>
</template>

<style scoped>
/* 面板外观对齐父级 .mr-panel（同款边框/内距，抽组件不改视觉） */
.mrp { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.mrp h3 { font-size: var(--font-sm); margin: 0; }
.mrp-muted { margin: 0; font-size: var(--font-xs); color: var(--el-text-color-secondary, #909399); line-height: 1.6; }
.mrp-remind { margin: 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: var(--font-xs); line-height: 1.6; }
.mrp-table { width: 100%; border-collapse: collapse; font-size: var(--font-xs); font-variant-numeric: tabular-nums; }
.mrp-table th, .mrp-table td { padding: 3px 6px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: left; }
.mrp-table th { color: var(--el-text-color-secondary, #667); font-weight: 600; }
.mrp-near td { background: #fffbeb; }
.mrp-bad { color: #b91c1c; }
.mrp-jump { align-self: flex-start; padding: 0; border: 0; background: none; color: #2563eb; font-size: var(--font-sm); cursor: pointer; }
</style>
