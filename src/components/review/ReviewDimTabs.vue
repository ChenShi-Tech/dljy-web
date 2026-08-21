<script setup lang="ts">
// 六维标签栏（#2038）：一行六个镜头，切换只换主体区。圆点 = 就绪度信号
// （live 绿 / gap 橙 / pending 灰），角标 = 该维待处理数（决策维待填单）。
import { TAB_ORDER, TAB_SHORT, type DimSignal, type ShellTab } from '@/services/review/reviewDashboard'

const props = withDefaults(
  defineProps<{
    active: ShellTab
    signals: Partial<Record<ShellTab, DimSignal>>
    badges?: Partial<Record<ShellTab, number>>
  }>(),
  { badges: () => ({}) }
)
const emit = defineEmits<{ (e: 'update:active', tab: ShellTab): void }>()

const SIGNAL_TITLE: Record<DimSignal, string> = { live: '本期有数', gap: '缺数据源', pending: '待上线' }

function select(dim: ShellTab) {
  if (dim !== props.active) emit('update:active', dim)
}
</script>

<template>
  <div class="dims" role="tablist" aria-label="复盘视角">
    <button
      v-for="dim in TAB_ORDER"
      :key="dim"
      type="button"
      role="tab"
      :aria-selected="dim === active"
      :data-dim="dim"
      @click="select(dim)"
    >
      <span class="dot" :class="signals[dim] ?? 'pending'" :title="SIGNAL_TITLE[signals[dim] ?? 'pending']" />
      {{ TAB_SHORT[dim] }}
      <span v-if="badges[dim]" class="badge">{{ badges[dim] }}</span>
    </button>
  </div>
</template>

<style scoped>
.dims { display: flex; gap: 2px; border-bottom: 1px solid var(--line); overflow-x: auto; }
.dims button {
  position: relative; flex: none; padding: 8px 14px 9px; border: 0; background: transparent;
  color: var(--muted); font: inherit; font-size: var(--font-13-5); cursor: pointer;
  display: inline-flex; align-items: center; gap: 7px; white-space: nowrap;
}
.dims button:hover { color: var(--text); }
.dims button:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; border-radius: 3px; }
.dims button[aria-selected='true'] { color: var(--text); font-weight: 600; }
.dims button[aria-selected='true']::after {
  content: ''; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 2px;
  background: var(--primary); border-radius: 2px 2px 0 0;
}
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--line); }
.dot.live { background: var(--success); }
.dot.gap { background: var(--warning); }
.dot.pending { background: transparent; box-shadow: inset 0 0 0 1px var(--muted); }
.badge {
  min-width: 17px; height: 17px; padding: 0 5px; border-radius: 999px;
  background: var(--danger); color: #fff; font-size: var(--font-tb-11); font-weight: 700;
  display: grid; place-items: center; line-height: 1;
}
</style>
