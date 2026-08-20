<script setup lang="ts">
// 下载/附件 artifact：内联内容(Blob 下载)或外链(新窗口打开)。
// agent 可把生成的报告/CSV/JSON 作为 content 直接给出，无需依赖后端文件端点。
import { Paperclip, Download, ExternalLink } from 'lucide-vue-next'
import type { DownloadArtifactBlock, DownloadFile } from '../../../utils/artifactBlocks'
import ArtifactFrame from './ArtifactFrame.vue'

defineProps<{ block: DownloadArtifactBlock }>()

function sizeText(b?: number): string {
  if (!b) return ''
  if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB'
  if (b > 1024) return (b / 1024).toFixed(0) + ' KB'
  return b + ' B'
}
function download(f: DownloadFile) {
  if (f.url) {
    window.open(f.url, '_blank', 'noopener')
    return
  }
  if (f.content == null) return
  const blob = new Blob([f.content], { type: f.mime || 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = f.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
</script>

<template>
  <ArtifactFrame kind="download" :title="block.title" :badge="`${block.files.length}`">
    <template #icon><Paperclip :size="14" /></template>
    <ul class="dl-list">
      <li v-for="(f, i) in block.files" :key="i" class="dl-item">
        <span class="dl-name">{{ f.name }}</span>
        <span v-if="sizeText(f.bytes)" class="dl-size">{{ sizeText(f.bytes) }}</span>
        <button class="art-btn dl-btn" @click="download(f)">
          <component :is="f.url ? ExternalLink : Download" :size="12" />{{ f.url ? '打开' : '下载' }}
        </button>
      </li>
    </ul>
  </ArtifactFrame>
</template>

<style scoped>
.dl-list { list-style: none; margin: 0; padding: 8px 12px; }
.dl-item { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: var(--font-md); }
.dl-name { font-weight: 500; word-break: break-all; }
.dl-size { font-size: var(--font-11-5); opacity: 0.5; flex-shrink: 0; }
.dl-btn { margin-left: auto; flex-shrink: 0; }
</style>
