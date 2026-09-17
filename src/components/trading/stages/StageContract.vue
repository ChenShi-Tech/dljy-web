<script setup lang="ts">
// S6 中长期补仓（15:00–16:30，低频）， 决策 + 行动
//
// 现货日内的最后一块决策：中长期持仓覆盖到没有问题？口径为买方立场（售电/大用户），
// 缺口敞在现货上结算。建议核心只有一句话，缺口敞在贵的现货上要赶紧补，敞在便宜的
// 现货上可以故意留着；超签反过来。
//
// 三处上游产出自动喂进本面板：
//   · S3 申报曲线合计 → 预测电量（缺则手填）；
//   · S2 主导态势 → 现货贵不贵的判据；
//   · S3 方向 → 两可情形下（现货便宜却判增持、现货贵却判减持）的拍板。
// 三者缺席时按平衡市处理并在理由里写明，不假装有判断。结论写回 preflight.contract。
import { computed, onMounted, ref, watch } from 'vue'
import { Save, Wallet, ArrowDownUp, Database, ShieldAlert } from 'lucide-vue-next'
import {
  GAP_SUGGESTION_LABEL,
  assessContractGap,
  assessContractGapForPosition,
  kellyPositionCap,
  listingVsAnnualAverage,
  timingWithDistribution,
  volatilityGuard,
  type GapSuggestion
} from '@/services/trading/contractGap'
import { REGIME_LABEL } from 'shared/trading-rules/supply-demand.mjs'
import { savePreflight, type DeclarationOrder } from '@/services/declarations'
import { useSaveState } from '@/composables/useSaveState'
import { createContract, fetchContracts, type CompanyContract } from '@/services/company/companyApi'
import { activeStanceType } from '@/services/stance/stanceContext'
import AiAssistFill from '@/components/trading/AiAssistFill.vue'
import type { StageId } from '@/data/workflowStages'

const props = defineProps<{ declaration: DeclarationOrder | null; targetDate: string }>()
const emit = defineEmits<{ updated: [d: DeclarationOrder]; go: [stage: StageId] }>()

const decl = computed(() => props.declaration)
const pf = computed(() => decl.value?.preflight ?? {})

// 上游产出
const forecastFromS3 = computed(() =>
  pf.value.forecast ? pf.value.forecast.curveMwh96.reduce((a, b) => a + b, 0) : null
)
const regime = computed(() => (pf.value.dataGate?.regime ?? null) as string | null)
const direction = computed(() => (pf.value.forecast?.direction ?? null) as 'add' | 'reduce' | 'hold' | null)

// 输入（缺上游产出时手填）
const forecastInput = ref<number>(0)
const forecastMwh = computed(() => forecastFromS3.value ?? forecastInput.value)

// 持仓视图（F4.2 联动）：日前中标量由 S5 写回自动喂入，不再人工填
const clearingPosition = computed(() => props.declaration?.preflight?.clearingReview?.positionUpdate ?? null)

// 合约库联动（F1.6 · #1966）：月度持仓/年度均价/挂牌价参考自动取公司合同库
// 月度持仓口径：覆盖标的月的生效中长期合同，总量按「重叠天数 ÷ 合同天数」折算到月
// （年合同写的是全年总量，直接加总会把持仓放大 12 倍），折算式随面板呈现。
const MLT_MARKET_TYPES = new Set([
  'annual_bilateral', 'annual_centralized', 'monthly_bilateral', 'monthly_centralized',
  'provincial_green_annual', 'provincial_green_monthly', 'cross_provincial_green_annual', 'cross_provincial_green_monthly'
])
const contracts = ref<CompanyContract[]>([])
const contractsNote = ref('')
const contractsBusy = ref(false)

function daysBetween(a: string, b: string): number {
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1)
}
function overlapsMonth(c: CompanyContract, iso: string): number {
  if (!c.startDate || !c.endDate) return 0
  const monthStart = new Date(`${iso.slice(0, 7)}-01T00:00:00`)
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0)
  const s = new Date(`${c.startDate}T00:00:00`)
  const e = new Date(`${c.endDate}T00:00:00`)
  const from = Math.max(s.getTime(), monthStart.getTime())
  const to = Math.min(e.getTime(), monthEnd.getTime())
  return from <= to ? Math.round((to - from) / 86400000) + 1 : 0
}

/** 买方立场取 buyerPrice，卖方（发电/储能）取 sellerPrice。 */
const priceOf = (c: CompanyContract): number | null => {
  const v = activeStanceType.value === 'GENERATOR' || activeStanceType.value === 'STORAGE' ? c.sellerPrice : c.buyerPrice
  return Number.isFinite(v) ? Number(v) : null
}

const monthPositionFromLibrary = computed<number | null>(() => {
  const mlt = contracts.value.filter(
    (c) => c.status === 'active' && MLT_MARKET_TYPES.has(c.marketType) && overlapsMonth(c, props.targetDate) > 0
  )
  if (!mlt.length) return null
  let sum = 0
  for (const c of mlt) {
    if (!c.startDate || !c.endDate) continue
    const totalDays = daysBetween(c.startDate, c.endDate)
    const overlap = overlapsMonth(c, props.targetDate)
    sum += (Number(c.totalQuantity) || 0) * (overlap / totalDays)
  }
  return Math.round(sum)
})

/** 年度均价：年度类合同按量加权的成交均价。 */
const annualAvgFromLibrary = computed<number | null>(() => {
  const annual = contracts.value.filter(
    (c) => c.status === 'active' && c.marketType.startsWith('annual')
  )
  let q = 0
  let fee = 0
  for (const c of annual) {
    const qty = Number(c.totalQuantity) || 0
    const price = priceOf(c)
    if (qty > 0 && price !== null) {
      q += qty
      fee += qty * price
    }
  }
  return q > 0 ? Math.round((fee / q) * 10) / 10 : null
})

/** 挂牌价参考：库内最近的月度类合同价（可人工覆盖）。 */
const listingPrice = ref<number | null>(null)
const listingPriceSource = ref<'library' | 'manual'>('manual')
const listingFromLibrary = computed<number | null>(() => {
  const monthly = contracts.value
    .filter((c) => c.status === 'active' && c.marketType.startsWith('monthly') && priceOf(c) !== null)
    .sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1))
  return monthly.length ? priceOf(monthly[0]!) : null
})

async function loadContracts() {
  contractsBusy.value = true
  contractsNote.value = ''
  try {
    contracts.value = await fetchContracts()
    if (!contracts.value.length) contractsNote.value = '公司合同库无记录——持仓与价格仍为人工口径'
    else {
      const pos = monthPositionFromLibrary.value
      if (pos !== null && contractedMwh.value === 0) contractedMwh.value = pos
      const lp = listingFromLibrary.value
      if (lp !== null && listingPrice.value === null) {
        listingPrice.value = lp
        listingPriceSource.value = 'library'
      }
    }
  } catch (e) {
    contractsNote.value = e instanceof Error ? `合同库读取失败：${e.message}` : '合同库读取失败——维持人工口径'
  } finally {
    contractsBusy.value = false
  }
}
onMounted(loadContracts)

// 价格对比三件套：挂牌价 vs 年均价 / 分布判时机 / 波动守卫
const s3Quantile = computed(() => {
  const q = pf.value.forecast?.quantileDigest as { mean?: number; valley?: number; peak?: number } | undefined
  return q && Number.isFinite(q.mean) ? { mean: Number(q.mean), valley: Number(q.valley ?? q.mean), peak: Number(q.peak ?? q.mean) } : null
})
const listingCompare = computed(() => listingVsAnnualAverage(listingPrice.value, annualAvgFromLibrary.value))
const timingVerdict = computed(() => timingWithDistribution(listingPrice.value, s3Quantile.value))
const volatilityPct = ref<number | null>(null)
const volatility = computed(() => volatilityGuard(volatilityPct.value))
/** 波动暂停守卫压过一切补仓建议：>5% 时按暂停处理（手册异常处理优先级最高）。 */
const effectiveSuggestion = computed<GapSuggestion>(() => (volatility.value.paused ? 'hold' : assessment.value.suggestion))
const kelly = computed(() =>
  kellyPositionCap({
    confidencePct: pf.value.forecast?.confidence ?? null,
    listingYuanPerMwh: listingPrice.value,
    digest: s3Quantile.value
  })
)

// 执行登记到合约库（手册步骤④：执行后更新合约库，持仓自动前进）
const executedVolumeMwh = ref<number | null>(null)
const executedPriceYuan = ref<number | null>(null)
const registering = ref(false)
const registerMsg = ref('')
const registerError = ref('')

async function registerToLibrary() {
  const d = decl.value
  if (!d || executedVolumeMwh.value === null || executedPriceYuan.value === null) return
  registering.value = true
  registerMsg.value = ''
  registerError.value = ''
  try {
    const sellSide = activeStanceType.value === 'GENERATOR' || activeStanceType.value === 'STORAGE'
    // 月末按业务日期字符串锚定：本地午夜再 toISOString 在 UTC+8 会恒少一天（endDate 错）
    const lastDay = new Date(Number(d.targetDate.slice(0, 4)), Number(d.targetDate.slice(5, 7)), 0).getDate()
    const monthEnd = `${d.targetDate.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`
    await createContract({
      contractNo: `S6-${d.targetDate}-${Date.now().toString().slice(-6)}`,
      contractName: `S6 补仓执行登记 ${d.targetDate}`,
      marketType: 'monthly_bilateral',
      tradeMode: 'listing',
      startDate: `${d.targetDate.slice(0, 7)}-01`,
      endDate: monthEnd,
      totalQuantity: executedVolumeMwh.value,
      buyerPrice: sellSide ? undefined : executedPriceYuan.value,
      sellerPrice: sellSide ? executedPriceYuan.value : undefined,
      status: 'active',
      remarks: `S6 一日作业链执行登记（单据 ${d.id}，动作：${action.value.trim() || '—'}）`
    })
    registerMsg.value = '已登记到公司合同库（月度双边/挂牌）——重载合约库后持仓自动前进'
    await loadContracts()
  } catch (e) {
    registerError.value = e instanceof Error ? e.message : '登记失败（需先选择本公司）'
  } finally {
    registering.value = false
  }
}
const contractedMwh = ref<number>(0)
const holdBand = ref(0.05)

watch(forecastFromS3, (v) => { if (v !== null) forecastInput.value = 0 }, { immediate: true })

const assessment = computed(() =>
  assessContractGapForPosition({
    forecastMwh: forecastMwh.value,
    contractedMwh: contractedMwh.value,
    regime: regime.value as Parameters<typeof assessContractGap>[0]['regime'],
    direction: direction.value,
    holdBand: holdBand.value,
    position: activeStanceType.value
  })
)

// 实际动作录入（建议是建议、执行是执行，分开记）
const ACTION_PRESETS: Record<GapSuggestion, string> = {
  'buy-urgent': '紧急挂牌买入缺口电量',
  buy: '场内分批补仓',
  hold: '不动（按建议观望）',
  sell: '挂牌转让超签持仓'
}
const action = ref('')
const actionValid = computed(() => action.value.trim().length >= 4)
watch(
  assessment,
  (a) => { if (a) action.value = ACTION_PRESETS[a.suggestion] ?? '' },
  { immediate: true }
)

// AI 辅助填报：只辅助"执行方式"这一项人工判断
// 边界拿捏：敞口量、敞口率、建议方向（急补/择机补/观望/转让）都是 assessContractGap
// 规则引擎算出来的确定性结果，不需要也不应该让 AI 重判；真正需要经验的是
// "具体怎么执行"，一次挂牌还是分批、挂什么价位区间、什么条件下暂停。
const ASSIST_LABELS = { action: '执行动作' }
const assistContext = computed(() => ({
  targetDate: props.targetDate,
  gapMwh: assessment.value.gapMwh,
  gapPct: assessment.value.gapPct,
  ruleSuggestion: assessment.value.suggestion,
  ruleReason: assessment.value.reason,
  s2Regime: regime.value,
  s3Direction: direction.value,
  forecastMwh: forecastMwh.value,
  contractedMwh: contractedMwh.value,
  note: '敞口与建议方向已由规则引擎算定，不要改这些结论；只给"具体怎么执行"的动作描述'
}))
function applyAssist(s: Record<string, unknown>) {
  if (typeof s.action === 'string' && s.action.trim()) action.value = s.action.trim()
}

// 写回
// 写回三态走 useSaveState 单源（spot-trading-module-hygiene 收口六份逐字副本）
const { saving, saveMsg, saveError, runSave } = useSaveState()
const written = computed(() => pf.value.contract ?? null)

async function writeBack() {
  if (!decl.value || !actionValid.value) return
  const declaration = decl.value
  await runSave(async () => {
    const a = assessment.value
    const updated = await savePreflight(
      declaration.id,
      'contract',
      {
        gapMwh: a.gapMwh,
        gapPct: a.gapPct,
        suggestion: effectiveSuggestion.value,
        action: action.value.trim(),
        reason: volatility.value.paused ? `${a.reason}；${volatility.value.hint}` : a.reason,
        // 价格对比与守卫（#1966）：对比结论/时机判断/波动守卫/凯利上限随决定留痕
        listingPriceYuanPerMwh: listingPrice.value,
        annualAvgYuanPerMwh: annualAvgFromLibrary.value,
        listingCompare: listingCompare.value ? { diffPct: listingCompare.value.diffPct, verdict: listingCompare.value.verdict } : null,
        timingVerdict: timingVerdict.value ? timingVerdict.value.verdict : null,
        volatility: { changePct: volatilityPct.value, paused: volatility.value.paused },
        kellyCapPct: kelly.value?.capPct ?? null,
        executedRegistered: registerMsg.value ? true : null
      },
      `S6 补仓：${GAP_SUGGESTION_LABEL[a.suggestion]}，${action.value.trim()}`
    )
    emit('updated', updated)
    return '补仓决定已写回，进入 S7 日报收尾'
  })
}

function gapClass(s: GapSuggestion) {
  if (s === 'buy-urgent') return 'urgent'
  if (s === 'buy') return 'buy'
  if (s === 'sell') return 'sell'
  return 'hold'
}
</script>

<template>
  <div class="cg">
    <!-- 上游产出回显 -->
    <section class="cg-upstream">
      <span v-if="forecastFromS3 !== null" class="cg-ok">
        <ArrowDownUp :size="12" /> 预测电量取自 S3：{{ forecastFromS3.toFixed(1) }} MWh
      </span>
      <span v-else class="cg-warn">
        S3 未产出预测——电量需手填。
        <button type="button" class="cg-jump" @click="emit('go', 'direction')">回 S3 补</button>
      </span>
      <span v-if="regime">
        S2 态势：<strong>{{ REGIME_LABEL[regime as keyof typeof REGIME_LABEL] }}</strong>
      </span>
      <span v-else class="cg-warn">S2 未产出态势（按平衡市处理）</span>
      <span v-if="direction">S3 方向：{{ { add: '增持', reduce: '减持', hold: '观望' }[direction] }}</span>
    </section>

    <div class="cg-grid">
      <!-- 输入 -->
      <section class="cg-panel">
        <h3>
          <Wallet :size="14" /> 持仓对照
          <em v-if="clearingPosition" class="cg-pos-auto">
            日前中标 {{ clearingPosition.dayAheadClearedMwh.toFixed(1) }} MWh（S5 自动喂入，不再人工填）
          </em>
          <em v-else class="cg-pos-none">日前中标量未联动——S5 出清分析写回后自动计入持仓视图</em>
                    <button type="button" class="cg-lib-btn" :disabled="contractsBusy" @click="loadContracts">
            <Database :size="12" /> {{ contractsBusy ? '读取中…' : '从公司合同库载入' }}
          </button>
          <em v-if="monthPositionFromLibrary !== null" class="cg-lib-badge">
            库内月度持仓 {{ monthPositionFromLibrary }} MWh（覆盖当月中长期合同按重叠天数/合同天数折算）
          </em>
          <em v-else-if="contractsNote" class="cg-lib-none">{{ contractsNote }}</em>        </h3>
        <div class="cg-fields">
          <label>
            预测电量 MWh
            <input
              v-model.number="forecastInput"
              type="number"
              step="10"
              :disabled="forecastFromS3 !== null"
              :placeholder="forecastFromS3 !== null ? `${forecastFromS3.toFixed(1)}（取自 S3）` : '手填'"
            />
          </label>
          <label>中长期已持仓 MWh<input v-model.number="contractedMwh" type="number" step="10" /></label>
          <label>观望带 ±%<input v-model.number="holdBand" type="number" step="0.01" min="0" max="0.3" /></label>
        </div>
        <p class="cg-tip">
          观望带：|敞口率| 不超过该值不动作（动仓的交易成本大于敞口损益）。口径为买方立场——
          储能/发电立场的补仓逻辑不同，本面板目前只覆盖售电/大用户。
        </p>
      </section>

      <!-- 评估结果 -->
      <section class="cg-panel">
        <h3>
          敞口评估
          <em v-if="assessment.frame === 'seller'" class="cg-frame seller">电厂侧口径：合同电量 − 预测发电（正=合同缺口）</em>
          <em v-else-if="assessment.frame === 'storage'" class="cg-frame storage">储能口径不适用——套利为主，数字仅供参考</em>
          <em v-else class="cg-frame buyer">售电口径：预测 − 持仓（正=缺口）</em>
        </h3>
        <div class="cg-verdict" :class="gapClass(assessment.suggestion)">
          <span class="cg-gap">{{ assessment.gapMwh > 0 ? '缺口' : assessment.gapMwh < 0 ? '超签' : '持平' }}</span>
          <strong>{{ Math.abs(assessment.gapMwh).toFixed(1) }} MWh</strong>
          <span v-if="assessment.gapPct !== null" class="cg-pct">（{{ (assessment.gapPct * 100).toFixed(1) }}%）</span>
          <em class="cg-sugg">{{ GAP_SUGGESTION_LABEL[assessment.suggestion] }}</em>
        </div>
        <p class="cg-reason">{{ assessment.reason }}</p>
      </section>
    </div>

    <!-- 挂牌价 vs 年均价 + 分布时机 + 波动守卫 + 凯利上限（手册 S6 ①② + 异常处理 + 会议凯利红线） -->
    <section class="cg-panel">
      <h3>
        <ArrowDownUp :size="14" /> 挂牌价对比与补仓时机
        <em v-if="kelly" class="cg-kelly">凯利仓位上限 {{ kelly.capPct }}%</em>
      </h3>
      <div class="cg-fields">
        <label>
          挂牌价 元/MWh
          <span class="cg-inline">
            <input
              v-model.number="listingPrice"
              type="number"
              step="0.01"
              @input="listingPriceSource = 'manual'"
            />
            <em class="cg-src">{{ listingPriceSource === 'library' ? '取自合同库月度价' : '人工' }}</em>
          </span>
        </label>
        <label>年度均价（库内年度合同量加权）<input :value="annualAvgFromLibrary ?? ''" readonly placeholder="库内无年度合同" /></label>
        <label>今日价格波动幅度 %<input v-model.number="volatilityPct" type="number" step="0.1" placeholder="人工录入（>5% 触发暂停）" /></label>
      </div>
      <p v-if="kelly" class="cg-tip">{{ kelly.note }}</p>
      <p v-if="listingCompare" class="cg-compare" :class="listingCompare.verdict">{{ listingCompare.hint }}</p>
      <p v-else class="cg-tip">挂牌价或年度均价缺失——对比不成立时按缺口紧迫度单独决策，不硬给价格结论。</p>
      <p v-if="timingVerdict" class="cg-compare" :class="timingVerdict.verdict">{{ timingVerdict.hint }}</p>
      <p v-else class="cg-tip">分布判时机需 S3 概率分布产出（P50 均值/谷/峰）——未产出时不判断时机。</p>
      <p class="cg-vol" :class="{ paused: volatility.paused }"><ShieldAlert :size="12" /> {{ volatility.hint }}</p>
    </section>

    <!-- 实际动作 -->
    <section class="cg-panel">
      <h3>
        补仓执行（建议是建议、执行是执行——分开记，随单据留痕）
        <AiAssistFill
          kind="contract_gap"
          :context="assistContext"
          :field-labels="ASSIST_LABELS"
          label="AI 帮我拟执行方式"
          :disabled-reason="forecastMwh > 0 ? '' : '无有效预测电量，敞口未定'"
          @apply="applyAssist"
        />
      </h3>
      <div v-if="written" class="cg-written">
        已写回：{{ GAP_SUGGESTION_LABEL[written.suggestion as GapSuggestion] }} —— {{ written.action }}
        <em>（{{ written.writtenBy }}）</em>
      </div>
      <div class="cg-action">
        <input v-model="action" type="text" placeholder="如：场内挂牌买入 120 MWh，分两笔" />
        <button type="button" class="cg-btn primary" :disabled="!decl || !actionValid || saving" @click="writeBack">
          <Save :size="13" /> {{ written ? '更新写回' : '写回并进入 S7' }}
        </button>
        <button type="button" class="cg-jump" @click="emit('go', 'daily-close')">跳到 S7 日报收尾</button>
      </div>
      <div class="cg-register">
        <h4>执行落库（手册步骤④：执行后更新合约库、持仓前进）</h4>
        <div class="cg-fields">
          <label>本次执行量 MWh<input v-model.number="executedVolumeMwh" type="number" min="0" step="1" /></label>
          <label>成交价 元/MWh<input v-model.number="executedPriceYuan" type="number" min="0" step="0.01" /></label>
          <button
            type="button"
            class="cg-lib-btn"
            :disabled="registering || executedVolumeMwh === null || executedVolumeMwh <= 0 || executedPriceYuan === null"
            @click="registerToLibrary"
          >
            <Database :size="12" /> {{ registering ? '登记中…' : '登记到公司合同库（月度/挂牌）' }}
          </button>
          <span v-if="registerMsg" class="cg-ok">{{ registerMsg }}</span>
          <span v-if="registerError" class="cg-warn">{{ registerError }}</span>
        </div>
        <p class="cg-tip">登记生成一条月度双边（挂牌）合同记录并自动重载持仓——对方主体与结算条款请在合同管理页补全。</p>
      </div>
      <span v-if="saveMsg" class="cg-ok">{{ saveMsg }}</span>
      <span v-if="saveError" class="cg-err">{{ saveError }}</span>
    </section>
  </div>
</template>

<style scoped>
.cg { display: flex; flex-direction: column; gap: 12px; }
.cg-upstream { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; padding: 8px 12px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; background: #f8fafc; font-size: var(--font-sm); }
.cg-ok { color: #15803d; display: inline-flex; align-items: center; gap: 4px; }
.cg-warn { color: #b45309; display: inline-flex; align-items: center; gap: 4px; }
.cg-jump { padding: 0; border: none; background: none; color: #1d4ed8; font: inherit; font-size: var(--font-sm); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }

.cg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
.cg-panel { padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.cg-panel h3 { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; margin: 0 0 8px; font-size: var(--font-md); }

.cg-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 6px 10px; }
.cg-fields label { display: flex; flex-direction: column; gap: 2px; font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); }
.cg-fields input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-sm); }
.cg-fields input:disabled { background: #f1f5f9; color: #475569; }
.cg-tip { margin: 8px 0 0; font-size: var(--font-xs); line-height: 1.6; color: var(--el-text-color-secondary, #667); }

.cg-verdict { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; padding: 10px 12px; border-radius: 8px; border: 1px solid; }
.cg-verdict.urgent { border-color: #fca5a5; background: #fef2f2; }
.cg-verdict.buy { border-color: #fcd34d; background: #fffbeb; }
.cg-verdict.sell { border-color: #c4b5fd; background: #f5f3ff; }
.cg-verdict.hold { border-color: #86efac; background: #f0fdf4; }
.cg-gap { font-size: var(--font-sm); color: var(--el-text-color-secondary, #667); }
.cg-verdict strong { font-size: var(--font-22); font-variant-numeric: tabular-nums; }
.cg-pct { font-size: var(--font-sm); color: var(--el-text-color-secondary, #667); }
.cg-sugg { margin-left: auto; padding: 3px 12px; border-radius: 9px; background: rgba(255,255,255,.7); font-style: normal; font-size: var(--font-md); font-weight: 600; }
.cg-reason { margin: 8px 0 0; font-size: var(--font-sm); line-height: 1.7; }

.cg-written { margin-bottom: 8px; padding: 6px 10px; border-radius: 6px; background: #f0fdf4; color: #166534; font-size: var(--font-sm); }
.cg-written em { font-style: normal; color: #4d7c0f; }
.cg-action { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cg-action input { flex: 1; min-width: 280px; padding: 5px 8px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-sm); }
.cg-btn { padding: 5px 14px; border: 1px solid #2563eb; border-radius: 6px; background: #eff6ff; color: #1d4ed8; font-size: var(--font-sm); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.cg-btn.primary { background: #2563eb; color: #fff; }
.cg-btn:disabled { opacity: .45; cursor: not-allowed; }
.cg-ok { font-size: var(--font-sm); color: #15803d; }
.cg-err { font-size: var(--font-sm); color: #b91c1c; }
.cg-pos-auto { font-style: normal; font-size: var(--font-10); color: #047857; }
.cg-pos-none { font-style: normal; font-size: var(--font-10); color: #b45309; }
.cg-lib-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border: 1px solid #7c3aed; border-radius: 5px; background: #f5f3ff; color: #6d28d9; font-size: var(--font-xs); cursor: pointer; }
.cg-lib-btn:disabled { opacity: .5; cursor: wait; }
.cg-lib-badge { font-style: normal; font-size: var(--font-10); color: #6d28d9; }
.cg-lib-none { font-style: normal; font-size: var(--font-10); color: #b45309; }
.cg-inline { display: inline-flex; align-items: center; gap: 5px; }
.cg-src { font-style: normal; font-size: var(--font-10); color: var(--el-text-color-secondary, #889); }
.cg-compare { margin: 6px 0 0; padding: 6px 10px; border-radius: 6px; font-size: var(--font-sm); line-height: 1.6; background: #f8fafc; }
.cg-compare.below, .cg-compare.lock_now { background: #f0fdf4; color: #166534; }
.cg-compare.above, .cg-compare.wait { background: #fffbeb; color: #92400e; }
.cg-compare.comparable, .cg-compare.neutral { background: #f8fafc; color: #475569; }
.cg-vol { display: flex; align-items: center; gap: 5px; margin: 8px 0 0; padding: 6px 10px; border-radius: 6px; font-size: var(--font-xs); background: #f8fafc; color: #475569; }
.cg-vol.paused { background: #fef2f2; color: #991b1b; font-weight: 600; }
.cg-kelly { margin-left: auto; font-style: normal; font-size: var(--font-10); color: #92400e; }
.cg-register { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--el-border-color, #dcdfe6); }
.cg-register h4 { margin: 0 0 6px; font-size: var(--font-sm); }
.cg-frame { margin-left: auto; font-style: normal; font-size: var(--font-10); padding: 1px 8px; border-radius: 8px; }
.cg-frame.buyer { background: #eff6ff; color: #1d4ed8; }
.cg-frame.seller { background: #fef3c7; color: #92400e; }
.cg-frame.storage { background: #f5f3ff; color: #6d28d9; }@media (max-width: 760px) {
  .cg-grid { grid-template-columns: 1fr; }
  .cg-table, table { display: block; overflow-x: auto; }
}
</style>
