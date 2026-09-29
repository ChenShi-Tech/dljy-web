<script setup lang="ts">
// 套保工作台「维护」页签（openspec build-midlong-spot-hedging 任务 8.5/8.6，HW-10；#3420 由开关面板改为第五个页签）。
//
// 区间方案切换、场站机制参数确认、核定上限与月度发电基准录入。写权限由后端把关：首个 403 即转只读态并注明所需角色，
// 422 按 details.field 定位字段，409 提示刷新。每次被激活都重取；切公司/地区清空已载入的行，激活中则按新范围重取。
// 写入成功后通知依赖计算结果的页签重取（原面板写后刷新总览）。
import { ref } from 'vue'
import {
  HedgeApiError, activateBand, fetchBandActivation, fetchBandPresets, fetchBaselines, fetchCaps,
  fetchMechanismParams, postMechanismVersion, putBaselines, putCaps, requestBandSchemeCreate,
} from '@/services/hedge/hedgeApi'
import { injectHedgeWorkbench, useHedgeTabLifecycle } from '../useHedgeWorkbench'

type BaselineRow = { stationId: number; month: string; quantityMwh: string; basisNote?: string }
type CapRow = { subjectId: number; month: string; capMwh: string; sourceNote?: string; rowVersion?: number }

const workbench = injectHedgeWorkbench()
const { canWrite } = workbench

const baselineRows = ref<BaselineRow[]>([])
const baselineStatus = ref<string | null>(null)
const schemePresets = ref<Array<Record<string, unknown>>>([])
const schemeActivation = ref<Record<string, unknown> | null>(null)
const schemeStatus = ref<string | null>(null)
const mechanismRows = ref<Array<Record<string, unknown>>>([])
const mechanismStatus = ref<string | null>(null)
const capsRows = ref<CapRow[]>([])
const capsStatus = ref<string | null>(null)

async function loadMaintenance() {
  const current = workbench.scopedRequest()
  fetchBandPresets().then((data) => {
    if (!current()) return undefined
    schemePresets.value = ((data as { rows: Array<Record<string, unknown>> }).rows) ?? []
    return fetchBandActivation({}).then((act) => {
      if (current()) schemeActivation.value = (act as { active?: Record<string, unknown> }).active ?? null
    })
  }).catch(() => { if (current()) schemeActivation.value = null })
  loadMechanismParams()
  loadCaps()
  try {
    const data = await fetchBaselines({ fromMonth: '2026-10', toMonth: '2026-12' })
    if (!current()) return
    baselineRows.value = (data as { rows: BaselineRow[] }).rows
      .map((row) => ({ stationId: row.stationId, month: row.month, quantityMwh: row.quantityMwh, basisNote: row.basisNote }))
  } catch {
    if (current()) baselineRows.value = []
  }
}

/** 维护写口错误统一映射（HW-10）：403 转只读态并说明所需权限；422 定位字段（details.field）；409 提示刷新。 */
function hedgeMaintenanceMessage(err: unknown): string {
  if (!(err instanceof HedgeApiError)) return '操作失败'
  if (err.status === 403) {
    workbench.markReadOnly()
    return '403：当前角色无公司写权限，已转只读（维护需要 ADMIN / 本公司 BOSS）'
  }
  if (err.status === 422) {
    const field = typeof err.details?.field === 'string' ? String(err.details.field) : null
    return field ? `422：字段 ${field} —— ${err.message}` : `422：${err.message}`
  }
  if (err.status === 409) return '409：已被他人更新，请刷新后核对'
  return `${err.errorCode}：${err.message}`
}

async function activateScheme(presetKey: string, label: string) {
  schemeStatus.value = null
  try {
    const created = await requestBandSchemeCreate({ name: `采用-${label}`, presetKey, origin: 'PRESET' })
    await activateBand({ schemeId: (created as { schemeId: number }).schemeId, versionNo: 1, reason: `采用预置${label}` })
    schemeStatus.value = `已切换到「${label}」（唯一生效，历史保留）`
    workbench.notifyDataChanged()
  } catch (err) {
    schemeStatus.value = hedgeMaintenanceMessage(err)
  }
}

async function loadMechanismParams() {
  const current = workbench.scopedRequest()
  try {
    const data = await fetchMechanismParams({})
    if (!current()) return
    mechanismRows.value = (data as { rows: Array<Record<string, unknown>> }).rows
    mechanismStatus.value = mechanismRows.value.length ? null : '暂无机制参数登记（导入后待业务确认）'
  } catch (err) {
    if (current()) mechanismStatus.value = err instanceof HedgeApiError ? err.message : '加载失败'
  }
}

async function loadCaps() {
  const current = workbench.scopedRequest()
  try {
    const data = await fetchCaps({ fromMonth: '2026-10', toMonth: '2026-12' })
    if (!current()) return
    capsRows.value = (data as { rows: CapRow[] }).rows
    capsStatus.value = capsRows.value.length ? null : '核定上限未登记（向交易机构索取核定文件后录入）'
  } catch (err) {
    if (current()) capsStatus.value = err instanceof HedgeApiError ? err.message : '加载失败'
  }
}

async function saveCap(row: CapRow) {
  capsStatus.value = null
  try {
    await putCaps([row])
    capsStatus.value = '核定上限已保存'
    await loadCaps()
  } catch (err) {
    capsStatus.value = hedgeMaintenanceMessage(err)
  }
}

async function saveBaselines() {
  baselineStatus.value = null
  try {
    await putBaselines(baselineRows.value)
    baselineStatus.value = '已保存（写入后下一次读取即反映到套保计算）'
    workbench.notifyDataChanged()
  } catch (err) {
    baselineStatus.value = hedgeMaintenanceMessage(err)
  }
}

async function confirmMechanism(row: Record<string, unknown>) {
  mechanismStatus.value = null
  try {
    await postMechanismVersion(String(row.periodKey), { action: 'CONFIRM', baseVersionNo: Number(row.versionNo), effectiveFrom: '2025-06-01' })
    mechanismStatus.value = '机制参数已确认生效'
    workbench.notifyDataChanged()
  } catch (err) {
    mechanismStatus.value = err instanceof HedgeApiError ? hedgeMaintenanceMessage(err) : '确认失败'
  }
}

useHedgeTabLifecycle(workbench, {
  load: loadMaintenance,
  reset: () => {
    baselineRows.value = []
    schemeActivation.value = null
    mechanismRows.value = []
    capsRows.value = []
  },
})
</script>

<template>
  <section class="maintenance" data-test="maintenance">
    <h3>区间方案（预置带出处，采用即快照；未配置时全站「未评估」）</h3>
    <p data-test="scheme-status">{{ schemeStatus ?? (schemeActivation ? `当前生效：v${(schemeActivation as { versionNo?: number }).versionNo ?? '—'}` : '未配置') }}</p>
    <div class="baseline-row">
      <button v-for="p in schemePresets" :key="String(p.key)" data-test="scheme-activate" :disabled="!canWrite" @click="activateScheme(String(p.key), String(p.label))">
        采用{{ p.label }}
      </button>
    </div>

    <h3>场站机制参数（比例制，待确认不参与计算）</h3>
    <p data-test="mechanism-status">{{ mechanismStatus ?? `${mechanismRows.length} 个生效期已登记` }}</p>
    <ul>
      <li v-for="(row, i) in mechanismRows" :key="i">
        场站 {{ row.stationId }}：比例 {{ row.ratio }}（{{ row.status }}<span v-if="row.endReason">/{{ row.endReason }}</span>）
        <button v-if="row.status === 'PENDING'" :disabled="!canWrite" @click="confirmMechanism(row)">确认生效</button>
      </li>
    </ul>

    <h3>核定上限（交易单元 × 月；未登记显示「核定上限未登记」）</h3>
    <p data-test="caps-status">{{ capsStatus ?? `${capsRows.length} 行已登记` }}</p>
    <div v-for="(row, i) in capsRows" :key="i" class="baseline-row">
      <input v-model="row.subjectId" placeholder="交易单元" />
      <input v-model="row.month" placeholder="2026-11" />
      <input v-model="row.capMwh" placeholder="MWh" />
      <button :disabled="!canWrite" @click="saveCap(row)">保存</button>
    </div>

    <h3>月度发电基准（经营计划口径，禁止用售电目标顶替）</h3>
    <p v-if="!canWrite" class="readonly-note">只读：维护需要公司写权限（ADMIN / 本公司 BOSS）</p>
    <div v-for="(row, i) in baselineRows" :key="i" class="baseline-row">
      <input v-model="row.stationId" placeholder="stationId" />
      <input v-model="row.month" placeholder="2026-11" />
      <input v-model="row.quantityMwh" placeholder="MWh" />
      <input v-model="row.basisNote" placeholder="依据说明" />
    </div>
    <button data-test="baseline-save" :disabled="!canWrite" @click="saveBaselines">保存基准</button>
    <p data-test="baseline-status">{{ baselineStatus }}</p>
  </section>
</template>

<style scoped>
.baseline-row { display: flex; gap: 8px; margin-bottom: 6px; }
</style>
