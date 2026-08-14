<script setup lang="ts">
// S6 中长期补仓（15:00–16:30，低频）—— 决策 + 行动
//
// 现货日内的最后一块决策：中长期持仓覆盖到没有问题？口径为买方立场（售电/大用户），
// 缺口敞在现货上结算。建议核心只有一句话——**缺口敞在贵的现货上要赶紧补，敞在便宜的
// 现货上可以故意留着**；超签反过来。
//
// 三处上游产出自动喂进本面板：
//   · S3 申报曲线合计 → 预测电量（缺则手填）；
//   · S2 主导态势 → 现货贵不贵的判据；
//   · S3 方向 → 两可情形下（现货便宜却判增持、现货贵却判减持）的拍板。
// 三者缺席时按平衡市处理并在理由里写明——不假装有判断。结论写回 preflight.contract。
import { computed, ref, watch } from 'vue'
import { Save, Wallet, ArrowDownUp } from 'lucide-vue-next'
import {
  GAP_SUGGESTION_LABEL,
  assessContractGap,
  type GapSuggestion
} from '@/services/trading/contractGap'
import { REGIME_LABEL } from 'shared/trading-rules/supply-demand.mjs'
import { savePreflight, type DeclarationOrder } from '@/services/declarations'
import AiAssistFill from '@/components/trading/AiAssistFill.vue'
import type { StageId } from '@/data/workflowStages'

const props = defineProps<{ declaration: DeclarationOrder | null; targetDate: string }>()
const emit = defineEmits<{ updated: [d: DeclarationOrder]; go: [stage: StageId] }>()

const decl = computed(() => props.declaration)
const pf = computed(() => decl.value?.preflight ?? {})

// ── 上游产出 ────────────────────────────────────────────────────────────────
const forecastFromS3 = computed(() =>
  pf.value.forecast ? pf.value.forecast.curveMwh96.reduce((a, b) => a + b, 0) : null
)
const regime = computed(() => (pf.value.dataGate?.regime ?? null) as string | null)
const direction = computed(() => (pf.value.forecast?.direction ?? null) as 'add' | 'reduce' | 'hold' | null)

// ── 输入（缺上游产出时手填）──────────────────────────────────────────────────
const forecastInput = ref<number>(0)
const forecastMwh = computed(() => forecastFromS3.value ?? forecastInput.value)

// ── 持仓视图（F4.2 联动）：日前中标量由 S5 写回自动喂入，不再人工填 ──────────
const clearingPosition = computed(() => props.declaration?.preflight?.clearingReview?.positionUpdate ?? null)
const contractedMwh = ref<number>(0)
const holdBand = ref(0.05)

watch(forecastFromS3, (v) => { if (v !== null) forecastInput.value = 0 }, { immediate: true })

const assessment = computed(() =>
  assessContractGap({
    forecastMwh: forecastMwh.value,
    contractedMwh: contractedMwh.value,
    regime: regime.value as Parameters<typeof assessContractGap>[0]['regime'],
    direction: direction.value,
    holdBand: holdBand.value
  })
)

// ── 实际动作录入（建议是建议、执行是执行——分开记）──────────────────────────
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

// ── AI 辅助填报：**只辅助"执行方式"这一项人工判断**────────────────────────────
// 边界拿捏：敞口量、敞口率、建议方向（急补/择机补/观望/转让）都是 assessContractGap
// 规则引擎算出来的确定性结果，不需要也不应该让 AI 重判；真正需要经验的是
// "具体怎么执行"——一次挂牌还是分批、挂什么价位区间、什么条件下暂停。
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

// ── 写回 ────────────────────────────────────────────────────────────────────
const saving = ref(false)
const saveMsg = ref('')
const saveError = ref('')
const written = computed(() => pf.value.contract ?? null)

async function writeBack() {
  if (!decl.value || !actionValid.value) return
  saving.value = true
  saveMsg.value = ''
  saveError.value = ''
  try {
    const a = assessment.value
    const updated = await savePreflight(
      decl.value.id,
      'contract',
      {
        gapMwh: a.gapMwh,
        gapPct: a.gapPct,
        suggestion: a.suggestion,
        action: action.value.trim(),
        reason: a.reason
      },
      `S6 补仓：${GAP_SUGGESTION_LABEL[a.suggestion]}，${action.value.trim()}`
    )
    emit('updated', updated)
    saveMsg.value = '补仓决定已写回，进入 S7 日报收尾'
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : '写回失败'
  } finally {
    saving.value = false
  }
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
        </h3>
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
        <h3>敞口评估</h3>
        <div class="cg-verdict" :class="gapClass(assessment.suggestion)">
          <span class="cg-gap">{{ assessment.gapMwh > 0 ? '缺口' : assessment.gapMwh < 0 ? '超签' : '持平' }}</span>
          <strong>{{ Math.abs(assessment.gapMwh).toFixed(1) }} MWh</strong>
          <span v-if="assessment.gapPct !== null" class="cg-pct">（{{ (assessment.gapPct * 100).toFixed(1) }}%）</span>
          <em class="cg-sugg">{{ GAP_SUGGESTION_LABEL[assessment.suggestion] }}</em>
        </div>
        <p class="cg-reason">{{ assessment.reason }}</p>
      </section>
    </div>

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
      <span v-if="saveMsg" class="cg-ok">{{ saveMsg }}</span>
      <span v-if="saveError" class="cg-err">{{ saveError }}</span>
    </section>
  </div>
</template>

<style scoped>
.cg { display: flex; flex-direction: column; gap: 12px; }
.cg-upstream { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; padding: 8px 12px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; background: #f8fafc; font-size: 12px; }
.cg-ok { color: #15803d; display: inline-flex; align-items: center; gap: 4px; }
.cg-warn { color: #b45309; display: inline-flex; align-items: center; gap: 4px; }
.cg-jump { padding: 0; border: none; background: none; color: #1d4ed8; font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }

.cg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
.cg-panel { padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.cg-panel h3 { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; margin: 0 0 8px; font-size: 13px; }

.cg-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 6px 10px; }
.cg-fields label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--el-text-color-secondary, #667); }
.cg-fields input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; }
.cg-fields input:disabled { background: #f1f5f9; color: #475569; }
.cg-tip { margin: 8px 0 0; font-size: 11px; line-height: 1.6; color: var(--el-text-color-secondary, #667); }

.cg-verdict { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; padding: 10px 12px; border-radius: 8px; border: 1px solid; }
.cg-verdict.urgent { border-color: #fca5a5; background: #fef2f2; }
.cg-verdict.buy { border-color: #fcd34d; background: #fffbeb; }
.cg-verdict.sell { border-color: #c4b5fd; background: #f5f3ff; }
.cg-verdict.hold { border-color: #86efac; background: #f0fdf4; }
.cg-gap { font-size: 12px; color: var(--el-text-color-secondary, #667); }
.cg-verdict strong { font-size: 22px; font-variant-numeric: tabular-nums; }
.cg-pct { font-size: 12px; color: var(--el-text-color-secondary, #667); }
.cg-sugg { margin-left: auto; padding: 3px 12px; border-radius: 9px; background: rgba(255,255,255,.7); font-style: normal; font-size: 13px; font-weight: 600; }
.cg-reason { margin: 8px 0 0; font-size: 12px; line-height: 1.7; }

.cg-written { margin-bottom: 8px; padding: 6px 10px; border-radius: 6px; background: #f0fdf4; color: #166534; font-size: 12px; }
.cg-written em { font-style: normal; color: #4d7c0f; }
.cg-action { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cg-action input { flex: 1; min-width: 280px; padding: 5px 8px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; }
.cg-btn { padding: 5px 14px; border: 1px solid #2563eb; border-radius: 6px; background: #eff6ff; color: #1d4ed8; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.cg-btn.primary { background: #2563eb; color: #fff; }
.cg-btn:disabled { opacity: .45; cursor: not-allowed; }
.cg-ok { font-size: 12px; color: #15803d; }
.cg-err { font-size: 12px; color: #b91c1c; }
</style>
