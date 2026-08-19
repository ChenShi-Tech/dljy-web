<script setup lang="ts">
// 主题切换器：顶栏闪电图标 → 弹窗展示四档主题（经典/弧光/霓虹/暖纸）。
// 状态源 services/theme(经 useTheme 适配层),切换走 View Transitions 整页淡入。
import { BookOpen, Activity, Sun, Zap } from 'lucide-vue-next'
import type { Component } from 'vue'
import { useTheme, type ThemeKey } from '../composables/useTheme'

const { theme, options, setTheme } = useTheme()

const icons: Record<ThemeKey, Component> = {
  classic: Sun,
  arc: Activity,
  neon: Zap,
  paper: BookOpen
}
</script>

<template>
  <el-popover placement="bottom-end" :width="232" trigger="click" popper-class="theme-pop">
    <template #reference>
      <button class="icon-action theme-trigger" type="button" title="切换界面主题">
        <Zap :size="15" />
      </button>
    </template>
    <div class="theme-menu" role="radiogroup" aria-label="界面主题">
      <button
        v-for="opt in options"
        :key="opt.key"
        type="button"
        role="radio"
        :aria-checked="theme === opt.key"
        :class="['theme-item', { 'is-active': theme === opt.key }]"
        @click="setTheme(opt.key)"
      >
        <component :is="icons[opt.key]" :size="16" :stroke-width="2" class="ti-icon" />
        <span class="ti-meta">
          <strong>{{ opt.label }}</strong>
          <small>{{ opt.desc }}</small>
        </span>
        <span v-if="theme === opt.key" class="ti-dot" aria-hidden="true" />
      </button>
    </div>
  </el-popover>
</template>

<style scoped>
.theme-trigger {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.theme-trigger:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.theme-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.theme-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.theme-item:hover {
  background: var(--surface-hover, rgba(127, 127, 127, 0.08));
}
.theme-item.is-active {
  border-color: var(--primary-tint-border, var(--primary));
  background: var(--primary-tint, rgba(127, 127, 127, 0.06));
}

.ti-icon {
  flex: 0 0 auto;
  color: var(--muted);
}
.theme-item.is-active .ti-icon {
  color: var(--primary);
}

.ti-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  line-height: 1.25;
}
.ti-meta strong {
  font-size: var(--font-md);
  font-weight: 600;
}
.ti-meta small {
  color: var(--muted);
  font-size: var(--font-xs);
}

.ti-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  margin-left: auto;
  border-radius: 50%;
  background: var(--primary);
}
</style>
