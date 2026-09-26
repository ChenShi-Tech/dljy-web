<script setup lang="ts">
// 多日立体 · 双切面 · 日期×时段热力 工作区（dljy#3007 任务 6.8/6.9）
// ----------------------------------------------------------------------------
// 「时段走势」页签在单日走势之外的第二/第三种展示：多日三维折线、日期×时段热力，
// 右侧配双切面（所选日剖面 + 所选时点跨日切面），下方配证据表。
// 数据纪律：三维、两张切面、热力、证据表全部消费父级传入的同一份 profile 视图结果
// （与「历史分布」页签同一次查询，见页面 ensureTab），本组件不另发请求、不补点、
// 不插值；缺测时段线中断开、热力留空、表格「—」，负价原样。
// 前置拦截全部是「提示 + 用户显式操作」：
//   - 窗口不足 2 天 → 说明 + 「改为 {start}—{end} 共 7 天」按钮（点了才扩窗）；
//   - 多对象 → 「立体对象」下拉只能从已选对象（结果序列目录里出现的对象名）里选，
//     默认不选、未选不绘制，绝不替用户挑第一个（三维/热力都是单对象画面，多对象
//     的格子会有两个值，聚合等于造数）；
//   - 原生点超三维预算 → 不画三维（不截断），说明 + 「改看热力」按钮；
//   - WebGL 不可用 / 三维初始化抛错 → 自动退到同一数据的热力与二维切面（故障降级，
//     不是扩窗），提示条与证据说明如实写明。
import { computed, ref, watch } from 'vue'
import { formatMetricValue } from 'shared/insight/metrics.mjs'
import type { InsightBlockResult, InsightRequestError } from '@/services/insight/insightClient'
import { formatBeijingDateTime } from '@/components/insight/insightText'
import ChartCard from '@/components/common/ChartCard.vue'
import { useEChart } from '@/composables/useEChart'
import { seqColors, divergingColors } from '@/services/chart/chartStyle'
import Price3DScene from './Price3DScene.vue'
import {
  MAX_3D_NATIVE_POINTS,
  PHASE_LINE_COLOR,
  buildDayEvidence,
  buildDayProfile,
  buildHeatmap,
  buildLine3DSeries,
  buildPriceGrid,
  buildTimeOfDayEvidence,
  buildTimeOfDayProfile,
  defaultCrossSection,
  detectWebGL,
  objectNamesOf,
  selectObjectSeries,
  sevenDayWindowEndingAt,
  type PricePhase,
  type ProfileRow,
  type ProfileSeriesEntry,
} from './priceProfileModel'

const props = defineProps<{
  /** 当前展示模式（模式切换控件在页面层，本组件只渲染传入模式） */
  mode: 'multi3d' | 'heatmap'
  /** 所属页签是否激活：切走页签即卸载三维（释放 WebGL），热力为 2D 不受影响 */
  visible: boolean
  /** profile 视图结果（与「历史分布」页签同一份读取） */
  result: InsightBlockResult | null
  error: InsightRequestError | null
  loading: boolean
  /** 当前价格对象的对象维度（用户侧价为 null：无对象维度，直接画） */
  objectDimension: string | null
  /** 业务窗天数（<2 天拦截多日展示） */
  windowDayCount: number
  businessWindow: { start: string; end: string }
}>()

const emit = defineEmits<{
  /** 重试 profile 查询（错误态） */
  retry: []
  /** 单日窗口 → 用户点了「改为 7 天」：由页面 setBusinessWindow */
  'extend-window': [range: { start: string; end: string }]
  /** 超限后用户点「改看热力」/ WebGL 故障降级：页面切换展示模式 */
  'switch-mode': [mode: 'heatmap']
}>()

const MODE_LABEL: Record<'multi3d' | 'heatmap', string> = { multi3d: '多日立体', heatmap: '日期×时段热力' }

// ── WebGL 检测（结果缓存；detectWebGL 单独导出便于测试 mock）────────────────────────────

let webglCache: boolean | null = null
function webglAvailable(): boolean {
  webglCache ??= detectWebGL()
  return webglCache
}

/** 三维运行期初始化失败（echarts-gl 加载/初始化抛错）也并入降级，不反复重试刷屏。 */
const sceneFailed = ref(false)

const degraded = computed(() => props.mode === 'multi3d' && (!webglAvailable() || sceneFailed.value))

/** 实际渲染模式：三维被降级时退热力（同一份数据，双切面/证据表照常）。 */
const effectiveMode = computed<'multi3d' | 'heatmap'>(() => (degraded.value ? 'heatmap' : props.mode))

function onSceneInitError(): void {
  sceneFailed.value = true
}

// ── 结果 → 网格 ───────────────────────────────────────────────────────────────────────────

const rows = computed(() => (props.result?.data?.rows ?? []) as ProfileRow[])
const allSeries = computed(() => (props.result?.data?.series ?? []) as ProfileSeriesEntry[])

/** 结果序列目录里出现过的对象名（即本次查询的已选对象在该维度上的名字）。 */
const objectNames = computed(() => objectNamesOf(allSeries.value, props.objectDimension))

/** 多对象：必须显式选一个立体对象（默认不选、未选不绘制）。 */
const needsObjectPick = computed(() => objectNames.value.length > 1)

const stereoObject = ref<string | null>(null)
// 结果或对象集合变化后，已选立体对象可能已不在列表里：清掉（回到未选，不猜新对象）。
watch(objectNames, (names) => {
  if (stereoObject.value && !names.includes(stereoObject.value)) stereoObject.value = null
})

const selectedSeries = computed(() => selectObjectSeries(allSeries.value, stereoObject.value, props.objectDimension))
const grid = computed(() => buildPriceGrid(rows.value, selectedSeries.value))

// ── 拦截层 ───────────────────────────────────────────────────────────────────────────────

/** 多日展示（三维与热力）都需要至少 2 天窗口：说明 + 按钮，点了才扩窗。 */
const needsMultiDay = computed(() => props.windowDayCount < 2)
const sevenDayRange = computed(() => sevenDayWindowEndingAt(props.businessWindow.end))

/** 三维原生点预算：超限不画三维（不截断），说明 + 用户点「改看热力」。热力是 2D，不受此限。 */
const overLimit = computed(() => grid.value.rows.length > MAX_3D_NATIVE_POINTS)

// ── 剖面选择（默认 = 最后一天 + 该日最高价时点；用户点三维/热力/下拉即覆盖）──────────────

const sectionDateRef = ref<string | null>(null)
const sectionTimeRef = ref<string | null>(null)

const defaults = computed(() => defaultCrossSection(grid.value))

// 结果/立体对象变化 → 回到默认剖面（旧选择属于旧数据，不保留）。
watch(grid, () => {
  sectionDateRef.value = null
  sectionTimeRef.value = null
})

const effectiveDate = computed(() => {
  const chosen = sectionDateRef.value
  if (chosen && grid.value.dates.includes(chosen)) return chosen
  return defaults.value?.date ?? ''
})

const effectiveTime = computed(() => {
  const chosen = sectionTimeRef.value
  if (chosen && grid.value.timePoints.includes(chosen)) return chosen
  return defaults.value?.timeOfDay ?? ''
})

/** el-select 的可写绑定：清空 = 回默认（最后一天 / 该日最高价时点）。 */
const sectionDate = computed({
  get: () => effectiveDate.value,
  set: (value: string | number | boolean | undefined) => {
    sectionDateRef.value = typeof value === 'string' && value ? value : null
  },
})
const sectionTime = computed({
  get: () => effectiveTime.value,
  set: (value: string | number | boolean | undefined) => {
    sectionTimeRef.value = typeof value === 'string' && value ? value : null
  },
})

const isDefaultDate = computed(() => sectionDateRef.value === null && Boolean(defaults.value))
const isDefaultTime = computed(() => sectionTimeRef.value === null && Boolean(defaults.value))

/** 三维/热力点击某点 → 同步两个剖面选择。 */
function applyPointSelection(payload: { date: string; timeOfDay: string }): void {
  if (grid.value.dates.includes(payload.date)) sectionDateRef.value = payload.date
  if (grid.value.timePoints.includes(payload.timeOfDay)) sectionTimeRef.value = payload.timeOfDay
}

// ── 三维 ─────────────────────────────────────────────────────────────────────────────────

const lines = computed(() => buildLine3DSeries(grid.value))

// ── 热力（useEChart 托管；onInit 绑格子点击）────────────────────────────────────────────

const heatPhase = ref<PricePhase>('real-time') // 默认实时，可切日前
const heatBuild = computed(() => buildHeatmap(grid.value, heatPhase.value))

function heatTooltip(params: unknown): string {
  const value = (params as { value?: unknown }).value
  if (!Array.isArray(value)) return ''
  const date = grid.value.dates[Number(value[1])]
  const time = grid.value.timePoints[Number(value[0])]
  if (!date || !time) return ''
  const price = formatMetricValue('price.time-weighted-average', String(value[2]))
  return `${date} ${time}<br/>${price ?? '—'} 元/MWh`
}

const heatOption = computed(() => {
  const build = heatBuild.value
  if (!build) {
    // 该阶段在本次结果里没有任何时段：如实空态，不造格子。
    return { xAxis: { type: 'category', data: [] }, yAxis: { type: 'category', data: [] }, series: [] }
  }
  const useDiverging = build.min < 0
  // 负价：发散色带且 0 居中 → visualMap 端点对称到 ±max(|min|,|max|)；真实区间在
  // 底部证据说明里如实标注。无负价：顺序色带，端点就是真实极值。
  const bound = Math.max(Math.abs(build.min), Math.abs(build.max))
  return {
    tooltip: { position: 'top', formatter: heatTooltip },
    grid: { left: 8, right: 16, top: 8, bottom: 56, containLabel: true },
    xAxis: { type: 'category', data: grid.value.timePoints, splitArea: { show: true }, axisLabel: { fontSize: 9 } },
    yAxis: { type: 'category', data: grid.value.dates, axisLabel: { fontSize: 9 } },
    visualMap: {
      type: 'continuous',
      min: useDiverging ? -bound : build.min,
      max: useDiverging ? bound : build.max,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 10,
      itemHeight: 110,
      inRange: { color: useDiverging ? divergingColors() : seqColors() },
      textStyle: { fontSize: 10 },
    },
    series: [
      {
        type: 'heatmap',
        data: build.cells,
        itemStyle: { borderColor: 'rgba(255,255,255,0.45)' },
        emphasis: { itemStyle: { shadowBlur: 4, shadowColor: 'rgba(0,0,0,0.3)' } },
      },
    ],
  }
})

const heatRef = ref<HTMLDivElement | null>(null)
const heatChart = useEChart(heatRef, {
  onInit: (chart) => {
    chart.on('click', (params: unknown) => {
      const value = (params as { value?: unknown }).value
      if (!Array.isArray(value)) return
      applyPointSelection({
        date: grid.value.dates[Number(value[1])] ?? '',
        timeOfDay: grid.value.timePoints[Number(value[0])] ?? '',
      })
    })
  },
  render: () => {
    heatChart.setOption(heatOption.value, true)
  },
})

watch(heatOption, () => {
  heatChart.setOption(heatOption.value, true)
})

// ── 双切面 ───────────────────────────────────────────────────────────────────────────────

/** 所选日剖面：该日日前/实时两条阶梯线（时段值恒定，x 轴时点是起点标签 → step 'end'）。 */
const dayFacetOption = computed(() => {
  const facet = buildDayProfile(grid.value, effectiveDate.value)
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0, left: 8, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 } },
    grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: grid.value.timePoints, axisLabel: { fontSize: 9 } },
    yAxis: { type: 'value', name: '元/MWh', scale: true, axisLabel: { fontSize: 9 } },
    series: [
      {
        name: '日前',
        type: 'line',
        step: 'end',
        showSymbol: false,
        data: facet.da,
        lineStyle: { width: 1.8, color: PHASE_LINE_COLOR['day-ahead'] },
        itemStyle: { color: PHASE_LINE_COLOR['day-ahead'] },
      },
      {
        name: '实时',
        type: 'line',
        step: 'end',
        showSymbol: false,
        data: facet.rt,
        lineStyle: { width: 1.8, color: PHASE_LINE_COLOR['real-time'] },
        itemStyle: { color: PHASE_LINE_COLOR['real-time'] },
      },
    ],
  }
})

/** 所选时点跨日切面：各业务日同一时点的两条线（点与点是不同日，直线连接）。 */
const timeOfDayFacetOption = computed(() => {
  const facet = buildTimeOfDayProfile(grid.value, effectiveTime.value)
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0, left: 8, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 } },
    grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: grid.value.dates, axisLabel: { fontSize: 9, formatter: (v: string) => v.slice(5) } },
    yAxis: { type: 'value', name: '元/MWh', scale: true, axisLabel: { fontSize: 9 } },
    series: [
      {
        name: '日前',
        type: 'line',
        showSymbol: true,
        symbolSize: 5,
        data: facet.da,
        lineStyle: { width: 1.8, color: PHASE_LINE_COLOR['day-ahead'] },
        itemStyle: { color: PHASE_LINE_COLOR['day-ahead'] },
      },
      {
        name: '实时',
        type: 'line',
        showSymbol: true,
        symbolSize: 5,
        data: facet.rt,
        lineStyle: { width: 1.8, color: PHASE_LINE_COLOR['real-time'] },
        itemStyle: { color: PHASE_LINE_COLOR['real-time'] },
      },
    ],
  }
})

// ── 证据表 ───────────────────────────────────────────────────────────────────────────────

const evidenceView = ref<'day' | 'timeOfDay'>('day')

type EvidenceRow = {
  key: string
  intervalText: string
  dayAheadText: string
  realTimeText: string
  spreadText: string
}

function priceText(value: string | null): string {
  if (value === null) return '—'
  return formatMetricValue('price.time-weighted-average', value) ?? '—'
}

const evidenceRows = computed<EvidenceRow[]>(() => {
  const cells = evidenceView.value === 'day' ? buildDayEvidence(grid.value, effectiveDate.value) : buildTimeOfDayEvidence(grid.value, effectiveTime.value)
  return cells.map((cell) => ({
    key: cell.key,
    intervalText:
      cell.intervalStart && cell.intervalEnd
        ? `${formatBeijingDateTime(cell.intervalStart)} ~ ${formatBeijingDateTime(cell.intervalEnd)}`
        : '—',
    dayAheadText: priceText(cell.dayAhead),
    realTimeText: priceText(cell.realTime),
    spreadText: priceText(cell.spread),
  }))
})

// ── 证据说明（口径与降级如实写明）────────────────────────────────────────────────────────

const sameReadText = computed(() => {
  const result = props.result
  if (!result) return ''
  return `本次画面（三维/热力/双切面/证据表）与「历史分布」页签共用同一份查询结果（结果版本 ${result.resultVersion}），不另发请求`
})

const heatRangeText = computed(() => {
  const build = heatBuild.value
  if (!build) return ''
  return `热力真实区间 ${build.min} ~ ${build.max} 元/MWh${build.min < 0 ? '（色带以 0 为中心对称，便于分辨正负价）' : ''}`
})

function onExtendWindow(): void {
  emit('extend-window', sevenDayRange.value)
}
</script>

<template>
  <div class="p3w" data-testid="ynp-price-3d-workspace">
    <!-- 查询错误：如实展示原因 + 重试 -->
    <el-alert v-if="props.error" type="error" show-icon :closable="false" :title="props.error.message">
      <el-button size="small" data-testid="ynp-3dw-retry" @click="emit('retry')">重试</el-button>
    </el-alert>

    <el-alert v-else-if="props.loading" type="info" :closable="false" title="正在读取历史分布结果…" />

    <el-alert
      v-else-if="!props.result || rows.length === 0"
      type="info"
      :closable="false"
      title="当前口径下没有可绘制的多日价格时段；可调整窗口或对象后重试"
    />

    <template v-else>
      <!-- 多对象：立体对象显式选择（默认不选；未选不绘制） -->
      <div v-if="needsObjectPick" class="p3w__controls">
        <label class="p3w__field">
          <span>立体对象</span>
          <el-select
            v-model="stereoObject"
            placeholder="从已选对象中选择一个"
            clearable
            size="small"
            data-testid="ynp-3dw-object"
          >
            <el-option v-for="name in objectNames" :key="name" :value="name" :label="name" />
          </el-select>
        </label>
        <p v-if="!stereoObject" class="p3w__hint" data-testid="ynp-3dw-object-hint">
          多对象时{{ MODE_LABEL[props.mode] }}一次只画一个经济对象（多对象同格会有两个值，不合并）；请先选择，未选择不绘制。
        </p>
      </div>

      <!-- 单日窗口：说明 + 用户点了才扩窗 -->
      <div v-if="needsMultiDay" class="p3w__block" data-testid="ynp-3dw-window-hint">
        <el-alert type="info" :closable="false">
          <template #title>
            {{ MODE_LABEL[props.mode] }}需要至少 2 天窗口；当前窗口 {{ props.businessWindow.start }} —
            {{ props.businessWindow.end }} 仅 {{ props.windowDayCount }} 天（单日走势不受影响，不会自动扩窗）
          </template>
        </el-alert>
        <el-button
          size="small"
          type="primary"
          plain
          data-testid="ynp-3dw-extend"
          @click="onExtendWindow"
        >
          改为 {{ sevenDayRange.start }} — {{ sevenDayRange.end }} 共 7 天
        </el-button>
      </div>

      <template v-else-if="!needsObjectPick || stereoObject">
        <!-- WebGL 故障降级提示（自动退热力，不是扩窗） -->
        <el-alert
          v-if="degraded"
          class="p3w__block"
          type="info"
          :closable="false"
          title="当前浏览器无法绘制三维，已改用同一数据的热力与二维切面"
          data-testid="ynp-3dw-degraded"
        />

        <div class="p3w__main">
          <div class="p3w__primary">
            <!-- 多日三维 -->
            <template v-if="effectiveMode === 'multi3d'">
              <div v-if="overLimit" class="p3w__block" data-testid="ynp-3dw-overlimit">
                <el-alert type="warning" :closable="false">
                  <template #title>
                    当前范围有 {{ grid.rows.length }} 个原生点，超过三维上限 {{ MAX_3D_NATIVE_POINTS }}；
                    请缩短日期或改看热力/二维切面（不会截断数据硬画）
                  </template>
                </el-alert>
                <el-button
                  size="small"
                  type="primary"
                  plain
                  data-testid="ynp-3dw-switch-heatmap"
                  @click="emit('switch-mode', 'heatmap')"
                >
                  改看热力
                </el-button>
              </div>
              <Price3DScene
                v-else-if="props.visible"
                class="p3w__scene"
                :lines="lines"
                :time-points="grid.timePoints"
                :dates="grid.dates"
                @init-error="onSceneInitError"
                @point-click="applyPointSelection"
              />
            </template>

            <!-- 日期×时段热力 -->
            <div v-else class="p3w__heat">
              <div class="p3w__heat-controls">
                <el-radio-group v-model="heatPhase" size="small" data-testid="ynp-3dw-heat-phase">
                  <el-radio-button value="real-time">实时</el-radio-button>
                  <el-radio-button value="day-ahead">日前</el-radio-button>
                </el-radio-group>
                <span class="p3w__hint">热力默认展示实时价，可切换日前；缺测格子留空，不补 0 不插值。</span>
              </div>
              <div ref="heatRef" class="p3w__heat-host" data-testid="ynp-3dw-heat-host"></div>
            </div>
          </div>

          <!-- 双切面（窄屏移到主图下方） -->
          <div class="p3w__facets">
            <div class="p3w__facet-controls">
              <label class="p3w__field">
                <span>
                  剖面日期
                  <el-tag v-if="isDefaultDate" size="small" type="info">默认：窗口最后一天</el-tag>
                </span>
                <el-select v-model="sectionDate" size="small" data-testid="ynp-3dw-section-date">
                  <el-option v-for="date in grid.dates" :key="date" :value="date" :label="date" />
                </el-select>
              </label>
              <label class="p3w__field">
                <span>
                  剖面时点
                  <el-tag v-if="isDefaultTime" size="small" type="info">默认：该日最高价时点</el-tag>
                </span>
                <el-select v-model="sectionTime" size="small" data-testid="ynp-3dw-section-time">
                  <el-option v-for="time in grid.timePoints" :key="time" :value="time" :label="time" />
                </el-select>
              </label>
            </div>
            <ChartCard title="所选日剖面（日前 / 实时 阶梯）" :height="230" :build-option="() => dayFacetOption" />
            <ChartCard title="所选时点跨日切面（日前 / 实时）" :height="230" :build-option="() => timeOfDayFacetOption" />
          </div>
        </div>

        <!-- 证据表：剖面日期全天 / 剖面时点跨日，切换显示 -->
        <section class="p3w__evidence">
          <div class="p3w__evidence-head">
            <el-radio-group v-model="evidenceView" size="small" data-testid="ynp-3dw-evidence-view">
              <el-radio-button value="day">按日：{{ effectiveDate || '—' }} 全部真实时段</el-radio-button>
              <el-radio-button value="timeOfDay">按时点：{{ effectiveTime || '—' }} 各业务日</el-radio-button>
            </el-radio-group>
          </div>
          <el-table :data="evidenceRows" size="small" border max-height="260" data-testid="ynp-3dw-evidence">
            <el-table-column
              :prop="'key'"
              :label="evidenceView === 'day' ? '时点' : '业务日'"
              width="90"
            />
            <el-table-column prop="intervalText" label="时段（北京时间）" min-width="200" show-overflow-tooltip />
            <el-table-column prop="dayAheadText" label="日前价（元/MWh）" width="130" align="right" />
            <el-table-column prop="realTimeText" label="实时价（元/MWh）" width="130" align="right" />
            <el-table-column prop="spreadText" label="价差 = 日前 − 实时" width="140" align="right" />
          </el-table>
        </section>

        <!-- 证据说明 -->
        <ul class="p3w__notes" data-testid="ynp-3dw-notes">
          <li v-if="sameReadText">{{ sameReadText }}。</li>
          <li>缺测时段：三维线中断开、热力留空、表格显示「—」，不补 0 不插值；负价原样画在 0 以下。</li>
          <li v-if="heatRangeText">{{ heatRangeText }}。</li>
          <li v-if="degraded">当前浏览器无法绘制三维，已自动改用同一数据的热力与二维切面。</li>
          <li v-if="needsObjectPick && stereoObject">
            多对象时只绘制「{{ stereoObject }}」这一个经济对象（其余已选对象不参与三维/热力画面）。
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>

<style scoped>
.p3w {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.p3w__controls,
.p3w__facet-controls,
.p3w__heat-controls,
.p3w__evidence-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.p3w__field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-md, 13px);
  color: var(--el-text-color-regular);
}
.p3w__field > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.p3w__hint {
  margin: 0;
  font-size: var(--font-sm, 12px);
  color: var(--el-text-color-secondary);
}
.p3w__block {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.p3w__main {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 12px;
  align-items: stretch;
}
.p3w__primary {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.p3w__scene {
  height: 460px;
}
.p3w__heat {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.p3w__heat-host {
  width: 100%;
  height: 420px;
}
.p3w__facets {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.p3w__facet-controls {
  align-items: flex-end;
}
.p3w__evidence {
  margin-top: 4px;
}
.p3w__notes {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--font-sm, 12px);
  color: var(--el-text-color-secondary);
}
@media (max-width: 1080px) {
  .p3w__main {
    grid-template-columns: 1fr;
  }
}
</style>
