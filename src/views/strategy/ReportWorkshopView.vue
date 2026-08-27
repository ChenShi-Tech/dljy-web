<template>
  <div class="report-workshop">
    <!-- ============================================================ -->
    <!-- 顶部统计看板 -->
    <!-- ============================================================ -->
    <div class="stats-bar">
      <div class="stat-item">
        <span class="stat-value">{{ templates.length }}</span>
        <span class="stat-label">可用模板</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item">
        <span class="stat-value">{{ stats.todayCount }}</span>
        <span class="stat-label">今日生成</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item">
        <span class="stat-value">{{ stats.monthCount }}</span>
        <span class="stat-label">本月累计</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item">
        <span class="stat-value">{{ stats.totalCount }}</span>
        <span class="stat-label">历史总计</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item">
        <span class="stat-value">{{ mostUsedTemplate }}</span>
        <span class="stat-label">最热模板</span>
      </div>
      <div class="stat-right">
        <el-tag type="warning" v-if="serviceStatus === 'unavailable'" size="small" effect="plain">
          模拟数据
        </el-tag>
        <el-tag type="success" v-else-if="serviceStatus === 'available'" size="small" effect="plain">
          Dify 已连接
        </el-tag>
        <el-tag v-else size="small" effect="plain">检测中...</el-tag>
      </div>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="报告三引擎分工 · 本页 = 自助叙事 / 洞察报告（Dify AI workflow 生成）。需确定性结算报表 → 「报表中心」；需定时自动生成并归档 → 「定时任务 · 结果中心」。"
      style="margin: 0 0 12px;"
    />

    <!-- ============================================================ -->
    <!-- 主内容区 -->
    <!-- ============================================================ -->
    <div class="workshop-body">
      <!-- ========== 左栏：模板 + 参数 + 历史 ========== -->
      <div class="left-panel">
        <!-- 模板选择器 -->
        <div class="section-card template-section">
          <div class="section-header">
            <span class="section-title">报告模板库</span>
            <div class="template-tabs">
              <span
                v-for="cat in templateCategories"
                :key="cat.key"
                class="tab-chip"
                :class="{ active: activeCategory === cat.key }"
                @click="activeCategory = cat.key"
              >{{ cat.label }}</span>
            </div>
          </div>
          <div class="search-box">
            <el-input
              v-model="searchQuery"
              placeholder="搜索模板..."
              :prefix-icon="Search"
              clearable
              size="small"
            />
          </div>
          <div class="template-grid" ref="templateGridRef">
            <div
              v-for="tmpl in filteredTemplates"
              :key="tmpl.id"
              class="template-card"
              :class="{ selected: selectedTemplateId === tmpl.id, mock: tmpl.mock }"
              @click="onTemplateSelected(tmpl.id)"
            >
              <div class="tc-icon-wrap" :class="{ mock: tmpl.mock }">
                <component :is="tmpl.icon" :size="22" />
              </div>
              <div class="tc-body">
                <div class="tc-name">
                  {{ tmpl.name }}
                  <el-tag v-if="tmpl.connected" type="success" size="small" effect="plain" class="tc-tag">Dify</el-tag>
                  <el-tag v-else type="warning" size="small" effect="plain" class="tc-tag">示例</el-tag>
                </div>
                <div class="tc-desc">{{ tmpl.description }}</div>
              </div>
              <div class="tc-check" v-if="selectedTemplateId === tmpl.id">
                <el-icon color="var(--el-color-primary)"><check /></el-icon>
              </div>
            </div>
          </div>
          <div v-if="filteredTemplates.length === 0" class="empty-hint">
            {{ searchQuery ? '无匹配模板，请调整搜索条件' : '暂无可用模板，请先在 Dify Studio 中创建工作流应用。' }}
          </div>
        </div>

        <!-- 参数配置 -->
        <div class="section-card config-section" v-if="selectedTemplate">
          <div class="section-header">
            <span class="section-title">参数配置</span>
            <span class="section-sub">{{ selectedTemplate.name }}</span>
          </div>
          <div class="preset-chips">
            <span class="preset-label">快捷：</span>
            <span class="preset-chip" @click="setPreset('today')">今日</span>
            <span class="preset-chip" @click="setPreset('week')">近7天</span>
            <span class="preset-chip" @click="setPreset('month')">本月</span>
          </div>
          <el-form label-position="top" size="default" class="config-form">
            <el-form-item label="日期范围">
              <el-date-picker
                v-model="params.dateRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                format="YYYY-MM-DD"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item label="市场类型">
              <el-select v-model="params.marketType" style="width: 100%">
                <el-option label="⚡ 日前现货" value="spot" />
                <el-option label="📋 中长期" value="midlong" />
                <el-option label="🌐 省间现货" value="interprovincial" />
                <el-option label="📊 综合" value="all" />
              </el-select>
            </el-form-item>
            <el-form-item label="输出格式">
              <el-radio-group v-model="params.outputFormat">
                <el-radio-button value="markdown">Markdown</el-radio-button>
                <el-radio-button value="html">HTML</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-form>
          <el-button
            type="primary"
            :loading="generating"
            :disabled="!selectedTemplate || generating"
            @click="generateReport"
            class="generate-btn"
            size="large"
          >
            <span v-if="!generating">⚡ 生成报告</span>
            <span v-else>正在生成...</span>
          </el-button>
        </div>

        <!-- 最近报告历史 -->
        <div class="section-card history-section" v-if="reportHistory.length > 0">
          <div class="section-header">
            <span class="section-title">最近报告</span>
            <span class="section-sub">{{ reportHistory.length }} 条记录</span>
          </div>
          <div class="history-list">
            <div
              v-for="item in reportHistory.slice(0, 8)"
              :key="item.id"
              class="history-item"
              @click="loadHistoryReport(item)"
            >
              <span class="hi-icon">{{ item.mock ? '📝' : '🤖' }}</span>
              <div class="hi-body">
                <div class="hi-name">{{ item.templateName }}</div>
                <div class="hi-meta">{{ item.time }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ========== 右栏：报告预览 ========== -->
      <div class="right-panel">
        <!-- 工具栏 -->
        <div class="toolbar" v-if="reportContent">
          <span class="toolbar-title">{{ reportMeta.template || '报告预览' }}</span>
          <div class="toolbar-actions">
            <el-button size="small" text @click="fontSize = Math.max(12, fontSize - 1)">A-</el-button>
            <span class="font-size-label">{{ fontSize }}px</span>
            <el-button size="small" text @click="fontSize = Math.min(20, fontSize + 1)">A+</el-button>
            <el-divider direction="vertical" />
            <el-button size="small" text @click="copyReport">复制</el-button>
            <el-dropdown @command="handleExport" trigger="click">
              <el-button size="small" type="primary" :icon="Download">导出</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="markdown">📝 Markdown</el-dropdown-item>
                  <el-dropdown-item command="word">📄 Word 文档</el-dropdown-item>
                  <el-dropdown-item command="pdf">🖨️ PDF</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>

        <!-- 文档风格预览 -->
        <div class="paper-container" v-if="reportContent">
          <div class="paper-sheet" :style="{ fontSize: fontSize + 'px' }">
            <div class="paper-header">
              <div class="paper-logo">DLJY 报告工坊</div>
              <div class="paper-meta-line">
                <span>生成时间：{{ reportMeta.time }}</span>
                <span>模板：{{ reportMeta.template }}</span>
                <!-- 来源按「本次产物实际生成路径」标注，不读页级 serviceStatus：
                     任一模板探活在线 ≠ 选中的模板在线，混部态下旧写法会把本地 Mock 报告标成 Dify AI -->
                <span>数据来源：{{ reportMeta.source === 'dify' ? 'Dify AI' : '模拟数据' }}</span>
              </div>
            </div>
            <div class="paper-body markdown-body" v-html="renderedReport" />
            <div class="paper-footer">
              <span>— 本报告由 DLJY 报告工坊自动生成 —</span>
            </div>
          </div>
        </div>

        <!-- 错误提示 -->
        <div class="report-error" v-if="reportError">
          <el-alert :title="reportError" type="error" show-icon :closable="false" />
        </div>

        <!-- 空状态 -->
        <div class="empty-state" v-if="!reportContent && !reportError">
          <div class="empty-illustration">
            <FileText :size="56" stroke-width="1" />
          </div>
          <div class="empty-title">选择模板并配置参数</div>
          <div class="empty-desc">点击「生成报告」即可在此预览</div>
          <div class="empty-tips">
            <div class="tip-item">💡 支持日前日报、月度结算、场站对比等 {{ templates.length }} 种报告类型</div>
            <div class="tip-item">📄 生成后可导出为 Markdown / Word / PDF 格式</div>
            <div class="tip-item">🤖 接入 Dify 后可调用 AI 工作流生成真实分析报告</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, shallowRef } from 'vue'
import {
  FileText, TrendingUp, Calculator, ClipboardCheck, ShieldAlert,
  Download, Search, Check
} from 'lucide-vue-next'
import { pingDifyService, runReportWorkflow } from '@/services/agent/difyClient'
import { renderMarkdown } from '../../utils/markdown'
import { beijingDay, currentMonthBeijing, todayBeijing } from '@/utils/beijingDate'

// ============================================================
// 类型定义
// ============================================================
interface LocalTemplate {
  id: string
  name: string
  description: string
  icon: any
  mock: boolean
  category: 'daily' | 'settlement' | 'analysis'
  connected?: boolean // 是否已接通真实 Dify workflow（探活结果）
}

interface HistoryEntry {
  id: string
  templateId: string
  templateName: string
  time: string
  content: string
  mock: boolean
  params: Record<string, any>
  ts: number
}

// ============================================================
// 模板定义（含分类）
// ============================================================
const LOCAL_TEMPLATES: LocalTemplate[] = [
  { id: 'daily-spot', name: '日前市场日报', description: '现货价格走势 + 竞价空间 + 结算预估', icon: TrendingUp, mock: true, category: 'daily' },
  { id: 'monthly-settlement', name: '月度结算分析', description: '月度累计结算 + 合同执行 + 偏差分析', icon: Calculator, mock: true, category: 'settlement' },
  { id: 'station-compare', name: '场站出力对比', description: '多场站/机组出力对比 + 利用小时', icon: FileText, mock: true, category: 'analysis' },
  { id: 'contract-tracker', name: '合同执行跟踪', description: '合同履约进度 + 量价对比 + 到期提醒', icon: ClipboardCheck, mock: true, category: 'analysis' },
  { id: 'risk-dashboard', name: '风险仪表盘', description: 'CVaR 敞口 + 价格波动 + 持仓集中度', icon: ShieldAlert, mock: true, category: 'analysis' }
]

const templateCategories = [
  { key: 'all', label: '全部' },
  { key: 'daily', label: '日报类' },
  { key: 'settlement', label: '结算类' },
  { key: 'analysis', label: '分析类' }
]

// ============================================================
// 响应式状态
// ============================================================
const serviceStatus = ref<'checking' | 'available' | 'unavailable'>('checking')
const templates = shallowRef<LocalTemplate[]>([])
const selectedTemplateId = ref<string>('')
const activeCategory = ref<string>('all')
const searchQuery = ref('')
const generating = ref(false)
const reportContent = ref('')
const reportError = ref('')
const fontSize = ref(15)
const reportMeta = reactive({ time: '', template: '', source: '' as '' | 'dify' | 'mock' })
const reportHistory = ref<HistoryEntry[]>([])
const templateGridRef = ref<HTMLElement | null>(null)

const params = reactive({
  dateRange: null as [string, string] | null,
  marketType: 'spot',
  outputFormat: 'markdown' as 'markdown' | 'html'
})

// ============================================================
// 计算属性（性能：利用 computed 缓存）
// ============================================================
const selectedTemplate = computed(() =>
  templates.value.find(t => t.id === selectedTemplateId.value) || null
)

const filteredTemplates = computed(() => {
  let list = templates.value
  if (activeCategory.value !== 'all') {
    list = list.filter(t => t.category === activeCategory.value)
  }
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter(t =>
      t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    )
  }
  return list
})

const renderedReport = computed(() => {
  if (!reportContent.value) return ''
  return renderMarkdown(reportContent.value)
})

// 统计指标
const stats = computed(() => {
  const todayStart = new Date().setHours(0, 0, 0, 0)
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()

  const today = reportHistory.value.filter(h => h.ts >= todayStart)
  const month = reportHistory.value.filter(h => h.ts >= monthStart)

  return {
    todayCount: today.length,
    monthCount: month.length,
    totalCount: reportHistory.value.length
  }
})

const mostUsedTemplate = computed(() => {
  const counts: Record<string, number> = {}
  reportHistory.value.forEach(h => {
    counts[h.templateId] = (counts[h.templateId] || 0) + 1
  })
  let max = 0, maxId = ''
  Object.entries(counts).forEach(([id, c]) => {
    if (c > max) { max = c; maxId = id }
  })
  const tmpl = templates.value.find(t => t.id === maxId)
  return tmpl ? tmpl.name : '—'
})

// ============================================================
// 历史记录持久化（localStorage）
// ============================================================
const HISTORY_KEY = 'dljy_report_workshop_history'

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (raw) reportHistory.value = JSON.parse(raw)
  } catch { /* ignore */ }
}

function saveHistory() {
  try {
    // 只保留最近 100 条
    const trimmed = reportHistory.value.slice(0, 100)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed))
  } catch { /* ignore */ }
}

function addHistory(templateId: string, templateName: string, content: string, mock: boolean) {
  reportHistory.value.unshift({
    id: `rpt_${Date.now()}`,
    templateId,
    templateName,
    time: new Date().toLocaleString('zh-CN'),
    content,
    mock,
    params: { ...params },
    ts: Date.now()
  })
  saveHistory()
}

function loadHistoryReport(item: HistoryEntry) {
  selectedTemplateId.value = item.templateId
  reportContent.value = item.content
  reportError.value = ''
  reportMeta.time = item.time
  reportMeta.template = item.templateName
  // 历史条目本就记录了真伪（addHistory 第4参），回放时精确还原产物级来源
  reportMeta.source = item.mock ? 'mock' : 'dify'
  // 还原参数
  if (item.params.dateRange) params.dateRange = item.params.dateRange
  if (item.params.marketType) params.marketType = item.params.marketType
  if (item.params.outputFormat) params.outputFormat = item.params.outputFormat
}

// ============================================================
// 模板加载
// ============================================================
let _loadDebounceTimer: ReturnType<typeof setTimeout> | null = null

async function loadTemplates() {
  serviceStatus.value = 'checking'
  // 本地 5 模板为基准列表；逐个探活标注是否已接通真实 Dify workflow（app key 有效 + Dify 可达）
  const probed = await Promise.all(
    LOCAL_TEMPLATES.map(async (t) => {
      let connected = false
      try { connected = await pingDifyService(t.id) } catch { connected = false }
      return { ...t, connected }
    })
  )
  templates.value = probed
  serviceStatus.value = probed.some(t => t.connected) ? 'available' : 'unavailable'
}

function onTemplateSelected(templateId: string) {
  selectedTemplateId.value = templateId
  reportContent.value = ''
  reportError.value = ''
}

// 快捷预设
function setPreset(preset: 'today' | 'week' | 'month') {
  // 「今天/本月」按北京时区口径取日（裸 UTC 日期在 0–8 点会拿到昨天；本地月初再
  // toISOString 则恒少一天），全站约定见 @/utils/beijingDate。
  switch (preset) {
    case 'today':
      params.dateRange = [todayBeijing(), todayBeijing()]
      break
    case 'week':
      params.dateRange = [beijingDay(-6), todayBeijing()]
      break
    case 'month':
      params.dateRange = [`${currentMonthBeijing()}-01`, todayBeijing()]
      break
  }
}

// ============================================================
// 报告生成
// ============================================================
// Mock 产物统一注入来源声明（红线：模拟内容必须自带可见标注，导出后仍可辨识）。
// 正文前部已自带同义标注的模板（daily-spot）跳过注入，避免双重声明、字面量零改动。
function withMockSourceNote(content: string): string {
  if (/数据来源：模拟数据/.test(content.slice(0, 300))) return content
  return `> 数据来源：模拟数据（Dify 未接通，本地模板生成）\n\n${content}`
}

async function generateReport() {
  if (!selectedTemplate.value) return

  generating.value = true
  reportContent.value = ''
  reportError.value = ''

  try {
    const connected = !!selectedTemplate.value.connected
    if (connected) {
      const result = await runReportWorkflow({
        templateId: selectedTemplate.value.id,
        date_range: params.dateRange ? { start: params.dateRange[0], end: params.dateRange[1] } : undefined,
        market_type: params.marketType,
        output_format: params.outputFormat
      })
      reportContent.value = result.data?.outputs?.text ?? result.data?.outputs?.report ?? JSON.stringify(result.data, null, 2)
    } else {
      // 模拟延迟让动画可见
      await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 700))
      reportContent.value = withMockSourceNote(generateMockReport(selectedTemplate.value))
    }
    reportMeta.time = new Date().toLocaleString('zh-CN')
    reportMeta.template = selectedTemplate.value.name
    reportMeta.source = connected ? 'dify' : 'mock'
    addHistory(selectedTemplate.value.id, selectedTemplate.value.name, reportContent.value, !connected)
  } catch (err: any) {
    reportError.value = err?.message || '报告生成失败，请稍后重试'
  } finally {
    generating.value = false
  }
}

// ============================================================
// Mock 报告内容
// ============================================================
function generateMockReport(tmpl: LocalTemplate): string {
  const dateLabel = params.dateRange
    ? `${params.dateRange[0]} ~ ${params.dateRange[1]}`
    : new Date().toLocaleDateString('zh-CN')
  const marketLabel = { spot: '日前现货', midlong: '中长期', interprovincial: '省间现货', all: '综合' }[params.marketType] ?? '日前现货'

  const bodies: Record<string, string> = {
    'daily-spot': `# 日前市场日报\n\n> 市场类型：${marketLabel} | 报告日期：${dateLabel}\n> 数据来源：模拟数据 | Mock 模式\n\n## 一、市场概览\n\n| 指标 | 数值 | 环比 |\n|------|------|------|\n| 日前出清均价 | 382.56 元/MWh | +2.3% |\n| 最高出清价 | 520.18 元/MWh (19:15) | — |\n| 最低出清价 | 198.40 元/MWh (03:45) | — |\n| 竞价空间 | 28,450 MW | -1.8% |\n| 新能源出力占比 | 34.2% | +5.1% |\n\n## 二、价格走势分析\n\n今日日前市场价格整体呈现"早低晚高"特征，峰谷价差 321.78 元/MWh。早高峰（07:00-09:00）均价 412 元/MWh，晚高峰（18:00-21:00）均价 468 元/MWh。\n\n## 三、结算预估\n\n| 项目 | 金额 |\n|------|------|\n| 现货电能量结算 | 1,285,600 元 |\n| 偏差考核预提 | -42,300 元 |\n| 预计总收益 | 1,243,300 元 |\n\n## 四、风险提示\n\n- ⚠️ 明日新能源出力预计增长 8%，可能压低午间价格\n- ℹ️ 省间联络线计划调整，外送电量增加 500 MW\n`,

    'monthly-settlement': `# 月度结算分析报告\n\n> 报告期间：${dateLabel}\n> 市场类型：${marketLabel}\n\n## 一、当月累计结算汇总\n\n| 项目 | 合约电量(MWh) | 合约均价(元/MWh) | 结算金额(元) |\n|------|-------------|-----------------|-------------|\n| 中长期合约 | 125,600 | 386.50 | 48,544,400 |\n| 现货日前 | 38,200 | 374.80 | 14,317,360 |\n| 现货实时 | 4,500 | 368.20 | 1,656,900 |\n| 省间现货 | 12,800 | 402.10 | 5,146,880 |\n| **合计** | **181,100** | **384.21** | **69,665,540** |\n\n## 二、偏差分析\n\n- 日前 vs 实时偏差率：3.2%（可控范围内）\n- 偏差考核扣款：-42,300 元\n- 中长期合同执行率：87.5%\n`,

    'station-compare': `# 场站出力对比报告\n\n> 报告日期：${dateLabel}\n\n## 一、场站出力对比\n\n| 场站 | 装机容量(MW) | 日发电量(MWh) | 利用小时(h) | 负荷率 |\n|------|------------|-------------|-----------|--------|\n| 站A-风电 | 150 | 1,860 | 12.4 | 51.7% |\n| 站B-光伏 | 80 | 432 | 5.4 | 22.5% |\n| 站C-火电 | 300 | 5,760 | 19.2 | 80.0% |\n| 站D-水电 | 120 | 2,016 | 16.8 | 70.0% |\n\n## 二、统计摘要\n\n| 指标 | 数值 |\n|------|------|\n| 总发电量 | 10,068 MWh |\n| 平均利用小时 | 13.5 h |\n| 平均负荷率 | 56.1% |\n| 风电占比 | 18.5% |\n| 火电占比 | 57.2% |\n\n## 三、分析与建议\n\n- 风电利用小时数高于同期均值（10.2h），来风条件良好\n- 光伏站负荷率偏低，建议检查逆变器运行状态\n`,

    'contract-tracker': `# 合同执行跟踪报告\n\n> 报告日期：${dateLabel}\n\n## 一、合同履约进度\n\n| 合同编号 | 对手方 | 总电量(MWh) | 已完成(MWh) | 进度 | 到期日 |\n|----------|--------|------------|------------|------|--------|\n| HT-2026-001 | 华能云南 | 50,000 | 32,500 | 65% | 2026-09-30 |\n| HT-2026-002 | 大唐云南 | 30,000 | 18,000 | 60% | 2026-08-31 |\n| HT-2026-003 | 国电投 | 20,000 | 15,200 | 76% | 2026-07-31 |\n\n## 二、统计摘要\n\n| 指标 | 数值 |\n|------|------|\n| 合同总数 | 3 份 |\n| 合同总电量 | 100,000 MWh |\n| 已完成电量 | 65,700 MWh |\n| 整体履约率 | 65.7% |\n| 即将到期合同 | 1 份（45天内） |\n\n## 三、到期提醒\n\n- ⚠️ HT-2026-003 将于 45 天后到期，剩余 4,800 MWh 待执行\n`,

    'risk-dashboard': `# 风险仪表盘报告\n\n> 报告日期：${dateLabel}\n\n## 一、风险指标总览\n\n| 风险维度 | 当前值 | 阈值 | 状态 |\n|----------|--------|------|------|\n| VaR (95%, 1d) | 285,600 元 | 500,000 元 | ✅ 正常 |\n| CVaR (95%, 1d) | 412,300 元 | 800,000 元 | ✅ 正常 |\n| 持仓集中度 (Top1) | 35% | 40% | ✅ 正常 |\n| 价格波动率 (30d) | 18.2% | 25% | ✅ 正常 |\n| 偏差考核概率 | 12.5% | 20% | ✅ 正常 |\n\n## 二、统计摘要\n\n| 指标 | 数值 |\n|------|------|\n| 综合风险评分 | 72/100（低风险） |\n| 风险敞口 | 1,245,000 元 |\n| 对冲覆盖率 | 68% |\n\n## 三、风险提示\n\n- 当前各风险指标均在正常范围内\n- 建议关注：月末中长期合约集中到期，需提前安排滚动交易\n`
  }

  return bodies[tmpl.id] ?? `# ${tmpl.name}\n\n报告内容（Mock 模式）。Dify 接入后将生成真实分析报告。\n\n> 报告日期：${dateLabel}`
}

// ============================================================
// 导出功能
// ============================================================
function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function exportMarkdown() {
  if (!reportContent.value) return
  downloadBlob(reportContent.value, `report-${selectedTemplate.value?.id ?? 'export'}-${Date.now()}.md`, 'text/markdown')
}

function exportWord() {
  if (!renderedReport.value) return
  const name = selectedTemplate.value?.name ?? '报告'
  const wordHtml = `<!DOCTYPE html>\n<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">\n<head><meta charset="utf-8"><title>${name}</title>\n<style>\nbody{font-family:"Microsoft YaHei",SimSun,sans-serif;font-size: var(--font-lg);line-height:1.8;color:#333;padding:24px}\nh1{font-size: var(--font-22);border-bottom:2px solid #333;padding-bottom:8px}\nh2{font-size: var(--font-18);border-bottom:1px solid #ccc;padding-bottom:4px}\nh3{font-size: var(--font-15)}\ntable{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #999;padding:6px 10px;font-size: var(--font-md)}\n.meta{color:#888;font-size: var(--font-sm);margin-bottom:16px}\n</style></head>\n<body>\n<div class="meta">生成时间：${reportMeta.time} | 模板：${name}${reportMeta.source === 'mock' ? ' | 数据来源：模拟数据' : ''}</div>\n${renderedReport.value}\n</body></html>`
  downloadBlob(wordHtml, `report-${name}-${Date.now()}.doc`, 'application/msword')
}

function exportPDF() {
  if (!renderedReport.value) return
  const name = selectedTemplate.value?.name ?? '报告'
  const html = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${name}</title>\n<style>\nbody{font-family:"Microsoft YaHei",SimSun,sans-serif;font-size: var(--font-lg);line-height:1.8;color:#333;padding:32px;max-width:800px;margin:0 auto}\nh1{font-size: var(--font-22);border-bottom:2px solid #333;padding-bottom:8px}\nh2{font-size: var(--font-18);border-bottom:1px solid #ccc;padding-bottom:4px}\nh3{font-size: var(--font-15)}\ntable{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #999;padding:6px 10px;font-size: var(--font-md)}\n.meta{color:#888;font-size: var(--font-sm);margin-bottom:16px}\n@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}\n</style></head>\n<body>\n<div class="meta">生成时间：${reportMeta.time} | 模板：${name}${reportMeta.source === 'mock' ? ' | 数据来源：模拟数据' : ''}</div>\n${renderedReport.value}\n</body></html>`
  const win = window.open('', '_blank', 'width=900,height=700')
  if (win) { win.document.write(html); win.document.close(); win.onload = () => win.print() }
}

function handleExport(command: string) {
  if (command === 'markdown') exportMarkdown()
  else if (command === 'word') exportWord()
  else if (command === 'pdf') exportPDF()
}

function copyReport() {
  if (!reportContent.value) return
  navigator.clipboard.writeText(reportContent.value).then(() => {
    // 轻提示通过 ElMessage 或其他方式，这里简化
  }).catch(() => { /* ignore */ })
}

// ============================================================
// 初始化
// ============================================================
onMounted(() => {
  loadHistory()
  loadTemplates()
})
</script>

<style scoped>
/* ============================================================ */
/* CSS 变量 & 性能优化 */
/* ============================================================ */
.report-workshop {
  --rw-card-bg: var(--el-bg-color);
  --rw-card-shadow: 0 1px 3px rgba(0,0,0,.06);
  --rw-card-hover-shadow: 0 4px 16px rgba(0,0,0,.1);
  --rw-card-selected-shadow: 0 0 0 2px var(--el-color-primary-light-3), 0 4px 16px rgba(64,158,255,.18);
  --rw-radius: 10px;
  --rw-transition: 0.2s cubic-bezier(.4,0,.2,1);

  padding: 16px 24px 24px;
  max-width: 1500px;
  margin: 0 auto;
  contain: layout style;
}

/* ============================================================ */
/* 顶部统计看板 */
/* ============================================================ */
.stats-bar {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 12px 18px;
  background: var(--rw-card-bg);
  border-radius: var(--rw-radius);
  box-shadow: var(--rw-card-shadow);
  margin-bottom: 16px;
  contain: layout style;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 80px;
}

.stat-value {
  font-size: var(--font-22);
  font-weight: 700;
  color: var(--el-color-primary);
  line-height: 1.2;
}

.stat-label {
  font-size: var(--font-xs);
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

.stat-divider {
  width: 1px;
  height: 36px;
  background: var(--el-border-color-light);
  margin: 0 16px;
}

.stat-right {
  margin-left: auto;
}

/* ============================================================ */
/* 两栏布局 */
/* ============================================================ */
.workshop-body {
  display: grid;
  grid-template-columns: 400px 1fr;
  gap: 16px;
  contain: layout style;
}

/* ============================================================ */
/* 左侧面板 */
/* ============================================================ */
.left-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* 整体不滚动，各子区域独立滚动 */
  min-height: 0;
}

.section-card {
  background: var(--rw-card-bg);
  border-radius: var(--rw-radius);
  box-shadow: var(--rw-card-shadow);
  padding: 14px 16px;
  contain: layout style;
}

/* 模板区独立滚动 */
.template-section {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow: hidden;
}

.template-section .section-header {
  flex-shrink: 0;
}

.template-section .search-box {
  flex-shrink: 0;
}

.template-section .template-grid {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  padding-right: 4px;
}

.template-section .empty-hint {
  flex-shrink: 0;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.section-title {
  font-size: var(--font-lg);
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.section-sub {
  font-size: var(--font-sm);
  color: var(--el-text-color-secondary);
}

/* ============================================================ */
/* 分类标签 */
/* ============================================================ */
.template-tabs {
  display: flex;
  gap: 4px;
}

.tab-chip {
  font-size: var(--font-sm);
  padding: 3px 10px;
  border-radius: 12px;
  cursor: pointer;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  transition: all var(--rw-transition);
  user-select: none;
}

.tab-chip:hover {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.tab-chip.active {
  color: #fff;
  background: var(--el-color-primary);
}

/* ============================================================ */
/* 搜索框 */
/* ============================================================ */
.search-box {
  margin-bottom: 10px;
}

/* ============================================================ */
/* 模板卡片网格 */
/* ============================================================ */
.template-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  contain: layout style;
}

.template-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1.5px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all var(--rw-transition);
  position: relative;
  background: var(--el-fill-color-lighter);
}

.template-card:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: var(--rw-card-hover-shadow);
  transform: translateX(2px);
}

.template-card.selected {
  border-color: var(--el-color-primary);
  box-shadow: var(--rw-card-selected-shadow);
  background: var(--el-color-primary-light-9);
}

.template-card.mock {
  border-style: solid;
}

.tc-icon-wrap {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: var(--el-color-primary-light-9);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-color-primary);
  flex-shrink: 0;
  transition: all var(--rw-transition);
}

.tc-icon-wrap.mock {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}

.template-card.selected .tc-icon-wrap {
  background: var(--el-color-primary);
  color: #fff;
}

.tc-body {
  flex: 1;
  min-width: 0;
}

.tc-name {
  font-size: var(--font-md);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.tc-tag {
  flex-shrink: 0;
}

.tc-desc {
  font-size: var(--font-11-5);
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.tc-check {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ============================================================ */
/* 参数配置 */
/* ============================================================ */
.preset-chips {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}

.preset-label {
  font-size: var(--font-sm);
  color: var(--el-text-color-secondary);
  margin-right: 2px;
}

.preset-chip {
  font-size: var(--font-11-5);
  padding: 2px 10px;
  border-radius: 10px;
  border: 1px solid var(--el-border-color);
  cursor: pointer;
  transition: all var(--rw-transition);
  user-select: none;
}

.preset-chip:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.config-form {
  margin-top: 4px;
}

.generate-btn {
  width: 100%;
  margin-top: 8px;
  transition: all var(--rw-transition);
}

.generate-btn:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(64,158,255,.35);
}

/* ============================================================ */
/* 历史列表 */
/* ============================================================ */
/* 历史列表独立滚动 */
.history-section {
  display: flex;
  flex-direction: column;
  max-height: 240px;
  overflow: hidden;
}

.history-section .section-header {
  flex-shrink: 0;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  contain: layout style;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background var(--rw-transition);
}

.history-item:hover {
  background: var(--el-fill-color-lighter);
}

.hi-icon {
  font-size: var(--font-lg);
  flex-shrink: 0;
}

.hi-body {
  flex: 1;
  min-width: 0;
}

.hi-name {
  font-size: var(--font-12-5);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hi-meta {
  font-size: var(--font-xs);
  color: var(--el-text-color-placeholder);
}

/* ============================================================ */
/* 右侧面板 */
/* ============================================================ */
.right-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  contain: layout style;
}

/* 工具栏 */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--rw-card-bg);
  border-radius: var(--rw-radius);
  box-shadow: var(--rw-card-shadow);
  contain: layout style;
}

.toolbar-title {
  font-size: var(--font-lg);
  font-weight: 600;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.font-size-label {
  font-size: var(--font-xs);
  color: var(--el-text-color-secondary);
  min-width: 30px;
  text-align: center;
}

/* ============================================================ */
/* 文档纸张效果 */
/* ============================================================ */
.paper-container {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  background: var(--el-fill-color-lighter);
  border-radius: var(--rw-radius);
  contain: strict;
  scrollbar-width: thin;
}

.paper-sheet {
  max-width: 720px;
  margin: 0 auto;
  background: #fff;
  box-shadow: 0 2px 12px rgba(0,0,0,.1), 0 1px 3px rgba(0,0,0,.06);
  border-radius: 3px;
  padding: 40px 44px;
  min-height: 600px;
  transition: font-size var(--rw-transition);
  contain: layout style;
}

.paper-header {
  border-bottom: 2px solid var(--el-border-color);
  padding-bottom: 12px;
  margin-bottom: 20px;
}

.paper-logo {
  font-size: var(--font-16);
  font-weight: 700;
  color: var(--el-color-primary);
  letter-spacing: 2px;
}

.paper-meta-line {
  display: flex;
  gap: 16px;
  font-size: var(--font-xs);
  color: var(--el-text-color-secondary);
  margin-top: 6px;
  flex-wrap: wrap;
}

.paper-body {
  line-height: 1.8;
  color: #333;
  contain: layout style;
}

/* Markdown 渲染样式 */
.paper-body :deep(h1) {
  font-size: 1.5em;
  margin: 20px 0 10px;
  padding-bottom: 6px;
  border-bottom: 2px solid var(--el-border-color);
}

.paper-body :deep(h2) {
  font-size: 1.25em;
  margin: 16px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.paper-body :deep(h3) {
  font-size: 1.1em;
  margin: 12px 0 6px;
}

.paper-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 0.92em;
}

.paper-body :deep(thead) {
  background: var(--el-fill-color-lighter);
}

.paper-body :deep(th) {
  border: 1px solid var(--el-border-color);
  padding: 8px 12px;
  font-weight: 600;
  text-align: left;
  background: var(--el-fill-color);
}

.paper-body :deep(td) {
  border: 1px solid var(--el-border-color-light);
  padding: 7px 12px;
}

.paper-body :deep(tr:nth-child(even)) {
  background: var(--el-fill-color-lighter);
}

.paper-body :deep(blockquote) {
  border-left: 3px solid var(--el-color-primary-light-5);
  padding: 6px 14px;
  margin: 8px 0;
  color: var(--el-text-color-secondary);
  background: var(--el-color-primary-light-9);
  border-radius: 0 6px 6px 0;
}

.paper-body :deep(code) {
  background: var(--el-fill-color);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.9em;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.paper-body :deep(pre) {
  background: #1e293b;
  color: #e2e8f0;
  padding: 12px 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 10px 0;
}

.paper-body :deep(pre code) {
  background: none;
  padding: 0;
  color: inherit;
}

.paper-body :deep(strong) {
  font-weight: 600;
}

.paper-body :deep(ul), .paper-body :deep(ol) {
  padding-left: 20px;
}

.paper-body :deep(li) {
  margin: 4px 0;
}

.paper-footer {
  margin-top: 30px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-light);
  text-align: center;
  font-size: var(--font-xs);
  color: var(--el-text-color-placeholder);
}

/* ============================================================ */
/* 空状态 */
/* ============================================================ */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
  contain: layout style;
}

.empty-illustration {
  color: var(--el-text-color-placeholder);
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-title {
  font-size: var(--font-xl);
  font-weight: 600;
  color: var(--el-text-color-regular);
  margin-bottom: 6px;
}

.empty-desc {
  font-size: var(--font-md);
  color: var(--el-text-color-secondary);
  margin-bottom: 24px;
}

.empty-tips {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tip-item {
  font-size: var(--font-12-5);
  color: var(--el-text-color-secondary);
  padding: 6px 14px;
  background: var(--el-fill-color-lighter);
  border-radius: 6px;
  transition: background var(--rw-transition);
}

.tip-item:hover {
  background: var(--el-fill-color-light);
}

/* ============================================================ */
/* 通用 */
/* ============================================================ */
.empty-hint {
  color: var(--el-text-color-placeholder);
  font-size: var(--font-12-5);
  margin-top: 12px;
  text-align: center;
}

.report-error {
  padding: 12px 0;
}

/* GPU 加速的过渡 */
.template-card,
.paper-sheet,
.section-card,
.stats-bar {
  will-change: transform, box-shadow;
}

/* ============================================================ */
/* 响应式 */
/* ============================================================ */
@media (max-width: 1000px) {
  .workshop-body {
    grid-template-columns: 1fr;
  }
  .left-panel {
    max-height: none;
  }
  .paper-sheet {
    padding: 24px 20px;
  }
  .stats-bar {
    flex-wrap: wrap;
    gap: 8px;
  }
}
@media (max-width: 768px) {
  .workshop-body { grid-template-columns: 1fr; }
  .paper-sheet { padding: 16px 14px; }
}
</style>
