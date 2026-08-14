<script setup lang="ts">
// 地区规则迁移提示：切换地区时弹出"上一地区 → 当前地区"的规则差异与影响，
// 提醒重新标定已配策略。纯前端、自包含、可关闭。挂在 AppLayout 顶层一次即可。
import { ref, watch } from 'vue'
import { selectedRegionId } from '@/services/region/regionContext'
import { diffRegions, type RegionDiff } from '@/services/region/regionMigration'

const diff = ref<RegionDiff | null>(null)
let prevId = selectedRegionId.value

watch(selectedRegionId, (cur) => {
  if (!cur || cur === prevId) return
  const prev = prevId
  prevId = cur
  try {
    const d = diffRegions(prev, cur)
    diff.value = d.items.length ? d : null
  } catch {
    diff.value = null // 个别地区无现货画像时静默跳过
  }
})

function dismiss() {
  diff.value = null
}
</script>

<template>
  <transition name="rm-fade">
    <aside v-if="diff" class="rm-card">
      <header class="rm-head">
        <span class="rm-title">📍 地区规则迁移：{{ diff.fromName }} → {{ diff.toName }}</span>
        <button class="rm-close" title="关闭" @click="dismiss">×</button>
      </header>
      <p class="rm-sub">切换地区后以下规则差异可能影响已配策略，请按需重新标定：</p>
      <ul class="rm-list">
        <li v-for="(it, i) in diff.items" :key="i">
          <div class="rm-row">
            <span class="rm-k">{{ it.label }}</span>
            <span class="rm-v">{{ it.from }} → {{ it.to }}</span>
          </div>
          <div class="rm-impact">{{ it.impact }}</div>
        </li>
      </ul>
    </aside>
  </transition>
</template>

<style scoped>
.rm-card {
  position: fixed; right: 18px; bottom: 18px; z-index: 40;
  width: 360px; max-width: 92vw; max-height: 70vh; overflow: auto;
  background: var(--panel, #fff); border: 1px solid var(--accent, #d97706);
  border-radius: 12px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
  padding: 12px 14px; font-size: 13px;
}
.rm-head { display: flex; align-items: center; gap: 8px; }
.rm-title { font-weight: 700; color: var(--accent, #b45309); font-size: 13px; }
.rm-close {
  margin-left: auto; border: none; background: none; cursor: pointer;
  font-size: 18px; line-height: 1; color: var(--muted, #888);
}
.rm-sub { margin: 8px 0 10px; font-size: 12px; color: var(--muted, #667085); line-height: 1.5; }
.rm-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.rm-row { display: flex; gap: 8px; align-items: baseline; }
.rm-k { font-weight: 600; color: var(--text-body, #222); min-width: 88px; flex-shrink: 0; }
.rm-v { color: var(--primary, #0f766e); font-size: 12.5px; }
.rm-impact { font-size: 12px; color: var(--muted, #667085); margin-top: 2px; line-height: 1.5; }
.rm-fade-enter-active, .rm-fade-leave-active { transition: opacity 0.25s, transform 0.25s; }
.rm-fade-enter-from, .rm-fade-leave-to { opacity: 0; transform: translateY(8px); }
</style>
