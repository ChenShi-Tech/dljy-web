<script setup lang="ts">
// 单维模板清单（Epic #2033 · #2038 外壳）：各维视图底部列出该维模板与就绪度，点开填报器。
// 就绪度读注册表声明值（数据可得性台账），缺口说明进 title 悬浮——页面不落说明段落。
import type { TemplateCard } from '@/services/review/cockpitModel'

defineProps<{ templates: TemplateCard[]; label?: string }>()
const emit = defineEmits<{ (e: 'open-template', template: TemplateCard): void }>()

const READINESS_LABEL: Record<TemplateCard['readiness'], string> = {
  ready: '就绪',
  data_gap: '缺数据',
  deferred: '后置'
}
</script>

<template>
  <section class="panel tpl" data-testid="template-chips">
    <header>{{ label ?? '本维模板' }} <b class="cnt">{{ templates.length }}</b></header>
    <p v-if="!templates.length" class="empty">该维暂无登记模板。</p>
    <div v-else class="chips">
      <button
        v-for="t in templates"
        :key="t.id"
        type="button"
        class="chip"
        :class="t.readiness"
        :title="`${t.id} ${t.name}${t.gapNote ? ` · ${t.gapNote}` : ''}${t.notes ? ` · ${t.notes}` : ''}`"
        @click="emit('open-template', t)"
      >
        <b>{{ t.id }}</b> {{ t.name }}<i v-if="t.slots24" class="h24">24h</i>
        <i class="rd">{{ READINESS_LABEL[t.readiness] }}</i>
      </button>
    </div>
  </section>
</template>

<style scoped>
.tpl { padding: 0; }
.tpl > header {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  border-bottom: 1px solid var(--line-soft); font-size: var(--font-md); font-weight: 600;
}
.cnt { color: var(--muted); font-weight: 500; font-variant-numeric: tabular-nums; }
.empty { margin: 0; padding: 14px; font-size: var(--font-12-5); color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 14px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
  padding: 5px 10px; border: 1px solid var(--line); border-radius: 999px;
  background: var(--panel); color: var(--text-body); font: inherit; font-size: var(--font-12-5);
  cursor: pointer; text-align: left;
}
.chip:hover { border-color: var(--primary); color: var(--primary); }
.chip b { font-family: ui-monospace, monospace; font-size: var(--font-xs); color: var(--muted); font-weight: 600; }
.chip:hover b { color: var(--primary); }
.chip .rd {
  position: relative; font-style: normal; font-size: var(--font-xs); font-weight: 600;
  padding: 0 6px; height: 17px; display: inline-flex; align-items: center; border-radius: 999px; isolation: isolate;
}
.chip .rd::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: currentColor; opacity: 0.12; z-index: -1; }
.chip.ready .rd { color: var(--success); }
.chip.data_gap .rd { color: var(--warning); }
.chip.deferred .rd { color: var(--muted); font-weight: 500; }
.h24 { font-style: normal; font-size: var(--font-xs); color: var(--muted); border: 1px solid var(--line); border-radius: 3px; padding: 0 4px; }
</style>
