<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { getReportPublication, listReportPublications, type Publication } from '@/services/review/workpapers'
import PublishedReportReader from './PublishedReportReader.vue'
const props = defineProps<{ company: string; region: string }>()
const emit = defineEmits<{ legacy: [] }>()
type Entry = Awaited<ReturnType<typeof listReportPublications>>['rows'][number]
const rows = ref<Entry[]>([]), more = ref(false), loading = ref(false), reading = ref(false), error = ref('')
const publication = ref<Publication | null>(null)
let generation = 0, readGeneration = 0
async function load(append = false) {
  if (loading.value || !props.company || !props.region) return
  const ticket = generation, company = props.company, region = props.region
  loading.value = true; error.value = ''
  try {
    const result = await listReportPublications(company, region, undefined, append ? rows.value.length : 0)
    if (ticket !== generation) return
    rows.value = append ? [...rows.value, ...result.rows] : result.rows
    more.value = result.hasMore
  } catch { if (ticket === generation) error.value = '报告目录暂时无法读取，请重试。' }
  finally { if (ticket === generation) loading.value = false }
}
async function open(item: Entry) {
  const ticket = ++readGeneration, scope = generation
  publication.value = null; reading.value = true; error.value = ''
  try {
    const result = await getReportPublication(props.company, props.region, item.id)
    if (ticket === readGeneration && scope === generation) publication.value = result
  } catch { if (ticket === readGeneration && scope === generation) error.value = '这份报告暂时无法读取，请确认访问范围后重试。' }
  finally { if (ticket === readGeneration && scope === generation) reading.value = false }
}
function close() { ++readGeneration; publication.value = null; reading.value = false }
watch(() => [props.company, props.region], () => { ++generation; close(); rows.value = []; more.value = false; loading.value = false; error.value = ''; void load() }, { immediate: true })
onBeforeUnmount(() => { ++generation; ++readGeneration })
const when = (date: string) => new Date(date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
</script>
<template>
  <section class="report-archive" aria-label="复盘报告目录">
    <header><p>当前公司与地区的已发布报告。正文与图表保留发布时的版本，可阅读并导出。</p><button @click="emit('legacy')">查看旧报告与历史分析</button></header>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="publication || reading"><button @click="close">返回报告目录</button><p v-if="reading" role="status">正在读取报告…</p><PublishedReportReader v-if="publication" :key="publication.id" :publication="publication" /></template>
    <template v-else>
      <div class="tools"><span>按发布时间倒序 · 已加载 {{ rows.length }} 份</span><button :disabled="loading" @click="load()">刷新目录</button></div>
      <p v-if="!props.company">请先选择公司。</p><p v-else-if="loading" role="status">正在读取目录…</p><p v-else-if="!rows.length && !error">尚无已发布报告，可在复盘底稿中完成撰写后发布。</p>
      <ol><li v-for="item in rows" :key="item.id"><div><b>{{ item.title }}</b><small>第 {{ item.revision }} 版 · {{ when(item.createdAt) }}</small></div><button :aria-label="`阅读 ${item.title} 第 ${item.revision} 版`" @click="open(item)">阅读与导出</button></li></ol>
      <button v-if="more" :disabled="loading" @click="load(true)">加载更多报告</button>
    </template>
  </section>
</template>
<style scoped>
.report-archive{display:grid;gap:16px;min-width:0}header,.tools,li{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}p{margin:0;line-height:1.7;color:var(--muted)}ol{padding:0;margin:0;list-style:none}li{padding:14px 0;border-bottom:1px solid var(--line)}li>div{min-width:0;flex:1}b{overflow-wrap:anywhere}small{display:block;margin-top:6px;color:var(--muted)}button{font:inherit;font-size:var(--font-sm);padding:8px 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--primary);cursor:pointer}button:disabled{opacity:.5}button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
</style>
