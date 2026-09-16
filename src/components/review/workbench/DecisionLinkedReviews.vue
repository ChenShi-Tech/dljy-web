<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { decisionLinkError, listDecisionReferences, type LinkedReview } from '@/services/review/workpapers'

const props = defineProps<{ company: string; region: string; declarationId: string }>()
const emit = defineEmits<{ publication: [value: LinkedReview] }>()

const open = ref(false), loading = ref(false), error = ref('')
const rows = ref<LinkedReview[]>([]), offset = ref(0), hasMore = ref(false)
let generation = 0

function reset() { ++generation; rows.value = []; hasMore.value = false; error.value = ''; loading.value = false }
async function load(page = 0) {
  reset(); offset.value = page
  if (!open.value || !props.declarationId) return
  const ticket = generation
  loading.value = true
  try {
    const result = await listDecisionReferences(props.company, props.region, props.declarationId, page)
    if (ticket !== generation) return
    rows.value = result.rows; hasMore.value = result.hasMore
  } catch (e) { if (ticket === generation) error.value = decisionLinkError(e) }
  finally { if (ticket === generation) loading.value = false }
}
function when(row: LinkedReview) { return new Date(row.kind === 'publication' ? row.createdAt : row.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) }
watch(() => [props.company, props.region, props.declarationId], () => { void load() }, { flush: 'sync' })
onBeforeUnmount(reset)
</script>

<template>
  <details class="linked-reviews" @toggle="event => { const next = (event.target as HTMLDetailsElement).open; if (open === next) return; open = next; next ? void load() : reset() }">
    <summary>查看引用了这笔申报的复盘</summary>
    <div v-if="open" class="content">
      <p>只列出当前公司和地区内明确关联了这笔申报的复盘底稿与已发布报告。从底稿移除关联后，此前已发布的版本仍然能查到。</p>
      <p v-if="loading" role="status">正在读取关联复盘…</p>
      <p v-else-if="error" role="alert" class="alert">{{ error }}</p>
      <template v-else>
        <p v-if="!rows.length">还没有复盘明确关联这笔申报。</p>
        <ul><li v-for="row in rows" :key="`${row.kind}:${row.id}`">
          <div>
            <b>{{ row.title }}</b>
            <p>{{ row.kind === 'publication' ? `已发布报告 · 第 ${row.revision} 版 · ${when(row)}` : `编辑中的底稿 · 第 ${row.revision} 版 · ${when(row)}` }}</p>
            <p>{{ row.scope?.objectLabel || '复盘对象待核实' }} · {{ row.scope?.startDate }}—{{ row.scope?.endDate }}</p>
          </div>
          <button v-if="row.kind === 'publication'" type="button" @click="emit('publication', row)">查看这一版</button>
        </li></ul>
        <div v-if="offset || hasMore" class="controls"><button type="button" :disabled="offset === 0" @click="load(Math.max(0, offset - 30))">上一批</button><span>第 {{ Math.floor(offset / 30) + 1 }} 批</span><button type="button" :disabled="!hasMore" @click="load(offset + 30)">下一批</button></div>
      </template>
    </div>
  </details>
</template>

<style scoped>
.linked-reviews{border-top:1px solid var(--line);padding-top:14px;margin-top:14px}
.content{display:grid;gap:12px;padding-top:12px}
summary,button{cursor:pointer}
p{font-size:var(--font-sm);color:var(--muted);line-height:1.7;margin:0}
.alert{color:var(--danger,#c0392b)}
.controls,li{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
ul{list-style:none;margin:0;padding:0}
li{padding:12px 0;border-bottom:1px solid var(--line)}
li>div{flex:1;min-width:200px}
li p{margin-top:6px;overflow-wrap:anywhere}
b{font-size:var(--font-sm)}
button{font:inherit;font-size:var(--font-sm);padding:8px 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text)}
button:disabled{opacity:.5;cursor:default}
button:focus-visible,summary:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
</style>
