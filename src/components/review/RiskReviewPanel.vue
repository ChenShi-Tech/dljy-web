<script setup lang="ts">
// 风险事件库与压力测试面板（Epic #2033 · M3 · #2047：模板九/十）
// ---------------------------------------------------------------------------
// 阈值触发（月度 /review 真数据 + 前端胜率服务；止损仓位 data_gap 如实呈现）；
// 风险事件库读写端点未上线 → 登记草稿本地化（near_miss 不计损失但入案例库）；
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
import { FEED_ABSENT_NOTE } from '@/services/review/templateInstanceApi'

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

// near_miss 登记（事件库端点未上线 → 本地草稿）
const nearMiss = ref({ eventTime: '', riskLevel: 'medium' as 'high' | 'medium' | 'low', positionSnapshot: '', handling: '', effectiveness: '' })
const nearMissSaved = ref(false)
function saveNearMiss() {
  nearMissSaved.value = true // 本地草稿确认；review.risk_events 写入端点未上线不落库
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
        <p class="rrp-note">{{ FEED_ABSENT_NOTE }}风险事件库读写端点随服务端化上线：当前登记为本地草稿，「风控台账覆盖率」KPI 待事件库出数后启用。</p>
        <p class="rrp-note">{{ NEAR_MISS_NOTE }}</p>
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
        <button type="button" class="rrp-save" @click="saveNearMiss">登记 near_miss 草稿</button>
        <p v-if="nearMissSaved" class="rrp-ok">已记为本地草稿（不落库、不计损失金额统计；案例库沉淀随端点上线补录）。</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.rrp { display: flex; flex-direction: column; gap: 10px; font-size: 12.5px; }
.rrp-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.rrp-head input { padding: 2px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: 11.5px; }
.rrp-muted { margin: 0; color: var(--el-text-color-secondary, #909399); }
.rrp-warn { margin: 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 11.5px; line-height: 1.6; }
.rrp-note { margin: 0; font-size: 11px; color: var(--el-text-color-secondary, #909399); line-height: 1.6; }
.rrp-findings b, .rrp-stress b, .rrp-events b { font-size: 12.5px; display: block; margin-bottom: 4px; }
.rrp-findings i { font-style: normal; font-size: 10.5px; color: var(--el-text-color-secondary, #909399); font-weight: 400; }
.rrp-finding { margin: 3px 0; padding: 6px 9px; border-radius: 6px; font-size: 11.5px; line-height: 1.6; }
.rrp-finding.red { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
.rrp-finding.yellow { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
.rrp-finding.gap { background: #f8fafc; border: 1px dashed var(--el-border-color, #dcdfe6); color: #64748b; }
.rrp-cvar { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; font-variant-numeric: tabular-nums; }
.rrp-cvar b { font-size: 13px; }
.rrp-grade { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; margin-top: 4px; }
.rrp-grade select { padding: 3px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; }
.rrp-input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: 11.5px; }
.rrp-nm { display: flex; flex-wrap: wrap; gap: 8px; font-size: 11.5px; align-items: center; }
.rrp-nm label { display: flex; align-items: center; gap: 5px; color: var(--el-text-color-secondary, #666); }
.rrp-full { flex: 1 1 200px; }
.rrp-save { align-self: flex-start; padding: 4px 14px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: 11.5px; cursor: pointer; }
.rrp-ok { margin: 4px 0 0; font-size: 11px; color: #15803d; }
</style>
