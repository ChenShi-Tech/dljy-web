<script setup lang="ts">
// AgentSidekick：业务页面右侧可折叠智能体栏。
// 页面提供上下文化预置问题 chips（文案内插当前业务参数），点击即发送。
// 注意：chips 问题必须传业务参数（月份/总量/模式…），不可传 data_ref
// 句柄 —— ref 按会话目录隔离，跨会话不可读（架构既定约束）。
import { ref } from 'vue'
import { Bot, PanelRightClose, Sparkles } from 'lucide-vue-next'
import type { AgentScenario } from '@/services/agent/agentClient'
import AgentChatPanel from './AgentChatPanel.vue'

withDefaults(
  defineProps<{
    scenario?: AgentScenario
    chips?: { label: string; question: string }[]
    payload?: Record<string, unknown> | null
    title?: string
    // 接入点唯一标识（#498）：转传给内嵌 AgentChatPanel（localStorage 隔离 + 历史来源标注），
    // 各宿主页面必须显式传全仓唯一 key（verify:agent-chat-invariants 守卫）。
    historyKey?: string
  }>(),
  { scenario: 'chat', chips: () => [], payload: null, title: '问智能体', historyKey: '' }
)

const emit = defineEmits<{ done: [status: string] }>()

const open = ref(false)
const panelRef = ref<InstanceType<typeof AgentChatPanel> | null>(null)

function askChip(question: string) {
  open.value = true
  // 面板展开后再发送（首次展开时组件刚挂载）
  requestAnimationFrame(() => panelRef.value?.ask(question))
}

defineExpose({ ask: askChip, open })
</script>

<template>
  <!-- 折叠态：悬浮唤起按钮 -->
  <button v-if="!open" class="sidekick-fab" :title="title" @click="open = true">
    <Bot :size="18" />
  </button>

  <!-- 展开态：右侧栏 -->
  <aside v-else class="sidekick">
    <header class="sidekick-head">
      <span class="sk-title"><Sparkles :size="14" /> {{ title }}</span>
      <button class="sk-close" title="收起" @click="open = false">
        <PanelRightClose :size="15" />
      </button>
    </header>
    <div v-if="chips.length" class="sk-chips">
      <button v-for="c in chips" :key="c.label" class="sk-chip" @click="askChip(c.question)">
        {{ c.label }}
      </button>
    </div>
    <div class="sk-panel">
      <!-- 故意不传 prompt-key：浮层 Sidekick 是按当前页面上下文应答的通用助手，
           绑定特定角色反而限制其跨场景灵活性 → 走默认 supervisor（含 SAFETY_BASELINE）。
           阶段 A 健全性：探活/未就绪提示已在共享 AgentChatPanel 内统一处理。 -->
      <AgentChatPanel
        ref="panelRef"
        :scenario="scenario"
        :payload="payload"
        :history-key="historyKey"
        @done="(s) => emit('done', s)"
      />
    </div>
  </aside>
</template>

<style scoped>
.sidekick-fab {
  position: fixed;
  right: 18px;
  bottom: 84px;
  z-index: 30;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: grid;
  place-items: center;
  background: var(--primary, #0f766e);
  color: #fff;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  transition: transform 0.15s ease;
}
.sidekick-fab:hover { transform: scale(1.08); }
.sidekick-fab:focus-visible { outline: 2px solid var(--primary, #0f766e); outline-offset: 3px; }

.sidekick {
  position: fixed;
  top: 72px;
  right: 12px;
  bottom: 12px;
  width: 400px;
  max-width: 92vw;
  z-index: 30;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line, #d9e2ec);
  border-radius: 14px;
  background: var(--panel, #fff);
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}
.sidekick-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line, #d9e2ec);
}
.sk-title { display: flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 600; }
.sk-close {
  border: none; background: transparent; cursor: pointer;
  color: var(--muted, #667085); display: grid; place-items: center;
}
.sk-close:hover { color: var(--primary, #0f766e); }

.sk-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line, #d9e2ec);
}
.sk-chip {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px dashed var(--primary, #0f766e);
  border-radius: 999px;
  background: transparent;
  color: var(--primary, #0f766e);
  cursor: pointer;
  transition: all 0.15s ease;
}
.sk-chip:hover { border-style: solid; background: color-mix(in srgb, var(--primary, #0f766e) 10%, transparent); }

.sk-panel { flex: 1; min-height: 0; }
.sk-panel :deep(.agent-panel) { border-radius: 0; }
</style>
