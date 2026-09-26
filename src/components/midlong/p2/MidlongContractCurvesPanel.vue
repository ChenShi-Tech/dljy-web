<script setup lang="ts">
// 合同详情里的分时分解区（dljy#2971，MP-04/MA-05）。
// - 当前版本逐月：已有正式分时 / 分时未知（只有月量）/ 月量未知；内部估算单独标出，不替代正式资料。
// - 更正后沿用：未受更正影响且月量不变的月份继续用旧版本上已确认的曲线，标「沿用 vN」。
// - 更正影响：受影响月份原有曲线失效；同月正式电量未变的可「沿用原曲线」生成当前版本草稿（仍需确认），
//   电量已变的只提示重新导入；内部估算同样给出影响（仍不计入正式口径）。
// - 分解集历史（含草稿、已废弃）可钻取到详情；写操作按后端能力 canWrite 开放，后端再判权。
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import MidlongCurveImportDialog from './MidlongCurveImportDialog.vue'
import MidlongCurveEstimateDialog from './MidlongCurveEstimateDialog.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { createCurveDraft, fetchContractCurves } from '@/services/midlong/midlongP2Api'
import type { MidlongEvidence } from '@/services/midlong/midlongTypes'
import { CORRECTION_IMPACT_LABELS, CURVE_GRANULARITY_LABELS, type ContractCurvesOverview } from '@/services/midlong/midlongP2Types'
import { createLoadGuard, fmtQuantity } from '@/services/midlong/midlongFormat'
import { basisTag, curveSetStatusTag, inheritedLabel, timeStatusTag } from '@/services/midlong/midlongP2Format'

const props = defineProps<{ contractId: number; rowVersion: number; canWrite: boolean; evidence: MidlongEvidence[] }>()

const overview = ref<ContractCurvesOverview | null>(null)
const failure = ref('')
const loading = ref(false)
const dialogs = ref({ import: false, estimate: false })
const copying = ref<string | null>(null)
const guard = createLoadGuard()
// 合同行版本（rowVersion）也进上下文：核验、更正、作废后重新取概览，并丢弃操作前发出的迟到响应。
const contextKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}|${props.contractId}|${props.rowVersion}`

async function load() {
  const token = guard.begin(contextKey())
  if (overview.value?.contractId !== props.contractId) overview.value = null
  loading.value = true
  failure.value = ''
  try {
    const data = await fetchContractCurves(props.contractId)
    if (!guard.isCurrent(token, contextKey())) return
    overview.value = data
  } catch (error) {
    if (!guard.isCurrent(token, contextKey())) return
    overview.value = null
    failure.value = midlongFailureOf(error).message
  } finally {
    if (guard.isCurrent(token, contextKey())) loading.value = false
  }
}

onMounted(load)
watch([selectedCompanyId, () => currentRegion.value.id, () => props.contractId, () => props.rowVersion], () => void load())

const canCreate = computed(() => Boolean(props.canWrite && overview.value?.canCreate))
const impactMonths = computed(() => (overview.value?.months ?? []).filter((m) => m.correctionImpact))
const estimateImpactMonths = computed(() => (overview.value?.months ?? []).filter((m) => m.estimateCorrectionImpact))

async function copyFrom(month: ContractCurvesOverview['months'][number]) {
  const o = overview.value
  const impact = month.correctionImpact
  if (!o || !impact?.canCopy || copying.value) return
  copying.value = month.month
  try {
    const draft = await createCurveDraft(o.contractId, {
      expectedRevisionNo: o.currentRevisionNo, evidenceBasis: 'FORMAL', coverageFromMonth: month.month, coverageToMonth: month.month,
      copyFromCurveSetId: impact.previousCurveSetId,
    })
    ElMessage[draft.validation.blocking ? 'warning' : 'success'](draft.validation.blocking
      ? `已生成草稿 #${draft.setNo}，但与当前版本不守恒，不能确认`
      : `已沿用分解集 #${impact.previousSetNo} 生成草稿 #${draft.setNo}，请到详情页确认`)
    await load()
  } catch (error) {
    ElMessage.error(midlongFailureOf(error).message)
  } finally {
    copying.value = null
  }
}
</script>

<template>
  <div class="ml-panel">
    <h3>
      分时分解
      <small>只计已确认的正式分解；只有月量的月份在小时视图显示「分时未知」</small>
      <span class="ml-grow" />
      <el-button v-if="canCreate" size="small" type="primary" @click="dialogs.import = true">导入曲线</el-button>
      <el-button v-if="canCreate" size="small" @click="dialogs.estimate = true">生成估算</el-button>
    </h3>
    <div v-if="loading && !overview" v-loading="true" class="ml-placeholder" />
    <MidlongNotice v-else-if="failure" tone="danger" title="分时分解加载失败（未显示任何替代数值）">{{ failure }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>
    <template v-else-if="overview">
      <MidlongNotice v-if="!overview.canCreate && overview.confirmationStatus !== 'CONFIRMED'" tone="info">合同核验确认后才能登记分时分解（未确认版本的电量还会变化）。</MidlongNotice>
      <MidlongNotice v-if="impactMonths.length" tone="warn" title="合同更正影响">
        合同已更正为 v{{ overview.currentRevisionNo }}，以下月份受这次更正影响，原有的已确认曲线不再沿用：
        <div v-for="m in impactMonths" :key="m.month" class="ml-impact">
          <b>{{ m.month }}</b>：{{ CORRECTION_IMPACT_LABELS[m.correctionImpact!.status] }}（v{{ m.correctionImpact!.previousRevisionNo }} 分解集 #{{ m.correctionImpact!.previousSetNo }}，
          原月量 {{ fmtQuantity(m.correctionImpact!.previousMonthlyQuantity) }} → 现月量 {{ fmtQuantity(m.correctionImpact!.currentMonthlyQuantity) }} MWh）
          <el-button v-if="canCreate && m.correctionImpact!.canCopy" link type="primary" :loading="copying === m.month" @click="copyFrom(m)">沿用原曲线生成草稿</el-button>
          <span v-else-if="!m.correctionImpact!.canCopy" class="ml-hint">电量已变，请重新导入</span>
        </div>
      </MidlongNotice>
      <MidlongNotice v-if="estimateImpactMonths.length" tone="warn" title="合同更正影响：内部估算（不计入正式口径）">
        以下月份原有的内部估算受这次更正影响，不再沿用：
        <div v-for="m in estimateImpactMonths" :key="m.month" class="ml-impact">
          <b>{{ m.month }}</b>：{{ CORRECTION_IMPACT_LABELS[m.estimateCorrectionImpact!.status] }}（v{{ m.estimateCorrectionImpact!.previousRevisionNo }} 估算 #{{ m.estimateCorrectionImpact!.previousSetNo }}，
          原月量 {{ fmtQuantity(m.estimateCorrectionImpact!.previousMonthlyQuantity) }} → 现月量 {{ fmtQuantity(m.estimateCorrectionImpact!.currentMonthlyQuantity) }} MWh），需要时重新生成估算
        </div>
      </MidlongNotice>
      <el-table :data="overview.months" border size="small">
        <el-table-column prop="month" label="交割月" width="100" />
        <el-table-column label="正式月度电量(MWh)" width="150" align="right"><template #default="{ row }">{{ row.monthlyFormalQuantity === null ? '月量未知' : fmtQuantity(row.monthlyFormalQuantity) }}</template></el-table-column>
        <el-table-column label="分时状态" width="170"><template #default="{ row }"><el-tag size="small" :type="timeStatusTag(row.timeStatus).type">{{ timeStatusTag(row.timeStatus).label }}</el-tag></template></el-table-column>
        <el-table-column label="正式分解集" min-width="200">
          <template #default="{ row }">
            <router-link v-if="row.formalCurve" :to="`/zcqjy/curves/${row.formalCurve.curveSetId}`" class="ml-link">#{{ row.formalCurve.setNo }} · {{ CURVE_GRANULARITY_LABELS[row.formalCurve.granularityMinutes as 60] }} · {{ fmtQuantity(row.formalCurve.curveQuantity) }} MWh</router-link>
            <span v-else class="ml-hint">—</span>
            <el-tag v-if="row.formalCurve?.inheritedFromRevisionNo" size="small" type="info" class="ml-inherit">{{ inheritedLabel(row.formalCurve.inheritedFromRevisionNo) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="内部估算（不计入）" min-width="190">
          <template #default="{ row }">
            <router-link v-if="row.estimateCurve" :to="`/zcqjy/curves/${row.estimateCurve.curveSetId}`" class="ml-link ml-estimate">估算 #{{ row.estimateCurve.setNo }} · {{ fmtQuantity(row.estimateCurve.curveQuantity) }} MWh</router-link>
            <span v-else class="ml-hint">—</span>
            <el-tag v-if="row.estimateCurve?.inheritedFromRevisionNo" size="small" type="info" class="ml-inherit">{{ inheritedLabel(row.estimateCurve.inheritedFromRevisionNo) }}</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <h4 class="ml-sub">分解集历史（{{ overview.sets.length }}）</h4>
      <el-table :data="overview.sets" border size="small" max-height="300">
        <el-table-column label="编号" width="80"><template #default="{ row }"><router-link :to="`/zcqjy/curves/${row.id}`" class="ml-link">#{{ row.setNo }}</router-link></template></el-table-column>
        <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag size="small" :type="curveSetStatusTag(row.status).type">{{ curveSetStatusTag(row.status).label }}</el-tag></template></el-table-column>
        <el-table-column label="依据" width="200"><template #default="{ row }"><el-tag size="small" :type="basisTag(row.evidenceBasis).type">{{ basisTag(row.evidenceBasis).label }}</el-tag></template></el-table-column>
        <el-table-column label="版本" width="90"><template #default="{ row }">v{{ row.revisionNo }}<span v-if="!row.isCurrentRevision" class="ml-hint">（旧）</span></template></el-table-column>
        <el-table-column label="覆盖" width="170"><template #default="{ row }">{{ row.coverageFromMonth }} ~ {{ row.coverageToMonth }}</template></el-table-column>
        <el-table-column label="粒度 / 单位" width="130"><template #default="{ row }">{{ CURVE_GRANULARITY_LABELS[row.granularityMinutes as 60] }} · {{ row.sourceUnit }}</template></el-table-column>
        <el-table-column label="合计(MWh)" width="120" align="right"><template #default="{ row }">{{ fmtQuantity(row.totalQuantity) }}</template></el-table-column>
        <el-table-column label="阻断问题" width="90" align="right"><template #default="{ row }"><span :class="{ 'ml-danger': row.blockingIssueCount > 0 }">{{ row.blockingIssueCount }}</span></template></el-table-column>
        <template #empty>尚未登记任何分时分解。</template>
      </el-table>
    </template>

    <MidlongCurveImportDialog v-if="overview" v-model="dialogs.import" :contract-id="overview.contractId" :revision-no="overview.currentRevisionNo"
      :delivery-start="overview.deliveryStart" :delivery-end="overview.deliveryEnd" :evidence="evidence" @created="load" />
    <MidlongCurveEstimateDialog v-if="overview" v-model="dialogs.estimate" :contract-id="overview.contractId" :revision-no="overview.currentRevisionNo"
      :delivery-start="overview.deliveryStart" @created="load" />
  </div>
</template>

<style scoped>
.ml-panel { border: 1px solid var(--line); border-radius: var(--radius, 8px); padding: 14px 16px; background: var(--panel); display: flex; flex-direction: column; gap: 10px; }
.ml-panel h3 { margin: 0; font-size: var(--font-16); display: flex; align-items: center; gap: 8px; }
.ml-panel h3 small { font-size: var(--font-sm); color: var(--muted); font-weight: 400; }
.ml-grow { flex: 1; }
.ml-sub { margin: 6px 0 0; font-size: var(--font-md); }
.ml-placeholder { min-height: 120px; }
.ml-link { color: var(--accent); text-decoration: none; }
.ml-estimate { color: var(--warning); }
.ml-hint { color: var(--muted); font-size: var(--font-sm); }
.ml-danger { color: var(--danger); font-weight: 600; }
.ml-impact { margin-top: 2px; }
.ml-inherit { margin-left: 6px; }
</style>
