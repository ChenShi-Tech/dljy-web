<script setup lang="ts">
// 现货交易旗舰首页（/dashboard，现货交易分组首位）：
// 全国通用层(交易日程状态条 + 价格主图 + 风险/披露/报价方案 + 智能体快捷任务)
// + 云南增强层(身份区域 hero + 分组 tab + 7 个真实数据 panel)。
// 原云南交易工作台 /xhjy/yunnan 已并入此页（路由 redirect 到 /dashboard?tab=，11 个 alias 深链不丢）；
// 非云南地区云南数据区降级为 CockpitRegionLockedCard 诚实空态。
// 设计依据：docs/agent-harness/现货交易流程与页面规划.md §3.1；融合形态见 docs/data/spot-cockpit.md。
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  AlarmClock,
  BadgeCheck,
  CalendarClock,
  ClipboardCheck,
  FileSearch,
  Landmark,
  LineChart,
  RefreshCw,
  ShieldAlert
} from 'lucide-vue-next'
import { useEChart } from '../composables/useEChart'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, emptyOverlay, insideZoom } from '@/services/chart/chartOptions'
import { curveStats } from '@/services/market/spotPrice'
import { fetchClearingPrice } from '@/services/market/regionClearingPrice'
import { fetchCaptureCoverageWithFallback } from '@/services/market/captureCoverage'
import { fetchLatestForecast } from '@/services/forecast/latestForecast'
import { buildPricePanel, resolvePanelDate } from '@/services/market/cockpitPricePanel'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import TrustBadge from '@/components/common/TrustBadge.vue'
import type { DataBasis } from '@/services/dataBasis'
import SpotCockpitCore from '@/components/spot/cockpit/SpotCockpitCore.vue'
import CockpitRegionLockedCard from '@/components/spot/cockpit/CockpitRegionLockedCard.vue'
import CockpitQuickActions from '@/components/spot/cockpit/CockpitQuickActions.vue'
// 地区增强层面板已全部迁入扩展包（features/regions/<省>/），经 regionSlots 装配
// 本内核不再 import 任何省份的面板组件；cockpit tab 复用上面的通用 SpotCockpitCore。
import { onRegionChange } from '../composables/useRegionReload'
import { resolveRegionSlot, type RegionSlotId } from '@/services/region/regionSlots'
import { currentRegion } from '@/services/region/regionContext'
import { getCurrentUser, type AuthUser } from '@/services/auth'
import { fetchCaptured } from '@/services/captured'
import type { CapturedListEnvelope, YnForecastRow } from '@/services/data/contracts'
import { canAccessPath, isPathAvailableInRegion, roleLabels, subjectTypeLabels } from '@/services/governance'
import { fetchLatestBidPlanSummary, nextDeclarationTargetDate, type BidPlanSummary } from '@/services/forecast/bidPlanClient'
import { getRuleProfile } from '../rules'
import { getYunnanRuleVerificationSummary, yunnanScenarios } from '@/services/yunnanTrading'
import CgnYunnanPriceStatus from '@/components/spot/CgnYunnanPriceStatus.vue'
import {
  fetchCgnYunnanPriceBundle,
  hasCgnYunnanPriceEntitlement,
  type CgnYunnanPriceBundle,
  type CgnPricePoint
} from '@/services/market/cgnYunnanLivePrice'
import { selectedCompanyId } from '@/services/company/companyContext'

const route = useRoute()
const currentUser = ref<AuthUser>(getCurrentUser())

// 云南身份区域（原云南交易工作台 hero：地区/电网/角色 + 市场阶段/主体类型/主体名 + 规则场景 + 核验状态）
const yunnanProfile = getRuleProfile('yunnan')
const verification = getYunnanRuleVerificationSummary()
const selectedScenarioId = ref(yunnanScenarios[0].id)
const selectedScenario = computed(() => yunnanScenarios.find((item) => item.id === selectedScenarioId.value) ?? yunnanScenarios[0])
const roleLabel = computed(() => roleLabels[currentUser.value.roleCode])
const subjectLabel = computed(() => subjectTypeLabels[currentUser.value.subjectType])

// 市场披露摘要（云南 · yn_system_forecast 最新披露日关键数；真实回放，缺数空态）
interface DisclosureSummary {
  date: string
  loadForecastMW: number | null      // 明日统调负荷预测（yn，日均）
  newEnergyForecastMW: number | null // 明日新能源预测（yn，日均）
  interProvincialMW: number | null   // 云南总送出预测（日均）
}
const disclosure = ref<DisclosureSummary | null>(null)
const disclosureLoading = ref(false)
// 请求序号：地区切换/重复刷新期间旧 Promise 返回不得回写（否则非云南首页串显云南披露）
let discReqSeq = 0
// RBAC：披露关键数复用「披露明细」的细粒度授权（/dashboard 全角色开放，但披露数据只授
// 交易/风控/量化/结算/售电等角色，PLANT/STORAGE 无权限角色不得经首页绕过取数）。
const canViewDisclosure = computed(() => canAccessPath('/xhjy/yunnan/disclosure', currentUser.value))

async function loadDisclosureSummary() {
  if (!canViewDisclosure.value || currentRegion.value.id !== 'yunnan') { disclosure.value = null; return }
  const seq = ++discReqSeq
  disclosureLoading.value = true
  try {
    // 尾部切片取最新披露：capture 按导出包回放，最新披露可能远早于浏览器今天，
    // 「按今天回推窗口」在历史包场景整窗落空，limit 尾部（文件按日期升序拼接）即最新若干天。
    const filter = { limit: 2000 }
    const [loadB, neB, ipB] = await Promise.all([
      fetchCaptured<CapturedListEnvelope<YnForecastRow>>('yn_system_forecast', 'load_forecast', filter),
      fetchCaptured<CapturedListEnvelope<YnForecastRow>>('yn_system_forecast', 'new_energy_forecast_d1', filter),
      fetchCaptured<CapturedListEnvelope<YnForecastRow>>('yn_system_forecast', 'inter_provincial_forecast', filter)
    ])
    // stale 校验：期间切了地区或发起了新请求 → 丢弃本次结果
    if (seq !== discReqSeq || currentRegion.value.id !== 'yunnan') return
    // 目标日口径：new_energy_forecast_d1 为滚动 D-1 集（operateDate=发布日、targetDate=目标日），
    // 用 targetDate 归组才是「被预测的那一天」；单日期表 targetDate=null 回退 operateDate。
    const dayOf = (r: YnForecastRow) => r.targetDate ?? r.operateDate
    const latestAvg = (body: CapturedListEnvelope<YnForecastRow>, pick: (r: YnForecastRow) => boolean): { date: string; avg: number | null } => {
      const rows: YnForecastRow[] = Array.isArray(body?.data) ? body.data : []
      const dates = rows.map(dayOf).filter((d): d is string => Boolean(d)).sort()
      const latest = dates.at(-1)
      if (!latest) return { date: '', avg: null }
      const vals = rows.filter((r): r is YnForecastRow & { value: number } => dayOf(r) === latest && pick(r) && typeof r.value === 'number')
      return { date: latest, avg: vals.length ? +(vals.reduce((s, r) => s + r.value, 0) / vals.length).toFixed(0) : null }
    }
    // 云南总送出：同一时点可能有多个含「云南」断面，先按 timePoint 合计各断面送出，再对
    // 时点求日均（与弹性引擎口径一致；直接对断面行求均值会按断面数稀释外送规模）。
    const latestSectionSum = (body: CapturedListEnvelope<YnForecastRow>): { date: string; avg: number | null } => {
      const rows = (Array.isArray(body?.data) ? body.data : []).filter(
        (r): r is YnForecastRow & { value: number } => typeof r.region === 'string' && r.region.includes('云南')
          && r.metric === 'inter_provincial_send' && typeof r.value === 'number'
      )
      const latest = rows.map(dayOf).filter(Boolean).sort().at(-1)
      if (!latest) return { date: '', avg: null }
      const byTime = new Map<string, number>()
      for (const r of rows) {
        if (dayOf(r) !== latest) continue
        byTime.set(String(r.timePoint), (byTime.get(String(r.timePoint)) ?? 0) + r.value)
      }
      const vals = [...byTime.values()]
      return { date: latest, avg: vals.length ? +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(0) : null }
    }
    const loadS = latestAvg(loadB, (r) => r.region === 'yn')
    const neS = latestAvg(neB, (r) => r.region === 'yn')
    const ipS = latestSectionSum(ipB)
    const date = loadS.date || neS.date || ipS.date
    disclosure.value = date ? { date, loadForecastMW: loadS.avg, newEnergyForecastMW: neS.avg, interProvincialMW: ipS.avg } : null
  } catch {
    if (seq === discReqSeq) disclosure.value = null // 真实或空：不合成
  } finally {
    if (seq === discReqSeq) disclosureLoading.value = false
  }
}

// 当日报价方案入口卡（bid_plans 流水线产出摘要，epic #336 PR-D）
// 有当日 ok 方案才显示（skipped/error/无方案不显示卡，避免首页噪音）；权限复用申报 copilot
// 细粒度路径；地区切换竞态守卫同披露侧卡（旧 Promise 不回写）。取数与归一在
// forecast 服务层（bidPlanClient），视图只管竞态与展示。
const bidPlan = ref<BidPlanSummary | null>(null)
let planReqSeq = 0
const canViewDeclaration = computed(() => canAccessPath('/xhjy/yunnan/declaration', currentUser.value))
// 嵌入式智能体仍复用 /ai-agent 路由的权限门控，避免 /dashboard 就地入口绕过守卫。
const canUseAgent = computed(() => canAccessPath('/ai-agent', currentUser.value))
const bidDialogOpen = ref(false)

async function loadBidPlanSummary() {
  if (!canViewDeclaration.value || currentRegion.value.id !== 'yunnan') { bidPlan.value = null; return }
  const seq = ++planReqSeq
  try {
    const summary = await fetchLatestBidPlanSummary(nextDeclarationTargetDate())
    if (seq !== planReqSeq || currentRegion.value.id !== 'yunnan') return
    bidPlan.value = summary
  } catch {
    if (seq === planReqSeq) bidPlan.value = null // 真实或空：agent-backend 离线不合成
  }
}

// 云南现货数据区仅云南有真实节点电价/损益/结算；非云南降级为空态卡（诚实标注，不伪装）。
const isYunnan = computed(() => currentRegion.value.id === 'yunnan')
// CGN 私有价判定收口到服务谓词（spot-trading-module-hygiene）：hasCgnYunnanPriceEntitlement
// 内部按「选中公司 || 登录账号」判定（公司切换/平台超管场景），替代本页 setup 时的
// 一次性 currentUser 快照口径——与 spotClient/SpotCockpitCore 的实际取数路径同源。
const cgnPriceEntitled = computed(() => hasCgnYunnanPriceEntitlement())
const usesCgnPrivatePrice = computed(() => isYunnan.value && cgnPriceEntitled.value)

// 地区扩展插槽（Epic #1431 S3）：内核只认插槽 id，不 import 任何具体省份的面板；
// 某省增删面板不触碰本文件。渲染前两道闸：能力放行（canAccessPath）+ 插槽有注册。
function regionSlot(slotId: RegionSlotId) {
  const registration = resolveRegionSlot(slotId, currentRegion.value.id)
  if (!registration) return null
  if (!registration.capabilityPath) return registration.component
  // 两道正交闸门缺一不可：
  // canAccessPath → 角色权限（RBAC）
  // isPathAvailableInRegion → 地区能力（hidden / not-configured 一律 fail-closed）
  // 只查前者时，ADMIN/BOSS 会绕过地区闸门；扩展包若把甲省 capabilityPath 误注册给乙省，
  // 也会在乙省渲染出本不该出现的面板。
  if (!canAccessPath(registration.capabilityPath, currentUser.value)) return null
  if (!isPathAvailableInRegion(registration.capabilityPath, currentRegion.value.id)) return null
  return registration.component
}
const elasticitySlot = computed(() => regionSlot('cockpit.elasticity'))
const spreadSlot = computed(() => regionSlot('cockpit.spread'))
const spotPnlSlot = computed(() => regionSlot('cockpit.spotPnl'))
const plantOutputSlot = computed(() => regionSlot('cockpit.plantOutput'))
const priceOutputLinkageSlot = computed(() => regionSlot('cockpit.priceOutputLinkage'))
const disclosureSlot = computed(() => regionSlot('cockpit.disclosure'))
// RBAC：SpotCockpitCore 复用 /xhjy/yunnan/cockpit 路径的权限门控，
// PLANT_OPERATOR/STORAGE_OPERATOR 等无该权限角色不可绕过路由直接在首页读取全市场数据。
const canViewCockpit = computed(() => canAccessPath('/xhjy/yunnan/cockpit', currentUser.value))

// 云南增强层 tab 门控（原工作台 7 个真实数据 tab，按各自权限路径过滤）
const canViewSpotPnL = computed(() => canAccessPath('/xhjy/yunnan/spot-pnl', currentUser.value))
const canViewElasticity = computed(() => canAccessPath('/xhjy/yunnan/elasticity', currentUser.value))
const canViewSpread = computed(() => canAccessPath('/xhjy/yunnan/spread', currentUser.value))
const canViewPlantOutput = computed(() => canAccessPath('/xhjy/yunnan/plant-output', currentUser.value))
const canViewPriceOutputLinkage = computed(() => canAccessPath('/xhjy/yunnan/price-output-linkage', currentUser.value))

type TabKey = 'price' | 'cockpit' | 'spot-pnl' | 'plant-output' | 'price-output-linkage' | 'elasticity' | 'spread' | 'disclosure'
type TabItem = { key: TabKey; label: string; allowed: boolean }
type TabGroup = { group: string; items: TabItem[] }

// 三组 IA 固定可见，路径门控仍由 canAccessPath 负责；非云南的云南专项 tab 显示诚实空态。
// 原「总览」tab 已并入「实时价格」（KPI 摘要 + 主图 + 决策卡 + 智能体分栏同屏），?tab=overview 深链回落到 price。
const tabGroups = computed<TabGroup[]>(() => {
  return [
    {
      group: '决策总览',
      items: [
        { key: 'price', label: '实时价格', allowed: true },
        { key: 'cockpit', label: '现货驾驶舱', allowed: canViewCockpit.value }
      ]
    },
    {
      group: '现货分析',
      items: [
        { key: 'elasticity', label: '价格弹性', allowed: canViewElasticity.value },
        { key: 'spread', label: '日前-实时价差', allowed: canViewSpread.value },
        { key: 'spot-pnl', label: '损益归因', allowed: canViewSpotPnL.value },
        { key: 'plant-output', label: '电厂出力', allowed: canViewPlantOutput.value },
        { key: 'price-output-linkage', label: '电价×出力', allowed: canViewPriceOutputLinkage.value }
      ]
    },
    { group: '整年数据', items: [{ key: 'disclosure', label: '披露明细', allowed: canViewDisclosure.value }] }
  ]
})

const tabs = computed<TabItem[]>(() => tabGroups.value.flatMap((g) => g.items))

const VALID_TABS: TabKey[] = ['price', 'cockpit', 'spot-pnl', 'plant-output', 'price-output-linkage', 'elasticity', 'spread', 'disclosure']

// /dashboard?tab=xxx 预选 tab（旧工作台 alias redirect 带此 query 落地，保深链/收藏夹直达目标 tab）。
// 已下架的 ?tab=overview 不在 VALID_TABS 内，自然回落到默认 price（总览内容已并入该 tab）。
function tabFromQuery(q: unknown): TabKey {
  const k = typeof q === 'string' ? q : ''
  return (VALID_TABS as string[]).includes(k) ? (k as TabKey) : 'price'
}

const activeTab = ref<TabKey>('price')

function ensureTabAllowed() {
  // 当前角色无当前 tab 权限时，回退到首个可用 tab；云南以外的专项 tab 仍可见但不阻断实时价格。
  if (!tabs.value.some((tab) => tab.key === activeTab.value && tab.allowed)) {
    activeTab.value = tabs.value.find((tab) => tab.allowed)?.key ?? 'price'
  }
}

function goTab(key: TabKey) {
  // tab 切换为纯前端状态，不改 URL（URL ?tab= 仅落地预选用）。
  if (tabs.value.some((tab) => tab.key === key && tab.allowed)) activeTab.value = key
}

watch(() => route.query.tab, (q) => {
  activeTab.value = tabFromQuery(q)
  ensureTabAllowed()
}, { immediate: true })

function onGovernanceUserChanged(event: Event) {
  currentUser.value = (event as CustomEvent<AuthUser>).detail ?? getCurrentUser()
  ensureTabAllowed()
  reloadForGovernanceUser()
}

// 智能体对话框在「实时价格」tab 右栏常驻（左栏侧边栏承载全部动作按钮），不再由点击惰性展开。
function formatPlanNumber(value: number | null, digits = 1): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits)
}

function riskLevelLabel(level: string): string {
  return ({ aggressive: '激进档', neutral: '中性档', conservative: '保守档' } as Record<string, string>)[level] ?? level
}

// 交易日程（D-1 申报日动线，时刻可按本省规则调整）
type Phase = { id: string; label: string; from: number; to: number; hint: string }
const PHASES: Phase[] = [
  { id: 'intel', label: '情报收集', from: 0, to: 9, hint: '查看披露：负荷/新能源预测、检修与联络线计划' },
  { id: 'strategy', label: '策略制定', from: 9, to: 10.5, hint: '竞价空间测算、价格预测、敞口核对、形成申报曲线' },
  { id: 'declare', label: '申报窗口', from: 10.5, to: 11, hint: '交易平台录入并提交申报（截止 11:00）' },
  { id: 'waiting', label: '等待出清', from: 11, to: 17, hint: '日内复盘 / 次日中长期操作' },
  { id: 'review', label: '出清复核', from: 17, to: 24, hint: '核对中标曲线与出清价，预估实时偏差敞口' }
]

const now = ref(new Date())
let clock: number | undefined

const currentPhase = computed(() => {
  const h = now.value.getHours() + now.value.getMinutes() / 60
  return PHASES.find((p) => h >= p.from && h < p.to) ?? PHASES[0]
})
const countdown = computed(() => {
  const h = now.value.getHours() + now.value.getMinutes() / 60
  const minutes = Math.max(0, Math.round((currentPhase.value.to - h) * 60))
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60}m` : `${minutes}m`
})

// 价格主图：云南中广核为今日日前 vs 实时；其他地区保留昨日出清 vs 今日预测
const chartEl = ref<HTMLElement | null>(null)
const priceChart = useEChart(chartEl, { render: () => { void renderChart() } })
const isDemo = ref(false)
// 决策口径（trustGate）：主图两条曲线（昨日出清 + 今日预测）取最弱 basis →
// TrustBadge 显 operational/advisory_only，让通用区 KPI 一眼见「能否进决策」。
const priceBasis = ref<DataBasis>('captured')
// 真实曲线的源粒度（#1459）：山西逐日切片只有 24 点（即 96 点曲线的逐小时均值），
// 按阶梯展开到 96 点后形态仍是小时级，须在图头标注，避免被读成 15 分钟分辨率。
const hourlySourced = ref(false)
const stats = ref<{ mean: number | null; spread: number | null; max: number | null; min: number | null }>({
  mean: null, spread: null, max: null, min: null
})
const cgnPriceBundle = ref<CgnYunnanPriceBundle | null>(null)
const priceError = ref('')
let priceTimer: number | undefined

// 通用路径的图标题带上**实际画的那一天**：云南价格受上游发布节奏限制恒滞后数日，
// 写死「今日」会让人把几天前的行情当成今天的（#2392）。
const pricePanelDate = ref('')
const priceChartTitle = computed(() => usesCgnPrivatePrice.value
  ? '现货价格 · 今日日前 vs 今日实时'
  : `现货价格 · ${pricePanelDate.value || '—'} 实况 vs 模型预测`)
// 真实曲线的口径名由取数层给：云南是「日前用户侧电价」、山西是交易中心「实际出清」，
// 两者口径不同却共用一个图例名就是误导。
const clearingLabel = ref('实际出清')
const priceLegend = computed<[string, string]>(() => usesCgnPrivatePrice.value
  ? ['今日日前', '今日实时']
  : [clearingLabel.value, '模型预测'])

function reloadForGovernanceUser() {
  // 账号切换必须先让旧集团数据立即离开页面，再以新令牌重取；请求失败时保持空态。
  chartSeq += 1
  cgnPriceBundle.value = null
  stats.value = { mean: null, spread: null, max: null, min: null }
  hourlySourced.value = false
  isDemo.value = false
  priceError.value = ''
  priceChart.setOption({ ...emptyOverlay(true), series: [] }, { replaceMerge: ['series', 'graphic'] })
  void loadDisclosureSummary()
  void loadBidPlanSummary()
  void renderChart()
}

function formatStat(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '—' : String(value)
}

function fmtDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

// 价格曲线世代守卫：切地区/重复刷新期间旧 Promise 不得回写 setOption（参照 discReqSeq/planReqSeq 范式，#1742）
let chartSeq = 0
async function renderChart() {
  const seq = ++chartSeq
  priceChart.showLoading()
  priceError.value = ''
  try {
    const today = new Date()
    let firstPoints: Array<{ time: string; value: number | null }>
    let secondPoints: Array<{ time: string; value: number | null }>

    if (usesCgnPrivatePrice.value) {
      const bundle = await fetchCgnYunnanPriceBundle(fmtDate(today))
      if (seq !== chartSeq) return
      cgnPriceBundle.value = bundle
      isDemo.value = false
      priceBasis.value = 'real'
      const intervals = [...bundle.node.dayAhead, ...bundle.node.realTime].map((p) => p.interval)
      hourlySourced.value = intervals.length > 0 && intervals.every((value) => value === '1h')
      firstPoints = bundle.node.dayAhead.map((point: CgnPricePoint) => ({ time: point.time, value: point.price }))
      secondPoints = bundle.node.realTime.map((point: CgnPricePoint) => ({ time: point.time, value: point.price }))
      const realtimeStats = curveStats(secondPoints.filter((point): point is { time: string; value: number } => point.value != null))
      stats.value = secondPoints.length ? realtimeStats : { mean: null, spread: null, max: null, min: null }
      if (bundle.availability === 'unavailable') priceError.value = '该日尚无中广核云南厂侧节点电价'
      else if (bundle.freshness === 'stale') priceError.value = '厂侧价格已过期，请检查实时轮询进程'
      else if (bundle.availability === 'partial') priceError.value = '日前或实时价格部分缺失'
    } else {
      cgnPriceBundle.value = null
      // 画哪一天由**真实覆盖区间**决定，不再写死「今天」：云南价格受上游发布节奏限制恒滞后
      // 数日（今天 08-22 时节点电价最新到 08-18），钉在今天就永远落在无数据的日期上——
      // 此前正是因此长期显示 synth96 合成的假曲线与编造的 KPI。
      const region = currentRegion.value.id
      // 覆盖带兜底（现货审计二轮 S1）：云南价格数据集 region='all' 缺席覆盖接口，
      // 原实现拿 null → 日期钉今天 → 山西/云南非厂侧账号首屏恒空图
      const coverage = await fetchCaptureCoverageWithFallback(region, 'clearing')
      const date = resolvePanelDate(fmtDate(today), coverage)
      const [clearing, forecast] = await Promise.all([
        fetchClearingPrice(region, date),
        fetchLatestForecast(region, 'price', date)
      ])
      if (seq !== chartSeq) return // 期间切了地区/重渲染 → 丢弃旧曲线
      const panel = buildPricePanel({ date, coverage, clearing, forecast })
      pricePanelDate.value = date
      clearingLabel.value = clearing.label
      isDemo.value = false
      hourlySourced.value = panel.hourlySourced
      stats.value = panel.stats
      priceBasis.value = panel.basis
      priceError.value = panel.error
      firstPoints = panel.realPoints
      secondPoints = panel.forecastPoints
    }
    if (!chartEl.value) return
    const times = [...new Set([...firstPoints.map((point) => point.time), ...secondPoints.map((point) => point.time)])].sort()
    const firstByTime = new Map(firstPoints.map((point) => [point.time, point.value]))
    const secondByTime = new Map(secondPoints.map((point) => [point.time, point.value]))
    priceChart.setOption({
      ...emptyOverlay(!firstPoints.length && !secondPoints.length),
      tooltip: axisTooltip({ unit: '元/MWh', digits: 1 }),
      // 底部布局:工具栏右下角,图例顶部居中 scroll
      legend: bottomLayoutLegend({ data: priceLegend.value }),
      toolbox: bottomToolbox('现货价格对比', 8),
      // grid.bottom 调到 56：视觉上工具栏图标顶距 x 轴刻度文字约 2px（经浏览器 HMR 实测确认）。
      grid: { left: 48, right: 16, top: 48, bottom: 56 },
      dataZoom: insideZoom(),
      xAxis: { type: 'category', data: times },
      yAxis: { type: 'value', scale: true, name: '元/MWh' },
      series: [
        {
          name: priceLegend.value[0],
          type: 'line',
          showSymbol: false,
          data: times.map((time) => firstByTime.get(time) ?? null),
          lineStyle: { width: 1.4, opacity: 0.7 }
        },
        {
          name: priceLegend.value[1],
          type: 'line',
          showSymbol: false,
          data: times.map((time) => secondByTime.get(time) ?? null),
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.08 }
        }
      ]
    }, { replaceMerge: ['graphic'] }) // 空态 graphic 需整组替换才能在有数据时清掉
  } catch (e) {
    console.error('[TradingCockpit] 行情图加载失败:', e)
    if (seq === chartSeq) {
      cgnPriceBundle.value = null
      stats.value = { mean: null, spread: null, max: null, min: null }
      hourlySourced.value = false
      isDemo.value = false
      priceBasis.value = 'illustrative'
      priceError.value = e instanceof Error ? e.message : '实时价格加载失败'
      priceChart.setOption({ ...emptyOverlay(true), series: [] }, { replaceMerge: ['series', 'graphic'] })
    }
  } finally {
    if (seq === chartSeq) priceChart.hideLoading()
  }
}

function startPriceRefresh() {
  window.clearInterval(priceTimer)
  priceTimer = window.setInterval(() => {
    if (activeTab.value === 'price') void renderChart()
  }, 60_000)
}

// 明日日期：快捷动作「生成明日申报草稿」插入问题（快捷动作本身见 CockpitQuickActions）
const tomorrow = computed(() => fmtDate(new Date(Date.now() + 86400000)))

onMounted(() => {
  window.addEventListener('governance-user-changed', onGovernanceUserChanged)
  void loadDisclosureSummary()
  void loadBidPlanSummary()
  renderChart()
  startPriceRefresh()
  clock = window.setInterval(() => (now.value = new Date()), 30_000)
})
// 切换全局地区时重渲染价格曲线（昨日出清/今日预测经 spotPrice→fetchCaptured 已按地区回放）
onRegionChange(() => {
  void loadDisclosureSummary()
  void loadBidPlanSummary()
  renderChart()
})
// 切换公司：中广核厂侧私有价格授权（usesCgnPrivatePrice 等标签层）随 selectedCompanyId
// 立即翻转，但数据层若不重载会混源——KPI 口径与标签不符，最长滞留一个 60s 轮询周期。
// 镜像 onRegionChange 的重载面（其余页面均有此 watch，本页此前漏接）。
watch(selectedCompanyId, () => {
  void loadDisclosureSummary()
  void loadBidPlanSummary()
  renderChart()
})
// ECharts 在非激活 tab 中没有可见尺寸；切入实时价格后补一帧 resize 并重渲染。
watch(activeTab, (tab) => {
  if (tab !== 'price') return
  void nextTick(() => {
    priceChart.resize()
    void renderChart()
  })
})
// keep-alive：切走暂停 30s 日程时钟，切回先校准当前时间再恢复
onActivated(() => {
  window.clearInterval(clock)
  now.value = new Date()
  clock = window.setInterval(() => (now.value = new Date()), 30_000)
  startPriceRefresh()
})
onDeactivated(() => {
  window.clearInterval(clock)
  window.clearInterval(priceTimer)
})
onBeforeUnmount(() => {
  window.clearInterval(clock)
  window.clearInterval(priceTimer)
  window.removeEventListener('governance-user-changed', onGovernanceUserChanged)
})
</script>

<template>
  <div class="cockpit page-stack">
    <!-- 持久顶栏：地区口径、日内相位和云南规则状态跨 tab 常驻。 -->
    <div class="persistent-header">
      <RegionDataBanner />
      <section class="panel schedule">
        <div class="schedule-track">
          <div
            v-for="p in PHASES"
            :key="p.id"
            class="phase"
            :class="{ active: p.id === currentPhase.id, urgent: p.id === 'declare' && currentPhase.id === 'declare' }"
          >
            <span class="phase-label">{{ p.label }}</span>
            <span class="phase-time">{{ String(Math.floor(p.from)).padStart(2, '0') }}:{{ p.from % 1 ? '30' : '00' }}</span>
          </div>
        </div>
        <div class="schedule-now">
          <AlarmClock :size="15" />
          <b>{{ currentPhase.label }}</b>
          <span class="muted">{{ currentPhase.hint }}</span>
          <span class="countdown">距下一阶段 {{ countdown }}</span>
        </div>
      </section>
      <section v-if="isYunnan" class="rule-strip panel">
        <label class="scenario-picker">
          <span><CalendarClock :size="14" /> 规则场景 / 月份</span>
          <el-select v-model="selectedScenarioId">
            <el-option
              v-for="scenario in yunnanScenarios"
              :key="scenario.id"
              :label="`${scenario.month} · ${scenario.name}`"
              :value="scenario.id"
            />
          </el-select>
          <small>{{ selectedScenario.ruleVersion }}</small>
        </label>
        <div class="verify-chips">
          <span class="ok"><BadgeCheck :size="14" /> 已核验 {{ verification.verified }}</span>
          <span class="warn"><ShieldAlert :size="14" /> 待核验 {{ verification.pending }}</span>
          <span class="frozen">不固化 {{ verification.frozen }}</span>
        </div>
      </section>
    </div>

    <nav v-if="tabs.length" class="tab-bar" aria-label="现货交易驾驶舱分组导航">
      <div v-for="group in tabGroups" :key="group.group" class="tab-group">
        <span class="tab-group-label">{{ group.group }}</span>
        <div class="tab-group-items">
          <button
            v-for="tab in group.items"
            :key="tab.key"
            type="button"
            class="tab-button"
            :class="{ active: activeTab === tab.key, locked: !tab.allowed }"
            :disabled="!tab.allowed"
            :aria-disabled="!tab.allowed"
            @click="goTab(tab.key)"
          >
            {{ tab.label }}<span v-if="!tab.allowed" class="tab-lock">无权限</span>
          </button>
        </div>
      </div>
    </nav>

    <!-- 实时价格（原「总览」已整体并入本 tab）：KPI 摘要 → 价格主图 → 决策卡 → 底部智能体分栏。
         KPI 只复用 renderChart 的 stats，不为其追加 cockpitData 请求；激活时补 resize/重渲染。 -->
    <section v-if="activeTab === 'price'" class="price-content">
      <div v-if="isYunnan" class="overview-identity">
        <Landmark :size="15" />
        <span>云南 · 南方电网 · {{ roleLabel }}</span>
        <span>·</span>
        <span>{{ subjectLabel }} · {{ currentUser.subjectName }}</span>
        <el-tag size="small" type="success">{{ yunnanProfile.marketStage }}</el-tag>
      </div>
      <div class="overview-kpis" aria-label="实时价格摘要">
        <div><span>{{ usesCgnPrivatePrice ? '实时均价' : '出清均价' }}</span><b>{{ formatStat(stats.mean) }}</b><small>元/MWh</small></div>
        <div><span>峰谷价差</span><b>{{ formatStat(stats.spread) }}</b><small>元/MWh</small></div>
        <div><span>{{ usesCgnPrivatePrice ? '实时最高' : '出清最高' }}</span><b>{{ formatStat(stats.max) }}</b><small>元/MWh</small></div>
        <div><span>{{ usesCgnPrivatePrice ? '实时最低' : '出清最低' }}</span><b>{{ formatStat(stats.min) }}</b><small>元/MWh</small></div>
      </div>

      <section class="panel chart-panel">
        <div class="panel-head">
          <h2><LineChart :size="16" /> {{ priceChartTitle }}</h2>
          <span v-if="isDemo" class="demo-tag">演示数据</span>
          <span v-if="hourlySourced" class="demo-tag" title="该地区逐日采集切片只有 24 点（96 点曲线的逐小时均值），已按阶梯展开到 96 点，不代表 15 分钟分辨率">小时级来源</span>
          <TrustBadge :basis="priceBasis" prefix="决策口径" />
          <button
            class="price-refresh"
            type="button"
            :title="usesCgnPrivatePrice ? '立即读取 PostgreSQL latest 价格' : '立即刷新价格'"
            @click="renderChart"
          >
            <RefreshCw :size="13" /> 立即刷新
          </button>
        </div>
        <CgnYunnanPriceStatus v-if="usesCgnPrivatePrice" :bundle="cgnPriceBundle" />
        <p v-if="isYunnan && !cgnPriceEntitled" class="price-error">
          当前账号不属于中广核云南集团；不会请求中广核厂侧专属价格链路，页面按当前账号的数据路由展示。
        </p>
        <p v-if="priceError" class="price-error">
          {{ priceError }}<template v-if="usesCgnPrivatePrice">；不会回退其他集团、公共回放或模拟价格。</template>
        </p>
        <div ref="chartEl" class="main-chart chart-host" />
      </section>

      <div class="overview-grid">
        <section class="panel overview-card">
          <div class="panel-head"><h2><FileSearch :size="15" /> 市场披露摘要</h2></div>
          <template v-if="disclosure">
            <div class="disc-rows">
              <div class="disc-row"><span>披露日</span><b>{{ disclosure.date }}</b></div>
              <div class="disc-row"><span>统调负荷预测(云南·日均)</span><b>{{ disclosure.loadForecastMW ?? '—' }} MW</b></div>
              <div class="disc-row"><span>新能源预测(D-1·日均)</span><b>{{ disclosure.newEnergyForecastMW ?? '—' }} MW</b></div>
              <div class="disc-row"><span>云南总送出预测(日均)</span><b>{{ disclosure.interProvincialMW ?? '—' }} MW</b></div>
            </div>
            <p class="muted disc-src">源：南网官方披露（真实回放）；明细见「披露明细」标签页。</p>
          </template>
          <p v-else-if="!canViewDisclosure" class="muted">当前角色无披露数据权限。</p>
          <!-- 空态拆两支：云南本区缺数 vs 非云南无数据源；共用一句「云南地区展示…」会被误读成选山西却在报云南 -->
          <p v-else-if="disclosureLoading" class="muted">读取披露…</p>
          <p v-else-if="isYunnan" class="muted">云南暂无披露数据（缺数据时为空，不合成）。</p>
          <p v-else class="muted">披露关键数仅接云南披露源（南网官方披露，真实回放）；{{ currentRegion.shortName }}地区无对应数据源，保持空态不合成。</p>
        </section>

        <section class="panel overview-card">
          <div class="panel-head"><h2><ClipboardCheck :size="15" /> 当日报价方案</h2></div>
          <template v-if="bidPlan">
            <div class="disc-rows">
              <div class="disc-row"><span>目标日</span><b>{{ bidPlan.targetDate }}</b></div>
              <div class="disc-row"><span>价格模型</span><b>{{ bidPlan.priceModel }}</b></div>
              <div class="disc-row"><span>中性档申报电量</span><b>{{ bidPlan.declaredMwh == null ? '—' : bidPlan.declaredMwh.toFixed(0) }} MWh</b></div>
              <div class="disc-row"><span>风险档位</span><b>λ ∈ {{ bidPlan.lambdas.join(' / ') }}</b></div>
            </div>
            <p v-if="bidPlan.mock" class="muted disc-mock">⚠ 结算系数为 mock 占位（{{ bidPlan.mockFields.join('、') || '云南系数未确认' }}），金额口径为估算。</p>
            <p class="muted disc-src">{{ bidPlan.basisNote }}（{{ bidPlan.planId }}）。</p>
          </template>
          <p v-else class="muted">暂无当日可用的报价方案（报价服务离线或当日未生成时保持空态）。</p>
        </section>
      </div>

      <!-- 快捷动作：点击唤出 AI 侧边栏直接发送（统一 AI 侧边栏 EN-03，原内嵌对话卡已移除） -->
      <CockpitQuickActions
        :can-use-agent="canUseAgent"
        :tomorrow="tomorrow"
        :has-bid-plan="!!bidPlan"
        @open-bid-plan="bidDialogOpen = true"
      />
    </section>

    <SpotCockpitCore
      v-else-if="activeTab === 'cockpit' && isYunnan && canViewCockpit"
      embedded
      :region-name="currentRegion.shortName"
      :region-id="currentRegion.id"
      title="现货交易驾驶舱 · 云南数据区"
    />
    <component :is="elasticitySlot" v-else-if="activeTab === 'elasticity' && elasticitySlot" />
    <component :is="spreadSlot" v-else-if="activeTab === 'spread' && spreadSlot" />
    <component :is="spotPnlSlot" v-else-if="activeTab === 'spot-pnl' && spotPnlSlot" />
    <component :is="plantOutputSlot" v-else-if="activeTab === 'plant-output' && plantOutputSlot" />
    <component :is="priceOutputLinkageSlot" v-else-if="activeTab === 'price-output-linkage' && priceOutputLinkageSlot" />
    <component :is="disclosureSlot" v-else-if="activeTab === 'disclosure' && disclosureSlot" />
    <CockpitRegionLockedCard v-else />

    <el-dialog v-model="bidDialogOpen" title="申报决策舱 · 报价方案明细" width="920px" append-to-body>
      <template v-if="bidPlan">
        <div class="plan-meta">
          <span>目标日：<b>{{ bidPlan.targetDate }}</b></span>
          <span>价格模型：<b>{{ bidPlan.priceModel }}</b></span>
          <span>方案：<b>{{ bidPlan.planId }}</b></span>
        </div>
        <p v-if="bidPlan.mock" class="plan-warning">⚠ 结算系数为 mock 占位（{{ bidPlan.mockFields.join('、') || '云南系数未确认' }}），金额口径为估算。</p>
        <p class="muted plan-basis">{{ bidPlan.basisNote }}；本弹层只读展示，不执行申报。</p>
        <el-table :data="bidPlan.frontier" border stripe size="small" class="frontier-table">
          <el-table-column prop="risk_level" label="风险档" min-width="92">
            <template #default="scope">{{ riskLevelLabel(scope.row.risk_level) }}</template>
          </el-table-column>
          <el-table-column prop="lambda" label="λ" width="70" />
          <el-table-column label="申报电量 (MWh)" min-width="130">
            <template #default="scope">{{ formatPlanNumber(scope.row.total_declared_mwh, 3) }}</template>
          </el-table-column>
          <el-table-column label="期望收益 (元)" min-width="125">
            <template #default="scope">{{ formatPlanNumber(scope.row.expected_profit_yuan) }}</template>
          </el-table-column>
          <el-table-column label="期望罚款 (元)" min-width="125">
            <template #default="scope">{{ formatPlanNumber(scope.row.expected_penalty_yuan) }}</template>
          </el-table-column>
          <el-table-column label="VaR / CVaR (元)" min-width="150">
            <template #default="scope">{{ formatPlanNumber(scope.row.var_loss_yuan) }} / {{ formatPlanNumber(scope.row.cvar_loss_yuan) }}</template>
          </el-table-column>
        </el-table>
      </template>
    </el-dialog>

  </div>
</template>

<style scoped>
.cockpit { gap: 14px; }
.muted { color: var(--muted); font-size: var(--font-12-5); }
.persistent-header { display: flex; flex-direction: column; gap: 10px; }
.schedule { padding: 12px 16px; }
.schedule-track { display: flex; gap: 6px; }
.phase { flex: 1; text-align: center; padding: 7px 4px; border-radius: 8px; border: 1px solid var(--line); opacity: 0.55; }
.phase.active { opacity: 1; border-color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, transparent); }
.phase.urgent { animation: cockpit-urgent 1.2s ease-in-out infinite; }
@keyframes cockpit-urgent { 0%, 100% { box-shadow: none; } 50% { box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.25); border-color: #ef4444; } }
.phase-label { display: block; font-size: var(--font-md); font-weight: 600; }
.phase-time { font-size: var(--font-xs); color: var(--muted); }
.schedule-now { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: var(--font-md); }
.countdown { margin-left: auto; font-weight: 700; color: var(--primary); font-variant-numeric: tabular-nums; }
.rule-strip { display: flex; align-items: center; gap: 14px; padding: 10px 14px; }
.scenario-picker { display: flex; align-items: center; gap: 8px; min-width: min(100%, 430px); }
.scenario-picker span { display: inline-flex; align-items: center; gap: 6px; color: var(--text-body); font-size: var(--font-md); font-weight: 650; white-space: nowrap; }
.scenario-picker .el-select { width: 220px; }
.scenario-picker small { color: var(--muted); line-height: 1.5; white-space: nowrap; }
.verify-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.verify-chips span { display: inline-flex; align-items: center; gap: 5px; padding: 6px 10px; border-radius: 6px; font-size: var(--font-sm); font-weight: 600; }
.verify-chips .ok { background: var(--primary-tint); color: var(--primary); }
.verify-chips .warn { background: var(--warning-tint); color: var(--warning); }
.verify-chips .frozen { background: var(--el-fill-color-light); color: var(--muted); }
.tab-bar { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px 18px; margin: 2px 0 0; }
.tab-group { display: flex; flex-direction: column; gap: 6px; padding-right: 18px; border-right: 1px solid var(--line); }
.tab-group:last-child { padding-right: 0; border-right: none; }
.tab-group-label { font-size: var(--font-xs); font-weight: 700; letter-spacing: 0.06em; color: var(--muted); }
.tab-group-items { display: flex; flex-wrap: wrap; gap: 8px; }
.tab-button { padding: 9px 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--text-body); font-size: var(--font-md); font-weight: 650; cursor: pointer; }
.tab-button:hover:not(:disabled):not(.active) { border-color: var(--primary); color: var(--primary); }
.tab-button.active { border-color: var(--primary); background: var(--primary); color: #fff; }
.tab-button.locked { color: var(--muted); cursor: not-allowed; opacity: 0.7; }
.tab-lock { display: block; margin-top: 2px; font-size: var(--font-10); font-weight: 500; }
.price-content { display: flex; flex-direction: column; gap: 12px; }
.overview-identity { display: flex; align-items: center; gap: 7px; min-height: 28px; color: var(--muted); font-size: var(--font-12-5); }
.overview-identity svg { color: var(--primary); }
.overview-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.overview-kpis > div { display: flex; align-items: baseline; gap: 7px; padding: 11px 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
.overview-kpis span { color: var(--muted); font-size: var(--font-sm); }
.overview-kpis b { margin-left: auto; color: var(--text); font-size: var(--font-18); font-variant-numeric: tabular-nums; }
.overview-kpis small { color: var(--muted); font-size: var(--font-10); white-space: nowrap; }
.overview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.overview-card { min-height: 190px; padding: 14px 16px; }
.panel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.panel-head h2 { display: flex; align-items: center; gap: 6px; font-size: var(--font-lg); margin: 0; }
.panel-head > .muted { margin-left: auto; }
.disc-rows { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 8px; }
.disc-row { display: flex; justify-content: space-between; gap: 8px; font-size: var(--font-12-5); color: var(--text-2, #6b7a85); }
.disc-row b { color: var(--text, #22323c); font-variant-numeric: tabular-nums; }
.disc-src { font-size: var(--font-11-5); }
.disc-mock, .plan-warning { color: #b45309; }
.chart-panel { padding: 14px 16px; }
.demo-tag { font-size: var(--font-xs); padding: 1px 8px; border-radius: 999px; background: rgba(245, 158, 11, 0.15); color: #b45309; }
.price-refresh { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 7px; background: transparent; color: var(--text); cursor: pointer; }
.price-refresh:hover { border-color: var(--primary); color: var(--primary); }
.price-error { margin: 6px 0 0; color: var(--warning); font-size: var(--font-sm); }
.main-chart { width: 100%; height: 420px; }
.plan-meta { display: flex; flex-wrap: wrap; gap: 18px; margin-bottom: 8px; color: var(--muted); font-size: var(--font-md); }
.plan-meta b { color: var(--text); }
.plan-basis { margin: 6px 0 14px; }
.frontier-table { width: 100%; }
@media (max-width: 900px) { .overview-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .rule-strip { align-items: flex-start; flex-direction: column; } .scenario-picker { width: 100%; } }
@media (max-width: 768px) { .schedule-track { flex-wrap: wrap; } .phase { flex: 1 1 30%; } .schedule-now { flex-wrap: wrap; } .countdown { margin-left: 0; } .panel-head { flex-wrap: wrap; } .overview-grid { grid-template-columns: 1fr; } .overview-kpis > div { flex-wrap: wrap; } .overview-kpis b { margin-left: 0; } .scenario-picker { align-items: flex-start; flex-wrap: wrap; } .scenario-picker .el-select { width: min(100%, 280px); } .main-chart { height: 360px; } }
</style>
