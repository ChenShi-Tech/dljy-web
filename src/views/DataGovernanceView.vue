<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import DynamicTable from '@/components/common/DynamicTable.vue'
import ChartCard from '@/components/common/ChartCard.vue'
import DataState from '@/components/common/DataState.vue'
import DataBasisBadge from '@/components/DataBasisBadge.vue'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import { apiGet } from '@/services/api'
import { getCurrentUser } from '@/services/auth'
import { canAccessPath } from '@/services/governance'
import { ageDaysOf, freshnessOf, type Freshness } from '@/services/data/freshness'
import { onRegionChange } from '@/composables/useRegionReload'

const ROUTE_PATH = '/yygl/data-governance'

// 现货 S2/S3 新接入的 5 个 yn_* family（issue #384）。consumeNote 如实标注当前消费入口——
// 这 5 族 apiFamily=null（无独立 /api/v1 业务接口），主要经 /api/real 回放 + 本面板质量呈现。
const SPOT_QUALITY_FAMILIES = [
  { family: 'yn_user_price', label: '用户侧统一电价', consumeNote: '日前/实时用户侧电价 · /api/real 回放 + 本面板' },
  { family: 'yn_plant_nodal_price', label: '厂站节点多价型电价', consumeNote: '厂站结算电价（多价型）· /api/real 回放 + 本面板' },
  { family: 'yn_settlement_detail', label: '月结明细', consumeNote: 'summary/charge/project/source · /api/real 回放 + 本面板' },
  { family: 'yn_hydro_group_limit', label: '水电群电量上限', consumeNote: '优化出清披露 · /api/real 回放 + 本面板' },
  { family: 'yn_plant_output', label: '厂站出力预测vs实际', consumeNote: '8 源长表 · /api/real 回放 + 本面板' }
] as const

type CatalogItem = {
  family: string
  familyLabel: string
  registered: boolean
  kind: string
  region: string
  datasetKey: string
  rowCount: number
  byteSize: number
  sourceType: string
  // 数据可见性分级 + 归属公司（Sub-6 #522）：public=全网披露全员可见，company=公司私有（带 ownerCompanyId）。
  visibility?: string
  ownerCompanyId?: string | null
  capturedAt: string | null
  ingestedAt: string | null
  dataTime: string | null
}

type RegisteredFamily = {
  family: string
  label: string
  apiFamily: string | null
  kind: string
  hasData: boolean
  datasetCount: number
  rowCount: number
  byteSize: number
}
type CatalogPayload = {
  generatedAt: string
  region: string
  empty: boolean
  message: string
  stats: {
    families: number
    datasets: number
    rows: number
    documents: number
    file: string | null
    bySource: Array<{ source_type: string; n: number }>
  }
  registeredFamilyCount: number
  registeredFamilies: RegisteredFamily[]
  items: CatalogItem[]
}

type QualityStatus = 'pass' | 'warn' | 'fail'
type QualityCheck = { id: string; status: QualityStatus; detail?: string }
type QualityFailingDay = { date: string; actual: number; expected: number; ratio: number }
type QualityCompleteness = {
  expectedPointsPerDay?: number
  checkedDays?: number
  minRatio?: number
  avgRatio?: number
  failingDayCount?: number
  // quality-scan.mjs::buildCompleteness 已产出的「未达标日」明细（前 50 条，每条带当日
  // actual/expected/ratio）。前端原本只读 failingDayCount 计数——issue #455 下钻消费它画
  // 完整率趋势 + 缺点明细表。
  failingDays?: QualityFailingDay[]
}
type QualityFreshness = {
  capturedAt?: string | null
  cadence?: string
  ageHours?: number | null
  status?: QualityStatus
  detail?: string
}
type QualityDuplicate = { duplicateGroups?: number; duplicateRows?: number; sampledRows?: number }
type QualityOutlier = {
  checkedFields?: number
  outlierCandidates?: number
  sampledValues?: number
  fields?: Array<{ field: string; outlierCandidates?: number; sampledValues?: number }>
}
type QualityItem = {
  family: string
  datasetKey: string
  region: string
  coverage?: { minDate?: string; maxDate?: string; days?: number; gapDays?: string[] }
  pointsCompleteness?: QualityCompleteness
  duplicates?: QualityDuplicate
  outliers?: QualityOutlier
  freshness?: QualityFreshness
  checks?: QualityCheck[]
}
type QualityPayload = {
  generatedAt: string | null
  region: string
  summary: { pass: number; warn: number; fail: number }
  items: QualityItem[]
  empty: boolean
  message: string
}

// issue #455 质量下钻派生类型：把同 family 多 datasetKey 的 failingDays/gapDays/duplicates/
// outlierFields 聚合成一份下钻数据，供卡片展开区消费（计数之上的「具体哪几天/哪些字段」）。
type DrilldownFailingDay = QualityFailingDay & { datasetKey: string }
type DrilldownGapDay = { date: string; datasetKey: string }
type DrilldownOutlierField = { field: string; outlierCandidates: number; sampledValues: number; datasetKey: string }
type DuplicateSummary = {
  duplicateGroups: number
  duplicateRows: number
  sampledRows: number
  byDataset: Array<{ datasetKey: string; duplicateRows: number; sampledRows: number }>
}
type SpotDrilldown = {
  hasTrend: boolean
  failingDays: DrilldownFailingDay[]
  gapDays: DrilldownGapDay[]
  checkedDays: number
  expectedPointsPerDay: number | null
  duplicateSummary: DuplicateSummary
  outlierFields: DrilldownOutlierField[]
}

type BackupLatest = {
  name: string
  createdAt: string | null
  ts: string
  full: boolean
  sqliteCount: number
  manifests: Record<string, { count?: number; totalSize?: number }>
  manifestFileSize: number
  manifestMtime: string
}
type BackupPayload = {
  generatedAt: string
  region: string
  backupRoot: string
  available: boolean
  message: string
  latest: BackupLatest | null
  history: BackupLatest[]
}

type QualityAlert = {
  status: 'warn' | 'fail'
  family: string
  datasetKey: string
  region: string
  checkId: string
  detail: string
  coverage: string
  pointsCompleteness: string
  freshness: string
}

const currentUser = ref(getCurrentUser())
const canView = computed(() => canAccessPath(ROUTE_PATH, currentUser.value))
const activeTab = ref('catalog')
const loading = ref(false)
const error = ref('')
const catalog = ref<CatalogPayload | null>(null)
const quality = ref<QualityPayload | null>(null)
const backup = ref<BackupPayload | null>(null)

const catalogRows = computed<Array<Record<string, unknown>>>(() =>
  (catalog.value?.items ?? []).map((item) => ({
    family: item.family,
    familyLabel: item.familyLabel,
    region: item.region,
    datasetKey: item.datasetKey,
    kind: item.kind,
    rowCount: item.rowCount,
    byteSize: formatBytes(item.byteSize),
    freshness: freshnessText(item),
    dataTime: formatDateTime(item.dataTime),
    sourceType: item.sourceType,
    // 归属：company 私有族显归属公司 id，public 全网披露显「公共」（Sub-6 #522）。
    owner: item.visibility === 'company' ? (item.ownerCompanyId ?? '公司私有') : '公共',
    registered: item.registered ? '已注册' : '未注册'
  }))
)

const stationRows = computed(() => catalogRows.value.filter((row) => String(row.family).startsWith('yn_dim_')))

type SpotFamilyCard = {
  family: string
  label: string
  consumeNote: string
  hasData: boolean
  datasetCount: number
  rowCount: number
  latestDataTime: string | null
  qualityGenerated: boolean
  avgRatio: number | null
  minRatio: number | null
  gapDays: number
  failingDayCount: number
  duplicateRows: number
  outlierCandidates: number
  failCount: number
  warnCount: number
}

// 现货 5 族质量卡片：合并 catalog（已接入/数据集/行数/最新时间）与 quality（完整率/缺失/重复/异常/告警）
// 维度。无数据时如实标"未接入"，不伪造绿灯（issue #384 第 3 条）。
const spotFamilies = computed<SpotFamilyCard[]>(() => {
  const spotFamilySet = new Set<string>(SPOT_QUALITY_FAMILIES.map((s) => s.family))

  const catalogByFamily = new Map<string, { hasData: boolean; datasetCount: number; rowCount: number; dataTime: string | null }>()
  for (const fam of catalog.value?.registeredFamilies ?? []) {
    if (!spotFamilySet.has(fam.family)) continue
    catalogByFamily.set(fam.family, {
      hasData: fam.hasData,
      datasetCount: fam.datasetCount,
      rowCount: fam.rowCount,
      dataTime: null
    })
  }
  for (const item of catalog.value?.items ?? []) {
    if (!spotFamilySet.has(item.family)) continue
    const prev = catalogByFamily.get(item.family)
    if (!prev) continue
    if (!prev.dataTime && item.dataTime) prev.dataTime = item.dataTime
  }

  const qualityByFamily = new Map<string, QualityItem[]>()
  for (const item of quality.value?.items ?? []) {
    if (!spotFamilySet.has(item.family)) continue
    const list = qualityByFamily.get(item.family) ?? []
    list.push(item)
    qualityByFamily.set(item.family, list)
  }

  return SPOT_QUALITY_FAMILIES.map((spec) => {
    const cat = catalogByFamily.get(spec.family)
    const subItems = qualityByFamily.get(spec.family) ?? []
    const ratios = subItems
      .map((i) => i.pointsCompleteness?.avgRatio)
      .filter((r): r is number => typeof r === 'number' && !Number.isNaN(r))
    const minRatios = subItems
      .map((i) => i.pointsCompleteness?.minRatio)
      .filter((r): r is number => typeof r === 'number' && !Number.isNaN(r))
    const gapDays = subItems.reduce((s, i) => s + (i.coverage?.gapDays?.length ?? 0), 0)
    const failingDayCount = subItems.reduce((s, i) => s + (i.pointsCompleteness?.failingDayCount ?? 0), 0)
    const duplicateRows = subItems.reduce((s, i) => s + (i.duplicates?.duplicateRows ?? 0), 0)
    const outlierCandidates = subItems.reduce((s, i) => s + (i.outliers?.outlierCandidates ?? 0), 0)
    let failCount = 0
    let warnCount = 0
    for (const i of subItems) {
      for (const c of i.checks ?? []) {
        if (c.status === 'fail') failCount += 1
        else if (c.status === 'warn') warnCount += 1
      }
    }
    return {
      family: spec.family,
      label: spec.label,
      consumeNote: spec.consumeNote,
      hasData: cat?.hasData ?? false,
      datasetCount: cat?.datasetCount ?? 0,
      rowCount: cat?.rowCount ?? 0,
      latestDataTime: cat?.dataTime ?? null,
      qualityGenerated: subItems.length > 0,
      avgRatio: ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null,
      minRatio: minRatios.length ? Math.min(...minRatios) : null,
      gapDays,
      failingDayCount,
      duplicateRows,
      outlierCandidates,
      failCount,
      warnCount
    }
  })
})

const spotSummary = computed(() => {
  const list = spotFamilies.value
  return {
    connected: list.filter((f) => f.hasData).length,
    missing: list.filter((f) => !f.hasData).length,
    alerts: list.reduce((s, f) => s + f.failCount + f.warnCount, 0)
  }
})

// issue #455 质量下钻：卡片点击展开消费 quality-scan.mjs 已产的 failingDays/gapDays/
// duplicates/outlierFields，给出「哪几天缺点 / 哪些日期窗口缺口 / 重复占比 / 哪些值字段异常候选」
// + 完整率随时间 mini 趋势。计数之上的具体明细，真实反映不伪造绿灯。
const expandedFamily = ref<string | null>(null)
function toggleDrilldown(family: string) {
  expandedFamily.value = expandedFamily.value === family ? null : family
}

const drilldownByFamily = computed<Record<string, SpotDrilldown>>(() => {
  const spotFamilySet = new Set<string>(SPOT_QUALITY_FAMILIES.map((s) => s.family))
  const out: Record<string, SpotDrilldown> = {}
  for (const spec of SPOT_QUALITY_FAMILIES) {
    out[spec.family] = {
      hasTrend: false,
      failingDays: [],
      gapDays: [],
      checkedDays: 0,
      expectedPointsPerDay: null,
      duplicateSummary: { duplicateGroups: 0, duplicateRows: 0, sampledRows: 0, byDataset: [] },
      outlierFields: []
    }
  }
  for (const item of quality.value?.items ?? []) {
    if (!spotFamilySet.has(item.family)) continue
    const acc = out[item.family]
    if (!acc) continue
    acc.checkedDays += item.pointsCompleteness?.checkedDays ?? 0
    const expected = item.pointsCompleteness?.expectedPointsPerDay
    if (expected && !acc.expectedPointsPerDay) acc.expectedPointsPerDay = expected
    for (const fd of item.pointsCompleteness?.failingDays ?? []) {
      acc.failingDays.push({ ...fd, datasetKey: item.datasetKey })
    }
    for (const gd of item.coverage?.gapDays ?? []) {
      acc.gapDays.push({ date: gd, datasetKey: item.datasetKey })
    }
    const dup = item.duplicates
    if (dup) {
      acc.duplicateSummary.duplicateGroups += dup.duplicateGroups ?? 0
      acc.duplicateSummary.duplicateRows += dup.duplicateRows ?? 0
      acc.duplicateSummary.sampledRows += dup.sampledRows ?? 0
      if ((dup.duplicateRows ?? 0) > 0) {
        acc.duplicateSummary.byDataset.push({
          datasetKey: item.datasetKey,
          duplicateRows: dup.duplicateRows ?? 0,
          sampledRows: dup.sampledRows ?? 0
        })
      }
    }
    for (const f of item.outliers?.fields ?? []) {
      acc.outlierFields.push({
        field: f.field,
        outlierCandidates: f.outlierCandidates ?? 0,
        sampledValues: f.sampledValues ?? 0,
        datasetKey: item.datasetKey
      })
    }
  }
  for (const acc of Object.values(out)) {
    acc.failingDays.sort((a, b) => a.date.localeCompare(b.date))
    acc.gapDays.sort((a, b) => a.date.localeCompare(b.date))
    acc.hasTrend = acc.failingDays.length > 0
    if (acc.failingDays.length > 200) acc.failingDays = acc.failingDays.slice(0, 200)
    if (acc.gapDays.length > 200) acc.gapDays = acc.gapDays.slice(0, 200)
    if (acc.outlierFields.length > 100) acc.outlierFields = acc.outlierFields.slice(0, 100)
  }
  return out
})

// 完整率趋势 mini 图：仅画未达标日（quality-scan 只存 failingDays 前 50，不含达标日序列），
// 如实标注口径而非伪造完整序列。step 阶梯线呈现分时口径，0 基准线标达标 100%。
function buildTrendOption(family: string): Record<string, unknown> {
  const d = drilldownByFamily.value[family]
  if (!d || !d.hasTrend) return {}
  const data = d.failingDays.map((x) => ({
    value: Number((x.ratio * 100).toFixed(1)),
    actual: x.actual,
    expected: x.expected
  }))
  return {
    grid: { left: 44, right: 16, top: 24, bottom: 56 },
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ name?: string; data?: { value?: number; actual?: number; expected?: number } }>) => {
        const p = params?.[0]
        if (!p) return ''
        const v = p.data?.value ?? 0
        return `${p.name}<br/>完整率 ${v}%<br/>点数 ${p.data?.actual ?? 0}/${p.data?.expected ?? 0}`
      }
    },
    xAxis: { type: 'category', data: d.failingDays.map((x) => x.date), axisLabel: { rotate: 35, interval: 'auto' } },
    yAxis: { type: 'value', name: '完整率%', min: 0, max: 100 },
    series: [
      {
        name: '当日完整率',
        type: 'line',
        step: 'end',
        showSymbol: true,
        symbolSize: 6,
        data,
        itemStyle: { color: '#e6a23c' },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#67c23a' },
          data: [{ yAxis: 100, label: { formatter: '达标 100%', position: 'insideEndTop' } }]
        }
      }
    ]
  }
}

function failingDayRows(family: string): Array<Record<string, unknown>> {
  const d = drilldownByFamily.value[family]
  if (!d) return []
  return d.failingDays.map((x) => ({
    date: x.date,
    actual: x.actual,
    expected: x.expected,
    ratio: `${(x.ratio * 100).toFixed(1)}%`,
    datasetKey: x.datasetKey
  }))
}
function gapDayRows(family: string): Array<Record<string, unknown>> {
  const d = drilldownByFamily.value[family]
  if (!d) return []
  return d.gapDays.map((x) => ({ date: x.date, datasetKey: x.datasetKey }))
}
function outlierFieldRows(family: string): Array<Record<string, unknown>> {
  const d = drilldownByFamily.value[family]
  if (!d) return []
  return d.outlierFields.map((x) => ({
    field: x.field,
    outlierCandidates: x.outlierCandidates,
    sampledValues: x.sampledValues,
    ratio: x.sampledValues ? `${((x.outlierCandidates / x.sampledValues) * 100).toFixed(2)}%` : '—',
    datasetKey: x.datasetKey
  }))
}
function duplicatePct(family: string): string {
  const d = drilldownByFamily.value[family]
  if (!d || !d.duplicateSummary.sampledRows) return '—'
  return `${((d.duplicateSummary.duplicateRows / d.duplicateSummary.sampledRows) * 100).toFixed(2)}%`
}
function drillOf(family: string): SpotDrilldown {
  return (
    drilldownByFamily.value[family] ?? {
      hasTrend: false,
      failingDays: [],
      gapDays: [],
      checkedDays: 0,
      expectedPointsPerDay: null,
      duplicateSummary: { duplicateGroups: 0, duplicateRows: 0, sampledRows: 0, byDataset: [] },
      outlierFields: []
    }
  )
}

const qualityAlerts = computed<QualityAlert[]>(() => {
  const alerts: QualityAlert[] = []
  for (const item of quality.value?.items ?? []) {
    for (const check of item.checks ?? []) {
      if (check.status !== 'warn' && check.status !== 'fail') continue
      alerts.push({
        status: check.status,
        family: item.family,
        datasetKey: item.datasetKey,
        region: item.region,
        checkId: check.id,
        detail: check.detail ?? '',
        coverage: coverageText(item.coverage),
        pointsCompleteness: completenessText(item.pointsCompleteness),
        freshness: freshnessStatusOf(item.freshness)
      })
    }
  }
  return alerts.sort((left, right) => (left.status === right.status ? 0 : left.status === 'fail' ? -1 : 1))
})
const failAlerts = computed(() => qualityAlerts.value.filter((item) => item.status === 'fail'))
const warnAlerts = computed(() => qualityAlerts.value.filter((item) => item.status === 'warn'))

const backupManifestRows = computed<Array<Record<string, unknown>>>(() =>
  Object.entries(backup.value?.latest?.manifests ?? {}).map(([name, manifest]) => ({
    name,
    count: manifest.count ?? 0,
    totalSize: formatBytes(manifest.totalSize ?? 0)
  }))
)

// 切用户/切地区/重复刷新期间，旧 Promise 返回不得回写（否则治理目录/质量/备份跨用户地区串味，#1739）
let govGen = 0
async function loadAll() {
  const seq = ++govGen
  if (!canView.value) {
    catalog.value = null
    quality.value = null
    backup.value = null
    return
  }

  loading.value = true
  error.value = ''
  try {
    const [catalogRes, qualityRes, backupRes] = await Promise.all([
      apiGet<CatalogPayload>('/v1/governance/catalog'),
      apiGet<QualityPayload>('/v1/governance/quality'),
      apiGet<BackupPayload>('/v1/governance/backup')
    ])
    if (seq !== govGen) return // 期间切了用户/地区 → 丢弃旧结果
    catalog.value = catalogRes.data ?? null
    quality.value = qualityRes.data ?? null
    backup.value = backupRes.data ?? null
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function syncUser() {
  currentUser.value = getCurrentUser()
  void loadAll()
}

onMounted(() => {
  window.addEventListener('governance-user-changed', syncUser)
  void loadAll()
})
onUnmounted(() => window.removeEventListener('governance-user-changed', syncUser))
onRegionChange(loadAll)

function freshnessText(item: CatalogItem) {
  const value = freshnessOf(item.dataTime)
  const ageDays = ageDaysOf(item.dataTime)
  const suffix = ageDays === null ? '' : ` · ${ageDays}天`
  return `${freshnessLabel(value)}${suffix}`
}

function freshnessLabel(value: Freshness) {
  return ({
    fresh: '新鲜',
    aging: '老化',
    stale: '过期',
    unknown: '未知'
  } satisfies Record<Freshness, string>)[value]
}

function freshnessTagType(value: string) {
  if (value === 'fresh') return 'success'
  if (value === 'aging' || value === 'warn') return 'warning'
  if (value === 'stale' || value === 'fail') return 'danger'
  return 'info'
}

function coverageText(coverage?: QualityItem['coverage']) {
  if (!coverage) return '—'
  const range = [coverage.minDate, coverage.maxDate].filter(Boolean).join(' ~ ') || '—'
  const gaps = Array.isArray(coverage.gapDays) ? coverage.gapDays.length : 0
  return `${range} · ${coverage.days ?? 0}天 · 缺口${gaps}天`
}

function completenessText(value?: QualityCompleteness) {
  if (!value) return '—'
  const ratio = typeof value.avgRatio === 'number' ? value.avgRatio : null
  if (ratio === null || Number.isNaN(ratio)) return '—'
  return `${(ratio * 100).toFixed(1)}%`
}
function freshnessStatusOf(value?: QualityFreshness): string {
  return value?.status ?? 'unknown'
}
function ratioPct(r: number | null) {
  if (r === null || typeof r !== 'number' || Number.isNaN(r)) return '—'
  return `${(r * 100).toFixed(1)}%`
}
function formatNumber(n: number) {
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('zh-CN')
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('zh-CN', { hour12: false })
}

function browserLink(alert: QualityAlert) {
  return {
    path: '/yygl/data-browser',
    query: { family: alert.family, match: alert.datasetKey }
  }
}
</script>

<template>
  <div class="governance-page">
    <header class="governance-page__head">
      <div>
        <h2>数据治理控制台</h2>
        <div class="governance-page__meta">
          <DataBasisBadge basis="captured" prefix="治理口径" />
          <span>不写生产（只读）</span>
        </div>
      </div>
      <el-button size="small" :loading="loading" @click="loadAll">刷新</el-button>
    </header>

    <RegionDataBanner />

    <DataState
      v-if="!canView"
      :empty="true"
      empty-text="当前角色无权访问数据治理控制台"
    />
    <DataState
      v-else
      :loading="loading"
      :error="error"
      :empty="false"
      loading-text="加载数据治理状态"
    >
      <div class="metric-grid">
        <div class="metric-cell">
          <span>数据族</span>
          <strong>{{ catalog?.stats.families ?? 0 }} / {{ catalog?.registeredFamilyCount ?? 0 }}</strong>
        </div>
        <div class="metric-cell">
          <span>数据集</span>
          <strong>{{ catalog?.stats.datasets ?? 0 }}</strong>
        </div>
        <div class="metric-cell">
          <span>质量告警</span>
          <strong>{{ qualityAlerts.length }}</strong>
        </div>
        <div class="metric-cell">
          <span>最新备份</span>
          <strong>{{ backup?.latest?.name ?? '—' }}</strong>
        </div>
      </div>

      <el-tabs v-model="activeTab" class="governance-tabs">
        <el-tab-pane label="资产目录" name="catalog">
          <DataState
            :empty="!catalogRows.length"
            :empty-text="catalog?.message || '当前地区暂无数据资产目录'"
          >
            <DynamicTable
              :rows="catalogRows"
              :labels="{
                family: '数据族',
                familyLabel: '名称',
                region: '地区',
                datasetKey: '数据集',
                kind: '类型',
                rowCount: '行数',
                byteSize: '体量',
                freshness: '新鲜度',
                dataTime: '数据时间',
                sourceType: '来源',
                owner: '归属',
                registered: '注册'
              }"
              export-name="governance-catalog"
            />
          </DataState>
        </el-tab-pane>

        <el-tab-pane label="质量告警" name="quality">
          <DataState
            :empty="quality?.empty || !qualityAlerts.length"
            :empty-text="quality?.message || '暂无 fail/warn 质量告警'"
          >
            <div class="quality-grid">
              <section class="quality-section">
                <h3>Fail</h3>
                <div v-if="!failAlerts.length" class="muted">暂无 fail</div>
                <article v-for="alert in failAlerts" :key="`${alert.family}-${alert.datasetKey}-${alert.checkId}`" class="alert-row fail">
                  <div class="alert-row__title">
                    <el-tag size="small" type="danger">fail</el-tag>
                    <strong>{{ alert.family }} / {{ alert.datasetKey }}</strong>
                  </div>
                  <p>{{ alert.detail || alert.checkId }}</p>
                  <div class="alert-row__meta">
                    <span>{{ alert.coverage }}</span>
                    <span>完整度 {{ alert.pointsCompleteness }}</span>
                    <el-tag size="small" :type="freshnessTagType(alert.freshness)">{{ alert.freshness }}</el-tag>
                    <router-link :to="browserLink(alert)">数据浏览器</router-link>
                  </div>
                </article>
              </section>

              <section class="quality-section">
                <h3>Warn</h3>
                <div v-if="!warnAlerts.length" class="muted">暂无 warn</div>
                <article v-for="alert in warnAlerts" :key="`${alert.family}-${alert.datasetKey}-${alert.checkId}`" class="alert-row warn">
                  <div class="alert-row__title">
                    <el-tag size="small" type="warning">warn</el-tag>
                    <strong>{{ alert.family }} / {{ alert.datasetKey }}</strong>
                  </div>
                  <p>{{ alert.detail || alert.checkId }}</p>
                  <div class="alert-row__meta">
                    <span>{{ alert.coverage }}</span>
                    <span>完整度 {{ alert.pointsCompleteness }}</span>
                    <el-tag size="small" :type="freshnessTagType(alert.freshness)">{{ alert.freshness }}</el-tag>
                    <router-link :to="browserLink(alert)">数据浏览器</router-link>
                  </div>
                </article>
              </section>
            </div>
          </DataState>
        </el-tab-pane>

        <el-tab-pane label="现货数据质量" name="spot-quality">
          <div class="spot-head">
            <DataBasisBadge basis="captured" prefix="现货质量口径" />
            <div class="spot-summary">
              <span>已接入 <strong>{{ spotSummary.connected }}</strong> / {{ SPOT_QUALITY_FAMILIES.length }}</span>
              <span>未接入 <strong>{{ spotSummary.missing }}</strong></span>
              <span>告警 <strong :class="{ 'spot-fail-text': spotSummary.alerts > 0 }">{{ spotSummary.alerts }}</strong></span>
              <span v-if="quality && !quality.empty" class="muted">报告时间 {{ formatDateTime(quality?.generatedAt) }}</span>
              <span v-else class="muted">质量报告未生成 · 运行 <code>npm run data:quality</code></span>
            </div>
          </div>
          <div class="spot-grid">
            <article v-for="fam in spotFamilies" :key="fam.family" class="spot-card">
              <header class="spot-card__head">
                <div class="spot-card__title">
                  <strong>{{ fam.label }}</strong>
                  <code class="muted">{{ fam.family }}</code>
                </div>
                <el-tag size="small" :type="fam.hasData ? (fam.failCount > 0 ? 'danger' : fam.warnCount > 0 ? 'warning' : 'success') : 'info'">
                  {{ fam.hasData ? '已接入' : '未接入' }}
                </el-tag>
              </header>
              <template v-if="fam.hasData">
                <ul class="spot-metrics">
                  <li><span>数据集</span><b>{{ fam.datasetCount }}</b></li>
                  <li><span>行数</span><b>{{ formatNumber(fam.rowCount) }}</b></li>
                  <li><span>最新时间</span><b>{{ formatDateTime(fam.latestDataTime) }}</b></li>
                  <li>
                    <span>完整率</span>
                    <b>{{ fam.qualityGenerated ? ratioPct(fam.avgRatio) : '—' }}</b>
                    <small v-if="fam.qualityGenerated" class="muted">最低 {{ ratioPct(fam.minRatio) }}</small>
                  </li>
                  <li><span>缺失天数</span><b :class="{ 'spot-warn-text': fam.gapDays > 0 }">{{ fam.gapDays }}</b></li>
                  <li><span>缺点天数</span><b :class="{ 'spot-warn-text': fam.failingDayCount > 0 }">{{ fam.failingDayCount }}</b></li>
                  <li><span>重复行</span><b :class="{ 'spot-warn-text': fam.duplicateRows > 0 }">{{ fam.duplicateRows }}</b></li>
                  <li><span>异常候选</span><b :class="{ 'spot-warn-text': fam.outlierCandidates > 0 }">{{ fam.outlierCandidates }}</b></li>
                  <li class="spot-metrics__full">
                    <span>质量告警</span>
                    <b :class="{ 'spot-fail-text': fam.failCount > 0, 'spot-warn-text': fam.failCount === 0 && fam.warnCount > 0 }">
                      fail {{ fam.failCount }} / warn {{ fam.warnCount }}
                    </b>
                  </li>
                </ul>
                <p v-if="!fam.qualityGenerated" class="spot-empty">已接入但质量报告未覆盖（运行 <code>npm run data:quality -- --region yunnan</code> 生成）。</p>
                <div v-else class="spot-drilldown">
                  <button type="button" class="spot-drilldown__btn" @click="toggleDrilldown(fam.family)">
                    {{ expandedFamily === fam.family ? '收起下钻明细' : '展开下钻（缺点日 / 缺口 / 重复 / 异常候选 + 完整率趋势）' }}
                  </button>
                  <div v-if="expandedFamily === fam.family" class="spot-drilldown__body">
                    <section class="drill-section">
                      <h4>完整率趋势<small>仅未达标日（quality-scan 存前 50 条），如实呈现不伪造完整序列</small></h4>
                      <ChartCard
                        v-if="drillOf(fam.family).hasTrend"
                        :build-option="() => buildTrendOption(fam.family)"
                        :png-export="true"
                        :png-name="`spot-quality-${fam.family}-completeness-trend`"
                        height="220"
                      />
                      <p v-else class="muted drill-empty">
                        {{ drillOf(fam.family).checkedDays ? `已检查 ${drillOf(fam.family).checkedDays} 天，全部达标（无未达标日）。` : '暂无每日完整率明细（运行 npm run data:quality -- --region yunnan 生成）。' }}
                      </p>
                    </section>
                    <section class="drill-section">
                      <h4>缺点日明细 <small>{{ drillOf(fam.family).failingDays.length }} 条</small></h4>
                      <DynamicTable
                        v-if="drillOf(fam.family).failingDays.length"
                        :rows="failingDayRows(fam.family)"
                        :labels="{ date: '日期', actual: '实际点数', expected: '期望点数', ratio: '完整率', datasetKey: '数据集' }"
                        :export-name="`spot-quality-${fam.family}-failing-days`"
                      />
                      <p v-else class="muted drill-empty">无缺点日（每日点数均达期望）。</p>
                    </section>
                    <section class="drill-section">
                      <h4>日期窗口缺口 <small>{{ drillOf(fam.family).gapDays.length }} 天</small></h4>
                      <DynamicTable
                        v-if="drillOf(fam.family).gapDays.length"
                        :rows="gapDayRows(fam.family)"
                        :labels="{ date: '缺失日期', datasetKey: '数据集' }"
                        :export-name="`spot-quality-${fam.family}-gap-days`"
                      />
                      <p v-else class="muted drill-empty">日期窗口连续，无缺口。</p>
                    </section>
                    <section class="drill-section">
                      <h4>重复行摘要 <small>{{ drillOf(fam.family).duplicateSummary.duplicateRows }} 行</small></h4>
                      <p class="muted drill-empty">
                        检出 {{ drillOf(fam.family).duplicateSummary.duplicateGroups }} 组 / {{ drillOf(fam.family).duplicateSummary.duplicateRows }} 行完全重复，占采样 {{ drillOf(fam.family).duplicateSummary.sampledRows }} 行的 {{ duplicatePct(fam.family) }}。报告仅存统计（具体重复行样本请用数据浏览器按 family 查看原始采集）。
                      </p>
                    </section>
                    <section class="drill-section">
                      <h4>异常候选值 <small>{{ drillOf(fam.family).outlierFields.length }} 字段</small></h4>
                      <DynamicTable
                        v-if="drillOf(fam.family).outlierFields.length"
                        :rows="outlierFieldRows(fam.family)"
                        :labels="{ field: '字段', outlierCandidates: '异常候选', sampledValues: '采样值', ratio: '占比', datasetKey: '数据集' }"
                        :export-name="`spot-quality-${fam.family}-outliers`"
                      />
                      <p v-else class="muted drill-empty">无异常候选字段统计（IQR pass 不阻断，仅统计）。</p>
                    </section>
                  </div>
                </div>
              </template>
              <p v-else class="spot-empty">未接入：当前地区 capture.sqlite 无该族数据 —— 如实标注，不伪造绿灯。</p>
              <footer class="spot-consume muted">消费入口：{{ fam.consumeNote }}</footer>
            </article>
          </div>
        </el-tab-pane>

        <el-tab-pane label="备份状态" name="backup">
          <DataState
            :empty="!backup?.available"
            :empty-text="backup?.message || '尚无备份记录'"
          >
            <div class="backup-layout">
              <el-descriptions :column="2" border size="small">
                <el-descriptions-item label="备份名">{{ backup?.latest?.name }}</el-descriptions-item>
                <el-descriptions-item label="创建时间">{{ formatDateTime(backup?.latest?.createdAt) }}</el-descriptions-item>
                <el-descriptions-item label="SQLite 文件数">{{ backup?.latest?.sqliteCount }}</el-descriptions-item>
                <el-descriptions-item label="大文件归档">{{ backup?.latest?.full ? '已归档' : '仅清单' }}</el-descriptions-item>
                <el-descriptions-item label="Manifest 时间">{{ formatDateTime(backup?.latest?.manifestMtime) }}</el-descriptions-item>
                <el-descriptions-item label="备份目录">{{ backup?.backupRoot }}</el-descriptions-item>
              </el-descriptions>
              <DynamicTable
                :rows="backupManifestRows"
                :labels="{ name: '清单', count: '文件数', totalSize: '总体量' }"
                export-name="governance-backup"
              />
            </div>
          </DataState>
        </el-tab-pane>

        <el-tab-pane label="场站主数据" name="station-master">
          <DataState
            :empty="!stationRows.length"
            empty-text="场站主数据尚未注册或当前地区无数据"
          >
            <DynamicTable
              :rows="stationRows"
              :labels="{
                family: '数据族',
                familyLabel: '名称',
                region: '地区',
                datasetKey: '数据集',
                kind: '类型',
                rowCount: '行数',
                byteSize: '体量',
                freshness: '新鲜度',
                dataTime: '数据时间',
                sourceType: '来源',
                registered: '注册'
              }"
              export-name="yn-dim-master-data"
            />
          </DataState>
        </el-tab-pane>
      </el-tabs>
    </DataState>
  </div>
</template>

<style scoped>
.governance-page {
  padding: 16px 20px;
}

.governance-page__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.governance-page__head h2 {
  margin: 0 0 6px;
}

.governance-page__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 12px 0 16px;
}

.metric-cell {
  min-height: 70px;
  padding: 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
}

.metric-cell span {
  display: block;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.metric-cell strong {
  display: block;
  margin-top: 6px;
  font-size: 20px;
  font-weight: 650;
}

.governance-tabs {
  margin-top: 4px;
}

.quality-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.quality-section {
  min-width: 0;
}

.quality-section h3 {
  margin: 0 0 10px;
  font-size: 14px;
}

.alert-row {
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-light);
  border-left-width: 3px;
  border-radius: 8px;
  margin-bottom: 10px;
  background: var(--el-fill-color-blank);
}

.alert-row.fail {
  border-left-color: var(--el-color-danger);
}

.alert-row.warn {
  border-left-color: var(--el-color-warning);
}

.alert-row__title,
.alert-row__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.alert-row p {
  margin: 8px 0;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.alert-row__meta,
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.backup-layout {
  display: grid;
  gap: 14px;
}

/* 现货数据质量 tab */
.spot-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-bottom: 14px;
}
.spot-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  font-size: 13px;
}
.spot-summary strong {
  font-size: 15px;
  margin-left: 4px;
}
.spot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
}
.spot-card {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 12px 14px;
  background: var(--el-fill-color-blank);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.spot-card__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.spot-card__title strong {
  display: block;
  font-size: 14px;
}
.spot-card__title code {
  font-size: 11px;
}
.spot-metrics {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px 14px;
  font-size: 12px;
}
.spot-metrics li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.spot-metrics__full {
  grid-column: 1 / -1;
}
.spot-metrics li span {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
.spot-metrics li b {
  font-weight: 650;
  font-size: 13px;
  word-break: break-all;
}
.spot-metrics small {
  font-size: 10px;
}
.spot-warn-text {
  color: var(--el-color-warning);
}
.spot-fail-text {
  color: var(--el-color-danger);
}
.spot-empty {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-style: italic;
}
.spot-consume {
  margin: 0;
  padding-top: 8px;
  border-top: 1px dashed var(--el-border-color-lighter);
  font-size: 11px;
}

/* issue #455 质量下钻展开区 */
.spot-drilldown {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.spot-drilldown__btn {
  align-self: flex-start;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.spot-drilldown__btn:hover {
  background: var(--el-color-primary-light-8);
}
.spot-drilldown__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 10px;
  border-top: 1px dashed var(--el-border-color-lighter);
}
.drill-section {
  min-width: 0;
}
.drill-section h4 {
  margin: 0 0 8px;
  font-size: 13px;
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}
.drill-section h4 small {
  font-weight: normal;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
.drill-empty {
  margin: 0;
  font-size: 12px;
  font-style: italic;
}

@media (max-width: 900px) {
  .metric-grid,
  .quality-grid {
    grid-template-columns: 1fr;
  }

  .governance-page__head {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
