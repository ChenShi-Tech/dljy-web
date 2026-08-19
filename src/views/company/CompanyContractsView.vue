<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { getCurrentUser } from '@/services/auth'
import { hasCompanyAdmin } from '@/services/governance'
import { selectedCompanyId } from '@/services/company/companyContext'
import {
  fetchContracts, createContract, updateContract, deleteContract, importContracts, fetchContractDetails, fetchStations, fetchTrades,
  MARKET_TYPES, TRADE_MODES, CONTRACT_STATUSES,
  MARKET_TYPE_LABELS, TRADE_MODE_LABELS, CONTRACT_STATUS_LABELS,
  type CompanyContract, type CompanyContractDetail, type CompanyStation, type CompanyTrade
} from '@/services/company/companyApi'
import { exportCsv } from '../../utils/exportCsv'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import SparkBar from '../../components/common/SparkBar.vue'
import { fmtNum } from '@/services/chart/chartOptions'
import { maxBy } from '../../utils/tableFormat'
import { sumProduct, hedgeCoverage } from '@/services/settlementFormula'

const canWrite = computed(() => hasCompanyAdmin(getCurrentUser()))

const contracts = ref<CompanyContract[]>([])
const stations = ref<CompanyStation[]>([])
const trades = ref<CompanyTrade[]>([])
const loading = ref(false)

const filters = reactive({ stationId: null as number | null, year: null as number | null, marketType: '', status: '', search: '' })

type DetailForm = Partial<CompanyContractDetail>
// 明细行带客户端 _uid 供 v-for :key 稳定标识：删除中间行时避免 input 组件复用导致 v-model 错乱。
// _uid 仅前端用，save 时剥离，不进后端 payload。
type DetailRow = DetailForm & { _uid: number }
let detailUidSeed = 0
function nextDetailUid(): number {
  detailUidSeed += 1
  return detailUidSeed
}
const dialog = reactive({ visible: false, editId: 0 as number, form: blank(), details: [] as DetailRow[] })
const importDialog = reactive({ visible: false, text: '' })
const formRef = ref<FormInstance>()
const formRules: FormRules = {
  contractNo: [{ required: true, message: '请填写合同编号', trigger: 'blur' }],
  contractName: [{ required: true, message: '请填写合同名称', trigger: 'blur' }],
  endDate: [{
    validator: (_rule, value: string, cb: (e?: Error) => void) => {
      if (value && dialog.form.startDate && value < dialog.form.startDate) cb(new Error('结束日期不能早于起始日期'))
      else cb()
    },
    trigger: 'change'
  }]
}

function blank() {
  return {
    stationId: null as number | null,
    contractNo: '', contractName: '',
    marketType: 'annual_bilateral', tradeMode: 'bilateral',
    startDate: '', endDate: '',
    totalQuantity: null as number | null,
    buyerName: '', sellerName: '',
    buyerPrice: null as number | null, sellerPrice: null as number | null, totalFee: null as number | null,
    status: 'draft', remarks: ''
  }
}
function detailBlank(): DetailRow {
  return { ...{ buyerName: '', sellerName: '', dateRange: '', timeType: '', buyerQty: null, sellerQty: null, buyerPrice: null, sellerPrice: null, totalFee: null, virtualHour: '' }, _uid: nextDetailUid() }
}

async function reload() {
  loading.value = true
  try {
    const [list, sts, trd] = await Promise.all([fetchContracts(), fetchStations(), fetchTrades()])
    contracts.value = list
    stations.value = sts
    trades.value = trd
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(reload)
watch(selectedCompanyId, reload)

// ── 筛选 / 统计（前端派生，所见即所得）──
const filteredContracts = computed(() => {
  let r = [...contracts.value]
  if (filters.stationId) r = r.filter((c) => c.stationId === filters.stationId)
  if (filters.year) r = r.filter((c) => String(c.startDate ?? '').startsWith(String(filters.year)))
  if (filters.marketType) r = r.filter((c) => c.marketType === filters.marketType)
  if (filters.status) r = r.filter((c) => c.status === filters.status)
  if (filters.search) {
    const s = filters.search.toLowerCase()
    r = r.filter((c) => String(c.contractNo ?? '').toLowerCase().includes(s) || String(c.contractName ?? '').toLowerCase().includes(s))
  }
  return r
})

const years = computed(() => {
  const cur = new Date().getFullYear()
  return [cur - 1, cur, cur + 1, cur + 2]
})

// 即将到期：active 且 end_date 在未来 90 天内（前端派生，不入库）。
function isExpiring(c: CompanyContract): boolean {
  if (c.status !== 'active' || !c.endDate) return false
  const now = Date.now()
  const end = new Date(c.endDate).getTime()
  return end > now && end <= now + 90 * 86400000
}
// 已逾期：active 但 end_date 已过去。后端不会自动把 active 翻成 expired，需前端识别，
// 否则过期合同会一直伪装成“执行中”（计入执行中卡 + 绿色标签）。
function isOverdue(c: CompanyContract): boolean {
  if (c.status !== 'active' || !c.endDate) return false
  return new Date(c.endDate).getTime() < Date.now()
}

// ── 到期预警看板（基于全部合同，不随筛选隐藏；active 合同按到期紧急度分级）──
const alertOpen = ref(['alerts'])
function daysToExpiry(c: CompanyContract): number | null {
  if (c.status !== 'active' || !c.endDate) return null
  return Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000)
}
function alertLevel(c: CompanyContract): { tag: 'danger' | 'warning' | 'info'; label: string; text: string; order: number } {
  const d = daysToExpiry(c)
  if (d === null) return { tag: 'info', label: '', text: '', order: 99 }
  if (d < 0) return { tag: 'danger', label: '已逾期', text: `逾期 ${-d} 天`, order: 0 }
  if (d <= 30) return { tag: 'danger', label: '30天内', text: `剩 ${d} 天`, order: 1 }
  if (d <= 60) return { tag: 'warning', label: '60天内', text: `剩 ${d} 天`, order: 2 }
  if (d <= 90) return { tag: 'warning', label: '90天内', text: `剩 ${d} 天`, order: 3 }
  return { tag: 'info', label: '', text: '', order: 99 }
}
const alertContracts = computed(() =>
  contracts.value
    .filter((c) => { const d = daysToExpiry(c); return d !== null && d <= 90 })
    .sort((a, b) => alertLevel(a).order - alertLevel(b).order || ((daysToExpiry(a) ?? 0) - (daysToExpiry(b) ?? 0)))
)
const alertCounts = computed(() => {
  const r = { overdue: 0, d30: 0, d60: 0, d90: 0 }
  for (const c of alertContracts.value) {
    const d = daysToExpiry(c)
    if (d === null) continue
    if (d < 0) r.overdue += 1
    else if (d <= 30) r.d30 += 1
    else if (d <= 60) r.d60 += 1
    else r.d90 += 1
  }
  return r
})

const stats = computed(() => {
  const list = filteredContracts.value
  let active = 0
  let expiring = 0
  let totalQty = 0
  let overdue = 0
  for (const c of list) {
    if (c.status === 'active' && !isOverdue(c)) active += 1 // 执行中不含已逾期
    if (isExpiring(c)) expiring += 1
    if (isOverdue(c)) overdue += 1
    totalQty += Number(c.totalQuantity) || 0
  }
  return { total: list.length, active, expiring, overdue, totalQty }
})

const qtyMax = computed(() => maxBy(filteredContracts.value, 'totalQuantity') || 1)
const unknownContracts = computed(() => contracts.value.filter((c) => c.blocked).length)
function stationName(id: number | null | undefined): string {
  if (!id) return '—'
  return stations.value.find((s) => s.id === id)?.name ?? `#${id}`
}
function statusLabel(c: CompanyContract): string {
  if (isOverdue(c)) return '已逾期'
  if (isExpiring(c)) return '即将到期'
  return CONTRACT_STATUS_LABELS[c.status] ?? c.status
}
function statusTag(c: CompanyContract): 'success' | 'warning' | 'danger' | 'info' {
  if (isOverdue(c)) return 'danger'
  if (isExpiring(c)) return 'warning'
  const map: Record<string, 'success' | 'warning' | 'danger' | 'info'> = { draft: 'info', active: 'success', expired: 'danger', cancelled: 'info' }
  return map[c.status] ?? 'info'
}

// 执行跟踪派生：进度 / 偏差（已执行电量来自后端 company_trades 聚合，contractCode==contractNo，仅已成交）。
function execPct(c: CompanyContract): number {
  const total = Number(c.totalQuantity) || 0
  if (total <= 0) return 0
  return Math.min(100, Math.round(((Number(c.executedVolume) || 0) / total) * 100))
}
function execDeviation(c: CompanyContract): string {
  const total = Number(c.totalQuantity) || 0
  if (total <= 0) return '—'
  const dev = (((Number(c.executedVolume) || 0) - total) / total) * 100
  return `${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%`
}
function execProgressStatus(c: CompanyContract): 'success' | 'warning' | 'exception' | undefined {
  const total = Number(c.totalQuantity) || 0
  if (total <= 0) return undefined
  return execPct(c) >= 100 ? 'success' : undefined
}

// ── 查看详情（合同 + 关联交易 + 明细，只读，所有角色可见）──
const viewDrawer = reactive({ visible: false, contract: null as CompanyContract | null, details: [] as CompanyContractDetail[], loadingDetails: false })
async function openView(row: CompanyContract) {
  viewDrawer.contract = row
  viewDrawer.details = []
  viewDrawer.visible = true
  viewDrawer.loadingDetails = true
  try {
    viewDrawer.details = await fetchContractDetails(row.id)
  } catch {
    viewDrawer.details = []
  } finally {
    viewDrawer.loadingDetails = false
  }
}
// 关联交易：按 contractCode==contractNo 从已缓存的本公司交易过滤（与执行量聚合同口径）。
const relatedTrades = computed<CompanyTrade[]>(() => {
  const no = viewDrawer.contract?.contractNo
  return no ? trades.value.filter((t) => t.contractCode === no) : []
})
// 结算预览（复用 settlementFormula 纯函数，基于合同量价 + 已执行电量做快速估算；
// 分时结算/出清电价/两个细则偏差考核分档等深度对账口径待理顺后接入）。
const settlementPreview = computed(() => {
  const c = viewDrawer.contract
  if (!c) return null
  const total = Number(c.totalQuantity) || 0
  const exec = Number(c.executedVolume) || 0
  const price = Number(c.buyerPrice ?? c.sellerPrice) || 0
  const cov = hedgeCoverage({ contractedMwh: exec, forecastMwh: total })
  return {
    contractAmount: sumProduct([total], [price]),
    executedAmount: sumProduct([exec], [price]),
    coverageRate: cov.coverageRate,
    openExposureMwh: cov.openExposureMwh
  }
})

// ── 增删改 ──
function openCreate() {
  dialog.editId = 0
  Object.assign(dialog.form, blank())
  dialog.details = []
  dialog.visible = true
  formRef.value?.clearValidate()
}
async function openEdit(row: CompanyContract) {
  dialog.editId = row.id
  Object.assign(dialog.form, {
    stationId: row.stationId ?? null,
    contractNo: row.contractNo ?? '', contractName: row.contractName ?? '',
    marketType: row.marketType ?? 'annual_bilateral', tradeMode: row.tradeMode ?? 'bilateral',
    startDate: row.startDate ?? '', endDate: row.endDate ?? '',
    totalQuantity: row.totalQuantity, buyerName: row.buyerName ?? '', sellerName: row.sellerName ?? '',
    buyerPrice: row.buyerPrice, sellerPrice: row.sellerPrice, totalFee: row.totalFee,
    status: row.status ?? 'draft', remarks: row.remarks ?? ''
  })
  dialog.visible = true
  formRef.value?.clearValidate()
  try {
    dialog.details = (await fetchContractDetails(row.id)).map((d) => ({ ...d, _uid: nextDetailUid() }))
  } catch {
    dialog.details = []
  }
}
function addDetail() {
  dialog.details.push(detailBlank())
}
function removeDetail(index: number) {
  dialog.details.splice(index, 1)
}
async function save() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  try {
    const payload = { ...dialog.form, details: dialog.details.map(({ _uid: _unused, ...rest }) => rest) }
    if (dialog.editId) await updateContract(dialog.editId, payload)
    else await createContract(payload)
    ElMessage.success('已保存')
    dialog.visible = false
    await reload()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  }
}
async function remove(row: CompanyContract) {
  await ElMessageBox.confirm(`确认删除合同 ${row.contractNo}？`, '提示', { type: 'warning' })
  try {
    await deleteContract(row.id)
    ElMessage.success('已删除')
    await reload()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

// ── 导入 / 导出 ──
function toNum(v: string) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
// 枚举反查：导入单元格既接受英文枚举值（annual_bilateral），也接受导出用的中文标签（年度双边），实现导出↔导入往返。
function reverseLabels(labels: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [value, label] of Object.entries(labels)) map[label] = value
  return map
}
const MARKET_VALUE_BY_LABEL = reverseLabels(MARKET_TYPE_LABELS)
const TRADE_VALUE_BY_LABEL = reverseLabels(TRADE_MODE_LABELS)
const STATUS_VALUE_BY_LABEL = reverseLabels(CONTRACT_STATUS_LABELS)
function resolveEnum(raw: string, values: readonly string[], byLabel: Record<string, string>): { ok: boolean; value?: string } {
  const v = (raw ?? '').trim()
  if (!v) return { ok: true, value: undefined } // 留空 → 交后端取默认枚举
  if (values.includes(v)) return { ok: true, value: v }
  if (byLabel[v]) return { ok: true, value: byLabel[v] }
  return { ok: false }
}
function stationIdByName(name: string): number | null {
  const n = (name ?? '').trim()
  if (!n || n === '—') return null
  return stations.value.find((s) => s.name === n)?.id ?? null
}
function buildImportRow(cells: string[], lineNo: number, errors: string[]) {
  const [contractNo, contractName, stationCell, marketCell, tradeCell, startDate, endDate, totalQuantity, buyerName, sellerName, buyerPrice, sellerPrice, totalFee, statusCell] = cells
  if (!contractNo || !contractName) {
    errors.push(`第${lineNo}行：缺合同编号/名称`)
    return null
  }
  const mk = resolveEnum(marketCell, MARKET_TYPES, MARKET_VALUE_BY_LABEL)
  const tr = resolveEnum(tradeCell, TRADE_MODES, TRADE_VALUE_BY_LABEL)
  const st = resolveEnum(statusCell, CONTRACT_STATUSES, STATUS_VALUE_BY_LABEL)
  if (!mk.ok) { errors.push(`第${lineNo}行：交易类型非法「${marketCell}」`); return null }
  if (!tr.ok) { errors.push(`第${lineNo}行：交易模式非法「${tradeCell}」`); return null }
  if (!st.ok) { errors.push(`第${lineNo}行：状态非法「${statusCell}」`); return null }
  return {
    contractNo, contractName,
    stationId: stationIdByName(stationCell),
    marketType: mk.value, tradeMode: tr.value,
    startDate, endDate,
    totalQuantity: toNum(totalQuantity), buyerName, sellerName,
    buyerPrice: toNum(buyerPrice), sellerPrice: toNum(sellerPrice), totalFee: toNum(totalFee),
    status: st.value ?? 'draft'
  }
}
// 导入列序与导出一致（含“电站”），末列“来源”忽略：
// 合同编号,合同名称,电站,交易类型,交易模式,起始,结束,总电量,买方,卖方,买方价,卖方价,总费用,状态[,来源]
async function doImport() {
  const lines = importDialog.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const rows: NonNullable<ReturnType<typeof buildImportRow>>[] = []
  const errors: string[] = []
  lines.forEach((line, idx) => {
    const cells = line.split(',').map((c) => c.trim())
    if (cells[0] === '合同编号') return // 跳过从导出 CSV 复制带来的表头行
    const built = buildImportRow(cells, idx + 1, errors)
    if (built) rows.push(built)
  })
  if (errors.length) {
    return ElMessage.error(`导入校验失败（${errors.length} 行）：${errors.slice(0, 3).join('；')}${errors.length > 3 ? ' …' : ''}`)
  }
  if (!rows.length) return ElMessage.warning('未解析到有效行')
  try {
    await importContracts(rows)
    ElMessage.success(`已导入 ${rows.length} 条`)
    importDialog.visible = false
    importDialog.text = ''
    await reload()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入失败')
  }
}
function exportContractsCsv() {
  if (!filteredContracts.value.length) return ElMessage.warning('暂无可导出的合同')
  const headers = ['合同编号', '合同名称', '电站', '交易类型', '交易模式', '起始日期', '结束日期', '总电量(MWh)', '买方', '卖方', '买方价(元/MWh)', '卖方价(元/MWh)', '总费用(元)', '状态', '来源']
  const body = filteredContracts.value.map((c) => [
    c.contractNo, c.contractName, stationName(c.stationId),
    MARKET_TYPE_LABELS[c.marketType] ?? c.marketType, TRADE_MODE_LABELS[c.tradeMode] ?? c.tradeMode,
    c.startDate, c.endDate, c.totalQuantity, c.buyerName, c.sellerName, c.buyerPrice, c.sellerPrice, c.totalFee,
    CONTRACT_STATUS_LABELS[c.status] ?? c.status, c.source === 'IMPORT' ? '导入' : '手动'
  ])
  exportCsv(`合同_${new Date().toISOString().slice(0, 10)}`, headers, body)
}
</script>

<template>
  <div class="company-page">
    <h2 class="page-title">合同管理</h2>
    <CompanyScopeBar />

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">合同总数</div><div class="stat-value">{{ stats.total }}</div></div>
      <div class="stat-card"><div class="stat-label">执行中</div><div class="stat-value">{{ stats.active }}</div></div>
      <div class="stat-card warn"><div class="stat-label">即将到期(90天)</div><div class="stat-value">{{ stats.expiring }}</div></div>
      <div class="stat-card danger"><div class="stat-label">已逾期</div><div class="stat-value">{{ stats.overdue }}</div></div>
      <div class="stat-card"><div class="stat-label">合同电量(MWh)</div><div class="stat-value">{{ fmtNum(stats.totalQty, 0) }}</div></div>
    </div>

    <el-collapse v-if="alertContracts.length" v-model="alertOpen" class="alert-panel">
      <el-collapse-item name="alerts">
        <template #title>
          <span class="alert-title">⚠ 到期预警（{{ alertContracts.length }}）<small>逾期 {{ alertCounts.overdue }} · 30天 {{ alertCounts.d30 }} · 60天 {{ alertCounts.d60 }} · 90天 {{ alertCounts.d90 }}</small></span>
        </template>
        <div class="alert-list">
          <div v-for="c in alertContracts" :key="c.id" class="alert-item" @click="openView(c)">
            <el-tag size="small" :type="alertLevel(c).tag" effect="dark">{{ alertLevel(c).label }}</el-tag>
            <span class="alert-no">{{ c.contractNo }}</span>
            <span class="alert-name">{{ c.contractName }}</span>
            <span class="alert-spacer" />
            <span class="alert-date">到期 {{ c.endDate || '—' }} · {{ alertLevel(c).text }}</span>
          </div>
        </div>
      </el-collapse-item>
    </el-collapse>

    <div class="toolbar">
      <template v-if="canWrite">
        <el-button type="primary" @click="openCreate">新增合同</el-button>
        <el-button @click="importDialog.text = ''; importDialog.visible = true">批量导入</el-button>
      </template>
      <el-button @click="exportContractsCsv">导出CSV</el-button>
      <span v-if="!canWrite" class="readonly-hint">只读：当前角色无写入权限</span>
    </div>

    <div class="filters-bar">
      <el-select v-model="filters.stationId" placeholder="全部电站" clearable filterable style="width: 180px">
        <el-option v-for="s in stations" :key="s.id" :label="s.name" :value="s.id" />
      </el-select>
      <el-select v-model="filters.year" placeholder="全部年份" clearable style="width: 120px">
        <el-option v-for="y in years" :key="y" :label="`${y} 年`" :value="y" />
      </el-select>
      <el-select v-model="filters.marketType" placeholder="全部交易类型" clearable style="width: 180px">
        <el-option v-for="t in MARKET_TYPES" :key="t" :label="MARKET_TYPE_LABELS[t]" :value="t" />
      </el-select>
      <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 130px">
        <el-option v-for="s in CONTRACT_STATUSES" :key="s" :label="CONTRACT_STATUS_LABELS[s]" :value="s" />
      </el-select>
      <el-input v-model="filters.search" placeholder="搜索合同编号/名称" clearable style="width: 220px" />
    </div>

    <el-table :data="filteredContracts" v-loading="loading" border stripe>
      <el-table-column prop="contractNo" label="合同编号" min-width="140" sortable />
      <el-table-column prop="contractName" label="合同名称" min-width="180" show-overflow-tooltip />
      <el-table-column label="电站" min-width="130">
        <template #default="{ row }">{{ stationName(row.stationId) }}</template>
      </el-table-column>
      <el-table-column label="交易类型" width="150">
        <template #default="{ row }">{{ MARKET_TYPE_LABELS[row.marketType] ?? row.marketType }}</template>
      </el-table-column>
      <el-table-column label="归属域" width="130">
        <template #default="{ row }">
          <el-tag size="small" :type="row.ownerDomain === 'market-trading' ? 'primary' : row.ownerDomain === 'retail-settlement' ? 'success' : 'danger'" effect="plain">
            {{ row.ownerDomain === 'market-trading' ? '批发交易' : row.ownerDomain === 'retail-settlement' ? '零售结算' : '未知（已屏蔽）' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="有效期" width="200">
        <template #default="{ row }">{{ row.startDate || '—' }} ~ {{ row.endDate || '—' }}</template>
      </el-table-column>
      <el-table-column prop="totalQuantity" label="总电量(MWh)" width="160" sortable>
        <template #default="{ row }">
          <SparkBar :value="row.totalQuantity" :max="qtyMax" :digits="0" unit="MWh" />
        </template>
      </el-table-column>
      <el-table-column label="已执行 / 进度" width="190">
        <template #default="{ row }">
          <div class="exec-cell">
            <span class="exec-vol">{{ fmtNum(row.executedVolume || 0, 0) }} <small>MWh · {{ row.tradeCount || 0 }}笔</small></span>
            <el-progress :percentage="execPct(row)" :status="execProgressStatus(row)" :stroke-width="6" />
            <span class="exec-dev">偏差 {{ execDeviation(row) }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag size="small" :type="statusTag(row)" effect="plain">{{ statusLabel(row) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="80">
        <template #default="{ row }">
          <el-tag size="small" :type="row.source === 'IMPORT' ? 'primary' : 'success'" effect="plain">
            {{ row.source === 'IMPORT' ? '导入' : '手动' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <template v-if="!row.blocked">
            <el-button link type="primary" @click="openView(row)">查看</el-button>
            <el-button v-if="canWrite" link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="canWrite" link type="danger" @click="remove(row)">删除</el-button>
          </template>
          <span v-else class="readonly-hint">已屏蔽</span>
        </template>
      </el-table-column>
      <template #empty>暂无合同，请新增或导入。</template>
    </el-table>
    <el-alert v-if="unknownContracts" type="warning" :closable="false" show-icon title="存在未匹配归属规则的合同，明细已由服务端屏蔽；请补齐合同分类后再处理。" class="ownership-alert" />

    <el-dialog v-model="dialog.visible" :title="dialog.editId ? '编辑合同' : '新增合同'" width="860px" top="6vh">
      <el-form ref="formRef" :model="dialog.form" :rules="formRules" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12" :xs="24"><el-form-item label="合同编号" prop="contractNo"><el-input v-model="dialog.form.contractNo" /></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="合同名称" prop="contractName"><el-input v-model="dialog.form.contractName" /></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="关联电站"><el-select v-model="dialog.form.stationId" placeholder="可选" clearable filterable style="width: 100%"><el-option v-for="s in stations" :key="s.id" :label="s.name" :value="s.id" /></el-select></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="状态"><el-select v-model="dialog.form.status" style="width: 100%"><el-option v-for="s in CONTRACT_STATUSES" :key="s" :label="CONTRACT_STATUS_LABELS[s]" :value="s" /></el-select></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="交易类型"><el-select v-model="dialog.form.marketType" style="width: 100%"><el-option v-for="t in MARKET_TYPES" :key="t" :label="MARKET_TYPE_LABELS[t]" :value="t" /></el-select></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="交易模式"><el-select v-model="dialog.form.tradeMode" style="width: 100%"><el-option v-for="m in TRADE_MODES" :key="m" :label="TRADE_MODE_LABELS[m]" :value="m" /></el-select></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="起始日期"><el-date-picker v-model="dialog.form.startDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="结束日期" prop="endDate"><el-date-picker v-model="dialog.form.endDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="总电量"><el-input-number v-model="dialog.form.totalQuantity" :min="0" controls-position="right" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="总费用(元)"><el-input-number v-model="dialog.form.totalFee" :min="0" controls-position="right" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="买方"><el-input v-model="dialog.form.buyerName" /></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="卖方"><el-input v-model="dialog.form.sellerName" /></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="买方价"><el-input-number v-model="dialog.form.buyerPrice" :min="0" controls-position="right" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="卖方价"><el-input-number v-model="dialog.form.sellerPrice" :min="0" controls-position="right" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="备注"><el-input v-model="dialog.form.remarks" type="textarea" :rows="2" /></el-form-item></el-col>
        </el-row>

        <div class="detail-header">
          <span class="detail-title">交易明细（{{ dialog.details.length }}）</span>
          <el-button size="small" @click="addDetail">添加明细</el-button>
        </div>
        <div v-for="(d, i) in dialog.details" :key="d._uid" class="detail-row">
          <el-input v-model="d.dateRange" size="small" placeholder="时段范围" style="width: 150px" />
          <el-input v-model="d.virtualHour" size="small" placeholder="峰/平/谷" style="width: 100px" />
          <el-input v-model="d.timeType" size="small" placeholder="时段说明" style="width: 110px" />
          <el-input-number v-model="d.buyerQty" size="small" :controls="false" :min="0" placeholder="买方电量" style="width: 100px" />
          <el-input-number v-model="d.buyerPrice" size="small" :controls="false" :min="0" placeholder="买方价" style="width: 90px" />
          <el-input-number v-model="d.sellerQty" size="small" :controls="false" :min="0" placeholder="卖方电量" style="width: 100px" />
          <el-input-number v-model="d.sellerPrice" size="small" :controls="false" :min="0" placeholder="卖方价" style="width: 90px" />
          <el-input-number v-model="d.totalFee" size="small" :controls="false" :min="0" placeholder="费用" style="width: 100px" />
          <el-button size="small" link type="danger" @click="removeDetail(i)">删除</el-button>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importDialog.visible" title="批量导入合同" width="620px">
      <p class="import-hint">每行一条，逗号分隔（列序与导出 CSV 一致，可直接粘贴导出文件）：合同编号,合同名称,电站,交易类型,交易模式,起始日期,结束日期,总电量,买方,卖方,买方价,卖方价,总费用,状态</p>
      <p class="import-hint">电站填名称（留空=不关联）；交易类型/模式/状态可填英文枚举值或中文标签（如 annual_bilateral 或「年度双边」）；非法值逐行报错、不入库。</p>
      <el-input v-model="importDialog.text" type="textarea" :rows="8" placeholder="HT-2026-001,2026年度购电合同,,annual_bilateral,bilateral,2026-01-01,2026-12-31,520000,演示集团,交易中心,410,,213200000,active" />
      <template #footer>
        <el-button @click="importDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="doImport">导入</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="viewDrawer.visible" :title="`合同详情 · ${viewDrawer.contract?.contractNo ?? ''}`" size="640px">
      <div v-if="viewDrawer.contract" class="view-body">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="合同名称">{{ viewDrawer.contract.contractName }}</el-descriptions-item>
          <el-descriptions-item label="电站">{{ stationName(viewDrawer.contract.stationId) }}</el-descriptions-item>
          <el-descriptions-item label="交易类型">{{ MARKET_TYPE_LABELS[viewDrawer.contract.marketType] ?? viewDrawer.contract.marketType }}</el-descriptions-item>
          <el-descriptions-item label="交易模式">{{ TRADE_MODE_LABELS[viewDrawer.contract.tradeMode] ?? viewDrawer.contract.tradeMode }}</el-descriptions-item>
          <el-descriptions-item label="有效期">{{ viewDrawer.contract.startDate || '—' }} ~ {{ viewDrawer.contract.endDate || '—' }}</el-descriptions-item>
          <el-descriptions-item label="状态"><el-tag size="small" :type="statusTag(viewDrawer.contract)" effect="plain">{{ statusLabel(viewDrawer.contract) }}</el-tag></el-descriptions-item>
          <el-descriptions-item label="买方">{{ viewDrawer.contract.buyerName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="卖方">{{ viewDrawer.contract.sellerName || '—' }}</el-descriptions-item>
        </el-descriptions>

        <div class="view-section">
          <div class="view-section-title">执行情况</div>
          <div class="exec-summary">
            <span>合同总量 <b>{{ fmtNum(viewDrawer.contract.totalQuantity || 0, 0) }}</b> MWh</span>
            <span>已执行 <b>{{ fmtNum(viewDrawer.contract.executedVolume || 0, 0) }}</b> MWh（{{ viewDrawer.contract.tradeCount || 0 }} 笔）</span>
            <span>偏差 <b>{{ execDeviation(viewDrawer.contract) }}</b></span>
          </div>
          <el-progress :percentage="execPct(viewDrawer.contract)" :status="execProgressStatus(viewDrawer.contract)" :stroke-width="10" />
        </div>

        <div class="view-section" v-if="settlementPreview">
          <div class="view-section-title">结算预览 <small>复用 settlementFormula（量价估算）</small></div>
          <div class="exec-summary">
            <span>合同金额 <b>{{ fmtNum(settlementPreview.contractAmount, 0) }}</b> 元</span>
            <span>已执行金额 <b>{{ fmtNum(settlementPreview.executedAmount, 0) }}</b> 元</span>
            <span>履约率 <b>{{ (settlementPreview.coverageRate * 100).toFixed(1) }}%</b></span>
            <span>未执行 <b>{{ fmtNum(settlementPreview.openExposureMwh, 0) }}</b> MWh</span>
          </div>
          <p class="settle-note">基于合同量价与已执行电量的快速估算；分时结算、出清电价、两个细则偏差考核分档对账口径待理顺后接入。</p>
        </div>

        <div class="view-section">
          <div class="view-section-title">关联交易（{{ relatedTrades.length }}）<small>按合同编号匹配 company_trades</small></div>
          <el-table :data="relatedTrades" size="small" border>
            <el-table-column prop="tradeDate" label="日期" width="110" />
            <el-table-column prop="counterparty" label="对手方" min-width="120" show-overflow-tooltip />
            <el-table-column prop="direction" label="方向" width="70" />
            <el-table-column prop="volume" label="电量(MWh)" width="110" align="right" />
            <el-table-column prop="price" label="价格" width="80" align="right" />
            <el-table-column prop="status" label="状态" width="90" />
            <template #empty>无按合同编号匹配的交易</template>
          </el-table>
        </div>

        <div class="view-section">
          <div class="view-section-title">交易明细（{{ viewDrawer.details.length }}）</div>
          <el-table :data="viewDrawer.details" v-loading="viewDrawer.loadingDetails" size="small" border>
            <el-table-column prop="dateRange" label="时段范围" min-width="120" />
            <el-table-column prop="virtualHour" label="时段" width="90" />
            <el-table-column prop="buyerQty" label="买方电量" width="100" align="right" />
            <el-table-column prop="buyerPrice" label="买方价" width="90" align="right" />
            <el-table-column prop="totalFee" label="费用" width="110" align="right" />
            <template #empty>无交易明细</template>
          </el-table>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.company-page { padding: 20px; }
.page-title { margin: 0 0 16px; font-size: var(--font-20); }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
.stat-card { background: var(--el-bg-color-overlay, #fff); border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; padding: 14px 16px; }
.stat-card.warn .stat-value { color: var(--el-color-warning, #e6a23c); }
.stat-card.danger .stat-value { color: var(--el-color-danger, #f56c6c); }
.stat-label { color: var(--el-text-color-secondary, #909399); font-size: var(--font-md); margin-bottom: 6px; }
.stat-value { font-size: var(--font-24); font-weight: 600; }
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.readonly-hint { color: var(--el-text-color-secondary, #909399); font-size: var(--font-md); }
.filters-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
.import-hint { margin: 0 0 8px; color: var(--el-text-color-secondary, #909399); font-size: var(--font-md); }
.ownership-alert { margin-top: 12px; }
.detail-header { display: flex; align-items: center; justify-content: space-between; margin: 8px 0; padding-top: 8px; border-top: 1px solid var(--el-border-color-lighter, #ebeef5); }
.detail-title { font-weight: 600; }
.detail-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.exec-cell { display: flex; flex-direction: column; gap: 2px; }
.exec-vol { font-size: var(--font-md); }
.exec-vol small { color: var(--el-text-color-secondary, #909399); font-weight: 400; }
.exec-dev { font-size: var(--font-sm); color: var(--el-text-color-secondary, #909399); }
.view-body { display: flex; flex-direction: column; gap: 18px; }
.view-section-title { font-weight: 600; margin-bottom: 8px; }
.view-section-title small { color: var(--el-text-color-secondary, #909399); font-weight: 400; margin-left: 6px; font-size: var(--font-sm); }
.exec-summary { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 8px; font-size: var(--font-md); }
.exec-summary b { font-size: var(--font-15); }
.alert-panel { margin-bottom: 12px; border-radius: 8px; }
.alert-title { font-weight: 600; color: var(--el-color-warning, #e6a23c); }
.alert-title small { color: var(--el-text-color-secondary, #909399); font-weight: 400; margin-left: 8px; }
.alert-list { display: flex; flex-direction: column; gap: 6px; }
.alert-item { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.alert-item:hover { background: var(--el-fill-color-light, #f5f7fa); }
.alert-no { font-weight: 600; }
.alert-name { color: var(--el-text-color-regular, #606266); }
.alert-spacer { flex: 1; }
.alert-date { color: var(--el-text-color-secondary, #909399); font-size: var(--font-md); }
.settle-note { margin: 4px 0 0; font-size: var(--font-sm); color: var(--el-text-color-secondary, #909399); }
</style>
