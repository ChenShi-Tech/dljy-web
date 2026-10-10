<script setup lang="ts">
// S1 风险复盘面板（Epic #2033 · 六维「维度五」· #2015）——从 StageMorningReview 抽出的子组件
// ---------------------------------------------------------------------------
// 呈现昨日窗口风险事件（类型/等级/仓位快照/损失/处置/有效性）+ near_miss「侥幸逃过」标注
// + 风控回顾提醒；两项无源监测（节点电价飙升自动识别、止损/仓位）data_gap 口径常驻。
// 数据由父组件注入（fetchRiskEvents 探针降级在父层完成），本组件零取数零写回。
import { computed, ref } from 'vue'
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
  /** 裸模式（S1 复盘材料分区）：去掉卡壳与标题，分区头由外层提供 */
  bare?: boolean
}>()

const emit = defineEmits<{ goRiskLibrary: [] }>()

const reminder = computed(() => riskReviewReminder(props.events))

/** 摘要级常显、清单级截断：事件 >CAP 行时先给前 CAP 行，「展开全部」就地看余下（S1 平铺列表约定）。 */
const ROW_CAP = 4
const showAll = ref(false)
const visibleEvents = computed(() =>
  showAll.value ? props.events : props.events.slice(0, ROW_CAP)
)

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
  <section id="mr-panel-risk" class="mrp" :class="{ 'mrp-bare': bare }">
    <h3 v-if="!bare">
      风险复盘 · {{ windowLabel }}
      <el-tooltip placement="top" :show-after="150">
        <template #content>
          <p>{{ NODE_PRICE_SPIKE_DATA_GAP_NOTE }}</p>
          <p>{{ STOP_LOSS_DATA_GAP_NOTE }}</p>
        </template>
        <span class="mrp-info" tabindex="0">ⓘ</span>
      </el-tooltip>
    </h3>
    <!-- 裸模式下 data_gap 口径 ⓘ 由外层分区头承载（S1 材料列表），卡内不再重复 -->

    <p v-if="!available && !bare" class="mrp-muted">
      风险事件服务未上线或暂不可达——本维保持占位，不合成假事件。
    </p>
    <!-- 裸模式空态/不可达不再重复整句：分区头状态摘要已说（平安日/服务未上线），只留登记入口 -->
    <template v-else-if="!available && bare">
      <button type="button" class="mrp-jump" @click="emit('goRiskLibrary')">去风险事件库登记 →</button>
    </template>
    <template v-else>
      <p v-if="!events.length && !bare" class="mrp-muted">
        昨日无风险事件记录（平安日）——极端价格/平台异常如有人工登记会出现在这里。
      </p>
      <template v-else-if="events.length">
        <p v-for="(n, i) in reminder.notes" :key="i" class="mrp-remind">{{ n }}</p>
        <table class="mrp-table">
          <thead>
            <tr><th>时间</th><th>类型</th><th>等级</th><th>当时仓位</th><th>受损</th><th>处置</th><th>有效性</th></tr>
          </thead>
          <tbody>
            <tr v-for="e in visibleEvents" :key="e.id" :class="{ 'mrp-near': e.nearMiss }">
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
        <button v-if="events.length > ROW_CAP" type="button" class="mrp-more" @click="showAll = !showAll">
          {{ showAll ? '收起' : `展开全部 ${events.length} 条` }}
        </button>
      </template>
      <button type="button" class="mrp-jump" @click="emit('goRiskLibrary')">去风险事件库登记/回填处置 →</button>
    </template>
  </section>
</template>

<style scoped>
/* 面板外观对齐父级 .mr-panel（同款边框/内距，抽组件不改视觉） */
.mrp { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--line, #ebeef5); border-radius: 12px; background: var(--panel, #fff); }
/* 裸模式：外层材料行已提供卡壳与标题，这里只剩内容 */
.mrp-bare { padding: 0; border: none; background: transparent; }
.mrp h3 { font-size: var(--font-sm); margin: 0; display: flex; align-items: center; gap: 6px; }
/* 标题 ⓘ：两项无源监测的 data_gap 口径说明收纳为 tooltip（诚实标注不减可见性，悬浮即达） */
.mrp-info { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border: 1px solid var(--line, #dcdfe6); border-radius: 50%; background: var(--panel-sub, #f8fafc); color: var(--muted, #667); font-size: var(--font-10); font-style: normal; cursor: help; user-select: none; }
.mrp-muted { margin: 0; font-size: var(--font-xs); color: var(--muted, #909399); line-height: 1.6; }
.mrp-remind { margin: 0; padding: 6px 9px; border-radius: 6px; background: var(--warning-tint, #fffbeb); color: var(--warning, #92400e); font-size: var(--font-xs); line-height: 1.6; }
.mrp-table { width: 100%; border-collapse: collapse; font-size: var(--font-xs); font-variant-numeric: tabular-nums; }
.mrp-table th, .mrp-table td { padding: 3px 6px; border-bottom: 1px solid var(--line-faint, #f0f2f5); text-align: left; }
.mrp-table th { color: var(--muted, #667); font-weight: 600; }
.mrp-near td { background: var(--warning-tint, #fffbeb); }
.mrp-bad { color: var(--danger, #b91c1c); }
.mrp-jump { align-self: flex-start; padding: 0; border: 0; background: none; color: var(--accent, #2563eb); font-size: var(--font-sm); cursor: pointer; }
/* 超过截断行数时的就地展开/收起（清单级截断，不跳转） */
.mrp-more { align-self: flex-start; padding: 0; border: 0; background: none; color: var(--accent, #2563eb); font-size: var(--font-xs); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
</style>
