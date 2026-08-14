<script setup lang="ts">
// B1 命令面板（Cmd/Ctrl+K）：全局快速跳转。
// 复用 navigation + filterNavigationForUser（角色）+ isPathAvailableInRegion（地区）过滤，
// 仅展示当前用户在当前地区可访问的真实路由（顶级合成分组不进面板）。
// 最近访问 + 收藏持久化到 localStorage（跨刷新）。
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Star, CornerDownLeft, ArrowUp, ArrowDown } from 'lucide-vue-next'
import { navigation, type NavItem } from '@/data/navigation'
import {
  filterNavigationForUser,
  isPathAvailableInRegion,
  type NavigationLike
} from '@/services/governance'
import { currentRegion } from '@/services/region/regionContext'
import type { AuthUser } from '@/services/auth'

type CmdEntry = { path: string; title: string; group: string }

const props = defineProps<{ modelValue: boolean; user: AuthUser | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const router = useRouter()
const query = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const RECENT_KEY = 'dljy.cmdk.recent'
const FAV_KEY = 'dljy.cmdk.favorites'
const RECENT_MAX = 8

function close() {
  emit('update:modelValue', false)
}

// 扁平化：取每个顶级分组下子项（真实路由），记录分组标题
const allEntries = computed<CmdEntry[]>(() => {
  const regionId = currentRegion.value.id
  const filtered = filterNavigationForUser(
    navigation as NavigationLike[],
    props.user,
    regionId
  )
  const out: CmdEntry[] = []
  for (const group of filtered) {
    const groupTitle = group.title
    const kids = filterNavigationForUser(group.children ?? [], props.user, regionId)
    for (const child of kids) {
      if (!child.path) continue
      if (!isPathAvailableInRegion(child.path, regionId)) continue
      out.push({ path: child.path, title: child.title, group: groupTitle })
    }
  }
  return out
})

function readArr(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}
function writeArr(key: string, vals: string[]) {
  localStorage.setItem(key, JSON.stringify(vals))
}

const recentPaths = ref<string[]>(readArr(RECENT_KEY))
const favoritePaths = ref<string[]>(readArr(FAV_KEY))

function toggleFavorite(path: string) {
  const set = new Set(favoritePaths.value)
  if (set.has(path)) set.delete(path)
  else set.add(path)
  favoritePaths.value = [...set]
  writeArr(FAV_KEY, favoritePaths.value)
}

function byPath(paths: string[]): CmdEntry[] {
  const map = new Map(allEntries.value.map((e) => [e.path, e]))
  return paths.map((p) => map.get(p)).filter((e): e is CmdEntry => !!e)
}

const results = computed<CmdEntry[]>(() => {
  const q = query.value.trim().toLowerCase()
  const favs = byPath(favoritePaths.value)
  if (!q) {
    // 无搜索词：收藏 + 最近访问 + 全部
    const recent = byPath(recentPaths.value)
    const seen = new Set<string>([...favs.map((e) => e.path), ...recent.map((e) => e.path)])
    const rest = allEntries.value.filter((e) => !seen.has(e.path))
    return [...favs, ...recent, ...rest]
  }
  const matched = allEntries.value.filter(
    (e) => e.title.toLowerCase().includes(q) || e.path.toLowerCase().includes(q)
  )
  // 命中项里收藏/最近优先
  const favSet = new Set(favoritePaths.value)
  return matched.sort((a, b) => {
    const af = favSet.has(a.path) ? 0 : 1
    const bf = favSet.has(b.path) ? 0 : 1
    return af - bf
  })
})

watch(results, () => {
  activeIndex.value = 0
})

function recordRecent(path: string) {
  const next = [path, ...recentPaths.value.filter((p) => p !== path)].slice(0, RECENT_MAX)
  recentPaths.value = next
  writeArr(RECENT_KEY, next)
}

function go(entry: CmdEntry) {
  recordRecent(entry.path)
  router.push(entry.path)
  close()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const target = results.value[activeIndex.value]
    if (target) go(target)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

// 打开时聚焦输入框、清空搜索
watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      query.value = ''
      activeIndex.value = 0
      await nextTick()
      inputRef.value?.focus()
    }
  }
)
</script>

<template>
  <Teleport to="body">
    <transition name="cmdk-fade">
      <div v-if="modelValue" class="cmdk-mask" @click.self="close">
        <div class="cmdk-box" role="dialog" aria-modal="true" aria-label="命令面板">
          <div class="cmdk-input-wrap">
            <Search :size="16" />
            <input
              ref="inputRef"
              v-model="query"
              class="cmdk-input"
              placeholder="搜索页面跳转…（↑↓ 选择，Enter 跳转，Esc 关闭）"
              @keydown="onKeydown"
            />
          </div>
          <ul class="cmdk-list">
            <li
              v-for="(e, i) in results"
              :key="e.path"
              class="cmdk-item"
              :class="{ active: i === activeIndex }"
              @mouseenter="activeIndex = i"
              @click="go(e)"
            >
              <span class="cmdk-title">{{ e.title }}</span>
              <span class="cmdk-group">{{ e.group }}</span>
              <button
                class="cmdk-fav"
                :class="{ on: favoritePaths.includes(e.path) }"
                title="收藏"
                @click.stop="toggleFavorite(e.path)"
              >
                <Star :size="13" :fill="favoritePaths.includes(e.path) ? 'currentColor' : 'none'" />
              </button>
            </li>
            <li v-if="!results.length" class="cmdk-empty">无匹配页面</li>
          </ul>
          <div class="cmdk-foot">
            <span><CornerDownLeft :size="12" /> 跳转</span>
            <span><ArrowUp :size="12" /><ArrowDown :size="12" /> 选择</span>
            <span>Esc 关闭</span>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.cmdk-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
  z-index: 3000;
}
.cmdk-box {
  width: min(560px, 92vw);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border, #e4e7ed);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}
.cmdk-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border, #e4e7ed);
  color: var(--text-muted, #909399);
}
.cmdk-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 15px;
  background: transparent;
  color: var(--text, #303133);
}
.cmdk-list {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  flex: 1;
}
.cmdk-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text, #303133);
}
.cmdk-item.active {
  background: var(--primary-bg, #ecf5ff);
}
.cmdk-title {
  flex: 1;
  font-size: 14px;
}
.cmdk-group {
  font-size: 12px;
  color: var(--text-muted, #a8abb2);
}
.cmdk-fav {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-muted, #c0c4cc);
  padding: 2px;
  display: inline-flex;
}
.cmdk-fav.on {
  color: #f7ba2a;
}
.cmdk-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-muted, #909399);
  font-size: 13px;
}
.cmdk-foot {
  display: flex;
  gap: 16px;
  padding: 8px 14px;
  border-top: 1px solid var(--border, #e4e7ed);
  font-size: 12px;
  color: var(--text-muted, #a8abb2);
}
.cmdk-foot span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.cmdk-fade-enter-active,
.cmdk-fade-leave-active {
  transition: opacity 0.12s ease;
}
.cmdk-fade-enter-from,
.cmdk-fade-leave-to {
  opacity: 0;
}
@media (max-width: 768px) {
  .cmdk-box {
    width: 94vw;
  }
}
</style>
