<script setup lang="ts">
// 中长期售电分时持仓（建议路由 /zcqjy/positions/intervals，dljy#2971，MP-02/MP-04/MP-06）。
// - 只计已确认的正式分时分解；内部估算集不计入，列在排除项里。
// - 只有月量、分时粒度不足或月量未知的合同在该时段是「分时未知」：电量不显示 0、不均摊，图上不画柱；
//   当天没有任何交割义务的时段才是真实 0。
// - 时段钻取到合同与所用分解集（再到原始曲线行），导出与页面同一次查询。
// - 支持历史认知时点；服务失败显示错误，不回退示意数值；本页不调用现货、预测或厂侧接口。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import ChartCard from '@/components/common/ChartCard.vue'
import MidlongNotice from '@/components/midlong/MidlongNotice.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { cssVar } from '@/composables/useTheme'
import { withAlpha } from '@/services/chart/chartStyle'
import { CompanyNotSelectedError, fetchCapabilities, fetchSubjects, midlongFailureOf } from '@/services/midlong/midlongApi'
import { exportIntervalPositions, fetchIntervalPositions, p2ModuleOn } from '@/services/midlong/midlongP2Api'
import { ENERGY_ATTRIBUTES, ENERGY_ATTRIBUTE_LABELS, beijingToday, type MidlongCapabilities, type MidlongSubject } from '@/services/midlong/midlongTypes'
import {
  INTERVAL_POSITION_MAX_DAYS, type IntervalBucket, type IntervalPositionGranularity, type IntervalPositionQuery, type IntervalPositionReport,
} from '@/services/midlong/midlongP2Types'
import { createLoadGuard, downloadCsv, fmtQuantity } from '@/services/midlong/midlongFormat'
import { bucketQuantityLabel, bucketTimeLabel, coverageTag, timeStatusTag } from '@/services/midlong/midlongP2Format'

const route = useRoute()
const router = useRouter()

type LoadState = 'loading' | 'ready' | 'no-company' | 'unsupported' | 'disabled' | 'module-off' | 'denied' | 'failed'
const state = ref<LoadState>('loading')
const failureText = ref('')
const capabilities = ref<MidlongCapabilities | null>(null)
const report = ref<IntervalPositionReport | null>(null)
const subjects = ref<MidlongSubject[]>([])
const exporting = ref(false)
const drillBucket = ref<IntervalBucket | null>(null)

const GRANULARITY_OPTIONS: Array<{ value: IntervalPositionGranularity; label: string }> = [
  { value: 'DAY', label: '日' }, { value: 'HOUR', label: '小时' }, { value: 'QUARTER_HOUR', label: '15 分钟' },
]
const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const today = beijingToday()
const filters = reactive({
  dateRange: (q('fromDate') && q('toDate') ? [q('fromDate'), q('toDate')] : [today, today]) as string[],
  granularity: (['DAY', 'HOUR', 'QUARTER_HOUR'].includes(q('granularity')) ? q('granularity') : 'HOUR') as IntervalPositionGranularity,
  asOf: q('asOf'),
  subjectId: q('subjectId'),
  energyAttribute: q('energyAttribute'),
})

const query = computed<IntervalPositionQuery>(() => {
  const out: IntervalPositionQuery = { fromDate: filters.dateRange[0] ?? today, toDate: filters.dateRange[1] ?? today, granularity: filters.granularity }
  if (filters.asOf) out.asOf = filters.asOf
  if (filters.subjectId) out.subjectId = filters.subjectId
  if (filters.energyAttribute) out.energyAttribute = filters.energyAttribute
  return out
})

const guard = createLoadGuard()
const contextKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}|${JSON.stringify(query.value)}`
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
let loadedScope = ''

async function load() {
  const token = guard.begin(contextKey())
  if (scopeKey() !== loadedScope) report.value = null
  loadedScope = scopeKey()
  state.value = 'loading'
  drillBucket.value = null
  try {
    const caps = await fetchCapabilities()
    if (!guard.isCurrent(token, contextKey())) return
    capabilities.value = caps
    if (!caps.enabled) { state.value = 'disabled'; return }
    if (!caps.regionSupported) { state.value = 'unsupported'; return }
    if (!p2ModuleOn(caps, 'curves')) { state.value = 'module-off'; return }
    const [positions, subjectRows] = await Promise.all([fetchIntervalPositions(query.value), fetchSubjects()])
    if (!guard.isCurrent(token, contextKey())) return
    report.value = positions
    subjects.value = subjectRows
    state.value = 'ready'
  } catch (error) {
    if (!guard.isCurrent(token, contextKey())) return
    report.value = null
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
  void load()
}

async function doExport() {
  exporting.value = true
  const scope = scopeKey()
  try {
    const file = await exportIntervalPositions(query.value)
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
  filters.subjectId = ''
  apply()
})

const totals = computed(() => report.value?.totals ?? null)
const maxDaysHint = computed(() => `当前粒度一次最多 ${INTERVAL_POSITION_MAX_DAYS[filters.granularity]} 天`)
const contractById = computed(() => new Map((report.value?.contracts ?? []).map((c) => [c.contractId, c])))
const drillContracts = computed(() => {
  const bucket = drillBucket.value
  if (!bucket || !report.value) return []
  return report.value.contracts
    .filter((c) => bucket.date >= c.deliveryStart && bucket.date <= c.deliveryEnd)
    .map((c) => ({ contract: c, month: c.months.find((m) => m.month === bucket.month) ?? null, unknown: bucket.unknownContractIds.includes(c.contractId) }))
})

function buildOption(): Record<string, unknown> {
  const buckets = report.value?.buckets ?? []
  const labels = buckets.map((b) => bucketTimeLabel(b.start, filters.granularity))
  const accent = cssVar('--accent') || '#2563eb'
  const warning = cssVar('--warning') || '#f59e0b'
  const muted = cssVar('--muted') || '#94a3b8'
  // 连续的「分时未知」时段画成灰色底带：不画柱，避免被读成 0。
  const unknownAreas: Array<[Record<string, string>, Record<string, string>]> = []
  buckets.forEach((b, i) => {
    if (b.coverage !== 'UNKNOWN') return
    const last = unknownAreas[unknownAreas.length - 1]
    if (last && buckets[i - 1]?.coverage === 'UNKNOWN') last[1] = { xAxis: labels[i] }
    else unknownAreas.push([{ xAxis: labels[i], name: '分时未知' }, { xAxis: labels[i] }])
  })
  return {
    grid: { left: 64, right: 24, top: 36, bottom: 48 },
    legend: { top: 0, data: ['正式分时电量', '部分合同分时未知的时段'] },
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ dataIndex: number }>) => {
        const b = buckets[params[0]?.dataIndex ?? -1]
        if (!b) return ''
        return [
          `<b>${b.start.slice(0, 16).replace('T', ' ')} 起</b>`,
          `正式分时电量：${bucketQuantityLabel(b)}${b.formalQuantity !== null && b.coverage !== 'NO_OBLIGATION' ? ' MWh' : ''}`,
          `覆盖：${coverageTag(b.coverage).label}`,
          b.unknownContractIds.length ? `分时未知合同 ${b.unknownContractIds.length} 份（不补零、不均摊）` : '',
        ].filter(Boolean).join('<br/>')
      },
    },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', name: 'MWh' },
    series: [
      {
        name: '正式分时电量', type: 'bar', stack: 'qty', itemStyle: { color: accent },
        data: buckets.map((b) => (b.coverage === 'COMPLETE' || b.coverage === 'NO_OBLIGATION' ? Number(b.formalQuantity) : null)),
        markArea: { silent: true, itemStyle: { color: withAlpha(muted, 0.18) }, label: { color: muted }, data: unknownAreas },
      },
      {
        name: '部分合同分时未知的时段', type: 'bar', stack: 'qty',
        itemStyle: { color: withAlpha(accent, 0.35), borderColor: warning, borderWidth: 2, borderType: 'dashed' },
        data: buckets.map((b) => (b.coverage === 'PARTIAL' ? Number(b.formalQuantity) : null)),
      },
    ],
  }
}
</script>

<template>
  <div class="ml-page">
    <div class="ml-head">
      <h2 class="ml-title">中长期售电分时持仓</h2>
      <span class="ml-sub">按已确认的正式分时分解汇总 · 合同量价名义口径（非结算）</span>
    </div>
    <CompanyScopeBar />

    <div v-if="state === 'loading' && !report" v-loading="true" class="ml-placeholder" />
    <MidlongNotice v-else-if="state === 'no-company'" tone="warn" title="请选择公司">当前地区尚未选择有效公司。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'unsupported'" tone="info" title="当前地区未开通中长期售电模块">{{ capabilities?.reason }}。不回退读取其他地区数据。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'disabled'" tone="warn" title="模块已暂停使用">已确认合同的版本与写保护保持不变。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'module-off'" tone="info" title="分时持仓尚未开通">分时分解能力尚未交付验收，月度持仓照常可用。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'denied'" tone="danger" title="无权访问">{{ failureText }}</MidlongNotice>
    <MidlongNotice v-else-if="state === 'failed'" tone="danger" title="分时持仓加载失败（未显示任何替代数值）">{{ failureText }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>

    <template v-if="report && totals && (state === 'ready' || state === 'loading')">
      <div class="ml-filters">
        <el-date-picker v-model="filters.dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="起始日" end-placeholder="结束日" style="width: 240px" />
        <el-radio-group v-model="filters.granularity" size="small">
          <el-radio-button v-for="g in GRANULARITY_OPTIONS" :key="g.value" :value="g.value">{{ g.label }}</el-radio-button>
        </el-radio-group>
        <span class="ml-hint">{{ maxDaysHint }}</span>
        <el-date-picker v-model="filters.asOf" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSSZ" placeholder="历史认知时点（可空=当前）" style="width: 230px" />
        <el-select v-model="filters.subjectId" placeholder="交易主体" clearable filterable style="width: 150px">
          <el-option v-for="s in subjects" :key="s.id" :label="s.displayName" :value="String(s.id)" />
        </el-select>
        <el-select v-model="filters.energyAttribute" placeholder="电能属性" clearable style="width: 110px">
          <el-option v-for="k in ENERGY_ATTRIBUTES" :key="k" :label="ENERGY_ATTRIBUTE_LABELS[k]" :value="k" />
        </el-select>
        <el-button type="primary" @click="apply">查询</el-button>
        <el-button :loading="exporting" @click="doExport">导出</el-button>
        <router-link to="/zcqjy/positions" class="ml-link">月度持仓 →</router-link>
      </div>

      <MidlongNotice v-if="report.view === 'AS_OF'" tone="info" title="历史认知时点视图">
        只使用 {{ new Date(report.asOf).toLocaleString('zh-CN') }} 之前已录入并已确认的合同版本与分时分解；之后的更正或新确认的曲线不影响本视图。
      </MidlongNotice>
      <MidlongNotice v-if="report.status === 'partial'" tone="warn" title="部分时段分时未知">
        {{ totals.timeUnknownContractCount }} 份合同在所选范围内只有月量、分时粒度不足或月量未知：这些时段显示「分时未知」，不补零、不按天或时段均摊。
      </MidlongNotice>
      <MidlongNotice v-if="report.status === 'empty'" tone="info" title="所选范围内没有已确认的中长期售电义务" />

      <div class="ml-tiles">
        <div class="ml-tile"><span>区间正式分时电量</span><b>{{ fmtQuantity(totals.curveQuantityInRange) }}<i>MWh</i></b><small>{{ totals.contractCount }} 份已确认合同</small></div>
        <div class="ml-tile warn"><span>分时未知时段</span><b>{{ totals.unknownBucketCount }}<i>个</i></b><small>另有 {{ totals.partialBucketCount }} 个时段部分未知</small></div>
        <div class="ml-tile warn"><span>分时未知合同</span><b>{{ totals.timeUnknownContractCount }}<i>份</i></b><small>只有月量或粒度不足 · 不均摊</small></div>
        <div class="ml-tile"><span>内部估算分解集</span><b>{{ report.excluded.estimateCurveSets.length }}<i>套</i></b><small>不计入正式分时持仓</small></div>
      </div>

      <ChartCard title="分时持仓（灰色底带为分时未知，虚线框为部分未知）" :height="320" :build-option="buildOption" :empty="report.status === 'empty'" empty-text="暂无已确认持仓" />

      <div class="ml-panel">
        <h3>时段明细 <small>点击时段查看合同与所用分解集</small></h3>
        <el-table :data="report.buckets" border size="small" max-height="420" highlight-current-row @row-click="(row: IntervalBucket) => (drillBucket = row)">
          <el-table-column label="时段" min-width="200"><template #default="{ row }">{{ row.start.slice(0, 16).replace('T', ' ') }} ~ {{ row.end.slice(11, 16) }}</template></el-table-column>
          <el-table-column label="正式分时电量(MWh)" min-width="200" align="right">
            <template #default="{ row }"><span :class="{ 'ml-warn': row.coverage === 'UNKNOWN' || row.coverage === 'PARTIAL' }">{{ bucketQuantityLabel(row) }}</span></template>
          </el-table-column>
          <el-table-column label="覆盖" width="150"><template #default="{ row }"><el-tag size="small" :type="coverageTag(row.coverage).type">{{ coverageTag(row.coverage).label }}</el-tag></template></el-table-column>
          <el-table-column prop="knownContractCount" label="已有分时合同" width="110" align="right" />
          <el-table-column label="分时未知合同" width="120" align="right"><template #default="{ row }">{{ row.unknownContractIds.length }}</template></el-table-column>
        </el-table>
      </div>

      <div v-if="drillBucket" class="ml-panel">
        <h3>{{ drillBucket.start.slice(0, 16).replace('T', ' ') }} 合同分时来源 <el-button link @click="drillBucket = null">收起</el-button></h3>
        <el-table :data="drillContracts" border size="small">
          <el-table-column label="合同" min-width="220">
            <template #default="{ row }"><router-link :to="`/zcqjy/contracts/${row.contract.contractId}`" class="ml-link">{{ row.contract.externalContractNo }}</router-link> {{ row.contract.contractName }}</template>
          </el-table-column>
          <el-table-column label="版本" width="70"><template #default="{ row }">v{{ row.contract.revisionNo }}</template></el-table-column>
          <el-table-column label="该月分时状态" width="190">
            <template #default="{ row }"><el-tag v-if="row.month" size="small" :type="timeStatusTag(row.month.timeStatus).type">{{ timeStatusTag(row.month.timeStatus).label }}</el-tag></template>
          </el-table-column>
          <el-table-column label="正式月度电量(MWh)" width="150" align="right"><template #default="{ row }">{{ fmtQuantity(row.month?.monthlyFormalQuantity) }}</template></el-table-column>
          <el-table-column label="所用分解集" min-width="180">
            <template #default="{ row }">
              <router-link v-if="row.month?.curve && !row.unknown" :to="`/zcqjy/curves/${row.month.curve.curveSetId}?date=${drillBucket.date}`" class="ml-link">分解集 #{{ row.month.curve.setNo }}（{{ row.month.curve.granularityMinutes }} 分钟）</router-link>
              <span v-else class="ml-warn">分时未知，未计入该时段</span>
              <span v-if="row.month?.estimate" class="ml-hint">另有内部估算 #{{ row.month.estimate.setNo }}（不计入）</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="ml-panel">
        <h3>合同分时状态（{{ report.contracts.length }}）</h3>
        <el-table :data="report.contracts" border size="small">
          <el-table-column label="合同" min-width="220"><template #default="{ row }"><router-link :to="`/zcqjy/contracts/${row.contractId}`" class="ml-link">{{ row.externalContractNo }}</router-link> {{ row.contractName }}</template></el-table-column>
          <el-table-column label="交割期" width="200"><template #default="{ row }">{{ row.deliveryStart }} ~ {{ row.deliveryEnd }}</template></el-table-column>
          <el-table-column label="各月分时状态" min-width="280">
            <template #default="{ row }">
              <el-tag v-for="m in row.months" :key="m.month" size="small" :type="timeStatusTag(m.timeStatus).type" class="ml-tag">{{ m.month }} {{ timeStatusTag(m.timeStatus).label }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="区间分时电量(MWh)" width="150" align="right"><template #default="{ row }">{{ fmtQuantity(contractById.get(row.contractId)?.curveQuantityInRange) }}</template></el-table-column>
        </el-table>
      </div>

      <MidlongNotice tone="info" title="未计入的分解">
        {{ report.excluded.note }}。内部估算分解集 {{ report.excluded.estimateCurveSets.length }} 套。数据生成于 {{ new Date(report.generatedAt).toLocaleString('zh-CN') }}。
      </MidlongNotice>
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
.ml-hint { color: var(--muted); font-size: var(--font-sm); margin-left: 4px; }
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
.ml-tag { margin: 0 4px 4px 0; }
@media (max-width: 1100px) { .ml-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
