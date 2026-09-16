<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { reviewWritingModes, type ReviewWritingInput, type ReviewWritingMode } from '@/prompts/reviewWriting'
import { suggestReviewWriting, type WritingCandidate } from '@/services/review/reviewWriting'
const props = defineProps<{ input: ReviewWritingInput; companyId: string; region: string; initialMode?: ReviewWritingMode }>()
const emit = defineEmits<{ adopt: [text: string, append: boolean]; close: [] }>()
const mode = ref<ReviewWritingMode>(props.initialMode ?? 'polish'), loading = ref(false), error = ref(''), confirmed = ref(false), candidate = ref<WritingCandidate | null>(null)
const selectedSources = ref(props.input.evidence.map((_item, index) => index))
// 候选文字可先删改再采纳，待核实事项逐条决定是否保留：局部采纳不必整段照搬。
const editedText = ref(''), keptUncertainties = ref<number[]>([])
const requestInput = computed(() => ({ ...props.input, evidence: props.input.evidence.filter((_item, index) => selectedSources.value.includes(index)) }))
let sequence = 0, controller: AbortController | null = null
function clear() { ++sequence; controller?.abort(); loading.value = false; candidate.value = null; confirmed.value = false; error.value = ''; editedText.value = ''; keptUncertainties.value = [] }
// 「已核对」针对的是当前这版文字与事项：改了文字或增减待核实事项都要重新核对，不能沿用改动前的勾选。
watch([editedText, keptUncertainties], () => { confirmed.value = false }, { deep: true })
function resetEdits() { if (!candidate.value) return; editedText.value = candidate.value.text; keptUncertainties.value = candidate.value.uncertainties.map((_item, index) => index) }
watch(() => JSON.stringify(props.input.evidence), () => { selectedSources.value = props.input.evidence.map((_item, index) => index) })
watch(() => JSON.stringify([requestInput.value, props.companyId, props.region, mode.value]), clear)
onBeforeUnmount(clear)
async function generate() {
  clear(); const ticket = sequence; controller = new AbortController(); loading.value = true
  const input = JSON.parse(JSON.stringify(requestInput.value)) as ReviewWritingInput
  if (!input.text.trim() && !input.evidence.length) { loading.value = false; error.value = '请先填写原文或将分析材料加入正文，再生成建议。'; return }
  try { const value = await suggestReviewWriting(input, mode.value, { companyId: props.companyId, region: props.region }, controller.signal); if (ticket === sequence) { candidate.value = value; resetEdits() } }
  catch (e) { if (ticket === sequence) error.value = e instanceof Error && e.message === '所选材料较多，请缩小范围后再生成建议' ? e.message : '智能建议暂未生成，或返回的引用未通过检查。可以继续人工编辑、保存和发布。' }
  finally { if (ticket === sequence) loading.value = false }
}
const citations = (text: string) => new Set(Array.from(text.matchAll(/【材料(\d+)】/g), match => Number(match[1])))
// 来源随编辑后的文字走：删掉引用某份材料的句子，就不再附这份材料；模型只在清单里列出、正文没引用的来源照常保留。
const adoptedRefs = computed(() => {
  if (!candidate.value) return []
  const inOriginal = citations(candidate.value.text)
  return [...new Set([...citations(editedText.value), ...candidate.value.evidenceRefs.filter(id => !inOriginal.has(id))])].sort((a, b) => a - b)
})
const adoptProblem = computed(() => {
  if (!candidate.value) return ''
  if (!editedText.value.trim()) return '候选文字已清空，请恢复或填写后再采纳。'
  if (adoptedRefs.value.some(id => !Number.isInteger(id) || id < 1 || id > requestInput.value.evidence.length)) return '文字里引用了本次没有选用的材料编号，请修改后再采纳。'
  return ''
})
const adoptedText = computed(() => {
  const value = candidate.value
  if (!value) return ''
  const kept = value.uncertainties.filter((_item, index) => keptUncertainties.value.includes(index))
  return [...(mode.value === 'causes' ? ['待核实原因建议：'] : []), editedText.value.trim(),
    ...(kept.length ? ['待核实事项：', ...kept.map(item => `· ${item}`)] : []),
    ...adoptedRefs.value.map(id => `【材料${id}】${requestInput.value.evidence[id - 1]}`),
  ].join('\n\n')
})
function adopt(append: boolean) { if (confirmed.value && candidate.value && !adoptProblem.value) emit('adopt', adoptedText.value, append) }
</script>
<template>
  <section class="writing-assistant" aria-label="段落写作辅助">
    <header><b>辅助撰写 · {{ input.title }}</b><button type="button" @click="emit('close')">收起</button></header>
    <p>建议仅依据当前文字和已收集材料生成。原文保留，核对后再采纳。</p>
    <div class="actions"><select v-model="mode" aria-label="写作辅助方式"><option v-for="(label, key) in reviewWritingModes" :key="key" :value="key">{{ label }}</option></select><button type="button" :disabled="loading" @click="generate">{{ loading ? '正在生成…' : '生成候选文字' }}</button><button v-if="loading" type="button" @click="clear">取消生成</button></div>
    <details><summary>选择发送给助手的材料（已选 {{ selectedSources.length }}/{{ input.evidence.length }} 项）</summary><ol><li v-for="(item, index) in input.evidence" :key="index"><label><input v-model="selectedSources" type="checkbox" :value="index" :aria-label="`选用第${index + 1}项材料`" />{{ item }}</label></li></ol><p>建议中的材料编号按本次选用顺序排列，采纳时会一并附上来源。</p></details>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="candidate"><div class="comparison"><div><b>原文</b><p>{{ input.text || '尚未填写' }}</p></div><div><b>候选文字（可删改后再采纳）</b><textarea v-model="editedText" aria-label="编辑候选文字" rows="8" /><button v-if="editedText !== candidate.text || keptUncertainties.length !== candidate.uncertainties.length" type="button" @click="resetEdits">恢复候选原文</button><fieldset v-if="candidate.uncertainties.length"><legend>待核实事项（勾选的随文字一起采纳）</legend><label v-for="(item, index) in candidate.uncertainties" :key="index"><input v-model="keptUncertainties" type="checkbox" :value="index" :aria-label="`保留待核实事项${index + 1}`" />{{ item }}</label></fieldset></div></div><p v-if="adoptProblem" role="alert">{{ adoptProblem }}</p><label><input v-model="confirmed" type="checkbox" aria-label="核对建议" />我已核对候选文字、引用和待核实事项</label><div class="actions"><button type="button" :disabled="!confirmed || !!adoptProblem" @click="adopt(false)">采用到当前段落</button><button type="button" :disabled="!confirmed || !!adoptProblem" @click="adopt(true)">追加到当前段落</button><button type="button" @click="clear">放弃建议</button></div></template>
  </section>
</template>
<style scoped>
.writing-assistant{border:1px solid var(--primary);border-radius:8px;padding:16px;display:grid;gap:12px;margin:14px 0}header,.actions,label{display:flex;gap:10px;align-items:center;flex-wrap:wrap}header{justify-content:space-between}p,li{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;font-size:var(--font-sm)}p{margin:0}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:18px}.comparison>div{min-width:0;padding:12px;background:var(--panel-sub);border-radius:6px;display:grid;gap:8px;align-content:start}textarea{width:100%;box-sizing:border-box;font:inherit;font-size:var(--font-sm);line-height:1.7;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text);resize:vertical}fieldset{border:0;padding:0;margin:0;display:grid;gap:6px}legend{font-size:var(--font-sm);color:var(--muted);margin-bottom:4px}button,select{padding:8px;border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:6px;font:inherit;font-size:var(--font-sm)}button,summary{cursor:pointer}button:disabled{opacity:.5;cursor:default}details ol{max-height:180px;overflow:auto}button:focus-visible,select:focus-visible{outline:2px solid var(--primary);outline-offset:2px}@media(max-width:700px){.comparison{grid-template-columns:1fr}}
</style>
