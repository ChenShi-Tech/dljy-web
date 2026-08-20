<script setup lang="ts">
// 斜杠指令补全弹层（纯展示）：定位于输入区上方，键盘交互由 useSlashInput 驱动。
import { ref, watch, nextTick } from 'vue'
import type { SlashMenuItem } from '../../composables/useSlashInput'

const props = defineProps<{ items: SlashMenuItem[]; activeIndex: number }>()
const emit = defineEmits<{ select: [number]; hover: [number] }>()

const listRef = ref<HTMLElement | null>(null)

watch(
  () => props.activeIndex,
  () => {
    nextTick(() => {
      listRef.value?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
    })
  }
)
</script>

<template>
  <div class="slash-menu">
    <ul ref="listRef">
      <li
        v-for="(it, i) in items"
        :key="it.title + i"
        :class="{ active: i === activeIndex }"
        @mousedown.prevent="emit('select', i)"
        @mousemove="emit('hover', i)"
      >
        <div class="sm-main">
          <div class="sm-title">
            {{ it.title }}
            <span v-if="it.hint" class="sm-hint">{{ it.hint }}</span>
          </div>
          <div v-if="it.desc" class="sm-desc">{{ it.desc }}</div>
        </div>
        <span v-if="it.source === 'skill'" class="sm-tag">技能</span>
      </li>
    </ul>
    <div class="sm-foot">↑↓ 选择 · Enter/Tab 确认 · Esc 关闭</div>
  </div>
</template>

<style scoped>
.slash-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 30;
  background: var(--panel, #fff);
  border: 1px solid var(--line-soft, rgba(125, 125, 125, 0.25));
  border-radius: 12px;
  box-shadow: 0 18px 40px -18px rgba(15, 60, 60, 0.4);
  overflow: hidden;
}
.slash-menu ul {
  list-style: none;
  margin: 0;
  padding: 6px;
  max-height: 240px;
  overflow-y: auto;
}
.slash-menu li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 9px;
  cursor: pointer;
}
.slash-menu li.active {
  background: var(--primary-tint, #e6f4f2);
}
.sm-main { flex: 1; min-width: 0; }
.sm-title {
  font-size: var(--font-13-5);
  font-weight: 650;
  color: var(--text, #1f2937);
  font-family: var(--el-font-family, inherit);
}
.sm-hint {
  margin-left: 6px;
  font-size: var(--font-sm);
  font-weight: 400;
  color: var(--el-text-color-placeholder, #a8abb2);
}
.sm-desc {
  margin-top: 1px;
  font-size: var(--font-sm);
  color: var(--el-text-color-secondary, #909399);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sm-tag {
  flex: none;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: var(--font-xs);
  color: var(--primary, #0f766e);
  background: var(--primary-tint, #e6f4f2);
  border: 1px solid var(--primary-tint-border, #19988b44);
}
.sm-foot {
  padding: 5px 12px;
  font-size: var(--font-xs);
  color: var(--el-text-color-placeholder, #a8abb2);
  border-top: 1px solid var(--line-faint, rgba(125, 125, 125, 0.12));
}
</style>
