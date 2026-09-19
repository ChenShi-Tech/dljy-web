<script setup lang="ts">
// 合同详情的「合同调整」区块（dljy#3014，MA-01..05）：该合同的调整列表、登记调整入口、详情抽屉（影响对比钻取），
// 以及「与更正版本同一条时间线」的影响查询——录入更正与调整产生的合同版本都能看变更前后快照（MA-05）。
// rowVersion 前进（核验/更正/调整生效）时重新取数，避免显示旧版本状态。
import { computed, reactive, ref, watch } from 'vue'
import MidlongNotice from '../MidlongNotice.vue'
import AdjustmentFormDialog from './AdjustmentFormDialog.vue'
import AdjustmentDetailDrawer from './AdjustmentDetailDrawer.vue'
import { fetchAdjustments, fetchRevisionImpact } from '@/services/midlong/midlongP4Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { captureScope } from '@/services/midlong/midlongP3Scope'
import { createLoadGuard, fmtQuantity } from '@/services/midlong/midlongFormat'
import { adjustmentStatusTag, adjustmentTypeLabel, directionLabel, impactMonthLine, priceLines, signedDeltaLabel } from '@/services/midlong/midlongP4Format'
import { ADJUSTMENT_NOTICES, type AdjustmentSummaryRow, type RevisionImpactReport } from '@/services/midlong/midlongP4Types'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'

const props = defineProps<{ contractId: number; contractLabel: string; rowVersion: number; canWrite: boolean; confirmationStatus: string }>()
const emit = defineEmits<{ changed: [] }>()

const rows = ref<AdjustmentSummaryRow[]>([])
const loading = ref(false)
const loadError = ref('')
const guard = createLoadGuard()
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
const loadKey = () => `${scopeKey()}|${props.contractId}|${props.rowVersion}`

async function load() {
  const key = loadKey()
  const token = guard.begin(key)
  loading.value = true
  loadError.value = ''
  try {
    const page = await fetchAdjustments({ contractId: String(props.contractId), pageSize: 100 })
    if (!guard.isCurrent(token, key)) return
    rows.value = page.rows
  } catch (e) {
    if (!guard.isCurrent(token, key)) return
    rows.value = []
    loadError.value = midlongFailureOf(e).message
  } finally {
    if (guard.isCurrent(token, key)) loading.value = false
  }
}

watch(loadKey, () => { void load() }, { immediate: true })

const registerDialog = ref(false)
const drawer = reactive({ open: false, adjustmentId: null as number | null })
// 版本影响查询（更正与调整产生的变更版本共用；初始/基线版本服务端 422，按钮只在变更版本上出现）。
const revisionImpact = ref<RevisionImpactReport | null>(null)
const revisionImpactOpen = ref(false)
const revisionImpactLoading = ref(false)
const revisionImpactError = ref('')

async function openRevisionImpact(revisionNo: number) {
  const scope = captureScope()
  revisionImpactOpen.value = true
  revisionImpactLoading.value = true
  revisionImpact.value = null
  revisionImpactError.value = ''
  try {
    const report = await fetchRevisionImpact(props.contractId, revisionNo)
    if (!scope.isCurrent()) return
    revisionImpact.value = report
  } catch (e) {
    if (!scope.isCurrent()) return
    revisionImpactError.value = midlongFailureOf(e).message
  } finally {
    if (scope.isCurrent()) revisionImpactLoading.value = false
  }
}

defineExpose({ reload: load, openRevisionImpact })
const hasPending = computed(() => rows.value.some((r) => r.status !== 'EFFECTIVE'))

/** 登记/修订保存后：重取调整列表并通知详情页刷新（rowVersion 前进、版本时间线可能出现调整版本）。 */
async function onSaved() {
  await load()
  emit('changed')
}
</script>

<template>
  <div class="ml-panel">
    <div class="adj-head">
      <h3>合同调整（{{ rows.length }}）<small>外部调整 · 转让 · 部分终止，与录入更正分开登记</small></h3>
      <el-button v-if="canWrite && confirmationStatus === 'CONFIRMED'" type="primary" plain size="small" data-test="open-adjustment-register" @click="registerDialog = true">登记调整</el-button>
    </div>
    <MidlongNotice v-if="hasPending" tone="info" data-test="adjustment-pending-notice">{{ ADJUSTMENT_NOTICES.directionPending }}</MidlongNotice>
    <MidlongNotice v-if="loadError" tone="danger" title="调整列表加载失败" data-test="contract-adjustments-error">
      {{ loadError }} <el-button link type="primary" @click="load">重试</el-button>
    </MidlongNotice>
    <el-table v-loading="loading" :data="rows" border size="small" @row-click="(row: AdjustmentSummaryRow) => Object.assign(drawer, { open: true, adjustmentId: row.id })">
      <el-table-column label="调整" width="80"><template #default="{ row }">#{{ row.id }}</template></el-table-column>
      <el-table-column label="状态" width="150">
        <template #default="{ row }">
          <el-tag size="small" :type="adjustmentStatusTag(row.status).type">{{ adjustmentStatusTag(row.status).label }}</el-tag>
          <el-tag v-if="row.pendingReason" size="small" type="danger" effect="plain">方向待核对</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="100"><template #default="{ row }">{{ adjustmentTypeLabel(row.adjustmentType) }}</template></el-table-column>
      <el-table-column label="我方义务方向" width="130"><template #default="{ row }">{{ directionLabel(row.direction) }}</template></el-table-column>
      <el-table-column label="来源 / 外部编号" min-width="180"><template #default="{ row }"><span class="adj-mono">{{ row.sourceNamespace }} / {{ row.externalAdjustmentNo }} r{{ row.externalRevisionNo }}</span></template></el-table-column>
      <el-table-column label="变化量合计(MWh)" width="130" align="right"><template #default="{ row }">{{ fmtQuantity(row.totalQuantity) }}</template></el-table-column>
      <el-table-column label="生效结果" width="180">
        <template #default="{ row }">
          <template v-if="row.effective">合同 v{{ row.effective.contractRevisionNo }} · {{ signedDeltaLabel(row.effective.totalDelta) }}</template>
          <span v-else class="adj-muted">{{ row.status === 'PENDING_VERIFICATION' ? '待核对，未生效' : '待确认生效' }}</span>
        </template>
      </el-table-column>
      <template #empty>该合同尚无调整记录；录入错误请用「录入更正」，外部转让/终止在此登记。</template>
    </el-table>

    <AdjustmentFormDialog v-model="registerDialog" :contract-id="contractId" :contract-label="contractLabel" @saved="onSaved" />
    <AdjustmentDetailDrawer v-model="drawer.open" :adjustment-id="drawer.adjustmentId" :can-write="canWrite" @changed="load" />

    <el-dialog v-model="revisionImpactOpen" title="合同版本变更影响（更正与调整同一条时间线）" width="680px" append-to-body>
      <div v-if="revisionImpactLoading" v-loading="true" class="adj-impact" />
      <MidlongNotice v-else-if="revisionImpactError" tone="danger" title="影响查询失败">{{ revisionImpactError }}</MidlongNotice>
      <div v-else-if="revisionImpact" class="adj-impact">
        <div class="adj-row">
          <b>版本 v{{ revisionImpact.revisionNo }}</b>
          <el-tag size="small" effect="plain">{{ revisionImpact.revisionKind }}</el-tag>
          <span v-if="revisionImpact.adjustment">来自调整 #{{ revisionImpact.adjustment.adjustmentId }}（{{ directionLabel(revisionImpact.adjustment.direction) }}）</span>
        </div>
        <div class="adj-muted">{{ revisionImpact.changeReason ?? '无变更原因记录' }}</div>
        <div class="adj-row">
          快照 v{{ revisionImpact.snapshot.beforeRevisionNo }} → v{{ revisionImpact.snapshot.afterRevisionNo }}，
          总量 {{ fmtQuantity(revisionImpact.snapshot.beforeTotalQuantity) }} → {{ fmtQuantity(revisionImpact.snapshot.afterTotalQuantity) }} MWh
        </div>
        <div v-for="m in revisionImpact.snapshot.months" :key="m.deliveryMonth" class="adj-row">{{ impactMonthLine(m) }}</div>
        <div v-if="priceLines(revisionImpact.adjustment?.prices).length" data-test="revision-impact-prices">
          <div v-for="line in priceLines(revisionImpact.adjustment!.prices)" :key="line">{{ line }}</div>
          <MidlongNotice tone="info">{{ ADJUSTMENT_NOTICES.priceIndependent }}</MidlongNotice>
        </div>
        <div v-if="revisionImpact.affectedPlans.length" class="adj-muted">
          受影响售电目标：{{ revisionImpact.affectedPlans.map((p) => p.periodKey).join('、') }}（只读提示，不改计划）
        </div>
        <div v-if="revisionImpact.endedMonths.length" class="adj-warn">{{ ADJUSTMENT_NOTICES.retroactive }}（已结束片段：{{ revisionImpact.endedMonths.join('、') }}）</div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.adj-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.adj-head h3 { margin: 0 0 10px; font-size: var(--font-16); }
.adj-head h3 small { font-size: var(--font-sm); color: var(--muted); font-weight: 400; margin-left: 8px; }
.adj-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: var(--font-md); margin-bottom: 4px; }
.adj-impact { display: flex; flex-direction: column; gap: 6px; min-height: 120px; }
.adj-muted { color: var(--muted); font-size: var(--font-sm); }
.adj-warn { color: var(--warning); font-size: var(--font-md); }
.adj-mono { font-family: var(--font-mono, monospace); font-size: var(--font-sm); }
</style>
