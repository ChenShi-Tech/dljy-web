// ============================================================================
// stores/analysisData.ts — 数据分析用户产物前端 store（Phase 6 PR-B）
// ----------------------------------------------------------------------------
// pinia store：管理 /api/v1/analysis/* 的用户产物（视图配置/快照/标注）。
// 与 capturedData（只读回放缓存）并列——这里是「可写产物」，按公司+地区隔离，
// 切区清空（用户产物地区隔离，旧地区产物不可见）。
//
// 定位：store 是前端状态镜像（views/snapshots/annotations 列表 + loading/error），
// 真相在后端 analysis.sqlite。写入经 analysisClient → api.ts（统一信封+地区头+
// idempotency-key），读列表缓存到 store 供「我的视图」抽屉等消费。
// ============================================================================

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { currentRegion } from '../services/region/regionContext'
import * as analysisClient from '../services/analysisClient'
import type { AnalysisView, AnalysisSnapshot, AnalysisAnnotation, ViewConfig, AnnotationTargetType } from '../services/analysisClient'

export const useAnalysisStore = defineStore('analysisData', () => {
  const views = ref<AnalysisView[]>([])
  const snapshots = ref<AnalysisSnapshot[]>([])
  const annotations = ref<AnalysisAnnotation[]>([])
  /** 进行中请求去重（load 类） */
  const inflight = ref<Map<string, Promise<unknown>>>(new Map())
  const loading = ref(false)
  const error = ref('')

  async function loadViews(routePath?: string): Promise<void> {
    const key = `views|${routePath ?? ''}|${currentRegion.value.id}`
    const pending = inflight.value.get(key)
    if (pending) return pending as Promise<void>
    const regionAtCall = currentRegion.value.id // 捕获调用时地区（防切区后过期 resolve 污染）
    const p = (async () => {
      loading.value = true
      error.value = ''
      try {
        const rows = await analysisClient.listViews(routePath)
        // 切区守卫：resolve 时若地区已变（watch 已清空 views），丢弃过期结果
        if (currentRegion.value.id !== regionAtCall) return
        views.value = rows
      } catch (e) {
        if (currentRegion.value.id !== regionAtCall) return
        error.value = e instanceof Error ? e.message : '加载分析视图失败'
        views.value = []
      } finally {
        if (currentRegion.value.id === regionAtCall) loading.value = false
        inflight.value.delete(key)
      }
    })()
    inflight.value.set(key, p)
    return p
  }

  async function saveView(name: string, routePath: string, config: ViewConfig): Promise<AnalysisView> {
    const v = await analysisClient.saveView({ name, routePath, config })
    views.value = [v, ...views.value.filter((x) => x.viewId !== v.viewId)]
    return v
  }

  async function deleteView(viewId: string): Promise<void> {
    await analysisClient.deleteView(viewId)
    views.value = views.value.filter((x) => x.viewId !== viewId)
  }

  async function loadSnapshots(opts: { viewId?: string; routePath?: string } = {}): Promise<void> {
    // 切区守卫：await 期间若用户切区（watcher 已清空 snapshots），丢弃过期结果，防旧地区串读。
    const regionAtCall = currentRegion.value.id
    const rows = await analysisClient.listSnapshots(opts)
    if (currentRegion.value.id !== regionAtCall) return
    snapshots.value = rows
  }

  async function saveSnapshot(routePath: string, data: Record<string, unknown>, viewId?: string): Promise<AnalysisSnapshot> {
    const s = await analysisClient.saveSnapshot({ routePath, data, viewId })
    snapshots.value = [s, ...snapshots.value.filter((x) => x.snapshotId !== s.snapshotId)]
    return s
  }

  async function deleteSnapshot(snapshotId: string): Promise<void> {
    await analysisClient.deleteSnapshot(snapshotId)
    snapshots.value = snapshots.value.filter((x) => x.snapshotId !== snapshotId)
  }

  async function loadAnnotations(opts: { targetType?: AnnotationTargetType; targetRef?: string } = {}): Promise<void> {
    // 切区守卫：同 loadSnapshots，防 await 期间切区后旧地区响应污染当前地区。
    const regionAtCall = currentRegion.value.id
    const rows = await analysisClient.listAnnotations(opts)
    if (currentRegion.value.id !== regionAtCall) return
    annotations.value = rows
  }

  async function saveAnnotation(targetType: AnnotationTargetType, targetRef: string, content: string): Promise<AnalysisAnnotation> {
    const a = await analysisClient.saveAnnotation({ targetType, targetRef, content })
    annotations.value = [a, ...annotations.value.filter((x) => x.annotationId !== a.annotationId)]
    return a
  }

  async function deleteAnnotation(annotationId: string): Promise<void> {
    await analysisClient.deleteAnnotation(annotationId)
    annotations.value = annotations.value.filter((x) => x.annotationId !== annotationId)
  }

  // 切换地区时清空——用户产物按 (company_id, region) 隔离，旧地区产物不可见。
  // watch 注册在 store setup 内，store 首次实例化即生效（与 capturedData 同模式）。
  watch(
    () => currentRegion.value.id,
    () => {
      views.value = []
      snapshots.value = []
      annotations.value = []
      inflight.value.clear()
    }
  )

  return {
    views, snapshots, annotations, loading, error,
    loadViews, saveView, deleteView,
    loadSnapshots, saveSnapshot, deleteSnapshot,
    loadAnnotations, saveAnnotation, deleteAnnotation
  }
})
