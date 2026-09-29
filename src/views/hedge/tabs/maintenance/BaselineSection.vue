<script setup lang="ts">
// 维护 · 月度发电基准（openspec build-midlong-spot-hedging HG-07，design D7；ChenShi-Tech/dljy#3423）。
//
// 按「场站 × 月」批量录入经营计划口径的预计发电量：场站来自公司场站清单（已登记基准但不在清单里的场站照常列出并标注），
// 月份范围可选、默认北京时间当月起 3 个月（不写死）。只提交改动过的格子；已有版本的格子带 expectedVersionNo，
// 他人先改则 409 提示刷新后重试并定位到该格。每次保存追加新版本，依据说明必填。
import { computed, reactive, ref } from 'vue'
import { fetchBaselines, fetchMaintenanceStations, putBaselines } from '@/services/hedge/hedgeMaintenanceApi'
import type { BaselineInput, BaselineRow, MaintenanceStation } from '@/services/hedge/hedgeMaintenanceApi'
import {
  compareText, defaultMonthRange, formatBeijingTime, isNonNegativeDecimal, monthRangeError, monthsBetween, sameDecimal,
} from '@/services/hedge/hedgeMaintenanceModel'
import { useHedgeTabLifecycle } from '../../useHedgeWorkbench'
import { injectMaintenanceContext, useMaintenanceWrite } from './maintenanceContext'

const context = injectMaintenanceContext()
const { workbench, writable } = context
const writer = useMaintenanceWrite(context)
const busy = writer.busy

type MonthRange = { fromMonth: string; toMonth: string }

const range = reactive<MonthRange>(defaultMonthRange())
const loadedRange = ref<MonthRange | null>(null)
const stations = ref<MaintenanceStation[]>([])
const stationsError = ref<string | null>(null)
const baselines = ref<Record<string, BaselineRow>>({})
const drafts = ref<Record<string, string>>({})
const cellErrors = ref<Record<string, string>>({})
const note = ref('')
const noteError = ref<string | null>(null)
const rangeError = ref<string | null>(null)
const loadError = ref<string | null>(null)
const loading = ref(false)
const status = ref<string | null>(null)

const keyOf = (stationId: number, month: string) => `${stationId}|${month}`

const months = computed(() => (loadedRange.value ? monthsBetween(loadedRange.value.fromMonth, loadedRange.value.toMonth) : []))

/** 表格行：公司场站清单 + 已登记基准但不在清单里的场站（不静默丢弃已有数据）。按名称排序。 */
const gridStations = computed(() => {
  const listed = new Set(stations.value.map((station) => station.id))
  const extra = new Set<number>()
  for (const row of Object.values(baselines.value)) if (!listed.has(row.stationId)) extra.add(row.stationId)
  return [
    ...stations.value.map((station) => ({ ...station, listed: true })),
    ...[...extra].map((id) => ({ id, name: `场站 #${id}`, listed: false })),
  ].sort((a, b) => compareText(a.name, b.name) || a.id - b.id)
})

/** 改动过的格子：填了值且与已登记值不同（清空不算改动——基准只追加版本，不能删除）。 */
function isChanged(key: string) {
  const draft = (drafts.value[key] ?? '').trim()
  if (!draft) return false
  const saved = baselines.value[key]?.quantityMwh
  return saved === undefined || !sameDecimal(draft, saved)
}

const changedKeys = computed(() => Object.keys(drafts.value).filter(isChanged))

function cellTitle(stationId: number, month: string) {
  const row = baselines.value[keyOf(stationId, month)]
  if (!row) return `${month} 未录入基准（该场站该月为未覆盖）`
  return `v${row.versionNo} · ${row.quantityMwh} MWh · 依据：${row.basisNote ?? '—'} · ${row.recordedBy ?? '—'} 于 ${formatBeijingTime(row.recordedAt)}`
}

async function loadStations() {
  const current = workbench.scopedRequest()
  try {
    const rows = await fetchMaintenanceStations()
    if (!current()) return
    stations.value = rows
    stationsError.value = null
  } catch (err) {
    if (!current()) return
    stations.value = []
    stationsError.value = `场站清单加载失败（${err instanceof Error ? err.message : '未知错误'}）：下表只列出已登记基准的场站`
  }
}

async function loadBaselines(target: MonthRange = { fromMonth: range.fromMonth, toMonth: range.toMonth }) {
  const invalid = monthRangeError(target.fromMonth, target.toMonth)
  rangeError.value = invalid
  if (invalid) return
  const current = workbench.scopedRequest()
  loading.value = true
  try {
    const data = await fetchBaselines({ fromMonth: target.fromMonth, toMonth: target.toMonth })
    if (!current()) return
    const byKey: Record<string, BaselineRow> = {}
    for (const row of data.rows ?? []) byKey[keyOf(row.stationId, row.month)] = row
    baselines.value = byKey
    drafts.value = Object.fromEntries(Object.entries(byKey).map(([key, row]) => [key, row.quantityMwh]))
    cellErrors.value = {}
    loadedRange.value = { ...target }
    loadError.value = null
  } catch (err) {
    if (!current()) return
    loadError.value = `基准加载失败：${context.failureOf(err).text}`
  }
  loading.value = false
}

function load() {
  return Promise.all([loadStations(), loadBaselines()])
}

function reset() {
  writer.reset()
  stations.value = []
  stationsError.value = null
  baselines.value = {}
  drafts.value = {}
  cellErrors.value = {}
  loadedRange.value = null
  loadError.value = null
  note.value = ''
  noteError.value = null
  loading.value = false
  status.value = null
}

useHedgeTabLifecycle(workbench, { load, reset, reloadOnActivate: false })

async function save() {
  status.value = null
  noteError.value = null
  const keys = changedKeys.value
  if (!keys.length) {
    status.value = '没有需要保存的改动'
    return
  }
  const invalid: Record<string, string> = {}
  for (const key of keys) if (!isNonNegativeDecimal(drafts.value[key] ?? '')) invalid[key] = '请输入非负数（MWh）'
  cellErrors.value = invalid
  if (Object.keys(invalid).length) {
    status.value = `有 ${Object.keys(invalid).length} 格电量无效：请输入非负数（MWh）`
    return
  }
  const basisNote = note.value.trim()
  if (!basisNote) {
    noteError.value = '请填写依据说明（如经营计划文件与版本）'
    return
  }
  const items: BaselineInput[] = keys.map((key) => {
    const [stationId, month] = key.split('|')
    const saved = baselines.value[key]
    return {
      stationId: Number(stationId), month, quantityMwh: (drafts.value[key] ?? '').trim(), basisNote,
      ...(saved ? { expectedVersionNo: saved.versionNo } : {}),
    }
  })
  await writer.run('baseline', () => putBaselines(items), {
    onSuccess(result) {
      status.value = `已保存 ${result.rows?.length ?? items.length} 条基准（写入后下一次读取即反映到套保计算）`
      void loadBaselines(loadedRange.value ?? undefined)
    },
    onFailure(failure) {
      status.value = failure.text
      const item = failure.index !== null ? items[failure.index] : undefined
      if (item) cellErrors.value = { [keyOf(item.stationId, item.month)]: failure.message }
    },
  })
}
</script>

<template>
  <section class="maint-section" data-test="baseline-section">
    <div class="section-head">
      <h3>月度发电基准</h3>
      <span class="badge">经营计划口径</span>
      <span class="spacer" />
      <button data-test="baseline-refresh" :disabled="loading" @click="load">刷新</button>
    </div>
    <p class="hint">
      按「场站 × 月」录入预计发电量（MWh），只用于基准口径套保率与计划口径机制电量，禁止用中长期售电目标顶替；
      某场站某月没有基准即为未覆盖。每次保存追加新版本，旧版本可按认知时点回看。
    </p>
    <div class="range-bar">
      <label>起始月份 <input v-model="range.fromMonth" type="month" data-test="baseline-from" /></label>
      <label>结束月份 <input v-model="range.toMonth" type="month" data-test="baseline-to" /></label>
      <button data-test="baseline-query" :disabled="loading" @click="loadBaselines()">按此范围加载</button>
      <span class="hint">默认当月起 3 个月；重新加载会丢弃未保存的改动</span>
    </div>
    <p v-if="rangeError" class="status error" data-test="baseline-range-error">{{ rangeError }}</p>
    <p v-if="stationsError" class="status error" data-test="baseline-stations-error">{{ stationsError }}</p>
    <p v-if="loadError" class="status error">{{ loadError }}</p>

    <div class="table-wrap">
      <table class="maint-table" data-test="baseline-grid">
        <thead>
          <tr><th>场站</th><th v-for="month in months" :key="month">{{ month }}（MWh）</th></tr>
        </thead>
        <tbody>
          <tr v-for="station in gridStations" :key="station.id" data-test="baseline-row">
            <td>
              {{ station.name }}
              <span v-if="!station.listed" class="badge warn">不在场站清单</span>
            </td>
            <td v-for="month in months" :key="month">
              <input
                v-model="drafts[keyOf(station.id, month)]"
                :data-test="`baseline-cell-${station.id}-${month}`"
                :class="{ 'field-error': cellErrors[keyOf(station.id, month)] }"
                :disabled="!writable"
                :title="cellTitle(station.id, month)"
                :aria-label="`${station.name} ${month} 发电基准（MWh）`"
                inputmode="decimal"
                placeholder="未录入"
              />
              <span v-if="baselines[keyOf(station.id, month)]" class="version">v{{ baselines[keyOf(station.id, month)]?.versionNo }}</span>
            </td>
          </tr>
          <tr v-if="!gridStations.length">
            <td :colspan="months.length + 1" class="hint">暂无场站：请先在公司场站管理中登记场站</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="form-grid">
      <label for="baseline-note">依据说明（必填）</label>
      <div>
        <input
          id="baseline-note"
          v-model="note"
          data-test="baseline-note"
          :class="{ 'field-error': noteError }"
          :disabled="!writable"
          placeholder="如：2026 年经营计划（9 月修订版）"
        />
        <p v-if="noteError" class="field-message">{{ noteError }}</p>
      </div>
    </div>
    <div class="form-actions">
      <span class="hint">{{ changedKeys.length }} 格待保存</span>
      <button class="primary" data-test="baseline-save" :disabled="!writable || busy !== null" @click="save">
        {{ busy === 'baseline' ? '保存中…' : '保存基准' }}
      </button>
    </div>
    <p class="status" data-test="baseline-status">{{ status }}</p>
  </section>
</template>

<style scoped src="./maintenance.css"></style>
<style scoped>
.version { display: block; color: var(--muted); font-size: var(--font-xs); }
</style>
