<script setup lang="ts">
// 中长期售电合同草稿录入/修改（dljy#2939）。只处理草稿与待核对合同；已确认合同走「更正」。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongEconomicsEditor from './MidlongEconomicsEditor.vue'
import MidlongNotice from './MidlongNotice.vue'
import {
  DOCUMENT_KINDS, DOCUMENT_KIND_LABELS, ENERGY_ATTRIBUTES, ENERGY_ATTRIBUTE_LABELS, MARKET_SCOPES, MARKET_SCOPE_LABELS,
  PRODUCT_KINDS, PRODUCT_KIND_LABELS, TRADE_METHODS, TRADE_METHOD_LABELS,
  type DocumentKind, type EnergyAttribute, type MarketScope, type MidlongContractDetail, type MidlongContractInput,
  type MidlongSubject, type ProductKind, type TradeMethod,
} from '@/services/midlong/midlongTypes'
import { createDraft, midlongFailureOf, updateDraft } from '@/services/midlong/midlongApi'
import { draftFromRevision, emptyEconomicsDraft, toEconomicsInput, type EconomicsDraft } from '@/services/midlong/economicsDraft'
import type { CompanyStation } from '@/services/company/companyApi'

const props = defineProps<{ modelValue: boolean; detail?: MidlongContractDetail | null; subjects: MidlongSubject[]; stations: CompanyStation[] }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [number]; conflict: [number[]] }>()

const editing = computed(() => Boolean(props.detail))
const saving = ref(false)
const serverErrors = ref<string[]>([])
const conflictIds = ref<number[]>([])

const identity = reactive({
  documentKind: 'OBLIGATION' as DocumentKind,
  productKind: 'ANNUAL' as ProductKind,
  tradeMethod: 'BILATERAL' as TradeMethod,
  marketScope: 'PROVINCIAL' as MarketScope,
  energyAttribute: 'CONVENTIONAL' as EnergyAttribute,
  contractName: '',
  externalContractNo: '',
  sourceNamespace: 'MANUAL',
  counterpartyName: '',
  signedDate: '',
  subjectId: null as number | null,
  stationId: null as number | null,
  remarks: '',
})
const economics = ref<EconomicsDraft>(emptyEconomicsDraft())
const editorRef = ref<InstanceType<typeof MidlongEconomicsEditor> | null>(null)

watch(() => props.modelValue, (open) => {
  if (!open) return
  serverErrors.value = []
  conflictIds.value = []
  const d = props.detail
  if (d) {
    Object.assign(identity, {
      documentKind: d.documentKind, productKind: d.productKind ?? 'ANNUAL', tradeMethod: d.tradeMethod ?? 'BILATERAL',
      marketScope: d.marketScope ?? 'PROVINCIAL', energyAttribute: d.energyAttribute ?? 'CONVENTIONAL', contractName: d.contractName,
      externalContractNo: d.externalContractNo, sourceNamespace: d.sourceNamespace, counterpartyName: d.counterpartyName ?? '',
      signedDate: d.signedDate ?? '', subjectId: d.subjectId, stationId: d.stationId, remarks: d.remarks ?? '',
    })
    economics.value = d.currentRevision ? draftFromRevision(d.currentRevision) : emptyEconomicsDraft()
  } else {
    Object.assign(identity, {
      documentKind: 'OBLIGATION', productKind: 'ANNUAL', tradeMethod: 'BILATERAL', marketScope: 'PROVINCIAL', energyAttribute: 'CONVENTIONAL',
      contractName: '', externalContractNo: '', sourceNamespace: 'MANUAL', counterpartyName: '', signedDate: '', subjectId: null, stationId: null, remarks: '',
    })
    economics.value = emptyEconomicsDraft()
  }
})

const canSubmit = computed(() => identity.contractName.trim() && identity.externalContractNo.trim() && !(editorRef.value?.check.errors.length))

function close() {
  emit('update:modelValue', false)
}

async function submit() {
  if (!canSubmit.value || saving.value) return
  saving.value = true
  serverErrors.value = []
  conflictIds.value = []
  const input: MidlongContractInput = {
    ...identity,
    contractName: identity.contractName.trim(),
    externalContractNo: identity.externalContractNo.trim(),
    sourceNamespace: identity.sourceNamespace.trim() || 'MANUAL',
    counterpartyName: identity.counterpartyName.trim() || null,
    signedDate: identity.signedDate || null,
    remarks: identity.remarks.trim() || null,
    economics: toEconomicsInput(economics.value),
  }
  try {
    const result = props.detail
      ? await updateDraft(props.detail.contractId, { ...input, expectedRowVersion: props.detail.rowVersion })
      : await createDraft(input)
    ElMessage.success(props.detail ? '草稿已更新' : '草稿已保存（待补资料并核验确认后才计入持仓）')
    emit('saved', result.contractId)
    close()
  } catch (error) {
    const failure = midlongFailureOf(error)
    if (failure.errorCode === 'BUSINESS_KEY_CONFLICT') {
      conflictIds.value = ((failure.details as { contractIds?: number[] } | null)?.contractIds) ?? []
      emit('conflict', conflictIds.value)
    }
    const details = failure.details as { errors?: Array<{ message: string }> } | null
    serverErrors.value = details?.errors?.length ? details.errors.map((e) => e.message) : [failure.message]
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" :title="editing ? '修改合同草稿' : '录入售电合同草稿'" width="920px" top="5vh" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div class="ml-form">
      <MidlongNotice tone="info">
        保存后为「草稿」。补充电子交易确认单、纸质合同或交易中心导出等依据并完成核验确认后，才计入月度持仓；缺价格或月度分解不阻止确认，但会持续提示。
      </MidlongNotice>
      <div class="ml-grid">
        <label class="ml-field"><span>文件类型</span>
          <el-select v-model="identity.documentKind"><el-option v-for="k in DOCUMENT_KINDS" :key="k" :label="DOCUMENT_KIND_LABELS[k]" :value="k" /></el-select>
        </label>
        <label class="ml-field"><span>交易品种周期</span>
          <el-select v-model="identity.productKind"><el-option v-for="k in PRODUCT_KINDS" :key="k" :label="PRODUCT_KIND_LABELS[k]" :value="k" /></el-select>
        </label>
        <label class="ml-field"><span>交易方式</span>
          <el-select v-model="identity.tradeMethod"><el-option v-for="k in TRADE_METHODS" :key="k" :label="TRADE_METHOD_LABELS[k]" :value="k" /></el-select>
        </label>
        <label class="ml-field"><span>市场范围</span>
          <el-select v-model="identity.marketScope"><el-option v-for="k in MARKET_SCOPES" :key="k" :label="MARKET_SCOPE_LABELS[k]" :value="k" /></el-select>
        </label>
        <label class="ml-field"><span>电能属性</span>
          <el-select v-model="identity.energyAttribute"><el-option v-for="k in ENERGY_ATTRIBUTES" :key="k" :label="ENERGY_ATTRIBUTE_LABELS[k]" :value="k" /></el-select>
        </label>
        <label class="ml-field"><span>外部合同/确认单编号</span><el-input v-model="identity.externalContractNo" placeholder="必填" /></label>
        <label class="ml-field ml-wide"><span>合同名称</span><el-input v-model="identity.contractName" placeholder="必填" /></label>
        <label class="ml-field"><span>来源</span><el-input v-model="identity.sourceNamespace" placeholder="如 MANUAL、交易中心" /></label>
        <label class="ml-field"><span>交易主体 / 交易单元</span>
          <el-select v-model="identity.subjectId" clearable filterable placeholder="核验前必须指定">
            <el-option v-for="s in subjects" :key="s.id" :label="`${s.displayName}（${s.subjectKey}）`" :value="s.id" />
          </el-select>
        </label>
        <label class="ml-field"><span>场站（可不分配）</span>
          <el-select v-model="identity.stationId" clearable filterable placeholder="主体统签可留空">
            <el-option v-for="s in stations" :key="s.id" :label="`${s.name}（${s.type}）`" :value="s.id" />
          </el-select>
        </label>
        <label class="ml-field"><span>购电方</span><el-input v-model="identity.counterpartyName" /></label>
        <label class="ml-field"><span>签订/成交日期</span><el-date-picker v-model="identity.signedDate" type="date" value-format="YYYY-MM-DD" /></label>
        <label class="ml-field ml-wide"><span>备注</span><el-input v-model="identity.remarks" /></label>
      </div>
      <MidlongEconomicsEditor ref="editorRef" v-model="economics" :document-kind="identity.documentKind" :energy-attribute="identity.energyAttribute" />
      <MidlongNotice v-if="serverErrors.length" tone="danger" title="保存未成功">
        <div v-for="(msg, i) in serverErrors" :key="i">{{ msg }}</div>
        <div v-if="conflictIds.length">
          已登记的合同：
          <router-link v-for="id in conflictIds" :key="id" :to="`/zcqjy/contracts/${id}`" class="ml-link" @click="close">#{{ id }}</router-link>
        </div>
      </MidlongNotice>
    </div>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canSubmit" @click="submit">{{ editing ? '保存修改' : '保存草稿' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ml-form { display: flex; flex-direction: column; gap: 14px; }
.ml-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 14px; }
.ml-field { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-md); color: var(--muted); }
.ml-field :deep(.el-select), .ml-field :deep(.el-date-editor) { width: 100%; }
.ml-wide { grid-column: span 2; }
.ml-link { margin-right: 8px; color: var(--accent); }
@media (max-width: 720px) { .ml-wide { grid-column: auto; } }
</style>
