<script setup lang="ts">
// C2 调度结果推送·全局渠道配置面板（挂于 AI 设置页）。
// 5 渠道（webhook/smtp/feishu/wecom/dingtalk）凭证统一存 notify_keystore（KeyStore，密钥不回传明文）。
// 测试按钮即时发一条测试消息验证连通。任务级推送开关在「调度管理」页每任务配置。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Plug } from 'lucide-vue-next'
import { listChannels, saveChannels, testChannel, type ChannelKey, type ChannelsConfig } from '@/services/agent/notifyClient'

const CHANNEL_LABELS: Record<ChannelKey, string> = {
  webhook: 'Webhook（通用 HTTP+HMAC 签名）',
  smtp: '邮件（SMTP）',
  feishu: '飞书机器人',
  wecom: '企业微信群机器人',
  dingtalk: '钉钉群机器人',
}

// 各渠道字段（secret/pass 留空=沿用已存，has_secret 显示已配）
const cfg = reactive<ChannelsConfig>({
  webhook: { url: '', secret: '', enabled: false },
  smtp: { host: '', port: 465, user: '', pass: '', from_addr: '', to_addrs: [] as string[], enabled: false },
  feishu: { webhook_url: '', secret: '', enabled: false },
  wecom: { webhook_url: '', enabled: false },
  dingtalk: { webhook_url: '', secret: '', enabled: false },
})
const hasSecret = reactive<Record<ChannelKey, boolean>>({ webhook: false, smtp: false, feishu: false, wecom: false, dingtalk: false })
const loading = ref(false)
const testing = ref<ChannelKey | null>(null)

async function load() {
  loading.value = true
  try {
    const list = await listChannels()
    for (const c of list) {
      const k = c.key as ChannelKey
      hasSecret[k] = !!c.has_secret
      // 仅回填非密钥字段（密钥不回传，保留空=沿用）
      for (const f of Object.keys(cfg[k])) {
        if (f in c && f !== 'enabled') (cfg[k] as Record<string, unknown>)[f] = c[f]
      }
      cfg[k].enabled = c.enabled
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败（智能体后端未运行？）')
  } finally {
    loading.value = false
  }
}

async function onSave() {
  try {
    await saveChannels(cfg)
    ElMessage.success('已保存全局推送渠道')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  }
}

async function onTest(k: ChannelKey) {
  testing.value = k
  try {
    const r = await testChannel(k)
    if (r.ok) ElMessage.success(`${CHANNEL_LABELS[k]} 连通成功`)
    else ElMessage.warning(`${CHANNEL_LABELS[k]} 连通失败：${r.msg || '未知'}`)
  } finally {
    testing.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="notify-panel" v-loading="loading">
    <div class="np-head"><span class="np-title"><Plug :size="15" /> 调度结果推送渠道</span></div>
    <p class="np-desc">
      全局渠道凭证（webhook/邮件/飞书/企微/钉钉）。密钥存服务端（不回传明文，留空=沿用已存）。任务级「何时推送、推哪些渠道」在「调度管理」页每任务配置。
    </p>
    <div v-for="(label, k) in CHANNEL_LABELS" :key="k" class="np-channel">
      <div class="np-ch-head">
        <el-switch v-model="cfg[k].enabled" />
        <span class="np-ch-name">{{ label }}</span>
        <span v-if="hasSecret[k]" class="np-tag">🔑 已配密钥</span>
        <el-button size="small" :loading="testing === k" @click="onTest(k)">测试</el-button>
      </div>
      <div class="np-fields">
        <template v-if="k === 'webhook'">
          <el-input v-model="cfg.webhook.url" placeholder="https://... 回调 URL" size="small" />
          <el-input v-model="cfg.webhook.secret" type="password" show-password placeholder="签名 secret（可选，留空=沿用）" size="small" />
        </template>
        <template v-else-if="k === 'smtp'">
          <el-input v-model="cfg.smtp.host" placeholder="SMTP host" size="small" />
          <el-input v-model.number="cfg.smtp.port" type="number" placeholder="端口（465 SSL）" size="small" />
          <el-input v-model="cfg.smtp.user" placeholder="用户名" size="small" />
          <el-input v-model="cfg.smtp.pass" type="password" show-password placeholder="密码（留空=沿用）" size="small" />
          <el-input v-model="cfg.smtp.from_addr" placeholder="发件地址" size="small" />
          <el-input :model-value="(cfg.smtp.to_addrs as string[]).join(',')" placeholder="收件地址（逗号分隔）" size="small" @update:model-value="cfg.smtp.to_addrs = String($event).split(',').map((s) => s.trim()).filter(Boolean)" />
        </template>
        <template v-else>
          <el-input v-model="(cfg[k].webhook_url as string)" placeholder="群机器人 webhook URL" size="small" />
          <el-input v-if="'secret' in cfg[k]" v-model="(cfg[k].secret as string)" type="password" show-password placeholder="加签 secret（可选，留空=沿用）" size="small" />
        </template>
      </div>
    </div>
    <el-button type="primary" size="small" @click="onSave">保存全部渠道</el-button>
  </div>
</template>

<style scoped>
.notify-panel { border: 1px solid var(--el-border-color); border-radius: 8px; padding: 14px; margin: 12px 0; }
.np-head { display: flex; align-items: center; justify-content: space-between; }
.np-title { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: var(--font-lg); }
.np-desc { font-size: var(--font-sm); color: var(--el-text-color-secondary); margin: 6px 0 10px; }
.np-channel { border-top: 1px solid var(--el-border-color-lighter); padding: 10px 0; }
.np-ch-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.np-ch-name { font-size: var(--font-md); font-weight: 600; flex: 1; }
.np-tag { font-size: var(--font-xs); padding: 1px 6px; border-radius: 8px; background: var(--el-fill-color); }
.np-fields { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.np-fields .el-input { width: 100%; }
@media (max-width: 600px) { .np-fields { grid-template-columns: 1fr; } }
</style>
