<script setup lang="ts">
// 申报审批队列（P3）：交易负责人/风控视角集中消费 PENDING_APPROVAL 申报单。
// 数据与动作全部走申报单 API（approvalRecord 留痕，创建人不得自批由服务端强制）。
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  approveDeclaration,
  declarationModeOf,
  DECLARATION_MODE_LABEL,
  listDeclarationsPage,
  STATUS_LABEL,
  type DeclarationListParams,
  type DeclarationMode,
  type DeclarationOrder,
  type DeclarationStatus
} from '@/services/declarations'
import { exportCsv } from '../utils/exportCsv'
import { todayBeijing } from '@/utils/beijingDate'
import { getCurrentUser } from '@/services/auth'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'

const router = useRouter()
const loading = ref(false)
const errorMsg = ref('')
const all = ref<DeclarationOrder[]>([])
const comments = ref<Record<string, string>>({})
const busyId = ref('')

// 演练单默认不进生产动线：审批队列是真实待办，混入历史模拟会污染审批人视图。
// 但演练闭环本身也要走审批，故给显式开关（不是永久隐藏）。
const showRehearsal = ref(false)
const visible = computed(() =>
  showRehearsal.value ? all.value : all.value.filter((d) => declarationModeOf(d) === 'LIVE')
)

const pending = computed(() => visible.value.filter((d) => d.status === 'PENDING_APPROVAL'))

// 审批可见性（UI 门，非安全边界；权威判定在服务端 APPROVE_ROLES + 自审禁止）。
// 此前本页对所有待审批行渲染按钮，无权/创建人点了才吃 403——与申报台视图同口径镜像。
// 两处角色集合须与服务端 APPROVE_ROLES 保持同步。
const APPROVE_ROLES_UI = ['TRADE_LEAD', 'RISK', 'ADMIN', 'BOSS']
const ELEVATED_ROLES_UI = ['ADMIN', 'BOSS']
const currentUserName = computed(() => getCurrentUser().username)
const currentUserRole = computed(() => String(getCurrentUser().roleCode ?? ''))
function approvalDeniedReason(d: DeclarationOrder): string {
  if (!APPROVE_ROLES_UI.includes(currentUserRole.value)) {
    return `当前角色 ${currentUserRole.value || '未知'} 无审批权限`
  }
  if (
    d.createdBy === currentUserName.value
    && !ELEVATED_ROLES_UI.includes(currentUserRole.value)
    && declarationModeOf(d) !== 'REHEARSAL'
  ) {
    return '创建人不得审批本人申报单'
  }
  return ''
}

// 反向定义（排除未进入审批环节的三个状态）而非正向白名单：原白名单
// ['APPROVED','REJECTED','SUBMITTED','ACKNOWLEDGED'] 漏了 CLEARED/EXPIRED，
// 使已走完全流程的存量单在本页整体不可见。反向定义后新增状态不会再漏。
const PRE_APPROVAL_STATUSES = ['DRAFT', 'RISK_CHECKED', 'PENDING_APPROVAL']
const recentDecided = computed(() =>
  visible.value
    .filter((d) => !PRE_APPROVAL_STATUSES.includes(d.status) && d.approvalRecord.length)
    .slice(0, 20)
)

// 「全部申报单」区：不要求 approvalRecord，逾期作废的单从未进入审批环节，
// approvalRecord 恒空，只有这一区能看到它们（历史申报单可见性的真正落点）。
//
// statusFilter 走服务端过滤（filteredRows 独立取数），不是在 all.value 上做客户端筛。
// 客户端筛无法恢复任何被硬上限截断的数据，那样截断提示里"用状态筛选缩小范围"
// 就是句空话，选什么状态排序靠后的单都仍不可见。
const statusFilter = ref<'' | DeclarationStatus>('')
const filteredRows = ref<DeclarationOrder[] | null>(null)
const allRows = computed(() => {
  const source = filteredRows.value ?? visible.value
  return filteredRows.value && !showRehearsal.value
    ? source.filter((d) => declarationModeOf(d) === 'LIVE')
    : source
})
const modeCounts = computed(() =>
  all.value.reduce(
    (acc, d) => { acc[declarationModeOf(d)] += 1; return acc },
    { LIVE: 0, REHEARSAL: 0 } as Record<DeclarationMode, number>
  )
)

// 服务端 list 默认 limit=200、上限 500。本页要在客户端算待审批/模式计数/全部申报单，
// 只取首批会在总量 >200 时静默截断，排序靠后的待审批与历史单永远不可见（与本页
// 「历史申报单可见」的目标直接冲突）。故按 offset 遍历取全，并对总页数设硬上限兜底。
const PAGE_SIZE = 500
const MAX_PAGES = 20

/** 按 offset 遍历取全（服务端过滤条件由 params 决定），返回行与是否触顶截断。 */
async function fetchAllPages(params: DeclarationListParams = {}) {
  const rows: DeclarationOrder[] = []
  let offset = 0
  let truncated = false
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await listDeclarationsPage({ ...params, limit: PAGE_SIZE, offset })
    rows.push(...res.rows)
    offset += res.rows.length
    // 用 total 判终止（而非 rows.length < limit）：服务端 total 是过滤后分页前总数
    if (res.rows.length === 0 || rows.length >= res.total) break
    if (page === MAX_PAGES - 1) truncated = true
  }
  return { rows, truncated }
}

/** 「全部申报单」区按当前状态筛选重新向服务端取数；无筛选时复用 all.value 不额外请求。
 *
 * 世代守卫：快速连切筛选（PENDING_APPROVAL → EXPIRED）会并发多次 fetchAllPages，
 * 慢的旧请求若最后返回就会让下拉显示「已逾期」而表格列的是待审批单。
 */
let filteredGeneration = 0
async function loadFilteredRows() {
  const generation = ++filteredGeneration
  const wantedStatus = statusFilter.value
  if (!wantedStatus) {
    filteredRows.value = null
    return
  }
  try {
    const { rows } = await fetchAllPages({ status: wantedStatus })
    if (generation !== filteredGeneration) return // 过期响应丢弃
    filteredRows.value = rows
  } catch {
    if (generation !== filteredGeneration) return
    filteredRows.value = null
  }
}

watch(statusFilter, () => { void loadFilteredRows() })

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const { rows, truncated } = await fetchAllPages()
    all.value = rows
    // 不静默截断：超出上限时明确告知，避免"看到的就是全部"的误解。
    // 提示里的"状态筛选"确实能拿到新数据，它走服务端过滤（loadFilteredRows）。
    errorMsg.value = truncated
      ? `申报单数量超过 ${PAGE_SIZE * MAX_PAGES} 条，上方列表仅显示前 ${rows.length} 条；用「全部申报单」区的状态筛选可按状态重新查询服务端`
      : ''
    await loadFilteredRows()
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

async function decide(declaration: DeclarationOrder, decision: 'approve' | 'reject') {
  if (busyId.value) return
  const denied = approvalDeniedReason(declaration)
  if (denied) {
    ElMessage.warning(denied)
    return
  }
  if (decision === 'reject') {
    // 驳回属不可逆危险操作,先二次确认
    try {
      await ElMessageBox.confirm(`确认驳回申报单 ${declaration.id}？`, '驳回确认', {
        type: 'warning',
        confirmButtonText: '驳回',
        cancelButtonText: '取消'
      })
    } catch {
      return
    }
  }
  busyId.value = declaration.id
  try {
    const updated = await approveDeclaration(declaration.id, decision, comments.value[declaration.id] || undefined)
    // L3 双签第一签：服务端只落签不转态，明示等待第二签而不是让人以为已批准
    if (updated.awaitingSecondSignature) {
      ElMessage.warning('L3 双签：第一签已记录，需第二位审批人批准后本单才进入已审批')
    } else {
      ElMessage.success(decision === 'approve' ? '已批准' : '已驳回')
    }
    comments.value[declaration.id] = ''
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '审批失败')
  } finally {
    busyId.value = ''
  }
}

// 导出近期审批记录为 CSV(前端导出,带 BOM)
function exportRecords() {
  if (!recentDecided.value.length) {
    ElMessage.warning('暂无可导出的审批记录')
    return
  }
  const headers = ['申报单', '目标日', '状态', '审批人', '角色', '决策', '意见']
  const body = recentDecided.value.map((d) => {
    const last = d.approvalRecord[d.approvalRecord.length - 1]
    return [
      d.id,
      d.targetDate,
      STATUS_LABEL[d.status],
      last?.approver ?? '',
      last?.role ?? '',
      last ? (last.decision === 'approve' ? (last.dualSignPending ? '批准（L3 第一签·待第二签）' : '批准') : '驳回') : '',
      last?.comment ?? ''
    ]
  })
  exportCsv(`审批记录_${todayBeijing()}`, headers, body)
}

function totalMwh(declaration: DeclarationOrder) {
  return Math.round(declaration.energyCurveMwh96.reduce((sum, v) => sum + v, 0) * 100) / 100
}

function deadlineText(declaration: DeclarationOrder) {
  const ms = new Date(declaration.deadline).getTime() - Date.now()
  if (ms <= 0) return '已过截止'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return `剩 ${h}时${m}分`
}

let timer: number | undefined
onMounted(() => {
  void load()
  timer = window.setInterval(load, 30000)
})
// keep-alive:切走暂停 30s 轮询(避免缓存页后台空转),切回立即刷新并恢复轮询
onDeactivated(() => window.clearInterval(timer))
onActivated(() => {
  window.clearInterval(timer)
  void load()
  timer = window.setInterval(load, 30000)
})
onBeforeUnmount(() => window.clearInterval(timer))
onRegionChange(load)
</script>

<template>
  <div class="page-stack">
    <RegionDataBanner />
    <section class="panel">
      <div class="panel-title">
        <h2>申报审批队列</h2>
        <span>待审批申报单集中处理（DecisionGate 档位与风控结论随单展示，审批留痕 approvalRecord）</span>
        <el-checkbox v-model="showRehearsal" size="small" style="margin-left: auto">
          显示历史模拟单（{{ modeCounts.REHEARSAL }}）
        </el-checkbox>
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      </div>
      <el-alert v-if="errorMsg" type="error" :closable="false" show-icon :title="errorMsg" />

      <el-empty v-if="!pending.length && !loading" description="当前没有待审批的申报单" />
      <div v-for="d in pending" :key="d.id" class="approval-card">
        <div class="card-head">
          <b class="mono">{{ d.id }}</b>
          <el-tag v-if="declarationModeOf(d) === 'REHEARSAL'" size="small" type="warning" effect="dark">
            历史模拟 · 非真实申报
          </el-tag>
          <el-tag size="small" type="warning">{{ STATUS_LABEL[d.status] }}</el-tag>
          <el-tag size="small" :type="d.riskCheck?.gateLevel === 'L3' ? 'danger' : 'success'">
            {{ d.riskCheck?.gateLevel ?? 'L2' }}
          </el-tag>
          <el-tag v-if="d.l3Signatures?.length" size="small" type="danger" effect="plain">
            L3 已有一签（{{ d.l3Signatures.map((s) => s.approver).join('、') }}）· 待第二签
          </el-tag>
          <span class="muted">目标日 {{ d.targetDate }} · {{ deadlineText(d) }} · 创建人 {{ d.createdBy }} · 来源 {{ d.strategySource }}</span>
        </div>
        <div class="card-body">
          <span>申报总量 <b>{{ totalMwh(d) }}</b> MWh · 容量 {{ d.capacityMw }} MW</span>
          <ul v-if="d.riskCheck" class="check-list">
            <li v-for="c in d.riskCheck.checks" :key="c.checkId" :data-status="c.status">
              <b>{{ c.name }}</b>{{ c.status === 'PASS' ? '通过' : c.status === 'FAIL' ? '未通过' : '不可用' }} — {{ c.detail }}
            </li>
          </ul>
        </div>
        <div class="card-actions">
          <el-input v-model="comments[d.id]" size="small" placeholder="审批意见（留痕）" style="max-width: 360px" />
          <el-button
            size="small"
            type="success"
            :loading="busyId === d.id"
            :disabled="!!approvalDeniedReason(d)"
            :title="approvalDeniedReason(d)"
            @click="decide(d, 'approve')"
          >
            {{ declarationModeOf(d) === 'REHEARSAL' ? '批准（演练）' : (d.l3Signatures?.length ? '批准（第二签）' : '批准') }}
          </el-button>
          <el-button size="small" type="danger" :loading="busyId === d.id" :disabled="!!approvalDeniedReason(d)" :title="approvalDeniedReason(d)" @click="decide(d, 'reject')">驳回</el-button>
          <el-button size="small" text @click="router.push({ path: '/xhjy/desk' })">去申报台查看</el-button>
          <span v-if="approvalDeniedReason(d)" class="muted">{{ approvalDeniedReason(d) }}，按钮已置灰</span>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>近期审批记录</h2>
        <span>{{ recentDecided.length }} 条</span>
        <el-button size="small" style="margin-left: auto" @click="exportRecords">导出CSV</el-button>
      </div>
      <el-table :data="recentDecided" size="small" border v-loading="loading" empty-text="暂无审批记录">
        <el-table-column prop="id" label="申报单" min-width="200" />
        <el-table-column prop="targetDate" label="目标日" width="110" sortable />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">{{ STATUS_LABEL[row.status as keyof typeof STATUS_LABEL] }}</template>
        </el-table-column>
        <el-table-column label="最近审批" min-width="260">
          <template #default="{ row }">
            <template v-if="row.approvalRecord.length">
              {{ row.approvalRecord[row.approvalRecord.length - 1].approver }}
              （{{ row.approvalRecord[row.approvalRecord.length - 1].role }}）
              {{ row.approvalRecord[row.approvalRecord.length - 1].decision === 'approve'
                ? (row.approvalRecord[row.approvalRecord.length - 1].dualSignPending ? '批准（L3 第一签·待第二签）' : '批准')
                : '驳回' }}
              {{ row.approvalRecord[row.approvalRecord.length - 1].comment ? `：${row.approvalRecord[row.approvalRecord.length - 1].comment}` : '' }}
              <el-tag v-if="row.approvalRecord[row.approvalRecord.length - 1].rehearsalSelfApproval" size="small" type="warning">
                演练自批
              </el-tag>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>全部申报单</h2>
        <span>
          含逾期作废与已出清的历史单（这些单 approvalRecord 为空，不在上方审批记录中显示）·
          真实申报 {{ modeCounts.LIVE }} / 历史模拟 {{ modeCounts.REHEARSAL }}
        </span>
        <el-select v-model="statusFilter" size="small" clearable placeholder="按状态筛选" style="width: 150px; margin-left: auto">
          <el-option v-for="(label, code) in STATUS_LABEL" :key="code" :label="label" :value="code" />
        </el-select>
      </div>
      <el-table :data="allRows" size="small" border v-loading="loading" empty-text="暂无申报单">
        <el-table-column prop="id" label="申报单" min-width="200" />
        <el-table-column prop="targetDate" label="目标日" width="110" sortable />
        <el-table-column label="模式" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="declarationModeOf(row) === 'REHEARSAL' ? 'warning' : 'info'">
              {{ DECLARATION_MODE_LABEL[declarationModeOf(row)] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">{{ STATUS_LABEL[row.status as keyof typeof STATUS_LABEL] }}</template>
        </el-table-column>
        <el-table-column label="申报总量" width="120">
          <template #default="{ row }">{{ totalMwh(row) }} MWh</template>
        </el-table-column>
        <el-table-column prop="createdBy" label="创建人" width="110" />
        <el-table-column label="操作" width="130">
          <template #default="{ row }">
            <!-- 必须带 declarationId：同一目标日有多张单时，申报台只按日期会默认选中 list[0]，
                 用户点的历史单会被打开成另一张 -->
            <el-button
              size="small"
              text
              @click="router.push({ path: '/xhjy/desk', query: { targetDate: row.targetDate, declarationId: row.id } })"
            >
              去申报台
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.muted { color: var(--muted); font-size: var(--font-12-5); }
.mono { font-family: ui-monospace, monospace; font-size: var(--font-md); }

.approval-card {
  margin-top: 10px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.card-body { margin: 8px 0; font-size: var(--font-md); }
.card-body b { font-variant-numeric: tabular-nums; }
.check-list { margin: 6px 0 0; padding-left: 16px; font-size: var(--font-12-5); color: var(--muted); }
.check-list li { margin: 2px 0; }
.check-list li[data-status='PASS'] b { color: var(--success); }
.check-list li[data-status='FAIL'] b { color: #b91c1c; }
.check-list li[data-status='UNAVAILABLE'] b { color: #b45309; }
.card-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
</style>
