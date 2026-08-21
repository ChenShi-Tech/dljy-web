<script setup lang="ts">
// 生成复盘报告弹层（#2038）：智能体从常驻聊天框改为动作——点「生成报告」才挂载对话面板，
// 流结束 emit done 由父组件刷新报告库；关闭即卸载（历史已持久化，可在侧栏历史里回看）。
// AgentChatPanel 不变量：history-key 静态且全仓唯一（review_center，从 ReviewCenterView 迁入）、prompt-key 走白名单常量。
import AgentChatPanel from '@/components/agent/AgentChatPanel.vue'
import { PAGE_PROMPT_KEYS } from '@/prompts/pageKeys'

defineProps<{ open: boolean; date: string }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'done'): void }>()
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="`生成 ${date} 复盘报告`"
    width="min(920px, 94vw)"
    top="6vh"
    destroy-on-close
    append-to-body
    class="review-report-dialog"
    @update:model-value="emit('update:open', $event)"
  >
    <div v-if="open" class="embed">
      <AgentChatPanel
        scenario="daily_review"
        :initial-question="date"
        :prompt-key="PAGE_PROMPT_KEYS.reviewCenter"
        history-key="review_center"
        @done="emit('done')"
      />
    </div>
  </el-dialog>
</template>

<style scoped>
.embed { height: min(560px, 70vh); }
</style>
