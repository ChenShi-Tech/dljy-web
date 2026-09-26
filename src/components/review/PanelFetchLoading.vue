<script setup lang="ts">
// 逐日区间取数面板的统一等待态（偏差周月聚合 / 收益三层拆解 / 月度市场归因共用）：
// spinner + 进度文案 + 真实进度条（done/total 按批驱动，首批回报前 indeterminate 慢滑）
// + 表格骨架屏（表头/数据/合计行）。配色全部走主题 token（--primary / --line-* /
// --panel-sub 等，随五档主题联动），动效节奏刻意偏慢（安静不催促），
// prefers-reduced-motion 下全部停用。
// 刻意不含图表占位：三个面板中只有偏差聚合有 ECharts 图，图表相关占位不进公共组件。
defineProps<{
  /** 等待文案（含周期、已取 N 天等进度语义，由调用方拼好传入） */
  text: string
  /** 区间取数进度；缺省/null = 尚无分批回报，进度条走 indeterminate */
  progress?: { done: number; total: number } | null
}>()
</script>

<template>
  <div class="pfl" role="status">
    <!-- 整个等待态装进一张卡片（白底+细边+浅阴影），与加载完成后的内容卡片观感一致 -->
    <div class="pfl-card">
      <div class="pfl-line">
        <span class="pfl-spinner" aria-hidden="true" />
        <span>{{ text }}</span>
      </div>
      <div class="pfl-progress" :class="{ indeterminate: !progress }" aria-hidden="true">
        <div
          class="pfl-progress-bar"
          :style="progress ? { width: Math.min(100, Math.round((progress.done / progress.total) * 100)) + '%' } : undefined"
        />
      </div>
      <div class="pfl-skeleton" aria-hidden="true">
        <div class="pfl-sk-row pfl-sk-head">
          <span class="pfl-sk pfl-sk-cell pfl-sk-date" /><span v-for="j in 4" :key="j" class="pfl-sk pfl-sk-cell" />
        </div>
        <div v-for="i in 6" :key="i" class="pfl-sk-row">
          <span class="pfl-sk pfl-sk-cell pfl-sk-date" /><span v-for="j in 4" :key="j" class="pfl-sk pfl-sk-cell" />
        </div>
        <div class="pfl-sk-row pfl-sk-total">
          <span class="pfl-sk pfl-sk-cell pfl-sk-date" /><span v-for="j in 4" :key="j" class="pfl-sk pfl-sk-cell" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pfl { display: flex; flex-direction: column; }
/* 等待态卡片：白底 + 细边 + 浅阴影 + 主题化圆角，与面板内容卡片同一套调性 */
.pfl-card {
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--line, #d9e2ec);
  border-radius: var(--radius, 6px);
  background: var(--panel, #fff);
  box-shadow: var(--shadow, 0 1px 2px rgba(15, 23, 42, 0.04));
  animation: pfl-fade-in 0.25s ease;
}
@keyframes pfl-fade-in { from { opacity: 0.35; } to { opacity: 1; } }
.pfl-line { display: flex; align-items: center; gap: 8px; color: var(--muted, #667085); }
.pfl-spinner {
  flex: none; width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--line-soft, #e6edf3);
  border-top-color: var(--primary, #0f766e);
  animation: pfl-spin 0.9s linear infinite;
}
@keyframes pfl-spin { to { transform: rotate(360deg); } }
.pfl-progress {
  height: 6px; border-radius: 999px; overflow: hidden;
  background: var(--line-faint, #f0f2f5);
  box-shadow: inset 0 1px 1px rgba(15, 23, 42, 0.04);
}
.pfl-progress-bar {
  height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, var(--primary-strong, #0b5f59), var(--primary, #0f766e));
  transition: width 1s ease; /* 逐批推进缓慢爬升，与整批取数节奏（约 1-2s/批）匹配 */
}
/* 首批数据回来之前没有 done/total 可用：短条往复滑动表达「进行中」（慢速，不催促） */
.pfl-progress.indeterminate .pfl-progress-bar { width: 35%; animation: pfl-slide 4.2s ease-in-out infinite; }
@keyframes pfl-slide { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
.pfl-skeleton { display: flex; flex-direction: column; gap: 6px; }
/* 骨架基底用 --surface-hover（主题契约保证与 --panel 底有区分度），扫光用 muted 半透明
   叠加（color-mix 随主题联动）——避免骨架色与背景相似时整个加载态看起来是一大片空白 */
.pfl-sk {
  border-radius: var(--radius, 6px);
  background-color: var(--surface-hover, #f1f5f6);
  background-image: linear-gradient(90deg, transparent 25%, color-mix(in srgb, var(--muted, #667085) 22%, transparent) 45%, transparent 65%);
  background-size: 400% 100%;
  animation: pfl-shimmer 4.8s ease-in-out infinite; /* 慢速扫光，安静不催促 */
}
@keyframes pfl-shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
.pfl-sk-head .pfl-sk { height: 14px; opacity: 0.75; } /* 表头行：矮一档、淡一档 */
.pfl-sk-row { display: flex; gap: 8px; }
.pfl-sk-cell { flex: 1; height: 22px; } /* 贴近真实表格行高 */
.pfl-sk-date { flex: 0 0 76px; }
.pfl-sk-total .pfl-sk { height: 26px; } /* 合计行略高，呼应面板表格的合计行 */
@media (prefers-reduced-motion: reduce) {
  .pfl, .pfl-spinner, .pfl-progress.indeterminate .pfl-progress-bar, .pfl-sk { animation: none; }
}
</style>
