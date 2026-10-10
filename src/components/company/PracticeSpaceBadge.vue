<script setup lang="ts">
import { currentPracticeCompany, exitPracticeSpace } from '@/services/company/practiceSpace'

// 练习空间顶栏徽标（#3403）：当前公司是练习公司时显示「练习空间 · 公司名 · 退出」，
// 提醒用户此刻的读写都落在练习数据里；点退出切回来源公司。
// data-guide="practice-space-badge" 供操作导引引擎（#3404）定位。
function onExit() {
  try {
    exitPracticeSpace()
  } catch {
    // 退出只做本地上下文切换，正常不抛；真异常时保持现状不打断用户。
  }
}
</script>

<template>
  <div v-if="currentPracticeCompany" class="practice-badge" data-guide="practice-space-badge" title="练习空间：数据不计入集团汇总，不能删除">
    <span class="practice-badge-tag">练习空间</span>
    <span class="practice-badge-name">{{ currentPracticeCompany.name }}</span>
    <button class="practice-badge-exit" type="button" @click="onExit">退出</button>
  </div>
</template>

<style scoped>
.practice-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 auto;
  min-width: 0;
  height: 28px;
  padding: 0 4px 0 8px;
  border: 1px solid var(--primary-tint-border, var(--line));
  border-radius: 8px;
  background: var(--primary-tint, var(--chip-bg));
}

.practice-badge-tag {
  flex: 0 0 auto;
  color: var(--primary-strong, var(--chip-text));
  font-size: var(--font-tb-11);
  font-weight: 600;
  white-space: nowrap;
}

.practice-badge-name {
  min-width: 0;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--chip-text);
  font-size: var(--font-tb-11);
}

.practice-badge-exit {
  flex: 0 0 auto;
  height: 20px;
  padding: 0 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--primary-strong, var(--muted));
  font-size: var(--font-tb-11);
  line-height: 18px;
  cursor: pointer;
}

.practice-badge-exit:hover {
  background: var(--chip-bg);
  color: var(--primary, var(--chip-text));
}
</style>
