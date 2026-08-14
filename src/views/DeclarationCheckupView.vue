<script setup lang="ts">
// 申报体检（#1527 PoC 第二切片）：pi harness 驱动的既有场景迁移验证——查行情 →
// 沙箱实算体检 → 业务语义审批卡 → 人批准后落库申报台 DRAFT（submit 永不可执行）。
// AgentChatPanel 零改动接流（scenario→base 路由在 agentClient 服务层，/pi-api → 8100）。
// 「自动执行授权」开关 = --dangerously-skip-permissions 类比：人亲手开启后 L1 业务写
// （落库草稿）免审直通；L2（对外提交）永不免审且执行被硬禁。授权按会话生效、不持久
// （服务重启即失效，需重新开启）。设计见 docs/architecture/agent-poc-declaration-design.md。
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import AgentChatPanel from '@/components/agent/AgentChatPanel.vue'
import { identityHeaders } from '@/services/agent/agentClient'

const sessionId = ref('')
const autoApprove = ref(false)
const toggling = ref(false)

function onSessionReady(id: string) {
  sessionId.value = id
  autoApprove.value = false // 新会话/恢复会话一律从关闭起步（授权不持久红线）
}

async function toggleAutoApprove(enabled: string | number | boolean) {
  if (!sessionId.value) return
  toggling.value = true
  try {
    const res = await fetch(`/pi-api/agent/sessions/${encodeURIComponent(sessionId.value)}/auto-approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...identityHeaders() },
      body: JSON.stringify({ enabled: enabled === true })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    autoApprove.value = ((await res.json()) as { auto_approve?: boolean }).auto_approve === true
    ElMessage.success(autoApprove.value
      ? '已开启本会话自动执行授权：落库草稿不再逐次审批（对外提交仍永不自动）'
      : '已关闭自动执行授权：业务写操作恢复逐次审批')
  } catch (exc) {
    autoApprove.value = !autoApprove.value // 回滚开关显示，不留假授权状态
    ElMessage.error(`授权切换失败：${String(exc)}`)
  } finally {
    toggling.value = false
  }
}
</script>

<template>
  <div class="declaration-checkup">
    <header class="page-head">
      <div>
        <h2>申报体检 <el-tag size="small" type="warning">PoC</el-tag></h2>
        <p class="sub">
          智能体查行情、沙箱实算申报前体检（曲线/容量/负荷贴合/价格敏感性），经审批卡人工批准后
          落库申报台草稿。对外提交在本页永不可执行，请到申报台走正式流程。
        </p>
      </div>
      <div class="auto-approve">
        <el-tooltip
          content="开启后本会话的「落库草稿」类业务写不再逐次弹审批卡（对外提交不受影响，永不自动）。授权只对当前会话有效，服务重启后失效。"
          placement="bottom-end"
        >
          <span class="aa-label">自动执行授权</span>
        </el-tooltip>
        <el-switch
          :model-value="autoApprove"
          :disabled="!sessionId || toggling"
          @change="toggleAutoApprove"
        />
      </div>
    </header>
    <AgentChatPanel
      scenario="declaration_checkup"
      history-key="declaration_checkup"
      initial-question=""
      @session-ready="onSessionReady"
    />
  </div>
</template>

<style scoped>
.declaration-checkup { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.page-head h2 { margin: 0 0 4px; font-size: 18px; }
.page-head .sub { margin: 0; color: var(--el-text-color-secondary); font-size: 13px; }
.auto-approve { display: flex; align-items: center; gap: 8px; white-space: nowrap; padding-top: 4px; }
.aa-label { font-size: 13px; color: var(--el-text-color-secondary); cursor: help; }
</style>
