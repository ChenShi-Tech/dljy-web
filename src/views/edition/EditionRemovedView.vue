<script setup lang="ts">
// 交付档占位组件（主仓 Epic #2408 · #2410）。
//
// 客户交付版构建时，vite 插件 `dljy-customer-edition` 会把「AI 模型设置」页重定向到
// 本组件——不是把页面藏起来，而是让真实组件**根本不进产物**：那个页面 import 的
// `llmProviders.ts` 里有 deepseek / 豆包 / 智谱的中文名、型号列表和文档链接，只要它
// 还在 JS 里，打开 devtools 搜一下就能看到。
//
// 正常情况下用户看不到本组件：交付档的 tab 列表里已经没有那一项，只有手输 URL 才会到。
</script>

<template>
  <div class="edition-removed">
    <p>该功能在当前版本中未启用。</p>
  </div>
</template>

<style scoped>
.edition-removed {
  padding: var(--space-lg, 24px);
  color: var(--text-secondary, #909399);
  font-size: var(--font-sm, 13px);
}
</style>
