<script setup lang="ts">
// AI 工作室「个人设置」tab（仅内部版、且 AI 设施组已迁至平台后台时出现；ChenShi-Tech/dljy#3464）。
//
// 「AI 模型设置」页整体迁走后，页里只剩两块个人自助内容需要保留：
//   长期记忆管理 —— 当前登录账号自己的跨会话记忆（按账号隔离，不带管理令牌）
//   语音播报     —— 本机浏览器偏好（localStorage），不涉及任何后端
// 两张卡与原页复用同一组件，回退时原页照旧嵌着它们。
// 客户交付版构建时本组件被重定向到占位组件（dljy-customer-edition 插件），不进交付产物。
import MemoryManagementCard from './MemoryManagementCard.vue'
import VoiceBroadcastCard from './VoiceBroadcastCard.vue'
</script>

<template>
  <div class="personal-ai-settings" data-testid="personal-ai-settings">
    <p class="pane-desc">只影响你自己的 AI 使用习惯：智能体为你沉淀的长期记忆，以及本机的语音播报开关。</p>
    <div class="pane-body">
      <MemoryManagementCard />
      <VoiceBroadcastCard />
    </div>
  </div>
</template>

<style scoped>
.personal-ai-settings { display: flex; flex-direction: column; gap: 14px; }
.pane-desc { margin: 0; font-size: var(--font-md); line-height: 1.7; color: var(--muted); }
.pane-body { display: grid; gap: 18px; align-items: start; grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr); }
@media (max-width: 1180px) {
  .pane-body { grid-template-columns: minmax(0, 1fr); }
}
</style>
