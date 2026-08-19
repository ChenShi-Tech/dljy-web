<script setup lang="ts">
// 可交互 HTML artifact：沙箱 iframe 预览 / 源码切换 / 复制 / 全屏。
// iframe 用 sandbox（不含 allow-same-origin）隔离：脚本可跑但无法访问父页面与同源资源。
// 不提供「新窗口打开」，blob URL 会继承本应用 origin，脚本脱离 sandbox 后可读同源存储/
// 发已登录请求；全屏预览仍走 sandbox iframe。
import { computed, ref } from 'vue'
import { AppWindow, Code2, Copy, Check, Maximize2, X } from 'lucide-vue-next'
import hljs from 'highlight.js/lib/common'
import type { HtmlArtifactBlock } from '../../../utils/artifactBlocks'
import ArtifactFrame from './ArtifactFrame.vue'

const props = defineProps<{ block: HtmlArtifactBlock }>()
const view = ref<'preview' | 'code'>('preview')
const fullscreen = ref(false)
const copied = ref(false)

const SANDBOX = 'allow-scripts allow-popups allow-modals allow-forms'

const doc = computed(
  () =>
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>body{margin:12px;font-family:system-ui,-apple-system,'PingFang SC',sans-serif;` +
    `color:#1f2937;font-size:14px;line-height:1.6}*{box-sizing:border-box}img{max-width:100%}` +
    `</style></head><body>${props.block.code}</body></html>`
)
const codeHtml = computed(() => {
  try {
    return hljs.highlight(props.block.code, { language: 'xml', ignoreIllegals: true }).value
  } catch {
    return props.block.code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
})

async function copy() {
  try {
    await navigator.clipboard.writeText(props.block.code)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* 静默 */
  }
}
</script>

<template>
  <ArtifactFrame kind="html" :title="block.title" badge="HTML">
    <template #icon><AppWindow :size="14" /></template>
    <template #actions>
      <button class="art-btn" :class="{ active: view === 'preview' }" @click="view = 'preview'">预览</button>
      <button class="art-btn" :class="{ active: view === 'code' }" @click="view = 'code'">
        <Code2 :size="12" />源码
      </button>
      <button class="art-btn" :class="{ ok: copied }" title="复制源码" @click="copy">
        <component :is="copied ? Check : Copy" :size="12" />
      </button>
      <button class="art-btn" title="全屏预览" @click="fullscreen = true"><Maximize2 :size="12" /></button>
    </template>

    <div v-show="view === 'preview'" class="html-preview">
      <iframe :srcdoc="doc" :sandbox="SANDBOX" title="HTML 预览" />
    </div>
    <pre v-show="view === 'code'" class="html-code"><code v-html="codeHtml" /></pre>
  </ArtifactFrame>

  <Teleport to="body">
    <div v-if="fullscreen" class="html-fs" @click.self="fullscreen = false">
      <div class="html-fs-bar">
        <span>{{ block.title }}</span>
        <button class="fs-close" @click="fullscreen = false"><X :size="14" />关闭</button>
      </div>
      <iframe :srcdoc="doc" :sandbox="SANDBOX" title="HTML 全屏预览" />
    </div>
  </Teleport>
</template>

<style scoped>
.html-preview iframe {
  width: 100%; height: 360px; border: 0; display: block; background: #fff;
}
.html-code {
  margin: 0; padding: 12px 14px; max-height: 360px; overflow: auto;
  background: rgba(20, 24, 34, 0.96); color: #e5e7eb;
  font-size: 12.5px; line-height: 1.55; white-space: pre;
  font-family: 'SFMono-Regular', Consolas, Menlo, monospace;
}
.html-code :deep(code) { background: none; padding: 0; font-family: inherit; }

.html-fs {
  position: fixed; inset: 0; z-index: 3000;
  background: rgba(0, 0, 0, 0.55);
  display: flex; flex-direction: column; padding: 24px;
}
.html-fs-bar {
  display: flex; align-items: center; justify-content: space-between;
  color: #fff; padding: 0 4px 10px; font-size: 14px; font-weight: 600;
}
.html-fs iframe { flex: 1; width: 100%; border: 0; border-radius: 8px; background: #fff; }
.fs-close {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 13px;
  background: rgba(255, 255, 255, 0.14); color: #fff; border: 1px solid rgba(255, 255, 255, 0.35);
}
.fs-close:hover { background: rgba(255, 255, 255, 0.24); }
</style>
