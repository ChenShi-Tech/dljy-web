<script setup lang="ts">
// JSON 树节点（递归自引用）：对象/数组可折叠，标量按类型着色。
import { computed, ref } from 'vue'
import { ChevronRight, ChevronDown } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{ k?: string; value: unknown; depth: number }>(),
  {}
)
const open = ref(props.depth < 2) // 默认展开前两层
const isObj = computed(() => props.value !== null && typeof props.value === 'object')
const isArr = computed(() => Array.isArray(props.value))
const entries = computed<[string, unknown][]>(() => {
  if (!isObj.value) return []
  if (isArr.value) return (props.value as unknown[]).map((v, i) => [String(i), v])
  return Object.entries(props.value as Record<string, unknown>)
})
const preview = computed(() =>
  isArr.value ? `[${(props.value as unknown[]).length}]` : `{${entries.value.length}}`
)
function scalarClass(v: unknown): string {
  if (v === null) return 'null'
  const t = typeof v
  return t === 'number' ? 'num' : t === 'boolean' ? 'bool' : t === 'string' ? 'str' : 'other'
}
function scalarText(v: unknown): string {
  return typeof v === 'string' ? `"${v}"` : String(v)
}
</script>

<template>
  <div class="jn">
    <template v-if="isObj">
      <div class="jn-head" @click="open = !open">
        <component :is="open ? ChevronDown : ChevronRight" :size="11" class="jn-caret" />
        <span v-if="k !== undefined" class="jn-key">{{ k }}:</span>
        <span class="jn-preview">{{ preview }}</span>
      </div>
      <div v-if="open" class="jn-children">
        <JsonTreeNode v-for="[ck, cv] in entries" :key="ck" :k="ck" :value="cv" :depth="depth + 1" />
      </div>
    </template>
    <div v-else class="jn-leaf">
      <span v-if="k !== undefined" class="jn-key">{{ k }}:</span>
      <span :class="['jn-val', scalarClass(value)]">{{ scalarText(value) }}</span>
    </div>
  </div>
</template>

<style scoped>
.jn-children { padding-left: 14px; border-left: 1px dotted rgba(125, 125, 125, 0.3); margin-left: 4px; }
.jn-head { cursor: pointer; display: flex; align-items: center; gap: 2px; border-radius: 3px; }
.jn-head:hover { background: rgba(125, 125, 125, 0.08); }
.jn-caret { flex-shrink: 0; opacity: 0.55; }
.jn-key { color: #7c3aed; margin-right: 4px; }
.jn-leaf { padding-left: 13px; }
.jn-preview { opacity: 0.5; }
.jn-val.num { color: #2563eb; }
.jn-val.str { color: #16a34a; }
.jn-val.bool { color: #d97706; }
.jn-val.null { color: #9ca3af; }
</style>
