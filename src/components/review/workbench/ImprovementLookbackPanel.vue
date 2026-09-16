<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { fetchAllImprovementActions, patchImprovementAction } from '@/services/review/reviewStoreClient'
import type { ImprovementActionSummary } from '@/services/review/reviewStoreApi'
import type { ReportBlock, Workpaper } from '@/services/review/workpapers'

const props = defineProps<{ draft: Workpaper; disabled?: boolean }>()
const emit = defineEmits<{ record: [value: ReportBlock]; dirty: [value: boolean]; busy: [value: boolean] }>()

const verdictLabels = { observe: '证据不足，继续回查', met: '达到预期，结束回查', unmet: '未达预期，结束本措施并另行改进' } as const
type Verdict = keyof typeof verdictLabels
const open = ref(false), loading = ref(false), saving = ref(false), error = ref(''), status = ref('')
const actions = ref<ImprovementActionSummary[]>([])
const target = ref<ImprovementActionSummary | null>(null), evidence = ref(''), verdict = ref<Verdict>('observe')
let generation = 0

// 回查日期落在本报告周期结束日之前、仍在跟进的措施，才是这份报告该回查的。没有回查日期的不强塞进来。
const due = computed(() => actions.value.filter(action => ['open', 'carried_over'].includes(action.status) && !!action.dueDate && action.dueDate <= props.draft.scope.endDate))
/**
 * 措施正文里往往先是元信息（「复盘对象：…」「来源报告：…」），真正的措施在「改进措施：」那一行。
 * 只取首行会让回查记录丢掉措施本身、同一来源的多条措施也无法区分。
 */
const measureOf = (text: string) => {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const measure = lines.find(line => line.startsWith('改进措施：'))
  return measure ? measure.slice('改进措施：'.length).trim() : (lines[0] ?? text)
}
watch(() => !!evidence.value.trim(), value => emit('dirty', value), { immediate: true })
// 保存进行中必须让外层拦住切换底稿与离开：服务端可能已把措施改成完成/继续跟进，
// 此时切走会丢掉本该写进原报告的回查段，留下一条「状态变了却无报告记录」的回查。
watch(saving, value => emit('busy', value))

async function load() {
  const ticket = ++generation
  loading.value = true; error.value = ''
  const feed = await fetchAllImprovementActions()
  if (ticket !== generation) return
  loading.value = false
  if (feed.available) actions.value = feed.actions
  else { actions.value = []; error.value = '改进记录暂时读不出来，不能据此判断本期没有待回查的措施。请稍后重试。' }
}
function toggle(event: Event) {
  const next = (event.target as HTMLDetailsElement).open
  if (open.value === next) return
  open.value = next
  if (next) void load()
}
function begin(action: ImprovementActionSummary) { target.value = action; evidence.value = ''; verdict.value = 'observe'; status.value = '' }
/**
 * 回查结论由交易员选定，系统不据报告里的数字自动判定措施有效与否。
 * 结论同时写回改进记录（注明回查所在的报告）与报告正文，两边都留得下来。
 */
async function confirm() {
  const action = target.value, text = evidence.value.trim()
  if (!action || text.length < 8 || saving.value || props.disabled) return
  const ticket = generation, conclusion = verdict.value
  saving.value = true; error.value = ''
  const report = `${props.draft.title}（${props.draft.scope.startDate}—${props.draft.scope.endDate}）`
  try {
    const saved = await patchImprovementAction(action.id, { action: `${action.action}\n回查报告：${report}\n验证记录：${text}\n验证结论：${verdictLabels[conclusion]}`, status: conclusion === 'observe' ? 'carried_over' : 'done' })
    if (ticket !== generation) return
    actions.value = actions.value.map(row => (row.id === saved.id ? saved : row))
    emit('record', { id: crypto.randomUUID(), kind: 'action', origin: 'improvement_lookback', title: '改进措施回查', text: `措施：${measureOf(action.action)}\n负责人：${action.owner || '未指定'}；回查日期：${action.dueDate}\n验证记录：${text}\n验证结论：${verdictLabels[conclusion]}` })
    target.value = null; evidence.value = ''
    status.value = conclusion === 'observe' ? '回查已记录，措施继续跟进；报告中已加入这次回查。' : '回查已记录，报告中已加入这次回查。这是人工结论，不代表已量化改进收益。'
  } catch {
    // 保存结果未确认时保留已写的验证记录，交易员核实后可直接重试。
    if (ticket === generation) error.value = '回查记录保存结果未确认，已写的验证记录仍保留。请刷新核实后再试。'
  } finally { if (ticket === generation) saving.value = false }
}
watch(() => props.draft.id, () => { generation++; actions.value = []; target.value = null; evidence.value = ''; loading.value = false; saving.value = false; error.value = ''; status.value = ''; if (open.value) void load() })
onBeforeUnmount(() => { generation++; emit('dirty', false); emit('busy', false) })
</script>

<template>
  <details class="lookback" @toggle="toggle">
    <summary>回查到期的改进措施（截至 {{ draft.scope.endDate }}）</summary>
    <div v-if="open" class="content">
      <p>列出回查日期在本报告周期结束前、仍在跟进的改进措施。是否有效由交易员依据本报告的材料判断，系统不自动关闭。</p>
      <p v-if="loading" role="status">正在读取改进记录…</p>
      <p v-else-if="error" role="alert" class="alert">{{ error }}</p>
      <p v-else-if="!due.length">本报告周期内没有到期待回查的改进措施。</p>
      <p v-if="status" role="status">{{ status }}</p>
      <article v-for="action in due" :key="action.id">
        <div><b>{{ measureOf(action.action) }}</b><p>{{ action.status === 'carried_over' ? '继续跟进' : '待落实' }} · 负责人 {{ action.owner || '未指定' }} · 回查日期 {{ action.dueDate }}</p></div>
        <button v-if="target?.id !== action.id" type="button" :disabled="disabled || saving" @click="begin(action)">在本报告中回查</button>
        <div v-else class="form">
          <label>验证记录<textarea v-model="evidence" rows="4" :disabled="disabled || saving" placeholder="说明依据本报告的哪些材料、观察到什么变化、还有什么解释不了。至少 8 个字。" /></label>
          <label>验证结论<select v-model="verdict" :disabled="disabled || saving"><option v-for="(label, value) in verdictLabels" :key="value" :value="value">{{ label }}</option></select></label>
          <div class="actions"><button type="button" class="primary" :disabled="disabled || saving || evidence.trim().length < 8" @click="confirm">{{ saving ? '正在保存…' : '保存回查并加入报告' }}</button><button type="button" :disabled="saving" @click="target = null; evidence = ''">取消</button></div>
        </div>
      </article>
    </div>
  </details>
</template>

<style scoped>
.lookback{border-top:1px solid var(--line);padding-top:14px;margin-top:14px}
.content{display:grid;gap:12px;padding-top:12px}
summary,button{cursor:pointer}
p{font-size:var(--font-sm);color:var(--muted);line-height:1.7;margin:0}
.alert{color:var(--danger,#c0392b)}
article{border-bottom:1px solid var(--line);padding:10px 0;display:grid;gap:8px}
article b{font-size:var(--font-sm);white-space:pre-wrap;overflow-wrap:anywhere}
.form{display:grid;gap:8px}
label{display:grid;gap:6px;font-size:var(--font-sm)}
textarea{box-sizing:border-box;width:100%;resize:vertical;line-height:1.6}
.actions{display:flex;gap:10px;flex-wrap:wrap}
button,select,textarea{font:inherit;font-size:var(--font-sm);padding:8px 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text)}
button:disabled{opacity:.5;cursor:default}
button:focus-visible,select:focus-visible,summary:focus-visible,textarea:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
</style>
