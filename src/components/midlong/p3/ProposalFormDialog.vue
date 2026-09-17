<script setup lang="ts">
// 交易方案草稿（dljy#2973，MS-03/MS-05）：主体、交易窗口（公告版本）、按月交割片段与拟售电量、报价与价格口径、
// 交易方式、负责人、理由。缺依据也能保存草稿；确认可执行在详情里单独操作（后端校验依据与可安排计划量）。
// 方案是内部安排，保存草稿不建立占用、不进入正式持仓。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import { createProposal, updateProposalDraft, type ProposalWriteResult } from '@/services/midlong/midlongP3Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { PLANNING_NOTICES, type TradeProposalDetail, type TradingWindowListRow } from '@/services/midlong/midlongP3Types'
import {
  PRICE_COMPONENTS, PRICE_COMPONENT_LABELS, PRODUCT_KINDS, PRODUCT_KIND_LABELS, TAX_BASES, TAX_BASIS_LABELS, TRADE_METHODS, TRADE_METHOD_LABELS,
  type MidlongSubject, type PriceComponent, type ProductKind, type TaxBasis, type TradeMethod,
} from '@/services/midlong/midlongTypes'

const props = defineProps<{ modelValue: boolean; proposal: TradeProposalDetail | null; subjects: MidlongSubject[]; windows: TradingWindowListRow[] }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [ProposalWriteResult] }>()

const blank = () => ({
  subjectId: null as number | null, windowId: null as number | null, productKind: '' as ProductKind | '', tradeMethod: '' as TradeMethod | '',
  proposedPrice: '', priceTaxBasis: 'UNKNOWN' as TaxBasis, priceComponent: 'UNVERIFIED' as PriceComponent, ownerName: '', rationale: '',
  segments: [{ deliveryMonth: '', quantity: '' }] as Array<{ deliveryMonth: string; quantity: string }>,
})
const form = reactive(blank())
const saving = ref(false)
const error = ref('')

watch(() => props.modelValue, (open) => {
  if (!open) return
  Object.assign(form, blank())
  error.value = ''
  const p = props.proposal
  if (p) {
    Object.assign(form, {
      subjectId: p.subjectId, windowId: p.windowId, productKind: p.productKind ?? '', tradeMethod: p.tradeMethod ?? '', proposedPrice: p.proposedPrice ?? '',
      priceTaxBasis: p.priceTaxBasis, priceComponent: p.priceComponent, ownerName: p.ownerName ?? '', rationale: p.rationale ?? '',
      segments: p.segments.map((s) => ({ deliveryMonth: s.deliveryMonth, quantity: s.quantity })),
    })
  }
}, { immediate: true })

const selectedWindow = computed(() => props.windows.find((w) => w.id === form.windowId) ?? null)
const valid = computed(() => Boolean(form.subjectId) && form.segments.length > 0 && form.segments.every((s) => s.deliveryMonth && s.quantity.trim()))
const text = (v: string) => (v.trim() === '' ? null : v.trim())

function addSegment() {
  form.segments.push({ deliveryMonth: '', quantity: '' })
}
function removeSegment(index: number) {
  form.segments.splice(index, 1)
}

async function submit() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = ''
  const input = {
    subjectId: form.subjectId as number,
    // 改选窗口时引用其当前版本；沿用原窗口时保留方案原引用的版本（不在编辑时悄悄改成新版本）。
    windowId: form.windowId,
    windowRevisionNo: form.windowId !== null && props.proposal?.windowId === form.windowId ? props.proposal.windowRevisionNo : null,
    productKind: form.productKind || null, tradeMethod: form.tradeMethod || null, proposedPrice: text(form.proposedPrice),
    priceTaxBasis: form.priceTaxBasis, priceComponent: form.priceComponent, ownerName: text(form.ownerName), rationale: text(form.rationale),
    segments: form.segments.map((s) => ({ deliveryMonth: s.deliveryMonth, quantity: s.quantity.trim() })),
  }
  try {
    const result = props.proposal
      ? await updateProposalDraft(props.proposal.id, { ...input, expectedRowVersion: props.proposal.rowVersion })
      : await createProposal(input)
    ElMessage.success('方案草稿已保存（未建立占用）')
    emit('saved', result)
    emit('update:modelValue', false)
  } catch (e) {
    error.value = midlongFailureOf(e).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" :title="proposal ? `修改方案草稿 #${proposal.id}` : '新建交易方案草稿'" width="720px" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <MidlongNotice tone="info">{{ PLANNING_NOTICES.occupation }}</MidlongNotice>
    <el-form label-width="110px" class="p3-form" @submit.prevent>
      <el-form-item label="交易主体" required>
        <el-select v-model="form.subjectId" filterable placeholder="选择交易主体" style="width: 100%">
          <el-option v-for="s in subjects" :key="s.id" :label="`${s.displayName}（${s.subjectKey}）`" :value="s.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="交易窗口">
        <el-select v-model="form.windowId" clearable filterable placeholder="关联已登记的公告（确认前必选）" style="width: 100%">
          <el-option v-for="w in windows" :key="w.id" :label="`${w.current.announcementName}（v${w.currentRevisionNo}）`" :value="w.id" />
        </el-select>
        <div v-if="selectedWindow && selectedWindow.current.pendingFields.length" class="p3-hint">公告待核对：{{ selectedWindow.current.pendingFields.map((p) => p.label).join('、') }}</div>
      </el-form-item>
      <el-form-item label="交割片段" required>
        <div class="p3-segments">
          <div v-for="(s, i) in form.segments" :key="i" class="p3-segment">
            <el-date-picker v-model="s.deliveryMonth" type="month" value-format="YYYY-MM" placeholder="交割月" style="width: 140px" />
            <el-input v-model="s.quantity" placeholder="拟售电量 MWh" style="width: 160px" />
            <el-button link type="danger" :disabled="form.segments.length === 1" @click="removeSegment(i)">删除</el-button>
          </div>
          <el-button link type="primary" @click="addSegment">+ 增加交割月</el-button>
        </div>
      </el-form-item>
      <el-form-item label="交易方式">
        <el-select v-model="form.tradeMethod" clearable placeholder="确认前必填" style="width: 160px">
          <el-option v-for="k in TRADE_METHODS" :key="k" :label="TRADE_METHOD_LABELS[k]" :value="k" />
        </el-select>
        <el-select v-model="form.productKind" clearable placeholder="品种周期" style="width: 120px; margin-left: 8px">
          <el-option v-for="k in PRODUCT_KINDS" :key="k" :label="PRODUCT_KIND_LABELS[k]" :value="k" />
        </el-select>
      </el-form-item>
      <el-form-item label="报价/价格">
        <el-input v-model="form.proposedPrice" placeholder="元/MWh（可空）" style="width: 140px" />
        <el-select v-model="form.priceTaxBasis" style="width: 100px; margin-left: 8px">
          <el-option v-for="t in TAX_BASES" :key="t" :label="TAX_BASIS_LABELS[t]" :value="t" />
        </el-select>
        <el-select v-model="form.priceComponent" style="width: 190px; margin-left: 8px">
          <el-option v-for="t in PRICE_COMPONENTS" :key="t" :label="PRICE_COMPONENT_LABELS[t]" :value="t" />
        </el-select>
      </el-form-item>
      <el-form-item label="负责人"><el-input v-model="form.ownerName" placeholder="确认前必填" /></el-form-item>
      <el-form-item label="方案理由"><el-input v-model="form.rationale" type="textarea" :rows="2" placeholder="确认前必填" /></el-form-item>
    </el-form>
    <MidlongNotice v-if="error" tone="danger">{{ error }}</MidlongNotice>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!valid" @click="submit">保存草稿</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.p3-form { margin-top: 12px; }
.p3-segments { display: flex; flex-direction: column; gap: 6px; }
.p3-segment { display: flex; gap: 8px; align-items: center; }
.p3-hint { font-size: var(--font-sm); color: var(--warning); margin-top: 4px; }
</style>
