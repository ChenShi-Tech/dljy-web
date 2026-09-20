<script setup lang="ts">
// 复盘报告详情抽屉（dljy#3016，MR-05）：版本列表（元数据 + 事件）、按版本查看冻结快照全文
// （inputFreeze 输入版本集合 + 指标快照——旧报告数值不变，迟到修订只追加新版本）、
// 逐版本导出 CSV（从冻结快照渲染，与归档一致；同版本两次导出逐字一致）。
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import ReviewMetricsPanel from './ReviewMetricsPanel.vue'
import { exportReport, fetchReport, fetchReportVersion } from '@/services/midlong/midlongP5Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { captureScope } from '@/services/midlong/midlongP3Scope'
import { beijingDateTime } from '@/services/midlong/midlongP3Format'
import { createLoadGuard, downloadCsv } from '@/services/midlong/midlongFormat'
import { reportScopeLabel, settlementFailureText } from '@/services/midlong/midlongP5Format'
import { SETTLEMENT_EVENT_TYPE_LABELS, SETTLEMENT_NOTICES, type ReviewMetrics, type ReviewReportDetail, type ReviewReportVersionSnapshot } from '@/services/midlong/midlongP5Types'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'

const props = defineProps<{ modelValue: boolean; reportId: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const detail = ref<ReviewReportDetail | null>(null)
const snapshot = ref<ReviewReportVersionSnapshot | null>(null)
const loading = ref(false)
const failure = ref('')
const snapshotFailure = ref('')
const exporting = ref(0)
const guard = createLoadGuard()
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
const loadKey = () => `${scopeKey()}|${props.reportId}`
let detailScope = ''

async function load() {
  if (!props.reportId) return
  const key = loadKey()
  const token = guard.begin(key)
  failure.value = ''
  snapshotFailure.value = ''
  loading.value = true
  if (detail.value?.id !== props.reportId) { detail.value = null; snapshot.value = null }
  try {
    const d = await fetchReport(props.reportId)
    if (!guard.isCurrent(token, key)) return
    detail.value = d
    detailScope = scopeKey()
    // 报告主档已就绪：详情 loading 先退出，再单独按版本取快照（loadVersion 自带代次守卫）。
    loading.value = false
    await loadVersion(d.currentVersionNo)
  } catch (e) {
    if (!guard.isCurrent(token, key)) return
    failure.value = midlongFailureOf(e).message
    loading.value = false
  }
}

/** 冻结快照按版本只读：旧版本数值不变，切版本不触发重新计算。 */
async function loadVersion(versionNo: number) {
  if (!props.reportId) return
  const key = `${loadKey()}|v${versionNo}`
  const token = guard.begin(key)
  snapshotFailure.value = ''
  snapshot.value = null
  try {
    const snap = await fetchReportVersion(props.reportId, versionNo)
    if (!guard.isCurrent(token, key)) return
    snapshot.value = snap
  } catch (e) {
    if (!guard.isCurrent(token, key)) return
    snapshotFailure.value = midlongFailureOf(e).message
  }
}

async function exportVersion(versionNo: number) {
  if (!props.reportId || exporting.value) return
  const scope = captureScope()
  exporting.value = versionNo
  try {
    if (scope.key !== detailScope) throw new Error('公司或地区已切换，已放弃本次导出')
    const result = await exportReport(props.reportId, versionNo)
    scope.assertCurrent()
    downloadCsv(result.fileName, result.content)
    ElMessage.success(`已导出 ${result.fileName}（从冻结快照渲染，与归档一致）`)
  } catch (e) {
    const f = midlongFailureOf(e)
    ElMessage.error(settlementFailureText(f.errorCode, f.message, f.details))
  } finally {
    exporting.value = 0
  }
}

watch(() => [props.modelValue, props.reportId] as const, ([open]) => {
  if (open) void load()
}, { immediate: true })

watch(scopeKey, () => {
  guard.begin(loadKey())
  detail.value = null
  snapshot.value = null
  loading.value = false
})

const inputFreezeLines = computed(() => {
  const freeze = snapshot.value?.inputFreeze
  if (!freeze) return []
  return [
    `asOf ${freeze.asOf ? beijingDateTime(freeze.asOf) : '当前'}`,
    `合同 ${Object.keys(freeze.contracts ?? {}).length} 项 · 计划 ${Object.keys(freeze.plans ?? {}).length} 项 · 成交确认 ${Object.keys(freeze.confirmations ?? {}).length} 项 · 账单 ${Object.keys(freeze.bills ?? {}).length} 项`,
  ]
})
</script>

<template>
  <el-drawer :model-value="modelValue" title="复盘报告详情（冻结版本）" size="880px" append-to-body @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div v-if="loading" v-loading="true" class="p5-drawer" />
    <div v-else-if="failure" class="p5-drawer">
      <MidlongNotice tone="danger" title="报告加载失败">{{ failure }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>
    </div>
    <div v-else-if="detail" class="p5-drawer">
      <div class="p5-head">
        <h3>{{ detail.reportMonth }} · {{ reportScopeLabel(detail.scope, detail.subjectName) }}</h3>
        <div class="p5-row">
          <el-tag>当前版本 v{{ detail.currentVersionNo }}</el-tag>
          <el-tag effect="plain">共 {{ detail.versionCount ?? detail.versions.length }} 个版本</el-tag>
          <span class="p5-muted">最近生成 {{ beijingDateTime(detail.generatedAt) }} · {{ detail.generatedBy ?? '—' }}</span>
        </div>
        <div v-if="detail.currentChangeReason" class="p5-muted">当前版本变更说明：{{ detail.currentChangeReason }}</div>
      </div>

      <MidlongNotice tone="info">{{ SETTLEMENT_NOTICES.reportFrozen }}</MidlongNotice>

      <div class="p5-section">
        <h4>版本列表（只追加；旧版本数值不变）</h4>
        <el-table :data="detail.versions" border size="small" @row-click="(row: ReviewReportDetail['versions'][number]) => loadVersion(row.versionNo)">
          <el-table-column label="版本" width="70"><template #default="{ row }">v{{ row.versionNo }}<el-tag v-if="row.versionNo === detail.currentVersionNo" size="small" type="success">当前</el-tag></template></el-table-column>
          <el-table-column label="变更说明" min-width="240"><template #default="{ row }">{{ row.changeReason ?? '—' }}</template></el-table-column>
          <el-table-column label="输入引用" width="200"><template #default="{ row }">合同 {{ row.inputs.contracts }} · 计划 {{ row.inputs.plans }} · 确认 {{ row.inputs.confirmations }} · 账单 {{ row.inputs.bills }}</template></el-table-column>
          <el-table-column label="生成" width="150"><template #default="{ row }">{{ beijingDateTime(row.generatedAt) }}</template></el-table-column>
          <el-table-column label="导出" width="90">
            <template #default="{ row }">
              <el-button link type="primary" size="small" :loading="exporting === row.versionNo" data-test="report-export" @click.stop="exportVersion(row.versionNo)">CSV</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-if="snapshotFailure" class="p5-section">
        <MidlongNotice tone="danger" title="版本快照加载失败">{{ snapshotFailure }}</MidlongNotice>
      </div>

      <template v-if="snapshot">
        <div class="p5-section">
          <h4 data-test="snapshot-title">冻结快照：v{{ snapshot.versionNo }}<template v-if="snapshot.supersedesVersionNo !== null">（替代 v{{ snapshot.supersedesVersionNo }}）</template></h4>
          <div v-for="line in inputFreezeLines" :key="line" class="p5-muted">{{ line }}</div>
          <div v-if="snapshot.note" class="p5-muted">生成说明：{{ snapshot.note }}</div>
        </div>
        <!-- 后端冻结的是完整指标快照（metrics 整体落库）；Partial 仅为缺版本的兜底类型。 -->
        <ReviewMetricsPanel :metrics="snapshot.metrics as ReviewMetrics" />
      </template>

      <div class="p5-section">
        <h4>报告事件</h4>
        <el-timeline>
          <el-timeline-item v-for="event in detail.events" :key="event.id" :timestamp="beijingDateTime(event.occurredAt)" placement="top">
            {{ SETTLEMENT_EVENT_TYPE_LABELS[event.eventType as keyof typeof SETTLEMENT_EVENT_TYPE_LABELS] ?? event.eventType }}<template v-if="event.revisionNo !== null"> · v{{ event.revisionNo }}</template><template v-if="event.actor"> · {{ event.actor }}</template><template v-if="event.reason"> · {{ event.reason }}</template>
          </el-timeline-item>
        </el-timeline>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.p5-drawer { display: flex; flex-direction: column; gap: 12px; padding: 0 4px; }
.p5-head { display: flex; flex-direction: column; gap: 6px; }
.p5-head h3 { margin: 0; font-size: var(--font-18); }
.p5-section { border-top: 1px dashed var(--line); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.p5-section h4 { margin: 0; font-size: var(--font-md); }
.p5-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.p5-muted { color: var(--muted); font-size: var(--font-sm); }
</style>
