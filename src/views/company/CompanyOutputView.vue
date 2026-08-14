<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { getCurrentUser } from '@/services/auth'
import { hasCompanyAdmin } from '@/services/governance'
import { selectedCompanyId } from '@/services/company/companyContext'
import {
  fetchUnits, fetchUnitOutput, saveUnitOutput, importUnitOutput,
  type CompanyUnit, type CompanyUnitOutput
} from '@/services/company/companyApi'
import { useQuerySync } from '../../composables/useQuerySync'
import { exportCsv } from '../../utils/exportCsv'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import ChartCard from '../../components/common/ChartCard.vue'
import SparkBar from '../../components/common/SparkBar.vue'
import { axisTooltip, insideZoom, emptyOverlay, fmtNum } from '@/services/chart/chartOptions'
import {
  POWER, areaSeries, markPointExtrema, markPeriodBands, markLinesAt, bottomEnhancedToolbox,
  tooltipStyle, catAxis, valueAxis, animation
} from '@/services/chart/chartStyle'
import { maxBy, avgBy } from '../../utils/tableFormat'

const canWrite = computed(() => hasCompanyAdmin(getCurrentUser()))

const units = ref<CompanyUnit[]>([])
const selectedUnitId = ref<number | null>(null)
const date = ref('')
// 日期筛选与路由 query 双向同步,刷新/分享链接后还原
useQuerySync({ date })
const rows = ref<CompanyUnitOutput[]>([])
const loading = ref(false)
const bulkText = ref('')
// 版本守卫：快速切公司/机组/日期时旧响应丢弃，防覆盖新（切公司串读、切机组出力错位）。
// loadUnits 与 loadOutput 各自独立计数：两者参数源不同（公司 vs 机组+日期），分开守卫互不干扰。
const loadUnitsSeq = ref(0)
const loadOutputSeq = ref(0)

async function loadUnits() {
  const seq = ++loadUnitsSeq.value
  try {
    const list = await fetchUnits()
    if (seq !== loadUnitsSeq.value) return // 旧公司的机组列表不覆盖新
    units.value = list
    if (!units.value.some((u) => u.id === selectedUnitId.value)) {
      selectedUnitId.value = units.value[0]?.id ?? null
    }
  } catch (error) {
    if (seq !== loadUnitsSeq.value) return
    ElMessage.error(error instanceof Error ? error.message : '加载机组失败')
  }
}

async function loadOutput() {
  if (!selectedUnitId.value || !date.value) {
    rows.value = []
    return
  }
  const seq = ++loadOutputSeq.value
  loading.value = true
  try {
    const data = await fetchUnitOutput({ unitId: selectedUnitId.value, date: date.value })
    if (seq !== loadOutputSeq.value) return // 旧机组/日期的出力不覆盖新
    rows.value = data
  } catch (error) {
    if (seq !== loadOutputSeq.value) return
    ElMessage.error(error instanceof Error ? error.message : '加载出力失败')
  } finally {
    if (seq === loadOutputSeq.value) loading.value = false
  }
}

onMounted(async () => {
  await loadUnits()
})
watch(selectedCompanyId, async () => {
  await loadUnits()
  await loadOutput()
})
watch([selectedUnitId, date], loadOutput)

// 批量录入：粘贴 96 个值（逗号或空白分隔），按 point 1..96 写入选定机组+日期。
async function saveBulk() {
  if (!selectedUnitId.value) return ElMessage.warning('请先选择机组')
  if (!date.value) return ElMessage.warning('请先选择日期')
  const values = bulkText.value
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter((v) => v !== '')
    .map(Number)
  if (!values.length) return ElMessage.warning('未解析到出力数值')
  if (values.length > 96) return ElMessage.warning('最多 96 个点（15 分钟一点）')
  const payload = values.map((valueMw, index) => ({ unitId: selectedUnitId.value!, date: date.value, point: index + 1, valueMw }))
  try {
    await saveUnitOutput(payload)
    ElMessage.success(`已保存 ${payload.length} 个点`)
    bulkText.value = ''
    await loadOutput()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  }
}

async function doImport() {
  // 导入同批量录入，但标记 source=IMPORT（平台导入基线）
  if (!selectedUnitId.value || !date.value) return ElMessage.warning('请先选择机组与日期')
  const values = bulkText.value.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean).map(Number).slice(0, 96)
  if (!values.length) return ElMessage.warning('未解析到出力数值')
  const payload = values.map((valueMw, index) => ({ unitId: selectedUnitId.value!, date: date.value, point: index + 1, valueMw }))
  try {
    await importUnitOutput(payload)
    ElMessage.success(`已导入 ${payload.length} 个点`)
    bulkText.value = ''
    await loadOutput()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入失败')
  }
}

// 选定机组额定容量(出力曲线参考线 + SparkBar 标尺上限)
const ratedCap = computed(() => units.value.find((u) => u.id === selectedUnitId.value)?.ratedCapacity ?? 0)
const outMax = computed(() => Math.max(ratedCap.value, maxBy(rows.value, 'valueMw')) || 1)

// point(1..96) → HH:mm(15 分钟一点)；真实回放行优先使用服务端 timePoint（小时级 24 点）。
function pointToTime(p: number | null | undefined, timePoint?: string): string {
  if (timePoint) return timePoint
  const m = ((Number(p) || 0) - 1) * 15
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function sourceLabel(source: string | null | undefined): string {
  if (source === 'CAPTURE') return '真实回放'
  if (source === 'IMPORT') return '导入'
  return '手动'
}

function sourceTagType(source: string | null | undefined): 'success' | 'primary' | 'info' {
  if (source === 'CAPTURE') return 'success'
  if (source === 'IMPORT') return 'primary'
  return 'info'
}

function outputSortPoint(row: CompanyUnitOutput): number {
  return Number(row.point) || 0
}

// 96 点日内出力曲线：青绿渐变面积 + 峰平谷分时背景 + (额定线 / 日均线) + 峰/谷高亮
function buildOutputOption() {
  const sorted = [...rows.value].sort((a, b) => (a.point ?? 0) - (b.point ?? 0))
  const x = sorted.map((r) => pointToTime(r.point, r.timePoint))
  const y = sorted.map((r) => r.valueMw)
  // 日均出力：仅对有限数值取均值（number|null 防护）
  const finiteVals = sorted.map((r) => Number(r.valueMw)).filter((n) => Number.isFinite(n))
  const dailyAvg = finiteVals.length ? finiteVals.reduce((a, b) => a + b, 0) / finiteVals.length : 0
  // markLine 每个 series 仅一条：把额定阈值线与日均线合并进一个 markLinesAt 调用
  const lines: { value: number; label: string; color?: string }[] = []
  if (ratedCap.value) lines.push({ value: ratedCap.value, label: `额定 ${ratedCap.value}MW`, color: POWER.deviation })
  if (finiteVals.length) lines.push({ value: dailyAvg, label: `日均 ${fmtNum(dailyAvg, 0)}MW` })
  return {
    tooltip: { ...axisTooltip({ unit: 'MW' }), ...tooltipStyle(), confine: true },
    // 底部布局:工具栏右下角(保留 magicType 切换),grid bottom 加大让位
    toolbox: bottomEnhancedToolbox('机组出力', 8),
    grid: { left: 12, right: 18, top: 24, bottom: 48, containLabel: true },
    dataZoom: insideZoom(),
    ...animation(),
    ...emptyOverlay(!sorted.length),
    xAxis: catAxis(x),
    yAxis: valueAxis('MW'),
    series: [
      areaSeries('出力', y, POWER.newEnergy, {
        markPoint: markPointExtrema({ max: true, min: true }),
        // 峰平谷分时背景（markArea 每 series 仅一个）
        markArea: markPeriodBands(x),
        // 额定线 + 日均线合并为同一 markLine
        ...(lines.length ? { markLine: markLinesAt(lines) } : {})
      })
    ]
  }
}

// 表格汇总行：峰/谷/均
function outputSummary({ columns }: { columns: { property?: string }[] }): string[] {
  const peak = maxBy(rows.value, 'valueMw')
  const avg = avgBy(rows.value, 'valueMw')
  const vals = rows.value.map((r) => Number(r.valueMw)).filter((n) => Number.isFinite(n))
  const valley = vals.length ? Math.min(...vals) : 0
  return columns.map((col, i) => {
    if (i === 0) return '统计'
    if (col.property === 'valueMw') return `峰 ${fmtNum(peak, 0)} / 谷 ${fmtNum(valley, 0)} / 均 ${fmtNum(avg, 0)} MW`
    return ''
  })
}

// 导出当前机组当日出力序列为 CSV(前端导出,带 BOM)
function exportOutputCsv() {
  if (!rows.value.length) return ElMessage.warning('暂无可导出的出力数据')
  const unitName = units.value.find((u) => u.id === selectedUnitId.value)?.unitName ?? '机组'
  const body = rows.value.map((r) => [r.timePoint ?? r.point, r.valueMw, sourceLabel(r.source)])
  exportCsv(`机组出力_${unitName}_${date.value}`, ['时间点', '出力(MW)', '来源'], body)
}
</script>

<template>
  <div class="company-page">
    <h2 class="page-title">机组出力</h2>
    <CompanyScopeBar />

    <div class="toolbar">
      <el-select v-model="selectedUnitId" placeholder="选择机组" style="width: 220px" filterable>
        <el-option v-for="u in units" :key="u.id" :label="u.unitName" :value="u.id" />
      </el-select>
      <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
      <el-button :disabled="!rows.length" @click="exportOutputCsv">导出CSV</el-button>
    </div>

    <el-empty v-if="!units.length" description="尚无机组，请先在「场站机组台账」新增机组" />

    <template v-else>
      <div v-if="canWrite" class="bulk-box">
        <p class="import-hint">粘贴出力数值（96 点 / 15 分钟一点，逗号或空白分隔，按 point 1→96 顺序）：</p>
        <el-input v-model="bulkText" type="textarea" :rows="4" placeholder="480, 475, 460, ..." />
        <div class="bulk-actions">
          <el-button type="primary" @click="saveBulk">手动保存</el-button>
          <el-button @click="doImport">作为导入基线</el-button>
        </div>
      </div>
      <p v-else class="readonly-hint">只读：当前角色无写入权限</p>

      <ChartCard
        title="日内出力曲线"
        :height="340"
        :loading="loading"
        :build-option="buildOutputOption"
        fullscreen
        brush-stats
        style="margin-top: 12px"
      />

      <el-table
        :data="rows"
        v-loading="loading"
        border
        stripe
        max-height="420"
        style="margin-top: 12px"
        show-summary
        :summary-method="outputSummary"
      >
        <el-table-column label="时间点" width="120" sortable :sort-by="outputSortPoint">
          <template #default="{ row }">{{ row.timePoint ?? pointToTime(row.point) }}</template>
        </el-table-column>
        <el-table-column prop="valueMw" label="出力(MW)" sortable>
          <template #default="{ row }">
            <SparkBar :value="row.valueMw" :max="outMax" :color="POWER.newEnergy" :digits="0" unit="MW" />
          </template>
        </el-table-column>
        <el-table-column label="来源" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="sourceTagType(row.source)" effect="plain">
              {{ sourceLabel(row.source) }}
            </el-tag>
          </template>
        </el-table-column>
        <template #empty>该机组该日暂无出力数据。</template>
      </el-table>
    </template>
  </div>
</template>

<style scoped>
.company-page { padding: 20px; }
.page-title { margin: 0 0 16px; font-size: 20px; }
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
/* 移动端:筛选条纵排,行内定宽控件占满整行(断点规约 768) */
@media (max-width: 768px) {
  .toolbar { align-items: stretch; flex-direction: column; }
  .toolbar .el-select, .toolbar .el-date-editor { width: 100% !important; }
}
.bulk-box { padding: 12px; background: var(--el-fill-color-lighter, #fafafa); border-radius: 8px; }
.bulk-actions { margin-top: 10px; display: flex; gap: 10px; }
.import-hint { margin: 0 0 8px; color: var(--el-text-color-secondary, #909399); font-size: 13px; }
.readonly-hint { color: var(--el-text-color-secondary, #909399); font-size: 13px; }
</style>
