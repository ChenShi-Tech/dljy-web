// ============================================================================
// stores/capturedData.ts — 只读回放数据的前端内存缓存（Phase 0）
// ----------------------------------------------------------------------------
// pinia store：缓存经 fetchCaptured 回放的「只读派生数据」，按 family|match|region 为键
// 去重 + inflight 合并 + 切区自动失效，消灭 sdpt_zcqxhdl 等 family 被 5+ 页各自重复取数。
//
// 定位（重要）：本 store 不是「数据真相来源」，只是域A capture-raw/capture.sqlite 与域B
// Parquet 在前端的易失缓存镜像——可随时清空重建（invalidate/refresh 从后端重取）。真相
// 在后端持久层（见 docs/data/data-layer-unification.md「数据存储架构根基」）。
//
// Phase 0 提供缓存能力；Phase 4 起页面经 useCaptured() composable 消费，替换 27 处直调
// fetchCaptured。缓存项的 basis/sourceType 诚实标注留待 Phase 2 信封归一后填充。
// ============================================================================

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { currentRegion } from '../services/region/regionContext'
import { fetchCaptured } from '../services/captured'
import type { DataSourceBasis } from '../services/data/types'

type CacheEntry = {
  data: unknown
  basis?: DataSourceBasis
  loadedAt: number
  region: string
}

function keyOf(family: string, match: string | undefined, region: string): string {
  return `${family}|${match ?? ''}|${region}`
}

export const useCapturedDataStore = defineStore('capturedData', () => {
  /** 已就绪缓存：key(family|match|region) → 条目 */
  const cache = ref<Map<string, CacheEntry>>(new Map())
  /** 进行中请求：key → Promise，用于 inflight 去重（同 key 并发只发一次） */
  const inflight = ref<Map<string, Promise<unknown>>>(new Map())

  function currentKey(family: string, match: string | undefined): string {
    return keyOf(family, match, currentRegion.value.id)
  }

  /**
   * 取回放数据（带缓存 + inflight 去重）。命中缓存直接返回；否则发请求，同 key 并发
   * 共享同一个 Promise。force=true 时先丢弃该键缓存与 inflight 命中，强制重取。
   * 失败时清除 inflight 并向上抛，不污染缓存。
   */
  async function loadCaptured<T = unknown>(family: string, match?: string, force = false): Promise<T> {
    const key = currentKey(family, match)
    if (force) {
      cache.value.delete(key)
    } else {
      const cached = cache.value.get(key)
      if (cached) return cached.data as T
      const pending = inflight.value.get(key)
      if (pending) return pending as Promise<T>
    }

    const promise = fetchCaptured<T>(family, match)
      .then((data) => {
        cache.value.set(key, { data, loadedAt: Date.now(), region: currentRegion.value.id })
        inflight.value.delete(key)
        return data
      })
      .catch((err) => {
        inflight.value.delete(key)
        throw err
      })
    inflight.value.set(key, promise)
    return promise
  }

  /** 丢弃单个键的缓存（不影响该地区其他 family）。 */
  function drop(family: string, match?: string): void {
    cache.value.delete(currentKey(family, match))
  }

  /** 失效缓存：不传 region 清全部；传 region 只清该地区条目（key 以 |region 结尾）。 */
  function invalidate(region?: string): void {
    if (!region) {
      cache.value.clear()
      return
    }
    for (const key of cache.value.keys()) {
      if (key.endsWith(`|${region}`)) cache.value.delete(key)
    }
  }

  /** 是否已缓存（命中即不触发请求）。 */
  function has(family: string, match?: string): boolean {
    return cache.value.has(currentKey(family, match))
  }

  // 切换地区时立即清缓存——回放数据地区隔离，旧地区数据不可复用。
  // watch 注册在 store setup 内，store 首次实例化（app 挂 pinia 后）即生效。
  watch(
    () => currentRegion.value.id,
    () => {
      cache.value.clear()
      inflight.value.clear()
    }
  )

  return { cache, loadCaptured, drop, invalidate, has }
})
