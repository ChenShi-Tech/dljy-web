<script setup lang="ts">
// 交易单元 → 场站分配（dljy#2971，MP-05）：填写分配行 → 实时按共享规则预览片段余额与超额 → 保存草稿 → 附依据确认。
// - 片段 = 合同总量或某交割月的正式月度电量；分配合计超过片段电量时标出超出量，不能确认，原分配保持不变。
// - 未分配余额始终可见；主体合计与场站份额是同一义务的拆分，不相加。
// - 正式交易分解必须附依据资料；内部经营分配必须写依据说明，并与正式分解区别展示。
// - 两类分配各自是整套快照：切换分配类型时，分配行、片段方式与依据都按新类型的当前生效分配重新预填，
//   不把上一类型的行带过去（否则确认后会用错类型的行替换该类型的整套分配）；草稿保存后表单锁定，类型不能再改。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import { midlongFailureOf, type MidlongFailure } from '@/services/midlong/midlongApi'
import { confirmStationAllocationSet, createStationAllocationDraft } from '@/services/midlong/midlongP2Api'
import { EVIDENCE_DOCUMENT_TYPE_LABELS, deliveryMonths, type MidlongEvidence } from '@/services/midlong/midlongTypes'
import {
  P2_BASIS_EVIDENCE_TYPES, STATION_ALLOCATION_KIND_LABELS, STATION_SEGMENT_MODE_LABELS, validateStationAllocations,
  type ContractStationAllocationsOverview, type StationAllocationDraftResult, type StationAllocationKind, type StationSegment, type StationSegmentMode,
} from '@/services/midlong/midlongP2Types'
import { fmtQuantity } from '@/services/midlong/midlongFormat'
import { segmentLabel } from '@/services/midlong/midlongP2Format'

const props = defineProps<{
  modelValue: boolean
  overview: ContractStationAllocationsOverview
  stations: Array<{ id: number; name: string }>
  evidence: MidlongEvidence[]
  initialKind?: StationAllocationKind
}>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; changed: [] }>()

type Row = { stationId: number | null; segmentMonth: string; quantity: string }
const form = reactive({ allocationKind: 'FORMAL_TRADING' as StationAllocationKind, segmentMode: 'CONTRACT_TOTAL' as StationSegmentMode, rows: [] as Row[], basisNote: '', evidenceIds: [] as number[] })
const busy = ref(false)
const failure = ref<MidlongFailure | null>(null)
const draft = ref<StationAllocationDraftResult | null>(null)
const switchedKind = ref<StationAllocationKind | null>(null)

/** 按某类分配的当前生效集预填：新分配集是完整快照，追加场站时在原分配上改，而不是另起一份相加。 */
function prefill(kind: StationAllocationKind) {
  const effective = props.overview.effective[kind]
  form.allocationKind = kind
  form.segmentMode = effective?.segmentMode ?? 'CONTRACT_TOTAL'
  form.rows = effective?.rows.map((r) => ({ stationId: r.stationId, segmentMonth: r.segmentMonth ?? '', quantity: r.quantity })) ?? [{ stationId: null, segmentMonth: '', quantity: '' }]
  form.basisNote = ''
  form.evidenceIds = []
  failure.value = null
}

watch(() => props.modelValue, (open) => {
  if (!open) return
  prefill(props.initialKind ?? 'FORMAL_TRADING')
  switchedKind.value = null
  draft.value = null
})

function onKindChange(kind: string | number | boolean | undefined) {
  if (draft.value) return
  prefill(kind as StationAllocationKind)
  switchedKind.value = kind as StationAllocationKind
}

const stationOptions = computed(() => {
  const mapped = props.overview.subjectStations
  if (mapped.length) return mapped.map((s) => ({ id: s.stationId, name: s.stationName ?? `场站 ${s.stationId}` }))
  return props.stations
})
const months = computed(() => deliveryMonths(props.overview.deliveryStart, props.overview.deliveryEnd))
const revision = computed(() => ({
  deliveryStart: props.overview.deliveryStart,
  deliveryEnd: props.overview.deliveryEnd,
  totalQuantity: props.overview.totalQuantity,
  allocations: Object.entries(props.overview.monthlyFormal).map(([deliveryMonth, quantity]) => ({ deliveryMonth, quantity, evidenceBasis: 'FORMAL' as const })),
}))
const preview = computed(() => validateStationAllocations({
  segmentMode: form.segmentMode,
  revision: revision.value,
  rows: form.rows.map((r) => ({ stationId: r.stationId, segmentMonth: form.segmentMode === 'MONTHLY' ? r.segmentMonth : null, quantity: r.quantity })),
}))
const segments = computed<StationSegment[]>(() => draft.value?.validation.segments ?? preview.value.segments)
const basisEvidence = computed(() => props.evidence.filter((e) => (P2_BASIS_EVIDENCE_TYPES as readonly string[]).includes(e.documentType)))
const confirmBlocked = computed(() => {
  if (!draft.value) return ''
  if (draft.value.validation.blocking) return '草稿有阻断问题（超额或片段电量未知），不能确认'
  if (form.allocationKind === 'FORMAL_TRADING' && !form.evidenceIds.length) return '正式交易分解必须选择依据资料'
  if (form.allocationKind === 'INTERNAL_OPERATING' && !form.basisNote.trim()) return '内部经营分配必须写明依据'
  return ''
})

function addRow() {
  form.rows.push({ stationId: null, segmentMonth: form.segmentMode === 'MONTHLY' ? months.value[0] ?? '' : '', quantity: '' })
}

async function saveDraft() {
  if (busy.value) return
  busy.value = true
  failure.value = null
  try {
    draft.value = await createStationAllocationDraft(props.overview.contractId, {
      expectedRevisionNo: props.overview.currentRevisionNo,
      allocationKind: form.allocationKind,
      segmentMode: form.segmentMode,
      rows: form.rows.map((r) => ({ stationId: Number(r.stationId), segmentMonth: form.segmentMode === 'MONTHLY' ? r.segmentMonth : null, quantity: r.quantity })),
      basisNote: form.basisNote.trim() || undefined,
      evidenceIds: form.evidenceIds,
    })
    emit('changed')
  } catch (error) {
    failure.value = midlongFailureOf(error)
  } finally {
    busy.value = false
  }
}

async function confirm() {
  if (!draft.value || confirmBlocked.value || busy.value) return
  busy.value = true
  failure.value = null
  try {
    await confirmStationAllocationSet(draft.value.allocationSetId, { evidenceIds: form.evidenceIds, basisNote: form.basisNote.trim() || undefined })
    ElMessage.success(form.allocationKind === 'FORMAL_TRADING' ? '场站分配已确认，场站维度持仓按新分配拆分' : '内部经营分配已确认（不作为正式交易分解）')
    emit('changed')
    emit('update:modelValue', false)
  } catch (error) {
    failure.value = midlongFailureOf(error)
  } finally {
    busy.value = false
  }
}

const failureDetails = computed(() => failure.value?.details as { segments?: StationSegment[]; currentEffective?: { setNo: number; segments: StationSegment[] } | null } | null)
</script>

<template>
  <el-dialog :model-value="modelValue" title="登记场站分配" width="780px" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <MidlongNotice tone="info">
      合同电量 {{ fmtQuantity(overview.totalQuantity) }} MWh 由交易单元统签；场站份额是同一义务的拆分，分配合计不得超过片段电量，剩余为未分配。新分配集是完整快照，确认后替换当前生效的同类分配。
    </MidlongNotice>
    <el-form label-width="96px" class="ml-form" :disabled="Boolean(draft)">
      <el-form-item label="分配类型">
        <el-radio-group v-model="form.allocationKind" @change="onKindChange">
          <el-radio value="FORMAL_TRADING">{{ STATION_ALLOCATION_KIND_LABELS.FORMAL_TRADING }}</el-radio>
          <el-radio value="INTERNAL_OPERATING">{{ STATION_ALLOCATION_KIND_LABELS.INTERNAL_OPERATING }}（非正式交易分解）</el-radio>
        </el-radio-group>
        <div v-if="switchedKind" class="ml-hint ml-switched">已按「{{ STATION_ALLOCATION_KIND_LABELS[switchedKind] }}」当前生效的分配重新预填分配行、片段与依据；切换前未保存的修改不会带到这一类。</div>
      </el-form-item>
      <el-form-item label="分配片段">
        <el-radio-group v-model="form.segmentMode">
          <el-radio v-for="(label, mode) in STATION_SEGMENT_MODE_LABELS" :key="mode" :value="mode">{{ label }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="分配行">
        <div class="ml-rows">
          <div v-for="(row, index) in form.rows" :key="index" class="ml-row">
            <el-select v-model="row.stationId" placeholder="场站" filterable style="width: 200px">
              <el-option v-for="s in stationOptions" :key="s.id" :label="s.name" :value="s.id" />
            </el-select>
            <el-select v-if="form.segmentMode === 'MONTHLY'" v-model="row.segmentMonth" placeholder="交割月" style="width: 120px">
              <el-option v-for="m in months" :key="m" :label="m" :value="m" />
            </el-select>
            <el-input v-model="row.quantity" placeholder="电量" style="width: 150px"><template #append>MWh</template></el-input>
            <el-button link type="danger" @click="form.rows.splice(index, 1)">删除</el-button>
          </div>
          <el-button link type="primary" @click="addRow">+ 添加场站</el-button>
          <div v-if="!overview.subjectStations.length" class="ml-hint">交易单元尚未登记所属场站，候选为本公司全部场站；请以依据资料为准。</div>
        </div>
      </el-form-item>
    </el-form>
    <el-form label-width="96px">
      <el-form-item :label="form.allocationKind === 'FORMAL_TRADING' ? '依据资料' : '依据说明'">
        <el-select v-if="form.allocationKind === 'FORMAL_TRADING'" v-model="form.evidenceIds" multiple placeholder="选择合同已有资料" style="width: 100%">
          <el-option v-for="e in basisEvidence" :key="e.id" :label="`${EVIDENCE_DOCUMENT_TYPE_LABELS[e.documentType]} · ${e.originalFileName}`" :value="e.id" />
        </el-select>
        <el-input v-else v-model="form.basisNote" type="textarea" :rows="2" placeholder="内部经营分配的依据（必填）" maxlength="500" />
      </el-form-item>
    </el-form>

    <el-table :data="segments" border size="small" class="ml-segments">
      <el-table-column label="片段" width="120"><template #default="{ row }">{{ segmentLabel(row.segment) }}</template></el-table-column>
      <el-table-column label="片段电量(MWh)" width="140" align="right"><template #default="{ row }">{{ row.segmentQuantity === null ? '未知（不能确认）' : fmtQuantity(row.segmentQuantity) }}</template></el-table-column>
      <el-table-column label="已分配" width="120" align="right"><template #default="{ row }">{{ fmtQuantity(row.allocatedQuantity) }}</template></el-table-column>
      <el-table-column label="未分配余额" width="120" align="right"><template #default="{ row }"><span class="ml-warn">{{ row.unallocatedQuantity === null ? '—' : fmtQuantity(row.unallocatedQuantity) }}</span></template></el-table-column>
      <el-table-column label="超出" min-width="120" align="right"><template #default="{ row }"><span :class="{ 'ml-danger': row.status === 'EXCEEDS' }">{{ row.status === 'EXCEEDS' ? `超出 ${fmtQuantity(row.excessQuantity)}` : '—' }}</span></template></el-table-column>
      <template #empty>添加分配行后显示片段余额。</template>
    </el-table>
    <div v-if="!draft && preview.summary.length" class="ml-summary">
      <el-tag v-for="s in preview.summary" :key="s.code" size="small" :type="s.severity === 'blocking' ? 'danger' : 'warning'">{{ s.label }} × {{ s.count }}</el-tag>
    </div>

    <MidlongNotice v-if="draft" :tone="draft.validation.blocking ? 'danger' : 'info'" :title="draft.validation.blocking ? `草稿 #${draft.setNo} 已保存，但有阻断问题，不能确认` : `草稿 #${draft.setNo} 已保存，确认后生效`">
      草稿不改变场站维度持仓。
    </MidlongNotice>
    <MidlongNotice v-if="failure" tone="danger" :title="failure.message">
      <template v-if="failureDetails?.currentEffective">当前生效的分配（#{{ failureDetails.currentEffective.setNo }}）保持不变，可分配余额：{{ failureDetails.currentEffective.segments.map((s) => `${segmentLabel(s.segment)} ${fmtQuantity(s.unallocatedQuantity)} MWh`).join('；') }}。</template>
      <template v-if="failure.errorCode === 'VERSION_CONFLICT'">期间他人已确认了新的分配，或合同已更正；请关闭后刷新核对。</template>
    </MidlongNotice>

    <template #footer>
      <span v-if="confirmBlocked" class="ml-hint">{{ confirmBlocked }}</span>
      <el-button @click="emit('update:modelValue', false)">{{ draft ? '关闭' : '取消' }}</el-button>
      <el-button v-if="!draft" type="primary" :loading="busy" :disabled="!form.rows.length" @click="saveDraft">保存草稿并校验</el-button>
      <el-button v-else type="primary" :loading="busy" :disabled="Boolean(confirmBlocked)" @click="confirm">确认分配</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ml-form { margin-top: 12px; }
.ml-rows { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.ml-row { display: flex; gap: 8px; align-items: center; }
.ml-hint { color: var(--muted); font-size: var(--font-sm); margin-right: 8px; }
.ml-summary { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.ml-segments { margin-top: 6px; }
.ml-switched { width: 100%; }
.ml-warn { color: var(--warning); }
.ml-danger { color: var(--danger); font-weight: 600; }
</style>
