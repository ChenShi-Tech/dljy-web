<script setup lang="ts">
import { computed, defineAsyncComponent, inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { routeLocationKey, routerKey } from 'vue-router'
import { ArrowLeft, ArrowUpRight, Bookmark, ExternalLink, MapPin, Save } from 'lucide-vue-next'
import { currentRegion } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { ApiError } from '@/services/api'
import { todayBeijing } from '@/utils/beijingDate'
import { fetchGridObject, fetchGridGeoManifest, saveGridObjectOverlay } from './client'
import { buildGridObjectLocation, safeGridReturnPath, validObjectDate, type GridObjectDetail, type GridObjectReference } from './objectNavigation'

const PlantBusinessAttributes = defineAsyncComponent(() => import('./PlantBusinessAttributes.vue'))
const props = defineProps<{ modelValue: boolean; object: GridObjectReference | null; date?: string; from?: string; to?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const route = inject(routeLocationKey, null), router = inject(routerKey, null)
const open = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const target = shallowRef<GridObjectReference | null>(null), detail = shallowRef<GridObjectDetail | null>(null)
const trail = ref<GridObjectReference[]>([])
const loading = ref(false), error = ref(''), companyWritable = ref(false)
const selectedDate = ref(todayBeijing())
const tab = ref<'overview' | 'business' | 'notes'>('overview')
const noteScope = ref<'user' | 'company'>('user'), note = ref(''), tags = ref(''), favorite = ref(false)
const saving = ref(false), saveError = ref(''), saved = ref(false), conflict = ref(false)
const latestLoaded = ref(false), latestLoading = ref(false)
let latestReadRequest = 0
let epoch = 0
const overlay = computed(() => detail.value?.overlays.find(item => item.scope === noteScope.value))
const hasPlant = computed(() => Boolean(detail.value?.plant || detail.value?.relations.plants.length))
const sourceLinks = computed(() => (detail.value?.source.evidence ?? []).filter(item => /^https?:\/\//i.test(item.url)))
const sourceNotes = computed(() => (detail.value?.source.label.match(/[^。；;\n]+[。；;]?/g) ?? []).map(item => item.trim()).filter(Boolean))
const shortSourceLabel = computed(() => sourceNotes.value.length === 1 && sourceNotes.value[0]!.length <= 28 ? sourceNotes.value[0] : '')
const sourceTime = computed(() => {
  const value = detail.value?.source.updatedAt
  if (!value || !Number.isFinite(Date.parse(value))) return ''
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
})
const locationLabel: Record<string, string> = { located: '已定位', approximate: '近似位置', unresolved: '未定位', verified: '已核验', probable: '待复核', unverified: '未核验' }
function numberText(value: number | null | undefined, unit = '') { return value === null || value === undefined || !Number.isFinite(value) ? '未提供' : `${value.toLocaleString('zh-CN')} ${unit}`.trim() }
function syncNote() {
  ++latestReadRequest; latestLoaded.value = false; latestLoading.value = false
  note.value = overlay.value?.note ?? ''; tags.value = overlay.value?.tags.join('，') ?? ''; favorite.value = overlay.value?.favorite ?? false; saveError.value = ''; saved.value = false; conflict.value = false
}
async function load() {
  const request = ++epoch, reference = target.value
  detail.value = null; error.value = ''; companyWritable.value = false; saving.value = false; syncNote()
  if (!open.value || !reference) { loading.value = false; return }
  if (reference.regionId !== currentRegion.value.id) { error.value = '对象不属于当前地区'; return }
  loading.value = true
  try {
    const [result, manifest] = await Promise.all([fetchGridObject(reference), fetchGridGeoManifest().catch(() => null)])
    if (request !== epoch) return
    if (result.reference.kind !== reference.kind || result.reference.id !== reference.id || result.reference.regionId !== reference.regionId) throw new Error('对象身份校验失败')
    detail.value = result; companyWritable.value = manifest?.capabilities.canWrite === true; syncNote()
  } catch (cause) { if (request === epoch) error.value = cause instanceof Error ? cause.message : '对象读取失败' }
  finally { if (request === epoch) loading.value = false }
}
function related(kind: 'plant' | 'node', item: { id: string; regionId: string }) {
  if (target.value) trail.value.push(target.value)
  target.value = { kind, id: item.id, regionId: item.regionId }; tab.value = 'overview'; void load()
}
function back() { target.value = trail.value.pop() ?? props.object; void load() }
function navigate(path: string) {
  if (!target.value || !router || !selectedCompanyId.value) return
  const returnTo = safeGridReturnPath(route?.query.returnTo) ?? safeGridReturnPath(route?.fullPath)
  const preserveWindow = selectedDate.value === props.date
  const location = buildGridObjectLocation(path, target.value, { companyId: selectedCompanyId.value, date: selectedDate.value, from: preserveWindow ? props.from : undefined, to: preserveWindow ? props.to : undefined, returnTo })
  open.value = false
  void router.push(location)
}
async function reloadConflictLatest() {
  const reference = target.value, request = epoch, scope = noteScope.value
  if (!reference || !detail.value || !conflict.value || latestLoading.value) return
  const readRequest = ++latestReadRequest
  const isCurrent = () => request === epoch && readRequest === latestReadRequest && scope === noteScope.value
  latestLoading.value = true; latestLoaded.value = false; saveError.value = ''
  try {
    const latest = await fetchGridObject(reference)
    if (!isCurrent() || !detail.value) return
    if (latest.reference.kind !== reference.kind || latest.reference.id !== reference.id || latest.reference.regionId !== reference.regionId) throw new Error('对象身份校验失败')
    detail.value = { ...detail.value, overlays: latest.overlays }
    latestLoaded.value = true
    saveError.value = '笔记已被更新，当前草稿已保留。请与最新版本核对后再保存。'
  } catch {
    if (isCurrent()) saveError.value = '最新版本读取失败，当前草稿已保留，请重试读取。'
  } finally { if (isCurrent()) latestLoading.value = false }
}
function adoptLatestNote() {
  if (!latestLoaded.value || latestLoading.value || saving.value) return
  syncNote()
}
function keepConflictDraft() {
  if (!latestLoaded.value || latestLoading.value || saving.value) return
  conflict.value = false; saveError.value = ''; latestLoaded.value = false
}
async function saveNote() {
  const reference = target.value, request = epoch, scope = noteScope.value
  if (!reference || !detail.value || saving.value || conflict.value || (scope === 'company' && !companyWritable.value)) return
  const cleanTags = [...new Set(tags.value.split(/[，,]/).map(item => item.trim()).filter(Boolean))]
  if (cleanTags.length > 10) { saveError.value = '最多填写 10 个标签'; return }
  if (note.value.length > 2000 || cleanTags.some(tag => tag.length > 40)) { saveError.value = '笔记最多 2000 字，每个标签最多 40 字'; return }
  saving.value = true; saveError.value = ''; saved.value = false
  try {
    const result = await saveGridObjectOverlay(reference, { scope, note: note.value, favorite: favorite.value, tags: cleanTags, expectedVersion: overlay.value?.version ?? 0 })
    if (request !== epoch || !detail.value) return
    detail.value = { ...detail.value, overlays: [...detail.value.overlays.filter(item => item.scope !== scope), result] }
    if (noteScope.value === scope) saved.value = true
  } catch (cause) {
    if (request !== epoch) return
    if (cause instanceof ApiError && cause.status === 409) {
      // Keep the draft visible while refreshing only the version and comparison text.
      conflict.value = true
      await reloadConflictLatest()
    } else saveError.value = cause instanceof Error ? cause.message : '笔记保存失败'
  } finally { if (request === epoch) saving.value = false }
}
watch(() => [props.modelValue, props.object?.kind, props.object?.id, props.object?.regionId], () => {
  target.value = props.object; trail.value = []; tab.value = 'overview'; selectedDate.value = validObjectDate(props.date) ? props.date : todayBeijing(); void load()
}, { immediate: true })
watch(() => props.date, value => { if (validObjectDate(value)) selectedDate.value = value })
watch(noteScope, syncNote)
watch(() => [currentRegion.value.id, selectedCompanyId.value], () => { ++epoch; detail.value = null; target.value = null; open.value = false })
onBeforeUnmount(() => { ++epoch })
</script>

<template>
  <el-drawer v-model="open" class="grid-object-shell" title="对象详情" size="min(680px, 100vw)" append-to-body destroy-on-close>
    <div class="object-drawer">
      <p v-if="loading" role="status">正在读取对象与关联信息…</p>
      <div v-else-if="error" role="alert" class="error">{{ error }} <button @click="load">重试</button></div>
      <template v-else-if="detail">
        <button v-if="trail.length" class="back" @click="back"><ArrowLeft :size="14" />返回上一个对象</button>
        <header class="object-heading">
          <div class="object-identity">
            <div class="object-name"><h2>{{ detail.name }}</h2><span class="object-type">{{ detail.objectType }}</span></div>
            <div class="object-address"><MapPin :size="14" />{{ detail.location.label || '位置未提供' }}</div>
          </div>
          <div class="object-time">
            <label>业务日期 <input v-model="selectedDate" type="date" aria-label="对象业务日期" /></label>
            <span>{{ detail.reference.regionId === currentRegion.id ? currentRegion.name : detail.reference.regionId }} · 北京时间</span>
          </div>
        </header>
        <nav class="links" aria-label="对象关联页面">
          <button :disabled="!router" @click="navigate('/grid-assets/command')">位置 <ArrowUpRight :size="13" /></button>
          <button :disabled="!router || !detail.relations.nodes.length && !detail.node" @click="navigate('/grid-assets/nodes')">相关节点 <ArrowUpRight :size="13" /></button>
          <button :disabled="!router || !hasPlant" @click="navigate('/grid-assets/market')">出力 <ArrowUpRight :size="13" /></button>
          <button :disabled="!router || !hasPlant" @click="navigate('/grid-assets/weather-impact')">气象 <ArrowUpRight :size="13" /></button>
          <button :disabled="!router" @click="navigate('/grid-assets/disclosures')">相关披露 <ArrowUpRight :size="13" /></button>
        </nav>
        <div class="tabs" role="tablist" aria-label="对象详情内容">
          <button role="tab" :aria-selected="tab === 'overview'" @click="tab = 'overview'">位置与关联</button>
          <button role="tab" :aria-selected="tab === 'business'" @click="tab = 'business'">出力与时序</button>
          <button role="tab" :aria-selected="tab === 'notes'" @click="tab = 'notes'">关注与笔记</button>
        </div>
        <section v-if="tab === 'overview'" role="tabpanel">
          <h3 class="section-title">基础信息</h3>
          <dl class="facts">
            <div><dt>容量</dt><dd>{{ numberText(detail.capacityMw, 'MW') }}</dd></div>
            <div><dt>电压</dt><dd>{{ numberText(detail.voltageLevelKv, 'kV') }}</dd></div>
            <div><dt>所属站</dt><dd>{{ detail.stationName || '未提供' }}</dd></div>
            <div><dt>位置状态</dt><dd>{{ locationLabel[detail.location.status] || '未定位' }}</dd></div>
            <div v-if="detail.location.longitude !== null && detail.location.latitude !== null" class="fact-wide"><dt>参考坐标</dt><dd>{{ numberText(detail.location.longitude) }}, {{ numberText(detail.location.latitude) }}</dd></div>
          </dl>
          <h3 class="section-title">已确认的关联 <span class="section-count">{{ detail.relations.plants.length + detail.relations.nodes.length }}</span></h3>
          <div class="relations"><button v-for="plant in detail.relations.plants" :key="plant.id" @click="related('plant', plant)">场站 · {{ plant.name }} <ArrowUpRight :size="14" /></button><button v-for="node in detail.relations.nodes" :key="node.id" @click="related('node', node)">节点 · {{ node.name }} <ArrowUpRight :size="14" /></button></div>
          <span v-if="!detail.relations.plants.length && !detail.relations.nodes.length" class="empty-tag">暂无已确认关联</span>
          <div class="source-section">
            <h3 class="section-title">来源</h3>
            <dl class="source-meta">
              <div v-if="shortSourceLabel"><dt>资料来源</dt><dd>{{ shortSourceLabel }}</dd></div>
              <div><dt>{{ detail.source.updatedAtBasis === 'source-imported' ? '源记录入库' : '资产更新' }}</dt><dd>{{ sourceTime || '未提供' }}</dd></div>
            </dl>
            <details v-if="sourceNotes.length && !shortSourceLabel" :key="`${detail.reference.kind}:${detail.reference.id}`" class="source-notes">
              <summary>原始来源说明 <span>{{ sourceNotes.length }} 项</span></summary>
              <ul><li v-for="(item, index) in sourceNotes" :key="index">{{ item }}</li></ul>
            </details>
            <a v-for="source in sourceLinks" :key="source.url" :href="source.url" target="_blank" rel="noopener noreferrer" class="source">{{ source.title }} <ExternalLink :size="14" /></a>
          </div>
          <slot v-if="!trail.length" name="extra" />
          <details v-if="$slots.management && !trail.length" class="management"><summary>资产维护与内部字段</summary><slot name="management" /></details>
        </section>
        <section v-else-if="tab === 'business'" role="tabpanel">
          <PlantBusinessAttributes v-if="detail.plant" :plant="detail.plant" :date="selectedDate" />
          <template v-else><p class="muted">{{ hasPlant ? '选择已关联场站，查看该场站的出力与时序。' : '此对象尚未关联场站出力或气象数据。' }}</p><button v-for="plant in detail.relations.plants" :key="plant.id" @click="related('plant', plant)">{{ plant.name }} <ArrowUpRight :size="14" /></button><button :disabled="!router" @click="navigate('/grid-assets/disclosures')">查看对象相关披露</button></template>
        </section>
        <section v-else role="tabpanel" class="notes">
          <label>笔记范围<select v-model="noteScope" :disabled="saving || latestLoading" aria-label="笔记范围"><option value="user">个人笔记</option><option value="company">公司共享笔记</option></select></label>
          <p v-if="noteScope === 'company' && !companyWritable" class="muted">当前账号可查阅公司笔记，暂无修改权限。</p>
          <label class="favorite"><input v-model="favorite" type="checkbox" :disabled="saving || noteScope === 'company' && !companyWritable" /><Bookmark :size="15" />关注此对象</label>
          <label>笔记<textarea v-model="note" rows="6" maxlength="2000" :disabled="saving || noteScope === 'company' && !companyWritable" placeholder="记录待确认事项、来源或交接提醒，最多 2000 字" /></label>
          <label>标签<input v-model="tags" :disabled="saving || noteScope === 'company' && !companyWritable" placeholder="用逗号分隔，最多 10 个" /></label>
          <p v-if="saveError" role="alert" class="error">{{ saveError }}</p><p v-if="saved" role="status">笔记已保存</p>
          <div v-if="conflict" class="conflict">
            <template v-if="latestLoaded"><strong>最新笔记 · v{{ overlay?.version ?? 0 }}</strong><pre>{{ overlay?.note || '无笔记正文' }}</pre></template>
            <p v-else role="status">{{ latestLoading ? '正在读取最新笔记，当前草稿保持不变。' : '最新笔记尚未读取成功，请重试后再核对。' }}</p>
            <button :disabled="latestLoading" @click="reloadConflictLatest">{{ latestLoading ? '正在读取最新版本…' : latestLoaded ? '重新读取最新版本' : '重试读取最新版本' }}</button>
            <button :disabled="!latestLoaded || latestLoading || saving" @click="adoptLatestNote">采用最新版本</button><button :disabled="!latestLoaded || latestLoading || saving" @click="keepConflictDraft">已核对，保留当前草稿</button>
          </div>
          <button :disabled="saving || conflict || noteScope === 'company' && !companyWritable" @click="saveNote"><Save :size="15" />{{ saving ? '正在保存…' : '保存笔记' }}</button>
        </section>
      </template>
    </div>
  </el-drawer>
</template>

<style>
/* The drawer is teleported; keep shell overrides local to this object panel. */
.grid-object-shell.el-drawer { --el-drawer-padding-primary: 20px; background: var(--panel); }
.grid-object-shell .el-drawer__header { align-items: center; margin-bottom: 0; padding: 12px 20px; border-bottom: 1px solid var(--line); color: var(--text-soft); }
.grid-object-shell .el-drawer__title { font-size: var(--font-sm); font-weight: 600; }
.grid-object-shell .el-drawer__close-btn { display: grid; width: 28px; height: 28px; padding: 0; place-items: center; color: var(--text-soft); }
.grid-object-shell .el-drawer__body { padding: 16px 20px 24px; }
@media (max-width: 560px) {
  .grid-object-shell .el-drawer__header { padding: 10px 16px; }
  .grid-object-shell .el-drawer__body { padding: 14px 16px 20px; }
}
</style>

<style scoped>
.object-drawer { color: var(--text); font-size: var(--font-sm); line-height: 1.5; }
.object-drawer :deep(svg) { flex-shrink: 0; }
.object-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
.object-identity { min-width: 0; }
.object-name { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.object-name h2 { margin: 0; font-size: var(--font-xl); line-height: 1.4; overflow-wrap: anywhere; }
.object-type { padding: 2px 7px; border-radius: 4px; color: var(--primary); background: color-mix(in srgb, var(--primary) 9%, var(--panel)); font-size: var(--font-xs); white-space: nowrap; }
.object-address { display: flex; align-items: flex-start; gap: 5px; margin: 6px 0 0; color: var(--text-soft); overflow-wrap: anywhere; }
.object-address svg { margin-top: 2px; }
.object-time { display: flex; flex-shrink: 0; flex-direction: column; align-items: flex-end; gap: 5px; }
.object-time label { display: flex; align-items: center; gap: 8px; color: var(--text-soft); }
.object-time > span { color: var(--text-soft); font-size: var(--font-xs); }
.object-drawer button, .source { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 5px 10px; border: 1px solid var(--line); border-radius: 5px; color: var(--text); background: var(--panel); cursor: pointer; font: inherit; text-decoration: none; }
.object-drawer button:hover:not(:disabled), .source:hover { color: var(--primary); border-color: var(--primary); background: color-mix(in srgb, var(--primary) 5%, var(--panel)); }
.object-drawer button:disabled { opacity: .5; cursor: not-allowed; }
.object-drawer button:focus-visible, .object-drawer input:focus-visible, .object-drawer textarea:focus-visible, .object-drawer select:focus-visible, .object-drawer summary:focus-visible, .source:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.object-drawer input, .object-drawer textarea, .object-drawer select { box-sizing: border-box; min-height: 32px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 5px; color: var(--text); background: var(--panel); font: inherit; }
.object-drawer input[type=checkbox] { min-height: auto; accent-color: var(--primary); }
.links { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 14px 0 12px; padding: 4px; border-radius: 6px; background: var(--bg); }
.links button { flex: 1 1 auto; padding: 4px 8px; border-color: transparent; background: transparent; }
.tabs { display: flex; gap: 20px; margin: 0 0 16px; border-bottom: 1px solid var(--line); }
.tabs button { min-height: 38px; padding: 7px 0; border: 0; border-bottom: 2px solid transparent; border-radius: 0; color: var(--text-soft); background: transparent; }
.tabs button:hover:not(:disabled) { border-bottom-color: var(--primary); background: transparent; }
.tabs [aria-selected=true] { color: var(--primary); border-bottom-color: var(--primary); font-weight: 600; }
.section-title { display: flex; align-items: center; gap: 7px; margin: 16px 0 8px; font-size: var(--font-sm); font-weight: 650; }
.section-title:first-child { margin-top: 0; }
.section-count { min-width: 18px; padding: 1px 5px; border-radius: 4px; color: var(--text-soft); background: var(--bg); font-size: var(--font-xs); text-align: center; font-weight: 500; }
.facts { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 24px; margin: 0; padding: 0 10px; border-radius: 5px; background: var(--bg); }
.facts > div { display: grid; grid-template-columns: 70px minmax(0, 1fr); align-items: baseline; gap: 8px; min-width: 0; padding: 8px 0; }
.facts dt { color: var(--text-soft); }
.facts dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.facts .fact-wide { grid-column: 1 / -1; }
.relations { display: flex; flex-direction: column; gap: 4px; }
.relations button { justify-content: space-between; min-width: 0; padding: 7px 10px; text-align: left; overflow-wrap: anywhere; }
.muted { margin: 6px 0; color: var(--text-soft); overflow-wrap: anywhere; }
.source-section { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line); }
.source-meta { display: grid; gap: 8px; margin: 0; }
.source-meta > div { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 8px; align-items: baseline; }
.source-meta dt { color: var(--text-soft); font-size: var(--font-xs); }
.source-meta dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.source-notes { margin-top: 10px; color: var(--text-soft); }
.source-notes summary { cursor: pointer; font-size: var(--font-xs); }
.source-notes summary span { margin-left: 6px; }
.source-notes ul { display: grid; gap: 6px; margin: 10px 0 0; padding-left: 18px; font-size: var(--font-xs); }
.source-notes li { padding-left: 2px; overflow-wrap: anywhere; }
.empty-tag { display: inline-flex; padding: 3px 8px; border-radius: 4px; color: var(--text-soft); background: var(--bg); font-size: var(--font-xs); }
.source { min-height: 28px; margin: 4px 8px 0 0; padding: 3px 0; border-color: transparent; color: var(--primary); background: transparent; }
.management { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 12px; }
.management summary { color: var(--text-soft); cursor: pointer; }
.notes > label { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; }
.notes > label:first-child { margin-top: 0; }
.notes .favorite { flex-direction: row; align-items: center; }
.notes textarea { width: 100%; resize: vertical; }
.error { color: var(--el-color-danger, #b42318); }
.conflict { padding: 12px; margin: 10px 0; background: #fff6df; color: #684700; }
.conflict pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
.conflict button { margin: 4px 4px 0 0; }
.back { margin-bottom: 12px; }
@media (max-width: 560px) {
  .object-heading { flex-direction: column; gap: 12px; }
  .object-time { width: 100%; flex-direction: row; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 6px; }
  .facts { grid-template-columns: minmax(0, 1fr); }
  .facts > div { grid-template-columns: 80px minmax(0, 1fr); padding: 7px 0; }
  .links { gap: 2px; }
  .links button { flex: 1 1 28%; }
  .tabs { gap: 16px; }
}
</style>
