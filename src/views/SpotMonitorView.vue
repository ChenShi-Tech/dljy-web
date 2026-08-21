<script setup lang="ts">
// 实时监盘（/xhjy/monitor，D 日动线）：实时 vs 日前价差、异动预警、AI 异动解读。
// 云南中广核账号使用厂侧私有 PostgreSQL 实时价；其他地区仍按各自 serving route 回放。
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { Activity, BellRing, RefreshCw } from 'lucide-vue-next'
import AgentSidekick from '../components/agent/AgentSidekick.vue'
import { useEChart } from '../composables/useEChart'
import { useQuerySync } from '../composables/useQuerySync'
import { axisTooltip, chartToolbox, emptyOverlay, insideZoom } from '@/services/chart/chartOptions'
import { fetchMonitor, type MonitorResult } from '@/services/quant/quantClient'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import CgnYunnanPriceStatus from '@/components/spot/CgnYunnanPriceStatus.vue'
import { currentRegion } from '@/services/region/regionContext'
import { getCurrentUser, type AuthUser } from '@/services/auth'
import { isCgnYunnanPriceCompany } from '@/services/market/cgnYunnanLivePrice'
import { clampToCoverage, fetchCaptureCoverage, isOutOfCoverage } from '@/services/market/captureCoverage'
import {
  allowsDualPriceSeries,
  granularityBadgeText,
  priceBasisBadgeText,
  resolveMechanismProfile
} from '@/services/region/mechanismProfile'

function shanghaiToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

// 其他地区是静态历史批次，默认日期直接钳进各自覆盖范围。
// 云南先落今天，挂载后由 syncCoverageDefault() 用后端实时区间校正——它的价格数据受
// 上游发布节奏限制恒滞后数日（#2375 实测日前 3 天、实时 5 天），把「今天」当默认会让
// 首屏必然空态，用户每次都得手动往前翻。只钳默认值，不限制用户手选日期。
const date = ref(
  currentRegion.value.id === 'yunnan'
    ? shanghaiToday()
    : clampToCoverage(currentRegion.value.id, 'price', shanghaiToday())
)
const threshold = ref(80)
const autoRefresh = ref(true)
const loading = ref(false)
const error = ref('')
const result = ref<MonitorResult | null>(null)
const lastUpdated = ref('')
const currentUser = ref<AuthUser>(getCurrentUser())
const cgnPriceEntitled = computed(() => isCgnYunnanPriceCompany(currentUser.value.companyId))

const chartEl = ref<HTMLElement | null>(null)
const priceChart = useEChart(chartEl, { render: renderChart })
let timer: number | undefined
let loadSeq = 0

// 市场机制画像（Epic #1431 S2）：口径与粒度不再按后端字符串硬编码判断，改由
// serving-route 路由声明 ⊕ 结算规则逐字段溯源派生。两条渲染规矩由此生效：
//   ① daRtSeparated=false 或 unknown（机制上 da/rt 未分离/未登记）→ 只画单线，不伪造双线信息量
//      （#1531 起山西也是真分价，注册表里已无 false 实例；规矩本身对新地区仍然生效）
//   ② 原生粒度 ≠ 服务粒度（云南 24 点→96 点）→ 常驻粒度角标
const mechanism = computed(() => resolveMechanismProfile(currentRegion.value.id, 'clearing_price'))
const usesCgnPrivatePrice = computed(() => (
  currentRegion.value.id === 'yunnan' && result.value?.source === 'cgn_yunnan_private_pg'
))
const dualPriceSeries = computed(() => usesCgnPrivatePrice.value || allowsDualPriceSeries(mechanism.value))
const priceBasisText = computed(() => (
  usesCgnPrivatePrice.value ? '中广核云南·日前/实时厂侧价' : priceBasisBadgeText(mechanism.value)
))
const granularityText = computed(() => {
  if (!usesCgnPrivatePrice.value) return granularityBadgeText(mechanism.value)
  const interval = result.value?.cgn_price_bundle?.node.realTime[0]?.interval
    ?? result.value?.cgn_price_bundle?.node.dayAhead[0]?.interval
  return interval ? `原生 ${interval}` : ''
})

// 监盘日期/异动阈值 ⇄ 路由 query：刷新或分享链接后筛选状态可还原
useQuerySync({ date, threshold })

const sidekick = ref<InstanceType<typeof AgentSidekick> | null>(null)

const chips = computed(() => [
  {
    label: '今日整体偏离评估',
    question: `评估 ${date.value} 实时价相对日前价的整体偏离：方向、幅度、主要时段，并解释可能驱动因素`
  },
  {
    label: '峰谷价差解读',
    question: `解读 ${date.value} 的峰谷价差水平（峰均 ${result.value?.peak_valley.avg_price.peak ?? '-'} / 谷均 ${result.value?.peak_valley.avg_price.valley ?? '-'} 元/MWh），与近期相比处于什么水位`
  }
])

function explainAlert(time: string, spread: number) {
  sidekick.value?.ask(
    `解读 ${date.value} ${time} 时段的价差异动：实时较日前${spread > 0 ? '高' : '低'} ${Math.abs(spread).toFixed(1)} 元/MWh，分析可能原因（负荷/新能源/检修等）与应对`
  )
}

async function load() {
  const seq = ++loadSeq
  loading.value = true
  priceChart.showLoading()
  error.value = ''
  try {
    const next = await fetchMonitor(date.value, threshold.value)
    if (seq !== loadSeq) return
    result.value = next
    lastUpdated.value = result.value.latest_at
      ? new Date(result.value.latest_at).toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
      : new Date().toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
    await nextTick()
    renderChart()
  } catch (e) {
    if (seq !== loadSeq) return
    result.value = null
    lastUpdated.value = ''
    error.value = e instanceof Error ? e.message : '加载失败'
    priceChart.setOption(emptyOverlay(true), { replaceMerge: ['graphic', 'series'] })
  } finally {
    if (seq === loadSeq) {
      loading.value = false
      priceChart.hideLoading()
    }
  }
}

function reloadForIdentity(event: Event) {
  currentUser.value = (event as CustomEvent<AuthUser>).detail ?? getCurrentUser()
  result.value = null
  lastUpdated.value = ''
  priceChart.setOption(emptyOverlay(true), { replaceMerge: ['graphic', 'series'] })
  void load()
}

function renderChart() {
  const r = result.value
  if (!r || !chartEl.value) return
  priceChart.setOption({
    ...emptyOverlay(!r.series.length),
    tooltip: axisTooltip({ unit: '元/MWh', digits: 1 }),
    legend: { data: dualPriceSeries.value ? ['日前价', '实时价', '价差'] : ['出清价', '价差'], top: 0, right: 110 },
    toolbox: chartToolbox('实时vs日前价差'),
    grid: { left: 52, right: 16, top: 30, bottom: 26 },
    dataZoom: insideZoom(),
    // X 轴时间标签：云南 24 点全显；基线 96 点太密，每 12 个显一个（约 2h 一个），
    // 避免 ECharts 默认 interval:'auto' 把标签全隐藏导致"X 轴空白"观感。
    xAxis: {
      type: 'category',
      data: r.series.map((p) => p.time),
      axisLabel: { interval: r.series.length > 48 ? 11 : 0, hideOverlap: true }
    },
    yAxis: { type: 'value', name: '元/MWh', scale: true },
    series: [
      // 电价按时段恒定，用阶梯线真实呈现。规矩一：机制上 da/rt 未分离的地区（两条线同源、
      // 价差恒 0）只渲染单条「出清价」，画双线等于伪造信息量。
      ...(dualPriceSeries.value
        ? [{ name: '日前价', type: 'line', step: 'end', showSymbol: false, data: r.series.map((p) => p.da), lineStyle: { width: 1.4, opacity: 0.75 } }]
        : []),
      {
        name: dualPriceSeries.value ? '实时价' : '出清价',
        type: 'line', step: 'end', showSymbol: false, data: r.series.map((p) => p.rt),
        lineStyle: { width: 2 },
        markPoint: {
          symbolSize: 34,
          data: r.alerts.slice(0, 12).map((a) => ({
            coord: [a.time, r.series.find((p) => p.time === a.time)?.rt ?? 0],
            value: a.spread > 0 ? '▲' : '▼',
            itemStyle: { color: a.spread > 0 ? '#f87171' : '#34d399' }
          }))
        }
      },
      {
        name: '价差', type: 'bar',
        data: r.series.map((p) => ({
          value: p.spread,
          itemStyle: { color: p.spread >= 0 ? 'rgba(248,113,113,0.45)' : 'rgba(52,211,153,0.45)' }
        }))
      }
    ]
  }, { replaceMerge: ['graphic'] }) // 空态 graphic 需整组替换才能在有数据时清掉
}

function setAuto(on: boolean) {
  autoRefresh.value = on
  window.clearInterval(timer)
  if (on) timer = window.setInterval(load, 60_000)
}

// 用后端实时覆盖区间校正默认日期。取不到就保持现值——首屏顶多还是空态，
// 与改动前一致，不会显示任何来源不明的数字。
//
// 只在日期还是初始默认值时校正：请求往返期间用户可能已经手选，把他选的日期再拉回
// 「最后有数据的一天」是劫持操作，故 await 前后各判一次。
const initialDate = date.value
async function syncCoverageDefault() {
  if (date.value !== initialDate) return
  const range = await fetchCaptureCoverage(currentRegion.value.id, 'price')
  if (!range || date.value !== initialDate) return
  if (date.value !== range.end) date.value = range.end   // 变更由 watch 触发重载
}

onMounted(() => {
  window.addEventListener('governance-user-changed', reloadForIdentity)
  load()
  void syncCoverageDefault()
  setAuto(autoRefresh.value)
})
watch([date, threshold], load)
// keep-alive：切走暂停 60s 轮询（避免后台空转），切回恢复并立即拉一次最新数据
onActivated(() => {
  if (autoRefresh.value && !loading.value) load()
  setAuto(autoRefresh.value)
})
onDeactivated(() => window.clearInterval(timer))
onBeforeUnmount(() => {
  window.clearInterval(timer)
  window.removeEventListener('governance-user-changed', reloadForIdentity)
})
onRegionChange(() => {
  // 切区先让旧地区结果和在途请求失效，不能等新地区请求返回后才覆盖；否则云南
  // 私有价格、来源角标会在山西等新地区上下文中短暂串显。
  loadSeq += 1
  result.value = null
  lastUpdated.value = ''
  error.value = ''
  priceChart.setOption(emptyOverlay(true), { replaceMerge: ['graphic', 'series'] })
  // 云南切回厂侧 PG 当天价格；其他地区若当前日期在覆盖区外，先落回其回放区间。
  const previousDate = date.value
  if (currentRegion.value.id === 'yunnan') {
    date.value = shanghaiToday()
  } else if (isOutOfCoverage(currentRegion.value.id, 'price', date.value)) {
    date.value = clampToCoverage(currentRegion.value.id, 'price', date.value)
  }
  // 日期改变会由 watch 拉取；未改变时主动按新地区重载，避免双请求。
  if (date.value === previousDate) void load()
})
</script>

<template>
  <div class="monitor page-stack">
    <RegionDataBanner />
    <!-- 状态条 -->
    <section class="panel params">
      <label>监盘日期 <input v-model="date" type="date" /></label>
      <label>异动阈值(元/MWh) <input v-model.number="threshold" type="number" min="1" /></label>
      <button class="refresh-btn" :class="{ on: autoRefresh }" @click="setAuto(!autoRefresh)">
        <RefreshCw :size="13" :class="{ spin: loading }" />
        {{ autoRefresh ? '自动刷新中(60s)' : '自动刷新已停' }}
      </button>
      <button class="refresh-btn manual" :disabled="loading" @click="load">
        <RefreshCw :size="13" :class="{ spin: loading }" />
        立即刷新
      </button>
      <span
        v-if="result?.source === 'synthetic_mock'"
        class="demo-tag"
        :title="result?.demo_pattern_injected ? '演示场景：实时价含人工构造的晚高峰上冲/午间下探异动形态，非真实信号' : ''"
      >准实时·演示数据{{ result?.demo_pattern_injected ? '(含构造异动)' : '' }}</span>
      <span v-else-if="usesCgnPrivatePrice" class="demo-tag live">厂侧 PostgreSQL·真实</span>
      <span v-else-if="result" class="demo-tag replay">回放数据</span>
      <!-- 价格口径与粒度角标（Epic #1431 S2）：由机制画像（serving-route 路由声明 ⊕ 结算规则
           逐字段溯源）派生，不再按后端字符串硬编码；后端 price_note 作为 tooltip 补充说明。
           口径未登记的地区如实标「口径未登记」，绝不套用他省口径。 -->
      <span
        class="basis-tag"
        :class="{ warn: !dualPriceSeries }"
        :title="result?.price_note || mechanism.daRtSeparated.note"
      >{{ priceBasisText }}</span>
      <span
        v-if="granularityText"
        class="basis-tag granularity"
        :title="mechanism.resamplePolicy.note"
      >{{ granularityText }}</span>
      <CgnYunnanPriceStatus
        v-if="usesCgnPrivatePrice"
        :bundle="result?.cgn_price_bundle ?? null"
      />
      <span v-if="currentRegion.id === 'yunnan' && !cgnPriceEntitled" class="error-tag">
        当前账号不属于中广核云南集团，未请求中广核厂侧专属价格链路
      </span>
      <span class="updated">更新 {{ lastUpdated }}</span>
      <span v-if="result?.warning" class="error-tag">{{ result.warning }}</span>
      <span v-if="error" class="error-tag">{{ error }}</span>
    </section>

    <div class="monitor-grid">
      <!-- 主图 -->
      <section class="panel chart-block">
        <div class="block-title">
          <Activity :size="14" /> 实时 vs 日前 · {{ result?.series.length ?? 0 }} 点价差
        </div>
        <div ref="chartEl" class="main-chart chart-host" />
      </section>

      <!-- 右列 -->
      <div class="side-col">
        <section class="panel alerts">
          <div class="block-title"><BellRing :size="14" /> 价差异动（|Δ| ≥ {{ threshold }}）</div>
          <p v-if="!result?.alerts.length" class="muted">当前阈值下无异动时点</p>
          <button
            v-for="a in result?.alerts.slice(0, 12)"
            :key="a.time"
            class="alert-row"
            title="点击让智能体解读该时段异动"
            @click="explainAlert(a.time, a.spread)"
          >
            <span class="alert-time">{{ a.time }}</span>
            <span class="alert-spread" :class="a.spread > 0 ? 'num-up' : 'num-down'">
              {{ a.spread > 0 ? '+' : '' }}{{ a.spread.toFixed(1) }}
            </span>
            <span class="alert-dir">{{ a.direction }}</span>
          </button>
        </section>

        <section v-if="result" class="panel pv-stats">
          <div class="block-title">峰谷统计（实时价口径）</div>
          <div class="pv-row"><span>峰段均价</span><b>{{ result.peak_valley.avg_price.peak ?? '-' }}</b></div>
          <div class="pv-row"><span>平段均价</span><b>{{ result.peak_valley.avg_price.flat ?? '-' }}</b></div>
          <div class="pv-row"><span>谷段均价</span><b>{{ result.peak_valley.avg_price.valley ?? '-' }}</b></div>
          <div class="pv-row main"><span>峰谷价差</span><b>{{ result.peak_valley.peak_valley_spread ?? '-' }}</b></div>
        </section>
      </div>
    </div>

    <AgentSidekick ref="sidekick" title="监盘解读智能体" history-key="sidekick_spot" :chips="chips" />
  </div>
</template>

<style scoped>
.monitor { gap: 14px; }
.muted { color: var(--muted); font-size: var(--font-12-5); }
.params {
  display: flex; flex-wrap: wrap; align-items: center; gap: 14px;
  padding: 12px 16px; font-size: var(--font-md);
}
.params label { display: flex; align-items: center; gap: 6px; color: var(--muted); }
.params input {
  padding: 5px 9px; border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--text); font-size: var(--font-md);
}
.params input[type='number'] { width: 90px; }
.refresh-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; font-size: var(--font-12-5); border: 1px solid var(--line);
  border-radius: 999px; background: transparent; color: var(--muted); cursor: pointer;
}
.refresh-btn.on { border-color: var(--primary); color: var(--primary); }
.refresh-btn.manual:disabled { opacity: 0.55; cursor: wait; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.demo-tag {
  font-size: var(--font-xs); padding: 1px 8px; border-radius: 999px;
  background: rgba(245, 158, 11, 0.15); color: #b45309;
}
.demo-tag.replay { background: rgba(22, 163, 74, 0.12); color: #15803d; }
.demo-tag.live { background: rgba(14, 116, 144, 0.12); color: #0e7490; }
.basis-tag {
  font-size: var(--font-xs); padding: 1px 8px; border-radius: 999px;
  background: rgba(59, 130, 246, 0.12); color: #1d4ed8;
}
.basis-tag.granularity {
  border-color: color-mix(in srgb, var(--primary, #3b82f6) 30%, var(--line));
  background: color-mix(in srgb, var(--primary, #3b82f6) 8%, transparent);
  color: var(--primary, #3b82f6);
}
.basis-tag.warn { background: rgba(239, 68, 68, 0.10); color: #b91c1c; }
.updated { margin-left: auto; font-size: var(--font-11-5); color: var(--muted); font-variant-numeric: tabular-nums; }
.error-tag { color: #ef4444; font-size: var(--font-sm); }

.monitor-grid { display: grid; grid-template-columns: 1fr 300px; gap: 14px; }
@media (max-width: 1100px) { .monitor-grid { grid-template-columns: 1fr; } }
@media (max-width: 768px) { .monitor-grid { grid-template-columns: 1fr; } }
.chart-block { padding: 12px 16px; }
.block-title { display: flex; align-items: center; gap: 6px; font-size: var(--font-13-5); font-weight: 600; margin-bottom: 6px; }
.main-chart { width: 100%; height: 520px; }

.side-col { display: flex; flex-direction: column; gap: 14px; }
.alerts { padding: 12px 14px; max-height: 280px; overflow-y: auto; }
.alert-row {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 8px; margin-top: 4px; font-size: var(--font-12-5);
  border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--text); cursor: pointer; text-align: left;
}
.alert-row:hover { border-color: var(--primary); }
.alert-time { font-weight: 600; font-variant-numeric: tabular-nums; }
.alert-spread { font-variant-numeric: tabular-nums; }
.num-up { color: #ef4444; }
.num-down { color: #16a34a; }
.alert-dir { margin-left: auto; font-size: var(--font-11-5); color: var(--muted); }

.pv-stats { padding: 12px 14px; }
.pv-row {
  display: flex; justify-content: space-between; padding: 4px 0;
  font-size: var(--font-md); color: var(--muted);
}
.pv-row b { color: var(--text); font-variant-numeric: tabular-nums; }
.pv-row.main { border-top: 1px solid var(--line); margin-top: 4px; padding-top: 8px; }
.pv-row.main b { color: var(--primary); font-size: var(--font-16); }
</style>
