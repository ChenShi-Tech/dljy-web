<script setup lang="ts">
// 分时曲线导入（dljy#2971，MP-04）：选择标准模板文件 → 显式声明粒度 / 单位 / 原始时区 / 覆盖月份 / 依据 → 保存为草稿并校验。
// - 原始时区与单位必须显式选择，不默认；表头括号里的单位与声明不一致时后端拒绝。
// - 模板容差与尾差规则在对话框里公示；校验结果逐月给出曲线合计与正式月度分解，不守恒只提示核对、不缩放。
// - 保存草稿不等于确认：草稿不计入分时持仓，确认在分解集详情页完成。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import { midlongFailureOf, type MidlongFailure } from '@/services/midlong/midlongApi'
import { createCurveDraft, fetchCurveTemplate } from '@/services/midlong/midlongP2Api'
import { EVIDENCE_DOCUMENT_TYPE_LABELS, type EvidenceBasis, type MidlongEvidence } from '@/services/midlong/midlongTypes'
import {
  CURVE_FILE_SHEETS, CURVE_GRANULARITIES, CURVE_GRANULARITY_LABELS, CURVE_SOURCE_DOCUMENT_TYPES, CURVE_STANDARD_TEMPLATE, CURVE_TEMPLATES, CURVE_UNITS,
  P2_BASIS_EVIDENCE_TYPES, type CurveDraftResult, type CurveFileRole, type CurveGranularity, type CurveSourceDocumentType,
} from '@/services/midlong/midlongP2Types'
import { downloadBase64, downloadCsv, fileToBase64, fmtQuantity, oversizeUploadMessage } from '@/services/midlong/midlongFormat'
import { rangeValue } from '@/services/midlong/midlongP2Format'
import { STALE_DIALOG_WRITE_MESSAGE, createDialogSession } from '@/services/midlong/midlongP2Session'

const props = defineProps<{ modelValue: boolean; contractId: number; revisionNo: number; deliveryStart: string | null; deliveryEnd: string | null; evidence: MidlongEvidence[] }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; created: [CurveDraftResult] }>()

type CsvRole = Exclude<CurveFileRole, 'workbook'>
const format = ref<'xlsx' | 'csv'>('xlsx')
const files = reactive<Record<CurveFileRole, File | null>>({ workbook: null, intervals: null, typicalDays: null, typicalDayRanges: null, dailyTotals: null })
const form = reactive({
  evidenceBasis: 'FORMAL' as EvidenceBasis,
  granularityMinutes: null as CurveGranularity | null,
  unit: '',
  sourceTimezone: '',
  coverage: [] as string[],
  sourceDocumentType: 'IMPORT_SOURCE_FILE' as CurveSourceDocumentType,
  evidenceIds: [] as number[],
  note: '',
})
const busy = ref(false)
const failure = ref<MidlongFailure | null>(null)
const result = ref<CurveDraftResult | null>(null)
const template = CURVE_TEMPLATES[CURVE_STANDARD_TEMPLATE]
const TIMEZONES = [{ value: 'Asia/Shanghai', label: 'Asia/Shanghai（北京时间）' }, { value: 'UTC', label: 'UTC' }]
const CSV_ROLES: CsvRole[] = ['intervals', 'typicalDays', 'typicalDayRanges', 'dailyTotals']

const session = createDialogSession()
const targetKey = () => `${props.contractId}|${props.revisionNo}`

watch(() => props.modelValue, (open) => {
  session.renew()
  if (!open) return
  for (const key of Object.keys(files) as CurveFileRole[]) files[key] = null
  Object.assign(form, { evidenceBasis: 'FORMAL', granularityMinutes: null, unit: '', sourceTimezone: '', sourceDocumentType: 'IMPORT_SOURCE_FILE', evidenceIds: [], note: '' })
  form.coverage = props.deliveryStart && props.deliveryEnd ? [props.deliveryStart.slice(0, 7), props.deliveryStart.slice(0, 7)] : []
  failure.value = null
  result.value = null
})

function onFile(role: CurveFileRole, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  const oversize = file ? oversizeUploadMessage(file) : null
  if (oversize) {
    failure.value = { status: 413, errorCode: 'VALIDATION_FAILED', message: oversize, details: null }
    files[role] = null
    input.value = ''
    return
  }
  files[role] = file
}

const basisEvidence = computed(() => props.evidence.filter((e) => (P2_BASIS_EVIDENCE_TYPES as readonly string[]).includes(e.documentType)))
const missing = computed(() => {
  const out: string[] = []
  if (format.value === 'xlsx' ? !files.workbook : !(files.intervals || files.typicalDays)) out.push('曲线文件')
  if (!form.granularityMinutes) out.push('原始粒度')
  if (!form.unit) out.push('单位')
  if (!form.sourceTimezone) out.push('原始时区')
  if (form.coverage.length !== 2) out.push('覆盖月份')
  return out
})

async function downloadTemplate(kind: 'xlsx' | 'csv') {
  try {
    const t = await fetchCurveTemplate(kind)
    for (const f of t.files) {
      if (f.contentBase64) downloadBase64(f.fileName, f.contentBase64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      else if (f.content !== undefined) downloadCsv(f.fileName, f.content)
    }
  } catch (error) {
    ElMessage.error(midlongFailureOf(error).message)
  }
}

async function submit() {
  if (missing.value.length || busy.value) return
  // 读文件之前快照写入目标、声明与待读文件：读取期间关闭、重开或切到另一份合同，读完也不写到新对象上。
  const token = session.begin(targetKey())
  const contractId = props.contractId
  const body = {
    expectedRevisionNo: props.revisionNo,
    evidenceBasis: form.evidenceBasis,
    coverageFromMonth: form.coverage[0],
    coverageToMonth: form.coverage[1],
    granularityMinutes: form.granularityMinutes ?? undefined,
    unit: form.unit,
    sourceTimezone: form.sourceTimezone,
    sourceDocumentType: form.sourceDocumentType,
    evidenceIds: [...form.evidenceIds],
    note: form.note.trim() || undefined,
  }
  const roles: CurveFileRole[] = format.value === 'xlsx' ? ['workbook'] : CSV_ROLES
  const selected = roles.map((role) => [role, files[role]] as const).filter((entry): entry is readonly [CurveFileRole, File] => entry[1] !== null)
  busy.value = true
  failure.value = null
  try {
    const payload: Array<{ role: CurveFileRole; fileName: string; contentBase64: string }> = []
    for (const [role, file] of selected) payload.push({ role, fileName: file.name, contentBase64: await fileToBase64(file) })
    if (!session.isCurrent(token, targetKey())) { ElMessage.warning(STALE_DIALOG_WRITE_MESSAGE); return }
    const created = await createCurveDraft(contractId, { ...body, files: payload })
    // 草稿已保存：通知父级刷新；会话已变时不把旧结果显示到新会话里。
    emit('created', created)
    if (session.isCurrent(token, targetKey())) result.value = created
  } catch (error) {
    if (session.isCurrent(token, targetKey())) failure.value = midlongFailureOf(error)
  } finally {
    busy.value = false
  }
}

const STATUS_TEXT: Record<string, string> = { CONSERVED: '守恒', WITHIN_TOLERANCE: '容差内', NOT_CONSERVED: '不守恒（不缩放）', MONTH_UNKNOWN: '月量未知' }
</script>

<template>
  <el-dialog :model-value="modelValue" title="导入分时曲线" width="760px" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <template v-if="!result">
      <MidlongNotice tone="info" :title="template.label">
        守恒容差 {{ template.tolerance }} MWh（软件舍入容差，不是业务偏差许可）。{{ template.roundingRuleText }}
        <el-button link type="primary" @click="downloadTemplate('xlsx')">下载 Excel 模板</el-button>
        <el-button link type="primary" @click="downloadTemplate('csv')">下载 CSV 模板</el-button>
      </MidlongNotice>
      <el-form label-width="110px" class="ml-form">
        <el-form-item label="文件格式">
          <el-radio-group v-model="format"><el-radio value="xlsx">Excel 工作簿</el-radio><el-radio value="csv">CSV 文件</el-radio></el-radio-group>
        </el-form-item>
        <el-form-item v-if="format === 'xlsx'" label="工作簿">
          <input type="file" accept=".xlsx" data-role="workbook" @change="onFile('workbook', $event)" />
          <span class="ml-hint">含「{{ CURVE_FILE_SHEETS.intervals }}」或「{{ CURVE_FILE_SHEETS.typicalDays }}」+「{{ CURVE_FILE_SHEETS.typicalDayRanges }}」，可选「{{ CURVE_FILE_SHEETS.dailyTotals }}」；典型日可按峰平谷时刻段填写功率（跨零点的谷段可写 22:00—08:00）</span>
        </el-form-item>
        <template v-else>
          <el-form-item v-for="role in CSV_ROLES" :key="role" :label="CURVE_FILE_SHEETS[role]">
            <input type="file" accept=".csv" :data-role="role" @change="onFile(role, $event)" />
          </el-form-item>
        </template>
        <el-form-item label="依据类型">
          <el-radio-group v-model="form.evidenceBasis"><el-radio value="FORMAL">正式资料</el-radio><el-radio value="INTERNAL_ESTIMATE">内部估算（不计入正式持仓）</el-radio></el-radio-group>
        </el-form-item>
        <el-form-item label="原始粒度" required>
          <el-select v-model="form.granularityMinutes" placeholder="请选择" style="width: 160px">
            <el-option v-for="g in CURVE_GRANULARITIES" :key="g" :label="CURVE_GRANULARITY_LABELS[g]" :value="g" />
          </el-select>
        </el-form-item>
        <el-form-item label="单位" required>
          <el-select v-model="form.unit" placeholder="请选择（功率按时长换算）" style="width: 260px">
            <el-option v-for="(spec, unit) in CURVE_UNITS" :key="unit" :label="`${unit}（${spec.measure === 'POWER' ? '功率' : '电量'}）`" :value="unit" />
          </el-select>
        </el-form-item>
        <el-form-item label="原始时区" required>
          <el-select v-model="form.sourceTimezone" placeholder="必须声明，不默认" style="width: 260px">
            <el-option v-for="tz in TIMEZONES" :key="tz.value" :label="tz.label" :value="tz.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="覆盖月份" required>
          <el-date-picker :model-value="form.coverage" type="monthrange" @update:model-value="(v: unknown) => (form.coverage = rangeValue(v))" value-format="YYYY-MM" range-separator="至" start-placeholder="起始月" end-placeholder="结束月" style="width: 240px" />
          <span class="ml-hint">交割期 {{ deliveryStart ?? '—' }} ~ {{ deliveryEnd ?? '—' }}</span>
        </el-form-item>
        <el-form-item v-if="form.evidenceBasis === 'FORMAL'" label="文件性质">
          <el-select v-model="form.sourceDocumentType" style="width: 260px">
            <el-option v-for="t in CURVE_SOURCE_DOCUMENT_TYPES" :key="t" :label="EVIDENCE_DOCUMENT_TYPE_LABELS[t]" :value="t" />
          </el-select>
          <span class="ml-hint">声明为交易中心导出或电子确认单时，确认时登记为合同资料并作依据</span>
        </el-form-item>
        <el-form-item v-if="form.evidenceBasis === 'FORMAL'" label="依据资料">
          <el-select v-model="form.evidenceIds" multiple placeholder="可在确认时再选" style="width: 100%">
            <el-option v-for="e in basisEvidence" :key="e.id" :label="`${EVIDENCE_DOCUMENT_TYPE_LABELS[e.documentType]} · ${e.originalFileName}`" :value="e.id" />
          </el-select>
        </el-form-item>
        <el-form-item :label="form.evidenceBasis === 'FORMAL' ? '说明' : '估算依据'">
          <el-input v-model="form.note" type="textarea" :rows="2" maxlength="500" />
        </el-form-item>
      </el-form>
      <MidlongNotice v-if="failure" tone="danger" :title="`未能保存草稿：${failure.message}`">
        <template v-if="failure.errorCode === 'VERSION_CONFLICT'">合同已更正为新版本，请关闭对话框刷新后按当前版本重新导入。</template>
      </MidlongNotice>
    </template>

    <template v-else>
      <MidlongNotice :tone="result.validation.blocking ? 'danger' : 'info'" :title="result.validation.blocking ? `草稿 #${result.setNo} 已保存，但有 ${result.validation.blockingCount} 个阻断问题，不能确认` : `草稿 #${result.setNo} 已保存，校验通过，可到详情页确认`">
        草稿不计入分时持仓。
        <router-link :to="`/zcqjy/curves/${result.curveSetId}`" class="ml-link">查看分解集并{{ result.validation.blocking ? '核对问题' : '确认' }} →</router-link>
      </MidlongNotice>
      <div class="ml-summary">
        <el-tag v-for="s in result.validation.summary" :key="s.code" size="small" :type="s.severity === 'blocking' ? 'danger' : 'warning'">{{ s.label }} × {{ s.count }}</el-tag>
      </div>
      <el-table :data="result.validation.months ?? []" border size="small">
        <el-table-column prop="month" label="月份" width="100" />
        <el-table-column label="曲线合计(MWh)" width="140" align="right"><template #default="{ row }">{{ fmtQuantity(row.curveQuantity) }}</template></el-table-column>
        <el-table-column label="正式月度分解(MWh)" width="160" align="right"><template #default="{ row }">{{ row.formalQuantity === null ? '月量未知' : fmtQuantity(row.formalQuantity) }}</template></el-table-column>
        <el-table-column label="差额" width="110" align="right"><template #default="{ row }">{{ row.difference === null ? '—' : fmtQuantity(row.difference) }}</template></el-table-column>
        <el-table-column label="结论" min-width="140"><template #default="{ row }">{{ STATUS_TEXT[row.status] }}</template></el-table-column>
      </el-table>
    </template>

    <template #footer>
      <span v-if="!result && missing.length" class="ml-hint">请补充：{{ missing.join('、') }}</span>
      <el-button @click="emit('update:modelValue', false)">{{ result ? '完成' : '取消' }}</el-button>
      <el-button v-if="!result" type="primary" :loading="busy" :disabled="missing.length > 0" @click="submit">保存草稿并校验</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ml-form { margin-top: 12px; }
.ml-hint { color: var(--muted); font-size: var(--font-sm); margin-left: 8px; }
.ml-summary { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; }
.ml-link { color: var(--accent); text-decoration: none; margin-left: 6px; }
</style>
