<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import {
  loadDisclosureRecordCatalog, loadDisclosureRecordPage,
  type DisclosureRecordDataset, type DisclosureRecordPage,
} from '@/services/forecast/dailyDisclosureRecords'

const props = defineProps<{ regionId: string; date: string; reloadKey?: number }>()
const datasets = ref<DisclosureRecordDataset[]>([])
const pages = ref<Record<string, DisclosureRecordPage>>({})
const errors = ref<Record<string, string>>({})
const limitations = ref<string[]>([])
const selected = ref('')
const keyword = ref('')
const submittedKeyword = ref('')
const loading = ref(false)
const pageLoading = ref(false)
const loadError = ref('')
let generation = 0
let pageGeneration = 0
let controller: AbortController | undefined
let pageController: AbortController | undefined
const active = computed(() => pages.value[selected.value])
const activeSpec = computed(() => datasets.value.find((item) => item.id === selected.value))
const totalPages = computed(() => Math.max(1, Math.ceil((active.value?.total ?? 0) / (active.value?.pageSize ?? 20))))

function clear() {
  generation += 1
  pageGeneration += 1
  controller?.abort()
  pageController?.abort()
  datasets.value = []
  pages.value = {}
  errors.value = {}
  limitations.value = []
  selected.value = ''
  keyword.value = ''
  submittedKeyword.value = ''
  loading.value = false
  pageLoading.value = false
  loadError.value = ''
}

async function reload() {
  clear()
  if (props.regionId !== 'yunnan' || !props.date) return
  const current = generation
  const region = props.regionId
  const date = props.date
  controller = new AbortController()
  const options = { signal: controller.signal, timeoutMs: 60_000 }
  loading.value = true
  try {
    const catalog = await loadDisclosureRecordCatalog(region, options)
    if (current !== generation) return
    datasets.value = catalog.datasets
    limitations.value = catalog.limitations ?? []
    selected.value = catalog.datasets[0]?.id ?? ''
    let next = 0
    // 五类数据库事件分两路读取，避免一次性占满本地服务连接。
    await Promise.all(Array.from({ length: Math.min(2, catalog.datasets.length) }, async () => {
      while (next < catalog.datasets.length && current === generation) {
        const spec = catalog.datasets[next++]!
        try {
          const data = await loadDisclosureRecordPage(region, date, spec.id, {}, options)
          if (current === generation) pages.value[spec.id] = data
        } catch (error) {
          if (current === generation) errors.value[spec.id] = error instanceof Error ? error.message : '事件读取失败'
        }
      }
    }))
  } catch (error) {
    if (current === generation) loadError.value = error instanceof Error ? error.message : '披露事件类别读取失败'
  } finally {
    if (current === generation) loading.value = false
  }
}

async function queryPage(page = 1) {
  if (!selected.value || loading.value) return
  const current = ++pageGeneration
  const currentBoard = generation
  const id = selected.value
  pageController?.abort()
  pageController = new AbortController()
  pageLoading.value = true
  delete errors.value[id]
  // 请求失败也不能把上一页贴到新搜索条件下。
  delete pages.value[id]
  try {
    const data = await loadDisclosureRecordPage(props.regionId, props.date, id, { page, keyword: submittedKeyword.value }, { signal: pageController.signal, timeoutMs: 60_000 })
    if (current === pageGeneration && currentBoard === generation) pages.value[id] = data
  } catch (error) {
    if (current === pageGeneration && currentBoard === generation) errors.value[id] = error instanceof Error ? error.message : '事件读取失败'
  } finally {
    if (current === pageGeneration && currentBoard === generation) pageLoading.value = false
  }
}

function selectDataset(id: string) {
  pageGeneration += 1
  pageController?.abort()
  pageLoading.value = false
  selected.value = id
  keyword.value = ''
  submittedKeyword.value = ''
  if (!loading.value) void queryPage()
}

function search() {
  submittedKeyword.value = keyword.value.trim()
  void queryPage()
}

function dateTime(value: string | null) {
  if (!value) return '未提供'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(parsed)
}
function categoryLabel(id: string) {
  return datasets.value.find((item) => item.id === id)?.title ?? id
}
function spatialKindLabel(kind: string) {
  return ({ region: '地区', grid: '电网', section: '断面' } as Record<string, string>)[kind] ?? kind
}
function categoryState(id: string) {
  if (errors.value[id]) return '读取失败'
  const page = pages.value[id]
  if (!page) return loading.value || (selected.value === id && pageLoading.value) ? '读取中' : '待重试'
  if (page.dataAvailability.status === 'missing') return '当日无事件'
  return `${page.total} 条当日事件`
}

watch(() => [props.regionId, props.date, selectedCompanyId.value, props.reloadKey], () => {
  clear()
  const scheduled = generation
  // 立即隐藏旧结果；等同一轮地区/日期/公司更新完成再请求，避免混合上下文。
  void nextTick().then(() => { if (scheduled === generation) void reload() })
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(clear)
</script>

<template>
  <section class="disclosure-texts" aria-labelledby="disclosure-texts-title">
    <header class="disclosure-texts__header">
      <div>
        <h3 id="disclosure-texts-title">检修与运行记录</h3>
        <p>按顶部日期查看 PostgreSQL 中已导入的规范化披露事件；这些事件仅供总览查阅，不参与模型计算。</p>
      </div>
      <el-button :loading="loading" :disabled="regionId !== 'yunnan' || !date" @click="reload">刷新事件</el-button>
    </header>
    <p v-if="!date || regionId !== 'yunnan'" class="disclosure-texts__state">请选择云南地区和有效记录日期。</p>
    <el-alert v-else-if="loadError" :title="loadError" type="error" :closable="false" show-icon />
    <p v-else-if="loading && !datasets.length" class="disclosure-texts__state" role="status">正在读取披露事件类别…</p>
    <div v-else-if="datasets.length" class="disclosure-texts__layout">
      <nav class="disclosure-texts__nav" aria-label="文本记录类别">
        <button
          v-for="item in datasets" :key="item.id" type="button"
          :class="{ 'is-selected': selected === item.id }" :aria-pressed="selected === item.id"
          @click="selectDataset(item.id)"
        >
          <span>{{ item.title }}</span><small>{{ categoryState(item.id) }}</small>
        </button>
      </nav>
      <div class="disclosure-texts__content" :aria-busy="loading || pageLoading">
        <div class="disclosure-texts__tools">
          <p>{{ activeSpec?.description }}</p>
          <form class="disclosure-texts__search" @submit.prevent="search">
            <el-input v-model="keyword" aria-label="搜索当前类别事件" placeholder="搜索标题、摘要或空间范围" :maxlength="100" clearable />
            <el-button native-type="submit" :disabled="loading || pageLoading">搜索</el-button>
          </form>
        </div>
        <el-alert v-if="errors[selected]" :title="errors[selected]" type="error" :closable="false" show-icon />
        <p v-else-if="!active || pageLoading" class="disclosure-texts__state" role="status">正在读取规范化事件…</p>
        <template v-else>
          <div class="disclosure-texts__summary">
            <span>{{ date }} · {{ active.total }} 条{{ submittedKeyword ? '匹配事件' : '事件' }}</span>
            <span>来源：PostgreSQL · grid.disclosure_events · 不跨地区、不跨日期回退</span>
          </div>
          <p v-if="active.dataAvailability.reason" class="disclosure-texts__note">{{ active.dataAvailability.reason }}</p>
          <p v-if="!active.items.length" class="disclosure-texts__state">
            {{ submittedKeyword ? '当前关键词没有匹配事件。' : '该日期没有可展示事件；不以其他省份或其他日期补齐。' }}
          </p>
          <ol v-else class="disclosure-texts__records" tabindex="0" aria-label="规范化披露事件列表" :start="(active.page - 1) * active.pageSize + 1">
            <li v-for="event in active.items" :key="event.eventId">
              <article>
                <div class="disclosure-texts__record-head">
                  <h4>{{ event.title }}</h4>
                  <span>{{ categoryLabel(event.category) }} · {{ event.regionId === 'csg' ? '南网全网' : '云南' }}</span>
                </div>
                <p class="disclosure-texts__reason">{{ event.summary || '该规范化事件未提供摘要。' }}</p>
                <dl class="disclosure-texts__event-meta">
                  <div><dt>类别</dt><dd>{{ categoryLabel(event.category) }}（{{ event.category }}）</dd></div>
                  <div><dt>空间范围</dt><dd>{{ event.spatialBinding.label }} · {{ spatialKindLabel(event.spatialBinding.kind) }}<template v-if="event.spatialBinding.ref"> · {{ event.spatialBinding.ref }}</template></dd></div>
                  <div><dt>生效时间</dt><dd>{{ dateTime(event.effectiveAt) }}</dd></div>
                  <div><dt>失效时间</dt><dd>{{ dateTime(event.expiresAt) }}</dd></div>
                  <div><dt>披露时间</dt><dd>{{ dateTime(event.publishedAt) }}</dd></div>
                  <div><dt>源表</dt><dd>{{ event.source.sourceTable }}</dd></div>
                  <div><dt>源文件</dt><dd>{{ event.source.file }}</dd></div>
                  <div><dt>源记录 ID</dt><dd>{{ event.source.recordId }}</dd></div>
                </dl>
                <details>
                  <summary>查看事件与导入溯源</summary>
                  <dl>
                    <div><dt>事件 ID</dt><dd>{{ event.eventId }}</dd></div>
                    <div><dt>Provider</dt><dd>{{ event.providerId }}</dd></div>
                    <div><dt>导入时间</dt><dd>{{ dateTime(event.importedAt) }}</dd></div>
                    <div><dt>可信级别</dt><dd>{{ event.confidence }}</dd></div>
                    <div><dt>来源类型</dt><dd>{{ event.source.sourceType }} / DB</dd></div>
                    <div><dt>来源许可</dt><dd>{{ event.source.license || '未提供' }}</dd></div>
                    <div><dt>原始链接</dt><dd>{{ event.source.url || event.source.originalLinkStatus || '未提供' }}</dd></div>
                  </dl>
                </details>
              </article>
            </li>
          </ol>
          <footer class="disclosure-texts__footer">
            <span>第 {{ active.page }} / {{ totalPages }} 页</span>
            <div>
              <el-button :disabled="loading || pageLoading || active.page <= 1" @click="queryPage(active.page - 1)">上一页</el-button>
              <el-button :disabled="loading || pageLoading || active.page >= totalPages" @click="queryPage(active.page + 1)">下一页</el-button>
            </div>
          </footer>
          <details class="disclosure-texts__source">
            <summary>数据口径说明</summary>
            <p>{{ active.dataAvailability.reason }}</p>
            <p>本区只展示 grid.disclosure_events 的规范化字段及逐事件溯源；不伪装成原始表全字段，也不会直接读取本地 CSV。</p>
          </details>
        </template>
      </div>
    </div>
    <p v-else class="disclosure-texts__state">当前没有后端返回的披露事件类别；未生成占位记录。</p>
    <p v-for="note in limitations" :key="note" class="disclosure-texts__limitation">{{ note }}</p>
  </section>
</template>

<style scoped>
.disclosure-texts { min-width: 0; padding: 18px 20px; background: var(--panel, #fff); border: 1px solid var(--line, #d9e2ec); border-radius: 6px; }
.disclosure-texts__header, .disclosure-texts__record-head, .disclosure-texts__footer, .disclosure-texts__summary { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.disclosure-texts h3 { margin: 0; font-size: var(--font-lg); color: var(--text, #1f2a37); }
.disclosure-texts h4 { margin: 0; font-size: var(--font-md); font-weight: 600; overflow-wrap: anywhere; }
.disclosure-texts p { line-height: 1.7; }
.disclosure-texts__header p, .disclosure-texts__tools p, .disclosure-texts__note, .disclosure-texts__source, .disclosure-texts__limitation { color: var(--muted, #667085); font-size: var(--font-sm); }
.disclosure-texts__layout { display: grid; grid-template-columns: 225px minmax(0, 1fr); gap: 24px; margin-top: 16px; }
.disclosure-texts__nav { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
.disclosure-texts__nav button { text-align: left; display: flex; flex-direction: column; gap: 4px; min-height: 66px; padding: 12px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--text, #1f2a37); font: inherit; font-size: var(--font-sm); cursor: pointer; }
.disclosure-texts__nav button span { white-space: nowrap; }
.disclosure-texts__nav small { font-size: var(--font-xs); color: var(--muted, #667085); }
.disclosure-texts__nav button.is-selected { border-color: var(--primary, #0f9d8a); color: var(--primary, #0f9d8a); background: var(--primary-soft, #edf8f5); }
.disclosure-texts__nav button:hover { border-color: var(--line, #d9e2ec); }
.disclosure-texts__nav button:focus-visible, .disclosure-texts summary:focus-visible { outline: 2px solid var(--primary, #0f9d8a); outline-offset: 2px; }
.disclosure-texts__content { min-width: 0; }
.disclosure-texts__tools { display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.disclosure-texts__tools p { flex: 1 1 180px; margin: 0; }
.disclosure-texts__search { display: flex; gap: 8px; flex: 0 1 330px; min-width: 0; }
.disclosure-texts__summary { flex-wrap: wrap; color: var(--muted, #667085); font-size: var(--font-sm); }
.disclosure-texts__records { list-style: none; margin: 10px 0; padding: 0 8px 0 0; max-height: 34rem; overflow-y: auto; }
.disclosure-texts__records li { padding: 16px 0; border-bottom: 1px solid var(--line, #d9e2ec); }
.disclosure-texts__record-head { flex-wrap: wrap; }
.disclosure-texts__record-head span { font-size: var(--font-sm); color: var(--muted, #667085); }
.disclosure-texts__reason { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--font-md); }
.disclosure-texts summary { display: list-item; width: fit-content; cursor: pointer; color: var(--primary, #0f9d8a); font-size: var(--font-sm); line-height: 1.8; }
.disclosure-texts dl { display: grid; grid-template-columns: 140px minmax(0, 1fr); font-size: var(--font-sm); margin: 12px 0 0; }
.disclosure-texts dl > div { display: contents; }
.disclosure-texts dt, .disclosure-texts dd { margin: 0; padding: 6px 10px; border-bottom: 1px solid var(--line, #d9e2ec); overflow-wrap: anywhere; white-space: pre-wrap; line-height: 1.7; }
.disclosure-texts dt { color: var(--muted, #667085); }
.disclosure-texts__event-meta { margin-top: 10px; padding: 4px 10px; border-radius: 6px; background: var(--surface-soft, #f7f9fb); }
.disclosure-texts__footer { margin: 16px 0; flex-wrap: wrap; font-size: var(--font-sm); }
.disclosure-texts__source p { overflow-wrap: anywhere; }
.disclosure-texts__state { color: var(--muted, #667085); padding: 20px 0; font-size: var(--font-md); }
.disclosure-texts__limitation { margin-bottom: 0; }
@container (max-width: 52rem) {
  .disclosure-texts__layout { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .disclosure-texts__nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .disclosure-texts__header { flex-wrap: wrap; }
  .disclosure-texts dl { grid-template-columns: minmax(90px, 30%) minmax(0, 1fr); }
}
@container (max-width: 30rem) {
  .disclosure-texts__nav { grid-template-columns: minmax(0, 1fr); }
}
</style>
