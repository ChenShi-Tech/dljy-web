<script setup lang="ts">
// 预测质量记分牌（#763 PR-2 用户可见层）：把 rolling_report 离线回测产物
// （data/generated/forecast-report/<region>-*.json，由 `npm run report:forecast-yunnan` 生成）
// 变成一屏可读的「每个模型相对基线到底好多少、能不能信」。
//   · 模型×指标表：MAE/RMSE/MASE/skill vs LEAR/skill vs 季节朴素/过门禁/过 skill 门；
//     打不败基线（passes_skill_gate=false）的模型行标红——不发「可升 production」假信号。
//   · 概率指标卡：pinball/PICP/PINAW/CRPS≈/Winkler。
//   · leakage_caveats：era5 实况 / gap 前视泄漏警示原文呈现（诚实标注，绝不吞）。
//   · basis 标注：report.basis=synthetic → 显著「合成数据·不代表真实精度」横幅（DataBasisBadge）。
//   · 近 N 日趋势：per_day 逐日 MASE/MAE 折线（图表纪律：不平滑、缺测断点 connectNulls=false）。
// 诚实边界：available=false（无产物）→ 空态提示先跑离线报告，绝不回退假数据。
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  fetchForecastScoreboard,
  type ScoreboardResponse, type ScoreboardRun, type ScoreboardModelMetrics,
} from '@/services/forecast/mlForecastClient'
import type { DataBasis } from '@/services/dataBasis'
import { selectedRegionId } from '@/services/region/regionContext'
import DataBasisBadge from '@/components/DataBasisBadge.vue'
import { useEChart } from '../../composables/useEChart'
import { chartChrome, cssVar } from '../../composables/useTheme'
import { axisTooltip, chartToolbox, emptyOverlay, insideZoom, fmtNum } from '@/services/chart/chartOptions'

// 报告 overall 同时含模型与基线；基线是「参照系」，不参与「打不败即标红」判定。
const BASELINE_IDS = new Set(['naive_1d', 'naive_7d', 'knn', 'elastic_persist', 'lear'])
const BASELINE_LABEL: Record<string, string> = {
  naive_1d: 'Naive-1d（昨日同时段）',
  naive_7d: '季节朴素（上周同日）',
  knn: 'KNN 相似日',
  elastic_persist: '弹性调整持续性',
  lear: 'LEAR（Lasso+AR）',
}
const RUN_LABEL: Record<string, string> = {
  full: 'full（含当日基本面 · 精度上界）',
  lag_only: 'lag_only（仅价格滞后+时间 · 无基本面泄漏）',
}

const loading = ref(false)
const data = ref<ScoreboardResponse | null>(null)
const activeRun = ref<string>('full')
const trendMetric = ref<'mase' | 'mae'>('mase')

const chartRef = ref<HTMLDivElement | null>(null)
const chart = useEChart(chartRef, { render })

const report = computed(() => (data.value?.available ? data.value.report ?? null : null))
const runKeys = computed(() => (report.value ? Object.keys(report.value.runs) : []))
const currentRun = computed<ScoreboardRun | null>(() => report.value?.runs?.[activeRun.value] ?? null)

// basis 归一（report.basis ∈ real|captured|illustrative|synthetic）；未知保守回落 synthetic。
const basis = computed<DataBasis>(() => {
  const b = String(report.value?.basis ?? 'synthetic')
  return (['real', 'captured', 'illustrative', 'synthetic'].includes(b) ? b : 'synthetic') as DataBasis
})
const isSynthetic = computed(() => basis.value !== 'captured' && basis.value !== 'real')

// 模型行优先于基线行；模型内/基线内各自按 skill_vs_lear 降序（打不败的沉底），null 垫最后。
type Row = ScoreboardModelMetrics & { id: string; label: string; isBaseline: boolean }
const rows = computed<Row[]>(() => {
  const overall = currentRun.value?.overall ?? {}
  const list: Row[] = Object.entries(overall).map(([id, m]) => ({
    ...m,
    id,
    isBaseline: BASELINE_IDS.has(id),
    label: BASELINE_IDS.has(id) ? (BASELINE_LABEL[id] ?? id) : id,
  }))
  const rank = (v: number | null | undefined) => (v === null || v === undefined ? -Infinity : v)
  return list.sort((a, b) => {
    if (a.isBaseline !== b.isBaseline) return a.isBaseline ? 1 : -1
    return rank(b.skill_vs_lear) - rank(a.skill_vs_lear)
  })
})
// 参与趋势图的模型（非基线），最多取前 6 条避免图太挤。
const trendModels = computed(() => rows.value.filter((r) => !r.isBaseline).map((r) => r.id).slice(0, 6))

const skillRefs = computed(() =>
  (currentRun.value?.skill_gate_references ?? []).map((r) => BASELINE_LABEL[r] ?? r).join(' + '))
const caveats = computed(() => currentRun.value?.leakage_caveats ?? [])
const quant = computed(() => currentRun.value?.quantiles ?? null)
const meta = computed(() => currentRun.value?.meta ?? null)

function fnum(v: number | null | undefined, nd = 2): string {
  return v === null || v === undefined || Number.isNaN(v) ? '—' : fmtNum(v, nd)
}
function rowClass({ row }: { row: Row }): string {
  if (row.isBaseline) return 'baseline-row'
  return row.passes_skill_gate ? '' : 'fail-skill-row'   // 打不败基线的模型标红
}

// 请求世代守卫（roborev job646 Medium）：快速切地区时旧响应可能覆盖新地区状态。
// 发请求前抓 gen + region 快照，写入前断言仍是最新世代且地区未变，否则丢弃旧响应。
let generation = 0
async function load() {
  const gen = ++generation
  const regionId = selectedRegionId.value
  loading.value = true
  try {
    const res = await fetchForecastScoreboard(regionId)
    if (gen !== generation || selectedRegionId.value !== regionId) return   // 旧响应，丢弃
    data.value = res
    const keys = res.available && res.report ? Object.keys(res.report.runs) : []
    activeRun.value = keys.includes('full') ? 'full' : (keys[0] ?? 'full')
    // 图表容器 chartRef 在 v-else-if="report" 分支：数据刚赋值时该分支尚未挂载，chartRef 仍为 null。
    // 必须等 DOM 打补丁后再 render，否则首载趋势图空白（roborev job641 Medium 渲染竞态）。
    await nextTick()
    if (gen !== generation || selectedRegionId.value !== regionId) return   // await 期间又切地区，丢弃
    render()
  } catch (error) {
    if (gen !== generation) return
    data.value = null
    ElMessage.error(error instanceof Error ? error.message : '加载记分牌失败')
  } finally {
    if (gen === generation) loading.value = false   // 仅最新世代收尾 loading，避免旧请求提前清态
  }
}

function render() {
  const cc = chartChrome()
  const run = currentRun.value
  const perDay = run?.per_day ?? []
  const hasData = perDay.length > 0 && trendModels.value.length > 0
  const labels = perDay.map((r) => String(r.date ?? r.day_idx ?? ''))
  const palette = ['#409eff', '#e6a23c', '#67c23a', '#f56c6c', '#909399', '#b37feb']
  const metricName = trendMetric.value === 'mase' ? 'MASE vs naive_1d' : 'MAE（元/MWh）'
  const series = trendModels.value.map((id, i) => ({
    name: id,
    type: 'line' as const,
    // 图表纪律：不平滑、缺测断点（模型某日缺席则该点 null 断线，不 connectNulls 伪造连续）。
    smooth: false,
    connectNulls: false,
    showSymbol: false,
    data: perDay.map((r) => {
      const v = r[`${id}_${trendMetric.value}`]
      return typeof v === 'number' && !Number.isNaN(v) ? v : null
    }),
    lineStyle: { width: 1.6, color: palette[i % palette.length] },
    itemStyle: { color: palette[i % palette.length] },
  }))

  chart.setOption({
    ...emptyOverlay(!hasData, '暂无逐日明细（先跑 npm run report:forecast-yunnan 生成报告）'),
    legend: { top: 4, left: 10, data: trendModels.value, textStyle: { fontSize: 11 } },
    tooltip: { ...axisTooltip({ digits: 3 }), confine: true },
    toolbox: chartToolbox(`预测记分牌·逐日${trendMetric.value.toUpperCase()}`),
    dataZoom: insideZoom(),
    grid: { left: 52, right: 20, top: hasData ? 40 : 20, bottom: 28 },
    xAxis: { type: 'category', data: labels, boundaryGap: false, axisLabel: { fontSize: 10, color: cc.axisLabel } },
    yAxis: {
      type: 'value', name: metricName, min: trendMetric.value === 'mase' ? 0 : undefined,
      nameTextStyle: { color: cc.axisLabel, fontSize: 10 },
      axisLabel: { fontSize: 10, color: cc.axisLabel },
      splitLine: { lineStyle: { color: cc.splitLine } },
    },
    series: [
      ...series,
      // MASE=1 基准参考线（<1 = 优于 naive_1d）；仅 MASE 口径显示。
      ...(hasData && trendMetric.value === 'mase' ? [{
        name: 'MASE=1', type: 'line' as const, data: labels.map(() => 1), symbol: 'none', silent: true,
        lineStyle: { type: 'dashed' as const, color: cssVar('--el-color-info') || '#909399', width: 1 },
      }] : []),
    ],
  }, { notMerge: true })
}

// flush:'post' 让 render 在 DOM 更新后执行（口径/指标切换时容器已就绪，与首载 nextTick 同一防竞态口径）。
watch([activeRun, trendMetric], render, { flush: 'post' })
watch(selectedRegionId, load)
onMounted(load)
</script>

<template>
  <div class="scoreboard" v-loading="loading">
    <!-- 顶部说明 + 数据口径横幅 -->
    <el-alert :closable="false" show-icon class="mb"
      :type="!report ? 'warning' : (isSynthetic ? 'error' : 'success')">
      <template #title>
        <span v-if="!report">
          预测质量记分牌：读离线滚动回测产物（<code>data/generated/forecast-report/</code>），
          回答「每个模型相对基线好多少、能不能信」。当前无产物。
        </span>
        <span v-else-if="isSynthetic">
          <b>⚠️ 合成数据回测</b>——指标只验证链路，<b>不代表真实精度</b>；换真实采集数据（云南全年）前不得据此宣称生产精度。
        </span>
        <span v-else>
          真实采集回放回测：指标可作模型可信度参照（升 production 仍以 skill 门禁为准）。
        </span>
        <DataBasisBadge v-if="report" :basis="basis" prefix="数据口径" style="margin-left: 8px" />
      </template>
    </el-alert>

    <!-- 空态：无产物，诚实提示，不回退假数据 -->
    <el-empty v-if="!loading && !report"
      description="未找到滚动回测报告产物（该地区）">
      <template #image><span style="font-size: var(--font-48)">📉</span></template>
      <div class="empty-hint">
        <p>在主仓库 agent-backend 环境下运行离线报告生成：</p>
        <p><code>npm run report:forecast-yunnan -- --gap 1 --min-train-days 12 --refit-every 5</code></p>
        <p>产物落 <code>data/generated/forecast-report/&lt;region&gt;-&lt;range&gt;-&lt;ts&gt;.json</code>（gitignored），刷新本页即显示。</p>
        <el-button size="small" @click="load" style="margin-top: 8px">重新加载</el-button>
      </div>
    </el-empty>

    <template v-else-if="report">
      <!-- 报告头部信息 -->
      <div class="head-meta">
        <span>地区 <b>{{ report.region_id }}</b></span>
        <span>数据 <b>{{ report.date_range[0] }} ~ {{ report.date_range[1] }}</b>（{{ report.n_days }} 天）</span>
        <span v-if="meta">窗口 expanding · refit_every={{ meta.refit_every }} · min_train_days={{ meta.min_train_days }} · gap={{ meta.gap_days }}</span>
        <span class="gen">生成于 {{ report.generated_at }}</span>
      </div>

      <!-- 口径切换 full / lag_only -->
      <div class="toolbar">
        <span class="lbl">特征口径</span>
        <el-radio-group v-model="activeRun" size="small">
          <el-radio-button v-for="k in runKeys" :key="k" :value="k">{{ RUN_LABEL[k] ?? k }}</el-radio-button>
        </el-radio-group>
        <span class="spacer" />
        <span class="hint">skill 门禁参照基线：<b>{{ skillRefs || '—' }}</b>（须同时打败方 passes_skill_gate）</span>
      </div>

      <!-- 前视泄漏警示（原文呈现，绝不吞） -->
      <el-alert v-for="(c, i) in caveats" :key="i" type="warning" :closable="false" show-icon class="caveat"
        :title="c" />

      <!-- 模型×指标表 -->
      <el-card shadow="never" class="card">
        <template #header>
          <div class="card-head">
            <span class="ttl">模型 × 指标（{{ RUN_LABEL[activeRun] ?? activeRun }}）</span>
            <span class="note" v-if="currentRun?.gate_basis === 'mase_only'">
              本口径 KNN 画像自带基本面泄漏，「vs KNN 提升%」仅参考不计门禁；过门禁=MASE&lt;1.0 单条件。
            </span>
          </div>
        </template>
        <el-table :data="rows" size="small" :row-class-name="rowClass" style="width: 100%">
          <el-table-column label="模型 / 基线" min-width="180">
            <template #default="{ row }">
              <span>{{ row.label }}</span>
              <el-tag v-if="row.isBaseline" size="small" type="info" effect="plain" class="tag">基线</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="MAE" width="88" align="right">
            <template #default="{ row }">{{ fnum(row.mae) }}</template>
          </el-table-column>
          <el-table-column label="RMSE" width="88" align="right">
            <template #default="{ row }">{{ fnum(row.rmse) }}</template>
          </el-table-column>
          <el-table-column label="MASE" width="80" align="right">
            <template #default="{ row }">{{ fnum(row.mase_vs_naive, 3) }}</template>
          </el-table-column>
          <el-table-column label="skill vs LEAR" width="118" align="right">
            <template #default="{ row }">
              <span :class="{ neg: (row.skill_vs_lear ?? 0) <= 0 && !row.isBaseline }">{{ fnum(row.skill_vs_lear, 3) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="skill vs 季节naive" width="140" align="right">
            <template #default="{ row }">
              <span :class="{ neg: (row.skill_vs_seasonal_naive ?? 0) <= 0 && !row.isBaseline }">{{ fnum(row.skill_vs_seasonal_naive, 3) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="过门禁" width="76" align="center">
            <template #default="{ row }">
              <el-tag v-if="!row.isBaseline" :type="row.passes_gate ? 'success' : 'info'" size="small" effect="plain">
                {{ row.passes_gate ? '✓' : '—' }}
              </el-tag>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="过 skill 门" width="90" align="center">
            <template #default="{ row }">
              <el-tag v-if="!row.isBaseline" :type="row.passes_skill_gate ? 'success' : 'danger'" size="small" effect="dark">
                {{ row.passes_skill_gate ? '可信' : '未过' }}
              </el-tag>
              <span v-else class="muted">基准</span>
            </template>
          </el-table-column>
          <el-table-column label="测试日" width="72" align="right">
            <template #default="{ row }">{{ row.n_days }}</template>
          </el-table-column>
        </el-table>
        <div class="legend-note">
          <span>skill = 1 − 模型MAE/基线MAE（&gt;0 = 打败该基线）；</span>
          <span>过 skill 门 = 同时打败 LEAR 与季节朴素且两基线全覆盖测试日；</span>
          <span class="red">红行 = 打不败基线，不可升 production。</span>
        </div>
      </el-card>

      <!-- 概率指标卡 -->
      <el-card shadow="never" class="card" v-if="quant">
        <template #header><span class="ttl">概率指标（LightGBM P10/P50/P90 分位）</span></template>
        <div class="stats">
          <div class="stat-card"><div class="stat-label">Pinball</div><div class="stat-value">{{ fnum(quant.pinball) }}</div></div>
          <div class="stat-card"><div class="stat-label">PICP（名义 0.8）</div><div class="stat-value">{{ fnum(quant.picp, 3) }}</div></div>
          <div class="stat-card"><div class="stat-label">PINAW</div><div class="stat-value">{{ fnum(quant.pinaw, 3) }}</div></div>
          <div class="stat-card"><div class="stat-label">CRPS≈</div><div class="stat-value">{{ fnum(quant.crps_approx) }}</div></div>
          <div class="stat-card"><div class="stat-label">Winkler</div><div class="stat-value">{{ fnum(quant.winkler) }}</div></div>
        </div>
      </el-card>

      <!-- 近 N 日趋势 -->
      <el-card shadow="never" class="card">
        <template #header>
          <div class="card-head">
            <span class="ttl">逐日趋势（各模型）</span>
            <el-radio-group v-model="trendMetric" size="small">
              <el-radio-button value="mase">MASE</el-radio-button>
              <el-radio-button value="mae">MAE</el-radio-button>
            </el-radio-group>
          </div>
        </template>
        <div ref="chartRef" class="chart"></div>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.scoreboard { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.mb { margin-bottom: 12px; }
.scoreboard code { font-size: var(--font-sm); background: var(--el-fill-color); padding: 1px 5px; border-radius: 4px; }
.head-meta { display: flex; flex-wrap: wrap; gap: 16px; font-size: var(--font-sm); color: var(--el-text-color-regular); margin: 8px 2px 12px; }
.head-meta .gen { color: var(--el-text-color-secondary); margin-left: auto; }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); flex-wrap: wrap; margin-bottom: 12px; }
.toolbar .lbl { font-size: var(--font-md); color: var(--el-text-color-regular); font-weight: 600; }
.toolbar .spacer { flex: 1; }
.toolbar .hint { font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.caveat { margin-bottom: 10px; }
.caveat :deep(.el-alert__title) { font-size: var(--font-sm); line-height: 1.5; }
.card { margin-bottom: 12px; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.ttl { font-weight: 600; font-size: var(--font-md); }
.note { font-size: var(--font-sm); color: var(--el-color-warning); font-weight: 400; }
.tag { margin-left: 6px; }
.muted { color: var(--el-text-color-secondary); }
.neg { color: var(--el-color-danger); font-weight: 600; }
.legend-note { font-size: var(--font-sm); color: var(--el-text-color-secondary); margin-top: 8px; display: flex; gap: 10px; flex-wrap: wrap; }
.legend-note .red { color: var(--el-color-danger); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; }
.stat-card { background: var(--el-bg-color-overlay, #fff); border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; padding: 12px 14px; }
.stat-label { color: var(--el-text-color-secondary, #909399); font-size: var(--font-sm); margin-bottom: 6px; }
.stat-value { font-size: var(--font-20); font-weight: 600; }
.chart { height: 320px; width: 100%; }
.empty-hint { font-size: var(--font-sm); color: var(--el-text-color-secondary); text-align: left; max-width: 640px; }
.empty-hint p { margin: 4px 0; }
:deep(.fail-skill-row) { background: var(--el-color-danger-light-9, #fef0f0); }
:deep(.fail-skill-row:hover > td) { background: var(--el-color-danger-light-8, #fde2e2) !important; }
:deep(.baseline-row) { color: var(--el-text-color-secondary); font-style: italic; }
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
  .head-meta .gen { margin-left: 0; }
}
</style>
