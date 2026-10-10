<script setup lang="ts">
// 经营总览大屏（/gsgl/overview）：绑定公司业务系统（/api/company/dashboard），
// 聚合发电（装机/发电/电源结构）、交易（量/价/成交额）、金融经济（成交额/度电毛利）指标，
// 支持年度/月度/旬/周/日时间尺度，按 RBAC（路由全员可达）+ companyId（后端权威隔离）+
// subjectType（视角标签）控制。数据为种子合成近1年（source='demo-seed'），显式标注。
import { ref, computed, watch, onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue'
import ChartCard from '../../components/common/ChartCard.vue'
import PriceTicker from '../../components/PriceTicker.vue'
import KpiCard from '@/components/company/KpiCard.vue'
import { fetchCompanyDashboard, refreshCompanyOptions, type CompanyDashboard, type DashboardPeriod } from '@/services/company/companyApi'
import { todayBeijing } from '@/utils/beijingDate'
import { POWER, lineSeries, areaSeries, barSeries, grid, kpiOverlay, tooltipStyle, legend, catAxis, valueAxis } from '@/services/chart/chartStyle'
import { cssVar } from '../../composables/useTheme'
import { fmtNum } from '@/composables/useCountUp'
import { getCurrentUser } from '@/services/auth'
import { subjectTypeLabels, canAccessPath } from '@/services/governance'
import { varCvar } from '@/services/settlementFormula'
import { ElMessage } from 'element-plus'
import { selectedCompanyId, companyOptions, selectableCompanies, canSwitchCompany, setCurrentCompanyId } from '@/services/company/companyContext'

const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: 'year', label: '年度' },
  { value: 'month', label: '月度' },
  { value: 'dekad', label: '旬' },
  { value: 'week', label: '周' },
  { value: 'day', label: '日' }
]

const user = getCurrentUser()
const canSwitch = canSwitchCompany(user)
const period = ref<DashboardPeriod>('month')
const dateRange = ref<[string, string] | null>(null)
// viewScope：'__group__' = 集团汇总（scope=group）；否则 = 单 companyId。
const viewScope = ref<string>(canSwitch ? '__group__' : user?.companyId ?? selectedCompanyId.value)

const dashboard = ref<CompanyDashboard | null>(null)
const loading = ref(false)
const err = ref('')
const clock = ref('')
let clockTimer = 0

// 旬/周/日 bucket 标签美化：2025-06-1→"2025-06 上旬"；2025-W25→"2025 第25周"；日→MM-DD。
function fmtBucket(b: string): string {
  const dekad = b.match(/^(\d{4}-\d{2})-(\d)$/)
  if (dekad) return `${dekad[1]} ${['上旬', '中旬', '下旬'][Number(dekad[2]) - 1]}`
  const week = b.match(/^(\d{4})-W(\d{2})$/)
  if (week) return `${week[1]} 第${Number(week[2])}周`
  if (/^\d{4}-\d{2}-\d{2}$/.test(b)) return b.slice(5)
  return b
}

const companySelectOptions = computed(() => {
  const opts: { value: string; label: string }[] = []
  if (canSwitch) opts.push({ value: '__group__', label: '集团汇总（全部下属公司）' })
  // 与全局切换器同口径 selectableCompanies（#375）：跨地区专属公司不可选，
  // 避免下拉出现会被 setCurrentCompanyId 拒绝的选项。
  for (const c of selectableCompanies.value) opts.push({ value: c.companyId, label: c.shortName || c.name })
  return opts
})
const currentCompanyLabel = computed(() => {
  if (viewScope.value === '__group__') return '集团汇总'
  const c = companyOptions.value.find((x) => x.companyId === viewScope.value)
  return c?.shortName || c?.name || viewScope.value
})
const viewSubjectLabel = computed(() => subjectTypeLabels[user?.subjectType ?? 'GROUP'] ?? '集团')
const sourceBadge = computed(() => {
  const s = dashboard.value?.source
  if (s === 'demo-seed') return { show: true, text: '演示数据 · 结构化合成', cls: 'tag-demo' }
  if (s === 'mixed') return { show: true, text: '含演示数据（混合）', cls: 'tag-mixed' }
  if (s === 'db') return { show: true, text: '真实数据 · 导入', cls: 'tag-real' }
  if (s === 'capture') return { show: true, text: '真实数据 · 采集回放', cls: 'tag-real' }
  return { show: false, text: '', cls: '' }
})

function onCompanyChange(val: string) {
  // 先校验后落地（#375）：setCurrentCompanyId 失败（越权/跨地区被拒）时不更新
  // viewScope、不触发 load，避免页面标签/导出名/钻取链接显示被拒公司而数据仍是原公司。
  if (val !== '__group__' && !setCurrentCompanyId(val)) {
    ElMessage.warning('该公司不属于当前地区或不在授权范围内，已保留原选择')
    return
  }
  viewScope.value = val
  load()
}

const prevDashboard = ref<CompanyDashboard | null>(null)

function buildQuery(override?: { from?: string; to?: string }): { period: DashboardPeriod; from?: string; to?: string; scope?: 'group' } {
  const q: { period: DashboardPeriod; from?: string; to?: string; scope?: 'group' } = { period: period.value }
  if (override?.from) q.from = override.from
  else if (dateRange.value && dateRange.value[0]) q.from = dateRange.value[0]
  if (override?.to) q.to = override.to
  else if (dateRange.value && dateRange.value[1]) q.to = dateRange.value[1]
  if (viewScope.value === '__group__') q.scope = 'group'
  return q
}

// 同比/环比：按 period 推「上一期」范围（month -30d / year -365d / 旬 -10d / 周 -7d / 日 -1d）。
function prevRange(): { from: string; to: string } | null {
  const toStr = (dateRange.value && dateRange.value[1]) || todayBeijing()
  const to = new Date(toStr)
  const fromStr = (dateRange.value && dateRange.value[0]) || (() => { const f = new Date(to); f.setDate(f.getDate() - 364); return f.toISOString().slice(0, 10) })()
  const spanDays = Math.round((+to - +new Date(fromStr)) / 864e5) + 1
  const shift = { year: 365, month: 30, dekad: 10, week: 7, day: 1 }[period.value] ?? 30
  const prevTo = new Date(to); prevTo.setDate(prevTo.getDate() - shift)
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (spanDays - 1))
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) }
}

// 切公司/切用户/切周期期间，旧 Promise 返回不得回写（否则控制条新公司、图表旧数据跨公司/跨用户串味，#1738）
let loadGen = 0
async function load() {
  const gen = ++loadGen
  loading.value = true
  err.value = ''
  try {
    const prevR = prevRange()
    const [curD, prevD] = await Promise.all([
      fetchCompanyDashboard(buildQuery()),
      prevR ? fetchCompanyDashboard(buildQuery(prevR)) : Promise.resolve(null)
    ])
    if (gen !== loadGen) return // 期间切了公司/用户/周期 → 丢弃旧结果
    dashboard.value = curD
    prevDashboard.value = prevD
  } catch (e) {
    err.value = (e as Error)?.message || '加载失败'
    // 清空旧数据：避免控制条已显示新公司/范围，图表却停留在上一轮数据导致误读
    dashboard.value = null
    prevDashboard.value = null
  } finally {
    loading.value = false
  }
}

// 同比/环比 Δ%：(cur - prev) / |prev| * 100。prev 缺失或为 0 则 undefined（不显示）。
function deltaPctOf(cur: number | undefined, prev: number | undefined): number | undefined {
  if (cur === undefined || prev === undefined || prev === 0) return undefined
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10
}
const kpiDeltas = computed(() => {
  const c = dashboard.value?.kpis
  const p = prevDashboard.value?.kpis
  if (!c || !p) return {} as Record<string, number | undefined>
  return {
    totalCapacityMw: deltaPctOf(c.totalCapacityMw, p.totalCapacityMw),
    totalGenerationMwh: deltaPctOf(c.totalGenerationMwh, p.totalGenerationMwh),
    renewableRatioPct: deltaPctOf(c.renewableRatioPct, p.renewableRatioPct),
    utilizationHours: deltaPctOf(c.utilizationHours, p.utilizationHours),
    totalTradeVolume: deltaPctOf(c.totalTradeVolume, p.totalTradeVolume),
    totalTradeAmountWan: deltaPctOf(c.totalTradeAmountWan, p.totalTradeAmountWan)
  }
})

// VaR/CVaR：以「成交额环比差分」为 pnl 样本（成交额下降=损失）。直接用成交额(恒正)会让 varCvar 的 -pnl 钳 0 致 VaR 恒 0。
const varResult = computed(() => {
  const d = dashboard.value
  if (!d || d.trading.amount.length < 2) return null
  const diffs = d.trading.amount.map((v, i, a) => v - (a[i - 1] ?? v))
  return varCvar(diffs, 0.95, 30)
})

// KPI 钻取：发电类→/gsgl/output，交易类→/gsgl/trades。RBAC 校验无权则不传 to（不可点）。
function drillUrl(path: string): string | undefined {
  if (!canAccessPath(path, user)) return undefined
  if (viewScope.value === '__group__') return path
  return `${path}?company=${encodeURIComponent(viewScope.value)}`
}
const drillTargets = computed(() => ({ output: drillUrl('/gsgl/output'), trades: drillUrl('/gsgl/trades') }))

// 导出 Excel（懒加载 xlsx）。多 sheet：KPI / 发电趋势 / 交易趋势。
async function exportData() {
  if (!dashboard.value) return
  const { exportWorkbook } = await import('../../utils/exportExcel')
  const d = dashboard.value
  const types = Object.keys(d.generation.byType)
  const sheets = [
    {
      name: 'KPI',
      rows: [
        ['指标', '值'],
        ['总装机(MW)', d.kpis.totalCapacityMw],
        ['发电装机(MW)', d.kpis.generationCapacityMw],
        ['储能(MW)', d.kpis.storageCapacityMw],
        ['累计发电(MWh)', d.kpis.totalGenerationMwh],
        ['新能源占比(%)', d.kpis.renewableRatioPct],
        ['利用小时(h)', d.kpis.utilizationHours],
        ['累计交易量(MWh)', d.kpis.totalTradeVolume],
        ['成交均价(元/MWh)', d.kpis.avgTradePrice],
        ['累计成交额(万元)', d.kpis.totalTradeAmountWan],
        ['度电毛利(元/kWh)', d.kpis.unitMarginYuanPerKwh]
      ] as (string | number)[][]
    },
    {
      name: '发电趋势',
      rows: [['周期', ...d.generation.buckets], ...types.map((t) => [t, ...d.generation.byType[t]] as (string | number)[]), ['合计', ...d.generation.total]] as (string | number)[][]
    },
    {
      name: '交易趋势',
      rows: [
        ['周期', ...d.trading.buckets],
        ['交易量(MWh)', ...d.trading.volume],
        ['成交额(元)', ...d.trading.amount],
        ['均价(元/MWh)', ...d.trading.avgPrice]
      ] as (string | number)[][]
    }
  ]
  exportWorkbook(`经营总览_${currentCompanyLabel.value}_${d.period}_${d.from}_${d.to}.xlsx`, sheets)
}

watch(period, () => load())
function onUserChanged() { load() }

// clock 启停：KeepAlive 缓存下切走触发 onDeactivated，须暂停 clock 否则每秒空跑响应式更新至 LRU 逐出（#1740，参照 TradingCockpitView）
function startClock() {
  stopClock()
  clockTimer = window.setInterval(() => {
    clock.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  }, 1000)
}
function stopClock() { window.clearInterval(clockTimer) }
onMounted(async () => {
  await refreshCompanyOptions() // 填充可见公司列表(集团/BOSS 下拉需此)，并校正非法 selectedCompanyId 避免首个请求 403
  load()
  startClock()
  window.addEventListener('governance-user-changed', onUserChanged)
})
onActivated(startClock)      // KeepAlive 切回恢复
onDeactivated(stopClock)     // KeepAlive 切走暂停
onBeforeUnmount(() => {
  stopClock()
  window.removeEventListener('governance-user-changed', onUserChanged)
})

// 电源类型 → POWER 语义色板
const TYPE_META: Record<string, { color: string; label: string }> = {
  火电: { color: POWER.thermal, label: '火电' },
  风电: { color: POWER.wind, label: '风电' },
  光伏: { color: POWER.solar, label: '光伏' },
  水电: { color: POWER.hydro, label: '水电' },
  储能: { color: POWER.storage, label: '储能' }
}

// ---- 图表 buildOption（ChartCard 的 watchEffect 自动追踪 dashboard 重绘；轴/tooltip/legend
// 经 chartStyle 的 tooltipStyle/legend/catAxis/valueAxis + chartChrome() 随全局主题切换，四主题对称）----
function buildGenOption(): Record<string, unknown> {
  const d = dashboard.value
  if (!d) return {}
  const x = d.generation.buckets.map(fmtBucket)
  const series = Object.keys(d.generation.byType)
    .filter((t) => TYPE_META[t])
    .map((t) => areaSeries(TYPE_META[t].label, d.generation.byType[t], TYPE_META[t].color))
  return {
    tooltip: { trigger: 'axis', ...tooltipStyle() },
    legend: legend(),
    grid: grid({ legend: true }),
    xAxis: catAxis(x, { boundaryGap: false }),
    yAxis: valueAxis('发电量 (MWh)'),
    series
  }
}

function buildMixOption(): Record<string, unknown> {
  const d = dashboard.value
  if (!d) return {}
  const data = Object.keys(d.capacity)
    .filter((t) => TYPE_META[t])
    .map((t) => ({ name: TYPE_META[t].label, value: d.capacity[t] || 0, itemStyle: { color: TYPE_META[t].color } }))
  return {
    tooltip: { trigger: 'item', ...tooltipStyle(), formatter: '{b}: {c} MW ({d}%)' },
    legend: legend({ top: 'bottom' }),
    series: [{
      type: 'pie',
      radius: ['38%', '66%'],
      center: ['50%', '46%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: cssVar('--panel') || '#0c1626', borderWidth: 2 },
      label: { color: cssVar('--text') || '#c3d3e8', formatter: '{b}\n{d}%' },
      data
    }]
  }
}

function buildTradeOption(): Record<string, unknown> {
  const d = dashboard.value
  if (!d) return {}
  const x = d.trading.buckets.map(fmtBucket)
  return {
    tooltip: { trigger: 'axis', ...tooltipStyle() },
    legend: legend(),
    grid: grid({ legend: true, right: 52 }),
    xAxis: catAxis(x),
    yAxis: [
      valueAxis('电量 (MWh)', { position: 'left' }),
      valueAxis('均价 (元/MWh)', { position: 'right', splitLine: { show: false } })
    ],
    series: [
      barSeries('交易量', d.trading.volume, POWER.newEnergy),
      { ...lineSeries('成交均价', d.trading.avgPrice, POWER.price), yAxisIndex: 1 }
    ]
  }
}

function buildFinOption(): Record<string, unknown> {
  const d = dashboard.value
  if (!d) return {}
  const x = d.trading.buckets.map(fmtBucket)
  const amountWan = d.trading.amount.map((a) => Math.round((a / 10000) * 10) / 10) // 元 → 万元
  return {
    tooltip: { trigger: 'axis', ...tooltipStyle(), valueFormatter: (v: number) => `${fmtNum(v, 1)} 万元` },
    grid: grid({ right: 64 }),
    xAxis: catAxis(x),
    yAxis: valueAxis('成交额 (万元)'),
    series: [areaSeries('成交额', amountWan, POWER.price)],
    ...kpiOverlay(
      [
        { text: fmtNum(d.kpis.totalTradeAmountWan, 1), sub: '累计成交额 (万元)', color: POWER.price },
        { text: fmtNum(d.kpis.unitMarginYuanPerKwh, 4), sub: '度电毛利 (元/kWh)', color: POWER.positive }
      ],
      { right: 16, top: 14 }
    )
  }
}
</script>

<template>
  <div class="biz-screen">
    <div class="bg-layer">
      <div class="blob b1" />
      <div class="blob b2" />
      <div class="blob b3" />
      <div class="grid-overlay" />
    </div>

    <div class="screen-inner">
      <!-- 顶栏 -->
      <header class="topbar">
        <div class="brand">
          <div class="logo">⚡</div>
          <div>
            <h1>经营总览大屏</h1>
            <p>BUSINESS OVERVIEW · {{ viewSubjectLabel }} 视角 · {{ currentCompanyLabel }}</p>
          </div>
        </div>
        <div class="status">
          <PriceTicker class="ticker" />
          <span class="live"><i class="dot" />实时在线</span>
          <span class="clock">{{ clock }}</span>
          <span v-if="sourceBadge.show" class="tag" :class="sourceBadge.cls">{{ sourceBadge.text }}</span>
        </div>
      </header>

      <!-- 控制条：公司切换 + 时间尺度 + 日期范围 -->
      <div class="ctrlbar">
        <div class="ctrl-group">
          <span class="ctrl-label">公司</span>
          <el-select
            v-if="canSwitch"
            :model-value="viewScope"
            size="small"
            class="co-select"
            popper-class="co-popper"
            @update:model-value="onCompanyChange"
          >
            <el-option v-for="o in companySelectOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
          <span v-else class="co-fixed">{{ currentCompanyLabel }}</span>
        </div>
        <div class="ctrl-group">
          <span class="ctrl-label">时间尺度</span>
          <el-radio-group v-model="period" size="small" class="seg-group">
            <el-radio-button v-for="p in PERIODS" :key="p.value" :value="p.value">{{ p.label }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="ctrl-group">
          <span class="ctrl-label">范围</span>
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            size="small"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            class="co-date"
            popper-class="co-popper"
            @change="load"
          />
          <span class="ctrl-hint">留空 = 近 1 年</span>
        </div>
        <div class="ctrl-group ctrl-right">
          <el-button size="small" class="co-export" :disabled="!dashboard" @click="exportData">导出 Excel</el-button>
        </div>
      </div>

      <!-- KPI 区（发电 4 + 交易/金融 3，含同比环比 Δ 与钻取；按全局总览语义全量展示）-->
      <div v-if="dashboard" class="kpi-row">
        <KpiCard label="总装机容量" :value="dashboard.kpis.totalCapacityMw" unit="MW" :hint="`发电 ${dashboard.kpis.generationCapacityMw} MW · 储能 ${dashboard.kpis.storageCapacityMw} MW`" :to="drillTargets.output" :delta-pct="kpiDeltas.totalCapacityMw" />
        <KpiCard label="累计发电量" :value="dashboard.kpis.totalGenerationMwh" unit="MWh" :hint="`约 ${(dashboard.kpis.totalGenerationMwh / 10000).toFixed(2)} 万 MWh`" :to="drillTargets.output" :delta-pct="kpiDeltas.totalGenerationMwh" />
        <KpiCard label="新能源占比" :value="dashboard.kpis.renewableRatioPct" unit="%" :decimals="1" hint="风电 + 光伏 / 总发电" :to="drillTargets.output" :delta-pct="kpiDeltas.renewableRatioPct" />
        <KpiCard label="利用小时" :value="dashboard.kpis.utilizationHours" unit="h" hint="发电量 / 发电装机" :to="drillTargets.output" :delta-pct="kpiDeltas.utilizationHours" />
        <KpiCard label="累计交易量" :value="dashboard.kpis.totalTradeVolume" unit="MWh" :hint="`均价 ${dashboard.kpis.avgTradePrice} 元/MWh`" :to="drillTargets.trades" :delta-pct="kpiDeltas.totalTradeVolume" />
        <KpiCard label="累计成交额" :value="dashboard.kpis.totalTradeAmountWan" unit="万元" :hint="`度电毛利 ${dashboard.kpis.unitMarginYuanPerKwh} 元/kWh`" :to="drillTargets.trades" :delta-pct="kpiDeltas.totalTradeAmountWan" />
        <KpiCard v-if="varResult" label="成交额 VaR(95%)" :value="Math.round((varResult.var / 10000) * 10) / 10" unit="万元" :to="drillTargets.trades" :hint="varResult.insufficientSample ? `样本 ${varResult.sampleCount} · 仅供参考` : `CVaR ${Math.round((varResult.cvar / 10000) * 10) / 10} 万 · 样本 ${varResult.sampleCount}`" />
      </div>

      <!-- 图表区 -->
      <div v-if="dashboard" class="cell span8">
        <ChartCard title="发电量趋势（按电源类型）" :build-option="buildGenOption" :loading="loading" fullscreen height="320" />
      </div>
      <div v-if="dashboard" class="cell span4">
        <ChartCard title="装机结构" :build-option="buildMixOption" :loading="loading" height="320" />
      </div>
      <div v-if="dashboard" class="cell span6">
        <ChartCard title="交易量价（量 · 柱 / 价 · 线）" :build-option="buildTradeOption" :loading="loading" group="co-overview" height="300" />
      </div>
      <div v-if="dashboard" class="cell span6">
        <ChartCard title="成交额与度电毛利" :build-option="buildFinOption" :loading="loading" group="co-overview" fullscreen height="300" />
      </div>

      <div v-if="err" class="err-bar">加载失败：{{ err }}</div>
      <div v-if="!dashboard && !loading" class="empty-bar">暂无数据</div>
    </div>
  </div>
</template>

<style scoped>
/* 大屏继承全局主题 token（classic/arc/flow/paper），不再硬编码 arc 深色。
   大屏专用变量（blob 辉光强度 / 网格色 / 径向高光 / KPI 辉光强度）按主题覆盖，
   见文件末 <style> 非 scoped 块，实现四主题对称皮肤（深色辉光、浅色精致）。 */
.biz-screen {
  --screen-blob-alpha: 0.4;
  --screen-grid: rgba(70, 120, 200, 0.06);
  --screen-radial: var(--panel-2);
  --kpi-glow-strength: 0.45;
  position: relative;
  min-height: calc(100vh - 48px);
  background: radial-gradient(1200px 700px at 15% -10%, var(--screen-radial) 0%, var(--bg) 55%), var(--bg);
  color: var(--text);
  overflow: hidden;
}
.bg-layer { position: absolute; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.blob { position: absolute; border-radius: 50%; filter: blur(90px); opacity: var(--screen-blob-alpha); }
.b1 { width: 460px; height: 460px; background: var(--primary); top: -220px; left: -140px; }
.b2 { width: 520px; height: 520px; background: var(--accent); right: -160px; top: 80px; }
.b3 { width: 420px; height: 420px; background: var(--accent-2, var(--success)); bottom: -180px; left: 30%; opacity: calc(var(--screen-blob-alpha) * 0.75); }
.grid-overlay {
  position: absolute; inset: 0;
  background-image: linear-gradient(var(--screen-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--screen-grid) 1px, transparent 1px);
  background-size: 44px 44px;
}
.screen-inner {
  position: relative; z-index: 1;
  display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px;
  padding: 20px 24px 28px;
}
.topbar { grid-column: span 12; display: flex; justify-content: space-between; align-items: center; }
.brand { display: flex; align-items: center; gap: 14px; }
.logo {
  width: 46px; height: 46px; border-radius: 13px; display: grid; place-items: center; font-size: var(--font-22);
  background: linear-gradient(135deg, var(--primary), var(--accent));
  box-shadow: 0 0 24px var(--glow);
}
.brand h1 { margin: 0; font-size: var(--font-21); letter-spacing: 1px; font-weight: 700; color: var(--text); text-shadow: var(--glow-text); }
.brand p { margin: 3px 0 0; font-size: var(--font-xs); color: var(--muted); letter-spacing: 1.5px; }
.status { display: flex; align-items: center; gap: 16px; font-size: var(--font-md); color: var(--text-soft); }
.live { display: inline-flex; align-items: center; gap: 7px; color: var(--success); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); box-shadow: 0 0 10px var(--success); animation: pulse 1.6s infinite; }
.clock { font-variant-numeric: tabular-nums; font-size: var(--font-15); color: var(--text); }
/* PriceTicker 嵌入顶栏深色兜底（其内部样式用 CSS 变量，局部 --period-accent 已覆盖；
   此处再兜底根色，防止全局 classic 下文字不可读） */
.status :deep(.ticker) { color: var(--text-soft); }
.status :deep(.ticker):not(:first-child) { margin-left: 4px; }
.tag-demo {
  padding: 4px 10px; border-radius: 999px; font-size: var(--font-xs); color: var(--warning);
  border: 1px solid rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.1);
}
.tag-mixed {
  padding: 4px 10px; border-radius: 999px; font-size: var(--font-xs); color: var(--accent);
  border: 1px solid rgba(56, 189, 248, 0.4); background: rgba(56, 189, 248, 0.1);
}
.tag-real {
  padding: 4px 10px; border-radius: 999px; font-size: var(--font-xs); color: var(--success);
  border: 1px solid rgba(34, 197, 94, 0.4); background: rgba(34, 197, 94, 0.1);
}

.ctrlbar {
  grid-column: span 12; display: flex; align-items: center; gap: 26px; flex-wrap: wrap;
  padding: 12px 16px; border-radius: 12px;
  background: linear-gradient(160deg, var(--panel-2), var(--panel));
  border: 1px solid var(--line);
}
.ctrl-group { display: flex; align-items: center; gap: 10px; }
.ctrl-label { font-size: var(--font-sm); color: var(--muted); white-space: nowrap; }
.co-select { width: 230px; }
.co-fixed { font-size: var(--font-md); color: var(--text); }
.co-date { width: 240px; }
.ctrl-hint { font-size: var(--font-xs); color: var(--muted); }
.ctrl-right { margin-left: auto; }
.co-export { background: var(--panel-2); border-color: var(--line); color: var(--text-soft); }
.co-export:hover { border-color: var(--primary); color: var(--primary); }

.kpi-row { grid-column: span 12; display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; }

.cell { display: flex; }
.cell :deep(.chart-card) { flex: 1; }
.span8 { grid-column: span 8; }
.span6 { grid-column: span 6; }
.span4 { grid-column: span 4; }

.err-bar { grid-column: span 12; color: var(--danger); font-size: var(--font-md); padding: 10px 14px; }
.empty-bar { grid-column: span 12; color: var(--muted); font-size: var(--font-md); padding: 24px; text-align: center; }

@keyframes pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: 0.5; } }

@media (max-width: 1280px) {
  .kpi-row { grid-template-columns: repeat(3, 1fr); }
  .span8, .span6 { grid-column: span 12; }
  .span4 { grid-column: span 12; }
}

/* 移动端：KPI 行降为2列，顶栏状态区换行，控制栏紧凑化 */
@media (max-width: 768px) {
  .screen-inner { padding: 12px 14px 20px; gap: 10px; }
  .kpi-row { grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .status { gap: 8px; flex-wrap: wrap; }
  .topbar { flex-wrap: wrap; gap: 8px; }
  .co-select { width: 100%; }
  .co-date { width: 100%; }
  .ctrl-group { flex-wrap: wrap; }
  .ctrlbar { gap: 14px; }
}
@media (max-width: 480px) {
  .kpi-row { grid-template-columns: 1fr; }
}
</style>

<style>
/* 大屏 el 弹层深色（弹层挂 body，需全局；仅 .co-popper 作用域，不污染其他页面弹层）。
   基础覆盖：panel 背景/边框/文字 + 下拉项 hover + 日期表头/单元格/箭头。 */
/* 四主题对称皮肤：深色(arc/flow)辉光强、浅色(classic/paper)精致弱辉光。
   覆盖 .biz-screen 的大屏专用变量（blob alpha / 网格 / 径向高光 / KPI 辉光强度）。 */
:root[data-theme='classic'] .biz-screen,
:root[data-theme='paper'] .biz-screen { --screen-blob-alpha: 0.08; --screen-grid: rgba(15, 23, 42, 0.04); --screen-radial: var(--panel); --kpi-glow-strength: 0.2; }
:root[data-theme='arc'] .biz-screen { --screen-blob-alpha: 0.4; --screen-grid: rgba(70, 120, 200, 0.06); --screen-radial: #0d1b3a; --kpi-glow-strength: 0.45; }
:root[data-theme='flow'] .biz-screen { --screen-blob-alpha: 0.35; --screen-grid: rgba(108, 201, 219, 0.06); --screen-radial: #10223a; --kpi-glow-strength: 0.4; }

/* 大屏 el 弹层主题感知（弹层挂 body，用全局 var 继承主题，不再硬编码深色）。 */
.co-popper.el-popper { background: var(--panel) !important; border: 1px solid var(--line) !important; color: var(--text) !important; }
.co-popper .el-select-dropdown__item { color: var(--text-body, var(--text)); }
.co-popper .el-select-dropdown__item.hover,
.co-popper .el-select-dropdown__item:hover { background: var(--primary-tint, rgba(127, 127, 127, 0.08)); color: var(--text); }
.co-popper .el-picker-panel { background: transparent; color: var(--text); }
.co-popper .el-date-table th { color: var(--muted); border-bottom-color: var(--line); }
.co-popper .el-date-table td .el-date-table-cell__text { color: var(--text-body, var(--text)); }
.co-popper .el-date-table td.today .el-date-table-cell__text { color: var(--primary); font-weight: 700; }
.co-popper .el-picker-panel__icon-btn { color: var(--muted); }
.co-popper .el-date-range-picker__content.is-left { border-right-color: var(--line); }
.co-popper .popper__arrow::after { border-bottom-color: var(--panel) !important; }
</style>
