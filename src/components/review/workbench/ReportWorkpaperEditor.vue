<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { activeStanceType } from '@/services/stance/stanceContext'
import { addReportComment, createWorkpaper, getWorkpaper, getReportPublication, listReportPublications, listReportComments, listWorkpapers, publishWorkpaper, saveWorkpaper, workpaperError, type DecisionReference, type Publication, type ReportBlock, type ReportComment, type ReportEvidence, type ReviewSegment, type Workpaper, type WorkpaperScope } from '@/services/review/workpapers'
import type { ReviewEvidenceSnapshot } from '@/services/review/reviewEvidence'
import { useRouter } from 'vue-router'
import DecisionLinkPanel from './DecisionLinkPanel.vue'
import DecisionReferenceCard from './DecisionReferenceCard.vue'
import EvidenceSegmentPicker from './EvidenceSegmentPicker.vue'
import ImprovementLookbackPanel from './ImprovementLookbackPanel.vue'
import { createImprovementAction } from '@/services/review/reviewStoreClient'
import PublishedReportReader from './PublishedReportReader.vue'
import ReportEvidenceChart from './ReportEvidenceChart.vue'
import ReportWritingAssistant from './ReportWritingAssistant.vue'
import { rendersMaterial, reportEvidenceCaption, segmentCaption } from '@/services/review/reportPresentation'

const props = defineProps<{ snapshot: ReviewEvidenceSnapshot; material?: ReportEvidence | null }>()
const emit = defineEmits<{ dirty: [value: boolean] }>()
const company = props.snapshot.scope.company, region = props.snapshot.scope.region
const papers = ref<Workpaper[]>([]), draft = ref<Workpaper | null>(null), evidence = ref<ReportEvidence[]>([])
const versions = ref<Array<{ id: string; revision: number; title: string }>>([]), versionsMore = ref(false)
const comments = ref<ReportComment[]>([]), publication = ref<Publication | null>(null)
const listMore = ref(false), commentsMore = ref(false), loading = ref(false), saving = ref(false), publishing = ref(false)
const dirty = ref(false), confirmed = ref(false), error = ref(''), status = ref(''), commentText = ref(''), commentTarget = ref('')
const creationId = ref(crypto.randomUUID()), commentId = ref(crypto.randomUUID())
const view = ref<WorkpaperScope['view']>(props.snapshot.scope.businessView ?? (activeStanceType.value === 'RETAILER' ? 'retail' : activeStanceType.value === 'STORAGE' ? 'storage' : 'generator'))
const canEdit = computed(() => draft.value?.canEdit === true)
const writingTarget = ref('')
const writingInput = computed(() => {
  const paper = draft.value, target = paper?.blocks.find(block => block.id === writingTarget.value)
  if (!paper || (!target && writingTarget.value !== 'summary')) return null
  return { scope: `${props.snapshot.scope.companyLabel || '当前公司'} · ${props.snapshot.scope.regionLabel || '当前地区'} · ${paper.scope.startDate}—${paper.scope.endDate} · ${paper.scope.objectLabel}`,
    title: target ? target.title || '当前段落' : '管理层摘要', text: target?.text ?? paper.summary,
    evidence: [...(target?.segments?.length ? [`这段解释针对的时段：${segmentCaption(target, evidence.value.find(item => item.id === target.evidenceId))}`] : []),...evidence.value.filter(item => paper.blocks.some(block => block.evidenceId === item.id)).map(item => {
      const range = item.content.result.periods.current
      const primary = item.content.input.scope.objectId === paper.scope.objectId && range.start >= paper.scope.startDate && range.end <= paper.scope.endDate
      return `${primary ? '本次对象材料' : '比较材料（其他对象或周期），不可视为本次结果'}；${item.content.labels.join('与')}；${range.start}—${range.end}；${reportEvidenceCaption(item)}`
    }),
      ...(writingTarget.value === 'summary' ? paper.blocks.filter(block => block.text.trim()).map(block => `人工记录：${block.title}；${block.state === 'confirmed' ? '交易员已核实' : '原文仍需判断'}。${block.text}`) : [])],
  }
})
function adoptWriting(text: string, append: boolean) {
  if (!draft.value || !canEdit.value || publishing.value) return
  const block = draft.value.blocks.find(item => item.id === writingTarget.value)
  const original = writingTarget.value === 'summary' ? draft.value.summary : block?.text
  if (original === undefined) return
  const next = append && original.trim() ? `${original}\n\n${text}` : text
  if (next.length > 20000) { error.value = '采纳后文字过长，请先精简候选内容或拆分段落'; return }
  if (writingTarget.value === 'summary') draft.value.summary = next
  else if (block) { block.text = next; if (block.kind === 'reason') block.state = 'pending' }
  writingTarget.value = ''; status.value = '建议已加入底稿，原因仍需交易员核实'
}
const blockNames: Record<ReportBlock['kind'], string> = { text: '事实与说明', chart: '图表与统计', reason: '原因与判断', question: '待核实问题', action: '改进措施', decision: '关联决策' }
const router = useRouter()
/**
 * 关联块只在这里新建：申报副本由服务端在保存时重新读取并冻结，这里放的 reference 仅供
 * 交易员当场核对。已保存的关联不会随源申报变化而更新，要换版本必须重新核对再建一块。
 */
function linkDecision({ reference, text }: { reference: DecisionReference; text: string }) {
  if (!draft.value || !canEdit.value) return
  draft.value.blocks.push({ id: crypto.randomUUID(), kind: 'decision', title: `${reference.targetDate} 交易日申报`, text, declarationId: reference.declarationId, decisionVersion: reference.version, reference })
  status.value = '已加入关联决策，保存后由服务端核对申报版本'
}
/** 跨路由跳转交给父级的离开守卫拦未保存内容，这里不重复确认。 */
function openDeclaration(reference: DecisionReference) {
  void router.push({ path: '/xhjy/desk', query: { declarationId: reference.declarationId, targetDate: reference.targetDate } })
}
let alive = true, suppress = false, editVersion = 0, timer: ReturnType<typeof setTimeout> | null = null, savingTask: Promise<boolean> | null = null
let paperGeneration = 0, publicationRequest = 0
const commenting = ref(false), linkPending = ref(false), lookbackPending = ref(false)
// 报告内登记改进措施的表单状态；需先于 pending 声明，pending 会立即求值。
const registerTarget = ref(''), registerOwner = ref(''), registerDue = ref(''), registering = ref(false)
const pending = computed(() => dirty.value || saving.value || publishing.value || commenting.value || linkPending.value || lookbackPending.value || !!registerTarget.value || !!commentText.value.trim())
watch(pending, value => emit('dirty', value), { immediate: true })
// 发布确认必须覆盖全部待定内容：勾选「已核对」之后再写关联依据，旧的勾选不能代表新内容已核对。
// 任何未落进正文的输入都会被发布版本漏掉：未确认的关联依据、未保存的回查记录、打开着的措施登记表单。
const publishBlocked = computed(() => linkPending.value || lookbackPending.value || !!registerTarget.value)
watch(publishBlocked, value => { if (value) confirmed.value = false })
watch(draft, () => {
  if (suppress || !draft.value || !canEdit.value) return
  editVersion++; dirty.value = true; confirmed.value = false; publication.value = null
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void save() }, 900)
}, { deep: true, flush: 'sync' })
function assignPaper(value: Workpaper) {
  paperGeneration++; publicationRequest++
  registerTarget.value = ''
  writingTarget.value = ''
  comments.value = []; commentsMore.value = false; commentTarget.value = ''; commentText.value = ''; commentId.value = crypto.randomUUID()
  suppress = true; draft.value = value; evidence.value = value.evidence ?? []; suppress = false
  dirty.value = false; versions.value = []; error.value = ''; status.value = '底稿已读取'; publication.value = null; confirmed.value = false
  if (props.material && value.canEdit && !value.blocks.some(block => block.evidenceId === props.material?.id)) {
    const material = props.material
    evidence.value.push(material)
    const source = material.content.input.scope, range = material.content.result.periods.current
    const primary = source.objectId === value.scope.objectId && range.start >= value.scope.startDate && range.end <= value.scope.endDate
    if (!primary) { status.value = '新材料范围不同，请在材料块中选择“比较依据”后保存'; return }
    draft.value!.blocks.push({ id: crypto.randomUUID(), kind: 'chart', title: material.content.labels.join('与'), text: '', evidenceId: material.id, evidenceRole: 'primary' })
  }
}
async function list(more = false) {
  loading.value = true; error.value = ''
  try { const page = await listWorkpapers(company, region, more ? papers.value.length : 0); if (alive) { papers.value = more ? [...papers.value, ...page.rows] : page.rows; listMore.value = page.hasMore } }
  catch (e) { if (alive) error.value = workpaperError(e) } finally { if (alive) loading.value = false }
}
async function open(id: string) {
  if (pending.value && !window.confirm('切换底稿会放弃未保存的文字或批注，确定切换吗？')) return
  paperGeneration++; publicationRequest++; publication.value = null
  if (savingTask) await savingTask
  if (timer) clearTimeout(timer)
  loading.value = true; error.value = ''; comments.value = []; commentText.value = ''
  try { const value = await getWorkpaper(company, region, id); if (alive) { assignPaper(value); await loadComments(); await loadVersions() } }
  catch (e) { if (alive) error.value = workpaperError(e) } finally { if (alive) loading.value = false }
}
async function create() {
  if (pending.value) { error.value = '请先保存当前底稿和批注'; return }
  paperGeneration++; publicationRequest++; publication.value = null
  const scope: WorkpaperScope = { region, view: view.value, objectId: props.snapshot.scope.objectKey || 'company-overview', objectLabel: props.snapshot.scope.objectLabel, startDate: props.snapshot.scope.period?.start || props.snapshot.scope.day, endDate: props.snapshot.scope.period?.end || props.snapshot.scope.day }
  loading.value = true
  try {
    const value = await createWorkpaper(company, scope, creationId.value, `${scope.startDate} ${scope.objectLabel}复盘`)
    if (alive) { assignPaper({ ...value, canEdit: true }); creationId.value = crypto.randomUUID(); papers.value = [value, ...papers.value.filter(row => row.id !== value.id)] }
  } catch (e) { if (alive) error.value = workpaperError(e) } finally { if (alive) loading.value = false }
}
function save(): Promise<boolean> {
  if (savingTask) return savingTask
  if (!draft.value || !canEdit.value || !dirty.value) return Promise.resolve(!dirty.value)
  const captured = JSON.parse(JSON.stringify(draft.value)) as Workpaper, version = editVersion
  saving.value = true; error.value = ''
  savingTask = (async () => {
    try {
      const result = await saveWorkpaper(company, captured)
      if (!alive) return true
      suppress = true; draft.value!.revision = result.revision; draft.value!.updatedAt = result.updatedAt; suppress = false
      if (editVersion === version) dirty.value = false
      status.value = dirty.value ? '已保存前一次修改，正在等待后续修改保存' : '已自动保存到服务器'
      return !dirty.value
    } catch (e) { if (alive) error.value = workpaperError(e); return false }
    finally { if (alive) { saving.value = false; savingTask = null; if (dirty.value && !error.value) { if (timer) clearTimeout(timer); timer = setTimeout(() => { void save() }, 900) } } }
  })()
  return savingTask
}
function add(kind: ReportBlock['kind']) {
  if (!canEdit.value || !draft.value) return
  draft.value.blocks.push({ id: crypto.randomUUID(), kind, title: blockNames[kind], text: '', ...(kind === 'reason' ? { state: 'pending' as const, supports: '', refutes: '' } : {}) })
}
function move(index: number, offset: number) {
  if (!draft.value || index + offset < 0 || index + offset >= draft.value.blocks.length) return
  const [block] = draft.value.blocks.splice(index, 1); draft.value.blocks.splice(index + offset, 0, block)
}
// 关联块不能复制：复制出的新块带着旧的申报版本却没经过预览，申报一旦变过就会在自动保存时
// 冲突且无法在该块上重新核对；没变则等于绕开预览又建了一个关联。
const segmentTarget = ref('')
// 登记表单对应的措施块被移除后，表单随之消失、取消按钮也没了；残留的目标会让底稿一直处于未保存状态。
watch(() => draft.value?.blocks.map(block => block.id).join('|'), () => { if (registerTarget.value && !draft.value?.blocks.some(block => block.id === registerTarget.value)) registerTarget.value = '' })
/** 回查结论已由面板写回改进记录，这里把同一次回查放进报告正文，发布后可追溯。 */
function recordLookback(block: ReportBlock) {
  if (!draft.value || !canEdit.value) return
  draft.value.blocks.push(block)
}
const REGISTERED = '已登记为改进记录'
/**
 * 报告里写的改进措施登记进公司改进记录，后续复盘到期时才会被带出来回查。
 * 登记后在正文追加标记，避免同一段措施被重复登记。
 */
async function registerAction(block: ReportBlock) {
  const paper = draft.value
  if (!paper || !canEdit.value || registering.value || block.text.includes(REGISTERED) || block.text.trim().length < 8 || !registerOwner.value.trim() || !registerDue.value) return
  const paperId = paper.id, owner = registerOwner.value.trim(), dueDate = registerDue.value
  registering.value = true; error.value = ''
  try {
    await createImprovementAction({ action: `来源报告：${paper.title}（${paper.scope.startDate}—${paper.scope.endDate}）\n改进措施：${block.text.trim()}`, owner, dueDate })
    if (!alive || draft.value?.id !== paperId) return
    block.text = `${block.text.trim()}\n（${REGISTERED}：负责人 ${owner}，回查日期 ${dueDate}）`
    registerTarget.value = ''; status.value = '改进措施已登记，到回查日期时会出现在后续复盘报告里'
  } catch { if (alive) error.value = '改进记录登记结果未确认，请到改进验证页刷新核实后再试。填写内容仍保留。' }
  finally { if (alive) registering.value = false }
}
const materialOf = (block: ReportBlock) => block.evidenceId ? evidence.value.find(item => item.id === block.evidenceId) : undefined
/**
 * 从图表块出发为其中几个时段写原因：新原因紧跟在图表后面，继承它引用的材料与材料用途，
 * 默认「待核实」——时段挑出来只是缩小范围，不代表原因已经成立。
 */
function addSegmentReason(chart: ReportBlock, segments: ReviewSegment[]) {
  if (!draft.value || !canEdit.value || !chart.evidenceId || !segments.length) return
  const index = draft.value.blocks.findIndex(block => block.id === chart.id)
  draft.value.blocks.splice(index + 1, 0, { id: crypto.randomUUID(), kind: 'reason', title: '时段原因', text: '', state: 'pending', supports: '', refutes: '', evidenceId: chart.evidenceId, evidenceRole: chart.evidenceRole ?? 'primary', segments: segments.map(segment => ({ ...segment })) })
  segmentTarget.value = ''
  status.value = `已为 ${segments.length} 个时段添加待核实原因`
}
function duplicate(block: ReportBlock) { if (block.kind === 'decision') return; draft.value?.blocks.push({ ...block, id: crypto.randomUUID() }) }
function attach(material: ReportEvidence, role: 'primary' | 'comparison') { if (draft.value && canEdit.value) draft.value.blocks.push({ id: crypto.randomUUID(), kind: 'chart', title: material.content.labels.join('与'), text: '', evidenceId: material.id, evidenceRole: role }) }
async function publish() {
  if (!draft.value || !confirmed.value) return
  // 未确认的关联依据不在底稿里，此时发布出去的不可变版本会少掉作者以为已写入的内容。
  if (publishBlocked.value) { error.value = '还有未落入正文的内容（关联依据、改进措施回查或登记）：请先完成或取消后再发布。'; return }
  publishing.value = true
  try {
    if (!await save() || !draft.value) { status.value = '请先完成保存，再发布'; return }
    const result = await publishWorkpaper(company, draft.value)
    if (alive) { publication.value = result; await loadVersions(); status.value = `已发布正文第 ${result.revision} 版，后续编辑不会改变此版本` }
  } catch (e) { if (alive) error.value = workpaperError(e) } finally { if (alive) publishing.value = false }
}
async function loadVersions(more = false) {
  if (!draft.value) return
  const generation = paperGeneration
  try { const page = await listReportPublications(company, region, draft.value.id, more ? versions.value.length : 0); if (alive && generation === paperGeneration) { versions.value = more ? [...versions.value, ...page.rows] : page.rows; versionsMore.value = page.hasMore } }
  catch (e) { if (alive && generation === paperGeneration) error.value = workpaperError(e) }
}
async function readVersion(id: string) {
  const generation = paperGeneration, request = ++publicationRequest
  publication.value = null
  const current = () => alive && generation === paperGeneration && request === publicationRequest
  try { const result = await getReportPublication(company, region, id); if (current()) publication.value = result }
  catch (e) { if (current()) error.value = workpaperError(e) }
}
async function loadComments(more = false) {
  if (!draft.value) return
  const generation = paperGeneration
  try { const page = await listReportComments(company, region, draft.value.id, more ? comments.value.length : 0); if (alive && generation === paperGeneration) { comments.value = more ? [...comments.value, ...page.rows] : page.rows; commentsMore.value = page.hasMore } }
  catch (e) { if (alive && generation === paperGeneration) error.value = workpaperError(e) }
}
async function comment() {
  if (!draft.value || !commentText.value.trim() || commenting.value) return
  const text = commentText.value, target = draft.value.id
  commenting.value = true
  try { await addReportComment(company, draft.value, commentId.value, text, commentTarget.value || null); if (alive && draft.value?.id === target) { if (commentText.value === text) commentText.value = ''; commentId.value = crypto.randomUUID(); await loadComments() } }
  catch (e) { if (alive) error.value = workpaperError(e) }
  finally { if (alive) commenting.value = false }
}
onMounted(() => { void list() })
onBeforeUnmount(() => { alive = false; if (timer) clearTimeout(timer); emit('dirty', false) })
</script>

<template>
  <div class="workpaper-editor">
    <p class="scope">{{ snapshot.scope.companyLabel || '当前公司' }} · {{ snapshot.scope.regionLabel || '当前地区' }} · {{ snapshot.scope.day }} · {{ snapshot.scope.objectLabel }}</p>
    <div class="toolbar"><label>业务视角 <select v-model="view" :disabled="!!draft"><option value="generator">发电</option><option value="retail">售电</option><option value="storage">储能</option></select></label><button type="button" :disabled="loading || pending || publishing" @click="create">新建本次底稿</button><label>已有底稿 <select :value="draft?.id || ''" :disabled="loading || saving || publishing" @change="open(($event.target as HTMLSelectElement).value)"><option value="" disabled>选择底稿</option><option v-for="paper in papers" :key="paper.id" :value="paper.id">{{ paper.title }} · 第 {{ paper.revision }} 版</option></select></label><button v-if="listMore" type="button" @click="list(true)">加载更多底稿</button></div>
    <p v-if="loading" role="status">正在读取报告资料…</p><p v-if="error" role="alert">{{ error }}</p><p v-if="status" role="status">{{ saving ? '正在保存…' : status }}</p>
    <div v-if="draft" class="workspace">
      <section>
        <p>主笔：{{ draft.authorId }} · {{ draft.scope.objectLabel }} · {{ draft.scope.startDate }}—{{ draft.scope.endDate }}<span v-if="!canEdit"> · 正文只读，可在右侧批注</span></p>
        <fieldset :disabled="!canEdit || publishing || loading">
          <label>报告标题<input v-model="draft.title" maxlength="200" /></label>
          <label>管理层摘要<textarea v-model="draft.summary" rows="3" placeholder="从同一份证据底稿提炼重点、风险与建议" /></label>
          <button type="button" @click="writingTarget = 'summary'">辅助提炼摘要</button>
          <ReportWritingAssistant v-if="writingInput" :key="`${draft.id}:${writingTarget}`" :input="writingInput" :company-id="company" :region="region" :initial-mode="writingTarget === 'summary' ? 'summary' : 'polish'" @adopt="adoptWriting" @close="writingTarget = ''" />
          <div class="toolbar"><button v-for="kind in (['text', 'reason', 'question', 'action'] as const)" :key="kind" type="button" @click="add(kind)">添加{{ blockNames[kind] }}</button></div>
          <DecisionLinkPanel v-if="canEdit" :company="company" :draft="draft" :disabled="publishing || loading" @link="linkDecision" @open="openDeclaration" @dirty="linkPending = $event" />
          <ImprovementLookbackPanel v-if="canEdit" :draft="draft" :disabled="publishing || loading" @record="recordLookback" @dirty="lookbackPending = $event" />
          <article v-for="(block, index) in draft.blocks" :key="block.id" class="block">
            <header><b>{{ index + 1 }} · {{ blockNames[block.kind] }}</b><div><button type="button" :disabled="index === 0" aria-label="上移内容块" @click="move(index, -1)">上移</button><button type="button" :disabled="index === draft.blocks.length - 1" aria-label="下移内容块" @click="move(index, 1)">下移</button><button v-if="block.kind !== 'decision'" type="button" @click="duplicate(block)">复制</button><button type="button" @click="draft.blocks.splice(index, 1)">移除</button></div></header>
            <input v-model="block.title" aria-label="内容块标题" maxlength="200" />
            <p v-if="block.segments?.length" class="segments">{{ segmentCaption(block, materialOf(block)) }}</p><template v-if="block.evidenceId"><ReportEvidenceChart v-if="materialOf(block) && rendersMaterial(draft.blocks, block)" :evidence="materialOf(block)!" /><label>材料用途<select v-model="block.evidenceRole"><option value="primary">本次依据</option><option value="comparison">比较依据</option></select></label><template v-if="block.kind === 'chart' && materialOf(block)"><button v-if="segmentTarget !== block.id" type="button" @click="segmentTarget = block.id">针对其中时段写原因</button><EvidenceSegmentPicker v-else :evidence="materialOf(block)!" @pick="addSegmentReason(block, $event)" @close="segmentTarget = ''" /></template></template>
            <DecisionReferenceCard v-if="block.kind === 'decision' && block.reference" :reference="block.reference" @open="openDeclaration" />
            <textarea v-model="block.text" :aria-label="block.kind === 'decision' ? '关联依据' : blockNames[block.kind]" rows="3" :placeholder="block.kind === 'decision' ? '写清为什么把这笔申报作为本次复盘的依据' : '补充事实、解释或人工判断'" />
            <button type="button" @click="writingTarget = block.id">辅助撰写这段</button>
            <template v-if="block.kind === 'action' && block.title !== '改进措施回查'"><p v-if="block.text.includes(REGISTERED)" class="registered">这条措施已登记到改进记录。</p><button v-else-if="registerTarget !== block.id" type="button" :disabled="block.text.trim().length < 8" @click="registerTarget = block.id; registerOwner = ''; registerDue = ''">登记到改进记录</button><div v-else class="register"><label>负责人<input v-model="registerOwner" maxlength="100" /></label><label>回查日期<input v-model="registerDue" type="date" /></label><button type="button" :disabled="registering || !registerOwner.trim() || !registerDue" @click="registerAction(block)">{{ registering ? '正在登记…' : '登记' }}</button><button type="button" :disabled="registering" @click="registerTarget = ''">取消</button></div></template>
            <template v-if="block.kind === 'reason'"><label>核实状态<select v-model="block.state"><option value="pending">待核实的可能原因</option><option value="confirmed">交易员已核实</option></select></label><label>支持证据<textarea v-model="block.supports" rows="2" /></label><label>反对证据<textarea v-model="block.refutes" rows="2" /></label></template>
          </article>
          <p v-if="!draft.blocks.length">从专题分析加入图表，或添加事实、原因和措施开始撰写。</p>
        </fieldset>
        <div v-if="canEdit" class="publish"><button type="button" :disabled="saving || publishing || !dirty" @click="save">保存底稿</button><label><input v-model="confirmed" type="checkbox" :disabled="publishing" />我已核对正文和资料性质</label><button type="button" :disabled="!confirmed || saving || publishing || publishBlocked" @click="publish">{{ publishing ? '正在发布…' : '发布报告' }}</button></div>
        <PublishedReportReader v-if="publication" :publication="publication" />
      </section>
      <aside>
        <h3>分析材料</h3><div v-for="item in evidence" :key="item.id" class="material"><b>{{ item.content.labels.join('与') }}</b><p>{{ item.content.input.period.date }} · {{ item.content.sourceNotice }}</p><button type="button" :disabled="!canEdit" @click="attach(item, 'comparison')">作为比较依据加入</button></div><p v-if="!evidence.length">在专题分析中选择时段后，保存为分析材料。</p>
        <h3>已发布版本</h3><button v-for="item in versions" :key="item.id" type="button" @click="readVersion(item.id)">查看正文第 {{ item.revision }} 版</button><button v-if="versionsMore" type="button" @click="loadVersions(true)">更多版本</button><h3>参考批注</h3><select v-model="commentTarget" aria-label="批注位置"><option value="">整份报告</option><option v-for="block in draft.blocks" :key="block.id" :value="block.id">{{ block.title || blockNames[block.kind] }}</option></select><textarea v-model="commentText" aria-label="批注内容" rows="3" /><button type="button" :disabled="!commentText.trim() || dirty || saving" @click="comment">添加批注</button>
        <article v-for="item in comments" :key="item.id"><b>{{ item.authorId }} · 正文第 {{ item.revision }} 版</b><p>{{ item.body }}</p></article><button v-if="commentsMore" type="button" @click="loadComments(true)">更多批注</button>
      </aside>
    </div>
    <p v-else>底稿和批注保存在服务器。主笔可自行发布，无需启动智能体。</p>
  </div>
</template>

<style scoped>
.scope,p{color:var(--muted);font-size:var(--font-sm);line-height:1.7}.toolbar,.publish,header,header>div{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:22px;margin-top:18px}.workspace>section,aside{min-width:0}fieldset{border:0;padding:0;margin:0}label{display:block;font-size:var(--font-sm);margin:10px 0}input:not([type=checkbox]),textarea{box-sizing:border-box;width:100%;display:block;margin-top:7px}button,input,textarea,select{font:inherit;font-size:var(--font-sm);color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:8px}textarea{resize:vertical;line-height:1.6}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}.block{border:1px solid var(--line);border-radius:8px;padding:14px;margin:16px 0}.block header{justify-content:space-between}.material,aside article{border-bottom:1px solid var(--line);padding:12px 0}.publish{margin-top:16px}.segments{color:var(--text)}.register{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.register label{margin:0}.registered{color:var(--muted)}.publish label{display:flex;align-items:center;gap:6px}h3{font-size:var(--font-lg)}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--primary);outline-offset:2px}@media(max-width:850px){.workspace{grid-template-columns:1fr}.toolbar{align-items:stretch}.toolbar label{width:100%}}
</style>
