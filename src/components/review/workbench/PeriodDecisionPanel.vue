<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { declarationLabel } from '@/services/review/decisionWorkbench'
import { loadPeriodDecisions, type DecisionPeriod } from '@/services/review/periodDecisions'
import type { DeclarationMode, DeclarationOrder } from '@/services/declarations'
const props = defineProps<{ company: string; region: string; period: DecisionPeriod }>()
const emit = defineEmits<{ select: [value: DeclarationOrder] }>()
const expanded = ref(false), loading = ref(false), error = ref(''), mode = ref<'' | DeclarationMode>('')
const rows = ref<DeclarationOrder[]>([]), offset = ref(0), nextOffset = ref<number | null>(null), omitted = ref(0)
let generation = 0
function clear() { ++generation; rows.value = []; nextOffset.value = null; error.value = ''; omitted.value = 0; loading.value = false }
async function load(page = 0) {
  clear(); offset.value = page
  if (!expanded.value) return
  const ticket = generation; loading.value = true
  try {
    const result = await loadPeriodDecisions(props.company, props.region, { ...props.period }, page, mode.value || undefined)
    if (ticket !== generation) return
    rows.value = result.rows; nextOffset.value = result.nextOffset; omitted.value = result.omitted
  } catch { if (ticket === generation) error.value = '申报记录暂时无法读取，不能据此判断本周期没有决策。请重试。' }
  finally { if (ticket === generation) loading.value = false }
}
watch(() => [props.company, props.region, props.period.start, props.period.end, mode.value], () => { void load() }, { flush: 'sync' })
function toggle(event: Event) { const open = (event.target as HTMLDetailsElement).open; if (expanded.value === open) return; expanded.value = open; if (open) void load(); else clear() }
onBeforeUnmount(clear)
</script>
<template>
  <details class="period-decisions" @toggle="toggle">
    <summary>查看本周期申报 · {{ period.start }}—{{ period.end }}</summary>
    <div v-if="expanded" class="content">
      <p>查询当前公司、地区在完整统计周期内的申报。尚未按图中厂站、节点或异常时段关联；同期出现不代表偏差原因，需逐笔核实。</p>
      <div class="controls"><label>记录类型<select v-model="mode"><option value="">全部</option><option value="LIVE">业务申报</option><option value="REHEARSAL">模拟演练</option></select></label><button :disabled="loading" @click="load(offset)">刷新记录</button></div>
      <p v-if="loading" role="status">正在读取本周期申报…</p>
      <p v-else-if="error" role="alert">{{ error }}</p>
      <template v-else>
        <p v-if="!rows.length">这一批没有符合当前公司和地区的申报记录。{{ nextOffset !== null ? '仍有后续记录，可继续查看。' : '' }}</p>
        <p v-if="omitted">本批有 {{ omitted }} 条地区未明确或范围不符的记录，未用于本次回查。</p>
        <ul><li v-for="row in rows" :key="row.id"><div><b>{{ row.targetDate }} · {{ declarationLabel(row) }}</b><p>{{ row.quoteRationale || '未留存报价依据，需核实原始记录。' }}</p></div><button @click="emit('select', row)">复盘这笔申报</button></li></ul>
        <div v-if="offset || nextOffset !== null" class="controls"><button :disabled="offset === 0" @click="load(Math.max(0, offset - 20))">上一批</button><span>第 {{ Math.floor(offset / 20) + 1 }} 批</span><button :disabled="nextOffset === null" @click="nextOffset !== null && load(nextOffset)">下一批</button></div>
      </template>
    </div>
  </details>
</template>
<style scoped>
.period-decisions{border-top:1px solid var(--line);padding-top:14px}.content{display:grid;gap:12px;padding-top:12px}summary,button{cursor:pointer}p{font-size:var(--font-sm);color:var(--muted);line-height:1.7;margin:0}.controls,li,label{display:flex;align-items:center;gap:12px;flex-wrap:wrap}ul{list-style:none;margin:0;padding:0}li{padding:12px 0;border-bottom:1px solid var(--line)}li>div{flex:1;min-width:200px}li p{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:6px}b{font-size:var(--font-sm)}button,select{font:inherit;font-size:var(--font-sm);padding:8px 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text)}button:disabled{opacity:.5;cursor:default}button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
</style>
