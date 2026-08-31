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
    // 六类原文分两路读取，不让大文件扫描占满本地服务。
    await Promise.all(Array.from({ length: Math.min(2, catalog.datasets.length) }, async () => {
      while (next < catalog.datasets.length && current === generation) {
        const spec = catalog.datasets[next++]!
        try {
          const data = await loadDisclosureRecordPage(region, date, spec.id, {}, options)
          if (current === generation) pages.value[spec.id] = data
        } catch (error) {
          if (current === generation) errors.value[spec.id] = error instanceof Error ? error.message : '原文读取失败'
        }
      }
    }))
  } catch (error) {
    if (current === generation) loadError.value = error instanceof Error ? error.message : '文本来源目录读取失败'
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
    if (current === pageGeneration && currentBoard === generation) errors.value[id] = error instanceof Error ? error.message : '原文读取失败'
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

function heading(row: Record<string, string>) {
  return ['设备名称', '名称', '电厂名称', '机组名称', '送电类别名称']
    .map((key) => row[key]).filter(Boolean).join(' · ') || '披露记录'
}
function fieldLabel(key: string) {
  return ({ operate_date: '记录日期', source_file: '原始文件', imported_at: '导入时间' } as Record<string, string>)[key] ?? key
}
function categoryState(id: string) {
  if (errors.value[id]) return '读取失败'
  const page = pages.value[id]
  if (!page) return loading.value || (selected.value === id && pageLoading.value) ? '读取中' : '待重试'
  if (page.dataAvailability.status === 'missing') return '源文件缺失'
  return `${Object.values(page.scopeCounts).reduce((sum, count) => sum + count, 0)} 条当日记录`
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
        <p>按顶部记录日期查看已导入原文；计划时间、实际时间与记录日期分别保留，不参与模型计算。</p>
      </div>
      <el-button :loading="loading" :disabled="regionId !== 'yunnan' || !date" @click="reload">刷新文本</el-button>
    </header>
    <p v-if="!date || regionId !== 'yunnan'" class="disclosure-texts__state">请选择云南地区和有效记录日期。</p>
    <el-alert v-else-if="loadError" :title="loadError" type="error" :closable="false" show-icon />
    <p v-else-if="loading && !datasets.length" class="disclosure-texts__state" role="status">正在读取文本来源目录…</p>
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
            <el-input v-model="keyword" aria-label="搜索当前类别原文" placeholder="搜索设备、机组或原因" :maxlength="100" clearable />
            <el-button native-type="submit" :disabled="loading || pageLoading">搜索</el-button>
          </form>
        </div>
        <el-alert v-if="errors[selected]" :title="errors[selected]" type="error" :closable="false" show-icon />
        <p v-else-if="!active || pageLoading" class="disclosure-texts__state" role="status">正在读取原始记录…</p>
        <template v-else>
          <div class="disclosure-texts__summary">
            <span>{{ date }} · {{ active.total }} 条{{ submittedKeyword ? '匹配记录' : '记录' }}</span>
            <span>当日范围{{ submittedKeyword ? '（未按关键词过滤）' : '' }}：{{ Object.entries(active.scopeCounts).map(([scope, count]) => `${scope} ${count} 条`).join('；') || '无符合范围的记录' }}</span>
          </div>
          <p v-if="active.dataAvailability.reason" class="disclosure-texts__note">{{ active.dataAvailability.reason }}</p>
          <p v-if="!active.items.length" class="disclosure-texts__state">
            {{ submittedKeyword ? '当前关键词没有匹配记录。' : '该日期没有可展示记录；不以其他省份或其他日期补齐。' }}
          </p>
          <ol v-else class="disclosure-texts__records" tabindex="0" aria-label="原始披露记录列表" :start="(active.page - 1) * active.pageSize + 1">
            <li v-for="(row, index) in active.items" :key="`${selected}-${active.page}-${index}`">
              <article>
                <div class="disclosure-texts__record-head">
                  <h4>{{ heading(row) }}</h4>
                  <span>{{ row['统计范围'] }}<template v-if="row['必开/必停']"> · {{ row['必开/必停'] }}</template></span>
                </div>
                <p v-if="row['干预原因'] || row['限值原因']" class="disclosure-texts__reason">{{ row['干预原因'] || row['限值原因'] }}</p>
                <p v-if="row['计划停电日期'] || row['计划复电时间']" class="disclosure-texts__note">计划停电：{{ row['计划停电日期'] || '未填写' }}；计划复电：{{ row['计划复电时间'] || '未填写' }}</p>
                <details>
                  <summary>查看原始字段与来源</summary>
                  <dl>
                    <template v-for="column in active.columns" :key="column">
                      <dt>{{ fieldLabel(column) }}</dt><dd>{{ row[column] || '未填写' }}</dd>
                    </template>
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
            <summary>数据范围与来源说明</summary>
            <p>源表：{{ active.source.sourceTable }}；原表共 {{ active.sourceRowCount }} 行。覆盖：{{ active.coverage.from || '无记录' }} 至 {{ active.coverage.to || '无记录' }}。</p>
            <p>当日已排除其他或未知地区 {{ active.excludedRegionCount }} 条。{{ active.source.license }}</p>
            <p>源文件：{{ active.source.sourceFiles.join('、') || '未提供' }}</p>
          </details>
        </template>
      </div>
    </div>
    <p v-else class="disclosure-texts__state">当前没有已接入的文本来源类别；未生成占位记录。</p>
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
.disclosure-texts dt, .disclosure-texts dd { margin: 0; padding: 6px 10px; border-bottom: 1px solid var(--line, #d9e2ec); overflow-wrap: anywhere; white-space: pre-wrap; line-height: 1.7; }
.disclosure-texts dt { color: var(--muted, #667085); }
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
