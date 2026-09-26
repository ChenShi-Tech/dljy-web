<script setup lang="ts">
// 外部账单详情抽屉（dljy#3016，MR-02/03）：当前有效版本口径的金额与凭证、全部版本链（含各版分项，旧版保留可查）、
// 差异摘要（含「需重新核对」状态）、事件时间线；操作 = 修订（业务键不可换）与登记收款凭证。
import { computed, ref, watch } from 'vue'
import MidlongNotice from '../MidlongNotice.vue'
import BillFormDialog from './BillFormDialog.vue'
import VoucherFormDialog from './VoucherFormDialog.vue'
import { fetchBill } from '@/services/midlong/midlongP5Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { captureScope } from '@/services/midlong/midlongP3Scope'
import { createLoadGuard, fmtAmount, fmtQuantity } from '@/services/midlong/midlongFormat'
import { beijingDateTime } from '@/services/midlong/midlongP3Format'
import { billAmountText, billKindTag, billPeriodLabel, discrepancyStatusTag, voucherText } from '@/services/midlong/midlongP5Format'
import { SETTLEMENT_EVENT_TYPE_LABELS, SETTLEMENT_NOTICES, type BillDetailDto } from '@/services/midlong/midlongP5Types'
import { PRICE_COMPONENT_LABELS, TAX_BASIS_LABELS, type MidlongSubject } from '@/services/midlong/midlongTypes'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'

const props = defineProps<{ modelValue: boolean; billId: number | null; canWrite: boolean; subjects: MidlongSubject[] }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; changed: [] }>()

const detail = ref<BillDetailDto | null>(null)
const loading = ref(false)
const failure = ref('')
const reviseDialog = ref(false)
const voucherDialog = ref(false)
let viewGeneration = 0
const guard = createLoadGuard()
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
const loadKey = () => `${scopeKey()}|${props.billId}`
let detailScope = ''

async function load() {
  if (!props.billId) return
  const key = loadKey()
  const token = guard.begin(key)
  failure.value = ''
  loading.value = true
  if (detail.value?.id !== props.billId) detail.value = null
  try {
    const d = await fetchBill(props.billId)
    if (!guard.isCurrent(token, key)) return
    detail.value = d
    detailScope = scopeKey()
  } catch (e) {
    if (!guard.isCurrent(token, key)) return
    failure.value = midlongFailureOf(e).message
  } finally {
    if (guard.isCurrent(token, key)) loading.value = false
  }
}

function resetView() {
  viewGeneration += 1
  reviseDialog.value = false
  voucherDialog.value = false
}

watch(() => [props.modelValue, props.billId] as const, ([open]) => {
  resetView()
  if (open) void load()
}, { immediate: true })

watch(scopeKey, () => {
  resetView()
  guard.begin(loadKey())
  detail.value = null
  loading.value = false
})
defineExpose({ reload: load })

/** 详情内写操作完成后的重载：请求发出前核对范围，避免换公司后的迟到写入落到新范围。 */
async function afterWrite() {
  const at = viewGeneration
  const scope = captureScope()
  try {
    if (scope.key !== detailScope) throw new Error('公司或地区已切换，请重新打开账单核对')
    emit('changed')
    await load()
  } finally {
    if (at !== viewGeneration) loading.value = false
  }
}

const currentRevision = computed(() => detail.value?.revisions.find((r) => r.revisionNo === detail.value?.currentRevisionNo) ?? null)
const sortedRevisions = computed(() => [...(detail.value?.revisions ?? [])].reverse())
</script>

<template>
  <el-drawer :model-value="modelValue" title="外部账单详情" size="800px" append-to-body @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div v-if="loading" v-loading="true" class="p5-drawer" />
    <div v-else-if="failure" class="p5-drawer">
      <MidlongNotice tone="danger" title="账单加载失败">{{ failure }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>
    </div>
    <div v-else-if="detail" class="p5-drawer">
      <div class="p5-head">
        <h3>{{ detail.subjectName ?? `主体 #${detail.subjectId}` }} · <span class="p5-mono">{{ detail.sourceNamespace }} / {{ detail.externalBillNo }}</span></h3>
        <div class="p5-row">
          <el-tag :type="billKindTag(detail.billKind).type">{{ billKindTag(detail.billKind).label }}</el-tag>
          <el-tag effect="plain">当前版本 v{{ detail.currentRevisionNo }}（共 {{ detail.revisionCount }} 版）</el-tag>
          <el-tag effect="plain" type="info">{{ billPeriodLabel(detail.periodStartMonth, detail.periodEndMonth) }}</el-tag>
          <span v-if="detail.externalRevisionLabel" class="p5-muted">外部修订标识：{{ detail.externalRevisionLabel }}</span>
        </div>
        <div class="p5-muted">
          {{ currentRevision ? `金额口径：${currentRevision.currency} · ${TAX_BASIS_LABELS[currentRevision.taxBasis as keyof typeof TAX_BASIS_LABELS] ?? currentRevision.taxBasis} · ${PRICE_COMPONENT_LABELS[currentRevision.priceComponent as keyof typeof PRICE_COMPONENT_LABELS] ?? currentRevision.priceComponent}` : '' }}
        </div>
      </div>

      <MidlongNotice v-for="notice in detail.notices" :key="notice" tone="info">{{ notice }}</MidlongNotice>

      <div class="p5-section">
        <h4>金额与到账（当前有效版本口径，两版不双计）</h4>
        <div class="p5-row" data-test="bill-current-amounts">
          <span>整单 {{ fmtAmount(detail.amount) }} 元；<template v-if="detail.billKind !== 'UNITEMIZED'">分项合计 {{ fmtAmount(detail.lineItemAmount) }} 元 / 分项电量 {{ fmtQuantity(detail.lineItemQuantity) }} MWh；</template></span>
          <span>收款凭证：{{ voucherText(detail) }}</span>
        </div>
        <div v-if="detail.openDiscrepancyCount || detail.recheckDiscrepancyCount" class="p5-warn" data-test="bill-discrepancy-counts">
          差异：待处理 {{ detail.openDiscrepancyCount }} · 需重新核对 {{ detail.recheckDiscrepancyCount }}（{{ SETTLEMENT_NOTICES.billRevisionRecheck }}）
        </div>
      </div>

      <div class="p5-section">
        <h4>收款凭证（只追加；无凭证不显示到账）</h4>
        <el-table v-if="detail.vouchers.length" :data="detail.vouchers" border size="small">
          <el-table-column label="凭证编号" min-width="140"><template #default="{ row }"><span class="p5-mono">{{ row.voucherNo }}</span></template></el-table-column>
          <el-table-column label="金额(元)" width="120" align="right"><template #default="{ row }">{{ fmtAmount(row.amount) }}</template></el-table-column>
          <el-table-column label="收款日期" width="120"><template #default="{ row }">{{ row.receivedAt }}</template></el-table-column>
          <el-table-column label="登记" width="150"><template #default="{ row }">{{ beijingDateTime(row.createdAt) }}</template></el-table-column>
          <el-table-column label="备注" min-width="140"><template #default="{ row }">{{ row.note ?? '—' }}</template></el-table-column>
          <template #empty>无凭证（未显示到账）。</template>
        </el-table>
        <div v-else class="p5-muted">无凭证（未显示到账）——账单金额本身不代表已收款。</div>
      </div>

      <div class="p5-section">
        <h4>版本链（旧版保留可查；金额聚合只取当前有效版本）</h4>
        <el-table :data="sortedRevisions" border size="small">
          <el-table-column label="版本" width="120">
            <template #default="{ row }">v{{ row.revisionNo }}<el-tag v-if="row.revisionNo === detail.currentRevisionNo" size="small" type="success">当前有效</el-tag><template v-if="row.supersedesRevisionNo !== null"><span class="p5-muted">（替代 v{{ row.supersedesRevisionNo }}）</span></template></template>
          </el-table-column>
          <el-table-column label="形态" width="110"><template #default="{ row }">{{ billKindTag(row.billKind).label }}</template></el-table-column>
          <el-table-column label="期间" width="150"><template #default="{ row }">{{ billPeriodLabel(row.periodStartMonth, row.periodEndMonth) }}</template></el-table-column>
          <el-table-column label="整单金额(元)" width="120" align="right"><template #default="{ row }">{{ fmtAmount(row.amount) }}</template></el-table-column>
          <el-table-column label="分项合计(元)" width="120" align="right"><template #default="{ row }">{{ row.lineItemAmount === null ? '—' : fmtAmount(row.lineItemAmount) }}</template></el-table-column>
          <el-table-column label="修订原因 / 说明" min-width="200"><template #default="{ row }">{{ row.changeReason ?? '首次登记' }}<template v-if="row.externalRevisionLabel"> · 外部标识 {{ row.externalRevisionLabel }}</template></template></el-table-column>
          <el-table-column label="登记" width="150"><template #default="{ row }">{{ beijingDateTime(row.recordedAt) }}</template></el-table-column>
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="p5-items">
                <template v-if="row.lineItems.length">
                  <div v-for="item in row.lineItems" :key="item.id" class="p5-muted">
                    {{ item.deliveryMonth ?? '期间合计' }} · 电量 {{ fmtQuantity(item.quantity) }} MWh · 单价 {{ item.price === null ? '未知' : `${item.price} 元/MWh` }} · 金额 {{ fmtAmount(item.amount) }} 元{{ item.note ? ` · ${item.note}` : '' }}
                  </div>
                </template>
                <div v-else class="p5-muted">该版本无分项（综合账单未分项归档：不对综合总额做任何比例拆分或推算）。</div>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="p5-section">
        <h4>差异摘要</h4>
        <el-table v-if="detail.discrepancies.length" :data="detail.discrepancies" border size="small">
          <el-table-column label="差异" width="70"><template #default="{ row }">#{{ row.id }}</template></el-table-column>
          <el-table-column label="交割月" width="100"><template #default="{ row }">{{ row.deliveryMonth ?? '未知' }}</template></el-table-column>
          <el-table-column label="状态" width="180"><template #default="{ row }"><el-tag size="small" :type="discrepancyStatusTag(row.status).type">{{ discrepancyStatusTag(row.status).label }}</el-tag></template></el-table-column>
          <el-table-column label="量差(MWh)" width="120" align="right"><template #default="{ row }">{{ row.quantityDelta === null ? '未知' : row.quantityDelta }}</template></el-table-column>
          <el-table-column label="价差(元/MWh)" width="120" align="right"><template #default="{ row }">{{ row.priceDelta === null ? '不可比/未知' : row.priceDelta }}</template></el-table-column>
          <template #empty>无差异记录。</template>
        </el-table>
        <div v-else class="p5-muted">无差异记录。</div>
      </div>

      <div class="p5-section">
        <h4>事件</h4>
        <el-timeline>
          <el-timeline-item v-for="event in detail.events" :key="event.id" :timestamp="beijingDateTime(event.occurredAt)" placement="top">
            {{ SETTLEMENT_EVENT_TYPE_LABELS[event.eventType as keyof typeof SETTLEMENT_EVENT_TYPE_LABELS] ?? event.eventType }}<template v-if="event.revisionNo !== null"> · v{{ event.revisionNo }}</template><template v-if="event.actor"> · {{ event.actor }}</template><template v-if="event.reason"> · {{ event.reason }}</template>
          </el-timeline-item>
        </el-timeline>
      </div>

      <div v-if="canWrite" class="p5-actions">
        <el-button type="primary" plain data-test="revise-bill" @click="reviseDialog = true">修订（新版本，旧版保留）</el-button>
        <el-button plain data-test="add-voucher" @click="voucherDialog = true">登记收款凭证</el-button>
      </div>
      <div class="p5-muted">当前口径提示：{{ billAmountText({ billKind: detail.billKind, amount: detail.amount, lineItemAmount: detail.lineItemAmount }) }}</div>
    </div>

    <BillFormDialog v-if="detail" v-model="reviseDialog" :subjects="subjects" :bill="detail" @saved="afterWrite" />
    <VoucherFormDialog v-if="detail" v-model="voucherDialog" :bill-id="detail.id" :bill-label="`${detail.sourceNamespace} / ${detail.externalBillNo}`" @saved="afterWrite" />
  </el-drawer>
</template>

<style scoped>
.p5-drawer { display: flex; flex-direction: column; gap: 12px; padding: 0 4px; }
.p5-head { display: flex; flex-direction: column; gap: 6px; }
.p5-head h3 { margin: 0; font-size: var(--font-18); display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.p5-section { border-top: 1px dashed var(--line); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.p5-section h4 { margin: 0; font-size: var(--font-md); }
.p5-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: var(--font-md); font-variant-numeric: tabular-nums; }
.p5-items { display: flex; flex-direction: column; gap: 4px; padding: 4px 8px; }
.p5-actions { display: flex; gap: 8px; flex-wrap: wrap; border-top: 1px dashed var(--line); padding-top: 10px; }
.p5-muted { color: var(--muted); font-size: var(--font-sm); }
.p5-warn { color: var(--warning); font-size: var(--font-md); }
.p5-mono { font-family: var(--font-mono, monospace); font-size: var(--font-sm); }
</style>
