<script setup lang="ts">
// 数据分析 / 厄尔尼诺拉尼娜 — built from REAL captured data.
// Data: GET /sdpt/elninolanina/list -> 77 行 {year, djf,jfm,fma,...,ndj}
//   (12 个三月滑动季的 ONI 指数). Source: capture-raw/sdpt_elninolanina/
import { onMounted, ref, computed } from 'vue'
import { fetchCaptured } from '@/services/captured'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import ChartCard from '../components/common/ChartCard.vue'
import { axisTooltip, chartToolbox, bottomToolbox, emptyOverlay, fmtNum } from '@/services/chart/chartOptions'
import {
  POWER, divergingColors, lineSeries, markLineThreshold, markAreaBands,
  tooltipStyle, catAxis, valueAxis, animation, continuousVisualMap
} from '@/services/chart/chartStyle'
// 3D 美学层：import 即注册 echarts-gl 的 bar3D 等系列类型
import { grid3DAxes, bar3D } from '@/services/chart/chartStyle3D'

const SEASONS = ['djf', 'jfm', 'fma', 'mam', 'amj', 'mjj', 'jja', 'jas', 'aso', 'son', 'ond', 'ndj']
const SEASON_LABEL: Record<string, string> = {
  djf: '12-2', jfm: '1-3', fma: '2-4', mam: '3-5', amj: '4-6', mjj: '5-7',
  jja: '6-8', jas: '7-9', aso: '8-10', son: '9-11', ond: '10-12', ndj: '11-1'
}

const loading = ref(true)
const error = ref('')
const rows = ref<any[]>([])
const selectedYear = ref<number | null>(null) // null=全部(保留滑动浏览)

const sorted = computed(() =>
  [...rows.value].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
)
const years = computed(() => sorted.value.map((r) => r.year))
// 选了某年只显示该年,否则全部
const shown = computed(() =>
  selectedYear.value == null ? sorted.value : sorted.value.filter((r) => r.year === selectedYear.value)
)

// ENSO: >=0.5 厄尔尼诺(暖,红), <=-0.5 拉尼娜(冷,蓝), 之间中性
function cellStyle(v: unknown) {
  if (v == null || v === '') return {}
  const n = Number(v)
  if (n >= 0.5) return { background: `rgba(245,108,108,${Math.min(0.15 + n / 6, 0.6)})`, color: '#a8071a' }
  if (n <= -0.5) return { background: `rgba(64,158,255,${Math.min(0.15 + -n / 6, 0.6)})`, color: '#0050b3' }
  return {}
}

/* ───────────────────────── 图表 ───────────────────────── */

// 取某行某季的 ONI 数值；空值/非数返回 null(留空白,不参与算术)
function oniValue(row: any, season: string): number | null {
  if (row == null) return null
  const raw = row[season]
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

// 年×季 ONI 热力图：X=12 季, Y=年(降序,与表格一致), 值=ONI；红暖蓝冷发散色
function buildHeatmapOption() {
  const list = sorted.value // 已按年降序
  const yearCats = list.map((r) => String(r.year)) // 类目轴用字符串年份
  // 热力图 data：[seasonIdx, yearIdx, value]，跳过空值
  const data: [number, number, number][] = []
  list.forEach((row, yi) => {
    SEASONS.forEach((s, si) => {
      const v = oniValue(row, s)
      if (v != null) data.push([si, yi, v])
    })
  })
  return {
    tooltip: {
      ...tooltipStyle(),
      trigger: 'item' as const,
      formatter: (p: { data: [number, number, number] }) => {
        const [si, yi, v] = p.data
        return `<div style="font-weight:600;margin-bottom:2px">${yearCats[yi]} 年 · ${SEASON_LABEL[SEASONS[si]]} 月</div>` +
          `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7"><span>ONI 指数</span><b>${fmtNum(v, 1)}</b></div>`
      }
    },
    toolbox: chartToolbox('ONI 年×季热力图'),
    grid: { left: 60, right: 24, top: 16, bottom: 56, containLabel: true },
    ...animation(),
    ...emptyOverlay(!data.length),
    xAxis: catAxis(SEASONS.map((s) => SEASON_LABEL[s]), { name: '三月滑动季' }),
    yAxis: {
      ...catAxis(yearCats),
      name: '年份',
      // 年份多,缩小标签字号避免拥挤
      axisLabel: { color: '#909399', fontSize: 10 }
    },
    visualMap: continuousVisualMap({ min: -3, max: 3, colors: divergingColors(), text: ['暖', '冷'] }),
    series: [
      {
        type: 'heatmap' as const,
        data,
        emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 1 } }
      }
    ]
  }
}

// ONI 三维分布：X=12 季, Y=年份, Z=ONI；红暖蓝冷发散柱阵
// data3d = [[seasonIdx, yearIdx, oniValue], ...]；Number() 转换防 NaN,空值跳过
function build3DOption() {
  const list = sorted.value // 已按年降序
  const seasonCats = SEASONS.map((s) => SEASON_LABEL[s]) // X 类目:季名
  const yearCats = list.map((r) => String(r.year))        // Y 类目:年份字符串
  const data3d: number[][] = []
  list.forEach((row, yi) => {
    SEASONS.forEach((s, si) => {
      const v = oniValue(row, s)
      if (v == null) return
      const n = Number(v) // 防 NaN
      if (Number.isFinite(n)) data3d.push([si, yi, n])
    })
  })
  // grid3DAxes 展开出 grid3D/xAxis3D/yAxis3D/zAxis3D；bar3D 展开出 visualMap + series；二者合并
  return {
    ...grid3DAxes(['季', '年份', 'ONI'], { xCat: seasonCats, yCat: yearCats }),
    ...bar3D('ONI', data3d, { diverging: true }),
    ...emptyOverlay(!data3d.length)
  }
}

// 折线展示的目标行：选定年份优先,否则最近一年(sorted 第一项)
const lineYearRow = computed(() =>
  (selectedYear.value == null ? sorted.value[0] : sorted.value.find((r) => r.year === selectedYear.value)) ?? null
)

// 选定年份(或最近年)的 12 季 ONI 折线 + 暖/冷阈值线 + 暖/冷相位色带
function buildLineOption() {
  const row = lineYearRow.value
  const y = SEASONS.map((s) => oniValue(row, s))
  const hasData = y.some((v) => v != null)
  // 两条阈值线:markLineThreshold 把 label/lineStyle 放在 markLine 顶层(每线一个),
  // 直接合并两次调用的 data 会共用同一顶层 label/色。故取各自的 label/lineStyle
  // 下沉到 per-data 项,合并成单个 markLine,两条线各自标注「厄尔尼诺/拉尼娜」与红蓝色。
  const warm = markLineThreshold(0.5, '厄尔尼诺', POWER.deviation)
  const cool = markLineThreshold(-0.5, '拉尼娜', POWER.load)
  const thresholdLine = {
    silent: true,
    symbol: 'none' as const,
    data: [
      { ...warm.data[0], lineStyle: warm.lineStyle, label: warm.label },
      { ...cool.data[0], lineStyle: cool.lineStyle, label: cool.label }
    ]
  }
  return {
    tooltip: { ...axisTooltip({ unit: '', digits: 1 }), ...tooltipStyle(), confine: true },
    // 底部布局:工具栏右下角(本图无 legend);grid bottom 加大给 toolbox 让位
    toolbox: bottomToolbox('选定年份季度 ONI', 8),
    grid: { left: 12, right: 18, top: 24, bottom: 48, containLabel: true },
    ...animation(),
    ...emptyOverlay(!hasData),
    xAxis: catAxis(SEASONS.map((s) => SEASON_LABEL[s])),
    yAxis: valueAxis('ONI', { min: -3, max: 3 }),
    series: [
      lineSeries('ONI', y, POWER.price, {
        connectNulls: true,
        markLine: thresholdLine,
        markArea: markAreaBands([
          { from: 0.5, to: 3, color: POWER.deviation, label: '暖相位' },
          { from: -3, to: -0.5, color: POWER.load, label: '冷相位' }
        ])
      })
    ]
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetchCaptured<any>('sdpt_elninolanina', 'list')
    rows.value = res.rows || res.data || []
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}
onMounted(load)

onRegionChange(load)
</script>

<template>
  <div class="page">
    <RegionDataBanner />
    <div class="page-head">
      <div>
        <div class="crumb">数据分析 · 真实数据</div>
        <h2>厄尔尼诺 / 拉尼娜（ENSO 指数）</h2>
      </div>
      <div class="head-right">
        <el-select v-model="selectedYear" placeholder="按年份筛选" clearable filterable size="small" style="width: 150px">
          <el-option v-for="y in years" :key="y" :label="y + ' 年'" :value="y" />
        </el-select>
        <div class="legend">
          <span class="chip warm"></span>厄尔尼诺(≥0.5)
          <span class="chip cool"></span>拉尼娜(≤-0.5)
        </div>
      </div>
    </div>

    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />

    <!-- 图表区:年×季 ONI 热力图(整宽) + 选定/最近年份季度折线 -->
    <div class="charts-grid">
      <ChartCard
        title="ONI 年×季热力图（红暖蓝冷）"
        :height="420"
        class="span-2"
        :loading="loading"
        :build-option="buildHeatmapOption"
      />
      <ChartCard
        :title="`季度 ONI 折线 · ${lineYearRow ? lineYearRow.year + ' 年' : '暂无'}（${selectedYear == null ? '最近一年' : '已选'}）`"
        :height="320"
        class="span-2"
        :loading="loading"
        :build-option="buildLineOption"
      />
      <!-- ONI 三维分布:year×season×ONI 立体柱阵(红暖蓝冷) -->
      <ChartCard
        title="ONI 三维分布"
        :height="460"
        class="span-2"
        :loading="loading"
        :build-option="build3DOption"
      />
    </div>

    <el-card v-loading="loading" shadow="never">
      <template #header>
        <span>逐年 12 个三月滑动季 ONI 指数（{{ selectedYear == null ? rows.length + ' 年 · 1950–2026 可滑动浏览' : selectedYear + ' 年' }}）</span>
      </template>
      <el-table :data="shown" height="560" size="small" border>
        <el-table-column prop="year" label="年份" width="80" fixed align="center" />
        <el-table-column
          v-for="s in SEASONS"
          :key="s"
          :prop="s"
          :label="SEASON_LABEL[s]"
          width="72"
          align="center"
        >
          <template #default="{ row }">
            <div class="cell" :style="cellStyle(row[s])">{{ row[s] }}</div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.page { padding: 20px 24px; }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
.crumb { color: var(--el-text-color-secondary); font-size: 13px; }
.page-head h2 { margin: 4px 0 0; font-size: 20px; }
.head-right { display: flex; align-items: center; gap: 16px; }
.legend { color: var(--el-text-color-regular); font-size: 13px; display: flex; align-items: center; gap: 6px; }
.chip { width: 14px; height: 14px; border-radius: 3px; display: inline-block; margin-left: 10px; }
.chip.warm { background: rgba(245, 108, 108, 0.5); }
.chip.cool { background: rgba(64, 158, 255, 0.5); }
.cell { margin: -6px -10px; padding: 6px 10px; }
.mb { margin-bottom: 12px; }
.src { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 12px; }
.src code { color: var(--el-color-primary); }
</style>
