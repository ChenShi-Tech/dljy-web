<script setup lang="ts">
// 语音播报卡（页面跳转提示音开关）。纯前端 localStorage（services/voice.ts），不联网、不上传。
//
// 原内嵌在「AI 模型设置」页（AiSettingsView）。它是个人浏览器偏好、不属于平台设施，
// ChenShi-Tech/dljy#3464 起与长期记忆一起抽成独立卡片：回退时仍嵌在原页，迁移后由 AI 工作室的
// 「个人设置」tab 承载。
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getVoiceConfig, saveVoiceConfig } from '@/services/voice'

// 默认关、全程静音；AI 回复正文改为每条「朗读」按钮手动播放。
const ttsEnabled = ref(getVoiceConfig().tts)
function onTtsChange(v: string | number | boolean) {
  const on = Boolean(v)
  saveVoiceConfig({ tts: on })
  ElMessage.success(on ? '已开启页面跳转语音播报' : '已关闭语音播报（全程静音）')
}
</script>

<template>
  <section class="card voice-card" data-testid="voice-broadcast-card">
    <div class="card-head">
      <h2>语音播报</h2>
      <span class="muted-tag">{{ ttsEnabled ? '已开启' : '已关闭' }}</span>
    </div>
    <p class="sub">
      控制 AI 助手的<strong>页面跳转提示音</strong>——识别到目标自动跳转时是否朗读「正在前往…」。
      默认关闭、全程静音；AI 回复正文不会自动朗读，需要时点每条回复下方的「朗读」按钮手动播放。
      使用浏览器原生语音（Web Speech API），不联网、不上传。
    </p>
    <div class="field tts-field">
      <el-switch v-model="ttsEnabled" @change="onTtsChange" />
      <label>页面跳转时语音播报</label>
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
.card-head h2 { margin: 0; font-size: var(--font-20); color: var(--text); }
.muted-tag { font-weight: 400; font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.sub { margin: 10px 0 22px; font-size: var(--font-md); line-height: 1.7; color: var(--muted); }
.sub strong { color: var(--primary); }
.field { margin-bottom: 18px; }
.field label { display: block; margin-bottom: 7px; font-size: var(--font-md); font-weight: 600; color: var(--text-body); }
.tts-field { display: flex; align-items: center; gap: 10px; }
.tts-field label { margin: 0; }
</style>
