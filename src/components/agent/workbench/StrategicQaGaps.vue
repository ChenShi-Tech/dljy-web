<script setup lang="ts">
// 战略问答的数据缺口清单（原 StrategicQAView 头部按钮，随 #2023 入口合并抽成工作台挂件）。
//
// #1782：智能体查不到的数据会如实记入缺口清单，这里拉聚合 Markdown 供用户复制转发给
// 后端负责人。它是「查不到就说查不到」这条纪律的出口——没有这个出口，缺口只会停在
// 某一次对话里没人跟进。
import { ref } from 'vue'
import { fetchDataGaps } from '@/services/agent/piPocClient'

const markdown = ref('')
const error = ref('')
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    markdown.value = await fetchDataGaps()
  } catch (exc) {
    error.value = `缺口清单获取失败：${String(exc)}（pi-poc 服务未启动？）`
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="qa-gaps">
    <el-button size="small" :loading="loading" @click="load">数据缺口清单</el-button>
    <el-alert v-if="error" type="warning" :title="error" :closable="true" @close="error = ''" />
    <el-card v-if="markdown" class="gaps-card" shadow="never">
      <pre class="gaps-md">{{ markdown }}</pre>
    </el-card>
  </div>
</template>

<style scoped>
.qa-gaps { display: flex; flex-direction: column; gap: 8px; }
.gaps-card { max-height: 240px; overflow: auto; }
.gaps-md { margin: 0; white-space: pre-wrap; font-size: var(--font-sm); }
</style>
