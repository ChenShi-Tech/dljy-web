<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { currentRegion as appRegion } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { onRegionChange } from '@/composables/useRegionReload'
import {
  Activity, AlertTriangle, ArrowRight, Bookmark, CalendarClock, CheckCircle2,
  Database, ExternalLink, Factory, FileSearch, Globe2, Heart, Layers3,
  MapPinned, Network, RefreshCw, Search, ShieldCheck, Sparkles, X, Zap,
} from 'lucide-vue-next'
import {
  fetchGridDisclosureEvent, fetchGridDisclosureEvents, fetchGridDisclosureProviders,
  saveGridDisclosureOverlay,
} from './client'
import GridOperatorProfileBanner from './GridOperatorProfileBanner.vue'
import type { GridDisclosureCategory, GridDisclosureEvent, GridDisclosureOverlay, GridDisclosureProvider, GridOperatorProfile } from './types'

const regions = [
  { id: 'yunnan', label: '云南', accent: '#2dd4bf' },
  { id: 'guangdong', label: '广东', accent: '#60a5fa' },
  { id: 'guangxi', label: '广西', accent: '#a78bfa' },
  { id: 'guizhou', label: '贵州', accent: '#f59e0b' },
  { id: 'hainan', label: '海南', accent: '#fb7185' },
] as const
const categories: Array<{ id: '' | GridDisclosureCategory; label: string; icon: typeof Zap }> = [
  { id: '', label: '全部事件', icon: Layers3 },
  { id: 'maintenance', label: '检修计划', icon: Factory },
  { id: 'outage', label: '非计划停运', icon: AlertTriangle },
  { id: 'intervention', label: '人工干预', icon: Activity },
  { id: 'congestion', label: '断面阻塞', icon: Zap },
  { id: 'constraint', label: '输电约束', icon: Network },
]

const loading = ref(false)
const providers = ref<GridDisclosureProvider[]>([])
const events = ref<GridDisclosureEvent[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 24
const region = ref(appRegion.value.id)
const operatorProfile = ref<GridOperatorProfile | null>(null)
const category = ref<'' | GridDisclosureCategory>('')
const keyword = ref('')
const from = ref('')
const to = ref('')
const availability = ref<{ status: string; reason: string } | null>(null)
const selected = ref<GridDisclosureEvent | null>(null)
const overlays = ref<GridDisclosureOverlay[]>([])
const overlayScope = ref<'user' | 'company'>('user')
const overlayNote = ref('')
const overlayTags = ref('')
const overlayFavorite = ref(false)
const saving = ref(false)
let filterTimer: number | undefined
let listRequestId = 0
let detailRequestId = 0
let scopeEpoch = 0

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const activeProvider = computed(() => providers.value.find((item) => item.gridOperator === operatorProfile.value?.id))
const alternateProvider = computed(() => providers.value.find((item) => item.gridOperator !== operatorProfile.value?.id))
const regionOptions = computed(() => operatorProfile.value?.id === 'csg'
  ? regions
  : [{ id: appRegion.value.id, label: appRegion.value.shortName, accent: operatorProfile.value?.visual.accent ?? '#60a5fa' }])
const selectedRegion = computed(() => regionOptions.value.find((item) => item.id === region.value) ?? regionOptions.value[0])
const currentOverlay = computed(() => overlays.value.find((item) => item.scope === overlayScope.value))
const pageMetrics = computed(() => ({
  maintenance: events.value.filter((item) => item.category === 'maintenance').length,
  urgent: events.value.filter((item) => ['outage', 'intervention'].includes(item.category)).length,
  regional: events.value.filter((item) => item.spatialBinding.kind === 'region').length,
}))

function dateText(value: string | null, includeTime = false) {
  if (!value) return '未提供'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat('zh-CN', includeTime
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
    : { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function categoryMeta(value: GridDisclosureCategory) {
  return categories.find((item) => item.id === value) ?? categories[0]
}

function regionLabel(id: string) {
  return id === 'csg' ? '南网全网' : regions.find((item) => item.id === id)?.label ?? id
}

async function load() {
  const requestId = ++listRequestId
  loading.value = true
  try {
    const result = await fetchGridDisclosureEvents({
      region: region.value, page: page.value, pageSize,
      ...(category.value ? { category: category.value } : {}),
      ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
      ...(from.value ? { from: `${from.value}T00:00:00+08:00` } : {}),
      ...(to.value ? { to: `${to.value}T23:59:59+08:00` } : {}),
    })
    if (requestId !== listRequestId) return
    events.value = result.items
    total.value = result.total
    availability.value = result.dataAvailability
  } catch (cause) {
    if (requestId !== listRequestId) return
    ElMessage.error(cause instanceof Error ? cause.message : '披露空间层加载失败')
  } finally { if (requestId === listRequestId) loading.value = false }
}

async function openEvent(item: GridDisclosureEvent) {
  const requestId = ++detailRequestId
  selected.value = item
  try {
    const detail = await fetchGridDisclosureEvent(item.eventId)
    if (requestId !== detailRequestId) return
    selected.value = detail.event
    overlays.value = detail.overlays
    syncOverlay()
  } catch (cause) { ElMessage.error(cause instanceof Error ? cause.message : '披露详情加载失败') }
}

function syncOverlay() {
  const item = currentOverlay.value
  overlayNote.value = item?.note ?? ''
  overlayTags.value = item?.tags.join('，') ?? ''
  overlayFavorite.value = item?.favorite ?? false
}

async function saveOverlay() {
  if (!selected.value) return
  const epoch = scopeEpoch
  saving.value = true
  try {
    const saved = await saveGridDisclosureOverlay(selected.value.eventId, {
      scope: overlayScope.value, favorite: overlayFavorite.value, note: overlayNote.value.trim(),
      tags: overlayTags.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
      expectedVersion: currentOverlay.value?.version ?? 0,
    })
    if (epoch !== scopeEpoch) return
    overlays.value = [...overlays.value.filter((item) => item.scope !== saved.scope), saved]
    ElMessage.success(saved.scope === 'user' ? '个人收藏与笔记已保存' : '公司协作标注已保存')
  } catch (cause) { ElMessage.error(cause instanceof Error ? cause.message : '标注保存失败') }
  finally { saving.value = false }
}

async function loadProviders() {
  const epoch = scopeEpoch
  try {
    const result = await fetchGridDisclosureProviders()
    if (epoch === scopeEpoch) providers.value = result.providers
  } catch {
    if (epoch === scopeEpoch) providers.value = []
  }
}

function resetCompanyScope() {
  scopeEpoch += 1
  listRequestId += 1
  detailRequestId += 1
  selected.value = null
  overlays.value = []
  overlayNote.value = ''
  overlayTags.value = ''
  overlayFavorite.value = false
  events.value = []
  total.value = 0
  page.value = 1
  availability.value = null
  providers.value = []
  void Promise.all([loadProviders(), load()])
}

function selectRegion(id: string) {
  region.value = id
  page.value = 1
}

function changePage(next: number) {
  if (next < 1 || next > totalPages.value || next === page.value) return
  page.value = next
  void load()
}

watch(overlayScope, syncOverlay)
watch([region, category, from, to], () => { page.value = 1; void load() })
watch(keyword, () => {
  page.value = 1
  if (filterTimer) window.clearTimeout(filterTimer)
  filterTimer = window.setTimeout(load, 260)
})
onMounted(async () => {
  await loadProviders()
  await load()
})
onRegionChange(async () => {
  region.value = appRegion.value.id
  resetCompanyScope()
})
watch(selectedCompanyId, resetCompanyScope)
</script>

<template>
  <section class="disclosure-page">
    <div class="ambient ambient-a" /><div class="ambient ambient-b" />
    <GridOperatorProfileBanner compact @profile="operatorProfile = $event" />
    <header class="hero">
      <div class="hero-copy">
        <div class="eyebrow"><Sparkles :size="14" /> CSG DISCLOSURE INTELLIGENCE LAYER</div>
        <h1>公开披露空间层</h1>
        <p>把检修、停运、人工干预与断面约束放回电网地理语境。{{ operatorProfile?.id === 'sgcc' ? '当前国网地区尚未接入省级披露源，将保持空态。' : '只按来源证据绑定区域或断面，不用推测坐标制造“精确感”。' }}</p>
        <div class="truth-row">
          <span><ShieldCheck :size="14" />真实授权导出</span><span><Database :size="14" />mock=false</span><span><MapPinned :size="14" />零伪造坐标</span>
        </div>
      </div>
      <div class="hero-orbit">
        <div class="orbit-ring ring-a"/><div class="orbit-ring ring-b"/>
        <Globe2 :size="44" /><strong>{{ total.toLocaleString('zh-CN') }}</strong><small>{{ selectedRegion?.label }}可见事件</small>
      </div>
    </header>

    <div class="provider-strip">
      <div class="provider-main"><span class="live-dot"/><div><small>ACTIVE PROVIDER</small><strong>{{ activeProvider?.name ?? '南方电网披露导入层' }}</strong></div><span class="availability">{{ activeProvider?.dataAvailability.status ?? 'loading' }}</span></div>
      <div class="provider-note"><FileSearch :size="17"/><span>原文链接仅在源包提供 URL 时出现；当前导出记录保留源文件、表名和行 ID。</span></div>
      <div class="sgcc-state"><Network :size="17"/><span>{{ alternateProvider?.name ?? '另一电网 Provider' }}</span><b>{{ alternateProvider?.dataAvailability.status ?? 'not-configured' }}</b></div>
    </div>

    <div class="workspace">
      <aside class="spatial-panel">
        <div class="panel-title"><span><Globe2 :size="18"/>空间范围</span><small>区域级示意 · 非经纬度点位</small></div>
        <div class="region-field">
          <div class="grid-lines"/>
          <button v-for="(item, index) in regionOptions" :key="item.id" :class="['region-node', `node-${index}`, { active: region === item.id }]" :style="{ '--accent': item.accent }" @click="selectRegion(item.id)">
            <span class="pulse"/><b>{{ item.label }}</b><small>{{ region === item.id ? total.toLocaleString('zh-CN') : '切换查看' }}</small>
          </button>
          <div class="network-core"><Zap :size="21"/><small>{{ operatorProfile?.visual.glyph ?? 'GRID' }}</small></div>
        </div>
        <div class="scope-card">
          <div><span class="scope-icon"><MapPinned :size="18"/></span><div><small>当前空间范围</small><strong>{{ selectedRegion?.label }} · {{ operatorProfile?.terminology.disclosure ?? '电网披露' }}</strong></div></div>
          <p>设备缺少公开坐标时保持区域级绑定；断面缺少几何时只显示名称，不绘制虚构线路。</p>
        </div>
        <div class="mini-metrics">
          <div><Factory/><span><small>本页检修</small><strong>{{ pageMetrics.maintenance }}</strong></span></div>
          <div><AlertTriangle/><span><small>停运/干预</small><strong>{{ pageMetrics.urgent }}</strong></span></div>
          <div><MapPinned/><span><small>区域绑定</small><strong>{{ pageMetrics.regional }}</strong></span></div>
        </div>
      </aside>

      <main class="feed-panel">
        <div class="filters">
          <label class="search"><Search :size="17"/><input v-model="keyword" placeholder="搜索设备、电厂、断面或原因"/></label>
          <label><CalendarClock :size="15"/><input v-model="from" type="date" aria-label="开始日期"/></label>
          <span class="date-separator">至</span>
          <label><input v-model="to" type="date" aria-label="结束日期"/></label>
          <button class="refresh" @click="load"><RefreshCw :size="16"/>刷新</button>
        </div>
        <div class="category-tabs">
          <button v-for="item in categories" :key="item.id || 'all'" :class="{ active: category === item.id }" @click="category = item.id"><component :is="item.icon" :size="15"/>{{ item.label }}</button>
        </div>

        <div v-if="availability?.status === 'missing' && !loading" class="honest-empty"><CheckCircle2 :size="25"/><div><strong>当前筛选没有已导入披露</strong><p>{{ availability.reason }}</p></div></div>
        <div v-loading="loading" class="event-feed">
          <article v-for="item in events" :key="item.eventId" :class="['event-card', item.category]" @click="openEvent(item)">
            <div class="event-rail"><span class="event-dot"><component :is="categoryMeta(item.category).icon" :size="15"/></span><i/></div>
            <div class="event-body">
              <div class="event-kicker"><span>{{ categoryMeta(item.category).label }}</span><time>{{ dateText(item.effectiveAt, true) }}</time></div>
              <h3>{{ item.title }}</h3><p>{{ item.summary }}</p>
              <div class="event-meta"><span><MapPinned :size="13"/>{{ item.spatialBinding.label }}</span><span><ShieldCheck :size="13"/>{{ regionLabel(item.regionId) }}</span><span><Database :size="13"/>{{ item.source.sourceTable.replace('tb_disclosure_', '') }}</span></div>
            </div>
            <button class="open-button" aria-label="打开详情"><ArrowRight :size="17"/></button>
          </article>
        </div>
        <footer v-if="totalPages > 1" class="pager"><button :disabled="page <= 1" @click="changePage(page - 1)">上一页</button><span>第 {{ page }} / {{ totalPages }} 页 · {{ total.toLocaleString('zh-CN') }} 条</span><button :disabled="page >= totalPages" @click="changePage(page + 1)">下一页</button></footer>
      </main>
    </div>

    <div v-if="selected" class="drawer-backdrop" @click.self="selected = null">
      <aside class="detail-drawer">
        <button class="close" @click="selected = null"><X :size="19"/></button>
        <div class="detail-hero" :class="selected.category"><span><component :is="categoryMeta(selected.category).icon" :size="20"/></span><small>{{ categoryMeta(selected.category).label }} · {{ regionLabel(selected.regionId) }}</small><h2>{{ selected.title }}</h2><p>{{ selected.summary }}</p></div>
        <div class="detail-section"><h3><MapPinned :size="16"/>空间证据</h3><div class="binding-card"><Globe2 :size="25"/><div><strong>{{ selected.spatialBinding.label }}</strong><small>{{ selected.spatialBinding.kind }} binding · coordinates=null</small></div></div><p class="explain">此卡片只表达源记录可证明的范围，不代表设备或断面的精确几何位置。</p></div>
        <div class="detail-section"><h3><CalendarClock :size="16"/>事件时间</h3><dl><div><dt>生效时间</dt><dd>{{ dateText(selected.effectiveAt, true) }}</dd></div><div><dt>结束/失效</dt><dd>{{ dateText(selected.expiresAt, true) }}</dd></div><div><dt>导出入库时间</dt><dd>{{ dateText(selected.publishedAt, true) }}</dd></div></dl></div>
        <div class="detail-section"><h3><Database :size="16"/>来源与可追溯性</h3><dl><div><dt>源表</dt><dd>{{ selected.source.sourceTable }}</dd></div><div><dt>源文件</dt><dd>{{ selected.source.file }}</dd></div><div><dt>源记录 ID</dt><dd>{{ selected.source.recordId }}</dd></div><div><dt>可信状态</dt><dd>verified-source-row</dd></div></dl><a v-if="selected.source.url" :href="selected.source.url" target="_blank" rel="noopener">打开公开原文 <ExternalLink :size="14"/></a><p v-else class="no-link">源导出未提供公开 URL，未生成替代链接。</p><p class="license">{{ selected.source.license }}</p></div>
        <div class="detail-section overlay-editor"><h3><Bookmark :size="16"/>协作图层</h3><div class="scope-tabs"><button :class="{ active: overlayScope === 'user' }" @click="overlayScope = 'user'">个人笔记</button><button :class="{ active: overlayScope === 'company' }" @click="overlayScope = 'company'">公司标注</button></div><label class="favorite"><input v-model="overlayFavorite" type="checkbox"/><Heart :size="17" :fill="overlayFavorite ? 'currentColor' : 'none'"/>加入收藏</label><textarea v-model="overlayNote" rows="4" placeholder="记录交易影响、跟踪事项或复盘结论…"/><input v-model="overlayTags" placeholder="标签，以逗号分隔（最多 10 个）"/><button class="save" :disabled="saving" @click="saveOverlay">{{ saving ? '保存中…' : '保存标注' }}</button></div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.disclosure-page{--ink:#dcecff;--muted:#8399b5;--line:rgba(117,156,197,.16);position:relative;min-height:100%;overflow:hidden;padding:24px;color:var(--ink);background:radial-gradient(circle at 18% -10%,#123a52 0,transparent 32%),radial-gradient(circle at 90% 18%,#25204d 0,transparent 27%),linear-gradient(145deg,#07111d,#081724 45%,#050c16)}
.ambient{position:absolute;border-radius:50%;filter:blur(80px);pointer-events:none}.ambient-a{width:280px;height:280px;right:14%;top:30%;background:#0ea5e933;animation:float 9s ease-in-out infinite}.ambient-b{width:220px;height:220px;left:2%;bottom:10%;background:#8b5cf622;animation:float 11s ease-in-out infinite reverse}@keyframes float{50%{transform:translateY(28px) scale(1.08)}}
.hero{position:relative;display:flex;align-items:center;justify-content:space-between;max-width:1520px;margin:auto;padding:26px 30px;border:1px solid var(--line);border-radius:24px;background:linear-gradient(110deg,rgba(14,35,54,.92),rgba(10,21,36,.7));box-shadow:0 22px 70px #0008,inset 0 1px #ffffff0d}.hero-copy{max-width:820px}.eyebrow{display:flex;align-items:center;gap:7px;color:#67e8f9;font-size: var(--font-15);font-weight:800;letter-spacing:.18em}.hero h1{margin:10px 0 8px;font-size:clamp(30px,4vw,52px);line-height:1.05;letter-spacing:-.04em;background:linear-gradient(100deg,#fff,#bdeaff 55%,#c4b5fd);-webkit-background-clip:text;color:transparent}.hero p{margin:0;max-width:760px;color:#9ab0c9;line-height:1.75}.truth-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.truth-row span{display:flex;align-items:center;gap:6px;padding:7px 10px;border:1px solid #49d8c72c;border-radius:99px;color:#a7f3d0;background:#0b443b3a;font-size: var(--font-15)}.hero-orbit{position:relative;width:160px;height:160px;display:grid;place-content:center;text-align:center;color:#67e8f9;flex:0 0 auto}.hero-orbit strong{font-size: var(--font-28);color:#fff;margin-top:5px}.hero-orbit small{color:#8ca3bd}.orbit-ring{position:absolute;inset:8px;border:1px solid #38bdf84d;border-radius:50%;animation:spin 12s linear infinite}.ring-a:after,.ring-b:after{content:"";position:absolute;width:8px;height:8px;border-radius:50%;background:#67e8f9;box-shadow:0 0 18px #67e8f9;left:18px;top:12px}.ring-b{inset:22px;border-style:dashed;animation-direction:reverse;animation-duration:17s}@keyframes spin{to{transform:rotate(360deg)}}
.provider-strip{position:relative;max-width:1520px;margin:14px auto;display:grid;grid-template-columns:1.15fr 1.6fr .75fr;gap:1px;border:1px solid var(--line);border-radius:15px;overflow:hidden;background:var(--line)}.provider-strip>div{min-height:62px;padding:12px 16px;background:#091522e8;display:flex;align-items:center;gap:11px}.provider-main small{display:block;font-size: var(--font-lg);letter-spacing:.16em;color:#6f89a6}.provider-main strong{font-size: var(--font-16)}.live-dot{width:9px;height:9px;border-radius:50%;background:#34d399;box-shadow:0 0 16px #34d399}.availability{margin-left:auto;color:#6ee7b7;font-size: var(--font-15)}.provider-note,.sgcc-state{font-size: var(--font-15);color:#8da3bd}.sgcc-state b{margin-left:auto;color:#fbbf24;font-weight:600}
.workspace{position:relative;max-width:1520px;margin:auto;display:grid;grid-template-columns:380px 1fr;gap:14px}.spatial-panel,.feed-panel{border:1px solid var(--line);border-radius:20px;background:rgba(7,17,29,.82);backdrop-filter:blur(18px);box-shadow:0 22px 60px #0005}.spatial-panel{padding:18px;height:max-content;position:sticky;top:18px}.panel-title{display:flex;align-items:center;justify-content:space-between}.panel-title>span{display:flex;align-items:center;gap:8px;font-weight:700}.panel-title small{font-size: var(--font-15);color:#6f86a0}.region-field{height:300px;position:relative;margin:16px 0;border:1px solid #4c78982b;border-radius:18px;overflow:hidden;background:radial-gradient(circle at 50% 50%,#0b475350,transparent 38%),linear-gradient(#071522aa,#06111c)}.grid-lines{position:absolute;inset:0;background-image:linear-gradient(#6ea5c40c 1px,transparent 1px),linear-gradient(90deg,#6ea5c40c 1px,transparent 1px);background-size:28px 28px;mask-image:radial-gradient(circle,#000,transparent 80%)}.region-node{--accent:#67e8f9;position:absolute;width:76px;height:60px;border:1px solid color-mix(in srgb,var(--accent) 38%,transparent);border-radius:14px;color:#b6c9dd;background:#071927da;box-shadow:0 9px 24px #0006;cursor:pointer;transition:.22s}.region-node:hover,.region-node.active{transform:translateY(-3px);border-color:var(--accent);box-shadow:0 0 26px color-mix(in srgb,var(--accent) 22%,transparent)}.region-node b,.region-node small{display:block}.region-node small{font-size: var(--font-lg);color:#6f849c;margin-top:3px}.pulse{position:absolute;right:8px;top:8px;width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent)}.node-0{left:20px;top:48px}.node-1{right:18px;top:53px}.node-2{left:35px;bottom:38px}.node-3{right:42px;bottom:35px}.node-4{left:150px;bottom:10px}.network-core{position:absolute;left:50%;top:49%;transform:translate(-50%,-50%);width:66px;height:66px;border:1px solid #67e8f966;border-radius:50%;display:grid;place-content:center;text-align:center;color:#67e8f9;background:#0b3344;box-shadow:0 0 35px #06b6d42c}.network-core small{font-size: var(--font-lg);letter-spacing:.1em}.scope-card{padding:13px;border:1px solid #3d6a8633;border-radius:15px;background:linear-gradient(110deg,#0d2839aa,#111c31aa)}.scope-card>div{display:flex;gap:10px;align-items:center}.scope-icon{width:35px;height:35px;display:grid;place-content:center;border-radius:10px;color:#67e8f9;background:#164052}.scope-card small,.scope-card strong{display:block}.scope-card small{color:#708ba6;font-size: var(--font-15)}.scope-card strong{font-size: var(--font-16)}.scope-card p{font-size: var(--font-15);color:#8197af;line-height:1.6;margin:10px 0 0}.mini-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px}.mini-metrics>div{display:flex;align-items:center;gap:7px;padding:10px 8px;border:1px solid var(--line);border-radius:12px;color:#60a5fa}.mini-metrics svg{width:16px}.mini-metrics small,.mini-metrics strong{display:block}.mini-metrics small{font-size: var(--font-lg);color:#7189a4}.mini-metrics strong{font-size: var(--font-20);color:#e9f4ff}
.feed-panel{padding:18px;min-width:0}.filters{display:flex;align-items:center;gap:8px}.filters label{height:38px;display:flex;align-items:center;gap:7px;padding:0 11px;border:1px solid var(--line);border-radius:11px;background:#07121e;color:#7690aa}.filters input{border:0;outline:0;background:transparent;color:#cfe4f7;min-width:0}.search{flex:1}.search input{width:100%}.date-separator{color:#627891;font-size: var(--font-15)}.refresh{height:38px;display:flex;align-items:center;gap:6px;border:1px solid #2b7fa268;border-radius:11px;color:#8de8ff;background:#0b2b3d;padding:0 13px;cursor:pointer}.category-tabs{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0}.category-tabs button{display:flex;align-items:center;gap:6px;padding:8px 11px;border:1px solid var(--line);border-radius:10px;color:#8198b2;background:#081522;cursor:pointer}.category-tabs button.active{color:#dff8ff;border-color:#22d3ee77;background:#0e3a4b}.event-feed{min-height:360px}.event-card{position:relative;display:grid;grid-template-columns:30px 1fr 34px;gap:11px;padding:15px 12px;border:1px solid transparent;border-radius:15px;cursor:pointer;transition:.2s}.event-card:hover{border-color:#47708c4d;background:#0d1f2e;transform:translateX(3px)}.event-rail{display:flex;flex-direction:column;align-items:center}.event-dot{width:29px;height:29px;display:grid;place-content:center;border-radius:10px;color:#67e8f9;background:#123546;border:1px solid #67e8f940}.event-rail i{width:1px;flex:1;min-height:48px;background:linear-gradient(#40829c55,transparent);margin-top:5px}.event-card.outage .event-dot,.event-card.intervention .event-dot{color:#fda4af;background:#4b1826;border-color:#fb718544}.event-card.constraint .event-dot,.event-card.congestion .event-dot{color:#c4b5fd;background:#281b4b;border-color:#a78bfa44}.event-kicker{display:flex;align-items:center;gap:9px;font-size: var(--font-15)}.event-kicker span{color:#67e8f9;text-transform:uppercase;letter-spacing:.08em}.event-kicker time{color:#6f849e}.event-body h3{font-size: var(--font-xl);margin:6px 0;color:#e8f4ff}.event-body>p{font-size: var(--font-15);line-height:1.6;color:#8fa5bd;margin:0}.event-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.event-meta span{display:flex;align-items:center;gap:4px;padding:4px 7px;border-radius:7px;color:#7892ad;background:#0c1a27;font-size: var(--font-lg)}.open-button{align-self:center;width:31px;height:31px;display:grid;place-content:center;border:1px solid var(--line);border-radius:10px;color:#7590a9;background:#0a1723}.event-card:hover .open-button{color:#67e8f9;border-color:#22d3ee55}.honest-empty{display:flex;gap:12px;align-items:flex-start;padding:18px;border:1px solid #34d3993b;border-radius:14px;color:#6ee7b7;background:#06332950}.honest-empty strong{color:#d8fff0}.honest-empty p{margin:4px 0;color:#76a697;font-size: var(--font-15)}.pager{display:flex;align-items:center;justify-content:center;gap:14px;padding-top:16px;border-top:1px solid var(--line);color:#728aa3;font-size: var(--font-15)}.pager button{padding:7px 12px;border:1px solid var(--line);border-radius:8px;color:#a6bfd8;background:#0b1926}.pager button:disabled{opacity:.35}
.drawer-backdrop{position:fixed;z-index:1000;inset:0;background:#01070dbd;backdrop-filter:blur(7px)}.detail-drawer{position:absolute;right:0;top:0;height:100%;width:min(520px,94vw);overflow:auto;padding:24px;background:linear-gradient(160deg,#0b1b2a,#07111c);border-left:1px solid #52809a4a;box-shadow:-30px 0 90px #000a}.close{position:absolute;z-index:2;right:18px;top:18px;width:35px;height:35px;display:grid;place-content:center;border:1px solid #ffffff20;border-radius:10px;color:#afc5da;background:#07111caa}.detail-hero{padding:28px 18px 20px;border-radius:18px;background:radial-gradient(circle at 90% 5%,#22d3ee2b,transparent 35%),#0c2534}.detail-hero>span{display:grid;place-content:center;width:40px;height:40px;border-radius:12px;color:#67e8f9;background:#124458}.detail-hero small{display:block;margin-top:15px;color:#67e8f9}.detail-hero h2{font-size: var(--font-26);line-height:1.25;margin:6px 0}.detail-hero p{font-size: var(--font-15);line-height:1.7;color:#9aafc6}.detail-section{padding:20px 3px;border-bottom:1px solid var(--line)}.detail-section h3{display:flex;gap:7px;align-items:center;font-size: var(--font-16);color:#cde9fa;margin:0 0 13px}.binding-card{display:flex;gap:12px;align-items:center;padding:14px;border:1px solid #22d3ee38;border-radius:13px;color:#67e8f9;background:#0b2d3b}.binding-card strong,.binding-card small{display:block}.binding-card strong{font-size: var(--font-16);color:#dff8ff}.binding-card small{margin-top:3px;font-size: var(--font-15);color:#789eb1}.explain,.no-link,.license{font-size: var(--font-15);line-height:1.6;color:#748ba3}.detail-section dl{margin:0}.detail-section dl>div{display:grid;grid-template-columns:115px 1fr;gap:12px;padding:8px 0;border-bottom:1px dashed #67809a1f;font-size: var(--font-15)}.detail-section dt{color:#7188a1}.detail-section dd{margin:0;color:#c2d5e7;word-break:break-all}.detail-section a{display:inline-flex;gap:5px;align-items:center;color:#67e8f9;font-size: var(--font-15)}.license{padding:9px;border-radius:9px;background:#35280c6b;color:#d6b96d}.scope-tabs{display:flex;gap:6px}.scope-tabs button{flex:1;padding:8px;border:1px solid var(--line);border-radius:9px;color:#7891aa;background:#071522}.scope-tabs button.active{color:#dff8ff;border-color:#22d3ee66;background:#0e3445}.favorite{display:flex;align-items:center;gap:7px;margin:13px 0;color:#fda4af;font-size: var(--font-15)}.overlay-editor textarea,.overlay-editor>input{box-sizing:border-box;width:100%;margin-bottom:8px;padding:11px;border:1px solid var(--line);border-radius:10px;outline:none;resize:vertical;color:#d7e8f8;background:#06111c}.save{width:100%;padding:11px;border:1px solid #22d3ee66;border-radius:10px;color:#dffaff;background:linear-gradient(100deg,#0e5264,#253b69)}
@media(max-width:1000px){.workspace{grid-template-columns:1fr}.spatial-panel{position:relative;top:auto}.region-field{height:240px}.provider-strip{grid-template-columns:1fr}.hero-orbit{display:none}}@media(max-width:680px){.disclosure-page{padding:10px}.hero{padding:20px}.provider-note{display:none!important}.filters{flex-wrap:wrap}.search{flex-basis:100%}.workspace{gap:9px}.spatial-panel,.feed-panel{padding:12px}.mini-metrics{display:none}.event-card{grid-template-columns:27px 1fr}.open-button{display:none}.event-meta span:nth-child(3){display:none}.hero h1{font-size: var(--font-36)}.truth-row span{font-size: var(--font-15)}}
</style>
