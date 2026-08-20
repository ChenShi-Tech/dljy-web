<template>
  <div class="atelier-root">
    <transition name="skin" mode="out-in">
      <component :is="active" :key="style + '-' + view" />
    </transition>

    <!-- 悬浮切换坞 -->
    <div class="dock" :class="{ collapsed }">
      <button class="toggle serif" @click="collapsed = !collapsed" :title="collapsed ? '展开' : '收起'">
        {{ collapsed ? '◑ 风格' : '×' }}
      </button>

      <template v-if="!collapsed">
        <span class="series serif">质朴的未来</span>
        <div class="sep" />
        <div class="grp view">
          <button :class="{ on: view === 'overview' }" @click="view = 'overview'">总览</button>
          <button :class="{ on: view === 'ai' }" @click="view = 'ai'">智能体协作</button>
        </div>
        <div class="sep" />
        <div class="grp">
          <button v-for="s in styles" :key="s.id" :disabled="!s.ready" :class="{ on: style === s.id }" @click="s.ready && (style = s.id)">
            {{ s.name }}<i v-if="!s.ready">即将</i>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TiangongOverview from '../tiangong/TiangongOverview.vue'
import TiangongAi from '../tiangong/TiangongAi.vue'
import BronzeOverview from '../bronze/BronzeOverview.vue'
import BronzeAi from '../bronze/BronzeAi.vue'
import BlancOverview from '../blanc/BlancOverview.vue'
import BlancAi from '../blanc/BlancAi.vue'

const styles = [
  { id: 'tiangong', name: '天工', ready: true },
  { id: 'bronze', name: '青铜仪器', ready: true },
  { id: 'blanc', name: '素白瓷', ready: true },
]
const registry: Record<string, any> = {
  'tiangong-overview': TiangongOverview, 'tiangong-ai': TiangongAi,
  'bronze-overview': BronzeOverview, 'bronze-ai': BronzeAi,
  'blanc-overview': BlancOverview, 'blanc-ai': BlancAi,
}
const readyIds = styles.filter(s => s.ready).map(s => s.id)

const route = useRoute()
const router = useRouter()
const qStyle = typeof route.query.style === 'string' && readyIds.includes(route.query.style) ? route.query.style : 'tiangong'
const qView = route.query.view === 'ai' ? 'ai' : 'overview'

const style = ref(qStyle)
const view = ref(qView)
const collapsed = ref(false)

const active = computed(() => registry[`${style.value}-${view.value}`] ?? TiangongOverview)

watch([style, view], () => {
  router.replace({ query: { style: style.value, view: view.value } }).catch(() => {})
})
onMounted(() => {
  if (!route.query.style) router.replace({ query: { style: style.value, view: view.value } }).catch(() => {})
})
</script>

<style scoped>
.atelier-root { position: fixed; inset: 0; }

.dock {
  position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 99999;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-radius: 13px;
  background: rgba(26, 23, 19, .9); backdrop-filter: blur(14px) saturate(140%);
  border: 1px solid rgba(201, 163, 91, .26);
  box-shadow: 0 14px 44px rgba(28, 20, 8, .42);
  font-family: -apple-system, 'PingFang SC', sans-serif;
}
.dock.collapsed { padding: 6px; gap: 0; }
.serif { font-family: 'Songti SC', 'STSong', 'Source Han Serif SC', Georgia, serif; }
.toggle {
  border: none; cursor: pointer; background: rgba(201, 163, 91, .16); color: #F4EBD8;
  font-size: var(--font-md); padding: 7px 13px; border-radius: 8px; letter-spacing: 1px;
}
.toggle:hover { background: rgba(201, 163, 91, .28); }
.series { color: #C9A35B; font-size: var(--font-md); letter-spacing: 2px; padding: 0 2px; }

.grp { display: flex; align-items: center; gap: 4px; }
.sep { width: 1px; height: 22px; background: rgba(201, 163, 91, .22); margin: 0 3px; }

.grp button {
  position: relative; border: none; cursor: pointer; background: transparent; color: rgba(244, 235, 216, .62);
  font-size: var(--font-md); padding: 7px 13px; border-radius: 8px; font-family: inherit; transition: all .18s; white-space: nowrap;
}
.grp button:hover:not(:disabled) { color: #fff; background: rgba(201, 163, 91, .12); }
.grp button.on { background: #C9A35B; color: #1A1713; font-weight: 600; }
.grp button:disabled { color: rgba(244, 235, 216, .3); cursor: not-allowed; }
.grp button i { font-style: normal; font-size: var(--font-9); margin-left: 5px; padding: 1px 5px; border-radius: 5px; background: rgba(244, 235, 216, .12); color: rgba(244, 235, 216, .5); vertical-align: middle; }

.skin-enter-active, .skin-leave-active { transition: opacity .26s ease; }
.skin-enter-from, .skin-leave-to { opacity: 0; }
</style>
