<script setup lang="ts">
// 通用归一化数据浏览器：选 family（含未来 yn 系列）→ 经 /api/real 拉真实回放数据 →
// 用 DynamicTable 动态列展示。保证"这类按月数据"零 bespoke 即可浏览，并显示地区命中/回退。
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Search } from 'lucide-vue-next'
import { CAPTURE_FAMILIES, CAPTURE_FAMILY_CODES } from 'shared/schema/entities/capture-families.mjs'
import DynamicTable from '../components/common/DynamicTable.vue'
import AgentChatPanel from '../components/agent/AgentChatPanel.vue'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import { fetchCaptured } from '@/services/captured'
import { onRegionChange } from '../composables/useRegionReload'
import { buildColumnLabelsFromRows } from '@/data/captureColumnLabels'

type FamilyOption = { code: string; label: string }
const route = useRoute()

const familyOptions = computed<FamilyOption[]>(() =>
  CAPTURE_FAMILY_CODES.map((code: string) => ({
    code,
    label: `${(CAPTURE_FAMILIES as Record<string, { label?: string }>)[code]?.label ?? ''} (${code})`
  }))
)

const family = ref<string>(queryFamily() || CAPTURE_FAMILY_CODES[0] || '')
const match = ref<string>(queryString('match'))
const loading = ref(false)
const error = ref('')
const rows = ref<Array<Record<string, unknown>>>([])
const loadedFamily = ref('')
const loadedMatch = ref('')
// 请求序号：快速切换数据族时用于丢弃晚到的过期响应，保证 rows 与 loadedFamily/loadedMatch 同源。
let requestSeq = 0

// 列名 → 中文含义映射：把 jz/hj/drrq/p1..p96 等拼音缩写与编号列翻成可读表头，
// 交给 DynamicTable 渲染表头与 CSV 表头。时段点数取族声明的 cadence（据 loadedFamily/loadedMatch），
// 稀疏行也不误判 96/24 点；非时序列走固定语义表。
const columnLabels = computed(() =>
  buildColumnLabelsFromRows(rows.value, loadedFamily.value, loadedMatch.value)
)

// 把任意回放载荷规整为行数组：数组直用；{rows|data|list} 取数组；纯对象包成单行。
function toRows(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    for (const key of ['rows', 'data', 'list', 'items']) {
      if (Array.isArray(obj[key])) return obj[key] as Array<Record<string, unknown>>
    }
    return [obj]
  }
  return []
}

async function load() {
  if (!family.value) return
  // 在 await 前捕获本次请求参数与序号：cadence 等元数据须与返回的 rows 同源，
  // 且并发切换时晚到的过期响应应被丢弃，避免用当前族的 cadence 标注旧族数据。
  const reqFamily = family.value
  const reqMatch = match.value.trim()
  const seq = ++requestSeq
  loading.value = true
  error.value = ''
  try {
    const body = await fetchCaptured<unknown>(reqFamily, reqMatch || undefined)
    if (seq !== requestSeq) return // 已有更新的请求发出，丢弃本次过期响应
    rows.value = toRows(body)
    loadedFamily.value = reqFamily
    loadedMatch.value = reqMatch
  } catch (err) {
    if (seq !== requestSeq) return
    rows.value = []
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

// B3 选中即问：点击行 → 注入 contextPayload 到 AgentChatPanel（走 untrusted_external_content 语义）
const selectedRow = ref<Record<string, unknown> | null>(null)
const askOpen = ref(false)
const contextPayload = computed(() =>
  selectedRow.value
    ? {
        source: 'data-browser',
        family: loadedFamily.value,
        route: '/yygl/data-browser',
        selectedRow: selectedRow.value,
      }
    : null
)
function onSelectRow(row: Record<string, unknown>) {
  selectedRow.value = row
}

onMounted(load)
onRegionChange(load) // 切换地区自动重拉，配合 RegionDataBanner 显示基线回退
watch(
  () => [route.query.family, route.query.match],
  () => {
    const nextFamily = queryFamily() || CAPTURE_FAMILY_CODES[0] || ''
    const nextMatch = queryString('match')
    if (family.value === nextFamily && match.value === nextMatch) return
    family.value = nextFamily
    match.value = nextMatch
    void load()
  }
)

function queryString(key: string) {
  const value = route.query[key]
  return typeof value === 'string' ? value : ''
}

function queryFamily() {
  const value = queryString('family')
  return CAPTURE_FAMILY_CODES.includes(value) ? value : ''
}
</script>

<template>
  <div class="data-browser">
    <header class="data-browser__head">
      <div>
        <h2>通用数据浏览器</h2>
        <p class="data-browser__sub">
          任意已注册数据族（family）的归一化真实回放数据，动态列展示 + 关键词筛选 + CSV 导出。
          数据源经 <code>/api/real</code>，随当前地区回放并标记基线回退。
        </p>
      </div>
    </header>

    <RegionDataBanner />

    <div class="data-browser__controls">
      <el-select
        v-model="family"
        filterable
        placeholder="选择数据族"
        class="family-select"
        @change="load"
      >
        <el-option v-for="opt in familyOptions" :key="opt.code" :label="opt.label" :value="opt.code" />
      </el-select>
      <el-input
        v-model="match"
        placeholder="match（文件名子串，可选）"
        clearable
        style="max-width: 240px"
        @keyup.enter="load"
      />
      <el-button type="primary" :icon="Search" :loading="loading" @click="load">查询</el-button>
    </div>

    <el-alert
      v-if="error"
      :title="`加载失败：${error}`"
      type="warning"
      :closable="false"
      show-icon
      style="margin-bottom: 12px"
    />

    <div v-loading="loading">
      <p class="data-browser__meta">
        当前数据族：<strong>{{ loadedFamily || '—' }}</strong>
      </p>
      <DynamicTable
        :rows="rows"
        :labels="columnLabels"
        :export-name="loadedFamily || 'captured'"
        @row-click="onSelectRow"
      />
      <!-- B3 选中即问：点击表格任意行 → 把选中行作为上下文注入 AgentChatPanel -->
      <div v-if="selectedRow" class="data-browser__ask">
        <span class="data-browser__ask-tag">📌 已选中一行（{{ Object.keys(selectedRow).length }} 列）</span>
        <el-button size="small" type="primary" @click="askOpen = !askOpen">
          {{ askOpen ? '收起问 AI' : '问 AI 此行' }}
        </el-button>
        <AgentChatPanel
          v-if="askOpen"
          history-key="captured_browser"
          :context-payload="contextPayload"
          initial-question="请基于我选中的这行数据，结合当前数据族与业务背景，给出解读、异常提示或下一步分析建议。"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.data-browser {
  padding: 16px 20px;
}
.data-browser__head h2 {
  margin: 0 0 4px;
}
.data-browser__sub {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.data-browser__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin: 12px 0;
}
.data-browser__meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin: 0 0 8px;
}
.family-select {
  min-width: 360px;
}
@media (max-width: 768px) {
  .family-select {
    min-width: 0;
    width: 100%;
  }
}
</style>
