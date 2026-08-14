<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, type Ref } from 'vue'
import {
  getOperationsDataset,
  type OpsTab
} from '@/services/operations'
import { fetchAgentMonitor, type AgentMonitorData } from '@/services/agent/agentMonitor'
import { useEChart } from '../composables/useEChart'
import { useQuerySync } from '../composables/useQuerySync'
import { axisTooltip, chartToolbox, emptyOverlay } from '@/services/chart/chartOptions'
import { exportCsv } from '../utils/exportCsv'

const activeTab = ref<OpsTab>('stations')
const dataset = getOperationsDataset()
const agentLive = ref<AgentMonitorData | null>(null)
const chartRef = ref<HTMLElement | null>(null)
// 生命周期(init/容器resize/主题重建/dispose)统一交给 useEChart 托管
const distChart = useEChart(chartRef, { render: renderChart })

const tabs: Array<{ label: string; value: OpsTab }> = [
  { label: '电站', value: 'stations' },
  { label: '合同', value: 'contracts' },
  { label: '结算', value: 'settlements' },
  { label: '风险', value: 'risks' },
  { label: '导入', value: 'imports' },
  { label: '模型', value: 'models' },
  { label: '智能体', value: 'agents' }
]

// 当前页签 ⇄ 路由 query：刷新或分享链接后停留在同一迁移面
useQuerySync({ tab: activeTab as Ref<string> })
if (!tabs.some((tab) => tab.value === activeTab.value)) activeTab.value = 'stations'

const metrics = computed(() =>
  activeTab.value === 'agents' && agentLive.value
    ? agentLive.value.metrics
    : dataset.metrics[activeTab.value]
)

// 各页签数值的业务单位(tooltip 读数带单位)
const tabUnits: Record<OpsTab, string> = {
  stations: 'MW',
  contracts: '亿kWh',
  settlements: '万元',
  risks: '万元',
  imports: '行',
  models: '%',
  agents: '%'
}

function chartRows() {
  if (activeTab.value === 'stations') return dataset.stations.map((row) => ({ name: row.type, value: row.capacity }))
  if (activeTab.value === 'contracts') return dataset.contracts.map((row) => ({ name: row.type, value: row.volume }))
  if (activeTab.value === 'settlements') return dataset.settlements.map((row) => ({ name: row.month, value: row.income }))
  if (activeTab.value === 'risks') return dataset.risks.map((row) => ({ name: row.name, value: row.exposure }))
  if (activeTab.value === 'imports') return dataset.imports.map((row) => ({ name: row.name, value: row.rows }))
  if (activeTab.value === 'models') return dataset.models.map((row) => ({ name: row.name, value: row.accuracy }))
  return agentLive.value?.chartRows ?? []
}

function renderChart() {
  if (!chartRef.value) return
  const rows = chartRows()
  distChart.setOption({
    ...emptyOverlay(!rows.length),
    grid: { left: 52, right: 22, top: 30, bottom: 74 },
    tooltip: axisTooltip({ unit: tabUnits[activeTab.value], pointer: 'shadow' }),
    toolbox: chartToolbox('运营分布'),
    xAxis: { type: 'category', data: rows.map((row) => row.name), axisLabel: { interval: 0, rotate: 24 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#e6edf3' } } },
    series: [
      {
        name: tabs.find((tab) => tab.value === activeTab.value)?.label ?? '数值',
        type: 'bar',
        data: rows.map((row) => row.value),
        itemStyle: { color: activeTab.value === 'risks' ? '#ea580c' : '#0f766e' }
      }
    ]
  }, { notMerge: true })
}

// 当前页签明细一键导出 CSV(与下方表格列一致)
function exportDetail() {
  const tab = activeTab.value
  if (tab === 'stations') {
    exportCsv('运营明细_电站', ['电站', '类型', '容量(MW)', '电压等级', '区域', '状态'],
      dataset.stations.map((r) => [r.name, r.type, r.capacity, r.voltageLevel, r.province, r.status]))
  } else if (tab === 'contracts') {
    exportCsv('运营明细_合同', ['合同编号', '交易对手', '类型', '电量(亿kWh)', '价格', '状态'],
      dataset.contracts.map((r) => [r.code, r.counterparty, r.type, r.volume, r.price, r.status]))
  } else if (tab === 'settlements') {
    exportCsv('运营明细_结算', ['月份', '电量(亿kWh)', '收入(万元)', '偏差(%)', '状态'],
      dataset.settlements.map((r) => [r.month, r.energy, r.income, r.deviation, r.status]))
  } else if (tab === 'risks') {
    exportCsv('运营明细_风险', ['风险项', '等级', '敞口(万元)', '阈值(万元)', '责任域'],
      dataset.risks.map((r) => [r.name, r.level, r.exposure, r.threshold, r.owner]))
  } else if (tab === 'imports') {
    exportCsv('运营明细_导入', ['任务', '来源', '行数', '状态', '最近运行'],
      dataset.imports.map((r) => [r.name, r.source, r.rows, r.status, r.lastRun]))
  } else if (tab === 'models') {
    exportCsv('运营明细_模型', ['模型', '类型', '版本', '精度(%)', '状态'],
      dataset.models.map((r) => [r.name, r.type, r.version, r.accuracy, r.status]))
  } else {
    // agents 页签展示的是 harness 实时工具列表，导出与显示保持一致
    exportCsv('运营明细_智能体工具', ['工具', '类别', '风险级', '说明'],
      (agentLive.value?.tools ?? []).map((r) => [r.name, r.category, r.risk, r.description]))
  }
}

watch(activeTab, () => nextTick(renderChart))

onMounted(() => {
  renderChart()
  // useEChart 已托管 resize/dispose；这里只补 harness 实时数据拉取
  fetchAgentMonitor().then((data) => {
    agentLive.value = data
    if (activeTab.value === 'agents') nextTick(renderChart)
  })
})
</script>

<template>
  <div class="page-stack ops-workbench">
    <section class="metric-grid">
      <article v-for="metric in metrics" :key="metric.label" class="metric-card">
        <span>{{ metric.label }}</span>
        <strong>{{ metric.value }} <small>{{ metric.unit }}</small></strong>
        <em :class="metric.tone">运营</em>
      </article>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>运营中枢</h2>
        <span>电站、合同、结算、风险、导入、模型与智能体迁移面</span>
      </div>
      <div class="toolbar ops-toolbar">
        <el-radio-group v-model="activeTab">
          <el-radio-button v-for="tab in tabs" :key="tab.value" :value="tab.value">
            {{ tab.label }}
          </el-radio-button>
        </el-radio-group>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title compact">
        <h2>运营分布</h2>
        <span>{{ tabs.find((tab) => tab.value === activeTab)?.label }}</span>
      </div>
      <div ref="chartRef" class="chart chart-host"></div>
    </section>

    <section class="panel">
      <div class="panel-title compact">
        <h2>明细</h2>
        <span>{{ tabs.find((tab) => tab.value === activeTab)?.label }}</span>
        <el-button size="small" style="margin-left: auto" @click="exportDetail">导出CSV</el-button>
      </div>

      <el-table v-if="activeTab === 'stations'" :data="dataset.stations" size="small">
        <el-table-column prop="name" label="电站" min-width="160" />
        <el-table-column prop="type" label="类型" width="110" />
        <el-table-column prop="capacity" label="容量(MW)" width="120" align="right" sortable />
        <el-table-column prop="voltageLevel" label="电压等级" width="120" />
        <el-table-column prop="province" label="区域" width="100" />
        <el-table-column prop="status" label="状态" width="100" />
      </el-table>

      <el-table v-else-if="activeTab === 'contracts'" :data="dataset.contracts" size="small">
        <el-table-column prop="code" label="合同编号" min-width="150" />
        <el-table-column prop="counterparty" label="交易对手" min-width="140" />
        <el-table-column prop="type" label="类型" width="120" />
        <el-table-column prop="volume" label="电量(亿kWh)" width="130" align="right" sortable />
        <el-table-column prop="price" label="价格" width="100" align="right" sortable />
        <el-table-column prop="status" label="状态" width="110" />
      </el-table>

      <el-table v-else-if="activeTab === 'settlements'" :data="dataset.settlements" size="small">
        <el-table-column prop="month" label="月份" width="110" sortable />
        <el-table-column prop="energy" label="电量(亿kWh)" width="140" align="right" sortable />
        <el-table-column prop="income" label="收入(万元)" width="130" align="right" sortable />
        <el-table-column prop="deviation" label="偏差(%)" width="110" align="right" sortable />
        <el-table-column prop="status" label="状态" width="110" />
      </el-table>

      <el-table v-else-if="activeTab === 'risks'" :data="dataset.risks" size="small">
        <el-table-column prop="name" label="风险项" min-width="160" />
        <el-table-column prop="level" label="等级" width="90" />
        <el-table-column prop="exposure" label="敞口(万元)" width="130" align="right" sortable />
        <el-table-column prop="threshold" label="阈值(万元)" width="130" align="right" sortable />
        <el-table-column prop="owner" label="责任域" width="130" />
      </el-table>

      <el-table v-else-if="activeTab === 'imports'" :data="dataset.imports" size="small">
        <el-table-column prop="name" label="任务" min-width="160" />
        <el-table-column prop="source" label="来源" min-width="170" />
        <el-table-column prop="rows" label="行数" width="120" align="right" sortable />
        <el-table-column prop="status" label="状态" width="110" />
        <el-table-column prop="lastRun" label="最近运行" width="140" sortable />
      </el-table>

      <el-table v-else-if="activeTab === 'models'" :data="dataset.models" size="small">
        <el-table-column prop="name" label="模型" min-width="160" />
        <el-table-column prop="type" label="类型" width="110" />
        <el-table-column prop="version" label="版本" min-width="170" />
        <el-table-column prop="accuracy" label="精度(%)" width="115" align="right" sortable />
        <el-table-column prop="status" label="状态" width="110" />
      </el-table>

      <div v-else>
        <p v-if="agentLive && !agentLive.online" class="ops-hint">
          智能体后端未连接：启动 <code>npm run dev:agent-api</code> 后刷新，即可见真实工具与会话。
        </p>
        <el-table :data="agentLive?.tools ?? []" size="small">
          <el-table-column prop="name" label="工具" min-width="180" />
          <el-table-column prop="category" label="类别" width="120" />
          <el-table-column prop="risk" label="风险级" width="100" />
          <el-table-column prop="description" label="说明" min-width="240" show-overflow-tooltip />
        </el-table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ops-workbench {
  gap: 18px;
}

.ops-toolbar {
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.chart {
  height: 360px;
  width: 100%;
}

.panel-title.compact {
  margin-bottom: 12px;
}

.ops-hint {
  margin: 0 0 12px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  background: var(--surface-hover, #f5f7fa);
  border-radius: 8px;
}
.ops-hint code { padding: 1px 5px; border-radius: 4px; background: rgba(0, 0, 0, 0.06); }

/* 断点对齐 responsive.css 规约(768 = 移动端阈值) */
@media (max-width: 768px) {
  .ops-toolbar :deep(.el-radio-group) {
    max-width: 100%;
    overflow-x: auto;
  }
}
</style>
