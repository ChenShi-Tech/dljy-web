<template>
  <div class="showcase-root">
    <!-- 当前风格 × 视图 -->
    <transition name="skin" mode="out-in">
      <component :is="active" :key="style + '-' + view" />
    </transition>

    <!-- 悬浮切换坞 -->
    <div class="dock" :class="{ collapsed }">
      <button class="toggle" @click="collapsed = !collapsed" :title="collapsed ? '展开切换器' : '收起'">
        {{ collapsed ? '◑ 风格' : '×' }}
      </button>

      <template v-if="!collapsed">
        <div class="grp view">
          <button :class="{ on: view === 'overview' }" @click="view = 'overview'">总览</button>
          <button :class="{ on: view === 'ai' }" @click="view = 'ai'">AI 分析</button>
        </div>

        <div class="sep" />

        <div class="grp">
          <span class="cap">暗</span>
          <button v-for="s in darkStyles" :key="s.id" :class="{ on: style === s.id }" @click="style = s.id">{{ s.name }}</button>
        </div>

        <div class="grp">
          <span class="cap">暖</span>
          <button v-for="s in lightStyles" :key="s.id" :class="{ on: style === s.id }" @click="style = s.id">{{ s.name }}</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import NeonOverview from '../neon/NeonOverview.vue'
import NeonAi from '../neon/NeonAi.vue'
import GlassOverview from '../glass/GlassOverview.vue'
import GlassAi from '../glass/GlassAi.vue'
import HudOverview from '../hud/HudOverview.vue'
import HudAi from '../hud/HudAi.vue'
import PaperOverview from '../paper/PaperOverview.vue'
import PaperAi from '../paper/PaperAi.vue'
import SwissOverview from '../swiss/SwissOverview.vue'
import SwissAi from '../swiss/SwissAi.vue'
import SageOverview from '../sage/SageOverview.vue'
import SageAi from '../sage/SageAi.vue'

const darkStyles = [
  { id: 'neon', name: '霓虹' },
  { id: 'glass', name: '玻璃' },
  { id: 'hud', name: 'HUD' },
]
const lightStyles = [
  { id: 'paper', name: '暖纸' },
  { id: 'swiss', name: '瑞士' },
  { id: 'sage', name: '柔彩' },
]
const allIds = [...darkStyles, ...lightStyles].map(s => s.id)

const registry: Record<string, any> = {
  'neon-overview': NeonOverview, 'neon-ai': NeonAi,
  'glass-overview': GlassOverview, 'glass-ai': GlassAi,
  'hud-overview': HudOverview, 'hud-ai': HudAi,
  'paper-overview': PaperOverview, 'paper-ai': PaperAi,
  'swiss-overview': SwissOverview, 'swiss-ai': SwissAi,
  'sage-overview': SageOverview, 'sage-ai': SageAi,
}

const route = useRoute()
const router = useRouter()

const qStyle = typeof route.query.style === 'string' && allIds.includes(route.query.style) ? route.query.style : 'paper'
const qView = route.query.view === 'ai' ? 'ai' : 'overview'

const style = ref(qStyle)
const view = ref(qView)
const collapsed = ref(false)

const active = computed(() => registry[`${style.value}-${view.value}`] ?? PaperOverview)

// 切换时同步到 URL,便于分享/深链
watch([style, view], () => {
  router.replace({ query: { style: style.value, view: view.value } }).catch(() => {})
})

onMounted(() => {
  if (!route.query.style) router.replace({ query: { style: style.value, view: view.value } }).catch(() => {})
})
</script>

<style scoped>
.showcase-root { position: fixed; inset: 0; }

.dock {
  position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 99999;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 14px;
  background: rgba(20, 20, 24, .82); backdrop-filter: blur(14px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, .14);
  box-shadow: 0 12px 40px rgba(0, 0, 0, .4);
  font-family: 'Inter', -apple-system, 'PingFang SC', sans-serif;
}
.dock.collapsed { padding: 6px; gap: 0; }
.toggle {
  border: none; cursor: pointer; background: rgba(255, 255, 255, .12); color: #fff;
  font-size: var(--font-12-5); padding: 7px 12px; border-radius: 9px; font-family: inherit;
}
.toggle:hover { background: rgba(255, 255, 255, .2); }

.grp { display: flex; align-items: center; gap: 4px; }
.grp.view button.on { background: #fff; color: #18181b; }
.cap { font-size: var(--font-10); color: rgba(255, 255, 255, .42); margin: 0 4px 0 2px; letter-spacing: 1px; }
.sep { width: 1px; height: 22px; background: rgba(255, 255, 255, .16); margin: 0 4px; }

.grp button {
  border: none; cursor: pointer; background: transparent; color: rgba(255, 255, 255, .62);
  font-size: var(--font-12-5); padding: 7px 12px; border-radius: 9px; font-family: inherit; transition: all .18s;
  white-space: nowrap;
}
.grp button:hover { color: #fff; background: rgba(255, 255, 255, .1); }
.grp button.on { background: rgba(255, 255, 255, .92); color: #18181b; font-weight: 500; }

/* 风格切换转场 */
.skin-enter-active, .skin-leave-active { transition: opacity .22s ease; }
.skin-enter-from, .skin-leave-to { opacity: 0; }
</style>
