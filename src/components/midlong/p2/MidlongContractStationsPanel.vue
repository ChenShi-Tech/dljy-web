<script setup lang="ts">
// 合同详情里的场站分配区（dljy#2971，MP-05/MA-05）。
// - 合同绑定了场站：整笔电量归该场站，不做分配。交易单元统签：分别展示正式交易分解与内部经营分配的当前生效集与片段余额。
// - 主体合计与场站份额是同一义务的拆分：只展示「片段电量 = 已分配 + 未分配」，不相加。
// - 合同更正后：未受影响的片段继续沿用旧版本上已确认的分配（标「沿用 vN」），受影响片段失效并给出影响提示；
//   重新登记时对话框用仍有效的行预填（新分配集是整套快照）。草稿可继续确认或废弃。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import MidlongStationAllocationDialog from './MidlongStationAllocationDialog.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { midlongFailureOf, type MidlongFailure } from '@/services/midlong/midlongApi'
import { confirmStationAllocationSet, discardStationAllocationSet, fetchContractStationAllocations } from '@/services/midlong/midlongP2Api'
import { EVIDENCE_DOCUMENT_TYPE_LABELS, type MidlongEvidence } from '@/services/midlong/midlongTypes'
import {
  CORRECTION_IMPACT_LABELS, P2_BASIS_EVIDENCE_TYPES, STATION_ALLOCATION_KINDS, STATION_SEGMENT_MODE_LABELS,
  type ContractStationAllocationsOverview, type StationAllocationKind, type StationAllocationSet,
} from '@/services/midlong/midlongP2Types'
import { createLoadGuard, fmtQuantity } from '@/services/midlong/midlongFormat'
import { allocationKindTag, curveSetStatusTag, inheritedLabel, segmentLabel } from '@/services/midlong/midlongP2Format'

const props = defineProps<{ contractId: number; canWrite: boolean; evidence: MidlongEvidence[]; stations: Array<{ id: number; name: string }> }>()

const overview = ref<ContractStationAllocationsOverview | null>(null)
const failure = ref('')
const loading = ref(false)
const dialogOpen = ref(false)
const dialogKind = ref<StationAllocationKind>('FORMAL_TRADING')
const guard = createLoadGuard()
const contextKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}|${props.contractId}`

async function load() {
  const token = guard.begin(contextKey())
  if (overview.value?.contractId !== props.contractId) overview.value = null
  loading.value = true
  failure.value = ''
  try {
    const data = await fetchContractStationAllocations(props.contractId)
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
watch([selectedCompanyId, () => currentRegion.value.id, () => props.contractId], () => void load())

const canCreate = computed(() => Boolean(props.canWrite && overview.value?.canCreate))
const drafts = computed(() => (overview.value?.sets ?? []).filter((s) => s.status === 'DRAFT'))

function openDialog(kind: StationAllocationKind) {
  dialogKind.value = kind
  dialogOpen.value = true
}

// 已保存的草稿继续确认：正式交易分解选依据资料，内部经营分配写依据说明。
const confirming = reactive({ open: false, set: null as StationAllocationSet | null, evidenceIds: [] as number[], basisNote: '', busy: false, error: null as MidlongFailure | null })
const basisEvidence = computed(() => props.evidence.filter((e) => (P2_BASIS_EVIDENCE_TYPES as readonly string[]).includes(e.documentType)))
const confirmBlocked = computed(() => {
  const set = confirming.set
  if (!set) return ''
  if (set.allocationKind === 'FORMAL_TRADING' && !confirming.evidenceIds.length && !set.evidenceIds.length) return '正式交易分解必须选择依据资料'
  if (set.allocationKind === 'INTERNAL_OPERATING' && !confirming.basisNote.trim() && !set.basisNote) return '内部经营分配必须写明依据'
  return ''
})

function openConfirm(set: StationAllocationSet) {
  Object.assign(confirming, { open: true, set, evidenceIds: [...set.evidenceIds], basisNote: set.basisNote ?? '', busy: false, error: null })
}

async function submitConfirm() {
  const set = confirming.set
  if (!set || confirmBlocked.value || confirming.busy) return
  confirming.busy = true
  confirming.error = null
  try {
    await confirmStationAllocationSet(set.id, { evidenceIds: confirming.evidenceIds, basisNote: confirming.basisNote.trim() || undefined })
    ElMessage.success('场站分配已确认')
    confirming.open = false
    await load()
  } catch (error) {
    confirming.error = midlongFailureOf(error)
  } finally {
    confirming.busy = false
  }
}

async function discard(setId: number) {
  try {
    await discardStationAllocationSet(setId, '在合同详情废弃未确认的场站分配草稿')
    ElMessage.success('草稿已废弃')
    await load()
  } catch (error) {
    ElMessage.error(midlongFailureOf(error).message)
  }
}
</script>

<template>
  <div class="ml-panel">
    <h3>
      场站分配
      <small>主体合计与场站份额是同一义务的两种观察维度，不相加</small>
      <span class="ml-grow" />
      <el-button v-if="canCreate" size="small" type="primary" @click="openDialog('FORMAL_TRADING')">登记正式交易分解</el-button>
      <el-button v-if="canCreate" size="small" @click="openDialog('INTERNAL_OPERATING')">登记内部经营分配</el-button>
    </h3>
    <div v-if="loading && !overview" v-loading="true" class="ml-placeholder" />
    <MidlongNotice v-else-if="failure" tone="danger" title="场站分配加载失败（未显示任何替代数值）">{{ failure }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>
    <template v-else-if="overview">
      <MidlongNotice v-if="overview.contractStation" tone="info">合同已绑定场站「{{ overview.contractStation.stationName }}」，全部电量归该场站，不做场站分配。</MidlongNotice>
      <MidlongNotice v-else-if="overview.subjectId === null" tone="warn">合同未指定交易主体 / 交易单元，无法做交易单元到场站的分配。</MidlongNotice>
      <MidlongNotice v-else-if="overview.confirmationStatus !== 'CONFIRMED'" tone="info">合同核验确认后才能登记场站分配。</MidlongNotice>
      <MidlongNotice v-for="i in overview.impact" :key="i.allocationKind" tone="warn" :title="`合同更正影响：${allocationKindTag(i.allocationKind).label}`">
        {{ CORRECTION_IMPACT_LABELS[i.status] }}（v{{ i.previousRevisionNo }} 分配集 #{{ i.previousSetNo }}，失效片段：{{ i.invalidSegments.map(segmentLabel).join('、') }}）。按当前版本核对：
        {{ i.segmentsAgainstCurrent.filter((s) => i.invalidSegments.includes(s.segment)).map((s) => `${segmentLabel(s.segment)} ${s.status === 'EXCEEDS' ? `超出 ${fmtQuantity(s.excessQuantity)}` : `余额 ${fmtQuantity(s.unallocatedQuantity)}`}`).join('；') }} MWh。
        <el-button v-if="canCreate" link type="primary" @click="openDialog(i.allocationKind)">按当前版本重新登记</el-button>
      </MidlongNotice>

      <div v-for="kind in STATION_ALLOCATION_KINDS" :key="kind" class="ml-kind" :class="{ internal: kind === 'INTERNAL_OPERATING' }">
        <div class="ml-kind-head">
          <el-tag size="small" :type="allocationKindTag(kind).type">{{ allocationKindTag(kind).label }}</el-tag>
          <span v-if="overview.effective[kind]" class="ml-hint">生效分配集 #{{ overview.effective[kind]!.setNo }} · {{ STATION_SEGMENT_MODE_LABELS[overview.effective[kind]!.segmentMode] }}</span>
          <el-tag v-if="overview.effective[kind]?.inheritedFromRevisionNo" size="small" type="info">{{ inheritedLabel(overview.effective[kind]!.inheritedFromRevisionNo) }}（只含未受更正影响的片段）</el-tag>
          <span v-if="!overview.effective[kind]" class="ml-hint">当前版本尚无已确认的{{ kind === 'FORMAL_TRADING' ? '正式交易分解' : '内部经营分配' }}{{ kind === 'FORMAL_TRADING' ? '：全部电量为未分配' : '' }}</span>
        </div>
        <template v-if="overview.effective[kind]">
          <el-table :data="overview.effective[kind]!.segments" border size="small">
            <el-table-column label="片段" width="120"><template #default="{ row }">{{ segmentLabel(row.segment) }}</template></el-table-column>
            <el-table-column label="片段电量(MWh)" width="140" align="right"><template #default="{ row }">{{ fmtQuantity(row.segmentQuantity) }}</template></el-table-column>
            <el-table-column label="已分配(MWh)" width="130" align="right"><template #default="{ row }">{{ fmtQuantity(row.allocatedQuantity) }}</template></el-table-column>
            <el-table-column label="未分配余额(MWh)" min-width="140" align="right"><template #default="{ row }"><span class="ml-warn">{{ fmtQuantity(row.unallocatedQuantity) }}</span></template></el-table-column>
          </el-table>
          <el-table :data="overview.effective[kind]!.rows" border size="small">
            <el-table-column label="场站" min-width="180"><template #default="{ row }">{{ row.stationName ?? `场站 ${row.stationId}` }}</template></el-table-column>
            <el-table-column label="片段" width="120"><template #default="{ row }">{{ row.segmentMonth ? `${row.segmentMonth} 月` : '合同总量' }}</template></el-table-column>
            <el-table-column label="场站份额(MWh)" width="140" align="right"><template #default="{ row }">{{ fmtQuantity(row.quantity) }}</template></el-table-column>
          </el-table>
        </template>
      </div>

      <div v-if="drafts.length" class="ml-drafts">
        <h4>未确认的草稿</h4>
        <div v-for="d in drafts" :key="d.id" class="ml-draft">
          <el-tag size="small" :type="curveSetStatusTag(d.status).type">#{{ d.setNo }} {{ curveSetStatusTag(d.status).label }}</el-tag>
          <el-tag size="small" :type="allocationKindTag(d.allocationKind).type">{{ allocationKindTag(d.allocationKind).label }}</el-tag>
          <span :class="d.blockingIssueCount ? 'ml-danger' : 'ml-hint'">{{ d.blockingIssueCount ? `${d.blockingIssueCount} 个阻断问题（超额或片段电量未知）` : '校验通过，待确认' }}</span>
          <el-button v-if="canWrite && !d.blockingIssueCount && d.isCurrentRevision" link type="primary" @click="openConfirm(d)">确认</el-button>
          <el-button v-if="canWrite" link type="danger" @click="discard(d.id)">废弃</el-button>
        </div>
      </div>
    </template>

    <el-dialog v-model="confirming.open" title="确认场站分配" width="520px">
      <template v-if="confirming.set">
        <MidlongNotice v-if="confirming.set.allocationKind === 'INTERNAL_OPERATING'" tone="warn">内部经营分配不是正式交易分解，请写明依据。</MidlongNotice>
        <el-select v-if="confirming.set.allocationKind === 'FORMAL_TRADING'" v-model="confirming.evidenceIds" multiple placeholder="选择依据资料" style="width: 100%">
          <el-option v-for="e in basisEvidence" :key="e.id" :label="`${EVIDENCE_DOCUMENT_TYPE_LABELS[e.documentType]} · ${e.originalFileName}`" :value="e.id" />
        </el-select>
        <el-input v-else v-model="confirming.basisNote" type="textarea" :rows="2" placeholder="依据说明（必填）" />
        <MidlongNotice v-if="confirming.error" tone="danger" :title="confirming.error.message" />
      </template>
      <template #footer>
        <span v-if="confirmBlocked" class="ml-hint">{{ confirmBlocked }}</span>
        <el-button @click="confirming.open = false">取消</el-button>
        <el-button type="primary" :loading="confirming.busy" :disabled="Boolean(confirmBlocked)" @click="submitConfirm">确认</el-button>
      </template>
    </el-dialog>
    <MidlongStationAllocationDialog v-if="overview" v-model="dialogOpen" :overview="overview" :stations="stations" :evidence="evidence" :initial-kind="dialogKind" @changed="load" />
  </div>
</template>

<style scoped>
.ml-panel { border: 1px solid var(--line); border-radius: var(--radius, 8px); padding: 14px 16px; background: var(--panel); display: flex; flex-direction: column; gap: 10px; }
.ml-panel h3 { margin: 0; font-size: var(--font-16); display: flex; align-items: center; gap: 8px; }
.ml-panel h3 small { font-size: var(--font-sm); color: var(--muted); font-weight: 400; }
.ml-grow { flex: 1; }
.ml-placeholder { min-height: 120px; }
.ml-kind { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--line); border-radius: 6px; }
.ml-kind.internal { border-style: dashed; border-color: color-mix(in srgb, var(--warning) 45%, transparent); }
.ml-kind-head { display: flex; align-items: center; gap: 8px; }
.ml-hint { color: var(--muted); font-size: var(--font-sm); }
.ml-warn { color: var(--warning); }
.ml-danger { color: var(--danger); font-size: var(--font-sm); }
.ml-drafts h4 { margin: 0 0 6px; font-size: var(--font-md); }
.ml-draft { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
</style>
