<script setup lang="ts">
// 数据运维总览（/data-ops/console 首个 tab）：把「数据链路现在什么状态、下一步该动哪一步」
// 摊在一屏——四指标卡 + 待处理（按数据集合并）+ 链路四段 + 补数/批次两栏（dljy#3415 改版）。
//
// 取数全走既有只读接口（治理 catalog/quality/backup + 上传批次台账），三路各自独立
// （allSettled）：某一路失败只把那一路标成「取数失败」，不整页空白；无数据如实显示空态，
// 不用占位数字充数（诚实红线）。本面板只读，不写任何生产数据。
import { computed, onMounted, ref } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import { apiGet } from '@/services/api'
import { fetchUploadBatches, type UploadBatchRow } from '@/services/data/uploadClient'
import { ageDaysOf, freshnessOf, type Freshness, type FreshnessCadence } from '@/services/data/freshness'
import { onRegionChange } from '@/composables/useRegionReload'
import DataBasisBadge from '@/components/DataBasisBadge.vue'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import InfoPop from './InfoPop.vue'
import { isEntryHidden, isTabHidden, type MigratedEntryId } from '@/features/platformAdminMigration/registry'

// 切 tab 用：总览的每个行动按钮都指向工作台内某一页，由宿主页切换 tab（不新开路由）。
const emit = defineEmits<{ navigate: [tab: string] }>()

// —— 接口信封（只声明本面板消费的字段，与 DataGovernanceView 同源口径）——
type CatalogItem = {
  family: string
  familyLabel: string
  region: string
  datasetKey: string
  rowCount: number
  sourceType: string
  capturedAt: string | null
  dataTime: string | null
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
    bySource: Array<{ source_type: string; n: number }>
  }
  registeredFamilyCount: number
  items: CatalogItem[]
}

type QualityStatus = 'pass' | 'warn' | 'fail'
type QualityStream = {
  stream: string
  kind: 'family' | 'upload-contract'
  region: string
  cadence: string
  status: QualityStatus
  ageHours: number | null
  lastAt: string | null
  detail: string
}
type QualityPayload = {
  generatedAt: string | null
  summary: { pass: number; warn: number; fail: number }
  items: Array<{
    family: string
    datasetKey: string
    region: string
    freshness?: { status?: QualityStatus; cadence?: string | null; ageHours?: number | null; capturedAt?: string | null; detail?: string }
    checks?: Array<{ id: string; status: QualityStatus; detail?: string }>
  }>
  // 可缺省：#3414 之前质量接口漏带本字段。缺字段 ≠ 0 条流，按「未提供」如实显示，绝不当成正常。
  streams?: QualityStream[]
  empty: boolean
  message: string
}

type BackupSnapshot = { name: string; createdAt: string | null; full: boolean; sqliteCount: number }
type BackupPayload = {
  generatedAt: string
  available: boolean
  message: string
  latest: BackupSnapshot | null
  history: BackupSnapshot[]
}

const loading = ref(false)
const catalog = ref<CatalogPayload | null>(null)
const quality = ref<QualityPayload | null>(null)
const backup = ref<BackupPayload | null>(null)
const batches = ref<UploadBatchRow[] | null>(null)
// 分路错误：哪一路挂了只影响哪一块的呈现，其余照常出数。
const errors = ref<Record<'catalog' | 'quality' | 'backup' | 'batches', string>>({
  catalog: '',
  quality: '',
  backup: '',
  batches: ''
})

// 切地区/连点刷新期间旧 Promise 返回不得回写（跨地区串味，同 #1739 口径）。
let gen = 0
async function loadAll() {
  const seq = ++gen
  loading.value = true
  const [catalogRes, qualityRes, backupRes, batchRes] = await Promise.allSettled([
    apiGet<CatalogPayload>('/v1/governance/catalog'),
    apiGet<QualityPayload>('/v1/governance/quality'),
    apiGet<BackupPayload>('/v1/governance/backup'),
    fetchUploadBatches()
  ])
  if (seq !== gen) return
  catalog.value = catalogRes.status === 'fulfilled' ? (catalogRes.value.data ?? null) : null
  quality.value = qualityRes.status === 'fulfilled' ? (qualityRes.value.data ?? null) : null
  backup.value = backupRes.status === 'fulfilled' ? (backupRes.value.data ?? null) : null
  batches.value = batchRes.status === 'fulfilled' ? batchRes.value : null
  errors.value = {
    catalog: reasonText(catalogRes),
    quality: reasonText(qualityRes),
    backup: reasonText(backupRes),
    batches: reasonText(batchRes)
  }
  loading.value = false
}

function reasonText(result: PromiseSettledResult<unknown>) {
  if (result.status === 'fulfilled') return ''
  const err = result.reason
  return err instanceof Error ? err.message : String(err)
}

onMounted(loadAll)
onRegionChange(loadAll)

// —— 指标卡 ——
// 数据流信息可判：质量报告已生成且接口带了 streams 字段。两者缺一都只能说「不知道」。
const streamsKnown = computed(() => Boolean(quality.value && !quality.value.empty && Array.isArray(quality.value.streams)))
const streamsUnknownText = computed(() =>
  quality.value?.empty ? (quality.value.message || '质量报告未生成') : '接口未提供数据流信息'
)
const streams = computed(() => (streamsKnown.value ? quality.value!.streams! : []))
const brokenStreams = computed(() => streams.value.filter((s) => s.status === 'fail'))
const warnStreams = computed(() => streams.value.filter((s) => s.status === 'warn'))

const metrics = computed(() => [
  {
    key: 'catalog',
    label: '已入库数据族',
    value: catalog.value ? String(catalog.value.stats.families) : '—',
    unit: catalog.value ? `/ ${catalog.value.registeredFamilyCount} 注册` : '',
    note: catalog.value
      ? `${catalog.value.stats.datasets} 个数据集 · ${formatNumber(catalog.value.stats.rows)} 行`
      : errors.value.catalog || '取数中',
    tone: catalog.value ? 'blue' : ''
  },
  {
    key: 'quality',
    label: '质量检查',
    value: qualityReady.value ? String(quality.value!.summary.pass) : '—',
    unit: qualityReady.value ? `/ ${qualityTotal.value} 通过` : '',
    note: qualityReady.value
      ? `告警 ${quality.value!.summary.warn} · 不合格 ${quality.value!.summary.fail}`
      : quality.value?.empty ? (quality.value.message || '质量报告未生成') : errors.value.quality || '取数中',
    tone: !qualityReady.value ? '' : quality.value!.summary.fail ? 'orange' : 'green'
  },
  {
    key: 'streams',
    label: '数据流断流',
    value: streamsKnown.value ? String(brokenStreams.value.length) : '—',
    unit: streamsKnown.value ? `/ ${streams.value.length} 条流` : '',
    note: !quality.value
      ? errors.value.quality || '取数中'
      : !streamsKnown.value
        ? streamsUnknownText.value
        : brokenStreams.value.length
          ? '按声明节奏已停更，需补采'
          : `节奏正常${warnStreams.value.length ? ` · ${warnStreams.value.length} 条接近阈值` : ''}`,
    tone: !streamsKnown.value ? '' : brokenStreams.value.length ? 'orange' : 'green'
  },
  {
    key: 'backup',
    label: '最近备份',
    value: backup.value?.latest ? formatDate(backup.value.latest.createdAt) : '—',
    unit: backup.value?.latest ? (backup.value.latest.full ? '全量' : '增量') : '',
    note: backup.value
      ? (backup.value.latest
          ? `${backup.value.latest.sqliteCount} 个库 · 历史 ${backup.value.history.length} 份`
          : backup.value.message || '尚无备份记录')
      : errors.value.backup || '取数中',
    tone: backup.value?.latest ? 'green' : ''
  }
])

// 报告缺失时后端回 empty=true + 全 0 计数：那不是「0 项不合格」，是「没体检过」。
const qualityReady = computed(() => Boolean(quality.value && !quality.value.empty))

const qualityTotal = computed(() => {
  const s = quality.value?.summary
  return s ? s.pass + s.warn + s.fail : 0
})

// —— 数据链路四段：每段状态取自真实数字，行动直达工作台内对应页 ——
type Stage = {
  key: string
  step: string
  title: string
  desc: string
  status: string
  statusTone: 'ok' | 'warn' | 'idle'
  actions: StageAction[]
}
// migratedEntry：站外跳转（to）指向的入口若已迁至平台后台，登记入口 id 以便隐藏。
type StageAction = { label: string; tab?: string; to?: string; migratedEntry?: MigratedEntryId }

// 已迁至平台后台的面板 / 入口（ChenShi-Tech/dljy#3464，内部版）不再给行动按钮——工作台里已没有
// 那个面板，点了只会无声落回总览；客户交付版登记表恒答未迁移，按钮照旧。
function isActionVisible(action: StageAction): boolean {
  if (action.tab && isTabHidden('data-ops', action.tab)) return false
  return !(action.migratedEntry && isEntryHidden(action.migratedEntry))
}
function withVisibleActions(list: Stage[]): Stage[] {
  return list.map((stage) => ({ ...stage, actions: stage.actions.filter(isActionVisible) }))
}

const sourceKinds = computed(() => catalog.value?.stats.bySource ?? [])

// 来源类型内部代码 → 业务名（未登记的原样显示，不猜）。
const SOURCE_LABELS: Record<string, string> = {
  CAPTURE: '采集', IMPORT: '导入', DB: '数据库', SEED: '种子数据', MOCK: '模拟', MIXED: '混合'
}
const sourceLabel = (code: string) => SOURCE_LABELS[code] ?? code
const committedBatches = computed(() => (batches.value ?? []).filter((b) => b.status === 'COMMITTED'))

const stages = computed<Stage[]>(() => withVisibleActions([
  {
    key: 'access',
    step: '①',
    title: '接入',
    desc: '数据源凭据、连通测试与采集通道；先把数据能进来这件事办妥。',
    status: sourceKinds.value.length
      ? `${sourceKinds.value.length} 类来源在库：${sourceKinds.value.map((s) => `${sourceLabel(s.source_type)} ${s.n} 个数据集`).join(' · ')}`
      : errors.value.catalog
        ? '来源分布取数失败'
        : '尚无来源记录',
    statusTone: sourceKinds.value.length ? 'ok' : 'idle',
    actions: [
      { label: '数据源接入', tab: 'data-source' },
      { label: '接入向导', tab: 'onboarding' }
    ]
  },
  {
    key: 'intake',
    step: '②',
    title: '入库',
    desc: 'Excel 五步流批量上传、台账手录，落库前预检、误传按批次可撤销。',
    status: batches.value
      ? batches.value.length
        ? `近期批次 ${batches.value.length} 笔 · 已落库 ${committedBatches.value.length} 笔 · 最近 ${formatDateTime(batches.value[0]?.created_at)}`
        : '尚无上传批次'
      : errors.value.batches || '批次台账取数中',
    statusTone: committedBatches.value.length ? 'ok' : 'idle',
    actions: [
      { label: '上传中心', tab: 'upload' },
      { label: '导入融合台', tab: 'import-hub' }
    ]
  },
  {
    key: 'ingest',
    step: '③',
    title: '摄取',
    desc: '手动触发 ETL 补拉与厂侧 API 拉取；定时自动摄取在 AI 工作室排程。',
    status: !quality.value
      ? errors.value.quality || '数据流状态取数中'
      : !streamsKnown.value
        ? `数据流状态未知：${streamsUnknownText.value}`
        : brokenStreams.value.length
          ? `${brokenStreams.value.length} 条流停更，建议先补这几条：${brokenStreams.value.slice(0, 2).map((s) => s.stream).join('、')}`
          : '各流按节奏在更新',
    statusTone: !streamsKnown.value ? 'idle' : brokenStreams.value.length ? 'warn' : 'ok',
    actions: [
      { label: '摄取管理', tab: 'ingest' },
      { label: '定时任务', to: '/system/ai-studio?tab=schedules', migratedEntry: 'ai-schedules' }
    ]
  },
  {
    key: 'govern',
    step: '④',
    title: '治理与回放',
    desc: '目录、质量、备份三面只读体检；核对具体数值去通用数据浏览器逐行回放。',
    status: qualityReady.value
      ? `质量 通过 ${quality.value!.summary.pass} / 告警 ${quality.value!.summary.warn} / 不合格 ${quality.value!.summary.fail}`
      : quality.value?.empty ? (quality.value.message || '质量报告未生成') : errors.value.quality || '质量摘要取数中',
    statusTone: !qualityReady.value ? 'idle' : quality.value!.summary.fail ? 'warn' : 'ok',
    actions: [
      { label: '治理控制台', tab: 'governance' },
      { label: '数据浏览器', to: '/yygl/data-browser' }
    ]
  }
]))

// —— 待处理：同一数据集的不合格/告警检查合并成一行，再补数据流行 ——
// 族流只在同族已有数据集行时才去重：两者是独立结果、不保证一一对应，没被覆盖的族级断流必须单列，
// 否则会从待处理和总数里消失（codex R1）。上传契约流不对应任何数据集，一律单列。
// 检查代码 → 中文问题名（未登记的原样显示）。具体数字在「说明」列，来自巡检报告原文。
const CHECK_LABELS: Record<string, string> = {
  freshness: '更新不及时',
  'date-coverage': '日期缺口',
  'min-rows-per-day': '单日行数不足',
  'points-completeness': '点数不全',
  'suspicious-zero-run': '疑似连续零值',
  'value-outliers': '异常值',
  'duplicate-rows': '重复行',
  'rows-present': '无数据'
}
const checkLabel = (id: string) => CHECK_LABELS[id] ?? (id.startsWith('pair:') ? '同日配对不一致' : id)

type AlertRow = {
  key: string
  // 数据集行所属的族，用于判断族流是否已被覆盖
  family?: string
  label: string
  sub: string
  problems: string[]
  status: QualityStatus
  ageHours: number | null
  lastAt: string | null
  detail: string
  link: { label: string; tab?: string; to?: RouteLocationRaw }
}

// family → 中文名（取自目录；质量报告只有 family 代码）。
const familyLabels = computed(() => {
  const map = new Map<string, string>()
  for (const item of catalog.value?.items ?? []) if (item.familyLabel) map.set(item.family, item.familyLabel)
  return map
})

const allAlertRows = computed<AlertRow[]>(() => {
  const rows: AlertRow[] = []
  for (const item of quality.value?.items ?? []) {
    const bad = (item.checks ?? []).filter((c) => c.status !== 'pass')
    if (!bad.length) continue
    rows.push({
      key: `${item.family}/${item.datasetKey}`,
      family: item.family,
      label: familyLabels.value.get(item.family) ?? item.family,
      sub: item.datasetKey,
      problems: [...new Set(bad.map((c) => checkLabel(c.id)))],
      status: bad.some((c) => c.status === 'fail') ? 'fail' : 'warn',
      ageHours: item.freshness?.ageHours ?? null,
      lastAt: item.freshness?.capturedAt ?? null,
      detail: bad.map((c) => c.detail).filter(Boolean).join('；') || '—',
      link: { label: '查看', to: { path: '/yygl/data-browser', query: { family: item.family, match: item.datasetKey } } }
    })
  }
  const coveredFamilies = new Set(rows.map((r) => r.family))
  for (const s of streams.value) {
    if (s.status === 'pass') continue
    const isContract = s.kind === 'upload-contract'
    if (!isContract && coveredFamilies.has(s.stream)) continue
    rows.push({
      key: `stream:${s.stream}`,
      label: isContract ? s.stream : familyLabels.value.get(s.stream) ?? s.stream,
      sub: isContract ? '上传契约' : '数据族',
      problems: ['更新不及时'],
      status: s.status,
      ageHours: s.ageHours,
      lastAt: s.lastAt,
      detail: s.detail || '—',
      link: isContract
        ? { label: '去上传', tab: 'upload' }
        : { label: '查看', to: { path: '/yygl/data-browser', query: { family: s.stream } } }
    })
  }
  // 不合格在前，同档滞后久的在前：先看必须动手、拖得最久的。
  return rows.sort((a, b) => Number(b.status === 'fail') - Number(a.status === 'fail') || (b.ageHours ?? -1) - (a.ageHours ?? -1))
})
const ALERT_LIMIT = 12
const alertRows = computed(() => allAlertRows.value.slice(0, ALERT_LIMIT))

// —— 最近上传批次台账 ——
const recentBatches = computed(() => (batches.value ?? []).slice(0, 8))

// —— 最该补数的数据族：按族汇总（族内最新数据时间），按各族节律判新鲜度 ——
// 按数据集排会让按天分片的族（每天一个数据集）占满整张表，看不出到底哪些族断了。
type StaleFamily = {
  family: string
  familyLabel: string
  datasets: number
  rows: number
  latest: string | null
  cadence: FreshnessCadence
  // 质量报告里没有该族的节律声明时按日更估算，页面要标明是估算
  cadenceDeclared: boolean
  freshness: Freshness
  freshnessText: string
}

const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: '新鲜',
  aging: '老化',
  stale: '过期',
  unknown: '未知'
}

// family → 节律：取质量报告里该族任一数据集声明的 cadence；报告没有时按日更。
const familyCadence = computed(() => {
  const map = new Map<string, FreshnessCadence>()
  for (const item of quality.value?.items ?? []) {
    const c = item.freshness?.cadence
    if (!map.has(item.family) && (c === 'daily' || c === 'monthly' || c === 'manual')) map.set(item.family, c)
  }
  return map
})

const staleFamilies = computed<StaleFamily[]>(() => {
  const byFamily = new Map<string, StaleFamily>()
  for (const item of catalog.value?.items ?? []) {
    const cur = byFamily.get(item.family) ?? {
      family: item.family,
      familyLabel: item.familyLabel || item.family,
      datasets: 0,
      rows: 0,
      latest: null,
      cadence: familyCadence.value.get(item.family) ?? 'daily',
      cadenceDeclared: familyCadence.value.has(item.family),
      freshness: 'unknown',
      freshnessText: ''
    }
    cur.datasets += 1
    cur.rows += item.rowCount ?? 0
    if (item.dataTime && (!cur.latest || item.dataTime > cur.latest)) cur.latest = item.dataTime
    byFamily.set(item.family, cur)
  }
  // 未知时间排最前（未知比过期更需要确认），其余按最新数据时间从旧到新。
  return [...byFamily.values()]
    .sort((a, b) => (a.latest ? new Date(a.latest).getTime() : -Infinity) - (b.latest ? new Date(b.latest).getTime() : -Infinity))
    .slice(0, 10)
    .map((row) => {
      const freshness = freshnessOf(row.latest, { cadence: row.cadence })
      const age = ageDaysOf(row.latest)
      return { ...row, freshness, freshnessText: `${FRESHNESS_LABEL[freshness]}${age === null ? '' : ` · ${age}天`}` }
    })
})

const CADENCE_LABEL: Record<FreshnessCadence, string> = { daily: '日更', monthly: '月更', manual: '手录' }
const cadenceLabel = (row: StaleFamily) => (row.cadenceDeclared ? CADENCE_LABEL[row.cadence] : '未声明节律·按日更估')

function formatAge(hours: number | null) {
  if (hours === null || hours === undefined) return '—'
  return hours >= 48 ? `${Math.round(hours / 24)} 天` : `${Math.round(hours)} 小时`
}

function tagType(status: string) {
  if (status === 'fresh' || status === 'pass' || status === 'COMMITTED') return 'success'
  if (status === 'aging' || status === 'warn') return 'warning'
  if (status === 'stale' || status === 'fail' || status === 'REVERTED') return 'danger'
  return 'info'
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toLocaleString('zh-CN')
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('zh-CN', { hour12: false })
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('zh-CN')
}

function go(action: { tab?: string; to?: string }) {
  if (action.tab) emit('navigate', action.tab)
}
</script>

<template>
  <div class="page-stack ops-overview">
    <RegionDataBanner />

    <section class="overview-bar">
      <div class="overview-meta">
        <DataBasisBadge basis="captured" prefix="运维口径" />
        <span class="muted">只读体检，不写生产</span>
        <span v-if="catalog?.generatedAt" class="muted">目录生成于 {{ formatDateTime(catalog.generatedAt) }}</span>
      </div>
      <el-button size="small" :loading="loading" @click="loadAll">刷新</el-button>
    </section>

    <section class="metric-grid">
      <article v-for="metric in metrics" :key="metric.key" class="metric-card" :data-metric="metric.key">
        <span>{{ metric.label }}</span>
        <strong>{{ metric.value }} <small class="muted">{{ metric.unit }}</small></strong>
        <em :class="metric.tone">{{ metric.note }}</em>
      </article>
    </section>

    <!-- 待处理放在链路之前：首屏先回答「现在要动手的是哪几条」。 -->
    <section class="panel alert-panel">
      <div class="panel-title">
        <h2>待处理</h2>
        <span v-if="allAlertRows.length">
          共 {{ allAlertRows.length }} 个数据集 / 数据流有问题{{ allAlertRows.length > ALERT_LIMIT ? `，按严重程度显示前 ${ALERT_LIMIT} 个` : '' }}
        </span>
      </div>
      <el-alert v-if="errors.quality" type="error" :closable="false" show-icon :title="`质量数据取数失败：${errors.quality}`" />
      <el-empty v-else-if="!qualityReady" :description="quality?.message || '质量报告未生成'" />
      <el-empty v-else-if="!alertRows.length" description="当前无待处理事项" />
      <el-table v-else :data="alertRows" size="small" row-key="key" class="alert-table">
        <el-table-column label="数据集 / 数据流" min-width="280">
          <template #default="{ row }">
            <div class="alert-name">
              <el-tag :type="tagType(row.status)" size="small">{{ row.status === 'fail' ? '不合格' : '告警' }}</el-tag>
              <span class="alert-label" :title="row.label">{{ row.label }}</span>
            </div>
            <div class="alert-sub muted">{{ row.sub }}</div>
          </template>
        </el-table-column>
        <el-table-column label="问题" min-width="180">
          <template #default="{ row }">
            <span v-for="problem in row.problems" :key="problem" class="problem-chip">{{ problem }}</span>
          </template>
        </el-table-column>
        <el-table-column label="最后到数" width="150">
          <template #default="{ row }">{{ formatDateTime(row.lastAt) }}</template>
        </el-table-column>
        <el-table-column label="滞后" width="80" align="right">
          <template #default="{ row }">{{ formatAge(row.ageHours) }}</template>
        </el-table-column>
        <el-table-column prop="detail" label="说明" min-width="220" show-overflow-tooltip />
        <el-table-column label="处理" width="80">
          <template #default="{ row }">
            <RouterLink v-if="row.link.to" :to="row.link.to" class="stage-link">{{ row.link.label }}</RouterLink>
            <button v-else type="button" class="stage-link" @click="go(row.link)">{{ row.link.label }}</button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>数据链路</h2>
        <span>接入 → 入库 → 摄取 → 治理与回放，每段状态取自当前真实数字</span>
      </div>
      <div class="stage-grid">
        <article v-for="stage in stages" :key="stage.key" class="stage-card" :data-stage="stage.key">
          <header class="stage-head">
            <span class="stage-step">{{ stage.step }}</span>
            <h3>{{ stage.title }}</h3>
            <InfoPop :title="stage.title" class="stage-info">{{ stage.desc }}</InfoPop>
          </header>
          <p class="stage-status" :class="stage.statusTone">{{ stage.status }}</p>
          <footer v-if="stage.actions.length" class="stage-actions">
            <template v-for="action in stage.actions" :key="action.label">
              <RouterLink v-if="action.to" :to="action.to" class="stage-link">{{ action.label }} →</RouterLink>
              <button v-else type="button" class="stage-link" @click="go(action)">{{ action.label }} →</button>
            </template>
          </footer>
        </article>
      </div>
    </section>

    <section class="content-grid two-columns bottom-grid">
      <div class="panel">
        <div class="panel-title">
          <h2>最该补数的数据族</h2>
          <span>按族内最新数据时间从旧到新，未知时间排最前</span>
        </div>
        <el-alert v-if="errors.catalog" type="error" :closable="false" show-icon :title="`数据目录取数失败：${errors.catalog}`" />
        <el-empty v-else-if="!staleFamilies.length" :description="catalog?.message || '目录暂无数据'" />
        <el-table v-else :data="staleFamilies" size="small" row-key="family" class="stale-table">
          <el-table-column label="数据族" min-width="150">
            <template #default="{ row }">
              <span class="family-label">{{ row.familyLabel }}</span>
              <div class="alert-sub muted">{{ row.datasets }} 个数据集 · {{ formatNumber(row.rows) }} 行</div>
            </template>
          </el-table-column>
          <el-table-column label="最新数据" width="110">
            <template #default="{ row }">{{ formatDate(row.latest) }}</template>
          </el-table-column>
          <el-table-column label="新鲜度" width="130">
            <template #default="{ row }">
              <el-tag :type="tagType(row.freshness)" size="small">{{ row.freshnessText }}</el-tag>
              <div class="alert-sub muted">{{ cadenceLabel(row) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="回放" width="64">
            <template #default="{ row }">
              <RouterLink :to="{ path: '/yygl/data-browser', query: { family: row.family } }" class="stage-link">查看</RouterLink>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="panel">
        <div class="panel-title">
          <h2>最近上传批次</h2>
          <span>上传中心落库台账</span>
        </div>
        <el-alert v-if="errors.batches" type="error" :closable="false" show-icon :title="`批次台账取数失败：${errors.batches}`" />
        <el-empty v-else-if="!recentBatches.length" description="尚无上传批次" />
        <el-table v-else :data="recentBatches" size="small" class="batch-table">
          <el-table-column label="数据集 / 文件" min-width="180">
            <template #default="{ row }">
              <span class="family-label">{{ row.dataset }}</span>
              <div class="alert-sub muted" :title="row.file_name">{{ row.file_name }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="rows_valid" label="有效行" width="80" align="right" />
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <el-tag :type="tagType(row.status)" size="small">{{ row.status === 'COMMITTED' ? '已落库' : '已撤销' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="时间" width="150">
            <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
          </el-table-column>
        </el-table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.overview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.overview-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: var(--font-sm);
}

.muted {
  color: var(--muted);
  font-size: var(--font-sm);
}

.stage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 14px;
}

.stage-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm, 6px);
  background: var(--panel-sub);
}

.stage-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.stage-step {
  color: var(--accent);
  font-size: var(--font-15);
  font-weight: 600;
}

.stage-head h3 {
  margin: 0;
  font-size: var(--font-15);
  font-weight: 600;
}

.stage-head .stage-info {
  margin-left: auto;
}

.alert-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* 补数与批次两栏等宽：全局 two-columns 是 1.6:0.8 主次栏，批次表 4 列会被挤出横向滚动。
   窄屏回落单列由全局媒体查询负责（同一选择器权重更高，这里用 min-width 限定只在宽屏生效）。 */
@media (min-width: 961px) {
  .bottom-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.alert-name .el-tag {
  flex: none;
}

.alert-label,
.family-label {
  color: var(--text);
  font-weight: 500;
}

/* 族中文名常很长（如「南网披露表通用度量长表(17 键·…)」），单行省略、悬停看全名，行高不被撑开。 */
.alert-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alert-sub {
  margin-top: 2px;
  font-size: var(--font-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.problem-chip {
  display: inline-block;
  margin: 2px 4px 2px 0;
  padding: 1px 7px;
  border-radius: 10px;
  font-size: var(--font-xs);
  color: var(--text-soft);
  background: color-mix(in srgb, var(--muted) 12%, transparent);
}

.stage-status {
  margin: 0;
  font-size: var(--font-sm);
  line-height: 1.6;
  color: var(--text-soft);
}

.stage-status.ok {
  color: var(--success);
}

.stage-status.warn {
  color: var(--warning);
}

.stage-actions {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: 4px;
}

.stage-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--primary);
  font-size: var(--font-sm);
  cursor: pointer;
  text-decoration: none;
}

.stage-link:hover {
  text-decoration: underline;
}

@media (max-width: 1100px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .two-columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
