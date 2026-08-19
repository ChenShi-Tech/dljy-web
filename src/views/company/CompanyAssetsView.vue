<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getCurrentUser } from '@/services/auth'
import { hasCompanyAdmin } from '@/services/governance'
import { selectedCompanyId } from '@/services/company/companyContext'
import {
  createStation, deleteStation, fetchStations, updateStation,
  createUnit, deleteUnit, fetchUnits, updateUnit,
  type CompanyStation, type CompanyUnit
} from '@/services/company/companyApi'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import ChartCard from '../../components/common/ChartCard.vue'
import SparkBar from '../../components/common/SparkBar.vue'
import { axisTooltip, bottomToolbox, chartToolbox, emptyOverlay, fmtNum } from '@/services/chart/chartOptions'
import {
  POWER, barSeries, tooltipStyle, legend, catAxis, valueAxis, animation
} from '@/services/chart/chartStyle'
import { maxBy, statusTagType, makeSummary } from '../../utils/tableFormat'

const STATION_TYPES = ['火电', '风电', '光伏', '水电', '储能']

// 电源类型语义色：与全站配色一致(火电=赭 / 风电=天蓝 / 光伏=琥珀 / 水电=青 / 储能=紫)。
const TYPE_COLOR: Record<string, string> = {
  火电: POWER.thermal,
  风电: POWER.wind,
  光伏: POWER.solar,
  水电: POWER.hydro,
  储能: POWER.storage
}
// 取场站类型对应语义色，未命中归中性灰。
const typeColor = (type: string | null | undefined) => TYPE_COLOR[String(type ?? '')] ?? POWER.forecast

const canWrite = computed(() => hasCompanyAdmin(getCurrentUser()))

const stations = ref<CompanyStation[]>([])
const units = ref<CompanyUnit[]>([])
const loading = ref(false)

const stationDialog = reactive({ visible: false, editId: 0 as number, form: blankStation() })
const unitDialog = reactive({ visible: false, editId: 0 as number, form: blankUnit() })

function blankStation() {
  return { name: '', type: '火电', capacity: null as number | null, voltageLevel: '', province: '', status: '运行' }
}
function blankUnit() {
  return { unitName: '', stationId: null as number | null, ratedCapacity: null as number | null, fuelType: '', status: '运行' }
}

const stationName = (id: number | null) => stations.value.find((s) => s.id === id)?.name ?? '—'

async function reload() {
  loading.value = true
  try {
    ;[stations.value, units.value] = await Promise.all([fetchStations(), fetchUnits()])
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(reload)
watch(selectedCompanyId, reload)

/* ───────────────────────── 图表与表格增强 ───────────────────────── */

// SparkBar 标尺上限：场站容量 / 机组额定容量各取列最大值(空表回退 1，避免除零)。
const capMax = computed(() => maxBy(stations.value, 'capacity') || 1)
const ratedMax = computed(() => maxBy(units.value, 'ratedCapacity') || 1)

// 按字段聚合容量求和：key=分组字段值，value=容量合计(非数跳过)。
function aggregateCapacity(by: 'type' | 'province') {
  const map = new Map<string, number>()
  for (const s of stations.value) {
    const key = String(s[by] ?? '').trim() || '未填写'
    const cap = Number(s.capacity)
    map.set(key, (map.get(key) ?? 0) + (Number.isFinite(cap) ? cap : 0))
  }
  return map
}

// 图1 场站类型×装机容量：环形饼图，各电源类型容量占比，语义色着色。
function buildTypeCapacityOption() {
  const agg = aggregateCapacity('type')
  // 按电源类型固定顺序排列(STATION_TYPES)，再补充任何额外类型，过滤零容量。
  const order = [...STATION_TYPES, ...[...agg.keys()].filter((k) => !STATION_TYPES.includes(k))]
  const data = order
    .filter((name) => (agg.get(name) ?? 0) > 0)
    .map((name) => ({ name, value: agg.get(name) ?? 0, itemStyle: { color: typeColor(name) } }))
  return {
    tooltip: {
      ...tooltipStyle(),
      trigger: 'item' as const,
      formatter: (p: { name: string; value: number; percent: number; marker?: string }) =>
        `${p.marker ?? ''}${p.name}<br/><b>${fmtNum(p.value, 2)} MW</b>（${fmtNum(p.percent, 1)}%）`
    },
    legend: legend({ bottom: 0, top: 'auto' as const }),
    toolbox: chartToolbox('场站类型装机'),
    ...animation(),
    ...emptyOverlay(!data.length),
    series: [{
      type: 'pie' as const,
      radius: ['45%', '70%'],
      center: ['50%', '46%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: 'transparent', borderWidth: 2, borderRadius: 4 },
      label: { formatter: '{b}\n{d}%', fontSize: 11 },
      labelLine: { length: 12, length2: 10 },
      emphasis: { label: { fontWeight: 'bold' as const } },
      data
    }]
  }
}

// 图2 省份装机分布：横向柱，yAxis 类目=province(按容量降序)。
function buildProvinceCapacityOption() {
  const agg = aggregateCapacity('province')
  // 容量降序排列；ECharts 横向柱 yAxis 从下往上画，反转后视觉上最大值居顶。
  const sorted = [...agg.entries()].sort((a, b) => a[1] - b[1])
  const provinces = sorted.map(([name]) => name)
  const values = sorted.map(([, value]) => value)
  return {
    tooltip: { ...axisTooltip({ unit: 'MW', pointer: 'shadow' }), ...tooltipStyle(), confine: true },
    // 底部布局:工具栏右下角;横向柱无 legend,grid bottom 加大给 toolbox 让位
    toolbox: bottomToolbox('省份装机分布', 8),
    grid: { left: 12, right: 24, top: 24, bottom: 48, containLabel: true },
    ...animation(),
    ...emptyOverlay(!provinces.length),
    xAxis: valueAxis('MW'),
    yAxis: catAxis(provinces, { boundaryGap: true }),
    series: [
      barSeries('装机容量', values, POWER.newEnergy, { itemStyle: { borderRadius: [0, 4, 4, 0], color: POWER.newEnergy } })
    ]
  }
}

// 图3 场站数量 + 装机容量按类型分组：双轴(左 MW 柱 / 右 座折线)。
function buildTypeCountCapacityOption() {
  const capAgg = aggregateCapacity('type')
  const order = [...STATION_TYPES, ...[...capAgg.keys()].filter((k) => !STATION_TYPES.includes(k))]
    .filter((name) => capAgg.has(name))
  const countMap = new Map<string, number>()
  for (const s of stations.value) {
    const key = String(s.type ?? '').trim() || '未填写'
    countMap.set(key, (countMap.get(key) ?? 0) + 1)
  }
  const caps = order.map((name) => capAgg.get(name) ?? 0)
  const counts = order.map((name) => countMap.get(name) ?? 0)
  return {
    tooltip: {
      ...axisTooltip({ units: { 装机容量: 'MW', 场站数量: '座' }, pointer: 'shadow' }),
      ...tooltipStyle(), confine: true
    },
    // 底部布局:图例顶部居中(chartStyle legend() 加 left:center),工具栏右下角
    legend: legend({ left: 'center' }),
    toolbox: bottomToolbox('类型装机与数量', 8),
    grid: { left: 12, right: 40, top: 40, bottom: 48, containLabel: true },
    ...animation(),
    ...emptyOverlay(!order.length),
    xAxis: catAxis(order),
    yAxis: [valueAxis('MW'), valueAxis('座', { splitLine: { show: false } })],
    series: [
      barSeries('装机容量', caps, POWER.newEnergy),
      {
        name: '场站数量', type: 'line' as const, yAxisIndex: 1, data: counts,
        smooth: false, symbol: 'circle', symbolSize: 7,
        lineStyle: { width: 2.5, color: POWER.price }, itemStyle: { color: POWER.price },
        emphasis: { focus: 'series' as const }
      }
    ]
  }
}

// 表格汇总行：容量 / 额定容量 sum(MW)。
const stationSummary = makeSummary({ capacity: { type: 'sum', digits: 2, unit: 'MW' } })
const unitSummary = makeSummary({ ratedCapacity: { type: 'sum', digits: 2, unit: 'MW' } })

// 单元格着色(表级工厂)：容量列高容量高亮(≥总容量均值×1.5 视为大容量场站，warn 色)。
// el-table 列级 :class-name 仅接受静态字符串，按行判定走表级 cell-class-name 按 column.property 分派。
const capAvg = computed(() => {
  const xs = stations.value.map((s) => Number(s.capacity)).filter((n) => Number.isFinite(n))
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
})
function stationCellClass({ row, column }: { row: CompanyStation; column: { property?: string } }): string {
  if (column.property === 'capacity') {
    const cap = Number(row.capacity)
    if (Number.isFinite(cap) && capAvg.value > 0 && cap >= capAvg.value * 1.5) return 'cell-warn'
  }
  return ''
}

// ---- 场站 ----
function openStationCreate() {
  stationDialog.editId = 0
  Object.assign(stationDialog.form, blankStation())
  stationDialog.visible = true
}
function openStationEdit(row: CompanyStation) {
  stationDialog.editId = row.id
  Object.assign(stationDialog.form, {
    name: row.name, type: row.type, capacity: row.capacity, voltageLevel: row.voltageLevel ?? '', province: row.province ?? '', status: row.status
  })
  stationDialog.visible = true
}
async function saveStation() {
  if (!stationDialog.form.name.trim()) return ElMessage.warning('请填写场站名称')
  try {
    if (stationDialog.editId) await updateStation(stationDialog.editId, stationDialog.form)
    else await createStation(stationDialog.form)
    ElMessage.success('已保存')
    stationDialog.visible = false
    await reload()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  }
}
async function removeStation(row: CompanyStation) {
  await ElMessageBox.confirm(`确认删除场站「${row.name}」？`, '提示', { type: 'warning' })
  try {
    await deleteStation(row.id)
    ElMessage.success('已删除')
    await reload()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

// ---- 机组 ----
function openUnitCreate() {
  unitDialog.editId = 0
  Object.assign(unitDialog.form, blankUnit())
  unitDialog.visible = true
}
function openUnitEdit(row: CompanyUnit) {
  unitDialog.editId = row.id
  Object.assign(unitDialog.form, {
    unitName: row.unitName, stationId: row.stationId, ratedCapacity: row.ratedCapacity, fuelType: row.fuelType ?? '', status: row.status
  })
  unitDialog.visible = true
}
async function saveUnit() {
  if (!unitDialog.form.unitName.trim()) return ElMessage.warning('请填写机组名称')
  try {
    if (unitDialog.editId) await updateUnit(unitDialog.editId, unitDialog.form)
    else await createUnit(unitDialog.form)
    ElMessage.success('已保存')
    unitDialog.visible = false
    await reload()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  }
}
async function removeUnit(row: CompanyUnit) {
  await ElMessageBox.confirm(`确认删除机组「${row.unitName}」？`, '提示', { type: 'warning' })
  try {
    await deleteUnit(row.id)
    ElMessage.success('已删除')
    await reload()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}
</script>

<template>
  <div class="company-page">
    <h2 class="page-title">场站机组台账</h2>
    <CompanyScopeBar />

    <!-- 资产概览图表：电源类型装机占比 / 省份分布 / 类型装机与数量 -->
    <div class="charts-grid">
      <ChartCard
        title="场站类型 × 装机容量"
        :height="320"
        :loading="loading"
        :build-option="buildTypeCapacityOption"
      />
      <ChartCard
        title="省份装机分布（MW）"
        :height="320"
        :loading="loading"
        :build-option="buildProvinceCapacityOption"
      />
      <ChartCard
        class="span-2"
        title="各类型装机容量与场站数量"
        :height="320"
        :loading="loading"
        :build-option="buildTypeCountCapacityOption"
      />
    </div>

    <el-tabs>
      <el-tab-pane label="场站台账">
        <div class="toolbar">
          <el-button v-if="canWrite" type="primary" @click="openStationCreate">新增场站</el-button>
          <span v-else class="readonly-hint">只读：当前角色无写入权限</span>
        </div>
        <el-table
          :data="stations"
          v-loading="loading"
          border
          stripe
          show-summary
          :summary-method="stationSummary"
          :cell-class-name="stationCellClass"
        >
          <el-table-column prop="name" label="场站名称" min-width="140" />
          <el-table-column prop="type" label="类型" width="90">
            <template #default="{ row }">
              <el-tag size="small" :color="typeColor(row.type)" effect="dark" style="border: none">{{ row.type }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="capacity" label="容量(MW)" width="160" sortable>
            <template #default="{ row }">
              <SparkBar :value="row.capacity" :max="capMax" :color="typeColor(row.type)" :digits="2" unit="MW" />
            </template>
          </el-table-column>
          <el-table-column prop="voltageLevel" label="电压等级" width="100" />
          <el-table-column prop="province" label="省份" width="90" />
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="statusTagType(row.status)" effect="plain">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="来源" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="row.source === 'IMPORT' ? 'primary' : 'success'" effect="plain">
                {{ row.source === 'IMPORT' ? '导入' : '手动' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="canWrite" label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openStationEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="removeStation(row)">删除</el-button>
            </template>
          </el-table-column>
          <template #empty>暂无场站，请新增或导入。</template>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="机组台账">
        <div class="toolbar">
          <el-button v-if="canWrite" type="primary" @click="openUnitCreate">新增机组</el-button>
          <span v-else class="readonly-hint">只读：当前角色无写入权限</span>
        </div>
        <el-table
          :data="units"
          v-loading="loading"
          border
          stripe
          show-summary
          :summary-method="unitSummary"
        >
          <el-table-column prop="unitName" label="机组名称" min-width="140" />
          <el-table-column label="所属场站" min-width="140">
            <template #default="{ row }">{{ stationName(row.stationId) }}</template>
          </el-table-column>
          <el-table-column prop="ratedCapacity" label="额定容量(MW)" width="180" sortable>
            <template #default="{ row }">
              <SparkBar :value="row.ratedCapacity" :max="ratedMax" :color="POWER.newEnergy" :digits="2" unit="MW" />
            </template>
          </el-table-column>
          <el-table-column prop="fuelType" label="燃料/类型" width="110">
            <template #default="{ row }">
              <el-tag v-if="row.fuelType" size="small" effect="plain">{{ row.fuelType }}</el-tag>
              <span v-else>—</span>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="statusTagType(row.status)" effect="plain">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="来源" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="row.source === 'IMPORT' ? 'primary' : 'success'" effect="plain">
                {{ row.source === 'IMPORT' ? '导入' : '手动' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="canWrite" label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openUnitEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="removeUnit(row)">删除</el-button>
            </template>
          </el-table-column>
          <template #empty>暂无机组，请先建场站再新增机组。</template>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 场站表单 -->
    <el-dialog v-model="stationDialog.visible" :title="stationDialog.editId ? '编辑场站' : '新增场站'" width="480px">
      <el-form label-width="90px">
        <el-form-item label="场站名称"><el-input v-model="stationDialog.form.name" /></el-form-item>
        <el-form-item label="类型">
          <el-select v-model="stationDialog.form.type" style="width: 100%">
            <el-option v-for="t in STATION_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="容量(MW)"><el-input-number v-model="stationDialog.form.capacity" :min="0" controls-position="right" style="width: 100%" /></el-form-item>
        <el-form-item label="电压等级"><el-input v-model="stationDialog.form.voltageLevel" placeholder="如 500kV" /></el-form-item>
        <el-form-item label="省份"><el-input v-model="stationDialog.form.province" /></el-form-item>
        <el-form-item label="状态"><el-input v-model="stationDialog.form.status" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="stationDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveStation">保存</el-button>
      </template>
    </el-dialog>

    <!-- 机组表单 -->
    <el-dialog v-model="unitDialog.visible" :title="unitDialog.editId ? '编辑机组' : '新增机组'" width="480px">
      <el-form label-width="100px">
        <el-form-item label="机组名称"><el-input v-model="unitDialog.form.unitName" /></el-form-item>
        <el-form-item label="所属场站">
          <el-select v-model="unitDialog.form.stationId" clearable style="width: 100%" placeholder="选择本公司场站">
            <el-option v-for="s in stations" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="额定容量(MW)"><el-input-number v-model="unitDialog.form.ratedCapacity" :min="0" controls-position="right" style="width: 100%" /></el-form-item>
        <el-form-item label="燃料/类型"><el-input v-model="unitDialog.form.fuelType" placeholder="如 燃煤/风/光" /></el-form-item>
        <el-form-item label="状态"><el-input v-model="unitDialog.form.status" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="unitDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveUnit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.company-page { padding: 20px; }
.page-title { margin: 0 0 16px; font-size: var(--font-20); }
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.readonly-hint { color: var(--el-text-color-secondary, #909399); font-size: var(--font-md); }
</style>
