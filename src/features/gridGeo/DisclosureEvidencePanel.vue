<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Bookmark, Check, Clock3, ExternalLink, FileText, MapPinned, Save, ShieldCheck, X } from 'lucide-vue-next'
import { fetchGridDisclosureEvent, fetchGridGeoManifest, saveGridDisclosureOverlay } from './client'
import type { GridDisclosureEvent, GridDisclosureOverlay } from './types'

const props = defineProps<{ event: GridDisclosureEvent; scopeKey: string }>()
const emit = defineEmits<{ close: []; 'open-object': []; 'favorite-change': [update: { eventId: string; favorite: boolean }] }>()
const detail = ref<GridDisclosureEvent>(props.event)
const overlays = ref<GridDisclosureOverlay[]>([])
const scope = ref<'user' | 'company'>('user')
const note = ref('')
const tags = ref('')
const favorite = ref(false)
const loading = ref(false)
const loaded = ref(false)
const saving = ref(false)
const error = ref('')
const saved = ref(false)
const companyWritable = ref(false)
let epoch = 0
let abort: AbortController | null = null
const currentOverlay = computed(() => overlays.value.find((overlay) => overlay.scope === scope.value))
const canWriteCompany = computed(() => companyWritable.value)
const canSave = computed(() => loaded.value && !saving.value && (scope.value === 'user' || canWriteCompany.value))
const sourceUrl = computed(() => /^https?:\/\//i.test(detail.value.source.url ?? '') ? detail.value.source.url : null)
const intervalDescription = computed(() => {
  const event = detail.value
  const equipment = event.category === 'maintenance' || event.category === 'outage'
  const unknown = { label: '有效区间待核验', start: '生效时间', end: '结束时间' }
  if (!event.effectiveAt || event.timeQuality?.effective !== 'source') return unknown
  if (!event.expiresAt) return { ...unknown, label: '仅已知单点，结束时间未提供' }
  if (event.timeQuality.intervalBasis === 'actual') return equipment
    ? { label: '实际停复电区间', start: '实际停电', end: '实际复电' }
    : { label: '实际有效区间', start: '实际开始', end: '实际结束' }
  if (event.timeQuality.intervalBasis === 'planned') return equipment
    ? { label: '计划停复电区间', start: '计划停电', end: '计划复电' }
    : { label: '计划有效区间', start: '计划开始', end: '计划结束' }
  return event.timeQuality.intervalBasis === 'source' ? { ...unknown, label: '来源有效区间' } : unknown
})
const timeIssues = computed(() => [...new Set((detail.value.timeQuality?.issues ?? []).filter((issue) => !issue.startsWith('legacy-')).map((issue) => ({
  'expiry-before-effective': '结束时间早于开始时间，未当作有效区间。',
  'invalid-effective-time': '源记录的开始时间无法解析，未放入小时轨道。',
  'invalid-expiry-time': '源记录的结束时间无法解析，未推定持续时间。',
  'expiry-without-effective': '仅有结束时间，缺少可确认的开始时刻。',
}[issue] ?? '来源时间待核验。')))])
const legacyTimeIssues = computed(() => [...new Set((detail.value.timeQuality?.issues ?? []).filter((issue) => issue.startsWith('legacy-')).map((issue) => /publish|import/.test(issue) ? '旧记录的发布时间字段实际保存入库时间，不能作为公开发布时间。' : '业务日期由旧记录推定，具体生效时刻仍待来源核验。'))])
function dateText(value: string | null | undefined) {
  if (!value) return '未提供'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}
function syncOverlay() {
  note.value = currentOverlay.value?.note ?? ''
  tags.value = currentOverlay.value?.tags.join('，') ?? ''
  favorite.value = currentOverlay.value?.favorite ?? false
  saved.value = false
}
async function load() {
  const requestEpoch = ++epoch
  abort?.abort()
  abort = new AbortController()
  detail.value = props.event
  overlays.value = []
  loaded.value = false
  companyWritable.value = false
  loading.value = true
  saving.value = false
  error.value = ''
  syncOverlay()
  try {
    const [result, manifest] = await Promise.all([
      fetchGridDisclosureEvent(props.event.eventId, { signal: abort.signal }),
      fetchGridGeoManifest().catch(() => null),
    ])
    if (requestEpoch !== epoch) return
    detail.value = result.event
    overlays.value = result.overlays
    companyWritable.value = manifest?.capabilities.canWrite === true
    loaded.value = true
    const personal = result.overlays.find((overlay) => overlay.scope === 'user')
    emit('favorite-change', { eventId: props.event.eventId, favorite: personal?.favorite ?? false })
    syncOverlay()
  } catch (cause) {
    if (requestEpoch === epoch) error.value = cause instanceof Error ? cause.message : '事件详情加载失败'
  } finally { if (requestEpoch === epoch) loading.value = false }
}
async function save() {
  if (!canSave.value) return
  const requestEpoch = epoch
  const eventId = props.event.eventId
  const targetScope = scope.value
  const cleanedTags = [...new Set(tags.value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean))]
  if (cleanedTags.length > 10) { error.value = '最多填写 10 个标签'; return }
  saving.value = true
  error.value = ''
  saved.value = false
  try {
    const result = await saveGridDisclosureOverlay(eventId, { scope: targetScope, favorite: favorite.value, note: note.value.trim(), tags: cleanedTags, expectedVersion: currentOverlay.value?.version ?? 0 })
    if (requestEpoch !== epoch || eventId !== props.event.eventId) return
    overlays.value = [...overlays.value.filter((overlay) => overlay.scope !== targetScope), result]
    if (targetScope === 'user') emit('favorite-change', { eventId, favorite: result.favorite })
    if (scope.value === targetScope) { syncOverlay(); saved.value = true }
  } catch (cause) {
    if (requestEpoch === epoch) error.value = cause instanceof Error ? cause.message : '标注保存失败，请重试'
  } finally { if (requestEpoch === epoch) saving.value = false }
}
watch([() => props.event.eventId, () => props.scopeKey], load, { immediate: true })
watch(scope, syncOverlay)
onBeforeUnmount(() => { epoch += 1; abort?.abort() })
</script>

<template>
  <section class="evidence-panel" data-testid="desk-evidence" aria-label="选中事件证据">
    <header><span><FileText :size="15" />事件证据</span><button type="button" aria-label="关闭事件详情" @click="emit('close')"><X :size="16" /></button></header>
    <h3>{{ detail.title }}</h3>
    <button class="object-link" type="button" @click="emit('open-object')">查看对象、关联信息与笔记</button>
    <p class="summary">{{ detail.summary }}</p>
    <div class="location"><MapPinned :size="17" /><div><strong>{{ detail.spatialBinding.label }}</strong><small>{{ detail.spatialBinding.kind === 'section' ? '断面名称绑定 · 暂无公开几何' : '地区范围绑定 · 暂无设备坐标' }}</small></div></div>
    <div class="time-list"><h4><Clock3 :size="14" />时间口径</h4><p class="time-note" data-testid="desk-interval-basis">{{ intervalDescription.label }}</p><dl>
      <div><dt>业务日期</dt><dd>{{ detail.businessDate || '未提供' }}</dd></div>
      <div><dt>{{ intervalDescription.start }}</dt><dd>{{ detail.effectiveDate && !detail.effectiveAt ? `${detail.effectiveDate}（时刻未披露）` : dateText(detail.effectiveAt) }}</dd></div>
      <div><dt>{{ intervalDescription.end }}</dt><dd>{{ dateText(detail.expiresAt) }}</dd></div>
      <div><dt>发布时间</dt><dd>{{ dateText(detail.publishedAt) }}</dd></div>
      <div><dt>源记录入库</dt><dd>{{ dateText(detail.sourceImportedAt) }}</dd></div>
    </dl><p v-for="issue in timeIssues" :key="issue" class="time-warning" role="note">{{ issue }}</p><p v-if="!detail.publishedAt" class="time-note">未提供发布时间，不能据此判断历史某时点已经获知。</p></div>
    <details class="source-details"><summary><ShieldCheck :size="14" />来源与原始证据</summary><dl><div><dt>源表</dt><dd>{{ detail.source.sourceTable }}</dd></div><div><dt>记录 ID</dt><dd>{{ detail.source.recordId }}</dd></div><div><dt>源文件</dt><dd>{{ detail.source.file }}</dd></div></dl><a v-if="sourceUrl" :href="sourceUrl" target="_blank" rel="noopener noreferrer">打开原文<ExternalLink :size="13" /></a><p v-else>源记录未提供可用原文链接。</p><p>{{ detail.source.license }}</p><p v-for="issue in legacyTimeIssues" :key="issue">{{ issue }}</p></details>
    <section class="overlay-editor"><h4><Bookmark :size="14" />关注与协作</h4><div class="scope-tabs" role="group" aria-label="标注范围"><button type="button" :aria-pressed="scope === 'user'" @click="scope = 'user'">个人笔记</button><button type="button" :aria-pressed="scope === 'company'" @click="scope = 'company'">公司标注</button></div>
      <p v-if="scope === 'company' && !canWriteCompany" class="time-note">当前角色可查看公司标注，编辑需管理员或负责人权限。</p>
      <fieldset :disabled="!loaded || saving || (scope === 'company' && !canWriteCompany)"><label class="favorite"><input v-model="favorite" type="checkbox" />加入关注</label><textarea v-model="note" aria-label="交易关注笔记" rows="3" maxlength="2000" placeholder="记录需跟踪的对象、时段及待核实事项…" /><input v-model="tags" aria-label="事件标签" placeholder="标签，以逗号分隔，最多 10 个" /></fieldset>
      <div v-if="error" class="error" role="alert">{{ error }}<button type="button" @click="load">重新读取</button></div><p v-if="loading" class="time-note" role="status">正在读取来源与标注…</p>
      <button class="save" type="button" :disabled="!canSave" @click="save"><Check v-if="saved" :size="14" /><Save v-else :size="14" />{{ saved ? '已保存' : saving ? '保存中…' : '保存标注' }}</button>
    </section>
  </section>
</template>

<style scoped>
.object-link{padding:7px 10px;border:1px solid var(--primary-tint-border);border-radius:6px;background:var(--primary-tint);color:var(--primary);font:inherit;font-size:var(--font-sm);cursor:pointer}.object-link:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.evidence-panel{padding:18px 18px 20px;border-top:1px solid var(--line)}header,header span,h4{display:flex;align-items:center;gap:7px}header{justify-content:space-between;font-size:var(--font-sm);color:var(--primary)}header button{display:grid;place-items:center;border:0;background:transparent;color:var(--muted);cursor:pointer}.evidence-panel h3{margin:15px 0 9px;font-size:var(--font-xl);line-height:1.5;color:var(--text)}.summary{font-size:var(--font-sm);line-height:1.8;color:var(--text-soft);white-space:pre-wrap}.location{display:flex;align-items:center;gap:10px;margin:16px 0;padding:12px;background:var(--primary-tint);border:1px solid var(--primary-tint-border);border-radius:8px;color:var(--primary)}.location strong,.location small{display:block}.location strong{font-size:var(--font-sm)}.location small{font-size:var(--font-xs);color:var(--muted);margin-top:4px}h4{font-size:var(--font-sm);font-weight:600;margin:17px 0 10px;color:var(--text-soft)}dl{margin:0}dl>div{display:grid;grid-template-columns:82px minmax(0,1fr);gap:9px;margin:9px 0;font-size:var(--font-xs)}dt{color:var(--muted)}dd{margin:0;color:var(--text-body);overflow-wrap:anywhere}.time-note{font-size:var(--font-xs);line-height:1.65;color:var(--muted)}.source-details{margin:16px 0;border-top:1px solid var(--line-soft);border-bottom:1px solid var(--line-soft);padding:12px 0}.source-details summary{display:flex;gap:6px;align-items:center;cursor:pointer;color:var(--text-soft);font-size:var(--font-sm)}.source-details p,.source-details a{font-size:var(--font-xs);line-height:1.6;color:var(--muted)}.source-details a{color:var(--primary);display:inline-flex;gap:5px;align-items:center}.scope-tabs{display:flex;gap:5px}.scope-tabs button{flex:1;padding:7px;border:1px solid var(--line);border-radius:6px;font-size:var(--font-xs);color:var(--muted);background:var(--panel-sub);cursor:pointer}.scope-tabs button[aria-pressed=true]{border-color:var(--primary-tint-border);background:var(--primary-tint);color:var(--primary)}fieldset{border:0;margin:0;padding:0;min-width:0}fieldset:disabled{opacity:.65}.favorite{display:flex;align-items:center;gap:7px;padding:12px 0;font-size:var(--font-sm);color:var(--text-soft)}.overlay-editor textarea,.overlay-editor fieldset>input{box-sizing:border-box;display:block;width:100%;resize:vertical;padding:10px;margin-bottom:8px;border:1px solid var(--line);border-radius:6px;background:var(--panel-sub);color:var(--text);font:inherit;font-size:var(--font-sm)}.save{width:100%;display:flex;justify-content:center;align-items:center;gap:7px;padding:9px;border:1px solid var(--primary-tint-border);border-radius:6px;background:var(--primary-tint);color:var(--primary);cursor:pointer;font-size:var(--font-sm)}.save:disabled{opacity:.5;cursor:default}.error{padding:9px;margin-bottom:8px;font-size:var(--font-xs);line-height:1.7;color:var(--danger);background:var(--danger-tint);border-radius:6px}.error button{border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer}
.time-warning{padding:8px;border-radius:5px;background:var(--warning-tint);color:var(--warning);font-size:var(--font-xs);line-height:1.65}</style>
