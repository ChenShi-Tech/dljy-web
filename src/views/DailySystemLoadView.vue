<script setup lang="ts">
// 逐日系统负荷实际值 (actualLoad) — 分页精修版。
// 左列=系统负荷实际值(system) 右列=错位负荷实际值(misplace);三行=均值/最小值/最大值。
// 每子图 6 条年线(2021-2026);横轴=每天(月初打刻度);纵轴 0~45000。
// 数据经市场洞察逐日负荷契约归一为 system/misplace 两类 sources 与 average/min/max 三类 metrics。
//
// 分页：顶部 el-tabs 按「均值/最小值/最大值」三页切分，每页保留系统 vs 错位两列对比
// （每图默认高度按视口 0.66 取 [480,860]，用户可拖底部手柄自调、同页两列联动、localStorage 记忆；
// 高度变化经 useEChart ResizeObserver 自动 resize）；
// 额外「全部」页保留原 6 图一览（2 列 × 3 行，每图 240px）。当前页签 ⇄ URL ?metric= 同步。
import { computed, onMounted, ref, watch, type Ref } from 'vue'
import { currentRegion } from '@/services/region/regionContext'
import {
  fetchMarketInsightActualLoadContract,
  type ActualLoadMetricKey,
  type ActualLoadSourceKey,
  type MarketInsightActualLoadBlock
} from '@/services/data/contracts'
import { onRegionChange } from '../composables/useRegionReload'
import { useQuerySync } from '../composables/useQuerySync'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import CapabilitySupportBadge from '../components/CapabilitySupportBadge.vue'
import LoadPanelChart from '../components/common/LoadPanelChart.vue'
import CalloutBox from '../components/common/CalloutBox.vue'
import { LOAD_PANEL_UNIT, isEmptyLoadSource } from '@/services/chart/loadPanelModel'
import { defineAiPage, useAiSidebar } from '@/features/aiSidebar'
import { PAGE_PROMPT_KEYS } from '@/prompts'

// 列定义：系统负荷实际值 / 错位负荷实际值
type Col = { src: ActualLoadSourceKey; col: string }
const COLS: Col[] = [
  { src: 'system', col: '系统负荷实际值' },
  { src: 'misplace', col: '错位负荷实际值' }
]
// 指标页签：均值 / 最小值 / 最大值（「全部」单独一个页签）
type MetricTab = { metricKey: ActualLoadMetricKey; metric: string }
const METRIC_TABS: MetricTab[] = [
  { metricKey: 'average', metric: '均值' },
  { metricKey: 'min', metric: '最小值' },
  { metricKey: 'max', metric: '最大值' }
]
const VALID_METRICS = ['average', 'min', 'max', 'all'] as const
type ActiveMetric = typeof VALID_METRICS[number]

// 子图高度：用户可拖拽调整，记忆到 localStorage（同页两列联动、下次进入沿用）。
const PANEL_HEIGHT_KEY = 'actualLoad.panelHeight'
function defaultPanelHeight(): number {
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900
  return Math.min(860, Math.max(480, Math.round(vh * 0.66)))
}
function readStoredHeight(): number {
  // 读取也需 try/catch：禁用持久化的浏览器策略 / sandbox iframe 访问 localStorage 会抛
  // SecurityError，若不捕获会在 setup 阶段中断、整页无法渲染（#1385）。
  try {
    const n = Number(localStorage.getItem(PANEL_HEIGHT_KEY))
    if (Number.isFinite(n) && n >= 280 && n <= 1200) return n
  } catch { /* 隐私/sandbox 策略禁用 localStorage，回退默认 */ }
  return defaultPanelHeight()
}
const panelHeight = ref(readStoredHeight())
watch(panelHeight, (h) => {
  try { localStorage.setItem(PANEL_HEIGHT_KEY, String(h)) } catch { /* 隐私模式忽略 */ }
})

const loading = ref(true)
const error = ref('')
const data = ref<MarketInsightActualLoadBlock | null>(null)
// 当前页签 ⇄ 路由 query：刷新或分享链接后停留在同一迁移面
const activeMetric = ref<ActiveMetric>('average')
useQuerySync({ metric: activeMetric as Ref<string> })
if (!VALID_METRICS.includes(activeMetric.value as ActiveMetric)) activeMetric.value = 'average'

// 防止切地区时旧地区慢响应覆盖新地区负荷状态（#415）。
let loadGeneration = 0

async function load() {
  const generation = ++loadGeneration
  loading.value = true; error.value = ''
  data.value = null
  try {
    const contract = await fetchMarketInsightActualLoadContract({ region: currentRegion.value.id })
    if (generation !== loadGeneration) return
    data.value = contract.blocks.actual_load
    if (!data.value.sources.system) {
      throw new Error('无 system 数据')
    }
  } catch (e) {
    if (generation !== loadGeneration) return
    data.value = null
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

// 系统负荷有数而错位负荷为空壳 = 该地区没有错位负荷口径（错位负荷是山西交易平台的自有统计，
// 云南等地区无法由统调负荷推出），与「数据缺失」区分开说明，避免被当成故障（#3379）。
const misplaceUnavailable = computed(() =>
  !!data.value && !isEmptyLoadSource(data.value.sources.system) && isEmptyLoadSource(data.value.sources.misplace)
)
const MISPLACE_UNAVAILABLE_TEXT = '当前地区无错位负荷口径'
function emptyTextOf(src: ActualLoadSourceKey): string | undefined {
  return src === 'misplace' && misplaceUnavailable.value ? MISPLACE_UNAVAILABLE_TEXT : undefined
}

const ai = useAiSidebar()
// 「✨ 解读本页」：可用年份 + 系统负荷各年年均作摘要（勿传 6年×366天逐日矩阵全量）。
function insightContext(): Record<string, unknown> {
  const sys = data.value?.sources.system
  const years = sys?.years || []
  const average = sys?.metrics.average || []
  const yearMean = (arr: any[]) => {
    const nums = (arr || []).filter((v: any) => typeof v === 'number')
    return nums.length ? Math.round(nums.reduce((s, x) => s + x, 0) / nums.length) : null
  }
  return {
    page: '逐日系统负荷实际值 (actualLoad)',
    years,
    panels: '系统/错位负荷 × 均值/最小/最大（6 子图）',
    system_load_annual_avg_by_year: years.map((y, i) => ({ year: y, annual_avg: yearMean(average[i]) })),
    unit: LOAD_PANEL_UNIT,
    note: '逐日 366 点 × 6 年；本摘要仅给系统负荷各年年均，逐日明细未传',
    basis: 'captured'
  }
}

// 页面接入 AI 侧边栏：悬浮球、「✨ 解读本页」按钮共用这份声明与切片（点击时刻求值）。
defineAiPage({ label: '逐日系统负荷', promptKey: PAGE_PROMPT_KEYS.marketDataAnalysis, interpret: { context: insightContext } })
function askInsight() {
  ai.interpret()
}

onMounted(load)

onRegionChange(load)
</script>

<template>
  <div class="dl" v-loading="loading">
    <RegionDataBanner />
    <CapabilitySupportBadge path="/sjfx/actualLoad" />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <CalloutBox v-if="misplaceUnavailable" class="mb">
      错位负荷实际值是山西交易平台特有的统计口径，当前地区没有这项数据，右列为空并非数据缺失。数值单位为 MW（日内负荷功率的均值/最小值/最大值）。
    </CalloutBox>
    <div class="toolbar">
      <el-button size="small" type="success" plain @click="askInsight">✨ 解读本页</el-button>
    </div>
    <el-tabs v-model="activeMetric" class="metric-tabs">
      <!-- 三个指标页：每页系统 vs 错位两列对比 -->
      <el-tab-pane
        v-for="mt in METRIC_TABS"
        :key="mt.metricKey"
        :label="mt.metric"
        :name="mt.metricKey"
      >
        <div class="heads">
          <div class="h">系统负荷实际值</div>
          <div class="h">错位负荷实际值</div>
        </div>
        <div class="grid grid-2">
          <LoadPanelChart
            v-for="c in COLS"
            :key="c.src + mt.metricKey"
            :source="data?.sources[c.src] ?? null"
            :metric-key="mt.metricKey"
            :col-name="c.col"
            :metric-name="mt.metric"
            :empty-text="emptyTextOf(c.src)"
            :height="panelHeight"
            resizable
            @update:height="panelHeight = $event"
          />
        </div>
      </el-tab-pane>
      <!-- 全部页：保留原 6 图一览（2 列 × 3 行） -->
      <el-tab-pane label="全部" name="all">
        <div class="heads">
          <div class="h">系统负荷实际值</div>
          <div class="h">错位负荷实际值</div>
        </div>
        <div class="grid grid-2 grid-all">
          <template v-for="row in METRIC_TABS" :key="row.metricKey">
            <LoadPanelChart
              v-for="c in COLS"
              :key="c.src + row.metricKey"
              :source="data?.sources[c.src] ?? null"
              :metric-key="row.metricKey"
              :col-name="c.col"
              :metric-name="row.metric"
              :empty-text="emptyTextOf(c.src)"
              :height="240"
            />
          </template>
        </div>
      </el-tab-pane>
    </el-tabs>
    <!-- 数据源(内部参考,勿对外展示)：市场洞察逐日负荷契约 ｜ 6 年逐日 · 均值/最小/最大 · 系统/错位负荷 -->
  </div>
</template>

<style scoped>
.dl { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.toolbar { display: flex; justify-content: flex-end; margin-bottom: 8px; }
.metric-tabs { margin-top: 4px; }
.heads { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.heads .h { text-align: center; font-weight: 700; font-size: var(--font-lg); color: var(--text); padding: 6px 0; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.grid-all { grid-auto-rows: 240px; }
.mb { margin-bottom: 12px; }
/* 移动端:双列子图退化为单列(列头隐藏,子图自带标题) */
@media (max-width: 768px) {
  .heads { display: none; }
  .grid { grid-template-columns: 1fr; }
}
</style>
