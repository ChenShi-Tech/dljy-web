<script setup lang="ts">
// 交易公告详情（dljy#2973，MT-01）：全部版本（原版保留）、相邻版本差异、待核对参数、公告原文件，
// 以及引用该公告的方案与是否需要按新版本重新核对。
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import { fetchPlanningAttachment, fetchWindow } from '@/services/midlong/midlongP3Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { createLoadGuard, downloadBase64 } from '@/services/midlong/midlongFormat'
import { beijingDateTime, proposalStatusTag } from '@/services/midlong/midlongP3Format'
import { PLANNING_EVENT_TYPE_LABELS, PLANNING_NOTICES, type TradingWindowDetail } from '@/services/midlong/midlongP3Types'
import { PRODUCT_KIND_LABELS, TRADE_METHOD_LABELS } from '@/services/midlong/midlongTypes'

const props = defineProps<{ modelValue: boolean; windowId: number | null; canWrite: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; correct: [TradingWindowDetail]; openProposal: [number] }>()

const detail = ref<TradingWindowDetail | null>(null)
const failure = ref('')
const loading = ref(false)
const guard = createLoadGuard()
// 代次按「公司 + 地区 + 公告」判断：切换后旧范围的迟到结果丢弃。
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
const loadKey = () => `${scopeKey()}|${props.windowId}`

async function load() {
  if (!props.windowId) return
  const key = loadKey()
  const token = guard.begin(key)
  detail.value = null
  failure.value = ''
  loading.value = true
  try {
    const result = await fetchWindow(props.windowId)
    if (!guard.isCurrent(token, key)) return
    detail.value = result
  } catch (e) {
    if (!guard.isCurrent(token, key)) return
    failure.value = midlongFailureOf(e).message
  } finally {
    if (guard.isCurrent(token, key)) loading.value = false
  }
}

watch(() => [props.modelValue, props.windowId] as const, ([open]) => { if (open) void load() }, { immediate: true })
watch(scopeKey, () => {
  guard.begin(loadKey())
  detail.value = null
  loading.value = false
})
defineExpose({ reload: load })

async function download(attachmentId: number) {
  try {
    const file = await fetchPlanningAttachment(attachmentId)
    downloadBase64(file.attachment.originalFileName, file.contentBase64, file.attachment.mediaType ?? undefined)
  } catch (e) {
    ElMessage.error(midlongFailureOf(e).message)
  }
}

const orUnknown = (v: string | null | undefined) => v ?? '待核对'
</script>

<template>
  <el-drawer :model-value="modelValue" size="820px" title="交易公告详情" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div v-if="loading && !detail" v-loading="true" class="p3-placeholder" />
    <MidlongNotice v-else-if="failure" tone="danger" title="公告加载失败">{{ failure }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>
    <div v-else-if="detail" class="p3-detail">
      <div class="p3-actions">
        <el-tag>当前 v{{ detail.currentRevisionNo }}</el-tag>
        <el-button v-if="canWrite" type="primary" @click="emit('correct', detail)">登记更正公告</el-button>
      </div>
      <MidlongNotice tone="info">{{ detail.notice }}</MidlongNotice>

      <h4>引用该公告的方案</h4>
      <el-table :data="detail.proposals" border size="small">
        <el-table-column label="方案" width="90"><template #default="{ row }"><el-button link type="primary" @click="emit('openProposal', row.proposalId)">#{{ row.proposalId }}</el-button></template></el-table-column>
        <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag size="small" :type="proposalStatusTag(row.status).type">{{ proposalStatusTag(row.status).label }}</el-tag></template></el-table-column>
        <el-table-column label="引用版本" width="90"><template #default="{ row }">v{{ row.referencedRevisionNo }}</template></el-table-column>
        <el-table-column label="核对" min-width="220"><template #default="{ row }"><span :class="{ 'p3-warn': row.needsRecheck }">{{ row.needsRecheck ? PLANNING_NOTICES.windowRevised : '已按当前版本' }}</span></template></el-table-column>
        <template #empty>尚无方案引用该公告。</template>
      </el-table>

      <h4>版本（原版保留）</h4>
      <div v-for="r in [...detail.revisions].reverse()" :key="r.id" class="p3-revision">
        <div class="p3-revision-head">
          <b>v{{ r.revisionNo }} · {{ r.announcementName }}</b>
          <span>登记 {{ r.recordedBy ?? '未知' }} · {{ beijingDateTime(r.recordedAt) }}</span>
          <span v-if="r.changeReason">更正原因：{{ r.changeReason }}</span>
        </div>
        <div class="p3-grid">
          <span>来源：{{ orUnknown(r.sourceName) }} {{ r.sourceReference ?? '' }}</span>
          <span>发布日期：{{ orUnknown(r.publishedDate) }}</span>
          <span>公告版本：{{ orUnknown(r.announcementVersion) }}</span>
          <span>生效期：{{ orUnknown(r.effectiveFrom) }} ~ {{ orUnknown(r.effectiveTo) }}</span>
          <span>适用主体：{{ r.applicableScope ?? (r.applicableSubjectIds.length ? `${r.applicableSubjectIds.length} 个交易主体` : '待核对') }}</span>
          <span>交易方式：{{ r.tradeMethod ? TRADE_METHOD_LABELS[r.tradeMethod] : '待核对' }} · {{ r.productKind ? PRODUCT_KIND_LABELS[r.productKind] : '待核对' }}</span>
          <span>交割期：{{ orUnknown(r.deliveryStartMonth) }} ~ {{ orUnknown(r.deliveryEndMonth) }}</span>
          <span>申报：{{ beijingDateTime(r.declarationOpensAt) }} ~ {{ beijingDateTime(r.declarationClosesAt) }}</span>
          <span>确认时间：{{ beijingDateTime(r.confirmationAt) }}</span>
          <span v-if="r.attachment">原文件：<el-button link type="primary" @click="download(r.attachment.id)">{{ r.attachment.originalFileName }}</el-button></span>
        </div>
        <MidlongNotice v-if="r.pendingFields.length" tone="warn" title="待核对">
          {{ r.pendingFields.map((p) => (p.reason === 'UNSUPPORTED' ? `${p.label}（不支持：${p.raw}）` : p.label)).join('、') }}
        </MidlongNotice>
        <div v-if="r.changesFromPrevious?.length" class="p3-diff">
          相对上一版本变更：
          <div v-for="c in r.changesFromPrevious" :key="c.field">{{ c.label }}：{{ c.previous ?? '空' }} → {{ c.next ?? '空' }}</div>
        </div>
      </div>

      <h4>变更记录</h4>
      <el-timeline>
        <el-timeline-item v-for="e in detail.events" :key="e.id" :timestamp="beijingDateTime(e.occurredAt)">
          {{ PLANNING_EVENT_TYPE_LABELS[e.eventType] ?? e.eventType }}<template v-if="e.reason"> · {{ e.reason }}</template> · {{ e.actor ?? '未知' }}
        </el-timeline-item>
      </el-timeline>
    </div>
  </el-drawer>
</template>

<style scoped>
.p3-placeholder { min-height: 160px; }
.p3-detail { display: flex; flex-direction: column; gap: 10px; }
.p3-actions { display: flex; gap: 10px; align-items: center; }
.p3-detail h4 { margin: 8px 0 0; font-size: var(--font-md); }
.p3-revision { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.p3-revision-head { display: flex; gap: 12px; flex-wrap: wrap; align-items: baseline; font-size: var(--font-md); }
.p3-revision-head span { color: var(--muted); font-size: var(--font-sm); }
.p3-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 16px; font-size: var(--font-sm); }
.p3-diff { font-size: var(--font-sm); color: var(--warning); }
.p3-warn { color: var(--warning); }
</style>
