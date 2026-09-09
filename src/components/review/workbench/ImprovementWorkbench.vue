<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { createImprovementAction, fetchImprovementActions, patchImprovementAction } from '@/services/review/reviewStoreClient'
import type { ImprovementActionSummary } from '@/services/review/reviewStoreApi'
import { isRealCalendarDate } from '@/utils/calendarDate'
const props = defineProps<{ context: string; focus: string }>()
const actions = ref<ImprovementActionSummary[]>([])
const loaded = ref(false), loading = ref(false), saving = ref(false)
const error = ref(''), feedback = ref('')
const change = ref(''), owner = ref(''), due = ref(''), verification = ref('')
const filter = ref('open'), search = ref('')
const validating = ref<ImprovementActionSummary | null>(null), evidence = ref('')
const verdict = ref<'observe' | 'met' | 'unmet'>('observe')
const verdictLabels = { observe: '证据不足，继续回查', met: '达到预期，结束回查', unmet: '未达预期，结束本措施并另行改进' }
const canSave = computed(() => change.value.trim().length >= 8 && owner.value.trim() && isRealCalendarDate(due.value) && verification.value.trim().length >= 8)
const shown = computed(() => actions.value.filter(a => (filter.value === 'all' || (filter.value === 'open' ? ['open', 'carried_over'].includes(a.status) : a.status === 'done')) && `${a.action} ${a.owner ?? ''}`.includes(search.value.trim())))
const statusLabel = { open: '待落实', carried_over: '继续跟进', done: '已记录验证', dropped: '已撤回' }
async function load() {
  loading.value = true; loaded.value = false; error.value = ''; actions.value = []
  const feed = await fetchImprovementActions()
  if (feed.available) { actions.value = feed.actions; loaded.value = true }
  else error.value = feed.reason === 'unauthorized' ? '当前账号无权查看改进记录。' : '改进记录暂时无法读取，请重试。当前不能确认待办数量。'
  loading.value = false
}
async function save() {
  if (!canSave.value || saving.value) return
  saving.value = true; error.value = ''; feedback.value = ''
  try {
    const saved = await createImprovementAction({ action: `复盘对象：${props.context}${props.focus ? `；关注时段：${props.focus}` : ''}\n改进措施：${change.value.trim()}\n验证办法：${verification.value.trim()}`, owner: owner.value.trim(), dueDate: due.value })
    actions.value = [saved, ...actions.value.filter(a => a.id !== saved.id)]
    change.value = ''; verification.value = ''; feedback.value = '改进措施已保存。后续完成时，需要补充实际验证记录。'
  } catch { error.value = '保存结果暂未确认，请刷新记录核实后重试。填写内容仍保留。' }
  finally { saving.value = false }
}
async function complete() {
  if (!validating.value || evidence.value.trim().length < 8 || saving.value) return
  saving.value = true; error.value = ''
  try {
    const a = validating.value
    const conclusion = verdict.value
    const saved = await patchImprovementAction(a.id, { action: `${a.action}\n验证记录：${evidence.value.trim()}\n验证结论：${verdictLabels[conclusion]}`, status: conclusion === 'observe' ? 'carried_over' : 'done' })
    actions.value = actions.value.map(row => row.id === saved.id ? saved : row)
    validating.value = null; evidence.value = ''; feedback.value = conclusion === 'observe' ? '验证记录已保存；证据不足，措施继续跟进。' : '验证记录已保存。该记录是人工确认，尚不能据此认定改进带来了多少收益。'
  } catch { error.value = '验证记录保存结果暂未确认，请刷新核实后重试。' }
  finally { saving.value = false }
}
onMounted(load)
</script>
<template>
  <div class="actions-workbench">
    <section class="panel action-form"><header><h2>把发现变成一次可验证的改进</h2><p>复盘对象：{{ context }}<span v-if="focus"> · {{ focus }}</span></p></header>
      <form @submit.prevent="save"><label class="wide">下一次具体改变什么<textarea v-model="change" rows="3" minlength="8" required placeholder="说明触发条件和具体动作，例如：当晚峰预测区间明显变宽时，补充极端情景核验再确定申报量。" /></label><label>负责人<input v-model="owner" required placeholder="填写实际负责人" /></label><label>回查日期<input v-model="due" type="date" required /></label><label class="wide">怎样判断这次改进有效<textarea v-model="verification" rows="2" minlength="8" required placeholder="写明比较对象、观察周期和通过条件，避免只写‘加强关注’。" /></label><div class="wide submit"><p>保存后进入公司改进记录，不会自动修改预测模型、申报单或风控限额。</p><button class="primary" type="submit" :disabled="!canSave || saving">{{ saving ? '保存中…' : '保存改进措施' }}</button></div></form>
    </section>
    <p v-if="error" role="alert" class="notice">{{ error }}</p><p v-if="feedback" role="status" class="notice">{{ feedback }}</p>
    <section class="panel list"><header><div><h2>跟进与回查</h2><p>当前账号可见的公司改进记录，覆盖历史复盘对象。</p></div><button type="button" :disabled="loading || saving" @click="load">刷新记录</button></header><div class="filters"><label>状态 <select v-model="filter"><option value="open">待落实与继续跟进</option><option value="done">已记录验证</option><option value="all">全部</option></select></label><input v-model="search" type="search" aria-label="搜索改进记录" placeholder="搜索措施、对象或负责人" /></div>
      <p v-if="loading">正在读取改进记录…</p><p v-else-if="loaded && !shown.length">当前筛选下没有改进记录。</p>
      <article v-for="a in shown" :key="a.id"><div class="meta"><b>{{ statusLabel[a.status] }}</b><span>{{ a.owner || '未指定负责人' }}</span><span>回查日期 {{ a.dueDate || '未指定' }}</span></div><p class="content">{{ a.action }}</p><button v-if="['open', 'carried_over'].includes(a.status)" type="button" @click="validating = a; evidence = ''; verdict = 'observe'">补充验证记录</button></article>
    </section>
    <el-dialog :model-value="!!validating" title="记录实际验证情况" width="min(620px, 94vw)" @close="validating = null"><p>说明做了什么、使用了哪些实际结果，以及通过或未通过的原因。证据不足时，请继续跟进。</p><label>验证记录<textarea v-model="evidence" rows="5" placeholder="例如：复核了调整后的交易日，附比较口径、观察到的变化及仍不能解释的问题。" /></label><label>验证结论<select v-model="verdict"><option v-for="(text, value) in verdictLabels" :key="value" :value="value">{{ text }}</option></select></label><p v-if="error" role="alert">{{ error }}</p><template #footer><button type="button" :disabled="saving" @click="validating = null">继续跟进</button><button class="primary" type="button" :disabled="saving || evidence.trim().length < 8" @click="complete">保存验证记录</button></template></el-dialog>
  </div>
</template>
<style scoped>
.actions-workbench { display: grid; gap: 16px; } .action-form, .list { padding: 20px; } header { display: flex; justify-content: space-between; flex-wrap: wrap; align-items: start; gap: 12px; } .action-form header { display: block; } h2 { font-size: var(--font-lg); margin: 0; } p { color: var(--muted); font-size: var(--font-sm); line-height: 1.7; } form { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } label { display: flex; flex-direction: column; gap: 8px; font-size: var(--font-sm); } .wide { grid-column: 1 / -1; } input, textarea, select, button { font: inherit; font-size: var(--font-sm); color: var(--text); border: 1px solid var(--line); background: var(--panel); border-radius: 6px; padding: 9px 12px; } textarea { resize: vertical; width: 100%; box-sizing: border-box; line-height: 1.7; } button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } .primary { background: var(--primary); border-color: var(--primary); color: white; } .submit { display: flex; align-items: center; justify-content: space-between; gap: 12px; } .submit p { flex: 1; } .filters { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; margin: 10px 0; } .filters label { flex-direction: row; align-items: center; } article { padding: 16px 0; border-top: 1px solid var(--line); } .meta { display: flex; flex-wrap: wrap; gap: 16px; font-size: var(--font-sm); } .content { white-space: pre-wrap; color: var(--text); overflow-wrap: anywhere; } .notice { padding: 12px; background: var(--panel-sub); border-radius: 8px; } @media(max-width: 600px) { form { grid-template-columns: 1fr; } .submit { align-items: stretch; flex-direction: column; } }
</style>
