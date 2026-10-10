<script setup lang="ts">
// 长期记忆管理卡（查看 / 删除当前登录账号自己的跨会话记忆）。
//
// 原内嵌在「AI 模型设置」页（AiSettingsView）。ChenShi-Tech/dljy#3464 起内部版把 AI 设施整组迁至
// 平台后台，但长期记忆属个人自助（按登录账号隔离，只带登录身份、不带管理令牌），必须保留——
// 抽成独立卡片：回退时仍嵌在原页，迁移后由 AI 工作室的「个人设置」tab 承载，两处同一实现。
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Trash2 } from 'lucide-vue-next'
import { clearMemories, deleteMemory, listMemories, type MemoryItem } from '@/services/agent/memoryConfig'

const memories = ref<MemoryItem[]>([])
const memoryLoading = ref(false)

async function loadMemories() {
  memoryLoading.value = true
  try {
    memories.value = (await listMemories()).memories
  } catch {
    memories.value = []
  }
  memoryLoading.value = false
}
onMounted(loadMemories)

async function doDeleteMemory(key: string) {
  if (await deleteMemory(key)) {
    ElMessage.success('已删除该记忆')
    await loadMemories()
  } else ElMessage.error('删除失败（后端未运行？）')
}

async function doClearMemories() {
  if (await clearMemories()) {
    ElMessage.success('已清空全部长期记忆')
    await loadMemories()
  } else ElMessage.error('清空失败')
}
</script>

<template>
  <section class="card memory-card" data-testid="memory-management-card">
    <div class="card-head">
      <h3>长期记忆管理</h3>
      <span v-if="memories.length" class="muted-tag">{{ memories.length }} 条</span>
    </div>
    <p class="sub2">
      智能体在对话中沉淀的跨会话记忆（用户偏好/复盘结论/策略经验/市场规律），按你的登录账号隔离。
      可查看、删除单条或全部清空。记忆由 <code>save_memory</code> 工具写入、<code>search_memory</code> 检索。
    </p>
    <div v-if="memoryLoading" class="hint">加载中…</div>
    <div v-else-if="!memories.length" class="hint">暂无长期记忆（智能体会在对话中自动沉淀，或未登录）</div>
    <div v-else class="mem-list">
      <div v-for="m in memories" :key="m.key" class="mem-row">
        <span class="mem-topic">{{ m.topic || 'other' }}</span>
        <span class="mem-content">{{ m.content }}</span>
        <span class="mem-time">{{ m.created_at || '' }}</span>
        <el-button text size="small" class="del-btn" @click="doDeleteMemory(m.key)"><Trash2 :size="13" /> 删除</el-button>
      </div>
    </div>
    <div v-if="memories.length" class="actions">
      <el-button text class="del-btn" @click="doClearMemories">清空全部记忆</el-button>
    </div>
  </section>
</template>

<style scoped>
/* 与「AI 模型设置」页卡片同款（原样搬出，保证回退后嵌回原页观感不变）。 */
.card {
  background: var(--panel);
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  padding: 24px 26px;
  box-shadow: 0 12px 30px -22px rgba(16, 60, 60, 0.35);
}
.card-head { display: flex; align-items: center; gap: 12px; }
.card h3 { margin: 0 0 6px; font-size: var(--font-16); color: var(--text); }
.muted-tag { font-weight: 400; font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.sub2 { margin: 0 0 18px; font-size: var(--font-12-5); line-height: 1.6; color: var(--muted); }
.hint { display: block; margin-top: 6px; font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.actions { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.del-btn { margin-left: auto; color: var(--danger); }
</style>
