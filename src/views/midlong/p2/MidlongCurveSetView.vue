<script setup lang="ts">
// 中长期售电分时分解集详情（建议路由 /zcqjy/curves/:id，dljy#2971，MP-04/MA-05）。
// - 来源可钻取：原始粒度、单位、时区、换算方法、模板容差与尾差规则、原始文件校验值；逐日合计 → 当日逐时段（原始数值 + 原始单位 + 原始行定位）。
// - 校验报告逐项列出缺段、重叠、越界、跨月、月/日不守恒；有阻断问题的草稿不能确认，超出容差只提示核对、不缩放。
// - 确认：正式资料必须选依据（或上传时已把曲线文件声明为交易中心导出 / 电子确认单）；内部估算必须写依据说明，确认后仍不计入正式持仓。
// - 合同已更正（草稿不是当前版本）或期间他人确认了重叠的分解集时，给出可操作提示，不静默覆盖。
// - 旧版本上的草稿不能再确认，但有写权限时仍可废弃，不会永远停在草稿。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import MidlongNotice from '@/components/midlong/MidlongNotice.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { CompanyNotSelectedError, fetchCapabilities, fetchContract, midlongFailureOf, type MidlongFailure } from '@/services/midlong/midlongApi'
import { confirmCurveSet, discardCurveSet, fetchCurveSet, p2ModuleOn } from '@/services/midlong/midlongP2Api'
import { EVIDENCE_DOCUMENT_TYPE_LABELS, type MidlongCapabilities, type MidlongEvidence } from '@/services/midlong/midlongTypes'
import {
  CURVE_CONVERSION_METHOD_LABELS, CURVE_GRANULARITY_LABELS, CURVE_INPUT_KIND_LABELS, CURVE_MEASURE_LABELS, P2_BASIS_EVIDENCE_TYPES,
  type CurveSetDetail,
} from '@/services/midlong/midlongP2Types'
import { createLoadGuard, fmtQuantity } from '@/services/midlong/midlongFormat'
import { basisTag, curveSetStatusTag, issueLocation } from '@/services/midlong/midlongP2Format'
import { createDialogSession } from '@/services/midlong/midlongP2Session'
// 操作导引（dljy#3405）：分解集快照与确认表单注册给「分解与场站」导引，确认成功发推进信号。
import { emitGuideSignal, useGuideForm, useGuideState } from '@/features/guide/bridge'
import { FORM, SIGNAL, STATE } from '@/features/guide/midlong/anchors'

const route = useRoute()
const router = useRouter()
const setId = computed(() => Number(route.params.id))
const selectedDate = computed(() => (typeof route.query.date === 'string' ? route.query.date : null))

type LoadState = 'loading' | 'ready' | 'no-company' | 'unsupported' | 'disabled' | 'module-off' | 'not-found' | 'failed'
const state = ref<LoadState>('loading')
const failureText = ref('')
const capabilities = ref<MidlongCapabilities | null>(null)
const detail = ref<CurveSetDetail | null>(null)
const evidence = ref<MidlongEvidence[]>([])
const guard = createLoadGuard()
const contextKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}|${setId.value}|${selectedDate.value ?? ''}`
let loadedSet = ''

async function load() {
  const token = guard.begin(contextKey())
  const setKey = `${selectedCompanyId.value}|${currentRegion.value.id}|${setId.value}`
  if (setKey !== loadedSet) detail.value = null
  loadedSet = setKey
  state.value = 'loading'
  try {
    const caps = await fetchCapabilities()
    if (!guard.isCurrent(token, contextKey())) return
    capabilities.value = caps
    if (!caps.enabled) { state.value = 'disabled'; return }
    if (!caps.regionSupported) { state.value = 'unsupported'; return }
    if (!p2ModuleOn(caps, 'curves')) { state.value = 'module-off'; return }
    const set = await fetchCurveSet(setId.value, selectedDate.value)
    const contract = set.status === 'DRAFT' && caps.canWrite ? await fetchContract(set.contractId) : null
    if (!guard.isCurrent(token, contextKey())) return
    detail.value = set
    evidence.value = contract?.evidence ?? []
    state.value = 'ready'
  } catch (error) {
    if (!guard.isCurrent(token, contextKey())) return
    detail.value = null
    if (error instanceof CompanyNotSelectedError) { state.value = 'no-company'; return }
    const f = midlongFailureOf(error)
    state.value = f.status === 404 ? 'not-found' : 'failed'
    failureText.value = f.message
  }
}

onMounted(load)
watch([selectedCompanyId, () => currentRegion.value.id, setId, selectedDate], () => void load())
watch(setId, () => {
  actionSession.renew()
  dialogs.confirm = false
  dialogs.discard = false
})

function openDate(date: string | null) {
  void router.replace({ query: date ? { ...route.query, date } : { ...route.query, date: undefined } })
}

const validation = computed(() => detail.value?.validation ?? null)
const blocking = computed(() => Boolean(detail.value && (detail.value.blockingIssueCount > 0 || validation.value?.blocking)))
// 确认要求草稿仍绑定合同当前版本；废弃不要求——合同更正后旧版本上的草稿只能废弃，否则永远停在草稿。
const canConfirm = computed(() => Boolean(capabilities.value?.canWrite && detail.value?.status === 'DRAFT' && detail.value.isCurrentRevision))
const canDiscard = computed(() => Boolean(capabilities.value?.canWrite && detail.value?.status === 'DRAFT'))
const sourceIsFormal = computed(() => {
  const p = detail.value?.provenance
  return Boolean(p && !p.copiedFrom && (p.sourceFiles?.length ?? 0) > 0 && (p.sourceDocumentType === 'TRADING_CENTER_EXPORT' || p.sourceDocumentType === 'ELECTRONIC_CONFIRMATION'))
})
const basisEvidence = computed(() => evidence.value.filter((e) => (P2_BASIS_EVIDENCE_TYPES as readonly string[]).includes(e.documentType)))

// ── 确认 / 废弃 ──────────────────────────────────────────────────────────────
const dialogs = reactive({ confirm: false, discard: false })
const confirmForm = reactive({ evidenceIds: [] as number[], note: '' })
const discardForm = reactive({ reason: '' })
const busy = ref(false)
const actionError = ref<MidlongFailure | null>(null)

// 操作会话：确认 / 废弃返回前换到另一个分解集或重新打开对话框时，旧操作的关闭与报错不作用到新会话。
const actionSession = createDialogSession()

function openConfirm() {
  actionSession.renew()
  actionError.value = null
  confirmForm.evidenceIds = [...(detail.value?.evidenceIds ?? [])]
  confirmForm.note = detail.value?.note ?? ''
  dialogs.confirm = true
}

function openDiscard() {
  actionSession.renew()
  actionError.value = null
  discardForm.reason = ''
  dialogs.discard = true
}

// 操作导引（dljy#3405）：确认表单只读注册（曲线文件声明为电子确认单时依据自动登记，导引不代填），
// 快照驱动「核对守恒 / 已确认」的推进与刷新恢复。
useGuideForm(FORM.curvesetConfirm, { read: () => ({ ...confirmForm, evidenceIds: [...confirmForm.evidenceIds] }) }, { active: () => dialogs.confirm })
useGuideState(STATE.curveSet, () => {
  const d = detail.value
  if (!d) return null
  return {
    curveSetId: d.id,
    setNo: d.setNo,
    contractId: d.contractId,
    status: d.status,
    evidenceBasis: d.evidenceBasis,
    isCurrentRevision: d.isCurrentRevision,
    blocking: Boolean(blocking.value),
    coverage: [d.coverageFromMonth, d.coverageToMonth],
    monthStatuses: (d.validation?.months ?? []).map((m) => ({ month: m.month, status: m.status })),
  }
})

const confirmBlockedReason = computed(() => {
  const d = detail.value
  if (!d) return ''
  if (blocking.value) return '存在阻断问题，不能确认'
  if (d.evidenceBasis === 'FORMAL' && !confirmForm.evidenceIds.length && !sourceIsFormal.value) return '正式分时分解必须选择依据资料'
  if (d.evidenceBasis === 'INTERNAL_ESTIMATE' && !confirmForm.note.trim()) return '内部估算必须写明估算依据'
  return ''
})

const ACTION_HINTS: Record<string, string> = {
  PREVIEW_STALE: '合同已更正为新版本，本草稿基于旧版本，不能确认；请回到合同详情按当前版本重新登记或沿用原曲线。',
  VERSION_CONFLICT: '草稿创建后已有他人确认了覆盖相同月份的分解集；请刷新核对后重新登记，避免覆盖对方刚确认的结果。',
  INCOMPLETE_BASIS: '依据不完整。',
  CONFIRMED_WRITE_PROTECTED: '该分解集已确认或已废弃，不能再操作。',
}

async function run(name: 'confirm' | 'discard', action: () => Promise<unknown>, success: string): Promise<boolean> {
  if (busy.value) return false
  const token = actionSession.begin(String(setId.value))
  const current = () => actionSession.isCurrent(token, String(setId.value))
  busy.value = true
  actionError.value = null
  try {
    await action()
    ElMessage.success(success)
    if (!current()) return true
    dialogs[name] = false
    await load()
    return true
  } catch (error) {
    if (current()) actionError.value = midlongFailureOf(error)
    return false
  } finally {
    busy.value = false
  }
}

function submitConfirm() {
  if (confirmBlockedReason.value || !detail.value) return
  const d = detail.value
  void run('confirm', () => confirmCurveSet(d.id, { evidenceIds: confirmForm.evidenceIds, note: confirmForm.note.trim() || undefined }),
    d.evidenceBasis === 'FORMAL' ? '分时分解已确认，将计入正式分时持仓' : '内部估算已保存（不计入正式分时持仓）')
    .then((ok) => { if (ok) emitGuideSignal(SIGNAL.curveSetConfirmed, { contractId: d.contractId, curveSetId: d.id }) })
}

function submitDiscard() {
  if (!discardForm.reason.trim() || !detail.value) return
  const d = detail.value
  void run('discard', () => discardCurveSet(d.id, discardForm.reason.trim()), '草稿已废弃')
}
</script>

<template>
  <div class="ml-page">
    <div class="ml-head">
      <router-link v-if="detail" :to="`/zcqjy/contracts/${detail.contractId}`" class="ml-link">← 合同 {{ detail.contract.externalContractNo }}</router-link>
      <h2 class="ml-title">分时分解集{{ detail ? ` #${detail.setNo}` : '' }}</h2>
      <template v-if="detail">
        <el-tag :type="curveSetStatusTag(detail.status).type">{{ curveSetStatusTag(detail.status).label }}</el-tag>
        <el-tag :type="basisTag(detail.evidenceBasis).type">{{ basisTag(detail.evidenceBasis).label }}</el-tag>
      </template>
    </div>
    <CompanyScopeBar />

    <div v-if="state === 'loading' && !detail" v-loading="true" class="ml-placeholder" />
    <MidlongNotice v-else-if="state === 'no-company'" tone="warn" title="请选择公司">当前地区尚未选择有效公司。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'unsupported'" tone="info" title="当前地区未开通中长期售电模块">{{ capabilities?.reason }}。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'disabled'" tone="warn" title="模块已暂停使用">已确认的分解集保持不变。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'module-off'" tone="info" title="分时分解尚未开通" />
    <MidlongNotice v-else-if="state === 'not-found'" tone="warn" title="分解集不存在或不属于当前公司、当前地区">{{ failureText }}</MidlongNotice>
    <MidlongNotice v-else-if="state === 'failed'" tone="danger" title="加载失败（未显示任何替代数值）">{{ failureText }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>

    <template v-if="detail && validation && (state === 'ready' || state === 'loading')">
      <MidlongNotice v-if="!detail.isCurrentRevision" tone="warn" title="绑定的不是合同当前版本">
        本分解集绑定合同版本 v{{ detail.revisionNo }}，合同当前为 v{{ detail.contract.currentRevisionNo }}。
        <template v-if="detail.status === 'DRAFT'">草稿不能再确认，请按当前版本重新登记；不再需要时可以废弃。</template>
        <template v-else>未受更正影响且月量不变的月份在当前版本沿用（合同详情标「沿用 v{{ detail.revisionNo }}」），受影响月份不再采用。</template>
      </MidlongNotice>
      <MidlongNotice v-if="detail.evidenceBasis === 'INTERNAL_ESTIMATE'" tone="warn" title="内部估算">
        由估算工具或内部资料生成，确认后也不计入正式分时持仓，不覆盖正式资料。
      </MidlongNotice>
      <MidlongNotice v-if="detail.status === 'DRAFT' && blocking" tone="danger" title="存在阻断问题，不能确认">
        缺段、重叠、越界、跨月或不守恒必须回到原始资料核对后重新导入；系统不会自动补零或缩放。
      </MidlongNotice>

      <div class="ml-actions">
        <el-button v-if="canConfirm" type="primary" :disabled="blocking" data-guide="ml-curveset-confirm" @click="openConfirm">确认</el-button>
        <el-button v-if="canDiscard" @click="openDiscard">废弃草稿</el-button>
      </div>

      <div class="ml-panel">
        <h3>来源与换算</h3>
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="合同">{{ detail.contract.externalContractNo }} {{ detail.contract.contractName }}</el-descriptions-item>
          <el-descriptions-item label="绑定版本">v{{ detail.revisionNo }}</el-descriptions-item>
          <el-descriptions-item label="覆盖月份">{{ detail.coverageFromMonth }} ~ {{ detail.coverageToMonth }}</el-descriptions-item>
          <el-descriptions-item label="输入形式">{{ CURVE_INPUT_KIND_LABELS[detail.inputKind] }}</el-descriptions-item>
          <el-descriptions-item label="原始粒度">{{ CURVE_GRANULARITY_LABELS[detail.granularityMinutes] }}</el-descriptions-item>
          <el-descriptions-item label="原始单位">{{ detail.sourceUnit }}（{{ CURVE_MEASURE_LABELS[detail.sourceMeasure] }}）</el-descriptions-item>
          <el-descriptions-item label="换算方法">{{ CURVE_CONVERSION_METHOD_LABELS[detail.conversionMethod] }}</el-descriptions-item>
          <el-descriptions-item label="原始时区">{{ detail.sourceTimezone }}（已换算为北京时间 [开始, 结束)）</el-descriptions-item>
          <el-descriptions-item label="时段 / 合计">{{ detail.intervalCount }} 个 · {{ fmtQuantity(detail.totalQuantity) }} MWh</el-descriptions-item>
          <el-descriptions-item label="模板">{{ detail.template?.label ?? detail.templateCode }}</el-descriptions-item>
          <el-descriptions-item label="守恒容差">{{ detail.tolerance }} MWh</el-descriptions-item>
          <el-descriptions-item label="完整度">{{ validation.completeness === 'COMPLETE' ? '覆盖范围内时段完整' : `缺 ${validation.missingIntervalCount} 个时段` }}</el-descriptions-item>
          <el-descriptions-item label="尾差 / 舍入规则" :span="3">{{ detail.template?.roundingRuleText ?? detail.roundingRule }}</el-descriptions-item>
          <el-descriptions-item label="原始文件" :span="3">
            <span v-if="detail.provenance.copiedFrom">沿用分解集 #{{ detail.provenance.copiedFrom.setNo }}（合同版本 v{{ detail.provenance.copiedFrom.revisionNo }}）；</span>
            <span v-for="f in detail.provenance.sourceFiles ?? []" :key="f.sha256" class="ml-file">{{ f.fileName }} · {{ (f.byteSize / 1024).toFixed(1) }} KB · <span class="ml-mono">{{ f.sha256.slice(0, 12) }}</span></span>
            <span v-if="detail.provenance.sourceDocumentType">（声明为 {{ EVIDENCE_DOCUMENT_TYPE_LABELS[detail.provenance.sourceDocumentType] }}）</span>
            <span v-if="detail.provenance.estimate">估算方法：{{ detail.provenance.estimate.method === 'FLAT' ? '按时段均分' : '按典型日权重分摊' }}</span>
            <span v-if="!detail.provenance.sourceFiles?.length && !detail.provenance.copiedFrom && !detail.provenance.estimate">接口提交的逐时段数据</span>
          </el-descriptions-item>
          <el-descriptions-item label="依据资料" :span="2">{{ detail.evidenceIds.length ? detail.evidenceIds.map((id) => `#${id}`).join('、') : '—' }}</el-descriptions-item>
          <el-descriptions-item label="说明">{{ detail.note ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="录入">{{ detail.recordedBy ?? '—' }} · {{ new Date(detail.recordedAt).toLocaleString('zh-CN') }}</el-descriptions-item>
          <el-descriptions-item label="确认">{{ detail.confirmedAt ? `${detail.confirmedBy ?? '—'} · ${new Date(detail.confirmedAt).toLocaleString('zh-CN')}` : '—' }}</el-descriptions-item>
          <el-descriptions-item label="废弃">{{ detail.discardedAt ? `${detail.discardReason ?? ''}（${new Date(detail.discardedAt).toLocaleString('zh-CN')}）` : '—' }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <div class="ml-panel" data-guide="ml-curveset-checks">
        <h3>守恒核对</h3>
        <el-table :data="validation.months" border size="small">
          <el-table-column prop="month" label="月份" width="100" />
          <el-table-column label="曲线合计(MWh)" width="140" align="right"><template #default="{ row }">{{ fmtQuantity(row.curveQuantity) }}</template></el-table-column>
          <el-table-column label="正式月度分解(MWh)" width="160" align="right"><template #default="{ row }">{{ row.formalQuantity === null ? '月量未知' : fmtQuantity(row.formalQuantity) }}</template></el-table-column>
          <el-table-column label="差额" width="110" align="right"><template #default="{ row }">{{ row.difference === null ? '—' : fmtQuantity(row.difference) }}</template></el-table-column>
          <el-table-column label="结论" width="140">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 'CONSERVED' ? 'success' : row.status === 'WITHIN_TOLERANCE' ? 'warning' : 'danger'">
                {{ { CONSERVED: '守恒', WITHIN_TOLERANCE: '容差内', NOT_CONSERVED: '不守恒（不缩放）', MONTH_UNKNOWN: '月量未知' }[row.status as 'CONSERVED'] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="时段（实际 / 应有 / 缺 / 已知零）" min-width="220"><template #default="{ row }">{{ row.intervalCount }} / {{ row.expectedIntervalCount }} / {{ row.missingIntervalCount }} / {{ row.zeroIntervalCount }}</template></el-table-column>
        </el-table>
      </div>

      <div v-if="validation.summary.length" class="ml-panel">
        <h3>校验问题 <small>阻断 {{ validation.blockingCount }} · 提示 {{ validation.warningCount }}</small></h3>
        <div class="ml-summary">
          <el-tag v-for="s in validation.summary" :key="s.code" size="small" :type="s.severity === 'blocking' ? 'danger' : 'warning'">{{ s.label }} × {{ s.count }}</el-tag>
        </div>
        <el-table :data="validation.issues" border size="small" max-height="320">
          <el-table-column label="级别" width="70"><template #default="{ row }">{{ row.severity === 'blocking' ? '阻断' : '提示' }}</template></el-table-column>
          <el-table-column label="定位" min-width="240"><template #default="{ row }">{{ issueLocation(row) }}</template></el-table-column>
          <el-table-column prop="message" label="说明" min-width="360" />
        </el-table>
        <MidlongNotice v-if="validation.truncated" tone="info">问题较多，明细只列前 300 条（每类最多 50 条）；计数不截断。</MidlongNotice>
      </div>

      <div class="ml-panel">
        <h3>逐日合计 <small>点击日期查看当日逐时段与原始行</small></h3>
        <el-table :data="detail.days" border size="small" max-height="320" highlight-current-row @row-click="(row: CurveSetDetail['days'][number]) => openDate(row.date)">
          <el-table-column prop="date" label="日期" width="120" />
          <el-table-column label="合计(MWh)" width="140" align="right"><template #default="{ row }">{{ fmtQuantity(row.quantity) }}</template></el-table-column>
          <el-table-column prop="intervalCount" label="时段数" width="90" align="right" />
          <el-table-column prop="zeroIntervalCount" label="已知零时段" width="100" align="right" />
        </el-table>
      </div>

      <div v-if="detail.date" class="ml-panel">
        <h3>{{ detail.date }} 逐时段 <el-button link @click="openDate(null)">收起</el-button></h3>
        <el-table :data="detail.intervals ?? []" border size="small" max-height="420">
          <el-table-column label="时段" width="180"><template #default="{ row }">{{ row.start.slice(11, 16) }} ~ {{ row.end.slice(11, 16) }}</template></el-table-column>
          <el-table-column label="电量(MWh)" width="130" align="right"><template #default="{ row }">{{ fmtQuantity(row.quantity) }}</template></el-table-column>
          <el-table-column label="原始数值（原写法）" width="160" align="right"><template #default="{ row }">{{ row.sourceText ?? row.sourceValue }} {{ row.sourceUnit }}</template></el-table-column>
          <el-table-column prop="sourceRef" label="原始资料定位" min-width="260" />
          <template #empty>当日没有时段数据（缺时段按未知处理）。</template>
        </el-table>
      </div>
    </template>

    <el-dialog v-model="dialogs.confirm" title="确认分时分解" width="560px">
      <MidlongNotice v-if="detail?.evidenceBasis === 'FORMAL'" tone="info">确认后按月计入正式分时持仓；同月已有的旧分解集保留在历史视图。</MidlongNotice>
      <MidlongNotice v-else tone="warn">内部估算确认后仍不计入正式分时持仓，请写明估算依据。</MidlongNotice>
      <el-form label-width="96px" class="ml-form">
        <el-form-item v-if="detail?.evidenceBasis === 'FORMAL'" label="依据资料" data-guide="ml-curveset-evidence">
          <el-select v-model="confirmForm.evidenceIds" multiple placeholder="选择合同已有资料" style="width: 100%">
            <el-option v-for="e in basisEvidence" :key="e.id" :label="`${EVIDENCE_DOCUMENT_TYPE_LABELS[e.documentType]} · ${e.originalFileName}`" :value="e.id" />
          </el-select>
          <div v-if="sourceIsFormal" class="ml-hint">曲线文件已声明为正式资料，确认时会登记到合同资料并作为依据。</div>
        </el-form-item>
        <el-form-item :label="detail?.evidenceBasis === 'FORMAL' ? '说明' : '估算依据'">
          <el-input v-model="confirmForm.note" type="textarea" :rows="2" maxlength="500" show-word-limit />
        </el-form-item>
      </el-form>
      <MidlongNotice v-if="actionError" tone="danger" :title="actionError.message">{{ ACTION_HINTS[actionError.errorCode] ?? '' }}</MidlongNotice>
      <template #footer>
        <span v-if="confirmBlockedReason" class="ml-hint">{{ confirmBlockedReason }}</span>
        <el-button @click="dialogs.confirm = false">取消</el-button>
        <el-button type="primary" :loading="busy" :disabled="Boolean(confirmBlockedReason)" data-guide="ml-curveset-confirm" @click="submitConfirm">确认</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="dialogs.discard" title="废弃草稿" width="480px">
      <el-input v-model="discardForm.reason" type="textarea" :rows="2" placeholder="废弃原因（必填）" maxlength="300" />
      <MidlongNotice v-if="actionError" tone="danger" :title="actionError.message">{{ ACTION_HINTS[actionError.errorCode] ?? '' }}</MidlongNotice>
      <template #footer>
        <el-button @click="dialogs.discard = false">取消</el-button>
        <el-button type="danger" :loading="busy" :disabled="!discardForm.reason.trim()" @click="submitDiscard">废弃</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ml-page { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.ml-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ml-title { margin: 0; font-size: var(--font-20); }
.ml-placeholder { min-height: 200px; }
.ml-actions { display: flex; gap: 8px; }
.ml-panel { border: 1px solid var(--line); border-radius: var(--radius, 8px); padding: 14px 16px; background: var(--panel); }
.ml-panel h3 { margin: 0 0 10px; font-size: var(--font-16); display: flex; align-items: baseline; gap: 8px; }
.ml-panel h3 small { font-size: var(--font-sm); color: var(--muted); font-weight: 400; }
.ml-summary { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.ml-link { color: var(--accent); text-decoration: none; }
.ml-hint { color: var(--muted); font-size: var(--font-sm); margin-right: 8px; }
.ml-mono { font-family: var(--font-mono, monospace); }
.ml-file { margin-right: 10px; }
.ml-form { margin-top: 10px; }
</style>
