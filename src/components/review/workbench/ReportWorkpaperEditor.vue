<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { currentStanceHeader } from '@/services/stance/stanceContext'
import { addReportComment, createWorkpaper, getWorkpaper, getReportPublication, listReportPublications, listReportComments, listWorkpapers, publishWorkpaper, saveWorkpaper, workpaperError, type Publication, type ReportBlock, type ReportComment, type ReportEvidence, type Workpaper, type WorkpaperScope } from '@/services/review/workpapers'
import type { ReviewEvidenceSnapshot } from '@/services/review/reviewEvidence'
import PublishedReportReader from './PublishedReportReader.vue'
import ReportEvidenceChart from './ReportEvidenceChart.vue'

const props = defineProps<{ snapshot: ReviewEvidenceSnapshot; material?: ReportEvidence | null }>()
const emit = defineEmits<{ dirty: [value: boolean] }>()
const company = props.snapshot.scope.company, region = props.snapshot.scope.region
const papers = ref<Workpaper[]>([]), draft = ref<Workpaper | null>(null), evidence = ref<ReportEvidence[]>([])
const versions = ref<Array<{ id: string; revision: number; title: string }>>([]), versionsMore = ref(false)
const comments = ref<ReportComment[]>([]), publication = ref<Publication | null>(null)
const listMore = ref(false), commentsMore = ref(false), loading = ref(false), saving = ref(false), publishing = ref(false)
const dirty = ref(false), confirmed = ref(false), error = ref(''), status = ref(''), commentText = ref(''), commentTarget = ref('')
const creationId = ref(crypto.randomUUID()), commentId = ref(crypto.randomUUID())
const stance = currentStanceHeader() ?? ''
const view = ref<WorkpaperScope['view']>(/retail|售电/i.test(stance) ? 'retail' : /storage|储能/i.test(stance) ? 'storage' : 'generator')
const canEdit = computed(() => draft.value?.canEdit === true)
const blockNames: Record<ReportBlock['kind'], string> = { text: '事实与说明', chart: '图表与统计', reason: '原因与判断', question: '待核实问题', action: '改进措施' }
let alive = true, suppress = false, editVersion = 0, timer: ReturnType<typeof setTimeout> | null = null, savingTask: Promise<boolean> | null = null
const commenting = ref(false)
const pending = computed(() => dirty.value || saving.value || publishing.value || commenting.value || !!commentText.value.trim())
watch(pending, value => emit('dirty', value), { immediate: true })
watch(draft, () => {
  if (suppress || !draft.value || !canEdit.value) return
  editVersion++; dirty.value = true; confirmed.value = false; publication.value = null
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void save() }, 900)
}, { deep: true, flush: 'sync' })
function assignPaper(value: Workpaper) {
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
  if (savingTask) await savingTask
  if (timer) clearTimeout(timer)
  loading.value = true; error.value = ''; comments.value = []; commentText.value = ''
  try { const value = await getWorkpaper(company, region, id); if (alive) { assignPaper(value); await loadComments(); await loadVersions() } }
  catch (e) { if (alive) error.value = workpaperError(e) } finally { if (alive) loading.value = false }
}
async function create() {
  if (pending.value) { error.value = '请先保存当前底稿和批注'; return }
  const scope: WorkpaperScope = { region, view: view.value, objectId: props.snapshot.scope.objectKey || 'company-overview', objectLabel: props.snapshot.scope.objectLabel, startDate: props.snapshot.scope.day, endDate: props.snapshot.scope.day }
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
function duplicate(block: ReportBlock) { draft.value?.blocks.push({ ...block, id: crypto.randomUUID() }) }
function attach(material: ReportEvidence, role: 'primary' | 'comparison') { if (draft.value && canEdit.value) draft.value.blocks.push({ id: crypto.randomUUID(), kind: 'chart', title: material.content.labels.join('与'), text: '', evidenceId: material.id, evidenceRole: role }) }
async function publish() {
  if (!draft.value || !confirmed.value) return
  publishing.value = true
  try {
    if (!await save() || !draft.value) { status.value = '请先完成保存，再发布'; return }
    const result = await publishWorkpaper(company, draft.value)
    if (alive) { publication.value = result; await loadVersions(); status.value = `已发布正文第 ${result.revision} 版，后续编辑不会改变此版本` }
  } catch (e) { if (alive) error.value = workpaperError(e) } finally { if (alive) publishing.value = false }
}
async function loadVersions(more = false) {
  if (!draft.value) return
  try { const page = await listReportPublications(company, region, draft.value.id, more ? versions.value.length : 0); if (alive) { versions.value = more ? [...versions.value, ...page.rows] : page.rows; versionsMore.value = page.hasMore } }
  catch (e) { if (alive) error.value = workpaperError(e) }
}
async function readVersion(id: string) {
  try { const result = await getReportPublication(company, region, id); if (alive) publication.value = result }
  catch (e) { if (alive) error.value = workpaperError(e) }
}
async function loadComments(more = false) {
  if (!draft.value) return
  try { const page = await listReportComments(company, region, draft.value.id, more ? comments.value.length : 0); if (alive) { comments.value = more ? [...comments.value, ...page.rows] : page.rows; commentsMore.value = page.hasMore } }
  catch (e) { if (alive) error.value = workpaperError(e) }
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
          <div class="toolbar"><button v-for="kind in (['text', 'reason', 'question', 'action'] as const)" :key="kind" type="button" @click="add(kind)">添加{{ blockNames[kind] }}</button></div>
          <article v-for="(block, index) in draft.blocks" :key="block.id" class="block">
            <header><b>{{ index + 1 }} · {{ blockNames[block.kind] }}</b><div><button type="button" :disabled="index === 0" aria-label="上移内容块" @click="move(index, -1)">上移</button><button type="button" :disabled="index === draft.blocks.length - 1" aria-label="下移内容块" @click="move(index, 1)">下移</button><button type="button" @click="duplicate(block)">复制</button><button type="button" @click="draft.blocks.splice(index, 1)">移除</button></div></header>
            <input v-model="block.title" aria-label="内容块标题" maxlength="200" />
            <template v-if="block.evidenceId"><ReportEvidenceChart v-if="evidence.find(row => row.id === block.evidenceId)" :evidence="evidence.find(row => row.id === block.evidenceId)!" /><label>材料用途<select v-model="block.evidenceRole"><option value="primary">本次依据</option><option value="comparison">比较依据</option></select></label></template>
            <textarea v-model="block.text" :aria-label="blockNames[block.kind]" rows="3" placeholder="补充事实、解释或人工判断" />
            <template v-if="block.kind === 'reason'"><label>核实状态<select v-model="block.state"><option value="pending">待核实的可能原因</option><option value="confirmed">交易员已核实</option></select></label><label>支持证据<textarea v-model="block.supports" rows="2" /></label><label>反对证据<textarea v-model="block.refutes" rows="2" /></label></template>
          </article>
          <p v-if="!draft.blocks.length">从专题分析加入图表，或添加事实、原因和措施开始撰写。</p>
        </fieldset>
        <div v-if="canEdit" class="publish"><button type="button" :disabled="saving || publishing || !dirty" @click="save">保存底稿</button><label><input v-model="confirmed" type="checkbox" :disabled="publishing" />我已核对正文和资料性质</label><button type="button" :disabled="!confirmed || saving || publishing" @click="publish">{{ publishing ? '正在发布…' : '发布报告' }}</button></div>
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
.scope,p{color:var(--muted);font-size:var(--font-sm);line-height:1.7}.toolbar,.publish,header,header>div{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:22px;margin-top:18px}.workspace>section,aside{min-width:0}fieldset{border:0;padding:0;margin:0}label{display:block;font-size:var(--font-sm);margin:10px 0}input:not([type=checkbox]),textarea{box-sizing:border-box;width:100%;display:block;margin-top:7px}button,input,textarea,select{font:inherit;font-size:var(--font-sm);color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:8px}textarea{resize:vertical;line-height:1.6}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}.block{border:1px solid var(--line);border-radius:8px;padding:14px;margin:16px 0}.block header{justify-content:space-between}.material,aside article{border-bottom:1px solid var(--line);padding:12px 0}.publish{margin-top:16px}.publish label{display:flex;align-items:center;gap:6px}h3{font-size:var(--font-lg)}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--primary);outline-offset:2px}@media(max-width:850px){.workspace{grid-template-columns:1fr}.toolbar{align-items:stretch}.toolbar label{width:100%}}
</style>
