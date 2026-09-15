<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ClipboardList, RefreshCw } from 'lucide-vue-next'
import { compareUnitRosterDays, loadDisclosureUnitRoster, unitRosterDates, type UnitRosterEntry, type UnitRosterResult } from './disclosureUnitRoster'

const props = withDefaults(defineProps<{ regionId: string; dateFrom: string; dateTo: string; scopeKey: string; refreshKey?: string | number }>(), { refreshKey: 0 })
const emit = defineEmits<{ select: [entry: UnitRosterEntry]; loaded: [result: UnitRosterResult] }>()
const loading = ref(false)
const result = ref<UnitRosterResult | null>(null)
const selectedDate = ref(props.dateTo)
const keyword = ref('')
const stateFilter = ref('all')
const changeFilter = ref('all')
const page = ref(1)
let epoch = 0
const dates = computed(() => unitRosterDates(props.dateFrom, props.dateTo))
const currentDay = computed(() => result.value?.days.find((day) => day.date === selectedDate.value) ?? null)
const currentEntries = computed(() => currentDay.value?.entries ?? [])
const conflicts = computed(() => {
  const states = new Map<string, Set<string>>()
  for (const entry of currentEntries.value) states.set(entry.identity, new Set([...(states.get(entry.identity) ?? []), entry.state]))
  return new Set([...states].filter(([, values]) => values.size > 1).map(([key]) => key).concat(currentEntries.value.filter(entry => entry.qualityFlags.includes('conflicting-status')).map(entry => entry.identity)))
})
const comparison = computed(() => {
  const data = result.value
  const previous = data?.days.filter((day) => day.date < selectedDate.value).at(-1) ?? data?.baseline ?? null
  if (data?.status === 'partial') return { available: false, reason: data.reason, previousDate: null, changes: [] }
  if (!previous && data?.comparisonStatus !== 'missing') return { available: false, reason: data?.comparisonReason || '上一可用日未确认', previousDate: null, changes: [] }
  return compareUnitRosterDays(currentDay.value, previous)
})
const changedByKey = computed(() => new Map(comparison.value.changes.map((change) => [change.entry.key, change])))
const displayed = computed(() => {
  const rows = changeFilter.value === 'all' ? currentEntries.value : comparison.value.changes.filter((item) => item.kind === changeFilter.value).map((item) => item.entry)
  const term = keyword.value.trim().toLocaleLowerCase()
  return rows.filter((entry) => (stateFilter.value === 'all' || entry.state === stateFilter.value)
    && (!term || `${entry.plantName} ${entry.unitName} ${entry.regionName} ${entry.reason}`.toLocaleLowerCase().includes(term)))
})
const pageCount = computed(() => Math.max(1, Math.ceil(displayed.value.length / 20)))
const pageEntries = computed(() => displayed.value.slice((page.value - 1) * 20, page.value * 20))
const countState = (state: string) => currentEntries.value.filter((entry) => entry.state === state).length
const countChange = (kind: string) => comparison.value.changes.filter((change) => change.kind === kind).length
function changeLabel(entry: UnitRosterEntry) {
  const change = changedByKey.value.get(entry.key)
  return !change ? '' : change.kind === 'added' ? '新增列入' : change.kind === 'removed' ? '本日未列入' : `${change.previous?.state} → ${entry.state}`
}
async function load() {
  const token = ++epoch
  loading.value = true
  result.value = null
  selectedDate.value = props.dateTo
  keyword.value = ''; stateFilter.value = 'all'; changeFilter.value = 'all'; page.value = 1
  try {
    const data = await loadDisclosureUnitRoster({ regionId: props.regionId, dateFrom: props.dateFrom, dateTo: props.dateTo }, () => token === epoch)
    if (token !== epoch) return
    result.value = data
    emit('loaded', data)
  } catch {
    if (token === epoch) result.value = { status: 'error', reason: '必开必停名单读取失败，请重试', days: [], baseline: null, comparisonStatus: 'error', comparisonReason: '历史名单未确认', coverage: null }
  } finally { if (token === epoch) loading.value = false }
}
watch([() => props.regionId, () => props.scopeKey, () => props.dateFrom, () => props.dateTo, () => props.refreshKey], load, { immediate: true })
watch([selectedDate, keyword, stateFilter, changeFilter], () => { page.value = 1 })
watch(selectedDate, () => { changeFilter.value = 'all' })
onBeforeUnmount(() => { epoch += 1 })
</script>

<template>
  <section class="unit-roster" data-testid="desk-unit-roster" aria-label="必开必停机组名单" :aria-busy="loading">
    <header><div><h3><ClipboardList :size="18" />必开必停机组名单</h3><p>按业务日期披露的运行要求</p></div><button type="button" class="refresh" :disabled="loading" aria-label="刷新必开必停名单" @click="load"><RefreshCw :size="15" /></button></header>
    <div class="roster-controls">
      <label>名单日期<select v-model="selectedDate" aria-label="必开必停名单日期"><option v-for="date in dates" :key="date" :value="date">{{ date }}{{ result && !result.days.some(day => day.date === date) ? ' · 无名单' : '' }}</option></select></label>
      <label>运行要求<select v-model="stateFilter" aria-label="必开必停状态筛选"><option value="all">全部状态</option><option value="必开">必开</option><option value="必停">必停</option></select></label>
      <label>名单变化<select v-model="changeFilter" aria-label="必开必停变化筛选" :disabled="!comparison.available"><option value="all">当前名单</option><option value="added">新增列入</option><option value="removed">本日未列入</option><option value="changed">状态变化</option></select></label>
      <input v-model="keyword" type="search" aria-label="搜索电厂或机组" placeholder="搜索电厂 / 机组" />
    </div>
    <p v-if="loading" class="message" role="status">正在读取名单与上一可用日…</p>
    <template v-else-if="result">
      <p v-if="['error', 'unauthorized', 'not-configured'].includes(result.status)" class="message error" role="alert">{{ result.reason }}</p>
      <template v-else>
        <div class="roster-summary"><strong>{{ selectedDate }}</strong><span>必开 {{ countState('必开') }} 条</span><span>必停 {{ countState('必停') }} 条</span><span v-if="conflicts.size" class="conflict">{{ conflicts.size }} 台机组状态冲突</span></div>
        <p v-if="conflicts.size" class="message conflict">同一机组同时披露多个状态，已保留各条原始记录；本日名单变化暂不计算。</p>
        <p v-if="comparison.available" class="comparison">对比上一可用日 {{ comparison.previousDate }}：新增列入 {{ countChange('added') }} · 本日未列入 {{ countChange('removed') }} · 状态变化 {{ countChange('changed') }}</p>
        <p v-else class="comparison">{{ comparison.reason }}</p>
        <p v-if="!currentEntries.length" class="message">{{ selectedDate }} 没有可用名单，不代表没有必开或必停机组。<button v-if="result.baseline?.entries.length" type="button" class="latest-roster" @click="emit('select', result.baseline.entries[0])">查看最近名单 {{ result.baseline.date }}</button></p>
        <p v-else-if="!displayed.length" class="message">没有符合筛选条件的记录。</p>
        <ul v-else class="roster-list">
          <li v-for="entry in pageEntries" :key="entry.key" :class="{ 'has-conflict': conflicts.has(entry.identity) }">
            <div class="entry-heading"><button type="button" class="entry-title" @click="emit('select', entry)">{{ entry.plantName }} · {{ entry.unitName }}</button><span class="state" :class="{ stopped: entry.state === '必停' }">{{ entry.state }}</span><span v-if="conflicts.has(entry.identity)" class="conflict">状态冲突</span><span v-else-if="changeLabel(entry)" class="change">{{ changeLabel(entry) }}</span></div>
            <div class="entry-meta"><span>{{ entry.regionName }}</span><span>业务日期 {{ entry.date }}</span><span v-if="entry.reason">{{ entry.reason }}</span></div>
            <details><summary>来源与说明</summary><dl><div><dt>源文件</dt><dd>{{ entry.sourceFile || '未提供' }}</dd></div><div><dt>源表</dt><dd>{{ entry.sourceTable || '未提供' }}</dd></div><div><dt>源记录 ID</dt><dd>{{ entry.sourceRecordId || '未提供' }}</dd></div><div><dt>原因</dt><dd>{{ entry.reason || '未提供' }}</dd></div><div><dt>发布时间</dt><dd>{{ entry.publishedAt || '未提供' }}</dd></div></dl><p>该记录仅说明当日运行要求，源数据未提供分时生效区间。</p></details>
          </li>
        </ul>
        <nav v-if="displayed.length" class="pagination" aria-label="必开必停名单分页"><span>共 {{ displayed.length }} 条 · 第 {{ page }}/{{ pageCount }} 页</span><button type="button" :disabled="page <= 1" @click="page--">上一页</button><button type="button" :disabled="page >= pageCount" @click="page++">下一页</button></nav>
      </template>
    </template>
  </section>
</template>

<style scoped>
.unit-roster{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:18px;min-width:0;color:var(--text)}header,.entry-heading,.roster-summary,.pagination{display:flex;align-items:center;gap:12px;flex-wrap:wrap}header{justify-content:space-between}h3{display:flex;align-items:center;gap:8px;font-size:var(--font-lg);margin:0}header p,.comparison,.entry-meta,.message{font-size:var(--font-sm);line-height:1.6;color:var(--muted);margin:7px 0}.refresh{border:1px solid var(--line);border-radius:6px;background:var(--panel-sub);color:var(--primary);padding:7px;cursor:pointer}.roster-controls{display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin:16px 0}.roster-controls label{display:grid;gap:5px;font-size:var(--font-xs);color:var(--muted)}select,input{background:var(--panel-sub);border:1px solid var(--line);border-radius:6px;padding:8px;color:var(--text);font:inherit;font-size:var(--font-sm);max-width:100%}input{flex:1;min-width:160px}.roster-summary{font-size:var(--font-sm);padding:10px 0}.roster-list{list-style:none;padding:0;margin:12px 0}.roster-list li{padding:12px 0;border-top:1px solid var(--line-soft)}.entry-title{border:0;background:transparent;color:var(--text);font-size:var(--font-sm);font-weight:600;text-align:left;padding:0;cursor:pointer}.entry-title:hover{text-decoration:underline;color:var(--primary)}.state,.change,.conflict{font-size:var(--font-xs)}.state{padding:3px 8px;border-radius:4px;background:var(--primary-tint);color:var(--primary)}.state.stopped{background:var(--warning-tint);color:var(--warning)}.conflict{color:var(--warning)}.change{color:var(--primary)}.entry-meta{display:flex;gap:14px;flex-wrap:wrap;font-size:var(--font-xs)}details{font-size:var(--font-xs);line-height:1.6;color:var(--muted);margin-top:5px}summary{cursor:pointer}dl{margin:8px 0}dl>div{display:flex;gap:12px;margin:4px 0}dt{min-width:80px}dd{margin:0;overflow-wrap:anywhere}details p{margin:7px 0}.pagination{justify-content:flex-end;font-size:var(--font-xs)}.pagination button{border:1px solid var(--line);border-radius:5px;padding:6px 9px;background:var(--panel-sub);color:var(--text);cursor:pointer}button:disabled,select:disabled{opacity:.5;cursor:default}.error{color:var(--danger)}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--primary);outline-offset:3px}@media(max-width:650px){.unit-roster{padding:12px}.roster-controls label{flex:1}.roster-controls input{flex-basis:100%}.pagination{justify-content:space-between}.entry-heading{gap:8px}.entry-title{flex-basis:100%}}
.latest-roster{margin-left:10px;border:0;background:transparent;color:var(--primary);font:inherit;text-decoration:underline;cursor:pointer;padding:3px 0}
</style>
