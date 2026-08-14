<script setup lang="ts">
// PageHelpTip.vue — 页面核心说明「?」悬浮卡（Issue #848）
// 圆形灰调问号按钮 + el-popover 悬浮卡（标题/正文/可选详细文档链接）。
// 默认从 src/data/pageHelp.ts 注册表按「当前路由 name」取内容；无注册则整体不渲染
// （渐进覆盖，不硬造）。也可传 `routeKey` prop 显式指定 key（逐页嵌入的备用入口）。
// 主题跟随项目既有 CSS 变量（var(--text)/--muted/--line/--primary/--panel）。
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { HelpCircle, ExternalLink } from 'lucide-vue-next'
import { getPageHelp } from '@/data/pageHelp'

const props = defineProps<{ routeKey?: string }>()

const route = useRoute()

// 优先用显式 prop，否则读当前路由 name；无注册表条目则返回 undefined（不渲染）。
const entry = computed(() => getPageHelp(props.routeKey ?? route.name))

// docPath 为仓库内 docs/ 路径；链接指向 GitHub 源文件（用户主动点击才外发）。
const docUrl = computed(() => {
  const p = entry.value?.docPath
  if (!p) return ''
  return `https://github.com/ChenShi-Tech/dljy/blob/main/${p.replace(/^\/+/, '')}`
})
</script>

<template>
  <el-popover
    v-if="entry"
    placement="bottom-start"
    :width="320"
    trigger="click"
    :show-after="0"
    popper-class="page-help-popper"
  >
    <template #reference>
      <button
        class="page-help-tip"
        type="button"
        :aria-label="`查看「${entry.title}」页面说明`"
        :title="`查看「${entry.title}」说明`"
      >
        <HelpCircle :size="15" />
      </button>
    </template>

    <div class="page-help-card">
      <div class="page-help-card__title">{{ entry.title }}</div>
      <p class="page-help-card__body">{{ entry.body }}</p>
      <a
        v-if="docUrl"
        class="page-help-card__doc"
        :href="docUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        <ExternalLink :size="13" />
        <span>详细文档</span>
      </a>
    </div>
  </el-popover>
</template>

<style scoped>
/* 圆形灰调问号按钮：默认低存在感，hover/focus 高亮，不喧宾夺主。 */
.page-help-tip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  padding: 0;
  margin-left: 8px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.page-help-tip:hover,
.page-help-tip:focus-visible {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--panel);
  outline: none;
}
</style>

<style>
/* el-popover 内容 teleport 到 body，需用全局（非 scoped）样式覆盖。 */
.page-help-popper.el-popover.el-popper {
  padding: 0 !important;
}

.page-help-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
}

.page-help-card__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.35;
}

.page-help-card__body {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text);
  white-space: pre-line;
}

.page-help-card__doc {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  font-size: 12px;
  color: var(--primary);
  text-decoration: none;
}

.page-help-card__doc:hover {
  text-decoration: underline;
}
</style>
