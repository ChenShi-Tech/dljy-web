<script setup lang="ts">
// AI 辅助填报按钮 —— 一日作业链中「人工经验判断」字段的填写协助（2026-08-11 用户拍板）
//
// 设计契约（三条硬约束，决定了这个组件长什么样）：
//   ① **只用在需要人工经验判断的字段**（偏差主因、方向、预期价差、置信度、决策理由、
//      补仓动作、概率分位）。数据库能取的字段不用它——那些走确定性取数通道，
//      机械拉取即可，让 AI 去"判断"一个能查出来的数字是本末倒置。
//   ② **AI 出建议，人点采纳才写入**。组件自己不改任何东西：它把建议渲染成卡片，
//      用户点「采纳填入」时才 emit('apply', suggestion)，由父组件写进自己的表单 ref。
//      这保证了「AI 负责判断与推理，人负责决策」的分工不被实现细节侵蚀。
//   ③ **逐字段标依据**：每个建议值带 data（建立在注入的实际数据上）/ assumption
//      （模型的假设推断）徽章，外加整体置信度与 caveats（模型自陈会错的情形）。
//      不看 caveats 就采纳等于放弃判断——所以 caveats 与建议值同屏、不折叠。
//
// 上下文由父组件提供（已算好的规则引擎结果 / 上游步骤产出 / 历史事实）——本组件不取数。
import { computed, ref } from 'vue'
import { Sparkles, Check, X, TriangleAlert } from 'lucide-vue-next'
import { BASIS_LABEL, requestAssist, type AssistKind, type AssistSuggestion } from '@/services/trading/assistClient'

const props = defineProps<{
  kind: AssistKind
  /** 注入 AI 的上下文（父组件已算好的结果，AI 不得改其中数字） */
  context: Record<string, unknown>
  /** 字段名 → 中文标签，用于建议卡展示 */
  fieldLabels: Record<string, string>
  /** 按钮文案（默认「AI 帮我判断」） */
  label?: string
  /** 禁用原因；非空时按钮禁用并 hover 显示 */
  disabledReason?: string
}>()

const emit = defineEmits<{
  /** 用户点「采纳填入」：父组件据此写自己的表单 ref */
  apply: [suggestion: Record<string, unknown>]
}>()

const loading = ref(false)
const error = ref('')
const result = ref<AssistSuggestion | null>(null)

/** 有值的建议字段（模型判断不了的字段返回 null，不展示、也不会被采纳覆盖）。 */
const filledFields = computed(() =>
  Object.entries(result.value?.suggestion ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '')
)
const hasApplicable = computed(() => filledFields.value.length > 0)

async function ask() {
  if (props.disabledReason) return
  loading.value = true
  error.value = ''
  result.value = null
  try {
    result.value = await requestAssist(props.kind, props.context)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '辅助判断失败'
  } finally {
    loading.value = false
  }
}

function apply() {
  if (!result.value) return
  // 只把有值的字段交给父组件——null 字段保持用户原值，不被"我不知道"覆盖
  emit('apply', Object.fromEntries(filledFields.value))
  result.value = null
}

function dismiss() {
  result.value = null
  error.value = ''
}

function fmt(v: unknown): string {
  if (typeof v === 'number') return String(v)
  return String(v ?? '')
}
</script>

<template>
  <div class="aaf">
    <button
      type="button"
      class="aaf-btn"
      :disabled="loading || Boolean(disabledReason)"
      :title="disabledReason || 'AI 基于当前上下文给出结构化建议，采纳与否由你决定'"
      @click="ask"
    >
      <Sparkles :size="12" />
      {{ loading ? '判断中…' : (label || 'AI 帮我判断') }}
    </button>
    <span v-if="disabledReason" class="aaf-hint">{{ disabledReason }}</span>
    <span v-if="error" class="aaf-err">{{ error }}</span>

    <!-- 建议卡：逐字段值 + 依据徽章 + 整体理由 + 会错的情形 -->
    <div v-if="result" class="aaf-card">
      <div class="aaf-card-head">
        <strong>AI 建议</strong>
        <span class="aaf-conf" :class="{ low: result.confidence < 50 }">置信度 {{ result.confidence }}</span>
        <button type="button" class="aaf-x" title="忽略" @click="dismiss"><X :size="13" /></button>
      </div>

      <table v-if="hasApplicable" class="aaf-fields">
        <tbody>
          <tr v-for="[key, value] in filledFields" :key="key">
            <td class="aaf-k">{{ fieldLabels[key] || key }}</td>
            <td class="aaf-v">{{ fmt(value) }}</td>
            <td class="aaf-b">
              <i :class="result.basis[key] === 'data' ? 'b-data' : 'b-assume'">
                {{ BASIS_LABEL[result.basis[key]] || '基于假设' }}
              </i>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="aaf-empty">AI 判断不了这些字段（上下文不足），未给建议——它不编数。</p>

      <p v-if="result.rationale" class="aaf-why">{{ result.rationale }}</p>

      <ul v-if="result.caveats.length" class="aaf-caveats">
        <li v-for="(c, i) in result.caveats" :key="i"><TriangleAlert :size="11" /> {{ c }}</li>
      </ul>

      <div class="aaf-actions">
        <button type="button" class="aaf-apply" :disabled="!hasApplicable" @click="apply">
          <Check :size="12" /> 采纳填入（{{ filledFields.length }} 项）
        </button>
        <button type="button" class="aaf-ignore" @click="dismiss">忽略</button>
        <span class="aaf-note">采纳后仍可手改；写回单据的是你最终确认的值</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.aaf { display: inline-flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.aaf-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 11px; border: 1px solid #7c3aed; border-radius: 12px; background: #faf5ff; color: #6d28d9; font-size: 11px; cursor: pointer; }
.aaf-btn:disabled { opacity: .45; cursor: not-allowed; }
.aaf-hint { font-size: 10px; color: var(--el-text-color-secondary, #889); }
.aaf-err { font-size: 11px; color: #b91c1c; max-width: 420px; line-height: 1.5; }

.aaf-card { min-width: 320px; max-width: 560px; padding: 10px 12px; border: 1px solid #ddd6fe; border-radius: 10px; background: #faf5ff; }
.aaf-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px; }
.aaf-conf { padding: 1px 8px; border-radius: 9px; background: #ede9fe; color: #6d28d9; font-size: 10px; }
.aaf-conf.low { background: #fef3c7; color: #92400e; }
.aaf-x { margin-left: auto; border: none; background: none; cursor: pointer; color: #94a3b8; display: inline-flex; }

.aaf-fields { width: 100%; border-collapse: collapse; font-size: 11px; }
.aaf-fields td { padding: 3px 4px; border-bottom: 1px solid #ede9fe; vertical-align: top; }
.aaf-k { color: var(--el-text-color-secondary, #667); white-space: nowrap; width: 90px; }
.aaf-v { font-weight: 600; word-break: break-all; }
.aaf-b { width: 64px; text-align: right; }
.aaf-b i { font-style: normal; font-size: 9px; padding: 1px 6px; border-radius: 7px; white-space: nowrap; }
.b-data { background: #dcfce7; color: #15803d; }
.b-assume { background: #fef3c7; color: #92400e; }

.aaf-empty { margin: 6px 0; font-size: 11px; color: #92400e; }
.aaf-why { margin: 8px 0 4px; font-size: 11px; line-height: 1.7; }
.aaf-caveats { margin: 4px 0 0; padding: 0 0 0 2px; list-style: none; font-size: 10px; line-height: 1.7; color: #92400e; }
.aaf-caveats li { display: flex; align-items: flex-start; gap: 4px; }

.aaf-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.aaf-apply { display: inline-flex; align-items: center; gap: 4px; padding: 4px 12px; border: 1px solid #7c3aed; border-radius: 6px; background: #7c3aed; color: #fff; font-size: 11px; cursor: pointer; }
.aaf-apply:disabled { opacity: .45; cursor: not-allowed; }
.aaf-ignore { padding: 4px 10px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: 11px; cursor: pointer; }
.aaf-note { font-size: 10px; color: var(--el-text-color-secondary, #889); }
</style>
