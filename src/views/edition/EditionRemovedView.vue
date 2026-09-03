<script setup lang="ts">
// 交付档占位组件（主仓 Epic #2408 · #2410）。
//
// 客户交付版构建时，vite 插件 `dljy-customer-edition` 会把「AI 模型设置」页重定向到
// 本组件——不是把页面藏起来，而是让真实组件**根本不进产物**：那个页面是内部档专属的
// 配置面（联网搜索密钥、我方管理令牌、采样 / 工作流参数），只要它还在 JS 里，打开
// devtools 搜一下就能看到。（#2410 时它还带着一份供应商清单，#2668 起那份清单已删。）
//
// 正常情况下用户看不到本组件：交付档的「模型服务」tab 指向的是另一个零品牌信息的组件，
// 只有构建残留的动态 import 才会解析到这里。
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
