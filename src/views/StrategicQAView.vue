<script setup lang="ts">
// 战略问答（#1526 PoC）：pi harness 驱动的旗舰切片，一句战略方向 → 解读 →
// 取数 → 分析 → 图表落页。AgentChatPanel 零改动接流（scenario→base 路由在
// agentClient 服务层），后端为 integrations/pi-poc 编排服务（/pi-api → 8100）。
// 持久化走 #498 默认全开：pi-poc 服务端回调 Node 登记归属（需两端同配
// AGENT_HISTORY_BIND_SECRET），未配密钥时会话不入历史侧栏但对话不受影响。
// 设计见 docs/architecture/agent-poc-strategic-qa-design.md。
import { ref } from 'vue'
import AgentChatPanel from '@/components/agent/AgentChatPanel.vue'
import { fetchDataGaps } from '@/services/agent/piPocClient'

const gapsMarkdown = ref('')
const gapsError = ref('')

// 数据缺口清单（#1782）：拉取聚合 Markdown，用户可复制转发给后端负责人
async function loadGaps() {
  gapsError.value = ''
  try {
    gapsMarkdown.value = await fetchDataGaps()
  } catch (exc) {
    gapsError.value = `缺口清单获取失败：${String(exc)}（pi-poc 服务未启动？）`
  }
}
</script>

<template>
  <div class="strategic-qa">
    <header class="page-head">
      <div>
        <h2>战略问答 <el-tag size="small" type="warning">PoC</el-tag></h2>
        <p class="sub">
          一句战略方向，智能体解读意图、查真实数据、给出分析与图表。数值来自现货权威只读接口；
          查不到的数据会如实说明并记入缺口清单。
        </p>
      </div>
      <el-button size="small" @click="loadGaps">数据缺口清单</el-button>
    </header>
    <el-alert v-if="gapsError" type="warning" :title="gapsError" :closable="true" @close="gapsError = ''" />
    <el-card v-if="gapsMarkdown" class="gaps-card" shadow="never">
      <pre class="gaps-md">{{ gapsMarkdown }}</pre>
    </el-card>
    <AgentChatPanel
      scenario="strategic_qa"
      history-key="strategic_qa"
      initial-question=""
    />
  </div>
</template>

<style scoped>
.strategic-qa { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.page-head h2 { margin: 0 0 4px; font-size: var(--font-18); }
.page-head .sub { margin: 0; color: var(--el-text-color-secondary); font-size: var(--font-md); }
.gaps-card { max-height: 240px; overflow: auto; }
.gaps-md { margin: 0; white-space: pre-wrap; font-size: var(--font-sm); }
</style>
