<script setup lang="ts">
import HedgeHint from '../HedgeHint.vue'
// 维护 · 核定上限（openspec build-midlong-spot-hedging HB-07，design D10；ChenShi-Tech/dljy#3423）。
//
// 按「交易单元 × 月」登记交易机构核定的月度净合同量上限：交易单元来自中长期交易单元清单（清单取不到时可手动加行），
// 月份范围可选、默认北京时间当月起 3 个月。逐行保存，已登记行带 rowVersion，他人先改则 409 提示刷新后重试。
// 剩余可签量只展示接口给出的值；当前 GET /caps 不返回，页面如实显示「未提供」，不用装机或基准推算。
// 核定上限是交易约束，与套保区间分开展示、不参与区间判级。
import { computed, reactive, ref } from 'vue'
import { fetchCaps, fetchMaintenanceSubjects, putCaps } from '@/services/hedge/hedgeMaintenanceApi'
import type { CapRow, MaintenanceSubject } from '@/services/hedge/hedgeMaintenanceApi'
import {
  compareText, defaultMonthRange, isMonthKey, isNonNegativeDecimal, monthRangeError, monthsBetween, sameDecimal,
} from '@/services/hedge/hedgeMaintenanceModel'
import type { FieldFailure } from '@/services/hedge/hedgeMaintenanceModel'
import { useHedgeTabLifecycle } from '../../useHedgeWorkbench'
import { injectMaintenanceContext, useMaintenanceWrite } from './maintenanceContext'

const context = injectMaintenanceContext()
const { workbench, writable } = context
const writer = useMaintenanceWrite(context)
const busy = writer.busy

type MonthRange = { fromMonth: string; toMonth: string }
type CapDraft = { capMwh?: string; sourceNote?: string }

const range = reactive<MonthRange>(defaultMonthRange())
const loadedRange = ref<MonthRange | null>(null)
const subjects = ref<MaintenanceSubject[]>([])
const subjectsError = ref<string | null>(null)
const caps = ref<Record<string, CapRow>>({})
const drafts = ref<Record<string, CapDraft>>({})
const extraKeys = ref<string[]>([])
const rowErrors = ref<Record<string, FieldFailure>>({})
const addForm = reactive({ subjectId: '', month: '' })
const addError = ref<string | null>(null)
const rangeError = ref<string | null>(null)
const loadError = ref<string | null>(null)
const loading = ref(false)
const status = ref<string | null>(null)

const keyOf = (subjectId: number, month: string) => `${subjectId}|${month}`

const subjectNames = computed(() => new Map(subjects.value.map((subject) => [subject.id, subject.unitCode ? `${subject.name}（${subject.unitCode}）` : subject.name])))
const subjectName = (subjectId: number) => subjectNames.value.get(subjectId) ?? `交易单元 #${subjectId}`

/** 表格行：交易单元清单 × 所选月份，加上已登记但不在清单里的行与手动添加的行。 */
const gridRows = computed(() => {
  const keys = new Set<string>()
  if (loadedRange.value) {
    const months = monthsBetween(loadedRange.value.fromMonth, loadedRange.value.toMonth)
    for (const subject of subjects.value) for (const month of months) keys.add(keyOf(subject.id, month))
  }
  for (const key of Object.keys(caps.value)) keys.add(key)
  for (const key of extraKeys.value) keys.add(key)
  return [...keys].map((key) => {
    const [subjectId, month] = key.split('|')
    return { key, subjectId: Number(subjectId), month, name: subjectName(Number(subjectId)) }
  }).sort((a, b) => compareText(a.name, b.name) || a.subjectId - b.subjectId || compareText(a.month, b.month))
})

function draftValue(key: string, field: keyof CapDraft): string {
  return drafts.value[key]?.[field] ?? caps.value[key]?.[field] ?? ''
}

function setDraft(key: string, field: keyof CapDraft, event: Event) {
  drafts.value[key] = { ...drafts.value[key], [field]: (event.target as HTMLInputElement).value }
}

/** 剩余可签量：只展示接口给出的值，缺省如实写「未提供」。 */
function remainingText(key: string) {
  const value = caps.value[key]?.remainingMwh
  return typeof value === 'string' && value !== '' ? `${value} MWh` : '未提供'
}

async function loadSubjects() {
  const current = context.contextRequest()
  try {
    const rows = await fetchMaintenanceSubjects()
    if (!current()) return
    subjects.value = rows
    subjectsError.value = null
  } catch (err) {
    if (!current()) return
    subjects.value = []
    subjectsError.value = `交易单元清单加载失败（${err instanceof Error ? err.message : '未知错误'}）：可在下方手动添加交易单元编号`
  }
}

// 月份范围不在请求有效期里：连续按不同范围查询时，用序号丢弃被后发查询取代的迟到响应（#221 审查 R1-02）。
let capsQuerySeq = 0

async function loadCaps(target: MonthRange = { fromMonth: range.fromMonth, toMonth: range.toMonth }) {
  const invalid = monthRangeError(target.fromMonth, target.toMonth)
  rangeError.value = invalid
  if (invalid) return
  const seq = ++capsQuerySeq
  const inContext = context.contextRequest()
  const current = () => inContext() && seq === capsQuerySeq
  loading.value = true
  try {
    const data = await fetchCaps({ fromMonth: target.fromMonth, toMonth: target.toMonth })
    if (!current()) return
    const byKey: Record<string, CapRow> = {}
    for (const row of data.rows ?? []) byKey[keyOf(row.subjectId, row.month)] = row
    caps.value = byKey
    drafts.value = {}
    rowErrors.value = {}
    extraKeys.value = []
    loadedRange.value = { ...target }
    loadError.value = null
  } catch (err) {
    if (!current()) return
    loadError.value = `核定上限加载失败：${context.failureOf(err).text}`
  }
  loading.value = false
}

function load() {
  return Promise.all([loadSubjects(), loadCaps()])
}

function reset() {
  writer.reset()
  subjects.value = []
  subjectsError.value = null
  caps.value = {}
  drafts.value = {}
  extraKeys.value = []
  rowErrors.value = {}
  loadedRange.value = null
  loadError.value = null
  loading.value = false
  status.value = null
  addForm.subjectId = ''
  addForm.month = ''
  addError.value = null
}

useHedgeTabLifecycle(workbench, { load, reset, reloadOnActivate: false })

function addRow() {
  addError.value = null
  const subjectId = Number(addForm.subjectId)
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    addError.value = '请填写交易单元编号（正整数）'
    return
  }
  if (!isMonthKey(addForm.month)) {
    addError.value = '请选择月份'
    return
  }
  const key = keyOf(subjectId, addForm.month)
  if (!extraKeys.value.includes(key)) extraKeys.value = [...extraKeys.value, key]
  addForm.subjectId = ''
}

async function saveRow(row: { key: string; subjectId: number; month: string; name: string }) {
  status.value = null
  const saved = caps.value[row.key]
  const capMwh = draftValue(row.key, 'capMwh').trim()
  const sourceNote = draftValue(row.key, 'sourceNote').trim()
  const fail = (failure: FieldFailure) => {
    rowErrors.value = { ...rowErrors.value, [row.key]: failure }
    status.value = `${row.name} ${row.month}：${failure.message}`
  }
  if (!isNonNegativeDecimal(capMwh)) return fail({ field: 'capMwh', message: '核定上限请输入非负数（MWh）' })
  if (!sourceNote) return fail({ field: 'sourceNote', message: '请填写来源文件或通知' })
  if (saved && sameDecimal(capMwh, saved.capMwh) && sourceNote === (saved.sourceNote ?? '')) {
    status.value = `${row.name} ${row.month}：未改动，无需保存`
    return
  }
  const { [row.key]: _cleared, ...restErrors } = rowErrors.value
  rowErrors.value = restErrors
  await writer.run(`cap:${row.key}`, () => putCaps([{
    subjectId: row.subjectId, month: row.month, capMwh, sourceNote,
    ...(saved ? { rowVersion: saved.rowVersion } : {}),
  }]), {
    onSuccess(result) {
      const updated = result.rows?.[0]
      if (updated) caps.value = { ...caps.value, [row.key]: updated }
      const { [row.key]: _saved, ...restDrafts } = drafts.value
      drafts.value = restDrafts
      status.value = `核定上限已保存：${row.name} ${row.month} ${capMwh} MWh`
    },
    onFailure(failure) {
      // 后端对整行给 items / items.rowVersion：交易单元与月份由表格固定，定位到本行的上限输入框。
      const field = failure.field === 'sourceNote' ? 'sourceNote' : 'capMwh'
      rowErrors.value = { ...rowErrors.value, [row.key]: { field, message: failure.text } }
      status.value = failure.text
    },
  })
}
</script>

<template>
  <section class="maint-section" data-test="caps-section">
    <div class="section-head">
      <h3>核定上限<HedgeHint text="交易机构核定的月度净合同量上限，独立于套保区间判级。" /></h3>
      <span class="spacer" />
      <button data-test="caps-refresh" :disabled="loading" @click="load">刷新</button>
    </div>
    <div class="range-bar">
      <label>起始月份 <input v-model="range.fromMonth" type="month" data-test="caps-from" /></label>
      <label>结束月份 <input v-model="range.toMonth" type="month" data-test="caps-to" /></label>
      <button data-test="caps-query" :disabled="loading" @click="loadCaps()">按此范围加载</button>
      <HedgeHint text="默认查询当月起三个月。重新加载会丢弃未保存的改动。" />
    </div>
    <p v-if="rangeError" class="status error" data-test="caps-range-error">{{ rangeError }}</p>
    <p v-if="subjectsError" class="status error" data-test="caps-subjects-error">{{ subjectsError }}</p>
    <p v-if="loadError" class="status error">{{ loadError }}</p>
    <p class="status" data-test="caps-status">
      {{ status ?? (Object.keys(caps).length ? `${Object.keys(caps).length} 行已登记` : loading ? '加载中…' : '核定上限未登记') }}
      <HedgeHint text="请按交易单元与月份登记核定值，并附来源文件。未登记不使用装机容量或发电基准推算。" />
    </p>

    <div class="table-wrap">
      <table class="maint-table">
        <thead>
          <tr><th>交易单元</th><th>月份</th><th>核定上限（MWh）</th><th>来源文件 / 通知</th><th>剩余可签量</th><th>登记</th><th /></tr>
        </thead>
        <tbody>
          <tr v-for="row in gridRows" :key="row.key" class="caps-row" data-test="caps-row">
            <td>{{ row.name }}</td>
            <td>{{ row.month }}</td>
            <td>
              <input
                :value="draftValue(row.key, 'capMwh')"
                data-test="cap-mwh"
                :aria-label="`${row.name} ${row.month} 核定上限（MWh）`"
                inputmode="decimal"
                placeholder="MWh"
                :disabled="!writable"
                :class="{ 'field-error': rowErrors[row.key]?.field === 'capMwh' }"
                @input="setDraft(row.key, 'capMwh', $event)"
              />
            </td>
            <td>
              <input
                :value="draftValue(row.key, 'sourceNote')"
                data-test="cap-source"
                :aria-label="`${row.name} ${row.month} 来源文件或通知`"
                placeholder="核定文件或通知"
                :disabled="!writable"
                :class="{ 'field-error': rowErrors[row.key]?.field === 'sourceNote' }"
                @input="setDraft(row.key, 'sourceNote', $event)"
              />
            </td>
            <td data-test="cap-remaining" :title="caps[row.key]?.remainingMwh == null ? '接口未返回剩余可签量（上限减中长期锁价电量）' : ''">{{ remainingText(row.key) }}</td>
            <td>
              <span v-if="caps[row.key]" class="badge ok">v{{ caps[row.key]?.rowVersion }}</span>
              <span v-else class="badge">核定上限未登记</span>
            </td>
            <td>
              <button :disabled="!writable || busy !== null" @click="saveRow(row)">保存</button>
            </td>
          </tr>
          <tr v-if="!gridRows.length">
            <td colspan="7" class="hint">暂无交易单元<HedgeHint text="请先在中长期模块登记交易单元，或手动添加。" /></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="range-bar">
      <span>手动添加：</span>
      <input v-model="addForm.subjectId" data-test="caps-add-subject" placeholder="交易单元编号" inputmode="numeric" :disabled="!writable" />
      <input v-model="addForm.month" type="month" data-test="caps-add-month" :disabled="!writable" />
      <button data-test="caps-add" :disabled="!writable" @click="addRow">添加一行</button>
      <span v-if="addError" class="field-message">{{ addError }}</span>
    </div>
  </section>
</template>

<style scoped src="./maintenance.css"></style>
