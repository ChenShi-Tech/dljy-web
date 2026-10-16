<script setup lang="ts">
// 96 点申报曲线编辑器（受控共享组件，merge-declare-desk-into-s4 任务 2.1）：
// 自 DeclarationDeskView 抽出，供一日作业台 S4 第②段与（过渡期）申报台复用。
// 契约（D3）：props 只读消费单据与历史行；保存成功后 emit('updated', 单据) 由容器刷新。
// 组件不自持单据、不自行拉列表；复制历史曲线的候选集由父级经 historyRows 传入。
// 内含：主图（滚轮逐点微调）、批量段、复制历史曲线、96 点网格、保存门、
// 96 点明细折叠表与 CSV 导出。纯函数（换算/标签/CSV）在 services/trading/declareCurve96。
import { computed, nextTick, ref, watch } from 'vue'
import DataBasisBadge from '@/components/DataBasisBadge.vue'
import { useEChart } from '@/composables/useEChart'
import { axisTooltip } from '@/services/chart/chartOptions'
import {
  EDITABLE_DRAFT_STATUSES,
  editorMwOf,
  invalidPointIndexesOf,
  isCurveEdited,
  STATUS_LABEL,
  updateDeclarationCurve,
  type DeclarationOrder
} from '@/services/declarations'
import {
  CURVE_POINT_COUNT,
  buildCurveCsv,
  buildCurveDetail96,
  energy96ToMw96,
  mw96ToEnergy96,
  pointStartLabel
} from '@/services/trading/declareCurve96'

const props = withDefaults(defineProps<{
  declaration: DeclarationOrder | null
  /** 复制历史曲线的候选集（时间窗内历史申报单），由父级供给 */
  historyRows?: DeclarationOrder[]
  /** 父级动作进行中（风控/提交等），保存键一并禁用 */
  busy?: boolean
}>(), { historyRows: () => [], busy: false })
const emit = defineEmits<{ updated: [d: DeclarationOrder]; 'request-history': [] }>()

const decl = computed(() => props.declaration)
const canEdit = computed(() =>
  decl.value ? EDITABLE_DRAFT_STATUSES.includes(decl.value.status) : false
)

// 编辑器值类型含 ''：v-model.number 在输入框被清空/半输入时回填空串，运行时就是它
const pointMw = ref<Array<number | ''>>(Array.from({ length: CURVE_POINT_COUNT }, () => 0))
const batch = ref({ from: 0, to: CURVE_POINT_COUNT - 1, mw: 30 })
// 编辑器数值视图：未填/非数/负数归一为 NaN 的原始口径，与「展示用按 0 折算」口径分离。
// 归一必须发生在求和/保存之前——此前 '' 参与求和退化成字符串拼接（总量显示成拼接数字）、
// 保存链上 ''/4 把该时点静默归零（工作台审查 P2）。
const pointMwNumeric = computed(() =>
  pointMw.value.map((v) => {
    const mw = editorMwOf(v)
    return Number.isNaN(mw) ? 0 : mw
  })
)
const invalidPointIndexes = computed(() => invalidPointIndexesOf(pointMw.value))
const invalidPointsText = computed(() => invalidPointIndexes.value.map((i) => pointStartLabel(i)).join('、'))
// 脏标记 = 编辑器值与已保存曲线的派生比较（isCurveEdited）。
// 不能用「watch 置 true / 同步置 false」的标志位：deep watch 异步 flush，
// 加载/保存后的回同步会被迟到的 watcher 改回 true，造成恒报「含未保存修改」。
const curveDirty = computed(() => isCurveEdited(pointMwNumeric.value, decl.value?.energyCurveMwh96))

const totalMwh = computed(() => Math.round(pointMwNumeric.value.reduce((sum, mw) => sum + mw / 4, 0) * 100) / 100)
const maxMw = computed(() => Math.max(...pointMwNumeric.value, 0))

// 回同步纪律（与申报台原实现等价）：只在「换了单」或「保存曲线内容真的变了」时
// 把单据曲线灌回编辑器。风控/审批等动作也会让父级换单据对象（曲线内容不变），
// 此时若回同步会把未保存的编辑静默冲掉——原实现靠显式调用点避开，这里靠内容比对。
let lastSyncedId: string | null = null
let lastSyncedCurve: number[] | null = null
function sameCurve(a: number[] | null, b: number[] | null): boolean {
  if (!a || !b || a.length !== b.length) return false
  return a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 1e-9)
}
watch(
  () => props.declaration,
  (d) => {
    if (!d) {
      lastSyncedId = null
      lastSyncedCurve = null
      pointMw.value = Array.from({ length: CURVE_POINT_COUNT }, () => 0)
      void nextTick(renderChart)
      return
    }
    if (d.id === lastSyncedId && sameCurve(d.energyCurveMwh96, lastSyncedCurve)) return
    lastSyncedId = d.id
    lastSyncedCurve = d.energyCurveMwh96
    pointMw.value = energy96ToMw96(d.energyCurveMwh96)
    void nextTick(renderChart)
  },
  { immediate: true }
)

function applyBatch() {
  const from = Math.max(0, Math.min(CURVE_POINT_COUNT - 1, Math.floor(batch.value.from)))
  const to = Math.max(from, Math.min(CURVE_POINT_COUNT - 1, Math.floor(batch.value.to)))
  for (let i = from; i <= to; i++) pointMw.value[i] = batch.value.mw
  // 置脏由 curveDirty 派生（批量值与已保存曲线不同 → 自动为 true）
}

// ── 主图（编辑态支持滚轮逐点微调：悬停柱体上滚增/下滚减）──
const chartEl = ref<HTMLElement | null>(null)
const chart = useEChart(chartEl, { render: renderChart })

function renderChart() {
  if (!chartEl.value) return
  // 极值标注（清单 D1）：最高/最低功率直接标在柱上，容量 markLine 保持不变
  const mwMark = (color: string) => ({
    symbol: 'circle', symbolSize: 6,
    itemStyle: { color: 'transparent', borderColor: color, borderWidth: 1.5 },
    label: { show: true, position: 'top', fontSize: 10, color, formatter: (p: { value: unknown }) => `${p.value}` },
    data: [{ type: 'max' }, { type: 'min' }]
  })
  chart.setOption({
    tooltip: axisTooltip({ unit: 'MW', pointer: 'shadow' }),
    legend: { show: false },
    grid: { left: 44, right: 32, top: 24, bottom: 36 },
    // 96 点时点轴：96 个标签全排会互相重叠，每 3 小时（interval=11 → 00:00/03:00/…）出一个刻度
    xAxis: {
      type: 'category',
      data: pointMw.value.map((_, i) => pointStartLabel(i)),
      axisLabel: { interval: 11 }
    },
    yAxis: { type: 'value', name: 'MW' },
    series: [{
      name: '申报功率',
      type: 'bar',
      data: pointMwNumeric.value,
      itemStyle: { color: '#0ea5e9' },
      markPoint: mwMark('#0369a1'),
      markLine: decl.value
        ? { silent: true, symbol: 'none', data: [{ yAxis: decl.value.capacityMw, name: '可用容量' }], lineStyle: { color: '#ef4444' }, label: { formatter: '容量 {c} MW' } }
        : undefined
    }]
  })
}
watch(pointMw, () => { void nextTick(renderChart) }, { deep: true })

// ── 主图滚轮逐点微调（96 点直编的快捷入口）：光标悬停柱体滚动滚轮 = 该 15min 时点
// 功率 ±1 MW（Shift ±0.1），上滚增、下滚减；只在可编辑状态生效。定位不走 mousemove
// 悬停缓存——96 根柱的类别槽只有几个像素，光标落在柱间空隙时 move 事件不触发，
// 缓存下标会调错点；直接把滚轮事件的像素坐标 convertFromPixel 回时点下标才可靠。
// 上下限与批量段输入同一口径：[0, 容量×2]。
function onChartWheel(e: WheelEvent) {
  if (!canEdit.value) return
  const inst = chart.instance()
  const el = chartEl.value
  if (!inst || inst.isDisposed() || !el) return
  const rect = el.getBoundingClientRect()
  const pixel: [number, number] = [e.clientX - rect.left, e.clientY - rect.top]
  if (!inst.containPixel('grid', pixel)) return
  const coord = inst.convertFromPixel('grid', pixel)
  const index = coord ? Math.round(coord[0]) : Number.NaN
  if (!Number.isFinite(index)) return
  const pointIndex = Math.max(0, Math.min(CURVE_POINT_COUNT - 1, index))
  const step = e.shiftKey ? 0.1 : 1
  const raw = editorMwOf(pointMw.value[pointIndex])
  const base = Number.isNaN(raw) ? 0 : raw
  const capCeiling = (decl.value?.capacityMw ?? 0) * 2
  const next = Math.min(capCeiling, Math.max(0, base + (e.deltaY < 0 ? step : -step)))
  pointMw.value[pointIndex] = Math.round(next * 100) / 100
  // 本次滚动已被图表消费：不再让页面跟着滚；并把 tooltip 钉到正调的时点，滚了多少看得见
  e.preventDefault()
  inst.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: pointIndex })
}

// 时点输入格的滚轮 = 该点功率 ±1 MW（Shift ±0.1），与主图滚轮微调同一步长；
// preventDefault 同时拦掉原生 number 输入按 step 属性的步进。仅在输入框已聚焦时
// 接管：未聚焦时放行默认滚动——96 格网格限高内滚，悬停滚轮必须留给网格滚动用。
// 非法态（''/非数/负）按 0 起步，上下限与主图/批量输入同口径 [0, 容量×2]。
function onPointInputWheel(e: WheelEvent, index: number) {
  const input = e.currentTarget as HTMLInputElement | null
  if (!input || document.activeElement !== input || input.readOnly || input.disabled) return
  const raw = editorMwOf(pointMw.value[index])
  const base = Number.isNaN(raw) ? 0 : raw
  const step = e.shiftKey ? 0.1 : 1
  const capCeiling = (decl.value?.capacityMw ?? 0) * 2
  const next = Math.min(capCeiling, Math.max(0, base + (e.deltaY < 0 ? step : -step)))
  pointMw.value[index] = Math.round(next * 100) / 100
  e.preventDefault()
}

// ── 复制历史曲线（declaration-workflow §2 快捷操作）：把历史申报单的 96 点曲线
// 带入编辑器为底稿。只落到 pointMw 并由派生置脏，仍需「保存曲线」→ 重新
// 风控——与手工编辑同一条保存纪律，不做绕过风控的直达写回。
const copySourceId = ref('')
const copyableHistory = computed(() => props.historyRows.filter((r) => r.id !== decl.value?.id))
function applyCopyHistory() {
  if (!canEdit.value) return
  const src = copyableHistory.value.find((r) => r.id === copySourceId.value)
  if (!src) return
  pointMw.value = energy96ToMw96(src.energyCurveMwh96)
}

// ── 保存 ──
const saving = ref(false)
const errorMsg = ref('')
const savedMsg = ref('')
async function saveCurve() {
  if (!decl.value || saving.value || props.busy) return
  // 保存门：未填/负数时点不得静默落库（此前 '' 会被 ''/4=0 归零、总量显示成拼接数字）
  if (invalidPointIndexes.value.length) {
    errorMsg.value = `申报曲线时点 ${invalidPointsText.value} 未填或为负数，请补全后再保存`
    return
  }
  saving.value = true
  errorMsg.value = ''
  savedMsg.value = ''
  try {
    const updated = await updateDeclarationCurve(decl.value.id, {
      energyCurveMwh96: mw96ToEnergy96(pointMwNumeric.value)
    })
    emit('updated', updated)
    savedMsg.value = '曲线已保存——需重新风控检查'
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    saving.value = false
  }
}

// ── 96 点明细与导出（清单 D1）：明细数值与底稿同源 ──
// 编辑中（脏）以编辑器实时值为准并注明；否则读已保存的申报单曲线。
const detail96 = computed(() => {
  if (!decl.value) return [] as ReturnType<typeof buildCurveDetail96>
  const editing = EDITABLE_DRAFT_STATUSES.includes(decl.value.status)
  return buildCurveDetail96(decl.value.energyCurveMwh96, editing ? pointMwNumeric.value : null)
})

function exportCurveCsv() {
  if (!decl.value || !detail96.value.length) return
  const url = URL.createObjectURL(new Blob(['\uFEFF' + buildCurveCsv(detail96.value, totalMwh.value)], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `申报曲线-${decl.value.targetDate}-${decl.value.id}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div v-if="decl" class="dce">
    <!-- 96 点主图（编辑态支持滚轮逐点微调：悬停柱体上滚增/下滚减） -->
    <div ref="chartEl" class="dce-chart" @wheel="onChartWheel" />
    <div class="dce-meta">
      申报总量 <b>{{ totalMwh }}</b> MWh · 最大功率 <b>{{ maxMw }}</b> MW / 容量 {{ decl.capacityMw }} MW
      <DataBasisBadge :basis="decl.basis" />
      <span v-if="canEdit" class="dce-wheel-hint">滚轮微调：悬停柱体 ±1 MW（Shift ±0.1）· 时点输入聚焦后同调</span>
    </div>

    <!-- 96 点明细（清单 D1）：编辑中以编辑器实时值为准并注明；导出 CSV（UTF-8 BOM） -->
    <details class="dce-detail96">
      <summary>
        96 点明细（{{ curveDirty ? '含未保存修改，以编辑器为准' : '当前保存曲线' }}）
      </summary>
      <div class="dce-detail96-bar">
        <button type="button" class="dce-mini" :disabled="!detail96.length" @click="exportCurveCsv">导出 CSV</button>
        <span class="dce-muted">共 96 点（每 15 分钟）· 合计 {{ totalMwh }} MWh</span>
      </div>
      <div class="dce-detail96-scroll">
        <table>
          <thead><tr><th>时点</th><th>功率 MW</th><th>电量 MWh</th></tr></thead>
          <tbody>
            <tr v-for="r in detail96" :key="r.label">
              <td>{{ r.label }}</td><td class="num">{{ r.mw }}</td><td class="num">{{ r.mwh }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>

    <!-- 曲线编辑（草稿/驳回可改）-->
    <template v-if="canEdit">
      <div class="dce-batch-row">
        <span class="dce-muted">批量段设置</span>
        <input v-model.number="batch.from" type="number" min="0" max="95" title="起始时点（15min 序号 0~95）" />
        <span class="dce-muted">{{ pointStartLabel(batch.from) }}</span>
        <span>~</span>
        <input v-model.number="batch.to" type="number" min="0" max="95" title="结束时点（15min 序号 0~95）" />
        <span class="dce-muted">{{ pointStartLabel(batch.to) }}</span>
        <span>=</span>
        <input v-model.number="batch.mw" type="number" min="0" :max="decl.capacityMw * 2" title="功率 MW" />
        <span>MW</span>
        <button type="button" class="dce-mini" @click="applyBatch">应用</button>
      </div>
      <!-- 复制历史曲线（D7 验收反馈：工具区常显，不藏在⑥段历史列表里）：
           打开下拉时经 request-history 让父级懒加载候选（与⑥段同一加载链）；
           带入后只落编辑器并由派生置脏，与手工编辑同一条「保存曲线→重新风控」纪律 -->
      <div class="dce-batch-row">
        <span class="dce-muted">复制历史曲线</span>
        <select
          v-model="copySourceId"
          title="选择时间窗内的历史申报单，应用其 96 点曲线为底稿"
          @focus="emit('request-history')"
          @mousedown="emit('request-history')"
        >
          <option value="">{{ copyableHistory.length ? '选择历史申报单…' : '加载/查看历史申报单…' }}</option>
          <option v-for="r in copyableHistory" :key="r.id" :value="r.id">
            {{ r.targetDate }} · {{ r.id }}（{{ STATUS_LABEL[r.status] }}）
          </option>
        </select>
        <button type="button" class="dce-mini" :disabled="!copySourceId || saving || busy" @click="applyCopyHistory">应用</button>
      </div>
      <div class="dce-point-grid">
        <label v-for="(_, i) in pointMw" :key="i">
          <span>{{ pointStartLabel(i) }}</span>
          <input v-model.number="pointMw[i]" type="number" min="0" step="1" @wheel="onPointInputWheel($event, i)" />
        </label>
      </div>
      <div class="dce-action-row">
        <button type="button" class="dce-mini primary" :disabled="saving || busy || !curveDirty || invalidPointIndexes.length > 0" @click="saveCurve">保存曲线</button>
        <span v-if="invalidPointIndexes.length" class="dce-muted dce-invalid">时点 {{ invalidPointsText }} 未填或为负数，补全后才能保存</span>
        <span v-else-if="curveDirty" class="dce-muted">曲线已修改，保存后需重新风控检查</span>
      </div>
    </template>
    <p v-if="savedMsg" class="dce-ok">{{ savedMsg }}</p>
    <p v-if="errorMsg" class="dce-err">{{ errorMsg }}</p>
  </div>
</template>

<style scoped>
.dce { display: flex; flex-direction: column; gap: 6px; }
.dce-chart { width: 100%; height: 240px; }
.dce-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); font-variant-numeric: tabular-nums; }
.dce-meta b { color: var(--text, #1e293b); }
.dce-wheel-hint { font-size: var(--font-10); }
.dce-muted { font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); }
.dce-invalid { color: var(--danger, #b91c1c); }
.dce-ok { margin: 4px 0 0; font-size: var(--font-sm); color: var(--success, #15803d); }
.dce-err { margin: 4px 0 0; padding: 6px 10px; border-radius: 6px; background: var(--danger-tint, #fef2f2); color: var(--danger, #991b1b); font-size: var(--font-sm); }

.dce-mini { padding: 3px 12px; border: 1px solid var(--accent, #2563eb); border-radius: 5px; background: var(--primary-tint, #eff6ff); color: var(--accent, #1d4ed8); font-size: var(--font-xs); cursor: pointer; }
.dce-mini.primary { background: var(--accent, #2563eb); color: #fff; }
.dce-mini:disabled { opacity: .45; cursor: not-allowed; }

/* 96 点明细折叠表（清单 D1）：滚动容器限高，数值等宽对齐 */
.dce-detail96 { margin: 0; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; padding: 6px 10px; }
.dce-detail96 summary { cursor: pointer; font-size: var(--font-sm); color: var(--el-text-color-secondary, #667); user-select: none; }
.dce-detail96-bar { display: flex; align-items: center; gap: 8px; margin: 6px 0 4px; }
.dce-detail96-scroll { max-height: 220px; overflow-y: auto; }
.dce-detail96-scroll table { width: 100%; border-collapse: collapse; font-size: var(--font-xs); }
.dce-detail96-scroll th, .dce-detail96-scroll td { padding: 2px 8px; text-align: left; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); }
.dce-detail96-scroll th { color: var(--el-text-color-secondary, #667); font-weight: 500; position: sticky; top: 0; background: var(--panel, #fff); }
.dce-detail96-scroll td.num { font-variant-numeric: tabular-nums; text-align: right; }

.dce-batch-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: var(--font-sm); }
.dce-batch-row input { width: 64px; padding: 3px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: var(--font-xs); }
.dce-batch-row select { padding: 3px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-xs); max-width: 320px; }
.dce-point-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4px 8px; max-height: 200px; overflow-y: auto; padding: 4px 2px; }
.dce-point-grid label { display: flex; align-items: center; gap: 4px; font-size: var(--font-10); color: var(--el-text-color-secondary, #667); }
.dce-point-grid input { width: 100%; min-width: 0; padding: 2px 4px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: var(--font-xs); }
.dce-action-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
@media (max-width: 768px) {
  .dce-point-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
