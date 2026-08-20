<script setup lang="ts">
// 申报体检的「自动执行授权」开关（原 DeclarationCheckupView 头部，随 #2023 入口合并抽成挂件）。
//
// 类比 --dangerously-skip-permissions：人亲手开启后本会话的 L1 业务写（落库草稿）免审直通；
// **L2（对外提交）永不免审且执行被硬禁**。授权按会话生效、不持久（服务重启即失效）——
// 这条不持久是红线：授权若能跨重启存活，用户就无从知道自己什么时候还开着它。
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { setSessionAutoApprove } from '@/services/agent/piPocClient'

const props = defineProps<{ sessionId: string }>()

const autoApprove = ref(false)
const toggling = ref(false)

// 换会话（新建/回放历史）一律把开关打回关闭：授权不跨会话，显示上也不许留着上一会话的状态。
watch(() => props.sessionId, () => { autoApprove.value = false })

async function toggle(enabled: string | number | boolean): Promise<void> {
  if (!props.sessionId) return
  toggling.value = true
  try {
    autoApprove.value = await setSessionAutoApprove(props.sessionId, enabled === true)
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
  <div class="auto-approve">
    <el-tooltip
      content="开启后本会话的「落库草稿」类业务写不再逐次弹审批卡（对外提交不受影响，永不自动）。授权只对当前会话有效，服务重启后失效。"
      placement="bottom-end"
    >
      <span class="aa-label">自动执行授权</span>
    </el-tooltip>
    <el-switch :model-value="autoApprove" :disabled="!sessionId || toggling" @change="toggle" />
  </div>
</template>

<style scoped>
.auto-approve { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.aa-label { font-size: var(--font-md); color: var(--el-text-color-secondary); cursor: help; }
</style>
