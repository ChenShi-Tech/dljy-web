<script setup lang="ts">
// 日前盯盘单个事项：对象、变化/机制、窗口、证据条数、下一步动作；展开看冻结证据；本人评价。
// 模型判断只作“试验研判”附注；评价只追加，不改原结果（DW-07/DW-14）。
// 证据 ref（E1…）在同一事项内可能重复（同一原因文本共用编号），列表键用 snapshotId+rowIndex。
import { computed, ref } from 'vue'
import { DISCLOSURE_WATCH_FEEDBACK_NOTE_MAX } from 'shared/schema/disclosure-watch-contract.mjs'
import {
  WATCH_VERDICT_LABELS, datasetLabel, flagLabel, formatBeijingTime, kindLabel, levelLabel, processingLabel, reviewReasonLabel,
  watchChangeText, watchEvidenceFields, watchModelNotes, watchObjectLabel,
  type DisclosureWatchFeedbackVerdict, type DisclosureWatchItem,
} from './disclosureWatchModel'

export interface WatchFeedbackState { status: 'submitting' | 'done' | 'error'; verdict: DisclosureWatchFeedbackVerdict; message?: string }

const props = withDefaults(defineProps<{ item: DisclosureWatchItem; variant?: 'card' | 'row'; feedback?: WatchFeedbackState | null; canFeedback?: boolean }>(), { variant: 'row', feedback: null, canFeedback: true })
const emit = defineEmits<{ feedback: [payload: { itemId: string; verdict: DisclosureWatchFeedbackVerdict; note: string | null }]; locate: [eventId: string] }>()

const evidenceOpen = ref(false)
const correcting = ref(false)
const note = ref('')
const noteLength = computed(() => [...note.value].length)
const modelNotes = computed(() => watchModelNotes(props.item))
const submitting = computed(() => props.feedback?.status === 'submitting')
const done = computed(() => props.feedback?.status === 'done')
const tags = computed(() => [...(props.item.reviewReasons ?? []).map((reason) => ({ key: `r:${reason}`, text: reviewReasonLabel(reason), tone: 'warn' })), ...(props.item.flags ?? []).map((flag) => ({ key: `f:${flag}`, text: flagLabel(flag), tone: 'info' }))])
const evidence = computed(() => (props.item.evidence ?? []).map((entry) => ({ ...entry, dataset: datasetLabel(entry.dataset), received: formatBeijingTime(entry.receivedAt) ?? '未提供', rows: watchEvidenceFields(entry.fields) })))

function send(verdict: DisclosureWatchFeedbackVerdict) {
  if (submitting.value || done.value) return
  const text = verdict === 'needs-correction' ? note.value.trim() : ''
  if ([...text].length > DISCLOSURE_WATCH_FEEDBACK_NOTE_MAX) return
  emit('feedback', { itemId: props.item.itemId, verdict, note: text || null })
}
function toggleEvidence(event: Event) { evidenceOpen.value = (event.target as HTMLDetailsElement).open }
</script>

<template>
  <article :class="['watch-item', variant, item.level]" :data-testid="`watch-item-${item.itemId}`">
    <header><strong class="object">{{ watchObjectLabel(item) }}</strong><span class="kind">{{ kindLabel(item.kind) }}</span><span :class="['level', item.level]">{{ levelLabel(item.level) }}</span></header>
    <p v-if="item.headline" class="headline">{{ item.headline }}</p>
    <dl class="facts">
      <div><dt>变化</dt><dd>{{ watchChangeText(item) }}</dd></div>
      <div v-for="entry in modelNotes" :key="entry.label"><dt>{{ entry.label }}</dt><dd>{{ entry.value }} <span class="trial">试验研判</span></dd></div>
      <div><dt>窗口</dt><dd>{{ item.window?.label || '时段未提供' }}</dd></div>
      <div><dt>证据</dt><dd>{{ item.evidence?.length ?? 0 }} 条</dd></div>
      <div class="next"><dt>下一步</dt><dd>{{ item.nextAction || '未提供' }}</dd></div>
    </dl>
    <ul v-if="tags.length" class="tags"><li v-for="tag in tags" :key="tag.key" :class="tag.tone">{{ tag.text }}</li></ul>
    <details class="evidence" @toggle="toggleEvidence">
      <summary>查看冻结证据（{{ item.evidence?.length ?? 0 }} 条）</summary>
      <template v-if="evidenceOpen">
        <dl v-if="item.facts?.length" class="facts extra"><div v-for="fact in item.facts" :key="fact.label"><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></div><div><dt>处理方式</dt><dd>{{ processingLabel(item.processing) }}</dd></div></dl>
        <p v-for="entry in modelNotes" :key="`v:${entry.label}`" class="model-version">{{ entry.label }}：模型版本 {{ entry.modelVersion || '未知' }}（未校准，仅作试验附注）</p>
        <ol class="evidence-list">
          <li v-for="(entry, index) in evidence" :key="`${entry.sourceRef?.snapshotId}:${entry.sourceRef?.rowIndex}:${index}`" data-testid="watch-evidence">
            <p class="evidence-meta"><b>{{ entry.ref }}</b>{{ entry.dataset }} · 资料日期 {{ entry.coverageDate || '未提供' }} · 接收 {{ entry.received }}（北京时间）</p>
            <dl><div v-for="field in entry.rows" :key="field.key"><dt>{{ field.key }}</dt><dd>{{ field.value }}</dd></div></dl>
          </li>
        </ol>
      </template>
    </details>
    <button v-if="item.eventId" type="button" class="link" data-testid="watch-locate" @click="emit('locate', item.eventId)">定位到原页对象</button>
    <div v-if="canFeedback" class="feedback" :aria-label="`评价 ${watchObjectLabel(item)}`">
      <p v-if="done" class="done" data-testid="watch-feedback-done">已评价：{{ WATCH_VERDICT_LABELS[feedback!.verdict] }}</p>
      <template v-else>
        <span class="ask">这条有帮助吗</span>
        <button type="button" :disabled="submitting" @click="send('useful')">有用</button>
        <button type="button" :disabled="submitting" @click="send('not-useful')">无用</button>
        <button type="button" :disabled="submitting" :aria-expanded="correcting" @click="correcting = !correcting">需修正</button>
        <div v-if="correcting" class="correction">
          <label>修正说明（可选，≤{{ DISCLOSURE_WATCH_FEEDBACK_NOTE_MAX }} 字）<textarea v-model="note" rows="2" :maxlength="DISCLOSURE_WATCH_FEEDBACK_NOTE_MAX" data-testid="watch-feedback-note" /></label>
          <small :class="{ over: noteLength > DISCLOSURE_WATCH_FEEDBACK_NOTE_MAX }">{{ noteLength }} / {{ DISCLOSURE_WATCH_FEEDBACK_NOTE_MAX }}</small>
          <button type="button" :disabled="submitting || noteLength > DISCLOSURE_WATCH_FEEDBACK_NOTE_MAX" @click="send('needs-correction')">提交修正</button>
        </div>
        <p v-if="submitting" class="pending" role="status">评价提交中…</p>
        <p v-else-if="feedback?.status === 'error'" class="error" role="alert">评价提交失败：{{ feedback.message }}</p>
      </template>
    </div>
  </article>
</template>

<style scoped>
/* 事项行：不用阴影卡片。重点项（card）左侧 3px 主色条、其余为细分隔线清单；对象名是第一视觉锚点。 */
.watch-item{display:grid;gap:6px;padding:10px 0 10px 14px;border-left:3px solid transparent;color:var(--text);min-width:0}
.watch-item.card{border-left-color:var(--primary);padding:10px 0 10px 14px}
.watch-item.card.review{border-left-color:var(--warning)}
.watch-item.row{padding:10px 4px;border-left:0;border-top:1px solid var(--line-soft)}
.watch-item.row:first-of-type{border-top:0}
header{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px}
.object{font-size:var(--font-lg);font-weight:600;line-height:1.3;overflow-wrap:anywhere;color:var(--text)}
.row .object{font-size:var(--font-sm)}
.level,.kind,.trial,.tags li{display:inline-flex;align-items:center;padding:0 6px;border-radius:4px;font-size:var(--font-xs);line-height:18px}
.kind{color:var(--text-soft);background:var(--panel-sub)}
.level.focus{color:var(--primary);background:var(--primary-tint)}
.level.general{color:var(--text-soft);background:var(--panel-sub)}
.level.review{color:var(--warning);background:color-mix(in srgb,var(--warning) 12%,transparent)}
.headline{margin:0;font-size:var(--font-sm);color:var(--text-body);line-height:1.55;max-width:68ch}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:6px 18px;margin:2px 0 0}
.facts div{min-width:0}
.facts .next{grid-column:1/-1}
dt{font-size:var(--font-xs);color:var(--muted);line-height:1.4}
dd{margin:0;font-size:var(--font-xs);color:var(--text-body);overflow-wrap:anywhere;line-height:1.55;font-variant-numeric:tabular-nums}
.next dd{color:var(--text)}
.trial{color:var(--warning);border:1px dashed color-mix(in srgb,var(--warning) 70%,transparent);margin-left:4px}
.tags{display:flex;flex-wrap:wrap;gap:4px;list-style:none;margin:0;padding:0}
.tags li.warn{color:var(--warning);background:color-mix(in srgb,var(--warning) 12%,transparent)}
.tags li.info{color:var(--text-soft);background:var(--panel-sub)}
.evidence summary{cursor:pointer;font-size:var(--font-xs);color:var(--primary);width:max-content}
.evidence-list{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:0}
.evidence-list li{padding:8px 0 8px 10px;border-left:2px solid var(--line);margin-left:2px}
.evidence-list li + li{border-top:1px dashed var(--line-soft)}
.evidence-list dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:3px 12px;margin:4px 0 0}
.evidence-meta,.model-version{margin:0;font-size:var(--font-xs);color:var(--text-soft)}
.evidence-meta b{margin-right:6px;color:var(--text);font-variant-numeric:tabular-nums}
.link{justify-self:start;border:0;padding:0;background:transparent;color:var(--primary);cursor:pointer;font-size:var(--font-xs);text-decoration:underline}
.feedback{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:var(--font-xs);color:var(--muted)}
.feedback .ask{margin-right:2px}
.feedback button{border:1px solid var(--line);border-radius:4px;padding:2px 10px;background:transparent;color:var(--text-soft);cursor:pointer;font-size:var(--font-xs)}
.feedback button:hover:not(:disabled){border-color:var(--primary);color:var(--primary)}
.feedback button:disabled{opacity:.5;cursor:default}
.correction{flex-basis:100%;display:grid;gap:4px}
.correction label{display:grid;gap:4px;color:var(--text-soft)}
textarea{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:4px;padding:6px 8px;background:var(--panel);color:var(--text);font:inherit;font-size:var(--font-xs);resize:vertical}
.correction small.over{color:var(--danger)}
.correction button{justify-self:start}
.done{margin:0;color:var(--success)}
.pending{margin:0}
.error{flex-basis:100%;margin:0;color:var(--danger)}
button:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
</style>
