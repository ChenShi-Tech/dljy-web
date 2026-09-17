<script setup lang="ts">
// 中长期售电场站维度持仓（建议路由 /zcqjy/positions/stations，dljy#2971，MP-05/MP-06）。
// - 每月主体合计就是月度持仓该月的正式分解电量；场站份额是同一义务的拆分：主体合计 = 场站份额 + 未分配 + 月份未分到场站，
//   页面只展示这条拆分，不给「主体 + 场站」相加的合计。
// - 默认只用正式交易分解；内部经营分配需显式切换，并以警示说明区别展示。
// - 按合同总量分配的跨多月合同拆不到月份，整月计入「月份未分到场站」，不按比例推算。
// - 合同更正后沿用旧版本分配的片段标「沿用 vN」。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import MidlongNotice from '@/components/midlong/MidlongNotice.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { CompanyNotSelectedError, fetchCapabilities, fetchSubjects, midlongFailureOf } from '@/services/midlong/midlongApi'
import { exportStationPositions, fetchStationPositions, p2ModuleOn } from '@/services/midlong/midlongP2Api'
import type { MidlongCapabilities, MidlongSubject } from '@/services/midlong/midlongTypes'
import {
  STATION_DERIVATION_LABELS, type StationAllocationKind, type StationPositionQuery, type StationPositionReport,
} from '@/services/midlong/midlongP2Types'
import { createLoadGuard, downloadCsv, fmtQuantity } from '@/services/midlong/midlongFormat'
import { allocationKindTag, inheritedLabel, stationSplitText } from '@/services/midlong/midlongP2Format'

const route = useRoute()
const router = useRouter()

type LoadState = 'loading' | 'ready' | 'no-company' | 'unsupported' | 'disabled' | 'module-off' | 'denied' | 'failed'
const state = ref<LoadState>('loading')
const failureText = ref('')
const capabilities = ref<MidlongCapabilities | null>(null)
const report = ref<StationPositionReport | null>(null)
const subjects = ref<MidlongSubject[]>([])
const exporting = ref(false)
const drillMonth = ref<string | null>(null)

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const filters = reactive({
  monthRange: (q('fromMonth') && q('toMonth') ? [q('fromMonth'), q('toMonth')] : []) as string[],
  allocationKind: (q('allocationKind') === 'INTERNAL_OPERATING' ? 'INTERNAL_OPERATING' : 'FORMAL_TRADING') as StationAllocationKind,
  asOf: q('asOf'),
  subjectId: q('subjectId'),
})

const query = computed<StationPositionQuery>(() => {
  const out: StationPositionQuery = { allocationKind: filters.allocationKind }
  if (filters.monthRange.length === 2) { out.fromMonth = filters.monthRange[0]; out.toMonth = filters.monthRange[1] }
  if (filters.asOf) out.asOf = filters.asOf
  if (filters.subjectId) out.subjectId = filters.subjectId
  return out
})

const guard = createLoadGuard()
// 页面上这份 report 所用的查询（月份取服务端实际采用的范围）：导出用它，而不是控件里尚未点「查询」的值。
const reportQuery = ref<StationPositionQuery | null>(null)
const contextKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}|${JSON.stringify(query.value)}`
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
let loadedScope = ''

async function load() {
  const token = guard.begin(contextKey())
  if (scopeKey() !== loadedScope) report.value = null
  loadedScope = scopeKey()
  state.value = 'loading'
  try {
    const caps = await fetchCapabilities()
    if (!guard.isCurrent(token, contextKey())) return
    capabilities.value = caps
    if (!caps.enabled) { state.value = 'disabled'; return }
    if (!caps.regionSupported) { state.value = 'unsupported'; return }
    if (!p2ModuleOn(caps, 'stationAllocations')) { state.value = 'module-off'; return }
    const requested = { ...query.value }
    const [positions, subjectRows] = await Promise.all([fetchStationPositions(requested), fetchSubjects()])
    if (!guard.isCurrent(token, contextKey())) return
    report.value = positions
    reportQuery.value = { ...requested, fromMonth: positions.fromMonth, toMonth: positions.toMonth }
    subjects.value = subjectRows
    if (filters.monthRange.length !== 2) filters.monthRange = [positions.fromMonth, positions.toMonth]
    state.value = 'ready'
  } catch (error) {
    if (!guard.isCurrent(token, contextKey())) return
    report.value = null
    reportQuery.value = null
    if (error instanceof CompanyNotSelectedError) { state.value = 'no-company'; return }
    const f = midlongFailureOf(error)
    state.value = f.status === 401 || f.status === 403 ? 'denied' : 'failed'
    failureText.value = f.message
  }
}

function apply() {
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(query.value)) if (v) next[k] = String(v)
  void router.replace({ query: next })
  drillMonth.value = null
  void load()
}

async function doExport() {
  if (!reportQuery.value) return
  exporting.value = true
  const scope = scopeKey()
  try {
    const file = await exportStationPositions(reportQuery.value)
    if (scope !== scopeKey()) { ElMessage.warning('公司或地区已切换，已丢弃切换前发起的导出'); return }
    downloadCsv(file.fileName, file.content)
  } catch (error) {
    ElMessage.error(midlongFailureOf(error).message)
  } finally {
    exporting.value = false
  }
}

onMounted(load)
watch([selectedCompanyId, () => currentRegion.value.id], () => {
  filters.monthRange = []
  filters.subjectId = ''
  apply()
})

const totals = computed(() => report.value?.totals ?? null)
const stationColumns = computed(() => report.value?.stations ?? [])
const stationQuantity = (month: StationPositionReport['months'][number], stationId: number) => month.stations.find((s) => s.stationId === stationId)?.quantity ?? null
const drillRows = computed(() => (report.value?.contributions ?? []).filter((c) => c.month === drillMonth.value))
const inheritedSetCount = computed(() => (report.value?.allocationSetsUsed ?? []).filter((s) => s.inheritedFromRevisionNo).length)
const stationName = (id: number | null) => (id === null ? '—' : stationColumns.value.find((s) => s.stationId === id)?.stationName ?? `场站 ${id}`)
</script>

<template>
  <div class="ml-page">
    <div class="ml-head">
      <h2 class="ml-title">中长期售电场站维度持仓</h2>
      <span class="ml-sub">主体合计与场站份额是同一义务的两种观察维度 · 合同量价名义口径（非结算）</span>
    </div>
    <CompanyScopeBar />

    <div v-if="state === 'loading' && !report" v-loading="true" class="ml-placeholder" />
    <MidlongNotice v-else-if="state === 'no-company'" tone="warn" title="请选择公司">当前地区尚未选择有效公司。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'unsupported'" tone="info" title="当前地区未开通中长期售电模块">{{ capabilities?.reason }}。不回退读取其他地区数据。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'disabled'" tone="warn" title="模块已暂停使用">已确认合同的版本与写保护保持不变。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'module-off'" tone="info" title="场站分配尚未开通">场站分配能力尚未交付验收，月度持仓照常可用。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'denied'" tone="danger" title="无权访问">{{ failureText }}</MidlongNotice>
    <MidlongNotice v-else-if="state === 'failed'" tone="danger" title="场站持仓加载失败（未显示任何替代数值）">{{ failureText }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>

    <template v-if="report && totals && (state === 'ready' || state === 'loading')">
      <div class="ml-filters">
        <el-date-picker v-model="filters.monthRange" type="monthrange" value-format="YYYY-MM" range-separator="至" start-placeholder="起始月" end-placeholder="结束月" style="width: 240px" />
        <el-radio-group v-model="filters.allocationKind" size="small">
          <el-radio-button value="FORMAL_TRADING">正式交易分解</el-radio-button>
          <el-radio-button value="INTERNAL_OPERATING">内部经营分配</el-radio-button>
        </el-radio-group>
        <el-date-picker v-model="filters.asOf" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSSZ" placeholder="历史认知时点（可空=当前）" style="width: 230px" />
        <el-select v-model="filters.subjectId" placeholder="交易主体" clearable filterable style="width: 150px">
          <el-option v-for="s in subjects" :key="s.id" :label="s.displayName" :value="String(s.id)" />
        </el-select>
        <el-button type="primary" @click="apply">查询</el-button>
        <el-button :loading="exporting" :disabled="!reportQuery" title="导出当前页面显示的查询结果（未点「查询」的筛选改动不计入）" @click="doExport">导出</el-button>
        <router-link to="/zcqjy/positions" class="ml-link">月度持仓 →</router-link>
      </div>

      <MidlongNotice v-if="report.allocationKind === 'INTERNAL_OPERATING'" tone="warn" title="当前为内部经营分配视图">
        以下场站份额来自内部经营分配，不是正式交易分解；主体合计与正式口径相同。
      </MidlongNotice>
      <MidlongNotice v-else tone="info">
        {{ allocationKindTag(report.allocationKind).label }}：{{ report.excluded.note }}。合同绑定场站的电量整月归该场站。
      </MidlongNotice>
      <MidlongNotice v-if="report.view === 'AS_OF'" tone="info" title="历史认知时点视图">
        只使用 {{ new Date(report.asOf).toLocaleString('zh-CN') }} 之前已录入并已确认的合同版本与场站分配。
      </MidlongNotice>
      <MidlongNotice v-if="inheritedSetCount" tone="info" title="部分分配沿用更正前的版本">
        {{ inheritedSetCount }} 份合同更正后未重新分配：未受更正影响的片段继续采用旧版本上已确认的场站分配，受影响片段计入未分配。
      </MidlongNotice>
      <MidlongNotice v-if="report.status === 'partial' && totals.unallocatedPoolQuantity !== '0'" tone="warn" title="月度持仓不完整">
        另有 {{ fmtQuantity(totals.unallocatedPoolQuantity) }} MWh 尚未分解到月份（见月度持仓的跨期未分解池），不在本表各月内。
      </MidlongNotice>

      <div class="ml-tiles">
        <div class="ml-tile"><span>主体合计</span><b>{{ fmtQuantity(totals.subjectTotalQuantity) }}<i>MWh</i></b><small>与月度持仓同一数值</small></div>
        <div class="ml-tile"><span>其中：场站份额</span><b>{{ fmtQuantity(totals.stationAllocatedQuantity) }}<i>MWh</i></b><small>{{ stationColumns.length }} 个场站</small></div>
        <div class="ml-tile warn"><span>其中：未分配</span><b>{{ fmtQuantity(totals.unallocatedQuantity) }}<i>MWh</i></b><small>交易单元统签、尚未分到场站</small></div>
        <div class="ml-tile warn"><span>其中：月份未分到场站</span><b>{{ fmtQuantity(totals.stationMonthUnknownQuantity) }}<i>MWh</i></b><small>按合同总量分配 · 不按比例推算</small></div>
      </div>

      <div class="ml-panel">
        <h3>逐月拆分 <small>点击月份查看合同贡献</small></h3>
        <el-table :data="report.months" border size="small" highlight-current-row @row-click="(row: StationPositionReport['months'][number]) => (drillMonth = row.month)">
          <el-table-column prop="month" label="月份" width="90" fixed />
          <el-table-column label="主体合计(MWh)" width="130" align="right"><template #default="{ row }"><b>{{ fmtQuantity(row.subjectTotalQuantity) }}</b></template></el-table-column>
          <el-table-column v-for="s in stationColumns" :key="s.stationId" :label="s.stationName ?? `场站 ${s.stationId}`" min-width="120" align="right">
            <template #default="{ row }">{{ stationQuantity(row, s.stationId) === null ? '—' : fmtQuantity(stationQuantity(row, s.stationId)) }}</template>
          </el-table-column>
          <el-table-column label="未分配" width="110" align="right"><template #default="{ row }"><span class="ml-warn">{{ fmtQuantity(row.unallocatedQuantity) }}</span></template></el-table-column>
          <el-table-column label="月份未分到场站" width="130" align="right"><template #default="{ row }">{{ fmtQuantity(row.stationMonthUnknownQuantity) }}</template></el-table-column>
          <el-table-column label="拆分核对" min-width="320"><template #default="{ row }"><span class="ml-muted">{{ stationSplitText(row) }}</span></template></el-table-column>
        </el-table>
      </div>

      <div v-if="drillMonth" class="ml-panel">
        <h3>{{ drillMonth }} 合同贡献 <el-button link @click="drillMonth = null">收起</el-button></h3>
        <el-table :data="drillRows" border size="small">
          <el-table-column label="合同" min-width="220"><template #default="{ row }"><router-link :to="`/zcqjy/contracts/${row.contractId}`" class="ml-link">{{ row.externalContractNo }}</router-link> {{ row.contractName }}</template></el-table-column>
          <el-table-column label="版本" width="70"><template #default="{ row }">v{{ row.revisionNo }}</template></el-table-column>
          <el-table-column label="场站" width="150"><template #default="{ row }">{{ stationName(row.stationId) }}</template></el-table-column>
          <el-table-column label="电量(MWh)" width="120" align="right"><template #default="{ row }">{{ fmtQuantity(row.quantity) }}</template></el-table-column>
          <el-table-column label="来源" min-width="220">
            <template #default="{ row }">
              {{ STATION_DERIVATION_LABELS[row.derivation as 'ALLOCATION'] }}{{ row.allocationSetNo ? `（分配集 #${row.allocationSetNo}${row.inheritedFromRevisionNo ? ` · ${inheritedLabel(row.inheritedFromRevisionNo)}` : ''}）` : '' }}
            </template>
          </el-table-column>
          <template #empty>该月没有已明确到月份的正式分解电量。</template>
        </el-table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ml-page { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.ml-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.ml-title { margin: 0; font-size: var(--font-20); }
.ml-sub { color: var(--muted); font-size: var(--font-md); }
.ml-placeholder { min-height: 200px; }
.ml-filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ml-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.ml-tile { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius, 8px); background: var(--panel); }
.ml-tile span { font-size: var(--font-sm); color: var(--muted); }
.ml-tile b { font-size: var(--font-24); font-weight: 650; font-variant-numeric: tabular-nums; font-family: var(--font-display); }
.ml-tile b i { font-style: normal; font-size: var(--font-sm); color: var(--muted); margin-left: 4px; font-weight: 500; }
.ml-tile small { font-size: var(--font-xs); color: var(--muted); }
.ml-tile.warn b { color: var(--warning); }
.ml-panel { border: 1px solid var(--line); border-radius: var(--radius, 8px); padding: 14px 16px; background: var(--panel); }
.ml-panel h3 { margin: 0 0 10px; font-size: var(--font-16); display: flex; align-items: baseline; gap: 8px; }
.ml-panel h3 small { font-size: var(--font-sm); color: var(--muted); font-weight: 400; }
.ml-link { color: var(--accent); text-decoration: none; margin-right: 6px; }
.ml-warn { color: var(--warning); }
.ml-muted { color: var(--muted); font-size: var(--font-sm); }
@media (max-width: 1100px) { .ml-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
