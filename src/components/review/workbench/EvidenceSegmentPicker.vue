<script setup lang="ts">
import { computed, ref } from 'vue'
import { evidenceSegments, segmentLabel } from '@/services/review/reportPresentation'
import type { ReportEvidence, ReviewSegment } from '@/services/review/workpapers'

const props = defineProps<{ evidence: ReportEvidence }>()
const emit = defineEmits<{ pick: [value: ReviewSegment[]]; close: [] }>()
// 与服务端上限一致；只能从材料自身的时段里选，服务端保存时还会再核对一遍。
const LIMIT = 200
const segments = computed(() => evidenceSegments(props.evidence))
const key = (segment: ReviewSegment) => `${segment.start}|${segment.end}`
const chosen = ref<string[]>([])
const tooMany = computed(() => chosen.value.length > LIMIT)
function selectAll() { chosen.value = segments.value.slice(0, LIMIT).map(key) }
function confirm() {
  if (!chosen.value.length || tooMany.value) return
  const wanted = new Set(chosen.value)
  emit('pick', segments.value.filter(segment => wanted.has(key(segment))))
}
</script>

<template>
  <div class="segment-picker">
    <p>从这份材料里选出这条原因要解释的时段。只能选材料中已有的时段；原因默认是「待核实」，需要交易员自行判断后再改为已核实。</p>
    <p v-if="!segments.length">这份材料没有可对应的时段，请直接撰写原因。</p>
    <template v-else>
      <div class="actions"><button type="button" @click="selectAll">全选{{ segments.length > LIMIT ? `前 ${LIMIT} 个` : '' }}</button><button type="button" :disabled="!chosen.length" @click="chosen = []">清空</button><span>已选 {{ chosen.length }} / {{ segments.length }}</span></div>
      <div class="list"><label v-for="segment in segments" :key="key(segment)"><input v-model="chosen" type="checkbox" :value="key(segment)" />{{ segmentLabel(segment) }}</label></div>
      <p v-if="tooMany" role="alert">一条原因最多对应 {{ LIMIT }} 个时段，请拆成几条原因分别说明。</p>
    </template>
    <div class="actions"><button type="button" class="primary" :disabled="!chosen.length || tooMany" @click="confirm">为所选时段添加原因</button><button type="button" @click="emit('close')">取消</button></div>
  </div>
</template>

<style scoped>
.segment-picker{border:1px dashed var(--line);border-radius:8px;padding:12px;margin:10px 0;display:grid;gap:10px}
p{margin:0;font-size:var(--font-sm);color:var(--muted);line-height:1.7}
.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:var(--font-sm)}
.list{display:flex;flex-wrap:wrap;gap:6px 16px;max-height:220px;overflow:auto}
.list label{display:inline-flex;gap:6px;align-items:center;font-size:var(--font-sm)}
button{font:inherit;font-size:var(--font-sm);padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text);cursor:pointer}
button:disabled{opacity:.5;cursor:default}
button:focus-visible,input:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
</style>
