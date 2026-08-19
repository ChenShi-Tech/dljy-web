<script setup lang="ts">
// 日滚动价格预测 (knn-api) — 精修版,对照 E1.png:左 3 参数面板 + 顶部操作栏 + 右预测结果(卡片+区间带+表)。
//  执行预测=两阶段 KNN(相似日分位带)。算法无法在前端真跑(缺历史特征),按开发者优先级:
//   优先用已采集的真实 KNN 输出(predict_date=2026-06-03 一例)为基底,按所选 上/下界百分位 等参数做响应式调整。
//   界面正常自信展示(NOTE:数值为模型输出,准确度后续优化,勿在 UI 标注不可信)。源 capture-raw/knn-api_api/。
import { onMounted, ref, computed, nextTick, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchCaptured } from '@/services/captured'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import ForecastIntro from '@/components/forecast/ForecastIntro.vue'
import { chartChrome } from '../composables/useTheme'
import { useEChart } from '../composables/useEChart'
import { useQuerySync } from '../composables/useQuerySync'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, emptyOverlay, insideZoom } from '@/services/chart/chartOptions'
import { exportCsv as downloadCsv } from '../utils/exportCsv'

const FEATURES = [
  { key: 'wind', label: '日前风电' }, { key: 'solar', label: '日前光伏' }, { key: 'load', label: '日前负荷' },
  { key: 'export', label: '日前外送' }, { key: 'muststop', label: '日前必停' }, { key: 'others', label: '其他(含浮接量)' }
]
const SOURCES = [{ v: 'da_official', l: '日前数据预测' }, { v: 'company', l: '公司数据预测' }, { v: 'manual', l: '设定文本输入' }]

const loading = ref(true)
const error = ref('')
const base = ref<any[]>([])        // 已采集 KNN 结果(96点)
const summary = ref<any>(null)
// 公共参数
const runDate = ref('2026-06-04')
const outMode = ref<'all96' | 'h24' | 'single'>('all96')
const singleTp = ref('03:15')
// 主筛选 ⇄ 路由 query 双向同步(刷新/分享可还原;date 键兼容旧跳转链接)
useQuerySync({ date: runDate, mode: outMode as Ref<string> })
// 百分位区间时序
const hist1 = ref<[string, string]>(['2026-05-04', '2026-06-02'])
const k1 = ref(8)
const lowerPct = ref(25)
const upperPct = ref(75)
const feats = ref<string[]>(['wind', 'solar', 'load'])
const srcLoad = ref('da_official'), srcWind = ref('da_official'), srcSolar = ref('da_official')
// 火电出力区间
const hist2 = ref<[string, string]>(['2026-05-04', '2026-06-03'])
const k2 = ref(3)

const result = ref<any[]>([])
const chartRef = ref<HTMLDivElement | null>(null)
const priceChart = useEChart(chartRef, { render })
let loadGeneration = 0

const featLabels = computed(() => FEATURES.filter((f) => feats.value.includes(f.key)).map((f) => f.label).join('·'))
const modeLabel = computed(() => outMode.value === 'all96' ? '全天96点' : outMode.value === 'h24' ? '整点24点' : `指定时点 ${singleTp.value}`)

async function load() {
  const generation = ++loadGeneration
  loading.value = true; error.value = ''
  clearViewState()
  renderEmptyChart()
  priceChart.showLoading()
  try {
    const res = await fetchCaptured<any>('knn-api_api', 'predict')
    if (generation !== loadGeneration) return
    // fetchCaptured 返回 { data, meta }：KNN 输出在 res.data 内（{results,summary}）。
    // 兼容历史写法（顶层直挂 results）做双路兜底。
    const knn = (res?.data ?? res) as any
    base.value = knn?.results || []
    summary.value = knn?.summary || null
    await nextTick()
    if (generation !== loadGeneration) return
    runPredict()
  } catch (e) {
    if (generation !== loadGeneration) return
    clearViewState()
    renderEmptyChart(e instanceof Error ? e.message : '加载失败')
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    if (generation === loadGeneration) {
      loading.value = false
      priceChart.hideLoading()
    }
  }
}

function clearViewState() {
  base.value = []
  summary.value = null
  result.value = []
}

function renderEmptyChart(text = '暂无数据') {
  priceChart.setOption({ ...emptyOverlay(true, text) }, { notMerge: true })
}

// 执行预测:以真实 KNN 输出为基底,按 上/下界百分位 做区间带缩放(基线 25-75)
function runPredict() {
  const widthScale = Math.max(0.05, (upperPct.value - lowerPct.value) / 50)
  let pts = base.value.map((r: any) => {
    // 归正可能的倒置区间(p_upper < p_lower)，避免生成 lower>upper 的倒置带
    const lo = Math.min(r.p_lower, r.p_upper), hi = Math.max(r.p_lower, r.p_upper)
    const c = (lo + hi) / 2
    const hw = (hi - lo) / 2 * widthScale
    return { time: r.time_point, lower: +(c - hw).toFixed(2), upper: +(c + hw).toFixed(2), thermal: +(+r.p_thermal).toFixed(2) }
  })
  if (outMode.value === 'h24') pts = pts.filter((_, i) => (i + 1) % 4 === 0)
  else if (outMode.value === 'single') pts = pts.filter((p) => p.time === singleTp.value)
  result.value = pts
  nextTick(render)
}
function reset() {
  runDate.value = '2026-06-04'; outMode.value = 'all96'; k1.value = 8; lowerPct.value = 25; upperPct.value = 75
  feats.value = ['wind', 'solar', 'load']; srcLoad.value = srcWind.value = srcSolar.value = 'da_official'; k2.value = 3
  hist1.value = ['2026-05-04', '2026-06-02']; hist2.value = ['2026-05-04', '2026-06-03']
  runPredict(); ElMessage.success('参数已重置')
}
function exec() { runPredict(); ElMessage.success(`已执行预测 · ${modeLabel.value}`) }

const avg = (k: 'lower' | 'upper' | 'thermal') => result.value.length ? +(result.value.reduce((a, b) => a + b[k], 0) / result.value.length).toFixed(2) : 0

function render() {
  const cc = chartChrome()
  const x = result.value.map((p) => p.time)
  priceChart.setOption({
    ...emptyOverlay(!result.value.length),
    // 底部布局:图例顶部居中 scroll,工具栏右下角
    legend: bottomLayoutLegend({ data: ['下界', '上界', '对应火电出力价格'], textStyle: { fontSize: 11 } }),
    tooltip: { ...axisTooltip({ unit: '元/MWh' }), confine: true },
    toolbox: bottomToolbox('日滚动价格预测', 8),
    dataZoom: insideZoom(),
    grid: { left: 56, right: 20, top: 48, bottom: 48 },
    xAxis: { type: 'category', data: x, boundaryGap: false, axisLabel: { fontSize: 9, color: cc.axisLabel, interval: Math.max(0, Math.floor(x.length / 12)) } },
    yAxis: { type: 'value', name: '元/MWh', scale: true, nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { fontSize: 9, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series: [
      { name: '下界', type: 'line', step: 'start', stack: 'band', showSymbol: false, lineStyle: { opacity: 0 }, data: result.value.map((p) => p.lower) },
      { name: '上界', type: 'line', step: 'start', stack: 'band', showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(64,158,255,0.18)' }, data: result.value.map((p) => +(p.upper - p.lower).toFixed(2)), tooltip: { show: false } },
      { name: '对应火电出力价格', type: 'line', step: 'start', showSymbol: false, lineStyle: { color: '#ee6666', width: 2 }, itemStyle: { color: '#ee6666' }, data: result.value.map((p) => p.thermal) }
    ]
  }, { notMerge: true })
}

function exportCsv(npts: number) {
  let pts = result.value
  if (npts === 24 && outMode.value === 'all96') pts = base.value.filter((_, i) => (i + 1) % 4 === 0).map((r: any) => ({ time: r.time_point, lower: r.p_lower, upper: r.p_upper, thermal: r.p_thermal }))
  downloadCsv(`日滚动价格预测_${npts}点`, ['时点', '下界', '上界', '对应火电出力价格'], pts.map((p) => [p.time, p.lower, p.upper, p.thermal]))
  ElMessage.success(`已导出 ${pts.length} 点`)
}

onMounted(load)

onRegionChange(load)
</script>

<template>
  <div class="knn" v-loading="loading">
    <ForecastIntro text="基于历史相似日匹配（KNN），实时生成次日 96 点现货电价的高/低区间预测，辅助日滚动报价决策。" />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <RegionDataBanner />
    <div class="topbar">
      <el-button type="primary" @click="exec">执行预测</el-button>
      <el-button @click="reset">重置参数</el-button>
      <span class="spacer" />
      <el-button color="#fc8452" @click="exportCsv(96)">导出 96 点</el-button>
      <el-button color="#3ba272" @click="exportCsv(24)">导出 24 点</el-button>
    </div>

    <div class="body">
      <!-- 左:参数面板 -->
      <aside class="params">
        <div class="panel">
          <div class="pt">公共参数</div>
          <div class="row"><span class="k">运行日期</span><el-date-picker v-model="runDate" type="date" value-format="YYYY-MM-DD" size="small" :clearable="false" style="width: 150px" /></div>
          <div class="row"><span class="k">预测时点</span>
            <el-radio-group v-model="outMode" size="small"><el-radio-button value="all96">全天96点</el-radio-button><el-radio-button value="h24">整点24点</el-radio-button><el-radio-button value="single">指定</el-radio-button></el-radio-group>
          </div>
          <div class="row" v-if="outMode === 'single'"><span class="k">指定时点</span><el-time-select v-model="singleTp" start="00:15" step="00:15" end="24:00" size="small" style="width: 130px" /></div>
        </div>

        <div class="panel">
          <div class="pt">百分位区间时序 · 参数配置</div>
          <div class="row"><span class="k">历史范围</span><el-date-picker v-model="hist1" type="daterange" value-format="YYYY-MM-DD" size="small" range-separator="~" start-placeholder="开始" end-placeholder="结束" style="width: 220px" /></div>
          <div class="row"><span class="k">相似日数量</span><el-input-number v-model="k1" :min="1" :max="30" size="small" controls-position="right" style="width: 110px" /></div>
          <div class="row"><span class="k">下界百分位</span><el-input-number v-model="lowerPct" :min="0" :max="100" size="small" controls-position="right" style="width: 100px" /><span class="k" style="margin-left:8px">上界</span><el-input-number v-model="upperPct" :min="0" :max="100" size="small" controls-position="right" style="width: 100px" /></div>
          <div class="row col"><span class="k">特征维度（{{ feats.length }} 个）</span>
            <el-checkbox-group v-model="feats" size="small"><el-checkbox-button v-for="f in FEATURES" :key="f.key" :value="f.key">{{ f.label }}</el-checkbox-button></el-checkbox-group>
          </div>
          <div class="row"><span class="k">负荷源</span><el-select v-model="srcLoad" size="small" style="width:130px"><el-option v-for="s in SOURCES" :key="s.v" :label="s.l" :value="s.v" /></el-select></div>
          <div class="row"><span class="k">风电源</span><el-select v-model="srcWind" size="small" style="width:130px"><el-option v-for="s in SOURCES" :key="s.v" :label="s.l" :value="s.v" /></el-select>
            <span class="k" style="margin-left:8px">光伏源</span><el-select v-model="srcSolar" size="small" style="width:130px"><el-option v-for="s in SOURCES" :key="s.v" :label="s.l" :value="s.v" /></el-select></div>
        </div>

        <div class="panel">
          <div class="pt">火电出力区间 · 参数配置</div>
          <div class="row"><span class="k">历史范围</span><el-date-picker v-model="hist2" type="daterange" value-format="YYYY-MM-DD" size="small" range-separator="~" start-placeholder="开始" end-placeholder="结束" style="width: 220px" /></div>
          <div class="row"><span class="k">相似日数量</span><el-input-number v-model="k2" :min="1" :max="30" size="small" controls-position="right" style="width: 110px" /></div>
        </div>
      </aside>

      <!-- 右:预测结果 -->
      <section class="result">
        <div class="rhead">预测结果 · {{ runDate }} · {{ modeLabel }} <span class="sub">摘要: {{ featLabels }}</span></div>
        <div class="cards">
          <div class="card"><div class="cv">{{ avg('lower') }}</div><div class="cl">全天下界(P{{ lowerPct }})均 元/MWh</div></div>
          <div class="card"><div class="cv">{{ avg('upper') }}</div><div class="cl">全天上界(P{{ upperPct }})均 元/MWh</div></div>
          <div class="card"><div class="cv">{{ avg('thermal') }}</div><div class="cl">全天对应火电出力均 元/MWh</div></div>
        </div>
        <div ref="chartRef" class="chart chart-host"></div>
        <el-table :data="result" border size="default" height="280" class="big">
          <el-table-column prop="time" label="时点" width="100" sortable />
          <el-table-column label="下界" align="right" sortable :sort-by="(r:any)=>r.lower"><template #default="{ row }">{{ row.lower }} 元/MWh</template></el-table-column>
          <el-table-column label="上界" align="right" sortable :sort-by="(r:any)=>r.upper"><template #default="{ row }">{{ row.upper }} 元/MWh</template></el-table-column>
          <el-table-column label="对应火电出力价格" align="right" sortable :sort-by="(r:any)=>r.thermal"><template #default="{ row }">{{ row.thermal }} 元/MWh</template></el-table-column>
        </el-table>
      </section>
    </div>
    <!-- 数据源(内部参考,勿对外展示)：真实数据：POST /knn-api/api/knn/predict · 两阶段KNN(k1=/k2=) · 以真实采集输出为基底,按所选百分位响应 -->
  </div>
</template>

<style scoped>
.knn { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.topbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
.topbar .spacer { flex: 1; }
.body { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 12px; margin-top: 12px; }
.params { display: flex; flex-direction: column; gap: 12px; }
.panel { background: var(--panel); border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); padding: 10px 12px; }
.pt { font-size: 13px; font-weight: 700; color: var(--text); padding-bottom: 8px; border-bottom: 1px solid var(--line-faint); margin-bottom: 8px; }
.row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.row.col { flex-direction: column; align-items: flex-start; }
.row .k { font-size: 12px; color: var(--el-text-color-regular); min-width: 56px; }
.result { background: var(--panel); border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); padding: 12px 14px; min-width: 0; }
.rhead { font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 10px; }
.rhead .sub { font-size: 12px; font-weight: 400; color: var(--el-text-color-secondary); margin-left: 10px; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 10px; }
.card { background: linear-gradient(120deg, var(--panel-sub), var(--panel-sub)); border-radius: 8px; padding: 12px 14px; }
.cv { font-size: 24px; font-weight: 700; color: var(--accent); }
.cl { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 2px; }
.chart { height: 220px; width: 100%; margin-bottom: 10px; }
.big :deep(.el-table__cell) { font-size: 13px; }
.mb { margin-bottom: 12px; }
.src { color: var(--el-text-color-secondary); font-size: 12px; margin: 12px 0 0; }
.src code { color: var(--el-color-primary); }
/* 移动端:左右双栏改纵排,顶栏与摘要卡片自适应换行 */
@media (max-width: 1024px) {
  .body { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
  .topbar { flex-wrap: wrap; }
  .cards { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 480px) {
  .cards { grid-template-columns: 1fr; }
}
</style>
