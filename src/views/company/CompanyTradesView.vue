<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { getCurrentUser } from '@/services/auth'
import { hasCompanyAdmin } from '@/services/governance'
import { selectedCompanyId } from '@/services/company/companyContext'
import {
  createTrade, deleteTrade, fetchTrades, importTrades, updateTrade,
  type CompanyTrade
} from '@/services/company/companyApi'
import { exportCsv } from '../../utils/exportCsv'
import { todayBeijing } from '@/utils/beijingDate'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import ChartCard from '../../components/common/ChartCard.vue'
import SparkBar from '../../components/common/SparkBar.vue'
import { axisTooltip, chartToolbox, insideZoom, emptyOverlay, fmtNum } from '@/services/chart/chartOptions'
import {
  POWER, lineSeries, barSeries, enhancedToolbox,
  tooltipStyle, legend, grid, catAxis, valueAxis, animation
} from '@/services/chart/chartStyle'
import { maxBy, thresholdClass } from '../../utils/tableFormat'

const canWrite = computed(() => hasCompanyAdmin(getCurrentUser()))

const trades = ref<CompanyTrade[]>([])
const loading = ref(false)
const dialog = reactive({ visible: false, editId: 0 as number, form: blank() })
const importDialog = reactive({ visible: false, text: '' })
const formRef = ref<FormInstance>()
// 标准 el-form 校验,与原手动校验等价:仅交易日期必填
const formRules: FormRules = {
  tradeDate: [{ required: true, message: '请填写交易日期', trigger: 'change' }]
}

function blank() {
  return { tradeDate: '', contractCode: '', counterparty: '', type: '中长期', direction: '买入', volume: null as number | null, price: null as number | null, status: '已成交' }
}

async function reload() {
  loading.value = true
  try {
    trades.value = await fetchTrades()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(reload)
watch(selectedCompanyId, reload)

function openCreate() {
  dialog.editId = 0
  Object.assign(dialog.form, blank())
  dialog.visible = true
  formRef.value?.clearValidate()
}
function openEdit(row: CompanyTrade) {
  dialog.editId = row.id
  Object.assign(dialog.form, {
    tradeDate: row.tradeDate, contractCode: row.contractCode ?? '', counterparty: row.counterparty ?? '',
    type: row.type ?? '', direction: row.direction ?? '', volume: row.volume, price: row.price, status: row.status
  })
  dialog.visible = true
  formRef.value?.clearValidate()
}
async function save() {
  // 校验失败时错误提示落在对应字段上
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  try {
    if (dialog.editId) await updateTrade(dialog.editId, dialog.form)
    else await createTrade(dialog.form)
    ElMessage.success('已保存')
    dialog.visible = false
    await reload()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  }
}
async function remove(row: CompanyTrade) {
  await ElMessageBox.confirm(`确认删除 ${row.tradeDate} 的交易记录？`, '提示', { type: 'warning' })
  try {
    await deleteTrade(row.id)
    ElMessage.success('已删除')
    await reload()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

// CSV 导入：列序 交易日期,合同编号,对手方,类型,方向,电量(MWh),价格(元/MWh)
async function doImport() {
  const rows = importDialog.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [tradeDate, contractCode, counterparty, type, direction, volume, price] = line.split(',').map((c) => c.trim())
      return { tradeDate, contractCode, counterparty, type, direction, volume: toNum(volume), price: toNum(price), status: '已成交' }
    })
    .filter((r) => r.tradeDate)
  if (!rows.length) return ElMessage.warning('未解析到有效行')
  try {
    await importTrades(rows)
    ElMessage.success(`已导入 ${rows.length} 条`)
    importDialog.visible = false
    importDialog.text = ''
    await reload()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入失败')
  }
}
function toNum(v: string) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// 导出当前已加载的交易记录为 CSV(前端导出,带 BOM)
function exportTradesCsv() {
  if (!trades.value.length) return ElMessage.warning('暂无可导出的交易记录')
  const headers = ['交易日期', '合同编号', '对手方', '类型', '方向', '电量(MWh)', '价格(元/MWh)', '状态', '来源']
  const body = trades.value.map((t) => [
    t.tradeDate, t.contractCode ?? '', t.counterparty ?? '', t.type ?? '', t.direction ?? '',
    t.volume, t.price, t.status, t.source === 'IMPORT' ? '导入' : '手动'
  ])
  exportCsv(`历史交易_${todayBeijing()}`, headers, body)
}

/* 图表与表格增强*/

// 交易类型列表（图表系列颜色取值用，价格类统一橙系语义色）。
const TYPE_COLORS: Record<string, string> = {
  中长期: POWER.load,
  现货: POWER.price,
  绿电: POWER.newEnergy
}
function typeColor(type: string, idx: number): string {
  return TYPE_COLORS[type] ?? [POWER.thermal, POWER.storage, POWER.hydro, POWER.nuclear][idx % 4]
}

// 表格 SparkBar 标尺上限：取当前交易电量最大值（无数据兜底 1）。
const volMax = computed(() => maxBy(trades.value, 'volume') || 1)

// 价格时序折线：X=交易日期升序去重，按 type 分系列多条折线，缺日补 null。
function buildPriceOption() {
  // 升序去重日期作为类目轴
  const dates = [...new Set(trades.value.map((t) => t.tradeDate).filter(Boolean))].sort()
  const dateIndex = new Map(dates.map((d, i) => [d, i]))
  // 按 type 归集：每个 type 一条价格序列（同日多笔取均值，缺日为 null）
  const byType = new Map<string, { sum: number[]; cnt: number[] }>()
  for (const t of trades.value) {
    const type = t.type || '未分类'
    const price = Number(t.price)
    const di = dateIndex.get(t.tradeDate)
    if (di === undefined || !Number.isFinite(price)) continue
    if (!byType.has(type)) byType.set(type, { sum: Array(dates.length).fill(0), cnt: Array(dates.length).fill(0) })
    const bucket = byType.get(type)!
    bucket.sum[di] += price
    bucket.cnt[di] += 1
  }
  const series = [...byType.entries()].map(([type, b], i) => {
    const data = b.sum.map((s, j) => (b.cnt[j] ? s / b.cnt[j] : null))
    return lineSeries(type, data, typeColor(type, i), { connectNulls: true })
  })
  return {
    tooltip: { ...axisTooltip({ unit: '元/MWh' }), ...tooltipStyle(), confine: true },
    toolbox: enhancedToolbox('价格走势'),
    legend: legend(),
    grid: grid({ legend: true, zoom: true }),
    dataZoom: insideZoom(),
    ...animation(),
    ...emptyOverlay(!trades.value.length),
    xAxis: catAxis(dates),
    yAxis: valueAxis('元/MWh'),
    series
  }
}

// 买卖净仓位双向柱：按月（YYYY-MM）聚合，买入电量为正、卖出为负，叠加净仓位折线。
function buildPositionOption() {
  // 月份升序去重
  const months = [...new Set(trades.value.map((t) => (t.tradeDate || '').slice(0, 7)).filter(Boolean))].sort()
  const monthIndex = new Map(months.map((m, i) => [m, i]))
  const buy = Array(months.length).fill(0)
  const sell = Array(months.length).fill(0)
  for (const t of trades.value) {
    const mi = monthIndex.get((t.tradeDate || '').slice(0, 7))
    const vol = Number(t.volume)
    if (mi === undefined || !Number.isFinite(vol)) continue
    if (t.direction === '卖出') sell[mi] += vol
    else buy[mi] += vol
  }
  // 卖出取负值（向下柱），净仓位 = 买入 - 卖出
  const sellNeg = sell.map((v) => -v)
  const net = buy.map((b, i) => b - sell[i])
  return {
    tooltip: { ...axisTooltip({ unit: 'MWh', pointer: 'shadow' }), ...tooltipStyle(), confine: true },
    toolbox: chartToolbox('买卖净仓位'),
    legend: legend(),
    grid: grid({ legend: true, zoom: true }),
    dataZoom: insideZoom(),
    ...animation(),
    ...emptyOverlay(!trades.value.length),
    xAxis: catAxis(months),
    yAxis: valueAxis('MWh'),
    series: [
      barSeries('买入', buy, POWER.positive, { stack: 'flow' }),
      barSeries('卖出', sellNeg, POWER.negative, { stack: 'flow' }),
      lineSeries('净仓位', net, POWER.storage, { z: 3, itemStyle: { color: POWER.storage }, lineStyle: { color: POWER.storage } })
    ]
  }
}

// 价格相对高低着色：以全量均价为基准，偏高 1.5 倍标红、1.2 倍标橙（thresholdClass 取绝对值）。
const priceWarn = computed(() => {
  const xs = trades.value.map((t) => Number(t.price)).filter((n) => Number.isFinite(n))
  return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length) * 1.2 : Infinity
})
const priceDanger = computed(() => {
  const xs = trades.value.map((t) => Number(t.price)).filter((n) => Number.isFinite(n))
  return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length) * 1.5 : Infinity
})
function priceCellClass({ row }: { row: CompanyTrade }): string {
  return thresholdClass(row.price, priceWarn.value, priceDanger.value)
}
function tradeCellClass({ row, column }: { row: CompanyTrade; column: { property?: string } }): string {
  return column.property === 'price' ? priceCellClass({ row }) : ''
}

// 表格汇总行：总买入量、总卖出量分列 + 平均价。
function tradesSummary({ columns }: { columns: { property?: string }[] }): string[] {
  const buyVol = trades.value.reduce((acc, t) => acc + (t.direction === '卖出' ? 0 : Number(t.volume) || 0), 0)
  const sellVol = trades.value.reduce((acc, t) => acc + (t.direction === '卖出' ? Number(t.volume) || 0 : 0), 0)
  const prices = trades.value.map((t) => Number(t.price)).filter((n) => Number.isFinite(n))
  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
  return columns.map((col, i) => {
    if (i === 0) return '合计'
    if (col.property === 'volume') return `买 ${fmtNum(buyVol, 2)} / 卖 ${fmtNum(sellVol, 2)} MWh`
    if (col.property === 'price') return `均 ${fmtNum(avgPrice, 2)} 元/MWh`
    return ''
  })
}
</script>

<template>
  <div class="company-page">
    <h2 class="page-title">历史交易</h2>
    <CompanyScopeBar />

    <div class="toolbar">
      <template v-if="canWrite">
        <el-button type="primary" @click="openCreate">新增交易</el-button>
        <el-button @click="importDialog.text = ''; importDialog.visible = true">批量导入</el-button>
      </template>
      <el-button @click="exportTradesCsv">导出CSV</el-button>
      <span v-if="!canWrite" class="readonly-hint">只读：当前角色无写入权限</span>
    </div>

    <!-- 图表区：价格时序折线 + 买卖净仓位双向柱（新增，不影响下方表格/筛选/写入） -->
    <div class="charts-grid">
      <ChartCard title="价格走势" :height="320" :loading="loading" :build-option="buildPriceOption" fullscreen />
      <ChartCard title="买卖净仓位（按月）" :height="320" :loading="loading" :build-option="buildPositionOption" fullscreen />
    </div>

    <el-table
      :data="trades"
      v-loading="loading"
      border
      stripe
      show-summary
      :summary-method="tradesSummary"
      :cell-class-name="tradeCellClass"
    >
      <el-table-column prop="tradeDate" label="交易日期" width="120" sortable />
      <el-table-column prop="contractCode" label="合同编号" min-width="130" />
      <el-table-column prop="counterparty" label="对手方" min-width="130" />
      <el-table-column prop="type" label="类型" width="100" />
      <el-table-column prop="direction" label="方向" width="90">
        <template #default="{ row }">
          <el-tag size="small" :type="row.direction === '买入' ? 'success' : 'danger'" effect="plain">
            {{ row.direction || '-' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="volume" label="电量(MWh)" width="160" sortable>
        <template #default="{ row }">
          <SparkBar :value="row.volume" :max="volMax" :color="POWER.load" :digits="2" unit="MWh" />
        </template>
      </el-table-column>
      <el-table-column
        prop="price"
        label="价格(元/MWh)"
        width="125"
        sortable
      >
        <template #default="{ row }">{{ fmtNum(row.price, 2) }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="90" />
      <el-table-column label="来源" width="80">
        <template #default="{ row }">
          <el-tag size="small" :type="row.source === 'IMPORT' ? 'primary' : 'success'" effect="plain">
            {{ row.source === 'IMPORT' ? '导入' : '手动' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column v-if="canWrite" label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>暂无交易记录，请新增或导入。</template>
    </el-table>

    <el-dialog v-model="dialog.visible" :title="dialog.editId ? '编辑交易' : '新增交易'" width="480px">
      <el-form ref="formRef" :model="dialog.form" :rules="formRules" label-width="100px">
        <el-form-item label="交易日期" prop="tradeDate"><el-date-picker v-model="dialog.form.tradeDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="合同编号"><el-input v-model="dialog.form.contractCode" /></el-form-item>
        <el-form-item label="对手方"><el-input v-model="dialog.form.counterparty" /></el-form-item>
        <el-form-item label="类型"><el-input v-model="dialog.form.type" placeholder="如 中长期/现货/绿电" /></el-form-item>
        <el-form-item label="方向"><el-input v-model="dialog.form.direction" placeholder="买入/卖出" /></el-form-item>
        <el-form-item label="电量(MWh)"><el-input-number v-model="dialog.form.volume" controls-position="right" style="width: 100%" /></el-form-item>
        <el-form-item label="价格(元/MWh)"><el-input-number v-model="dialog.form.price" controls-position="right" style="width: 100%" /></el-form-item>
        <el-form-item label="状态"><el-input v-model="dialog.form.status" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importDialog.visible" title="批量导入交易" width="560px">
      <p class="import-hint">每行一条，逗号分隔：交易日期,合同编号,对手方,类型,方向,电量(MWh),价格(元/MWh)</p>
      <el-input v-model="importDialog.text" type="textarea" :rows="8" placeholder="2026-06-01,ML-001,国网售电,中长期,买入,128.6,382" />
      <template #footer>
        <el-button @click="importDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="doImport">导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.company-page { padding: 20px; }
.page-title { margin: 0 0 16px; font-size: var(--font-20); }
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.readonly-hint { color: var(--el-text-color-secondary, #909399); font-size: var(--font-md); }
.import-hint { margin: 0 0 10px; color: var(--el-text-color-secondary, #909399); font-size: var(--font-md); }
</style>
