<script setup lang="ts">
import HedgeHint from '../HedgeHint.vue'

// 套保工作台「方案对比预览」面板（openspec build-midlong-spot-hedging HB-05；ChenShi-Tech/dljy#3422）。
//
// 纯前端预览：用 shared 的 compareSchemes 对预置（保守/均衡/灵活）与自定义方案逐一判级，
// 数据只来自试算响应里已返回的套保率（正式口径 before 与试算后各一组）——本组件不 import 任何取数函数、
// 不发任何请求、不改变生效方案，也不影响风控面板与智能体看到的判级。
// 非标准窗口（既不是 T 的今明两日、也不是 T 所在整月）不判级，如实说明（HB-02）。
import { computed, ref } from 'vue'
import {
  ASSESSMENT_LEVEL_LABELS, ASSESSMENT_REASON_LABELS, BAND_BASIS_LABELS, BAND_TIERS, BAND_TIER_LABELS,
  STANDARD_METRIC_LABELS, compareSchemeRows, customSchemeFrom, formatPercent, presetSchemes,
} from '@/services/hedge/hedgeSimulateModel'
import type { CompareScheme, HedgeSimulationResult, SchemeAssessment, SchemeCompareRow } from '@/services/hedge/hedgeSimulateModel'
import { STANDARD_METRIC_RULE } from '@/services/hedge/hedgeSimulateModel'
import { emptyTierDraft } from '@/services/hedge/hedgeMaintenanceModel'
import type { BandBasis, BandTier, FieldFailure, TierDraft } from '@/services/hedge/hedgeMaintenanceModel'

const props = defineProps<{
  /** 试算响应（正式口径 before + 试算后）；null = 尚未试算。 */
  result: HedgeSimulationResult | null
  /** 当前窗口对应的标准指标；null = 非标准窗口（不判级）。 */
  metric: 'TODAY2_INTERVAL' | 'MONTH_INTERVAL' | null
}>()

const metricLabel = computed(() => (props.metric ? STANDARD_METRIC_LABELS[props.metric] : ''))
const metricTier = computed<BandTier | null>(() => {
  const rule = props.metric ? STANDARD_METRIC_RULE[props.metric] : null
  const tier = rule?.tier
  return typeof tier === 'string' ? tier as BandTier : null
})

// ── 自定义方案（HB-03 同一套校验；只在本地草稿里，不落库）────────────────────

const customDraft = ref<TierDraft>(emptyTierDraft())
const customBasis = ref<BandBasis>('WITH_MECHANISM')
const BASIS_OPTIONS = Object.entries(BAND_BASIS_LABELS) as Array<[BandBasis, string]>
const SIDES = ['lower', 'upper'] as const

const customResult = computed(() => customSchemeFrom(customDraft.value, customBasis.value))
const customError = computed<FieldFailure | null>(() => (customResult.value.ok ? null : { field: customResult.value.field, message: customResult.value.message }))

const schemes = computed<CompareScheme[]>(() => {
  const custom = customResult.value
  return [...presetSchemes(), ...(custom.ok ? [custom.scheme] : [])]
})

const beforeRows = computed<SchemeCompareRow[]>(() => compareSchemeRows(schemes.value, props.result?.before.ratio ?? null, props.metric))
const afterRows = computed<SchemeCompareRow[]>(() => compareSchemeRows(schemes.value, props.result?.ratio ?? null, props.metric))

// ── 展示 ──────────────────────────────────────────────────────────────────────

const ratioLines = computed(() => {
  if (!props.result) return []
  const line = (label: string, ratio: typeof props.result.ratio) => {
    if (!ratio) return null
    const fmt = (value: string | null) => (value === null ? '不可计算' : formatPercent(value))
    return `${label}：含机制 ${fmt(ratio.withMechanism.value)}· 仅中长期 ${fmt(ratio.midlongOnly.value)}`
  }
  return [line('正式口径', props.result.before.ratio), line('试算后', props.result.ratio)].filter((x): x is string => x !== null)
})

function bandRange(scheme: CompareScheme): string {
  const tier = metricTier.value
  if (!tier) return '—'
  const band = scheme.tiers[tier]
  if (!band) return `${BAND_TIER_LABELS[tier]}档未设定`
  const lower = band.lower === null ? null : formatPercent(band.lower)
  const upper = band.upper === null ? null : formatPercent(band.upper)
  if (lower === null && upper === null) return `${BAND_TIER_LABELS[tier]}档未设定`
  if (lower === null) return `上限 ${upper}`
  if (upper === null) return `下限 ${lower}`
  return `${lower} — ${upper}`
}

function assessmentText(assessment: SchemeAssessment | null | undefined): string {
  if (!assessment) return '—'
  const level = ASSESSMENT_LEVEL_LABELS[assessment.level as keyof typeof ASSESSMENT_LEVEL_LABELS] ?? assessment.level
  if (assessment.level !== 'NOT_ASSESSED') return level
  const reason = assessment.reason ? ASSESSMENT_REASON_LABELS[assessment.reason as keyof typeof ASSESSMENT_REASON_LABELS] ?? assessment.reason : null
  const hints = (assessment.hints ?? [])
    .map((hint) => ASSESSMENT_REASON_LABELS[hint as keyof typeof ASSESSMENT_REASON_LABELS] ?? hint)
    .join('、')
  const parts = [reason, hints].filter(Boolean).join(' · ')
  return parts ? `${level}：${parts}` : level
}

function levelClass(assessment: SchemeAssessment | null | undefined): string {
  if (!assessment) return ''
  return assessment.level === 'UNDER' || assessment.level === 'OVER' ? `level-${assessment.level.toLowerCase()}` : ''
}

/** 当前指标的判级（模板里逐行取，避免类型断言）。 */
function assessmentOf(row: SchemeCompareRow): SchemeAssessment | null | undefined {
  return props.metric ? row.metrics[props.metric] : null
}
</script>

<template>
  <section class="scheme-compare" data-test="scheme-compare">
    <h3>方案对比 <span class="badge">对比预览</span></h3>
    <HedgeHint text="对比仅作预览，不改变生效方案。预置区间为推断，仅供参考。" data-test="scheme-compare-note" />

    <p v-if="!result" class="empty" data-test="scheme-compare-empty">
      请先完成试算
    </p>
    <p v-else-if="!metric" class="empty" data-test="scheme-compare-nonstandard">
      自定义窗口不判级<HedgeHint text="判级只适用于当前今明两日或整月窗口，可调整日期后重试。" />
    </p>
    <template v-else>
      <ul class="ratio-lines" data-test="scheme-compare-ratios">
        <li v-for="(line, i) in ratioLines" :key="i">{{ line }}</li>
      </ul>
      <table data-test="scheme-compare-table">
        <thead>
          <tr>
            <th>方案</th><th>判级依据</th><th>{{ metricLabel }}（{{ metricTier ? BAND_TIER_LABELS[metricTier] : '' }}档界限）</th>
            <th>正式口径判级</th><th>试算后判级</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(before, i) in beforeRows" :key="before.key" :class="{ custom: before.key === 'custom' }">
            <td>
              {{ before.label }}
              <HedgeHint :text="before.inferenceNote" />
              <p v-if="before.scenario" class="scenario">{{ before.scenario }}</p>
            </td>
            <td>{{ BAND_BASIS_LABELS[before.basis] }}</td>
            <td>{{ bandRange(before) }}</td>
            <td :class="levelClass(assessmentOf(before))">
              {{ assessmentText(assessmentOf(before)) }}
            </td>
            <td :class="levelClass(assessmentOf(afterRows[i] ?? null))">
              {{ assessmentText(assessmentOf(afterRows[i] ?? null)) }}
            </td>
          </tr>
        </tbody>
      </table>

      <div class="custom-scheme" data-test="custom-scheme">
        <h4>自定义方案</h4>
        <label>判级依据
          <select v-model="customBasis" data-test="custom-basis">
            <option v-for="[value, label] in BASIS_OPTIONS" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
        <table class="tier-inputs">
          <thead>
            <tr><th>档位</th><th>下限（%）</th><th>上限（%）</th></tr>
          </thead>
          <tbody>
            <tr v-for="tier in BAND_TIERS" :key="tier">
              <th>{{ BAND_TIER_LABELS[tier] }}</th>
              <td v-for="side in SIDES" :key="side" :class="{ 'field-error': customError && customError.field === `tiers.${tier}.${side}` }">
                <input
                  v-model="customDraft[tier][side]"
                  :data-test="`custom-${tier}-${side}`"
                  :placeholder="side === 'lower' ? '如 70' : '如 100'"
                >
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="customError" class="error" data-test="custom-error">{{ customError.message }}</p>
        <p v-else class="hint">界限录入 0—200 的百分数；档位未设定时该方案对未设档不判级（档位未设定）。</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.scheme-compare { margin-top: 16px; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; }
.badge { display: inline-block; background: #eef2ff; color: #3730a3; border-radius: 4px; padding: 1px 8px; font-size: var(--font-xs, 12px); }
.empty { color: #9ca3af; }
.ratio-lines { margin: 4px 0; font-size: var(--font-sm, 13px); }
.scheme-compare table { width: 100%; border-collapse: collapse; font-size: var(--font-sm, 13px); }
.scheme-compare th, .scheme-compare td { border-bottom: 1px solid #f0f0f0; padding: 4px 8px; text-align: left; vertical-align: top; }
.scenario { margin: 2px 0 0; color: #9ca3af; font-size: var(--font-xs, 12px); }
.origin { color: #9ca3af; font-size: var(--font-xs, 12px); }
.level-under { color: #b45309; font-weight: 600; }
.level-over { color: #b91c1c; font-weight: 600; }
.custom-scheme { margin-top: 12px; }
.custom-scheme h4 { margin: 0 0 8px; }
.tier-inputs { width: auto; }
.tier-inputs input { width: 90px; }
.field-error input { border: 1px solid #b91c1c; }
.error { color: #b91c1c; }
.hint { color: #9ca3af; font-size: var(--font-xs, 12px); }
</style>
