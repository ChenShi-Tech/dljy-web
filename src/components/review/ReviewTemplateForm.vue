<script setup lang="ts">
// 通用复盘模板渲染器（Epic #2033 · M1 · #2038）
// ---------------------------------------------------------------------------
// 读注册表 schema 渲染 31 项模板的通用形态：
//   auto 字段只读 + 来源徽章（SOURCE_CATALOG desc 悬浮）；human 字段可编辑
//   （判断栏红线：永不挂建议入口）；ai_suggest 字段「建议→人点采纳」交互。
// slots24 模板（E1–E3/N1）按 2026-08-13 拍板：底层 96 点、24 时段仅展示聚合；
// 峰谷标识读 SettlementRuleSpec，未参数化省份显式提示（不借用他省）。
// 提交端点随 #2037/#2039 上线：传入 instance 时草稿落库、可提交锁定；
// 未传 instance（端点未部署/纯模板预览）保持本地预览 + 诚实提示。
import { computed, reactive, ref, watch } from 'vue'
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
import { patchTemplateInstance } from '@/services/review/templateInstanceClient'
import type { TemplateInstanceSummary } from '@/services/review/templateInstanceApi'

const props = defineProps<{
  templateId: string
  /** 当前地区结算规格（slots24 峰谷标识）；未参数化传 null */
  spec: SettlementRuleSpec | null
  /** auto 字段值（按 field key）；slots24 曲线字段传 96 点数组 */
  autofill?: Record<string, unknown>
  /** ai_suggest 字段的建议文案（随 #2044 调度预填上线；缺省显示未生成占位） */
  aiSuggestions?: Record<string, string>
  /** 服务端实例（#2037）：传了才可存草稿/提交；不传=端点未部署的本地预览 */
  instance?: TemplateInstanceSummary | null
}>()

const emit = defineEmits<{ saved: [status: 'draft' | 'submitted'] }>()

const template = computed<ReviewTemplate | null>(() => templateById(props.templateId))

const STATUS_LABEL: Record<string, string> = {
  pending: '待填报',
  draft: '草稿（已动笔）',
  submitted: '已提交（锁定）',
  reviewed: '已复核（留档）'
}

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

/** 本地草稿（human 字段 + 已采纳的 ai 建议）；有实例时与服务端 payload 双向衔接。 */
const draft = reactive<Record<string, string>>({})
const adopted = reactive<Record<string, boolean>>({})
/** 非字符串的既有 payload 键（表格/面板写入的结构化数据，如收益拆解面板的 pnlTop5）：
 *  表单只渲染字符串字段，但保存/提交必须原样保留这些键，否则面板写入的数据会被表单覆盖丢失。 */
const extraPayload = reactive<Record<string, unknown>>({})

/** 实例在且未锁定才可编辑；无实例（端点未部署）允许预览填写但不可提交。 */
const instanceEditable = computed(
  () => !props.instance || props.instance.status === 'pending' || props.instance.status === 'draft'
)
/** 必填 human 字段齐了才可提交（服务端仍会再校验状态机与权限）。 */
const canSubmit = computed(
  () =>
    !!props.instance &&
    instanceEditable.value &&
    humanFields.value.filter((f) => f.required).every((f) => (draft[f.key] ?? '').trim() !== '')
)
const saving = ref(false)
const saveError = ref('')
const savedMsg = ref('')

/** 实例草稿回填（重开 draft 实例不丢已填内容；ai 采纳过的一并还原为已采纳态）。 */
function seedFromInstance(): void {
  saveError.value = ''
  savedMsg.value = ''
  for (const k of Object.keys(extraPayload)) delete extraPayload[k]
  const payload = props.instance?.payload
  if (!payload) return
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== 'string') { extraPayload[key] = value; continue }
    draft[key] = value
    if (aiFields.value.some((f) => f.key === key)) adopted[key] = true
  }
}
watch(() => props.instance?.id, seedFromInstance, { immediate: true })

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
  // 「建议→人点采纳」范式：点采纳才进草稿（采纳本身是人的一次显式确认，AI 永不直写）。
  // 建议文本随采纳落入草稿框——否则采纳后输入框为空，建议凭空消失、提交 payload 缺值。
  draft[fieldKey] = props.aiSuggestions?.[fieldKey] ?? ''
  adopted[fieldKey] = true
}

/** 存草稿：PATCH payload = 既有结构化键 + 表单字符串草稿（后者覆盖同名字段）。 */
async function saveDraft() {
  await persist({ payload: { ...extraPayload, ...draft } }, 'draft', '草稿已保存')
}
/** 提交：payload + status 一并提交，服务端打提交戳（filledBy/submittedAt）并锁定。 */
async function submitInstance() {
  await persist({ payload: { ...extraPayload, ...draft }, status: 'submitted' }, 'submitted', '已提交并锁定——更正走追加记录')
}
async function persist(
  patch: { payload: Record<string, unknown>; status?: 'submitted' },
  status: 'draft' | 'submitted',
  okMsg: string
) {
  if (!props.instance || !canSubmit.value || saving.value) return
  saving.value = true
  saveError.value = ''
  savedMsg.value = ''
  try {
    await patchTemplateInstance(props.instance.id, patch)
    savedMsg.value = okMsg
    emit('saved', status)
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    saving.value = false
  }
}

// ── slots24 聚合视图 ─────────────────────────────────────────────────────────
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
            <button type="button" class="rtf-adopt" :disabled="!instanceEditable" @click="adopt(f.key)">采纳</button>
          </template>
          <template v-else>
            <input v-model="draft[f.key]" class="rtf-input" :disabled="!instanceEditable" />
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
        <textarea
          v-model="draft[f.key]"
          rows="2"
          class="rtf-input"
          :disabled="!instanceEditable"
          :placeholder="!instanceEditable ? '（实例已锁定，不可编辑）' : f.required ? '人工判断，必填' : '选填'"
        />
      </div>
    </section>

    <footer class="rtf-foot">
      <!-- 有实例：草稿/提交直连服务端（#2037），状态机与权限由服务端校验 -->
      <template v-if="instance && instanceEditable">
        <div class="rtf-submit-row">
          <button type="button" class="rtf-save" :disabled="!canSubmit || saving" @click="saveDraft">
            {{ saving ? '保存中…' : '存草稿' }}
          </button>
          <button type="button" class="rtf-submit live" :disabled="!canSubmit || saving" @click="submitInstance">提交</button>
        </div>
        <p class="rtf-status">
          实例 #{{ instance.id }} · 周期 {{ instance.periodKey || '—' }} · 当前状态：{{ STATUS_LABEL[instance.status] }}
        </p>
        <p v-if="saveError" class="rtf-error">{{ saveError }}</p>
        <p v-if="savedMsg" class="rtf-saved">{{ savedMsg }}</p>
        <p class="rtf-lock">提交后锁定，更正走追加记录；审核为轻量两态（提交/复核，2026-08-13 拍板）。</p>
      </template>
      <!-- 有实例但已提交/已复核：锁定态如实展示 -->
      <template v-else-if="instance">
        <p class="rtf-status">
          实例 #{{ instance.id }} · 周期 {{ instance.periodKey || '—' }} · 状态：{{ STATUS_LABEL[instance.status] }}——
          {{ instance.status === 'submitted' ? '待提权角色复核（ADMIN/BOSS）' : '复核通过，留档' }}，内容不可再编辑。
        </p>
      </template>
      <!-- 无实例：端点未部署的诚实降级（原有行为） -->
      <template v-else>
        <button type="button" class="rtf-submit" disabled>提交（实例端点未上线）</button>
        <p class="rtf-pending">{{ SUBMIT_PENDING_NOTE }}</p>
        <p class="rtf-lock">提交后锁定，更正走追加记录；审核为轻量两态（提交/复核，2026-08-13 拍板）。</p>
      </template>
    </footer>
  </div>
</template>

<style scoped>
.rtf { display: flex; flex-direction: column; gap: 12px; font-size: var(--font-12-5); }
.rtf-unknown { padding: 14px; border: 1px solid #fca5a5; border-radius: 8px; background: #fef2f2; color: #991b1b; font-size: var(--font-12-5); }
.rtf-head { display: flex; flex-direction: column; gap: 3px; }
.rtf-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rtf-title b { font-size: var(--font-15); }
.rtf-title code { font-size: var(--font-xs); color: var(--el-text-color-secondary, #909399); }
.rtf-badge { font-style: normal; font-size: var(--font-10-5); border-radius: 999px; padding: 0 8px; }
.rtf-badge.ok { background: #f0fdf4; color: #15803d; }
.rtf-badge.gap { background: #fffbeb; color: #a16207; }
.rtf-badge.deferred { background: #f1f5f9; color: #64748b; }
.rtf-meta { margin: 0; font-size: var(--font-11-5); color: var(--el-text-color-secondary, #666); line-height: 1.6; }
.rtf-gapnote { margin: 2px 0 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: var(--font-11-5); line-height: 1.6; }
.rtf-notes { margin: 2px 0 0; font-size: var(--font-11-5); color: var(--el-text-color-secondary, #666); line-height: 1.6; }
.rtf-sec { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--el-border-color-lighter, #ebeef5); }
.rtf-sec h4 { margin: 0; font-size: var(--font-12-5); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rtf-hint { font-style: normal; font-size: var(--font-10-5); color: var(--el-text-color-secondary, #909399); font-weight: 400; }
.rtf-auto-row, .rtf-ai-row, .rtf-human-row { display: grid; gap: 6px; align-items: start; }
.rtf-auto-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.rtf-label { font-size: var(--font-sm); color: var(--el-text-color-regular, #606266); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.rtf-value { font-weight: 600; color: var(--el-text-color-primary, #303133); font-variant-numeric: tabular-nums; }
.rtf-value.empty { color: var(--el-text-color-secondary, #909399); font-weight: 400; }
.rtf-source { font-style: normal; font-size: var(--font-10); color: #0369a1; background: #e0f2fe; border-radius: 4px; padding: 0 6px; cursor: help; white-space: nowrap; justify-self: start; }
.rtf-caliber { font-style: normal; font-size: var(--font-10); color: #a16207; background: #fffbeb; border-radius: 4px; padding: 0 6px; }
.rtf-ai-row { grid-template-columns: minmax(0, 1fr); gap: 4px; }
.rtf-suggestion { margin: 0; padding: 6px 9px; border-left: 3px solid #bfdbfe; background: #f8fbff; border-radius: 4px; font-size: var(--font-sm); color: #334155; line-height: 1.6; }
.rtf-adopt { justify-self: start; padding: 3px 12px; border: 1px solid #2563eb; border-radius: 6px; background: #fff; color: #2563eb; font-size: var(--font-11-5); cursor: pointer; }
.rtf-adopt:hover { background: #f8fbff; }
.rtf-adopted { font-style: normal; font-size: var(--font-10-5); color: #15803d; }
.rtf-noai { margin: 0; font-size: var(--font-xs); color: var(--el-text-color-secondary, #909399); }
.rtf-human-row { grid-template-columns: minmax(0, 1fr); }
.rtf-req { font-style: normal; font-size: var(--font-10); color: #b91c1c; border: 1px solid #fca5a5; border-radius: 4px; padding: 0 5px; }
.rtf-redline { font-style: normal; font-size: var(--font-10-5); color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; padding: 1px 7px; font-weight: 400; }
.rtf-input { width: 100%; padding: 5px 8px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-sm); font-family: inherit; background: #fff; color: var(--el-text-color-primary, #303133); box-sizing: border-box; }
.rtf-warn { margin: 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: var(--font-11-5); line-height: 1.6; }
.rtf-slots { width: 100%; border-collapse: collapse; font-size: var(--font-11-5); font-variant-numeric: tabular-nums; }
.rtf-slots th, .rtf-slots td { padding: 3px 7px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: right; white-space: nowrap; }
.rtf-slots th { color: var(--el-text-color-secondary, #666); font-weight: 500; font-size: var(--font-10-5); }
.rtf-slots th:first-child, .rtf-slots td:first-child { text-align: left; }
.rtf-foot { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 1px solid var(--el-border-color-lighter, #ebeef5); }
.rtf-submit { align-self: flex-start; padding: 6px 18px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 8px; background: var(--el-fill-color-light, #f5f7fa); color: var(--el-text-color-placeholder, #a8abb2); font-size: var(--font-12-5); cursor: not-allowed; }
.rtf-submit-row { display: flex; gap: 8px; align-items: center; }
.rtf-submit.live { border-color: #2563eb; background: #2563eb; color: #fff; cursor: pointer; }
.rtf-submit.live:disabled { opacity: .45; cursor: not-allowed; }
.rtf-save { padding: 6px 14px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 8px; background: #fff; color: inherit; font-size: var(--font-12-5); cursor: pointer; }
.rtf-save:disabled { opacity: .45; cursor: not-allowed; }
.rtf-status { margin: 2px 0 0; font-size: var(--font-11-5); color: #0369a1; line-height: 1.6; }
.rtf-error { margin: 2px 0 0; font-size: var(--font-11-5); color: #b91c1c; line-height: 1.6; }
.rtf-saved { margin: 2px 0 0; font-size: var(--font-11-5); color: #15803d; line-height: 1.6; }
.rtf-pending { margin: 0; font-size: var(--font-xs); color: var(--el-text-color-secondary, #909399); line-height: 1.6; }
.rtf-lock { margin: 0; font-size: var(--font-xs); color: #a16207; line-height: 1.6; }
</style>
