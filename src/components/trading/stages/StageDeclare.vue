<script setup lang="ts">
// S4 申报执行（申报窗口，硬死线取地区规则）—— 决策 + 行动
//
// 本面板把申报出门前后的全部动作收在一处，按真实作业顺序排三段：
//   ① 申报曲线：一键套用 S3 写回的方向曲线（也可去申报台逐点微调）；
//   ② 放行自查（T4 十项）：判据自动从 S1–S3 的写回产出填充，交易员只补人给的两项
//      （合规红线自检、双签）。这是**推演台**——权威把关在服务端；
//   ③ 状态机：风控检查 → 送审 → 审批 → 提交。硬约束不过，服务端直接拦转态（409），
//      不是弹个提示继续走。
// 储能立场多一张充放电计划单（折叠块），写回后放行清单的 SOC 判据自动生效。
import { computed, reactive, ref, watch } from 'vue'
import { FileUp, Link2, PenLine, ShieldCheck, Save } from 'lucide-vue-next'
import {
  buildChecklist,
  evaluateRelease,
  type ChecklistInput,
  type OverrideRecord
} from 'shared/trading-rules/release-checklist.mjs'
import { USAGE_GATE_LABEL } from 'shared/trading-rules/data-integrity.mjs'
import { getMarketTiming } from 'shared/trading-rules/market-timing.mjs'
import { currentRegion } from '@/services/region/regionContext'
import { activePosition } from '@/services/position/positionContext'
import {
  approveDeclaration,
  declarationModeOf,
  runDeclarationRiskCheck,
  STATUS_LABEL,
  submitDeclaration,
  submitDeclarationForApproval,
  updateDeclarationCurve,
  type DeclarationOrder
} from '@/services/declarations'
import StorageDispatchBlock from './StorageDispatchBlock.vue'
import type { StageId } from '@/data/workflowStages'

const props = defineProps<{ declaration: DeclarationOrder | null; targetDate: string }>()
const emit = defineEmits<{ updated: [d: DeclarationOrder]; go: [stage: StageId] }>()

const decl = computed(() => props.declaration)
const pf = computed(() => decl.value?.preflight ?? {})
const timing = computed(() => getMarketTiming(currentRegion.value.id))

// ── ① 申报曲线：套用 S3 产出 ────────────────────────────────────────────────
const forecastTotal = computed(() =>
  pf.value.forecast ? pf.value.forecast.curveMwh96.reduce((a, b) => a + b, 0) : null
)
const declaredTotal = computed(() =>
  decl.value ? decl.value.energyCurveMwh96.reduce((a, b) => a + b, 0) : 0
)
const curveMatchesForecast = computed(() => {
  if (!decl.value || !pf.value.forecast) return false
  const a = decl.value.energyCurveMwh96
  const b = pf.value.forecast.curveMwh96
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.0001)
})
const canEditCurve = computed(() =>
  decl.value ? ['DRAFT', 'RISK_CHECKED', 'REJECTED'].includes(decl.value.status) : false
)

const busy = ref(false)
const actionMsg = ref('')
const actionError = ref('')

async function run(action: () => Promise<DeclarationOrder>, doneMsg: string) {
  if (busy.value) return
  busy.value = true
  actionMsg.value = ''
  actionError.value = ''
  try {
    const updated = await action()
    emit('updated', updated)
    actionMsg.value = doneMsg
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '操作失败'
  } finally {
    busy.value = false
  }
}

function applyForecastCurve() {
  const f = pf.value.forecast
  if (!decl.value || !f) return
  void run(
    () => updateDeclarationCurve(decl.value!.id, {
      energyCurveMwh96: f.curveMwh96,
      note: `套用 S3 方向判断曲线（${f.source}）`
    }),
    'S3 申报曲线已套用'
  )
}

// ── ② 放行自查（T4 十项，推演台）────────────────────────────────────────────
const form = reactive<ChecklistInput>({
  dailyVarYuan: 82_000,
  varLimitYuan: 100_000,
  socTrajectoryOk: true,
  socEndOk: true,
  safetyMultiple: 3.1,
  safetyMultipleThreshold: 1.15,
  maxBiasAbs: 0.12,
  biasManagementBand: 0.2,
  biasLegalBand: 0.3,
  complianceRatio: 1.0,
  complianceManagementBand: [0.85, 1.15],
  complianceLegalBand: [0.8, 1.2],
  quoteMonotonic: null,
  quoteIntegerPrice: null,
  minSegmentRatioOk: null,
  redLinesTouched: [],
  dataDeclarable: true,
  dataGateSummary: '',
  preparedBy: 'trader',
  reviewedBy: 'lead'
})
const redLineInput = ref('')
const overrides = ref<OverrideRecord[]>([])
const draftOverride = reactive({ itemId: '', approvedBy: '', cosignedBy: '', reason: '', stopLossCondition: '' })

/**
 * 上游产出 → 判据自动填充：S2 门禁、S3 偏置、储能计划的 SOC 与安全倍数直接落进判据，
 * 交易员只补它们给不出的项。没有上游产出时保持手工值并标「未接入」——不默认成通过。
 */
watch(
  pf,
  (v) => {
    if (v.dataGate) {
      form.dataDeclarable = v.dataGate.gate === 'declarable'
      form.dataGateSummary = `来自 S2：${USAGE_GATE_LABEL[v.dataGate.gate as keyof typeof USAGE_GATE_LABEL]}，完整率 ${(v.dataGate.completenessRate * 100).toFixed(1)}%（${v.dataGate.writtenBy}）`
    }
    if (v.storagePlan) {
      form.socTrajectoryOk = v.storagePlan.socTrajectoryOk
      form.socEndOk = v.storagePlan.socEndOk
      if (v.storagePlan.safetyMultiple !== null) form.safetyMultiple = v.storagePlan.safetyMultiple
    }
    if (v.forecast?.biasRatio !== undefined) {
      form.maxBiasAbs = Math.abs(v.forecast.biasRatio)
    }
  },
  { immediate: true, deep: true }
)

const items = computed(() => {
  form.redLinesTouched = redLineInput.value
    .split(/[,，;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return buildChecklist(form)
})
const verdict = computed(() => evaluateRelease(items.value, overrides.value))

function severityLabel(s: string, passed: boolean) {
  if (passed) return '通过'
  return s === 'hard' ? '硬约束·不可放行' : s === 'overridable' ? '待双签放行' : '告警'
}
function addOverride() {
  if (!draftOverride.itemId) return
  overrides.value = [
    ...overrides.value.filter((o) => o.itemId !== draftOverride.itemId),
    { ...draftOverride, at: new Date().toISOString() }
  ]
  draftOverride.itemId = ''
  draftOverride.reason = ''
  draftOverride.stopLossCondition = ''
}
function removeOverride(itemId: string) {
  overrides.value = overrides.value.filter((o) => o.itemId !== itemId)
}

// ── ③ 状态机动作 ────────────────────────────────────────────────────────────
const status = computed(() => decl.value?.status ?? null)
const approveComment = ref('')

const deadlinePassed = computed(() => {
  if (!decl.value) return false
  return declarationModeOf(decl.value) === 'LIVE' && Date.now() > new Date(decl.value.deadline).getTime()
})

function doRiskCheck() {
  if (!decl.value) return
  void run(() => runDeclarationRiskCheck(decl.value!.id, {}), '风控检查完成（判据取自各阶段写回产出）')
}
function doSubmitForApproval() {
  if (!decl.value) return
  void run(() => submitDeclarationForApproval(decl.value!.id), '已进入审批队列')
}
function doApprove(decision: 'approve' | 'reject') {
  if (!decl.value) return
  void run(
    () => approveDeclaration(decl.value!.id, decision, approveComment.value || undefined),
    decision === 'approve' ? '已批准' : '已驳回'
  )
}
function doSubmit() {
  if (!decl.value) return
  void run(() => submitDeclaration(decl.value!.id, `${decl.value!.id}-submit`), '已提交并取得回执')
}
</script>

<template>
  <div class="dc">
    <!-- 截止提示 -->
    <section v-if="decl" class="dc-deadline" :class="{ over: deadlinePassed }">
      申报截止 {{ new Date(decl.deadline).toLocaleString('zh-CN', { hour12: false }) }}
      <template v-if="timing">（{{ currentRegion.shortName || currentRegion.id }}规则包 D-1 {{ timing.bidDeadline }}）</template>
      <template v-if="declarationModeOf(decl) === 'REHEARSAL'">· 演练单不受截止约束</template>
      <strong v-else-if="deadlinePassed">已过截止——本单提交会被服务端作废（EXPIRED）</strong>
    </section>

    <!-- ① 申报曲线 -->
    <section class="dc-panel">
      <h3><FileUp :size="14" /> ① 申报曲线</h3>
      <div class="dc-curve">
        <span>单据当前 <strong>{{ declaredTotal.toFixed(1) }}</strong> MWh</span>
        <template v-if="forecastTotal !== null">
          <span>S3 产出 <strong>{{ forecastTotal.toFixed(1) }}</strong> MWh</span>
          <span v-if="curveMatchesForecast" class="dc-ok"><Link2 :size="12" /> 已套用 S3 曲线</span>
          <button
            v-else
            type="button"
            class="dc-btn"
            :disabled="!canEditCurve || busy"
            @click="applyForecastCurve"
          >
            套用 S3 申报曲线
          </button>
          <span v-if="!canEditCurve" class="dc-muted">当前状态不可改曲线</span>
        </template>
        <span v-else class="dc-warn-inline">
          S3 方向判断未产出——曲线只能手工维护。
          <button type="button" class="dc-jump" @click="emit('go', 'direction')">回 S3 补</button>
        </span>
      </div>
    </section>

    <!-- 储能立场：充放电计划（写回后 SOC 判据自动生效） -->
    <details class="dc-storage" :open="activePosition === 'STORAGE'">
      <summary>
        储能充放电计划（R1/R2/R3/R11 + 八项约束）
        <em v-if="pf.storagePlan">已写回：循环 {{ pf.storagePlan.cycles }} 次 · 预期毛利 {{ pf.storagePlan.grossMarginYuan }} 元</em>
        <em v-else>储能立场必做；其它立场可忽略</em>
      </summary>
      <StorageDispatchBlock :declaration="decl" @updated="emit('updated', $event)" />
    </details>

    <!-- ② 放行自查 -->
    <section class="dc-panel">
      <h3>
        <ShieldCheck :size="14" /> ② 放行自查（T4 十项）
        <span class="dc-verdict" :class="verdict.allowed ? 'ok' : 'bad'">
          {{ verdict.passedCount }}/{{ verdict.total }} {{ verdict.allowed ? '可进入提交' : '不可提交' }}
        </span>
      </h3>
      <p class="dc-summary" :class="verdict.allowed ? 'ok' : 'bad'">{{ verdict.summary }}</p>

      <div class="dc-grid">
        <div>
          <h4>判据输入<em v-if="pf.dataGate || pf.storagePlan || pf.forecast" class="dc-auto">部分已由 S1–S3 产出自动填充</em></h4>
          <div class="dc-fields">
            <label>日 VaR 元<input v-model.number="form.dailyVarYuan" type="number" /></label>
            <label>授权额度 元<input v-model.number="form.varLimitYuan" type="number" /></label>
            <label>储能安全倍数<input v-model.number="form.safetyMultiple" type="number" step="0.05" /></label>
            <label>最大申报偏置<input v-model.number="form.maxBiasAbs" type="number" step="0.01" /></label>
            <label>中长期履约率<input v-model.number="form.complianceRatio" type="number" step="0.01" /></label>
            <label>编制人<input v-model="form.preparedBy" type="text" /></label>
            <label>复核人<input v-model="form.reviewedBy" type="text" /></label>
          </div>
          <div class="dc-toggles">
            <label><input v-model="form.socTrajectoryOk" type="checkbox" /> SOC 轨迹在带内</label>
            <label><input v-model="form.socEndOk" type="checkbox" /> 终止 SOC 达标</label>
            <label><input v-model="form.dataDeclarable" type="checkbox" /> 数据门禁允许申报</label>
          </div>
          <label class="dc-redline">
            触碰的合规红线（逗号分隔，留空为无）
            <input v-model="redLineInput" type="text" placeholder="如 R-2 身份混用" />
          </label>
        </div>

        <div>
          <!-- 十项清单：检验不是主角——默认只列未通过项，全过时折叠为一行 -->
          <details class="dc-list-fold" :open="!verdict.allowed">
            <summary>
              十项清单
              <span v-if="verdict.allowed" class="dc-fold-badge ok">{{ verdict.passedCount }}/{{ verdict.total }} 全部通过</span>
              <template v-else>
                <span class="dc-fold-badge bad">{{ verdict.total - verdict.passedCount }} 项未过</span>
              </template>
            </summary>
            <ol class="dc-list">
              <li
                v-for="item in items"
                :key="item.id"
                :class="item.passed ? 'pass' : item.severity === 'hard' ? 'hard' : 'soft'"
              >
                <div class="dc-item-head">
                  <span class="dc-no">{{ item.no }}</span>
                  <strong>{{ item.label }}</strong>
                  <span class="dc-sev">{{ severityLabel(item.severity, item.passed) }}</span>
                </div>
                <div class="dc-detail">{{ item.detail }}</div>
              </li>
            </ol>
          </details>
        </div>
      </div>

      <div v-if="verdict.pendingOverrides.length || overrides.length" class="dc-override">
        <h4><PenLine :size="13" /> 超限放行（双签 + 理由 + 止损条件，缺一不采信）</h4>
        <div v-if="verdict.pendingOverrides.length" class="dc-override-form">
          <select v-model="draftOverride.itemId">
            <option value="">选择待放行项…</option>
            <option v-for="i in verdict.pendingOverrides" :key="i.id" :value="i.id">{{ i.no }}. {{ i.label }}</option>
          </select>
          <input v-model="draftOverride.approvedBy" type="text" placeholder="一级审批（交易负责人）" />
          <input v-model="draftOverride.cosignedBy" type="text" placeholder="二级审批（风控负责人）" />
          <input v-model="draftOverride.reason" type="text" placeholder="超限理由" />
          <input v-model="draftOverride.stopLossCondition" type="text" placeholder="止损触发条件" />
          <button type="button" @click="addOverride">登记放行</button>
        </div>
        <ul v-if="overrides.length" class="dc-overrides">
          <li v-for="o in overrides" :key="o.itemId">
            <strong>{{ o.itemId }}</strong>
            <span>{{ o.approvedBy }} + {{ o.cosignedBy || '（缺二级签，不予采信）' }}</span>
            <span>理由：{{ o.reason || '（空，不予采信）' }}</span>
            <span>止损：{{ o.stopLossCondition || '（空，不予采信）' }}</span>
            <button type="button" @click="removeOverride(o.itemId)">撤销</button>
          </li>
        </ul>
      </div>
      <p class="dc-note">
        本清单是交易员的推演台；**权威把关在服务端**——下方「风控检查」用同一套规则重算并
        阻断硬约束（409 拦转态），故此处结论不直接改单据状态。
      </p>
    </section>

    <!-- ③ 状态机 -->
    <section class="dc-panel">
      <h3><Save :size="14" /> ③ 风控 → 审批 → 提交</h3>
      <div v-if="!decl" class="dc-muted">未绑定单据。</div>
      <template v-else>
        <div class="dc-machine">
          <span class="dc-status">{{ STATUS_LABEL[decl.status] }}</span>

          <template v-if="status === 'DRAFT' || status === 'REJECTED' || status === 'RISK_CHECKED'">
            <button type="button" class="dc-btn primary" :disabled="busy" @click="doRiskCheck">
              {{ status === 'RISK_CHECKED' ? '风控复检' : '风控检查' }}
            </button>
          </template>
          <template v-if="status === 'RISK_CHECKED'">
            <button type="button" class="dc-btn primary" :disabled="busy" @click="doSubmitForApproval">送审</button>
          </template>
          <template v-if="status === 'PENDING_APPROVAL'">
            <input v-model="approveComment" type="text" class="dc-comment" placeholder="审批意见（可空）" />
            <button type="button" class="dc-btn primary" :disabled="busy" @click="doApprove('approve')">批准</button>
            <button type="button" class="dc-btn danger" :disabled="busy" @click="doApprove('reject')">驳回</button>
            <span class="dc-muted">四眼原则：创建人不得审批本人真实申报单（服务端强制，演练单豁免）</span>
          </template>
          <template v-if="status === 'APPROVED'">
            <button type="button" class="dc-btn primary" :disabled="busy || deadlinePassed" @click="doSubmit">
              提交申报
            </button>
          </template>
        </div>

        <p v-if="actionMsg" class="dc-ok">{{ actionMsg }}</p>
        <p v-if="actionError" class="dc-err">{{ actionError }}</p>

        <!-- 风控检查结果 -->
        <table v-if="decl.riskCheck" class="dc-table">
          <thead><tr><th>检查项</th><th>结论</th><th>说明</th></tr></thead>
          <tbody>
            <tr v-for="c in decl.riskCheck.checks" :key="c.checkId" :class="c.status.toLowerCase()">
              <td>{{ c.name }}</td>
              <td>{{ c.status === 'PASS' ? '通过' : c.status === 'FAIL' ? '不通过' : '待接入' }}</td>
              <td class="dc-detail-cell">{{ c.detail }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="decl.riskCheck" class="dc-muted">
          审批档位 {{ decl.riskCheck.gateLevel }} · 检查时点
          {{ new Date(decl.riskCheck.evaluatedAt).toLocaleString('zh-CN', { hour12: false }) }}
        </p>

        <!-- 回执 -->
        <div v-if="decl.receipt" class="dc-receipt">
          回执 {{ decl.receipt.receiptId }} · {{ decl.receipt.gateway }}
          · {{ new Date(decl.receipt.acknowledgedAt).toLocaleString('zh-CN', { hour12: false }) }}
          <em v-if="decl.receipt.mock">Mock 网关（非真实申报通道）</em>
          <button type="button" class="dc-jump" @click="emit('go', 'clearing')">→ 等出清结果，去 S5</button>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.dc { display: flex; flex-direction: column; gap: 12px; }
.dc-deadline { padding: 7px 12px; border: 1px solid #bfdbfe; border-radius: 8px; background: #f8fbff; font-size: 12px; }
.dc-deadline.over { border-color: #fca5a5; background: #fef2f2; color: #991b1b; }
.dc-panel { padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.dc-panel h3 { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; font-size: 13px; flex-wrap: wrap; }
.dc-panel h4 { display: flex; align-items: center; gap: 5px; margin: 0 0 6px; font-size: 12px; }
.dc-verdict { margin-left: auto; padding: 2px 10px; border-radius: 9px; font-size: 11px; }
.dc-verdict.ok { background: #f0fdf4; color: #15803d; }
.dc-verdict.bad { background: #fef2f2; color: #b91c1c; }
.dc-summary { margin: 0 0 8px; padding: 6px 10px; border-radius: 6px; font-size: 12px; line-height: 1.6; }
.dc-summary.ok { background: #f0fdf4; color: #166534; }
.dc-summary.bad { background: #fef2f2; color: #991b1b; }

.dc-curve { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12px; font-variant-numeric: tabular-nums; }
.dc-btn { padding: 4px 14px; border: 1px solid #2563eb; border-radius: 5px; background: #eff6ff; color: #1d4ed8; font-size: 12px; cursor: pointer; }
.dc-btn.primary { background: #2563eb; color: #fff; }
.dc-btn.danger { border-color: #dc2626; background: #fef2f2; color: #b91c1c; }
.dc-btn:disabled { opacity: .45; cursor: not-allowed; }
.dc-jump { padding: 0; border: none; background: none; color: #1d4ed8; font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.dc-ok { margin: 6px 0 0; font-size: 12px; color: #15803d; display: inline-flex; align-items: center; gap: 4px; }
.dc-err { margin: 6px 0 0; padding: 6px 10px; border-radius: 6px; background: #fef2f2; color: #991b1b; font-size: 12px; }
.dc-muted { font-size: 11px; color: var(--el-text-color-secondary, #667); }
.dc-warn-inline { font-size: 12px; color: #b45309; }

.dc-storage { border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; padding: 8px 12px; }
.dc-storage summary { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; cursor: pointer; flex-wrap: wrap; }
.dc-storage summary em { font-style: normal; font-weight: 400; font-size: 11px; color: var(--el-text-color-secondary, #889); }
.dc-storage[open] summary { margin-bottom: 8px; }

.dc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 12px; }
.dc-auto { margin-left: 8px; font-style: normal; font-size: 10px; font-weight: 400; padding: 1px 7px; border-radius: 8px; background: #ecfdf5; color: #047857; }
.dc-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 6px 10px; }
.dc-fields label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--el-text-color-secondary, #667); }
.dc-fields input { padding: 3px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: 12px; }
.dc-toggles { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 8px; font-size: 12px; }
.dc-toggles label { display: inline-flex; align-items: center; gap: 5px; }
.dc-redline { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; font-size: 11px; color: var(--el-text-color-secondary, #667); }
.dc-redline input { padding: 4px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: 12px; }

.dc-list-fold { border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; padding: 6px 10px; }
.dc-list-fold summary { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; cursor: pointer; }
.dc-list-fold[open] summary { margin-bottom: 6px; }
.dc-fold-badge { padding: 1px 9px; border-radius: 9px; font-size: 10px; font-weight: 600; }
.dc-fold-badge.ok { background: #dcfce7; color: #15803d; }
.dc-fold-badge.bad { background: #fee2e2; color: #991b1b; }

.dc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.dc-list li { padding: 6px 9px; border-radius: 6px; border-left: 3px solid transparent; }
.dc-list li.pass { background: #f6fefa; border-left-color: #4ade80; }
.dc-list li.hard { background: #fef2f2; border-left-color: #ef4444; }
.dc-list li.soft { background: #fffbeb; border-left-color: #f59e0b; }
.dc-item-head { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; font-size: 12px; }
.dc-no { min-width: 18px; height: 18px; line-height: 18px; text-align: center; border-radius: 50%; background: #1e293b; color: #fff; font-size: 10px; }
.dc-sev { margin-left: auto; font-size: 10px; padding: 1px 7px; border-radius: 8px; background: rgba(0,0,0,.06); }
.dc-detail { margin-top: 2px; padding-left: 25px; font-size: 11px; color: var(--el-text-color-secondary, #667); }

.dc-override { margin-top: 10px; }
.dc-override-form { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.dc-override-form select, .dc-override-form input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; }
.dc-override-form input { min-width: 150px; }
.dc-override-form button { padding: 4px 14px; border: 1px solid #2563eb; border-radius: 5px; background: #eff6ff; color: #1d4ed8; font-size: 12px; cursor: pointer; }
.dc-overrides { list-style: none; margin: 8px 0 0; padding: 0; font-size: 11px; }
.dc-overrides li { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 5px 8px; border-radius: 6px; background: #f8fafc; margin-bottom: 4px; }
.dc-overrides button { margin-left: auto; padding: 1px 8px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; background: #fff; cursor: pointer; font-size: 11px; }

.dc-note { margin: 8px 0 0; font-size: 11px; line-height: 1.6; color: #a16207; }

.dc-machine { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dc-status { padding: 3px 12px; border-radius: 9px; background: #eff6ff; color: #1d4ed8; font-size: 12px; font-weight: 600; }
.dc-comment { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; min-width: 200px; }

.dc-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 8px; }
.dc-table th, .dc-table td { padding: 4px 6px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: left; }
.dc-table th { color: var(--el-text-color-secondary, #667); font-weight: 600; }
.dc-table tr.fail td { background: #fef2f2; }
.dc-table tr.unavailable td { background: #fffbeb; }
.dc-detail-cell { color: var(--el-text-color-secondary, #667); }

.dc-receipt { margin-top: 8px; padding: 7px 10px; border-radius: 8px; background: #f0fdf4; color: #166534; font-size: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dc-receipt em { font-style: normal; padding: 1px 7px; border-radius: 8px; background: #fef3c7; color: #92400e; font-size: 10px; }
</style>
