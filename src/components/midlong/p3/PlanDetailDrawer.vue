<script setup lang="ts">
// 售电目标详情（dljy#2973，MS-01/MS-04）：版本历史（目标电量、更改原因、确认人与时间）、
// 「查看当时完成情况」（按被取代前一刻的认知时点重算，旧报告保留旧目标与旧完成率）、
// 作用域内全部方案占用（含已释放，释放原因与时间），计划与占用的变化可追溯。
import { ref, watch } from 'vue'
import MidlongNotice from '../MidlongNotice.vue'
import { fetchPlan } from '@/services/midlong/midlongP3Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { createLoadGuard, fmtPrice, fmtQuantity } from '@/services/midlong/midlongFormat'
import { beijingDateTime, planPeriodLabel, proposalStatusTag } from '@/services/midlong/midlongP3Format'
import {
  OCCUPATION_RELEASE_REASON_LABELS, PLANNING_EVENT_TYPE_LABELS, PLANNING_NOTICES, PLAN_REVISION_STATUS_LABELS,
  type PlanOccupation, type SalesPlanDetail, type SalesPlanRevision,
} from '@/services/midlong/midlongP3Types'
import { TAX_BASIS_LABELS } from '@/services/midlong/midlongTypes'

const props = defineProps<{ modelValue: boolean; planId: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; history: [{ planId: number; asOf: string; revisionNo: number }] }>()

const detail = ref<SalesPlanDetail | null>(null)
const failure = ref('')
const loading = ref(false)
const guard = createLoadGuard()

async function load() {
  if (!props.planId) return
  const key = String(props.planId)
  const token = guard.begin(key)
  detail.value = null
  failure.value = ''
  loading.value = true
  try {
    const result = await fetchPlan(props.planId)
    if (!guard.isCurrent(token, key)) return
    detail.value = result
  } catch (e) {
    if (!guard.isCurrent(token, key)) return
    failure.value = midlongFailureOf(e).message
  } finally {
    if (guard.isCurrent(token, key)) loading.value = false
  }
}

watch(() => [props.modelValue, props.planId] as const, ([open]) => { if (open) void load() }, { immediate: true })

// el-table 插槽里的 row 没有类型，标签查表经带类型的小函数取，避免隐式 any 索引。
const revisionStatusLabel = (r: SalesPlanRevision) => PLAN_REVISION_STATUS_LABELS[r.status]
const taxBasisLabel = (r: SalesPlanRevision) => TAX_BASIS_LABELS[r.priceTaxBasis]
const releaseLabel = (o: PlanOccupation) => (o.open ? '未释放（未完成占用）' : `${o.releaseReason ? OCCUPATION_RELEASE_REASON_LABELS[o.releaseReason] : '已释放'} · ${beijingDateTime(o.releasedAt)}`)
const priceRange = (low: string | null, high: string | null) => (low === null && high === null ? '未填写' : `${fmtPrice(low)} ~ ${fmtPrice(high)} 元/MWh`)
</script>

<template>
  <el-drawer :model-value="modelValue" size="760px" title="售电目标详情" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div v-if="loading && !detail" v-loading="true" class="p3-placeholder" />
    <MidlongNotice v-else-if="failure" tone="danger" title="目标详情加载失败">{{ failure }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>
    <div v-else-if="detail" class="p3-detail">
      <div class="p3-head">
        <b>{{ detail.subjectName ?? `主体 #${detail.subjectId}` }}</b>
        <span>{{ planPeriodLabel(detail.periodType, detail.periodKey) }}</span>
        <el-tag size="small" :type="detail.confirmedRevisionNo ? 'success' : 'info'">{{ detail.confirmedRevisionNo ? `当前确认版本 v${detail.confirmedRevisionNo}` : '尚无确认版本' }}</el-tag>
      </div>
      <MidlongNotice tone="info">{{ detail.targetNatureNotice }}</MidlongNotice>

      <h4>版本历史</h4>
      <el-table :data="detail.revisions" border size="small">
        <el-table-column label="版本" width="64"><template #default="{ row }">v{{ row.revisionNo }}</template></el-table-column>
        <el-table-column label="状态" width="76"><template #default="{ row }">{{ revisionStatusLabel(row) }}</template></el-table-column>
        <el-table-column label="目标电量(MWh)" width="120" align="right"><template #default="{ row }">{{ row.targetQuantity === null ? '未确定' : fmtQuantity(row.targetQuantity) }}</template></el-table-column>
        <el-table-column label="目标价格区间" min-width="150"><template #default="{ row }">{{ priceRange(row.targetPriceLow, row.targetPriceHigh) }}（{{ taxBasisLabel(row) }}）</template></el-table-column>
        <el-table-column label="依据 / 负责人" min-width="150"><template #default="{ row }">{{ row.basisNote ?? '待填写' }} / {{ row.ownerName ?? '待填写' }}</template></el-table-column>
        <el-table-column label="更改原因" min-width="130"><template #default="{ row }">{{ row.changeReason ?? (row.revisionNo === 1 ? '初始目标' : '—') }}</template></el-table-column>
        <el-table-column label="确认" min-width="150">
          <template #default="{ row }">{{ row.confirmedAt ? `${row.confirmedBy ?? '未知'} · ${beijingDateTime(row.confirmedAt)}` : '未确认' }}</template>
        </el-table-column>
        <el-table-column label="历史视图" width="118">
          <template #default="{ row }">
            <el-button v-if="row.historyAsOf" link type="primary" @click="emit('history', { planId: detail.id, asOf: row.historyAsOf, revisionNo: row.revisionNo })">查看当时完成情况</el-button>
            <span v-else-if="row.status === 'CONFIRMED'" class="p3-muted">当前版本</span>
          </template>
        </el-table-column>
      </el-table>

      <h4>方案占用记录 <small>{{ PLANNING_NOTICES.occupation }}</small></h4>
      <el-table :data="detail.occupations" border size="small">
        <el-table-column label="方案" width="90"><template #default="{ row }">#{{ row.proposalId }}</template></el-table-column>
        <el-table-column prop="deliveryMonth" label="交割月" width="90" />
        <el-table-column label="占用电量(MWh)" width="120" align="right"><template #default="{ row }">{{ fmtQuantity(row.quantity) }}</template></el-table-column>
        <el-table-column label="建立" min-width="140"><template #default="{ row }">{{ beijingDateTime(row.occupiedAt) }}</template></el-table-column>
        <el-table-column label="释放" min-width="170">
          <template #default="{ row }">{{ releaseLabel(row) }}</template>
        </el-table-column>
        <el-table-column label="方案状态" width="100"><template #default="{ row }"><el-tag v-if="row.proposalStatus" size="small" :type="proposalStatusTag(row.proposalStatus).type">{{ proposalStatusTag(row.proposalStatus).label }}</el-tag></template></el-table-column>
        <template #empty>该交割期尚无方案占用。</template>
      </el-table>

      <h4>变更记录</h4>
      <el-timeline>
        <el-timeline-item v-for="e in detail.events" :key="e.id" :timestamp="beijingDateTime(e.occurredAt)">
          {{ PLANNING_EVENT_TYPE_LABELS[e.eventType] ?? e.eventType }}<template v-if="e.revisionNo"> · v{{ e.revisionNo }}</template>
          <template v-if="e.reason"> · 原因：{{ e.reason }}</template> · {{ e.actor ?? '未知' }}
        </el-timeline-item>
      </el-timeline>
    </div>
  </el-drawer>
</template>

<style scoped>
.p3-placeholder { min-height: 160px; }
.p3-detail { display: flex; flex-direction: column; gap: 10px; }
.p3-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.p3-detail h4 { margin: 8px 0 0; font-size: var(--font-md); display: flex; gap: 8px; align-items: baseline; }
.p3-detail h4 small { color: var(--muted); font-weight: 400; font-size: var(--font-sm); }
.p3-muted { color: var(--muted); font-size: var(--font-sm); }
</style>
