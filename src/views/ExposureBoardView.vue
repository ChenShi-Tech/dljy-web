<script setup lang="ts">
// 中长期与现货套保（/zcqjy/exposure，原「中长期敞口看板」）：合同分解 vs 预计出力 → 逐时敞口与套保率。
// 归现货交易菜单组（dljy#2988）：产出是现货价格风险指标；合同小时形状目前为模式推演，非 P2 实测分时。
// 数据走 /api/agent/quant/exposure 直调端点（与智能体共用同一套确定性引擎）。
import { computed, nextTick, onMounted, ref, type Ref } from 'vue'
import { Calculator, Gauge, TrendingDown, TrendingUp } from 'lucide-vue-next'
import { defineAiPage } from '@/features/aiSidebar'
import { PAGE_PROMPT_KEYS } from '@/prompts/pageKeys'
import { useEChart } from '../composables/useEChart'
import { useQuerySync, type QuerySyncValue } from '../composables/useQuerySync'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, emptyOverlay } from '@/services/chart/chartOptions'
import { fetchExposure, type ExposureResult } from '@/services/quant/quantClient'
import {
  EXPOSURE_PRIVATE_FAMILIES,
  loadSettlementExposure,
  settlementExposureRisk,
  type SettlementExposure
} from '@/services/exposureData'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import DataBasisBadge from '../components/DataBasisBadge.vue'

const MODES = [
  { value: 'peak_valley', label: '峰谷结构' },
  { value: 'uniform', label: '均匀分解' },
  { value: 'solar_shaped', label: '光伏镜像' }
]

function defaultMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const month = ref(defaultMonth())
const totalMwh = ref(7200)
const mode = ref('peak_valley')
const expectedSource = ref<'renewable' | 'load'>('renewable')
const loading = ref(false)
const error = ref('')
const result = ref<ExposureResult | null>(null)

const mainEl = ref<HTMLElement | null>(null)
const heatEl = ref<HTMLElement | null>(null)
const mainChart = useEChart(mainEl, { render: renderCharts })
const heatChart = useEChart(heatEl, { render: renderCharts })

// 测算参数 ⇄ 路由 query：刷新/分享链接后还原同一测算场景
useQuerySync({ month, total: totalMwh, mode, source: expectedSource as Ref<QuerySyncValue> })

// 套保率分档：<0.8 欠保(红) / 0.8-1.1 适中(绿) / >1.1 过保(琥珀)
const hedgeClass = computed(() => {
  const h = result.value?.hedge_ratio ?? 0
  return h < 0.8 ? 'bad' : h <= 1.1 ? 'good' : 'warn'
})

// 真实结算派生套保率/敞口（来自 yn_spot_settlement，captured；严格地区无数据走空态）
const settleExposure = ref<SettlementExposure | null>(null)
const settleLoading = ref(false)
const settleRisk = computed(() =>
  settleExposure.value ? settlementExposureRisk(settleExposure.value) : null
)

async function loadSettle() {
  settleLoading.value = true
  try {
    settleExposure.value = await loadSettlementExposure()
  } catch {
    settleExposure.value = null
  } finally {
    settleLoading.value = false
  }
}

// 页面接入 AI 侧边栏（统一 AI 侧边栏 EN-02，原独立右侧栏 AgentSidekick 已移除）：
// 快捷问题在点击时刻插入当前月份/合同总量/分解模式；首条标记为本页解读，悬浮球点击即发送它。
// 原侧栏不传解读角色（走通用助手），这里沿用通用对话角色。
defineAiPage({
  label: '中长期与现货套保',
  promptKey: PAGE_PROMPT_KEYS.workbench,
  presets: [
    {
      label: '解读敞口结构与风险',
      interpret: true,
      question: () => `对 ${month.value} 月、合同总量 ${totalMwh.value} MWh、${mode.value} 分解、预计${
        expectedSource.value === 'renewable' ? '出力' : '用电'
      }口径做中长期敞口解读：套保率、双向敞口的风险方向与量级`
    },
    {
      label: '给出补仓/平仓建议',
      question: () => `基于 ${month.value} 月合同 ${totalMwh.value} MWh（${mode.value} 分解）的敞口情况，给出分时段补仓/平仓建议与目标套保率`
    },
    {
      label: '对比三种分解模式',
      question: () => `对 ${month.value} 月合同总量 ${totalMwh.value} MWh，对比 uniform/peak_valley/solar_shaped 三种分解模式的敞口差异，推荐最适合的模式`
    }
  ]
})

async function calc() {
  loading.value = true
  mainChart.showLoading()
  heatChart.showLoading()
  error.value = ''
  try {
    result.value = await fetchExposure({
      month: month.value,
      total_mwh: totalMwh.value,
      mode: mode.value,
      expected_source: expectedSource.value
    })
    await nextTick()
    renderCharts()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '测算失败'
  } finally {
    loading.value = false
    mainChart.hideLoading()
    heatChart.hideLoading()
  }
}

function renderCharts() {
  const r = result.value
  if (!r) return
  // 主图：合同/出力双线 + gap 柱（正负着色）
  if (mainEl.value) {
    mainChart.setOption({
      ...emptyOverlay(!r.series.length),
      tooltip: axisTooltip({ unit: 'MWh/h' }),
      // 底部布局对齐分时行情(fshq)日K主图：图例顶部居中独占一行、工具栏右下角、inside+slider 缩放
      legend: bottomLayoutLegend({ data: ['合同分解', '预计出力', '敞口 gap'], textStyle: { fontSize: 12 } }),
      toolbox: bottomToolbox('中长期敞口', 8),
      grid: { left: 52, right: 16, top: 56, bottom: 56 },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 18, right: 100 }],
      xAxis: { type: 'category', data: r.series.map((p) => p.datetime) },
      yAxis: { type: 'value', name: 'MWh/h', scale: true },
      series: [
        { name: '合同分解', type: 'line', showSymbol: false, data: r.series.map((p) => p.contracted) },
        { name: '预计出力', type: 'line', showSymbol: false, data: r.series.map((p) => p.expected) },
        {
          name: '敞口 gap',
          type: 'bar',
          data: r.series.map((p) => ({
            value: p.gap,
            itemStyle: { color: p.gap >= 0 ? 'rgba(248,113,113,0.55)' : 'rgba(52,211,153,0.55)' }
          }))
        }
      ]
    }, { replaceMerge: ['graphic'] }) // 空态 graphic 需整组替换才能在有数据时清掉
  }
  // 热力图：日 × 小时 的 gap（识别系统性时段缺口）
  if (heatEl.value) {
    const data: [number, number, number][] = r.series.map((p, i) => [
      Math.floor(i / 24) + 1,
      i % 24,
      Math.round(p.gap * 100) / 100
    ])
    const absMax = Math.max(0.01, ...data.map((d) => Math.abs(d[2])))
    heatChart.setOption({
      ...emptyOverlay(!data.length),
      tooltip: {
        formatter: (x: { data: [number, number, number] }) =>
          `${x.data[0]}日 ${x.data[1]}:00 敞口 ${x.data[2]} MWh`
      },
      grid: { left: 52, right: 70, top: 10, bottom: 28 },
      xAxis: { type: 'category', name: '日', data: [...new Set(data.map((d) => d[0]))] },
      yAxis: { type: 'category', name: '时', data: Array.from({ length: 24 }, (_, h) => h) },
      visualMap: {
        min: -absMax,
        max: absMax,
        calculable: true,
        orient: 'vertical',
        right: 0,
        top: 'center',
        inRange: { color: ['#34d399', '#f4f4f5', '#f87171'] },
        text: ['卖出敞口', '买入敞口']
      },
      series: [{ type: 'heatmap', data: data.map((d) => [d[0] - 1, d[1], d[2]]) }]
    }, { replaceMerge: ['graphic'] })
  }
}

onMounted(() => {
  calc()
  loadSettle()
})
onRegionChange(() => {
  calc()
  loadSettle()
})
</script>

<template>
  <div class="exposure page-stack">
    <RegionDataBanner :families="EXPOSURE_PRIVATE_FAMILIES" />
    <!-- 参数条 -->
    <section class="panel params">
      <label>月份 <input v-model="month" type="month" /></label>
      <label>合同总量(MWh) <input v-model.number="totalMwh" type="number" min="1" /></label>
      <label>
        分解模式
        <select v-model="mode">
          <option v-for="m in MODES" :key="m.value" :value="m.value">{{ m.label }}</option>
        </select>
      </label>
      <label>
        对比口径
        <select v-model="expectedSource">
          <option value="renewable">预计出力(发电侧)</option>
          <option value="load">预计用电(用户侧)</option>
        </select>
      </label>
      <button class="calc-btn" :disabled="loading" @click="calc">
        <Calculator :size="14" /> {{ loading ? '测算中…' : '测算' }}
      </button>
      <span v-if="result?.source === 'synthetic_mock'" class="demo-tag">演示数据</span>
      <span v-if="error" class="error-tag">{{ error }}</span>
    </section>

    <!-- KPI 卡行 -->
    <section v-if="result" class="kpi-row">
      <div class="panel kpi" :class="hedgeClass">
        <span class="kpi-label"><Gauge :size="13" /> 套保率</span>
        <b class="kpi-value">{{ (result.hedge_ratio * 100).toFixed(1) }}%</b>
        <span class="kpi-sub">{{ hedgeClass === 'bad' ? '欠保·价格下行风险' : hedgeClass === 'warn' ? '过保·价格上行风险' : '区间适中' }}</span>
      </div>
      <div class="panel kpi">
        <span class="kpi-label"><TrendingUp :size="13" /> 净卖出敞口</span>
        <b class="kpi-value">{{ result.spot_sell_exposure_mwh.toFixed(1) }}</b>
        <span class="kpi-sub">MWh（多发部分进现货卖出）</span>
      </div>
      <div class="panel kpi">
        <span class="kpi-label"><TrendingDown :size="13" /> 净买入敞口</span>
        <b class="kpi-value">{{ result.spot_buy_exposure_mwh.toFixed(1) }}</b>
        <span class="kpi-sub">MWh（欠发部分需现货购入）</span>
      </div>
      <div class="panel kpi">
        <span class="kpi-label">日均合同电量</span>
        <b class="kpi-value">{{ result.daily_mwh.toFixed(1) }}</b>
        <span class="kpi-sub">MWh/日 · {{ result.month }}</span>
      </div>
    </section>

    <!-- 真实结算套保率/敞口（来自 yn_spot_settlement，captured；与上方合成测算口径独立并列） -->
    <section class="panel settle-block">
      <div class="block-title">
        真实结算套保率 / 敞口
        <DataBasisBadge v-if="settleExposure?.hasData" basis="captured" />
        <span class="settle-hint">来自真实结算导出数据（{{ settleExposure?.daysCount || 0 }} 日聚合，演示月 2026-05），与上方合成测算口径独立</span>
      </div>
      <div v-if="settleLoading" class="settle-empty">加载真实结算数据…</div>
      <template v-else-if="settleExposure?.hasData">
        <div class="settle-kpis">
          <div class="panel kpi" :class="settleRisk?.cls">
            <span class="kpi-label"><Gauge :size="13" /> 真实套保率</span>
            <b class="kpi-value">{{ (settleExposure.coverageRate * 100).toFixed(1) }}%</b>
            <span class="kpi-sub">中长期 {{ settleExposure.ltmEnergy }} / 总 {{ settleExposure.totalEnergy }} MWh</span>
          </div>
          <div class="panel kpi">
            <span class="kpi-label">净敞口</span>
            <b class="kpi-value">{{ settleExposure.openExposureMwh > 0 ? '+' : '' }}{{ settleExposure.openExposureMwh.toFixed(1) }}</b>
            <span class="kpi-sub">MWh · {{ settleExposure.openExposureMwh > 0 ? '净卖出(欠保)' : settleExposure.openExposureMwh < 0 ? '净买入(过保)' : '基本平衡' }}</span>
          </div>
          <div class="panel kpi">
            <span class="kpi-label"><TrendingUp :size="13" /> 净卖出敞口</span>
            <b class="kpi-value">{{ settleExposure.sellExposureMwh.toFixed(1) }}</b>
            <span class="kpi-sub">MWh（多发进现货卖出）</span>
          </div>
          <div class="panel kpi">
            <span class="kpi-label"><TrendingDown :size="13" /> 净买入敞口</span>
            <b class="kpi-value">{{ settleExposure.buyExposureMwh.toFixed(1) }}</b>
            <span class="kpi-sub">MWh（欠发需现货购入）</span>
          </div>
        </div>
        <div v-if="settleRisk" class="settle-risk" :class="settleRisk.cls">
          <b>{{ settleRisk.label }}</b>
          <span>{{ settleRisk.detail }}</span>
        </div>
      </template>
      <div v-else class="settle-empty">
        当前地区无真实结算数据（严格地区「真实或空」，不回退基线）。真实结算套保率/敞口目前仅云南域可用。
      </div>
    </section>

    <!-- 主图 -->
    <section class="panel chart-block">
      <div class="block-title">合同分解 vs {{ expectedSource === 'renewable' ? '预计出力' : '预计用电' }} · 逐时敞口</div>
      <div ref="mainEl" class="main-chart chart-host" />
    </section>

    <!-- 热力图 -->
    <section class="panel chart-block">
      <div class="block-title">敞口热力（日 × 小时）—— 识别系统性时段缺口</div>
      <div ref="heatEl" class="heat-chart chart-host" />
    </section>

  </div>
</template>

<style scoped>
.exposure { gap: 14px; }
.params {
  display: flex; flex-wrap: wrap; align-items: center; gap: 14px;
  padding: 12px 16px; font-size: var(--font-md);
}
.params label { display: flex; align-items: center; gap: 6px; color: var(--muted); }
.params input, .params select {
  padding: 5px 9px; border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--text); font-size: var(--font-md);
}
.params input[type='number'] { width: 110px; }
.calc-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 16px; font-size: var(--font-md); font-weight: 600;
  border: none; border-radius: 8px; cursor: pointer;
  background: var(--primary); color: #fff;
}
.calc-btn:disabled { opacity: 0.5; }
.demo-tag {
  font-size: var(--font-xs); padding: 1px 8px; border-radius: 999px;
  background: rgba(245, 158, 11, 0.15); color: #b45309;
}
.error-tag { color: #ef4444; font-size: var(--font-sm); }

.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 900px) { .kpi-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .kpi-row { grid-template-columns: 1fr; } }
.kpi { padding: 12px 14px; display: flex; flex-direction: column; gap: 3px; }
.kpi-label { display: flex; align-items: center; gap: 5px; font-size: var(--font-sm); color: var(--muted); }
.kpi-value { font-size: var(--font-22); font-variant-numeric: tabular-nums; }
.kpi-sub { font-size: var(--font-11-5); color: var(--muted); }
.kpi.good .kpi-value { color: #16a34a; }
.kpi.bad .kpi-value { color: #ef4444; }
.kpi.warn .kpi-value { color: #d97706; }

.chart-block { padding: 12px 16px; }
.block-title { font-size: var(--font-13-5); font-weight: 600; margin-bottom: 6px; }
.main-chart { width: 100%; height: 340px; }
.heat-chart { width: 100%; height: 300px; }

.settle-block { padding: 12px 16px; }
.settle-block .block-title { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.settle-hint { font-weight: 400; font-size: var(--font-11-5); color: var(--muted); }
.settle-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 8px 0 10px; }
@media (max-width: 900px) { .settle-kpis { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .settle-kpis { grid-template-columns: 1fr; } }
.settle-risk { display: flex; flex-direction: column; gap: 2px; padding: 10px 14px; border-radius: 8px; }
.settle-risk b { font-size: var(--font-13-5); }
.settle-risk span { font-size: var(--font-sm); color: var(--muted); }
.settle-risk.bad { background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; }
.settle-risk.warn { background: rgba(245, 158, 11, 0.1); border-left: 3px solid #d97706; }
.settle-risk.good { background: rgba(34, 197, 94, 0.1); border-left: 3px solid #16a34a; }
.settle-empty { padding: 14px 4px; color: var(--muted); font-size: var(--font-md); }
</style>
