<script setup lang="ts">
// S3 方向判断（09:30–10:30）—— 把 S2 的市场判断变成一个可执行的方向决策
//
// 内在逻辑是一条**判据递进链**：
//   S2 市场判断（松紧+价格中枢）→ 预期价差 ΔP（人拍板，可参考 ML 价格预测）
//   → R4 规则表（ΔP × 置信度 × S2 数据暴露系数）→ 偏置档位 → 申报曲线 = 预测负荷 × (1+偏置)。
// 偏置档位不由人拍脑袋：S2 门禁落「可参考」时暴露系数 0.5，偏置自动减半；「仅展示」强制归零
// ——上一步的数据口径**机械地**约束这一步敢押多大。
//
// 曲线生成分两层（此前只有 ①，被指"固化"——正解是把 ② 接上，而非让 ① 更花哨）：
//   ① 形态模板（双峰/平坦/夜间）：无预测数据时的兜底出发点，总量守恒；
//   ② ML 价格预测参考 + AI 建议：复用申报工作台同一套 /agent-api 预测端点，
//      预测数值先算好，AI 只解释"为什么这样建议"，采纳与否由人点按钮。
//
// 方向与价差的号位一致性有校验：判「增持」（预期实时价高于日前）却填负价差，
// 说明两处有一处想错了，界面拦下来让人先想清楚。
import { computed, ref } from 'vue'
import { Compass, LineChart, Save, Sparkles, TriangleAlert } from 'lucide-vue-next'
import { decideBias } from 'shared/trading-rules/demand-bias.mjs'
import { exposureFactorOf, USAGE_GATE_LABEL } from 'shared/trading-rules/data-integrity.mjs'
import { REGIME_LABEL } from 'shared/trading-rules/supply-demand.mjs'
import { savePreflight, type DeclarationOrder } from '@/services/declarations'
import { applyBias, buildLoadCurve96, LOAD_SHAPE_LABEL, type LoadShapeId } from '@/services/trading/loadShape'
import { runForecastPredict, unavailableReasonOf, type ForecastResult } from '@/services/forecast/mlForecastClient'
import { currentRegion } from '@/services/region/regionContext'
import AgentChatPanel from '@/components/agent/AgentChatPanel.vue'
import AiAssistFill from '@/components/trading/AiAssistFill.vue'
import type { StageId } from '@/data/workflowStages'

const props = defineProps<{ declaration: DeclarationOrder | null; targetDate: string }>()
const emit = defineEmits<{ updated: [d: DeclarationOrder]; go: [stage: StageId] }>()

// ── 上游产出：S2 市场判断 ───────────────────────────────────────────────────
const upstream = computed(() => props.declaration?.preflight?.dataGate ?? null)
const exposureFactor = computed(() =>
  upstream.value ? exposureFactorOf(upstream.value.gate as Parameters<typeof exposureFactorOf>[0]) : 0.5
)

// ── 方向决策输入 ────────────────────────────────────────────────────────────
type Direction = 'add' | 'reduce' | 'hold'
const DIRECTION_LABEL: Record<Direction, string> = { add: '增持', reduce: '减持', hold: '观望' }
const DIRECTION_NOTE: Record<Direction, string> = {
  add: '预期实时价高于日前 → 日前多报锁量',
  reduce: '预期实时价低于日前 → 日前少报、留量吃实时',
  hold: '无足够把握 → 按预测原样申报，不加偏置'
}

const direction = ref<Direction>('hold')
const priceSpread = ref(0) // 预期 ΔP = 实时 − 日前（元/MWh），号位与方向须一致
const confidence = ref(60)
const rationale = ref('')
const rationaleValid = computed(() => rationale.value.trim().length >= 8)

/** 方向与价差号位一致性：判增持却填负价差（或反之），必有一处想错了。 */
const signConflict = computed(() => {
  if (direction.value === 'add') return priceSpread.value <= 0
  if (direction.value === 'reduce') return priceSpread.value >= 0
  return false
})

/** R4 偏置：观望强制零偏置；增持/减持按规则表 + 暴露系数裁剪。 */
const bias = computed(() => {
  if (direction.value === 'hold' || signConflict.value) {
    return { biasRatio: 0, tableRatio: 0, confidence: 'low' as const, reason: direction.value === 'hold' ? '观望：不加偏置，按预测原样申报' : '方向与价差号位冲突，偏置不生效' }
  }
  return decideBias({
    priceSpreadYuanPerMwh: priceSpread.value,
    confidenceScore: confidence.value,
    managementBand: 0.2,
    exposureFactor: exposureFactor.value
  })
})

// ── 申报曲线生成 ────────────────────────────────────────────────────────────
const totalMwh = ref(960)
const shape = ref<LoadShapeId>('double-peak')
const SHAPES = Object.keys(LOAD_SHAPE_LABEL) as LoadShapeId[]

const baseCurve = computed(() => buildLoadCurve96(totalMwh.value, shape.value))
const declaredCurve = computed(() => applyBias(baseCurve.value, bias.value.biasRatio))
const declaredTotal = computed(() => declaredCurve.value.reduce((a, b) => a + b, 0))

// ── ML 价格预测参考（复用申报工作台同一套 /agent-api 预测端点）─────────────
// 用途：给「预期价差 ΔP」提供数值参照——预测的日内价格形态（峰谷分布、均值）是
// 判断"实时会比日前高还是低"的输入之一。诚实标注：预测服务不在线/数据不可用时
// 显示原因，不编数字。
const forecast = ref<ForecastResult | null>(null)
const forecastLoading = ref(false)
const forecastError = ref('')

async function loadForecast() {
  forecastLoading.value = true
  forecastError.value = ''
  forecast.value = null
  try {
    const r = await runForecastPredict({
      region_id: currentRegion.value.id,
      target: 'price',
      target_date: props.targetDate
    })
    if (r?.unavailable_reason || r?.unavailableReason) {
      forecastError.value = `预测不可用：${unavailableReasonOf(r)}`
    } else {
      forecast.value = r
    }
  } catch (e) {
    forecastError.value = e instanceof Error ? e.message : '预测服务不可达（agent-backend 8000 未起？）'
  } finally {
    forecastLoading.value = false
  }
}

/** 预测曲线摘要（给人看 + 注入 AI）：均值、峰段均值、谷段均值、峰谷差。 */
const forecastDigest = computed(() => {
  const pts: number[] = (forecast.value as unknown as { points?: Array<{ value?: number }> })?.points
    ?.map((p) => Number(p?.value)).filter((v: number) => Number.isFinite(v)) ?? []
  if (pts.length < 24) return null
  const mean = pts.reduce((a, b) => a + b, 0) / pts.length
  const per = Math.floor(pts.length / 24)
  const hourAvg = Array.from({ length: 24 }, (_, h) =>
    pts.slice(h * per, (h + 1) * per).reduce((a, b) => a + b, 0) / per)
  const peak = Math.max(...hourAvg)
  const valley = Math.min(...hourAvg)
  const peakHour = hourAvg.indexOf(peak)
  const valleyHour = hourAvg.indexOf(valley)
  return {
    mean: Math.round(mean), peak: Math.round(peak), valley: Math.round(valley),
    peakHour, valleyHour, spread: Math.round(peak - valley)
  }
})

// ── AI 建议（判据先算好，AI 解释与建议，人拍板采纳）──────────────────────────
// 注入：S2 判断 + R4 规则表机制 + ML 预测摘要 + 当前人选方向。AI 给出「建议方向 +
// 建议 ΔP 区间 + 理由」，人看后自己改输入框——AI 不直接改任何表单值。
const aiOpen = ref(false)
const aiContext = computed(() => ({
  targetDate: props.targetDate,
  s2Judgement: upstream.value ? {
    regime: upstream.value.regime, priceCenterLow: upstream.value.priceCenterLow,
    priceCenterHigh: upstream.value.priceCenterHigh, gate: upstream.value.gate
  } : null,
  mlPriceForecast: forecastDigest.value,
  mlForecastUnavailable: forecastError.value || null,
  currentInput: { direction: direction.value, priceSpread: priceSpread.value, confidence: confidence.value },
  biasRule: '偏置 = R4 规则表(ΔP×置信度) × 暴露系数(S2 门禁: 可申报1/可参考0.5/仅展示0)，管理带 ±20%',
  exposureFactor: exposureFactor.value
}))
// ── AI 辅助填报：方向/ΔP/置信度/理由四项都是**人工经验判断**（无数据库可查）────
// 复用同一份上下文（S2 判断 + ML 预测摘要 + R4 机制），产出结构化建议供一键采纳。
const ASSIST_LABELS = {
  direction: '方向', priceSpread: '预期价差 ΔP', confidence: '置信度', rationale: '决策理由'
}
function applyAssist(s: Record<string, unknown>) {
  if (s.direction === 'add' || s.direction === 'reduce' || s.direction === 'hold') direction.value = s.direction
  if (typeof s.priceSpread === 'number' && Number.isFinite(s.priceSpread)) priceSpread.value = s.priceSpread
  if (typeof s.confidence === 'number' && Number.isFinite(s.confidence)) {
    confidence.value = Math.max(0, Math.min(100, Math.round(s.confidence)))
  }
  if (typeof s.rationale === 'string' && s.rationale.trim()) rationale.value = s.rationale.trim()
}

const aiQuestion = computed(() =>
  `请基于注入上下文给出 S3 方向判断建议。S2 市场判断与 ML 价格预测摘要（如有）已是算好的结果，` +
  `不得改数字。请回答：① 建议方向（增持/减持/观望）及理由——把 S2 松紧、预测峰谷形态、` +
  `与当前人选方向的分歧讲清楚；② 建议的预期价差 ΔP 区间（元/MWh）与置信度，说明依据；` +
  `③ 该建议在 R4 规则表下大约落什么偏置档位；④ 反对意见：什么情形下该建议会错。` +
  `你只建议，采纳与否由交易员自己改左侧输入框。`
)

// ── 写回 ────────────────────────────────────────────────────────────────────
const saving = ref(false)
const saveMsg = ref('')
const saveError = ref('')
const written = computed(() => props.declaration?.preflight?.forecast ?? null)

async function writeBack() {
  if (!props.declaration || !rationaleValid.value || signConflict.value) return
  saving.value = true
  saveMsg.value = ''
  saveError.value = ''
  try {
    const updated = await savePreflight(
      props.declaration.id,
      'forecast',
      {
        curveMwh96: declaredCurve.value,
        source: 'S3-direction',
        direction: direction.value,
        confidence: confidence.value,
        biasRatio: bias.value.biasRatio,
        rationale: rationale.value.trim()
      },
      `S3 方向判断：${DIRECTION_LABEL[direction.value]}（置信 ${confidence.value}），偏置 ${(bias.value.biasRatio * 100).toFixed(1)}%`
    )
    emit('updated', updated)
    saveMsg.value = '方向与申报曲线已写回，S4 申报执行可一键套用'
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : '写回失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="dr">
    <!-- 上游判断 -->
    <section v-if="upstream?.regime" class="dr-upstream">
      <Compass :size="13" />
      S2 市场判断：<strong>{{ REGIME_LABEL[upstream.regime as keyof typeof REGIME_LABEL] }}</strong>
      <span v-if="upstream.priceCenterLow != null">，均价指引 {{ upstream.priceCenterLow }}–{{ upstream.priceCenterHigh }} 元/MWh</span>
      · 数据门禁 {{ USAGE_GATE_LABEL[upstream.gate as keyof typeof USAGE_GATE_LABEL] }} → 暴露系数
      <strong>{{ exposureFactor }}</strong>
      <template v-if="exposureFactor === 0.5">（偏置自动减半）</template>
      <template v-else-if="exposureFactor === 0">（偏置强制归零）</template>
    </section>
    <section v-else class="dr-upstream warn">
      <TriangleAlert :size="13" />
      S2 早间分析尚未产出市场判断——方向决策没有依据，暴露系数按 0.5 保守处理。建议
      <button type="button" class="dr-jump" @click="emit('go', 'market-analysis')">先回 S2 完成分析</button>。
    </section>

    <div class="dr-grid">
      <!-- 方向决策 -->
      <section class="dr-panel">
        <h3>
          方向决策
          <AiAssistFill
            kind="direction"
            :context="aiContext"
            :field-labels="ASSIST_LABELS"
            label="AI 帮我判断方向"
            @apply="applyAssist"
          />
        </h3>
        <div class="dr-directions">
          <label v-for="(label, key) in DIRECTION_LABEL" :key="key" :class="{ on: direction === key }">
            <input v-model="direction" type="radio" :value="key" />
            <strong>{{ label }}</strong>
            <em>{{ DIRECTION_NOTE[key] }}</em>
          </label>
        </div>
        <div class="dr-fields">
          <label>
            预期价差 ΔP（实时−日前，元/MWh）
            <input v-model.number="priceSpread" type="number" step="5" :disabled="direction === 'hold'" />
          </label>
          <label>
            置信度（0–100）
            <input v-model.number="confidence" type="number" min="0" max="100" :disabled="direction === 'hold'" />
          </label>
        </div>
        <p v-if="signConflict" class="dr-conflict">
          方向与价差号位冲突：{{ DIRECTION_LABEL[direction] }}对应
          {{ direction === 'add' ? '正' : '负' }}价差，当前填了 {{ priceSpread }}。两处必有一处想错了。
        </p>
        <label class="dr-rationale">
          决策理由（≥8 字，须可追溯到具体数值；随单据留痕，监管质询时是自证材料）
          <input v-model="rationale" type="text" placeholder="如：高峰供需比 1.04 逼近紧张档，预计实时高于日前 60 元" />
        </label>

        <div class="dr-bias" :class="{ zero: bias.biasRatio === 0 }">
          R4 偏置档位：<strong>{{ (bias.biasRatio * 100).toFixed(1) }}%</strong>
          <template v-if="bias.tableRatio !== bias.biasRatio">
            （规则表 {{ (bias.tableRatio * 100).toFixed(1) }}% × 暴露系数 {{ exposureFactor }}）
          </template>
          <em>{{ bias.reason }}</em>
        </div>
      </section>

      <!-- 申报曲线 -->
      <section class="dr-panel">
        <h3>申报曲线（预测 × 偏置）</h3>
        <div class="dr-fields">
          <label>日预测电量 MWh<input v-model.number="totalMwh" type="number" step="10" /></label>
          <label>
            负荷形态
            <select v-model="shape">
              <option v-for="s in SHAPES" :key="s" :value="s">{{ LOAD_SHAPE_LABEL[s] }}</option>
            </select>
          </label>
        </div>
        <p class="dr-curve-sum">
          基准 {{ totalMwh }} MWh → 申报 <strong>{{ declaredTotal.toFixed(1) }}</strong> MWh
          （偏置 {{ (bias.biasRatio * 100).toFixed(1) }}%）· 96 点，形态生成后可在 S4 逐点微调
        </p>
        <div class="dr-spark">
          <span
            v-for="(v, i) in declaredCurve.filter((_, idx) => idx % 4 === 0)"
            :key="i"
            class="dr-bar"
            :style="{ height: `${Math.max(4, (v / Math.max(...declaredCurve, 0.001)) * 46)}px` }"
            :title="`${String(i).padStart(2, '0')}:00 ≈ ${(v * 4).toFixed(1)} MW`"
          />
        </div>
        <p class="dr-tip">
          预览为逐小时抽样（悬停看功率）。形态模板是兜底出发点（总量守恒）；下方 ML 价格预测
          与 AI 建议给"往哪偏、偏多少"提供参照，S4 还可逐点微调。
        </p>

        <!-- ML 价格预测参考：与申报工作台同一套 /agent-api 预测端点 -->
        <h3><LineChart :size="13" /> ML 价格预测参考</h3>
        <div class="dr-forecast">
          <button type="button" class="dr-fc-btn" :disabled="forecastLoading" @click="loadForecast">
            {{ forecastLoading ? '预测中…' : `跑 ${targetDate} 价格预测` }}
          </button>
          <span v-if="forecastError" class="dr-err">{{ forecastError }}</span>
          <template v-else-if="forecastDigest">
            <span>均值 <strong>{{ forecastDigest.mean }}</strong></span>
            <span>峰 <strong>{{ forecastDigest.peak }}</strong>（{{ forecastDigest.peakHour }} 时）</span>
            <span>谷 <strong>{{ forecastDigest.valley }}</strong>（{{ forecastDigest.valleyHour }} 时）</span>
            <span>峰谷差 <strong>{{ forecastDigest.spread }}</strong> 元/MWh</span>
          </template>
          <span v-else-if="!forecastLoading" class="dr-muted">
            未跑——预测数值可作为「预期价差 ΔP」的参照（需 agent-backend 8000 在线）
          </span>
        </div>
      </section>
    </div>

    <!-- AI 建议：判据先算好（S2 判断 + ML 预测摘要 + R4 机制），AI 只解释与建议，人拍板 -->
    <details class="dr-ai" :open="aiOpen" @toggle="aiOpen = ($event.target as HTMLDetailsElement).open">
      <summary>
        <Sparkles :size="13" /> AI 方向与曲线建议
        <em>注入 S2 判断 + ML 预测摘要 + R4 规则机制；AI 给建议方向/ΔP 区间/反对意见，不改你的输入——采纳自己改</em>
      </summary>
      <AgentChatPanel
        v-if="aiOpen"
        scenario="declaration_prep"
        :initial-question="aiQuestion"
        :context-payload="aiContext"
        history-key="s3_direction_advice"
      />
    </details>

    <div class="dr-actions">
      <button
        type="button"
        class="primary"
        :disabled="!declaration || !rationaleValid || signConflict || saving"
        @click="writeBack"
      >
        <Save :size="13" /> {{ written ? '更新写回' : '写回并进入 S4 申报执行' }}
      </button>
      <button type="button" class="ghost" @click="emit('go', 'declare')">跳到 S4 申报执行</button>
      <span v-if="saveMsg" class="dr-ok">{{ saveMsg }}</span>
      <span v-if="saveError" class="dr-err">{{ saveError }}</span>
      <span v-if="written" class="dr-ok">
        已写回：{{ DIRECTION_LABEL[(written.direction ?? 'hold') as Direction] }}
        · 申报合计 {{ written.curveMwh96.reduce((a, b) => a + b, 0).toFixed(1) }} MWh（{{ written.writtenBy }}）
      </span>
    </div>
  </div>
</template>

<style scoped>
.dr { display: flex; flex-direction: column; gap: 12px; }
.dr-upstream { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 12px; border: 1px solid #bfdbfe; border-radius: 8px; background: #f8fbff; font-size: 12px; }
.dr-upstream.warn { border-color: #fcd34d; background: #fffbeb; color: #92400e; }
.dr-jump { padding: 0; border: none; background: none; color: #1d4ed8; font: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }

.dr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 12px; }
.dr-panel { padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.dr-panel h3 { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; margin: 0 0 8px; font-size: 13px; }

.dr-directions { display: flex; gap: 8px; flex-wrap: wrap; }
.dr-directions label { flex: 1; min-width: 150px; display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 8px; cursor: pointer; font-size: 12px; }
.dr-directions label.on { border-color: #2563eb; background: #eff6ff; }
.dr-directions input { display: none; }
.dr-directions em { font-style: normal; font-size: 10px; line-height: 1.5; color: var(--el-text-color-secondary, #667); }

.dr-fields { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 10px; }
.dr-fields label { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--el-text-color-secondary, #667); }
.dr-fields input, .dr-fields select { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; }

.dr-conflict { margin: 8px 0 0; padding: 6px 10px; border-radius: 6px; background: #fef2f2; color: #991b1b; font-size: 12px; }
.dr-rationale { display: flex; flex-direction: column; gap: 3px; margin-top: 10px; font-size: 11px; color: var(--el-text-color-secondary, #667); }
.dr-rationale input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; }

.dr-bias { margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: #eff6ff; font-size: 12px; }
.dr-bias.zero { background: #f8fafc; }
.dr-bias em { display: block; margin-top: 2px; font-style: normal; font-size: 11px; color: var(--el-text-color-secondary, #667); }

.dr-curve-sum { margin: 8px 0; font-size: 12px; font-variant-numeric: tabular-nums; }
.dr-spark { display: flex; align-items: flex-end; gap: 2px; height: 50px; padding: 2px 0; }
.dr-bar { flex: 1; background: #93c5fd; border-radius: 1px 1px 0 0; }
.dr-tip { margin: 6px 0 0; font-size: 11px; line-height: 1.6; color: var(--el-text-color-secondary, #667); }

.dr-forecast { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12px; font-variant-numeric: tabular-nums; }
.dr-fc-btn { padding: 4px 12px; border: 1px solid #059669; border-radius: 5px; background: #ecfdf5; color: #047857; font-size: 12px; cursor: pointer; }
.dr-fc-btn:disabled { opacity: .5; cursor: wait; }
.dr-muted { font-size: 11px; color: var(--el-text-color-secondary, #667); }

.dr-ai { border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; padding: 8px 12px; }
.dr-ai summary { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; cursor: pointer; flex-wrap: wrap; }
.dr-ai summary em { font-style: normal; font-weight: 400; font-size: 10px; color: var(--el-text-color-secondary, #889); }
.dr-ai[open] summary { margin-bottom: 8px; }

.dr-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dr-actions .primary { display: inline-flex; align-items: center; gap: 5px; padding: 5px 14px; border: 1px solid #2563eb; border-radius: 6px; background: #2563eb; color: #fff; font-size: 12px; cursor: pointer; }
.dr-actions .primary:disabled { opacity: .45; cursor: not-allowed; }
.dr-actions .ghost { padding: 5px 12px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: 12px; cursor: pointer; }
.dr-ok { font-size: 12px; color: #15803d; }
.dr-err { font-size: 12px; color: #b91c1c; }
</style>
