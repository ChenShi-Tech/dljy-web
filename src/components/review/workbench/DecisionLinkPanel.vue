<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { declarationLabel } from '@/services/review/decisionWorkbench'
import { loadPeriodDecisions } from '@/services/review/periodDecisions'
import { decisionLinkError, previewDecisionReference, type DecisionReference, type Workpaper } from '@/services/review/workpapers'
import type { DeclarationMode, DeclarationOrder } from '@/services/declarations'
import DecisionReferenceCard from './DecisionReferenceCard.vue'

const props = defineProps<{ company: string; draft: Workpaper; disabled?: boolean }>()
const emit = defineEmits<{ link: [value: { reference: DecisionReference; text: string }]; open: [value: DecisionReference] }>()

const open = ref(false), loading = ref(false), previewing = ref(false), error = ref(''), mode = ref<'' | DeclarationMode>('')
const rows = ref<DeclarationOrder[]>([]), offset = ref(0), nextOffset = ref<number | null>(null), omitted = ref(0)
const preview = ref<DecisionReference | null>(null)
// 关联依据由交易员自己写，预览失败或版本冲突都不清空：重填一遍理由是纯粹的返工。
const basis = ref('')
// 上一次核对的是哪一笔申报。换一笔（含先点「换一笔」清掉预览再选另一笔）必须清理由，
// 否则新申报一打开就带着上一笔的理由且确认键可用，理由会挂到错误的申报上。
const lastDeclarationId = ref('')
let generation = 0

function reset() { ++generation; rows.value = []; nextOffset.value = null; omitted.value = 0; error.value = ''; loading.value = false; previewing.value = false }
async function load(page = 0) {
  reset(); offset.value = page
  if (!open.value) return
  const ticket = generation
  loading.value = true
  try {
    const period = { start: props.draft.scope.startDate, end: props.draft.scope.endDate }
    const result = await loadPeriodDecisions(props.company, props.draft.scope.region, period, page, mode.value || undefined)
    if (ticket !== generation) return
    rows.value = result.rows; nextOffset.value = result.nextOffset; omitted.value = result.omitted
  } catch { if (ticket === generation) error.value = '申报记录暂时无法读取，不能据此判断本周期没有决策。请重试。' }
  finally { if (ticket === generation) loading.value = false }
}
async function choose(order: DeclarationOrder) {
  const ticket = generation
  // 同一笔申报重新核对版本走的是同一个 id，理由保留；换了 id 就清。
  if (lastDeclarationId.value && lastDeclarationId.value !== order.id) basis.value = ''
  lastDeclarationId.value = order.id
  previewing.value = true; error.value = ''; preview.value = null
  try {
    const result = await previewDecisionReference(props.company, props.draft, order.id)
    if (ticket === generation) preview.value = result
  } catch (e) { if (ticket === generation) error.value = decisionLinkError(e) }
  finally { if (ticket === generation) previewing.value = false }
}
/** 版本变化后重新核对：再预览一次拿最新版本，交易员已写的关联依据保持不动。 */
async function recheck() { if (preview.value) await choose(preview.value.snapshot) }
function confirm() {
  if (!preview.value || !basis.value.trim()) return
  emit('link', { reference: preview.value, text: basis.value.trim() })
  preview.value = null; basis.value = ''; lastDeclarationId.value = ''; open.value = false; reset()
}
watch(() => [props.company, props.draft.id, props.draft.scope.startDate, props.draft.scope.endDate, mode.value], (next, previous) => {
  preview.value = null
  // 同一份底稿内重试保留已写的理由（重填一遍是纯返工），但换了底稿、公司或复盘范围就必须
  // 清掉：否则上一份报告的关联依据会预填在新报告里，并可能被确认进错误的报告。
  // 筛选条件（mode）变化不算，那只是换了看哪一批申报。
  if (previous && [0, 1, 2, 3].some(index => next[index] !== previous[index])) { basis.value = ''; lastDeclarationId.value = '' }
  void load()
}, { flush: 'sync' })
onBeforeUnmount(reset)
</script>

<template>
  <details class="decision-link" @toggle="event => { const next = (event.target as HTMLDetailsElement).open; if (open === next) return; open = next; next ? void load() : reset() }">
    <summary>关联本周期申报 · {{ draft.scope.startDate }}—{{ draft.scope.endDate }}</summary>
    <div v-if="open" class="content">
      <p>只能关联当前公司、地区且交易日落在本次复盘周期内的申报。关联由交易员明确建立，不代表这笔申报就是结果的原因。</p>
      <div class="controls"><label>记录类型<select v-model="mode" :disabled="disabled"><option value="">全部</option><option value="LIVE">业务申报</option><option value="REHEARSAL">模拟演练</option></select></label><button type="button" :disabled="loading || disabled" @click="load(offset)">刷新记录</button></div>
      <p v-if="loading" role="status">正在读取本周期申报…</p>
      <p v-if="error" role="alert" class="alert">{{ error }}</p>
      <template v-if="preview">
        <h4>核对这笔申报</h4>
        <DecisionReferenceCard :reference="preview" @open="emit('open', $event)" />
        <label>关联依据（必填）<textarea v-model="basis" rows="3" :disabled="disabled" placeholder="写清为什么把这笔申报作为本次复盘的依据，例如它决定了当日的报量与报价区间" /></label>
        <div class="controls">
          <button type="button" :disabled="!basis.trim() || previewing || disabled" @click="confirm">确认关联并加入报告</button>
          <button type="button" :disabled="previewing || disabled" @click="recheck">{{ previewing ? '正在重新核对…' : '重新核对版本' }}</button>
          <button type="button" :disabled="previewing" @click="preview = null">换一笔</button>
        </div>
      </template>
      <template v-else-if="!loading">
        <p v-if="!rows.length && !error">本周期内没有当前公司和地区的申报记录。{{ nextOffset !== null ? '仍有后续记录，可继续查看。' : '' }}</p>
        <p v-if="omitted">本批有 {{ omitted }} 条地区未明确或范围不符的记录，不能用于关联。</p>
        <ul><li v-for="row in rows" :key="row.id"><div><b>{{ row.targetDate }} · {{ declarationLabel(row) }}</b><p>{{ row.quoteRationale || '未留存报价依据，需核实原始记录。' }}</p></div><button type="button" :disabled="previewing || disabled" @click="choose(row)">核对并关联</button></li></ul>
        <div v-if="offset || nextOffset !== null" class="controls"><button type="button" :disabled="offset === 0" @click="load(Math.max(0, offset - 20))">上一批</button><span>第 {{ Math.floor(offset / 20) + 1 }} 批</span><button type="button" :disabled="nextOffset === null" @click="nextOffset !== null && load(nextOffset)">下一批</button></div>
      </template>
    </div>
  </details>
</template>

<style scoped>
.decision-link{border-top:1px solid var(--line);padding-top:14px;margin-top:14px}
.content{display:grid;gap:12px;padding-top:12px}
summary,button{cursor:pointer}
p{font-size:var(--font-sm);color:var(--muted);line-height:1.7;margin:0}
.alert{color:var(--danger,#c0392b)}
h4{margin:0;font-size:var(--font-sm)}
.controls,li,label{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
label{display:block;font-size:var(--font-sm)}
textarea{box-sizing:border-box;width:100%;display:block;margin-top:7px;resize:vertical;line-height:1.6}
ul{list-style:none;margin:0;padding:0}
li{padding:12px 0;border-bottom:1px solid var(--line)}
li>div{flex:1;min-width:200px}
li p{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:6px}
b{font-size:var(--font-sm)}
button,select,textarea{font:inherit;font-size:var(--font-sm);padding:8px 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text)}
button:disabled{opacity:.5;cursor:default}
button:focus-visible,select:focus-visible,summary:focus-visible,textarea:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
</style>
