<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AgentChatPanel from '@/components/agent/AgentChatPanel.vue'
import { evidencePayload, evidenceReport, type ReviewEvidenceSnapshot, type ReviewReportKind } from '@/services/review/reviewEvidence'

const props = defineProps<{ snapshot: ReviewEvidenceSnapshot; mode: 'analysis' | 'report'; savedDraft?: string }>()
const emit = defineEmits<{ draft: [value: string, scope: ReviewEvidenceSnapshot] }>()
const kind = ref<ReviewReportKind>('object')
const draft = ref(props.savedDraft ?? evidenceReport(props.snapshot, kind.value))
const candidate = ref(''), confirmed = ref(false), started = ref(false), feedback = ref('')
const chat = ref<InstanceType<typeof AgentChatPanel> | null>(null)
const payload = computed(() => evidencePayload(props.snapshot))
const question = computed(() => props.mode === 'report'
  ? '请基于本次复盘资料副本拟写复盘建议：已有事实、可能解释、待补证据、建议行动。引用【依据N】，保持模拟和口径说明。只出草稿，不归档，不将缺失资料补成结论。'
  : `请分析本次复盘资料副本${props.snapshot.focus ? `中 ${props.snapshot.focus} 时段` : ''}：先列可确认事实，再列可能解释及验证方法，最后给出需要交易员判断的问题。引用【依据N】。只分析，不归档，不自动创建改进措施。`)
watch(draft, value => { confirmed.value = false; emit('draft', value, props.snapshot) })
function start() { started.value = true }
function useCandidate() { draft.value += `

## 智能分析建议（待人工核实）

${candidate.value}`; candidate.value = '' }
function download() {
  const metadata = `> 复盘资料：${props.snapshot.scope.day} · ${props.snapshot.scope.objectLabel}；${props.snapshot.simulated ? '模拟演练，不计入真实绩效' : '业务留存资料，口径待核验'}；读取于 ${props.snapshot.capturedAt}

`
  const url = URL.createObjectURL(new Blob([metadata, draft.value], { type: 'text/markdown;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = `复盘草稿-${props.snapshot.scope.day}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function archive() {
  if (!confirmed.value || !draft.value.trim() || !chat.value) return
  const accepted = chat.value.ask(`我已核对下面的报告草稿，请将其按原文提交报告归档审批，保留资料性质、范围、缺口和引用，不自行补写结论；等待审批成功的工具回执后才能说已归档。

资料性质：${props.snapshot.simulated ? '模拟演练，不计入真实绩效' : '业务留存资料，非正式结算结论'}
资料读取时间：${props.snapshot.capturedAt}

${draft.value}`)
  feedback.value = accepted ? '已请求归档，请核对助手返回的审批卡。尚未归档。' : '助手正在处理上一项请求，请完成后再提交归档。'
}
</script>

<template>
  <div class="assistant-workbench">
    <p class="scope">{{ snapshot.scope.day }} · {{ snapshot.scope.objectLabel }}<strong v-if="snapshot.simulated">模拟演练</strong><span v-if="snapshot.focus">关注 {{ snapshot.focus }}</span></p>
    <p class="hint">本次分析使用打开面板时的资料副本。切换对象后重新取材；事实与建议分开，生成内容需人工核实。</p>
    <details class="sources"><summary>查看本次依据与资料缺口（{{ snapshot.entries.length }} 项）</summary><ol><li v-for="(entry, i) in snapshot.entries" :key="entry.id"><b>【依据{{ i + 1 }}】{{ entry.title }}</b><p>{{ entry.text }}</p><small>留存时点：{{ entry.at || '未核实' }}</small></li></ol><p v-for="limit in snapshot.limitations" :key="limit">{{ limit }}</p></details>
    <div class="workspace" :class="{ reporting: mode === 'report' }">
      <section v-if="mode === 'report'" class="editor">
        <header><h3>报告草稿</h3><button v-if="started" type="button" @click="chat?.ask('请基于当前资料，拟写一段不超过300字的晨会摘要，保留模拟、缺口和依据说明，只出草稿。')">拟写晨会摘要</button></header>
        <label for="review-report-draft">核对事实，补充人工结论与改进措施</label>
        <textarea id="review-report-draft" v-model="draft" rows="21" />
        <div class="actions"><button type="button" :disabled="!draft.trim()" @click="download">下载草稿</button><button v-if="candidate" type="button" @click="useCandidate">将分析建议追加到草稿</button></div>
        <label class="confirm"><input v-model="confirmed" type="checkbox" />我已核对资料性质、事实和口径</label>
        <button type="button" :disabled="!confirmed || !started || !draft.trim()" @click="archive">提交归档审批</button><p v-if="feedback" role="status">{{ feedback }}</p><p class="hint">归档通过智能助手沿用报告审批流程。收到成功回执后，可在“报告与历史专题”查看；本地下载不代表已归档。</p>
      </section>
      <section class="analysis">
        <div v-if="!started" class="start"><h3>{{ mode === 'report' ? '辅助撰写' : '分析当前对象' }}</h3><p>围绕现有事实提出解释与验证办法。分析建议不会覆盖人工草稿。</p><button type="button" @click="start">{{ mode === 'report' ? '请助手拟写建议' : '开始分析' }}</button></div>
        <AgentChatPanel v-else ref="chat" scenario="daily_review" history-key="review_object_assistant" prompt-key="reviewCenter" :initial-question="question" :context-payload="payload" :restore-last-session="false" business-only @answer="candidate = $event" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.scope, header, .actions { display:flex;align-items:center;gap:12px;flex-wrap:wrap; }.scope strong {color:var(--primary)}.hint,.scope,small {color:var(--muted);font-size:var(--font-sm);line-height:1.7}.sources {border:1px solid var(--line);padding:12px;border-radius:8px;margin-bottom:16px}.sources summary {cursor:pointer}.sources ol{max-height:230px;overflow:auto;padding-left:25px}.sources p{white-space:pre-wrap;overflow-wrap:anywhere}.workspace{min-width:0}.workspace.reporting{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}.editor,.analysis{min-width:0}.analysis{height:580px}.editor header{justify-content:space-between}h3{font-size:var(--font-lg);margin:0 0 12px}textarea{box-sizing:border-box;width:100%;resize:vertical;line-height:1.7;margin:10px 0;padding:12px;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:6px;font:inherit;font-size:var(--font-sm)}button{font:inherit;font-size:var(--font-sm);cursor:pointer;border:1px solid var(--line);border-radius:6px;padding:8px 12px;background:var(--panel);color:var(--text)}button:disabled{opacity:.45;cursor:default}button:hover{border-color:var(--primary)}.confirm{display:flex;gap:8px;margin:16px 0}.start{padding:28px;background:var(--panel-sub);border-radius:8px;line-height:1.8}.analysis :deep(.agent-panel){height:100%}@media(max-width:850px){.workspace.reporting{grid-template-columns:1fr}.analysis{height:480px}}
</style>
