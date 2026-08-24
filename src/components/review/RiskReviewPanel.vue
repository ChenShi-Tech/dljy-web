<script setup lang="ts">
// 风险事件库与压力测试面板（Epic #2033 · M3 · #2047：模板九/十）
// ---------------------------------------------------------------------------
// 阈值触发（月度 /review 真数据 + 前端胜率服务；止损仓位 data_gap 如实呈现）；
// 风险事件库已接端点（review.risk_events）：登记落库 + 处置回填 + 事件回显；
// 越限触发自动生成事件库草稿（幂等双保险：确定性键 + GET 去重）；
// near_miss 不计损失金额（三层红线），事件落库后自动沉淀案例库（review.cases，
// case_no 回执；失败红字+重试，不静默）；端点缺席环境回落本地草稿（探针降级）；
// 压力测试包装既有蒙特卡洛引擎 /quant/cvar（价差序列真算 VaR/CVaR/最大回撤），
// 显著标注「决策参考，非结算依据」；承受能力评级人定，「弱」限期整改复测本地跟踪。
// 站内不外发（C4 确认前，沿用四川采集告警先例）。
import { computed, onMounted, ref, watch } from 'vue'
import { fetchCvar, type CvarResult } from '@/services/quant/quantClient'
import { fetchReviewRange } from '@/services/review/reviewPeriodClient'
import { aggregateDeviation } from '@/services/review/deviationAggregate'
import {
  NEAR_MISS_NOTE,
  spreadReturns,
  STRESS_GRADES,
  thresholdFindings
} from '@/services/review/riskReview'
import { getRegionWinStats } from '@/services/tradingMemory'
import { currentRegion } from '@/services/region/regionContext'
import {
  fetchCases,
  fetchRiskEvents,
  patchRiskEvent,
  registerCase,
  registerRiskEvent
} from '@/services/review/reviewStoreClient'
import type { RiskEventSummary } from '@/services/review/reviewStoreApi'

const props = defineProps<{ tolerancePct: number; penaltyPrice: number }>()

const month = ref(new Date().toISOString().slice(0, 7))
const loading = ref(false)
const loadError = ref('')
const daysOk = ref<ReadonlyArray<{ date: string; detail: Array<{ da_price?: number; rt_price?: number }>; spreadPnl: number | null }>>([])
const aggRows = ref<ReturnType<typeof aggregateDeviation>['rows']>([])

async function load() {
  loading.value = true
  loadError.value = ''
  daysOk.value = []
  aggRows.value = []
  cvar.value = null
  cvarError.value = ''
  try {
    const [y, m] = month.value.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    const today = new Date().toISOString().slice(0, 10)
    const dates = Array.from({ length: last }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`).filter((d) => d <= today)
    const period = await fetchReviewRange(dates, { tolerancePct: props.tolerancePct, penaltyPrice: props.penaltyPrice })
    const ok = period.days.filter((d): d is Extract<typeof d, { ok: true }> => d.ok)
    daysOk.value = ok.map((d) => ({ date: d.date, detail: d.result.detail, spreadPnl: d.result.backtest.da_rt_spread_pnl_yuan ?? null }))
    aggRows.value = aggregateDeviation(period.days).rows
    await runStress()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '月度取数失败'
  } finally {
    loading.value = false
    void autoDraftFindings() // 取数落定后再判（loading 期间 findings 未稳，不抢跑）
  }
}
onMounted(load)
watch(month, load)

const winStats = computed(() => getRegionWinStats(currentRegion.value.id))
const findings = computed(() =>
  thresholdFindings({
    aggRows: aggRows.value,
    dailySpreadPnl: daysOk.value.map((d) => ({ date: d.date, pnlYuan: d.spreadPnl })),
    winRate: winStats.value.sampleSize > 0 ? winStats.value.posteriorWinRate : null
  })
)

// 压力测试（/quant/cvar 真引擎）
const cvar = ref<CvarResult | null>(null)
const cvarError = ref('')
async function runStress() {
  const returns = daysOk.value.flatMap((d) => spreadReturns(d.detail))
  if (returns.length < 2) {
    cvar.value = null
    cvarError.value = `价差序列样本 ${returns.length}（需 ≥2 且双价齐备）——样本不足不出压力测试结论。`
    return
  }
  try {
    cvar.value = await fetchCvar(returns)
  } catch (e) {
    cvar.value = null
    cvarError.value = e instanceof Error ? e.message : 'CVaR 引擎调用失败'
  }
}

// 承受能力评级（人定）+ 弱→限期整改复测本地跟踪
const stressGrade = ref('')
const remediation = ref('')

// near_miss 登记（#2047 端点上线：落 review.risk_events；端点缺席环境诚实降级草稿）
const nearMiss = ref({ eventTime: '', riskLevel: 'medium' as 'high' | 'medium' | 'low', positionSnapshot: '', handling: '', effectiveness: '' })
const nearMissSaved = ref(false)
const nearMissError = ref('')
const eventsAvailable = ref(false)
const registeredEvents = ref<RiskEventSummary[]>([])

// near_miss 案例库沉淀（#2047「侥幸逃过须入案例库」）：事件落库后自动 registerCase；
// 失败红字 + 重试按钮（写路径不静默），成功给 case_no 回执。
const casesAvailable = ref(false)
const caseReceipt = ref('')
const caseError = ref('')
const caseRetryDraft = ref<Parameters<typeof registerCase>[0] | null>(null)

async function loadCasesProbe() {
  const feed = await fetchCases()
  casesAvailable.value = feed.available
}

async function sinkCase(draft: Parameters<typeof registerCase>[0]) {
  const created = await registerCase(draft)
  caseReceipt.value = created.caseNo
  caseError.value = ''
  caseRetryDraft.value = null
}

async function retrySinkCase() {
  if (!caseRetryDraft.value) return
  try {
    await sinkCase(caseRetryDraft.value)
  } catch (e) {
    caseError.value = e instanceof Error ? e.message : '案例沉淀失败'
  }
}

async function loadEvents() {
  const feed = await fetchRiskEvents({ nearMiss: true })
  if (feed.available) {
    eventsAvailable.value = true
    registeredEvents.value = feed.events
  } else {
    eventsAvailable.value = false
  }
}
onMounted(loadEvents)
onMounted(loadCasesProbe)

async function saveNearMiss() {
  nearMissSaved.value = false
  nearMissError.value = ''
  if (!eventsAvailable.value) {
    nearMissSaved.value = true // 端点缺席：本地草稿确认，不落库（诚实降级）
    return
  }
  if (!nearMiss.value.eventTime) {
    nearMissError.value = '事件时间必填'
    return
  }
  try {
    // near_miss 红线：不计损失金额（不传 impactYuan，服务端也拒）
    const ev = await registerRiskEvent({
      eventTime: new Date(nearMiss.value.eventTime).toISOString(),
      eventType: 'near_miss',
      riskLevel: nearMiss.value.riskLevel,
      nearMiss: true,
      positionSnapshot: nearMiss.value.positionSnapshot
        ? { snapshot: nearMiss.value.positionSnapshot }
        : null,
      lessons: nearMiss.value.effectiveness || null
    })
    if (nearMiss.value.handling) {
      // 处置措施走 PATCH 回填（登记后补处置是常态流；事实列不可改写）
      await patchRiskEvent(ev.id, { disposal: nearMiss.value.handling, effective: null })
    }
    nearMissSaved.value = true
    await loadEvents()
    // #2047 验收：near_miss 自动沉淀案例库（case_type=risk；公开是显式决定，缺省 internal）。
    if (casesAvailable.value) {
      const caseDraft = {
        caseType: 'risk' as const,
        title: `near_miss：${nearMiss.value.effectiveness || nearMiss.value.eventTime}`,
        background: nearMiss.value.positionSnapshot || '（当时仓位未记录）',
        conclusion: [nearMiss.value.handling, nearMiss.value.effectiveness].filter(Boolean).join('；') || '（处置与有效性未记录）',
        lessons: nearMiss.value.effectiveness || '侥幸逃过待补评估（这次没事不等于下次没事）',
        visibility: 'internal' as const
      }
      try {
        await sinkCase(caseDraft)
      } catch (e) {
        // 事件已落库，案例沉淀失败不吞：红字 + 重试按钮（写路径不静默）
        caseError.value = e instanceof Error ? e.message : '案例沉淀失败'
        caseRetryDraft.value = caseDraft
      }
    }
  } catch (e) {
    nearMissError.value = e instanceof Error ? e.message : 'near_miss 登记失败'
  }
}

// ── 阈值触发即事件库草稿（#2047「越限即预警型待办 + 事件库草稿」） ────────────
// 幂等双保险：确定性 Idempotency-Key（trigger-{eventType}-{periodKey}）+
// 服务端事实去重（GET 已存在同 eventType 不再 POST）；未越限不 POST（负例红线）。
const autoDraftNotes = ref<string[]>([])
const autoDraftedTypes = ref(new Set<string>())

async function autoDraftFindings() {
  autoDraftNotes.value = []
  if (!eventsAvailable.value) return
  const feed = await fetchRiskEvents()
  if (!feed.available) return
  const existingTypes = new Set(feed.events.map((e) => e.eventType))
  for (const f of findings.value.findings) {
    if (f.dataGap || autoDraftedTypes.value.has(f.id)) continue
    const eventType = `trigger_${f.id.replace(/-/g, '_')}`
    if (existingTypes.has(eventType)) {
      autoDraftNotes.value.push(`「${f.title}」事件库草稿已存在（不重复登记）。`)
      continue
    }
    try {
      await registerRiskEvent(
        {
          eventTime: new Date().toISOString(),
          eventType,
          riskLevel: f.level === 'red' ? 'high' : 'medium',
          lessons: `${f.title}——${f.detail}`
        },
        `trigger-${f.id}-${month.value}` // 确定性幂等键：同触发器同月重放同键
      )
      autoDraftedTypes.value.add(f.id)
      autoDraftNotes.value.push(`「${f.title}」已生成事件库草稿（预警型待办）。`)
    } catch {
      autoDraftNotes.value.push(`「${f.title}」草稿登记失败（网络/端点异常，稍后重载月份可重试）。`)
    }
  }
}
</script>

<template>
  <section class="rrp">
    <header class="rrp-head">
      <b>风险事件库与压力测试（模板九 · 风险事件 / 模板十 · 压力测试）</b>
      <input v-model="month" type="month" />
    </header>

    <p v-if="loading" class="rrp-muted">月度取数与阈值判级中…</p>
    <p v-else-if="loadError" class="rrp-warn">{{ loadError }}</p>

    <template v-else>
      <!-- 阈值触发清单 -->
      <div class="rrp-findings">
        <b>阈值触发（{{ month }}）<i>阈值缺省可配置（梁总 P2 确认后调整）；站内不外发（C4 确认前）</i></b>
        <p v-for="f in findings.findings" :key="f.id" class="rrp-finding" :class="f.dataGap ? 'gap' : f.level">
          <b>{{ f.title }}</b> {{ f.detail }}
        </p>
        <p v-if="!findings.findings.some((f) => !f.dataGap)" class="rrp-muted">
          本月无越限触发（负例：未越限不生成待办）——除 data_gap 项外监测均在跑。
        </p>
        <p v-for="(n, i) in autoDraftNotes" :key="i" class="rrp-note">{{ n }}</p>
      </div>

      <!-- 压力测试（CVaR 真引擎） -->
      <div class="rrp-stress">
        <b>极端情景压力测试（包装蒙特卡洛引擎 /quant/cvar · 价差序列口径）</b>
        <p class="rrp-note">情景参数化（极端价格/断面阻塞/平台异常）的逐时推演归后续增强；当前以月度价差收益序列做 VaR/CVaR 历史模拟。<b>决策参考，非结算依据。</b></p>
        <template v-if="cvar">
          <div class="rrp-cvar">
            <span>VaR95 <b>{{ (cvar.var_95 * 100).toFixed(2) }}%</b></span>
            <span>CVaR95 <b>{{ (cvar.cvar_95 * 100).toFixed(2) }}%</b></span>
            <span>最大回撤 <b>{{ (cvar.max_drawdown * 100).toFixed(2) }}%</b></span>
            <span>波动率(年化) <b>{{ (cvar.volatility * 100).toFixed(1) }}%</b></span>
            <span>夏普 <b>{{ cvar.sharpe_ratio.toFixed(2) }}</b></span>
            <span>索提诺 <b>{{ cvar.sortino_ratio.toFixed(2) }}</b></span>
          </div>
          <p v-if="cvar.policy_source" class="rrp-note">{{ cvar.policy_source }}</p>
        </template>
        <p v-else-if="cvarError" class="rrp-warn">{{ cvarError }}</p>

        <label class="rrp-grade">
          承受能力评级（人定）：
          <select v-model="stressGrade">
            <option value="">选择…</option>
            <option v-for="g in STRESS_GRADES" :key="g.id" :value="g.id">{{ g.label }}</option>
          </select>
        </label>
        <label v-if="stressGrade === 'weak'" class="rrp-grade">
          限期整改与复测安排（「弱」必填，本地跟踪）：
          <input v-model="remediation" class="rrp-input" placeholder="整改措施与复测时限" />
        </label>
      </div>

      <!-- 风险事件库 + near_miss 登记 -->
      <div class="rrp-events">
        <b>风险事件库（模板九 · 含 near_miss 侥幸逃过）</b>
        <p class="rrp-note">
          {{ eventsAvailable
            ? '事件库读写端点已接通（review.risk_events）：登记即落库，near_miss 不计损失金额统计；「风控台账覆盖率」KPI 从本库出数。'
            : '风险事件库读写端点未上线：当前登记为本地草稿（不落库）；端点上线后自动切换。' }}
        </p>
        <p class="rrp-note">{{ NEAR_MISS_NOTE }}</p>
        <template v-if="eventsAvailable && registeredEvents.length">
          <p class="rrp-note">已登记 near_miss（{{ registeredEvents.length }} 条）：</p>
          <p v-for="r in registeredEvents" :key="r.id" class="rrp-finding yellow">
            {{ r.eventTime.slice(0, 10) }} · {{ r.eventType }}{{ r.riskLevel ? ` · ${r.riskLevel}` : '' }}
            <template v-if="r.disposal">· 处置：{{ r.disposal }}</template>
            <template v-if="r.effective === true">· 处置有效</template>
            <template v-else-if="r.effective === false">· 处置无效</template>
          </p>
        </template>
        <div class="rrp-nm">
          <label>事件时间 <input v-model="nearMiss.eventTime" type="datetime-local" /></label>
          <label>等级
            <select v-model="nearMiss.riskLevel">
              <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
            </select>
          </label>
          <label class="rrp-full">当时仓位 <input v-model="nearMiss.positionSnapshot" class="rrp-input" placeholder="持仓/敞口快照" /></label>
          <label class="rrp-full">处置措施 <input v-model="nearMiss.handling" class="rrp-input" placeholder="当时怎么处理的" /></label>
          <label class="rrp-full">有效性评估 <input v-model="nearMiss.effectiveness" class="rrp-input" placeholder="处置是否有效、何处侥幸" /></label>
        </div>
        <button type="button" class="rrp-save" @click="saveNearMiss">登记 near_miss</button>
        <p v-if="nearMissError" class="rrp-warn">{{ nearMissError }}</p>
        <p v-else-if="nearMissSaved" class="rrp-ok">
          {{ eventsAvailable ? '已落库（near_miss 不计入损失金额统计）。' : '已记为本地草稿（端点缺席环境，不落库）。' }}
        </p>
        <template v-if="caseReceipt">
          <p class="rrp-ok">已沉淀案例库：{{ caseReceipt }}（internal，near_miss 档案纪律）。</p>
        </template>
        <template v-else-if="caseError">
          <p class="rrp-warn">{{ caseError }}（事件已落库，案例沉淀失败不静默）</p>
          <button v-if="caseRetryDraft" type="button" class="rrp-save" @click="retrySinkCase">重试沉淀案例</button>
        </template>
      </div>
    </template>
  </section>
</template>

<style scoped>
.rrp { display: flex; flex-direction: column; gap: 10px; font-size: var(--font-12-5); }
.rrp-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.rrp-head input { padding: 2px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-11-5); }
.rrp-muted { margin: 0; color: var(--el-text-color-secondary, #909399); }
.rrp-warn { margin: 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: var(--font-11-5); line-height: 1.6; }
.rrp-note { margin: 0; font-size: var(--font-xs); color: var(--el-text-color-secondary, #909399); line-height: 1.6; }
.rrp-findings b, .rrp-stress b, .rrp-events b { font-size: var(--font-12-5); display: block; margin-bottom: 4px; }
.rrp-findings i { font-style: normal; font-size: var(--font-10-5); color: var(--el-text-color-secondary, #909399); font-weight: 400; }
.rrp-finding { margin: 3px 0; padding: 6px 9px; border-radius: 6px; font-size: var(--font-11-5); line-height: 1.6; }
.rrp-finding.red { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
.rrp-finding.yellow { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
.rrp-finding.gap { background: #f8fafc; border: 1px dashed var(--el-border-color, #dcdfe6); color: #64748b; }
.rrp-cvar { display: flex; flex-wrap: wrap; gap: 12px; font-size: var(--font-sm); font-variant-numeric: tabular-nums; }
.rrp-cvar b { font-size: var(--font-md); }
.rrp-grade { display: flex; align-items: center; gap: 8px; font-size: var(--font-sm); flex-wrap: wrap; margin-top: 4px; }
.rrp-grade select { padding: 3px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; }
.rrp-input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-11-5); }
.rrp-nm { display: flex; flex-wrap: wrap; gap: 8px; font-size: var(--font-11-5); align-items: center; }
.rrp-nm label { display: flex; align-items: center; gap: 5px; color: var(--el-text-color-secondary, #666); }
.rrp-full { flex: 1 1 200px; }
.rrp-save { align-self: flex-start; padding: 4px 14px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: var(--font-11-5); cursor: pointer; }
.rrp-ok { margin: 4px 0 0; font-size: var(--font-xs); color: #15803d; }
</style>
