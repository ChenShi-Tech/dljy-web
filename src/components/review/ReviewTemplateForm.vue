<script setup lang="ts">
// 通用复盘模板渲染器（Epic #2033 · M1 · #2038）
// ---------------------------------------------------------------------------
// 读注册表 schema 渲染 31 项模板的通用形态：
//   auto 字段只读 + 来源徽章（SOURCE_CATALOG desc 悬浮）；human 字段可编辑
//   （判断栏红线：永不挂建议入口）；ai_suggest 字段「建议→人点采纳」交互。
// slots24 模板（E1–E3/N1）按 2026-08-13 拍板：底层 96 点、24 时段仅展示聚合；
// 峰谷标识读 SettlementRuleSpec，未参数化省份显式提示（不借用他省）。
// 提交端点随 #2037/#2039 上线：当前仅本地草稿，不落库、不显示「已提交」。
import { computed, reactive } from 'vue'
import {
  DIMENSIONS,
  SOURCE_CATALOG,
  SUBJECTS,
  templateById
} from 'shared/review-templates/registry.mjs'
import type { ReviewTemplate, ReviewTemplateField } from 'shared/review-templates/registry.mjs'
import type { SettlementRuleSpec } from '@/rules/types'
import { aggregate96to24, segmentLabelsOf, SEGMENT_UNPARAMETERIZED_NOTE } from '@/services/review/slots24'
import { SUBMIT_PENDING_NOTE } from '@/services/review/cockpitModel'

const props = defineProps<{
  templateId: string
  /** 当前地区结算规格（slots24 峰谷标识）；未参数化传 null */
  spec: SettlementRuleSpec | null
  /** auto 字段值（按 field key）；slots24 曲线字段传 96 点数组 */
  autofill?: Record<string, unknown>
  /** ai_suggest 字段的建议文案（随 #2044 调度预填上线；缺省显示未生成占位） */
  aiSuggestions?: Record<string, string>
}>()

const template = computed<ReviewTemplate | null>(() => templateById(props.templateId))

const READINESS_BADGE: Record<string, { label: string; cls: string }> = {
  ready: { label: '就绪', cls: 'ok' },
  data_gap: { label: '缺数据', cls: 'gap' },
  deferred: { label: '后置', cls: 'deferred' }
}
const AUTOMATION_DESC: Record<string, string> = {
  A: 'A 档：系统生成、人审签发',
  B: 'B 档：系统预填事实、人补判断',
  C: 'C 档：纯人工填报'
}

const fields = computed(() => template.value?.fields ?? [])
const autoFields = computed(() => fields.value.filter((f) => f.fill === 'auto'))
const humanFields = computed(() => fields.value.filter((f) => f.fill === 'human'))
const aiFields = computed(() => fields.value.filter((f) => f.fill === 'ai_suggest'))
const isSlots24 = computed(() => template.value?.slots24 === true)

/** 判断栏红线：human 且 required 的字段是「依据/结论/改进」类，渲染上额外声明。 */
const hasJudgementFields = computed(() => humanFields.value.some((f) => f.required))

/** 本地草稿（human 字段 + 已采纳的 ai 建议）。提交端点未上线，仅存内存。 */
const draft = reactive<Record<string, string>>({})
const adopted = reactive<Record<string, boolean>>({})

function sourceDesc(f: ReviewTemplateField): string {
  const s = SOURCE_CATALOG.find((x) => x.id === f.source)
  return s ? `${s.id} · ${s.desc}` : (f.source ?? '未登记来源')
}
function autoValue(f: ReviewTemplateField): string {
  const v = props.autofill?.[f.key]
  if (v === undefined || v === null || v === '') return ''
  if (Array.isArray(v)) return `(${v.length} 点序列)`
  return String(v)
}
function adopt(fieldKey: string) {
  // 「建议→人点采纳」范式：点采纳才进草稿，AI 永不直写
  adopted[fieldKey] = true
}

// slots24 聚合视图
const segments = computed(() => segmentLabelsOf(props.spec))
const slots24Columns = computed(() => autoFields.value.filter((f) => !isPeakFlag(f)))
function isPeakFlag(f: ReviewTemplateField): boolean {
  return isSlots24.value && f.source === 'settlement_rules'
}
function slotValue(f: ReviewTemplateField, slot: number): string {
  const curve = props.autofill?.[f.key]
  if (!Array.isArray(curve)) return '—'
  const agg = aggregate96to24(curve as (number | null)[])
  const v = agg[slot]
  return v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(2)
}
const hasAnyCurve = computed(() =>
  slots24Columns.value.some((f) => Array.isArray(props.autofill?.[f.key]))
)
</script>

<template>
  <div v-if="!template" class="rtf-unknown">
    未知模板 <code>{{ templateId }}</code>：不在注册表（31 项）中，可能是链接过期或注册表未同步。
  </div>

  <div v-else class="rtf">
    <header class="rtf-head">
      <div class="rtf-title">
        <b>{{ template.name }}</b>
        <code>{{ template.id }}</code>
        <i class="rtf-badge" :class="READINESS_BADGE[template.readiness].cls">
          {{ READINESS_BADGE[template.readiness].label }}
        </i>
      </div>
      <p class="rtf-meta">
        {{ DIMENSIONS[template.dimension] }} · {{ SUBJECTS[template.subject] }} ·
        {{ AUTOMATION_DESC[template.automation] }} · 周期 {{ template.cadences.join('/') }} ·
        填报 {{ template.roles.fill }} / 复核 {{ template.roles.review }} · 留存 {{ template.retentionYears }} 年
      </p>
      <p class="rtf-meta">
        触发：{{ template.trigger }} · 时限：{{ template.deadline }}
      </p>
      <p v-if="template.gapNote" class="rtf-gapnote">数据缺口：{{ template.gapNote }}</p>
      <p v-if="template.notes" class="rtf-notes">{{ template.notes }}</p>
    </header>

    <!-- 自动字段：只读 + 来源徽章 -->
    <section v-if="autoFields.length" class="rtf-sec">
      <h4>系统自动字段（只读 · 来源随字段标注）</h4>
      <div v-for="f in autoFields" :key="f.key" class="rtf-auto-row">
        <span class="rtf-label">{{ f.label }}<i v-if="f.caliber" class="rtf-caliber">口径 {{ f.caliber }}</i></span>
        <b class="rtf-value" :class="{ empty: !autoValue(f) }">{{ autoValue(f) || '待喂数' }}</b>
        <i class="rtf-source" :title="sourceDesc(f)">{{ f.source }}</i>
      </div>
    </section>

    <!-- AI 建议字段：建议→人点采纳（不采纳不进草稿） -->
    <section v-if="aiFields.length" class="rtf-sec">
      <h4>AI 建议字段（建议需人采纳后生效）</h4>
      <div v-for="f in aiFields" :key="f.key" class="rtf-ai-row">
        <span class="rtf-label">{{ f.label }}</span>
        <template v-if="aiSuggestions?.[f.key]">
          <template v-if="!adopted[f.key]">
            <p class="rtf-suggestion">建议：{{ aiSuggestions[f.key] }}</p>
            <button type="button" class="rtf-adopt" @click="adopt(f.key)">采纳</button>
          </template>
          <template v-else>
            <input v-model="draft[f.key]" class="rtf-input" />
            <i class="rtf-adopted">已采纳（可人工修改）</i>
          </template>
        </template>
        <p v-else class="rtf-noai">AI 建议未生成：模板预填随周/月复盘调度（#2044）上线。</p>
      </div>
    </section>

    <!-- 24 时段聚合视图（slots24 模板）：底层 96 点、24 时段仅展示聚合 -->
    <section v-if="isSlots24" class="rtf-sec">
      <h4>24 时段视图 <i class="rtf-hint">底层 96 点 · 展示按小时聚合（2026-08-13 拍板）</i></h4>
      <p v-if="!segments.parameterized" class="rtf-warn">{{ segments.note ?? SEGMENT_UNPARAMETERIZED_NOTE }}</p>
      <p v-if="!hasAnyCurve" class="rtf-warn">时段曲线未喂数：自动列显示「—」，不用 0 冒充。</p>
      <table class="rtf-slots">
        <thead>
          <tr>
            <th>时</th>
            <th v-if="isSlots24">峰谷</th>
            <th v-for="f in slots24Columns" :key="f.key">{{ f.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in 24" :key="h">
            <td>{{ h - 1 }}</td>
            <td>{{ segments.parameterized ? segments.labels[h - 1] : '—' }}</td>
            <td v-for="f in slots24Columns" :key="f.key">{{ slotValue(f, h - 1) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 人工字段：可编辑（判断栏红线：严禁系统代填） -->
    <section v-if="humanFields.length" class="rtf-sec">
      <h4>
        人工字段
        <i v-if="hasJudgementFields" class="rtf-redline">判断栏严禁系统代填（方案红线）：本区字段无 AI 建议入口</i>
      </h4>
      <div v-for="f in humanFields" :key="f.key" class="rtf-human-row">
        <label class="rtf-label">
          {{ f.label }}<i v-if="f.required" class="rtf-req">必填</i>
        </label>
        <textarea v-model="draft[f.key]" rows="2" class="rtf-input" :placeholder="f.required ? '人工判断，必填' : '选填'" />
      </div>
    </section>

    <footer class="rtf-foot">
      <button type="button" class="rtf-submit" disabled>提交（实例端点未上线）</button>
      <p class="rtf-pending">{{ SUBMIT_PENDING_NOTE }}</p>
      <p class="rtf-lock">提交后锁定，更正走追加记录；审核为轻量两态（提交/复核，2026-08-13 拍板）。</p>
    </footer>
  </div>
</template>

<style scoped>
.rtf { display: flex; flex-direction: column; gap: 12px; font-size: 12.5px; }
.rtf-unknown { padding: 14px; border: 1px solid #fca5a5; border-radius: 8px; background: #fef2f2; color: #991b1b; font-size: 12.5px; }
.rtf-head { display: flex; flex-direction: column; gap: 3px; }
.rtf-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rtf-title b { font-size: 15px; }
.rtf-title code { font-size: 11px; color: var(--el-text-color-secondary, #909399); }
.rtf-badge { font-style: normal; font-size: 10.5px; border-radius: 999px; padding: 0 8px; }
.rtf-badge.ok { background: #f0fdf4; color: #15803d; }
.rtf-badge.gap { background: #fffbeb; color: #a16207; }
.rtf-badge.deferred { background: #f1f5f9; color: #64748b; }
.rtf-meta { margin: 0; font-size: 11.5px; color: var(--el-text-color-secondary, #666); line-height: 1.6; }
.rtf-gapnote { margin: 2px 0 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 11.5px; line-height: 1.6; }
.rtf-notes { margin: 2px 0 0; font-size: 11.5px; color: var(--el-text-color-secondary, #666); line-height: 1.6; }
.rtf-sec { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--el-border-color-lighter, #ebeef5); }
.rtf-sec h4 { margin: 0; font-size: 12.5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rtf-hint { font-style: normal; font-size: 10.5px; color: var(--el-text-color-secondary, #909399); font-weight: 400; }
.rtf-auto-row, .rtf-ai-row, .rtf-human-row { display: grid; gap: 6px; align-items: start; }
.rtf-auto-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; }
.rtf-label { font-size: 12px; color: var(--el-text-color-regular, #606266); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.rtf-value { font-weight: 600; color: var(--el-text-color-primary, #303133); font-variant-numeric: tabular-nums; }
.rtf-value.empty { color: var(--el-text-color-secondary, #909399); font-weight: 400; }
.rtf-source { font-style: normal; font-size: 10px; color: #0369a1; background: #e0f2fe; border-radius: 4px; padding: 0 6px; cursor: help; white-space: nowrap; }
.rtf-caliber { font-style: normal; font-size: 10px; color: #a16207; background: #fffbeb; border-radius: 4px; padding: 0 6px; }
.rtf-ai-row { grid-template-columns: minmax(0, 1fr); gap: 4px; }
.rtf-suggestion { margin: 0; padding: 6px 9px; border-left: 3px solid #bfdbfe; background: #f8fbff; border-radius: 4px; font-size: 12px; color: #334155; line-height: 1.6; }
.rtf-adopt { justify-self: start; padding: 3px 12px; border: 1px solid #2563eb; border-radius: 6px; background: #fff; color: #2563eb; font-size: 11.5px; cursor: pointer; }
.rtf-adopt:hover { background: #f8fbff; }
.rtf-adopted { font-style: normal; font-size: 10.5px; color: #15803d; }
.rtf-noai { margin: 0; font-size: 11px; color: var(--el-text-color-secondary, #909399); }
.rtf-human-row { grid-template-columns: minmax(0, 1fr); }
.rtf-req { font-style: normal; font-size: 10px; color: #b91c1c; border: 1px solid #fca5a5; border-radius: 4px; padding: 0 5px; }
.rtf-redline { font-style: normal; font-size: 10.5px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; padding: 1px 7px; font-weight: 400; }
.rtf-input { width: 100%; padding: 5px 8px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: 12px; font-family: inherit; background: #fff; color: var(--el-text-color-primary, #303133); box-sizing: border-box; }
.rtf-warn { margin: 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 11.5px; line-height: 1.6; }
.rtf-slots { width: 100%; border-collapse: collapse; font-size: 11.5px; font-variant-numeric: tabular-nums; }
.rtf-slots th, .rtf-slots td { padding: 3px 7px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: right; white-space: nowrap; }
.rtf-slots th { color: var(--el-text-color-secondary, #666); font-weight: 500; font-size: 10.5px; }
.rtf-slots th:first-child, .rtf-slots td:first-child { text-align: left; }
.rtf-foot { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 1px solid var(--el-border-color-lighter, #ebeef5); }
.rtf-submit { align-self: flex-start; padding: 6px 18px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 8px; background: var(--el-fill-color-light, #f5f7fa); color: var(--el-text-color-placeholder, #a8abb2); font-size: 12.5px; cursor: not-allowed; }
.rtf-pending { margin: 0; font-size: 11px; color: var(--el-text-color-secondary, #909399); line-height: 1.6; }
.rtf-lock { margin: 0; font-size: 11px; color: #a16207; line-height: 1.6; }
</style>
