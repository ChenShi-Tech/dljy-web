<script setup lang="ts">
// 数据运维总览（/data-ops/console 首个 tab）：把「数据链路现在什么状态、下一步该动哪一步」
// 摊在一屏——四指标卡 + 链路四段 + 告警/批次两栏 + 族新鲜度表。
//
// 取数全走既有只读接口（治理 catalog/quality/backup + 上传批次台账），三路各自独立
// （allSettled）：某一路失败只把那一路标成「取数失败」，不整页空白；无数据如实显示空态，
// 不用占位数字充数（诚实红线）。本面板只读，不写任何生产数据。
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { apiGet } from '@/services/api'
import { fetchUploadBatches, type UploadBatchRow } from '@/services/data/uploadClient'
import { ageDaysOf, freshnessOf, type Freshness } from '@/services/data/freshness'
import { onRegionChange } from '@/composables/useRegionReload'
import DataBasisBadge from '@/components/DataBasisBadge.vue'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'

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
    checks?: Array<{ id: string; status: QualityStatus; detail?: string }>
  }>
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
const streams = computed(() => quality.value?.streams ?? [])
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
    value: quality.value ? String(quality.value.summary.pass) : '—',
    unit: quality.value ? `/ ${qualityTotal.value} 通过` : '',
    note: quality.value
      ? `告警 ${quality.value.summary.warn} · 不合格 ${quality.value.summary.fail}`
      : errors.value.quality || '取数中',
    tone: !quality.value ? '' : quality.value.summary.fail ? 'orange' : 'green'
  },
  {
    key: 'streams',
    label: '数据流断流',
    value: quality.value ? String(brokenStreams.value.length) : '—',
    unit: quality.value ? `/ ${streams.value.length} 条流` : '',
    note: quality.value
      ? brokenStreams.value.length
        ? '按声明节奏已停更，需补采'
        : `节奏正常${warnStreams.value.length ? ` · ${warnStreams.value.length} 条接近阈值` : ''}`
      : errors.value.quality || '取数中',
    tone: !quality.value ? '' : brokenStreams.value.length ? 'orange' : 'green'
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
  actions: Array<{ label: string; tab?: string; to?: string }>
}

const sourceKinds = computed(() => catalog.value?.stats.bySource ?? [])
const committedBatches = computed(() => (batches.value ?? []).filter((b) => b.status === 'COMMITTED'))

const stages = computed<Stage[]>(() => [
  {
    key: 'access',
    step: '①',
    title: '接入',
    desc: '数据源凭据、连通测试与采集通道；先把数据能进来这件事办妥。',
    status: sourceKinds.value.length
      ? `${sourceKinds.value.length} 类来源在库：${sourceKinds.value.map((s) => `${s.source_type} ${s.n}`).join(' · ')}`
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
    status: quality.value
      ? brokenStreams.value.length
        ? `${brokenStreams.value.length} 条流停更，建议先补这几条：${brokenStreams.value.slice(0, 2).map((s) => s.stream).join('、')}`
        : '各流按节奏在更新'
      : errors.value.quality || '数据流状态取数中',
    statusTone: !quality.value ? 'idle' : brokenStreams.value.length ? 'warn' : 'ok',
    actions: [
      { label: '摄取管理', tab: 'ingest' },
      { label: '定时任务', to: '/system/ai-studio?tab=schedules' }
    ]
  },
  {
    key: 'govern',
    step: '④',
    title: '治理与回放',
    desc: '目录、质量、备份三面只读体检；核对具体数值去通用数据浏览器逐行回放。',
    status: quality.value
      ? `质量 通过 ${quality.value.summary.pass} / 告警 ${quality.value.summary.warn} / 不合格 ${quality.value.summary.fail}`
      : errors.value.quality || '质量摘要取数中',
    statusTone: !quality.value ? 'idle' : quality.value.summary.fail ? 'warn' : 'ok',
    actions: [
      { label: '治理控制台', tab: 'governance' },
      { label: '数据浏览器', to: '/yygl/data-browser' }
    ]
  }
])

// —— 待处理：断流与不合格流优先，其次质量检查里的 fail/warn 明细 ——
type AlertRow = {
  name: string
  kind: string
  cadence: string
  status: QualityStatus
  age: string
  lastAt: string
  detail: string
}

const alertRows = computed<AlertRow[]>(() => {
  const rows: AlertRow[] = streams.value
    .filter((s) => s.status !== 'pass')
    .map((s) => ({
      name: s.stream,
      kind: s.kind === 'upload-contract' ? '上传契约流' : '族流',
      cadence: s.cadence || '—',
      status: s.status,
      age: s.ageHours === null ? '—' : `${Math.round(s.ageHours)} 小时`,
      lastAt: formatDateTime(s.lastAt),
      detail: s.detail || '—'
    }))
  for (const item of quality.value?.items ?? []) {
    for (const check of item.checks ?? []) {
      if (check.status === 'pass') continue
      rows.push({
        name: `${item.family} / ${item.datasetKey}`,
        kind: `检查 ${check.id}`,
        cadence: item.region || '—',
        status: check.status,
        age: '—',
        lastAt: '—',
        detail: check.detail || '—'
      })
    }
  }
  // fail 排在 warn 前：先看必须动手的。
  return rows.sort((a, b) => Number(b.status === 'fail') - Number(a.status === 'fail')).slice(0, 12)
})

// —— 最近上传批次台账 ——
const recentBatches = computed(() => (batches.value ?? []).slice(0, 8))

// —— 最该补数的族：按数据时间从旧到新，未知时间排最前（未知比过期更需要确认）——
const staleItems = computed(() => {
  const items = [...(catalog.value?.items ?? [])]
  return items
    .sort((a, b) => {
      const ta = a.dataTime ? new Date(a.dataTime).getTime() : -Infinity
      const tb = b.dataTime ? new Date(b.dataTime).getTime() : -Infinity
      return ta - tb
    })
    .slice(0, 10)
})

const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: '新鲜',
  aging: '老化',
  stale: '过期',
  unknown: '未知'
}

function freshnessOfItem(item: CatalogItem) {
  return freshnessOf(item.dataTime)
}

function freshnessText(item: CatalogItem) {
  const age = ageDaysOf(item.dataTime)
  return `${FRESHNESS_LABEL[freshnessOfItem(item)]}${age === null ? '' : ` · ${age}天`}`
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
      <article v-for="metric in metrics" :key="metric.key" class="metric-card">
        <span>{{ metric.label }}</span>
        <strong>{{ metric.value }} <small class="muted">{{ metric.unit }}</small></strong>
        <em :class="metric.tone">{{ metric.note }}</em>
      </article>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>数据链路</h2>
        <span>接入 → 入库 → 摄取 → 治理与回放；每段状态取自当前真实数字</span>
      </div>
      <div class="stage-grid">
        <article v-for="stage in stages" :key="stage.key" class="stage-card">
          <header class="stage-head">
            <span class="stage-step">{{ stage.step }}</span>
            <h3>{{ stage.title }}</h3>
          </header>
          <p class="stage-desc">{{ stage.desc }}</p>
          <p class="stage-status" :class="stage.statusTone">{{ stage.status }}</p>
          <footer class="stage-actions">
            <template v-for="action in stage.actions" :key="action.label">
              <RouterLink v-if="action.to" :to="action.to" class="stage-link">{{ action.label }} →</RouterLink>
              <button v-else type="button" class="stage-link" @click="go(action)">{{ action.label }} →</button>
            </template>
          </footer>
        </article>
      </div>
    </section>

    <section class="content-grid two-columns">
      <div class="panel">
        <div class="panel-title">
          <h2>待处理告警</h2>
          <span>断流与质量不合格优先，最多 12 条</span>
        </div>
        <el-alert v-if="errors.quality" type="error" :closable="false" show-icon :title="`质量数据取数失败：${errors.quality}`" />
        <el-empty v-else-if="!alertRows.length" :description="quality?.empty ? (quality.message || '暂无质量扫描结果') : '当前无告警'" />
        <el-table v-else :data="alertRows" size="small">
          <el-table-column prop="name" label="数据流 / 数据集" min-width="200" show-overflow-tooltip />
          <el-table-column prop="kind" label="类型" width="110" />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="tagType(row.status)" size="small">{{ row.status === 'fail' ? '断流/不合格' : '告警' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="age" label="滞后" width="90" align="right" />
          <el-table-column prop="lastAt" label="最后到数" width="160" />
          <el-table-column prop="detail" label="说明" min-width="200" show-overflow-tooltip />
        </el-table>
      </div>

      <div class="panel">
        <div class="panel-title">
          <h2>最近上传批次</h2>
          <span>上传中心落库台账</span>
        </div>
        <el-alert v-if="errors.batches" type="error" :closable="false" show-icon :title="`批次台账取数失败：${errors.batches}`" />
        <el-empty v-else-if="!recentBatches.length" description="尚无上传批次" />
        <el-table v-else :data="recentBatches" size="small">
          <el-table-column prop="dataset" label="数据集" min-width="140" show-overflow-tooltip />
          <el-table-column prop="file_name" label="文件" min-width="150" show-overflow-tooltip />
          <el-table-column prop="rows_valid" label="有效行" width="90" align="right" />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="tagType(row.status)" size="small">{{ row.status === 'COMMITTED' ? '已落库' : '已撤销' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="时间" width="160">
            <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
          </el-table-column>
        </el-table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>最该补数的数据族</h2>
        <span>按数据时间从旧到新取前 10，未知时间排最前</span>
      </div>
      <el-alert v-if="errors.catalog" type="error" :closable="false" show-icon :title="`数据目录取数失败：${errors.catalog}`" />
      <el-empty v-else-if="!staleItems.length" :description="catalog?.message || '目录暂无数据'" />
      <el-table v-else :data="staleItems" size="small">
        <el-table-column prop="familyLabel" label="数据族" min-width="150" show-overflow-tooltip />
        <el-table-column prop="datasetKey" label="数据集" min-width="170" show-overflow-tooltip />
        <el-table-column prop="region" label="地区" width="90" />
        <el-table-column prop="sourceType" label="来源" width="110" />
        <el-table-column label="行数" width="110" align="right">
          <template #default="{ row }">{{ formatNumber(row.rowCount) }}</template>
        </el-table-column>
        <el-table-column label="数据时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.dataTime) }}</template>
        </el-table-column>
        <el-table-column label="新鲜度" width="120">
          <template #default="{ row }">
            <el-tag :type="tagType(freshnessOfItem(row))" size="small">{{ freshnessText(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="回放" width="90">
          <template #default="{ row }">
            <RouterLink :to="{ path: '/yygl/data-browser', query: { family: row.family, match: row.datasetKey } }" class="stage-link">
              查看
            </RouterLink>
          </template>
        </el-table-column>
      </el-table>
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

.stage-desc {
  margin: 0;
  color: var(--muted);
  font-size: var(--font-sm);
  line-height: 1.6;
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
