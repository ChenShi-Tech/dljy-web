<script setup lang="ts">
// 维护 · 场站机制参数（openspec build-midlong-spot-hedging HC-03，design D4；ChenShi-Tech/dljy#3423）。
//
// 每个「场站 × 生效期」只追加版本：新建（待确认）→ 编辑 → 确认（用户填写生效起止，不写死日期）→ 结束（选择结束原因）。
// 待确认的生效期不参与套保计算（机制电量为未知）；确认时比例高于上一年度必须填写说明——前端先拦（不发请求），
// 后端 422 MECHANISM_RATIO_INCREASE_NEEDS_NOTE 也定位到说明框。生效期重叠等校验失败按 details.field 定位字段。
import { computed, ref } from 'vue'
import {
  appendMechanismVersion, createMechanismParam, fetchMaintenanceStations, fetchMechanismParams,
} from '@/services/hedge/hedgeMaintenanceApi'
import type { MaintenanceStation, MechanismFields, MechanismParamRow } from '@/services/hedge/hedgeMaintenanceApi'
import {
  MECHANISM_END_REASONS, MECHANISM_END_REASON_LABELS, MECHANISM_PARAM_STATUS_LABELS, MECHANISM_PROJECT_CLASSES,
  MECHANISM_PROJECT_CLASS_LABELS, MECHANISM_REFERENCE_BASES, MECHANISM_REFERENCE_BASIS_LABELS, compareText,
  effectivePeriodError, formatPercent, isNonNegativeDecimal, mechanismRatioFromPercent, previousYearRatio,
  ratioIncreaseNeedsNote, ratioToPercent,
} from '@/services/hedge/hedgeMaintenanceModel'
import type { FieldFailure } from '@/services/hedge/hedgeMaintenanceModel'
import { useHedgeTabLifecycle } from '../../useHedgeWorkbench'
import { injectMaintenanceContext, useMaintenanceWrite } from './maintenanceContext'

const context = injectMaintenanceContext()
const { workbench, writable } = context
const writer = useMaintenanceWrite(context)
const busy = writer.busy

const PROJECT_CLASS_LABELS = MECHANISM_PROJECT_CLASS_LABELS as Readonly<Record<string, string>>
const REFERENCE_BASIS_LABELS = MECHANISM_REFERENCE_BASIS_LABELS as Readonly<Record<string, string>>
const END_REASON_LABELS = MECHANISM_END_REASON_LABELS as Readonly<Record<string, string>>
const STATUS_LABELS = MECHANISM_PARAM_STATUS_LABELS as Readonly<Record<string, string>>
const REFERENCE_BASIS_SHORT: Readonly<Record<string, string>> = {
  MIDLONG_MONTHLY_AVG: '中长期月度均价',
  RT_NODAL_MONTHLY_AVG: '实时节点月度均价',
}

const rows = ref<MechanismParamRow[]>([])
const stations = ref<MaintenanceStation[]>([])
const stationsError = ref<string | null>(null)
const loadError = ref<string | null>(null)
const loading = ref(false)
const status = ref<string | null>(null)

type EditorForm = {
  mode: 'create' | 'edit'
  row: MechanismParamRow | null
  stationId: string
  ratioPercent: string
  mechanismPrice: string
  projectClass: string
  referenceBasis: string
  effectiveFrom: string
  effectiveTo: string
  sourceNote: string
}
const editor = ref<EditorForm | null>(null)
const confirmForm = ref<{ row: MechanismParamRow; effectiveFrom: string; effectiveTo: string; overrideNote: string } | null>(null)
const endForm = ref<{ row: MechanismParamRow; endReason: string } | null>(null)
const formError = ref<FieldFailure | null>(null)

const stationNames = computed(() => new Map(stations.value.map((station) => [station.id, station.name])))
const stationName = (stationId: number) => stationNames.value.get(stationId) ?? `场站 #${stationId}`

/** 按场站、生效起始排列；未填生效期的（多为新导入待确认的下一年度）排在该场站最后。 */
const sortedRows = computed(() => [...rows.value].sort((a, b) =>
  compareText(stationName(a.stationId), stationName(b.stationId)) || a.stationId - b.stationId
  || compareText(a.effectiveFrom ?? '9999-12-31', b.effectiveFrom ?? '9999-12-31') || compareText(a.periodKey, b.periodKey)))

const pendingCount = computed(() => rows.value.filter((row) => row.status === 'PENDING').length)

function periodText(row: MechanismParamRow) {
  if (!row.effectiveFrom && !row.effectiveTo) return '未填写'
  return `${row.effectiveFrom ?? '—'} 至 ${row.effectiveTo ?? '长期'}`
}

function statusText(row: MechanismParamRow) {
  const label = STATUS_LABELS[row.status] ?? row.status
  return row.status === 'RETIRED' && row.endReason ? `${label}·${END_REASON_LABELS[row.endReason] ?? row.endReason}` : label
}

async function load() {
  const current = workbench.scopedRequest()
  loading.value = true
  const [paramRes, stationRes] = await Promise.allSettled([fetchMechanismParams(), fetchMaintenanceStations()])
  if (!current()) return
  if (paramRes.status === 'fulfilled') {
    rows.value = paramRes.value.rows ?? []
    loadError.value = null
  } else {
    loadError.value = `机制参数加载失败：${context.failureOf(paramRes.reason).text}`
  }
  if (stationRes.status === 'fulfilled') {
    stations.value = stationRes.value
    stationsError.value = null
  } else {
    stations.value = []
    stationsError.value = `场站清单加载失败（${stationRes.reason instanceof Error ? stationRes.reason.message : '未知错误'}）：新建时请手动填写场站编号`
  }
  loading.value = false
}

function closeForms() {
  editor.value = null
  confirmForm.value = null
  endForm.value = null
  formError.value = null
}

function reset() {
  writer.reset()
  closeForms()
  rows.value = []
  stations.value = []
  stationsError.value = null
  loadError.value = null
  loading.value = false
  status.value = null
}

useHedgeTabLifecycle(workbench, { load, reset, reloadOnActivate: false })

const fieldHasError = (field: string) => formError.value?.field === field

// ── 新建 / 编辑 ──────────────────────────────────────────────────────────

function openCreate() {
  closeForms()
  editor.value = {
    mode: 'create', row: null, stationId: '', ratioPercent: '', mechanismPrice: '', projectClass: '', referenceBasis: '',
    effectiveFrom: '', effectiveTo: '', sourceNote: '',
  }
}

function openEdit(row: MechanismParamRow) {
  closeForms()
  editor.value = {
    mode: 'edit', row, stationId: String(row.stationId), ratioPercent: ratioToPercent(row.ratio),
    mechanismPrice: row.mechanismPrice ?? '', projectClass: row.projectClass, referenceBasis: row.referenceBasis,
    effectiveFrom: row.effectiveFrom ?? '', effectiveTo: row.effectiveTo ?? '', sourceNote: row.sourceNote ?? '',
  }
}

function fieldsOf(form: EditorForm): { ok: true; fields: MechanismFields } | ({ ok: false } & FieldFailure) {
  const ratio = mechanismRatioFromPercent(form.ratioPercent)
  if (!ratio.ok) return ratio
  const price = form.mechanismPrice.trim()
  if (price && !isNonNegativeDecimal(price)) return { ok: false, field: 'mechanismPrice', message: '机制电价请输入非负数（元/MWh），未登记可留空' }
  if (!MECHANISM_PROJECT_CLASSES.includes(form.projectClass)) return { ok: false, field: 'projectClass', message: '请选择项目类别' }
  if (!MECHANISM_REFERENCE_BASES.includes(form.referenceBasis)) return { ok: false, field: 'referenceBasis', message: '请选择市场交易均价参照口径' }
  const from = form.effectiveFrom.trim()
  const to = form.effectiveTo.trim()
  const period = effectivePeriodError(from, to)
  if (period) return { ok: false, ...period }
  return {
    ok: true,
    fields: {
      ratio: ratio.ratio, mechanismPrice: price || null, projectClass: form.projectClass, referenceBasis: form.referenceBasis,
      effectiveFrom: from || null, effectiveTo: to || null, sourceNote: form.sourceNote.trim() || null,
    },
  }
}

async function saveEditor() {
  const form = editor.value
  if (!form) return
  formError.value = null
  const stationId = Number(form.stationId)
  if (form.mode === 'create' && !(Number.isInteger(stationId) && stationId > 0)) {
    formError.value = { field: 'stationId', message: '请选择场站' }
    return
  }
  const built = fieldsOf(form)
  if (!built.ok) {
    formError.value = { field: built.field, message: built.message }
    return
  }
  const row = form.row
  const send = form.mode === 'create' || !row
    ? () => createMechanismParam({ stationId, ...built.fields })
    : () => appendMechanismVersion(row.periodKey, { action: 'EDIT', baseVersionNo: row.versionNo, ...built.fields })
  await writer.run('editor', send, {
    onSuccess() {
      closeForms()
      status.value = form.mode === 'create'
        ? `已新建 ${stationName(stationId)} 的机制参数生效期（待确认：确认前不参与计算）`
        : `已保存 ${stationName(row?.stationId ?? stationId)} 的机制参数修改（新版本为待确认，确认前不参与计算）`
      void load()
    },
    onFailure(failure) {
      formError.value = { field: failure.field, message: failure.text }
    },
  })
}

// ── 确认（用户填写生效起止；比例上调须说明）─────────────────────────────────

function openConfirm(row: MechanismParamRow) {
  closeForms()
  confirmForm.value = { row, effectiveFrom: row.effectiveFrom ?? '', effectiveTo: row.effectiveTo ?? '', overrideNote: '' }
}

/** 本期与上一年度比例的对照（生效起始填写后才能判断「上一年度」）。 */
const confirmPrevious = computed(() => {
  const form = confirmForm.value
  if (!form) return null
  const previous = previousYearRatio(rows.value, form.row, form.effectiveFrom.trim())
  if (previous === null) return null
  return { previous, increase: ratioIncreaseNeedsNote(rows.value, form.row, form.effectiveFrom.trim(), '') !== null }
})

async function submitConfirm() {
  const form = confirmForm.value
  if (!form) return
  formError.value = null
  const from = form.effectiveFrom.trim()
  const to = form.effectiveTo.trim()
  const period = effectivePeriodError(from, to, { fromRequired: true })
  if (period) {
    formError.value = period
    return
  }
  if (!to && form.row.effectiveTo) {
    formError.value = { field: 'effectiveTo', message: '确认时不能清空已登记的生效止日；如需改为长期有效，请先编辑该生效期' }
    return
  }
  const overrideNote = form.overrideNote.trim()
  const increase = ratioIncreaseNeedsNote(rows.value, form.row, from, overrideNote)
  if (increase) {
    formError.value = {
      field: 'overrideNote',
      message: `比例 ${formatPercent(form.row.ratio)} 高于上一年度 ${formatPercent(increase.previous)}，须填写确认说明后才能生效`,
    }
    return
  }
  const row = form.row
  await writer.run('confirm', () => appendMechanismVersion(row.periodKey, {
    action: 'CONFIRM', baseVersionNo: row.versionNo, effectiveFrom: from,
    ...(to ? { effectiveTo: to } : {}),
    ...(overrideNote ? { overrideNote } : {}),
  }), {
    onSuccess() {
      closeForms()
      status.value = `已确认：${stationName(row.stationId)} 自 ${from} 起${to ? `至 ${to}` : ''}按比例 ${formatPercent(row.ratio)} 计入机制电量`
      void load()
    },
    onFailure(failure) {
      formError.value = { field: failure.field, message: failure.text }
    },
  })
}

// ── 结束（选择结束原因）──────────────────────────────────────────────────

function openEnd(row: MechanismParamRow) {
  closeForms()
  endForm.value = { row, endReason: '' }
}

async function submitEnd() {
  const form = endForm.value
  if (!form) return
  formError.value = null
  if (!MECHANISM_END_REASONS.includes(form.endReason)) {
    formError.value = { field: 'endReason', message: '请选择结束原因' }
    return
  }
  const row = form.row
  const endReason = form.endReason
  await writer.run('end', () => appendMechanismVersion(row.periodKey, { action: 'END', baseVersionNo: row.versionNo, endReason }), {
    onSuccess() {
      closeForms()
      status.value = `已结束：${stationName(row.stationId)} ${periodText(row)}（${END_REASON_LABELS[endReason] ?? endReason}）`
      void load()
    },
    onFailure(failure) {
      formError.value = { field: failure.field, message: failure.text }
    },
  })
}
</script>

<template>
  <section class="maint-section" data-test="mechanism-section">
    <div class="section-head">
      <h3>场站机制参数</h3>
      <span class="badge">比例制 · 云发改价格〔2025〕720 号</span>
      <span class="spacer" />
      <button data-test="mechanism-refresh" :disabled="loading" @click="load">刷新</button>
      <button data-test="mech-new" :disabled="!writable" @click="openCreate">新建生效期</button>
    </div>
    <p class="hint" data-test="mech-pending-explain">
      机制电量 = 上网电量 × 当期比例，是独立的锁价层（锁定的是机制电价与同类型月度均价之差）。<b>待确认</b>的生效期不参与套保计算（对应场站该期的机制电量显示为未知），
      确认时须填写生效起止；新一年的比例高于上一年度时须填写确认说明。执行期到期或自愿退出后，机制电量为真实零。
    </p>
    <p v-if="loadError" class="status error">{{ loadError }}</p>
    <p v-if="stationsError" class="status error">{{ stationsError }}</p>
    <p class="status" data-test="mechanism-status">
      {{ status ?? (rows.length ? `${rows.length} 个生效期已登记${pendingCount ? `，其中 ${pendingCount} 个待确认（不参与计算）` : ''}` : loading ? '加载中…' : '暂无机制参数登记（导入或新建后待业务确认）') }}
    </p>

    <div class="table-wrap">
      <table class="maint-table" data-test="mech-table">
        <thead>
          <tr>
            <th>场站</th><th>生效期</th><th>比例</th><th>机制电价</th><th>项目类别</th><th>参照口径</th><th>来源文件</th><th>状态</th><th>版本</th><th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in sortedRows" :key="row.periodKey" data-test="mech-row" :class="`status-${row.status.toLowerCase()}`">
            <td>{{ stationName(row.stationId) }}</td>
            <td>{{ periodText(row) }}</td>
            <td>{{ formatPercent(row.ratio) }}</td>
            <td>{{ row.mechanismPrice ? `${row.mechanismPrice} 元/MWh` : '未登记（估值未知）' }}</td>
            <td>{{ PROJECT_CLASS_LABELS[row.projectClass] ?? row.projectClass }}</td>
            <td :title="REFERENCE_BASIS_LABELS[row.referenceBasis] ?? row.referenceBasis">{{ REFERENCE_BASIS_SHORT[row.referenceBasis] ?? row.referenceBasis }}</td>
            <td>{{ row.sourceNote ?? '—' }}</td>
            <td>
              <span
                class="badge"
                :class="{ warn: row.status === 'PENDING', ok: row.status === 'CONFIRMED' }"
                data-test="mech-status"
              >{{ statusText(row) }}</span>
              <span v-if="row.status === 'PENDING'" class="pending-note" data-test="mech-pending-note">不参与计算</span>
              <span v-if="row.overrideNote" class="hint" :title="row.overrideNote">（附上调说明）</span>
            </td>
            <td>v{{ row.versionNo }}</td>
            <td class="actions">
              <template v-if="row.status !== 'RETIRED'">
                <button data-test="mech-edit" :disabled="!writable || busy !== null" @click="openEdit(row)">编辑</button>
                <button v-if="row.status === 'PENDING'" data-test="mech-confirm" :disabled="!writable || busy !== null" @click="openConfirm(row)">确认生效</button>
                <button data-test="mech-end" :disabled="!writable || busy !== null" @click="openEnd(row)">结束</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="editor" class="maint-dialog" role="dialog" aria-modal="true">
      <div class="form-card" data-test="mech-editor">
        <h4>{{ editor.mode === 'create' ? '新建机制参数生效期（以待确认起步）' : `编辑 ${stationName(editor.row?.stationId ?? 0)} 的生效期（追加新版本）` }}</h4>
        <p v-if="editor.mode === 'edit' && editor.row?.status === 'CONFIRMED'" class="status error">
          编辑已确认的生效期会追加一个「待确认」版本：重新确认前该期不参与计算。
        </p>
        <div class="form-grid">
          <template v-if="editor.mode === 'create'">
            <label for="mech-station">场站</label>
            <select v-if="stations.length" id="mech-station" v-model="editor.stationId" data-test="mech-station" :class="{ 'field-error': fieldHasError('stationId') }">
              <option value="" disabled>请选择场站</option>
              <option v-for="station in stations" :key="station.id" :value="String(station.id)">{{ station.name }}</option>
            </select>
            <input v-else id="mech-station" v-model="editor.stationId" data-test="mech-station" placeholder="场站编号" :class="{ 'field-error': fieldHasError('stationId') }" />
          </template>
          <label for="mech-ratio">机制电量比例（%）</label>
          <input id="mech-ratio" v-model="editor.ratioPercent" data-test="mech-ratio" inputmode="decimal" placeholder="如 55" :class="{ 'field-error': fieldHasError('ratio') }" />
          <label for="mech-price">机制电价（元/MWh）</label>
          <input id="mech-price" v-model="editor.mechanismPrice" data-test="mech-price" inputmode="decimal" placeholder="未登记可留空（估值为未知）" :class="{ 'field-error': fieldHasError('mechanismPrice') }" />
          <label for="mech-project-class">项目类别</label>
          <select id="mech-project-class" v-model="editor.projectClass" data-test="mech-project-class" :class="{ 'field-error': fieldHasError('projectClass') }">
            <option value="" disabled>请选择</option>
            <option v-for="value in MECHANISM_PROJECT_CLASSES" :key="value" :value="value">{{ PROJECT_CLASS_LABELS[value] ?? value }}</option>
          </select>
          <label for="mech-reference-basis">参照口径</label>
          <select id="mech-reference-basis" v-model="editor.referenceBasis" data-test="mech-reference-basis" :class="{ 'field-error': fieldHasError('referenceBasis') }">
            <option value="" disabled>请选择</option>
            <option v-for="value in MECHANISM_REFERENCE_BASES" :key="value" :value="value">{{ REFERENCE_BASIS_LABELS[value] ?? value }}</option>
          </select>
          <label for="mech-effective-from">生效起止（可后补）</label>
          <div class="period">
            <input id="mech-effective-from" v-model="editor.effectiveFrom" type="date" data-test="mech-effective-from" :class="{ 'field-error': fieldHasError('effectiveFrom') }" />
            <span>至</span>
            <input v-model="editor.effectiveTo" type="date" data-test="mech-effective-to" aria-label="生效止日" :class="{ 'field-error': fieldHasError('effectiveTo') }" />
          </div>
          <label for="mech-source-note">来源文件说明</label>
          <input id="mech-source-note" v-model="editor.sourceNote" data-test="mech-source-note" placeholder="如：云南电网 2026 年机制电量比例通知" :class="{ 'field-error': fieldHasError('sourceNote') }" />
        </div>
        <p v-if="formError" class="field-message" data-test="mech-form-error">{{ formError.message }}</p>
        <div class="form-actions">
          <button data-test="mech-editor-cancel" @click="closeForms">取消</button>
          <button class="primary" data-test="mech-editor-save" :disabled="!writable || busy !== null" @click="saveEditor">
            {{ busy === 'editor' ? '保存中…' : '保存机制参数' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="confirmForm" class="maint-dialog" role="dialog" aria-modal="true">
      <div class="form-card" data-test="mech-confirm-form">
        <h4>确认生效：{{ stationName(confirmForm.row.stationId) }}，比例 {{ formatPercent(confirmForm.row.ratio) }}</h4>
        <p class="hint">确认后该生效期按比例计入机制电量；同一场站已确认的生效期不得重叠。</p>
        <div class="form-grid">
          <label for="mech-confirm-from">生效起始（必填）</label>
          <input id="mech-confirm-from" v-model="confirmForm.effectiveFrom" type="date" data-test="mech-confirm-from" :class="{ 'field-error': fieldHasError('effectiveFrom') }" />
          <label for="mech-confirm-to">生效止日</label>
          <div>
            <input id="mech-confirm-to" v-model="confirmForm.effectiveTo" type="date" data-test="mech-confirm-to" :class="{ 'field-error': fieldHasError('effectiveTo') }" />
            <p class="hint">留空 = 长期有效（直至结束）</p>
          </div>
          <label for="mech-override-note">比例上调说明</label>
          <div>
            <textarea id="mech-override-note" v-model="confirmForm.overrideNote" data-test="mech-override-note" rows="2" :class="{ 'field-error': fieldHasError('overrideNote') }" />
            <p v-if="confirmPrevious" class="hint" data-test="mech-previous-ratio">
              上一年度比例 {{ formatPercent(confirmPrevious.previous) }}<template v-if="confirmPrevious.increase">；本期更高，必须填写说明</template>
            </p>
          </div>
        </div>
        <p v-if="formError" class="field-message" data-test="mech-form-error">{{ formError.message }}</p>
        <div class="form-actions">
          <button data-test="mech-confirm-cancel" @click="closeForms">取消</button>
          <button class="primary" data-test="mech-confirm-submit" :disabled="!writable || busy !== null" @click="submitConfirm">
            {{ busy === 'confirm' ? '确认中…' : '确认生效' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="endForm" class="maint-dialog" role="dialog" aria-modal="true">
      <div class="form-card" data-test="mech-end-form">
        <h4>结束生效期：{{ stationName(endForm.row.stationId) }} {{ periodText(endForm.row) }}</h4>
        <div class="form-grid">
          <label for="mech-end-reason">结束原因</label>
          <select id="mech-end-reason" v-model="endForm.endReason" data-test="mech-end-reason" :class="{ 'field-error': fieldHasError('endReason') }">
            <option value="" disabled>请选择</option>
            <option v-for="value in MECHANISM_END_REASONS" :key="value" :value="value">{{ END_REASON_LABELS[value] ?? value }}</option>
          </select>
        </div>
        <p class="hint">执行期到期、自愿退出后该场站机制电量为真实零；被下一年度接替的，以新生效期为准。</p>
        <p v-if="formError" class="field-message" data-test="mech-form-error">{{ formError.message }}</p>
        <div class="form-actions">
          <button data-test="mech-end-cancel" @click="closeForms">取消</button>
          <button class="primary" data-test="mech-end-submit" :disabled="!writable || busy !== null" @click="submitEnd">
            {{ busy === 'end' ? '提交中…' : '结束生效期' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped src="./maintenance.css"></style>
<style scoped>
.pending-note { display: block; color: var(--warning); font-size: var(--font-xs); }
tr.status-retired td { color: var(--muted); }
.actions { white-space: nowrap; }
.actions button + button { margin-left: 4px; }
.period { display: flex; align-items: center; gap: 6px; }
</style>
