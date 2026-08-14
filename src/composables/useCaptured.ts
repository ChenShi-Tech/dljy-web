// ============================================================================
// composables/useCaptured.ts — 回放数据获取 composable（Phase 0）
// ----------------------------------------------------------------------------
// 包装 capturedData pinia store，供页面以响应式 {data,loading,error,load,refresh} 形态
// 消费回放数据，自动享缓存 + inflight 去重 + 切区失效。Phase 4 起替换页面直调 fetchCaptured。
//
// 基础形态（Phase 0）：调用方在 onMounted 内调 load()；refresh() 强制重取当前 family
// （仅丢弃该键缓存，不影响同地区其他 family）。Phase 4 接入时可与 useRegionReload
// 的 onRegionChange 组合实现切区自动重载（切区时 store 已整体清缓存）。
//
// data 用 shallowRef：回放数据常为大对象/数组，整体替换即可，无需深响应解包。
// ============================================================================

import { ref, shallowRef, type Ref } from 'vue'
import { useCapturedDataStore } from '../stores/capturedData'

export type UseCapturedResult<T> = {
  data: Ref<T | null>
  loading: Ref<boolean>
  error: Ref<string>
  load: () => Promise<void>
  /** 强制重取当前 family|match|region（仅丢弃该键缓存）。 */
  refresh: () => Promise<void>
}

export function useCaptured<T = unknown>(family: string, match?: string): UseCapturedResult<T> {
  const store = useCapturedDataStore()
  const data = shallowRef<T | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function load(force = false): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      data.value = await store.loadCaptured<T>(family, match, force)
    } catch (e) {
      data.value = null
      error.value = e instanceof Error ? e.message : '加载失败'
    } finally {
      loading.value = false
    }
  }

  return {
    data,
    loading,
    error,
    load: () => load(false),
    refresh: () => load(true)
  }
}
