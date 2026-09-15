import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { routeLocationKey } from 'vue-router'
import { currentRegion } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { todayBeijing } from '@/utils/beijingDate'
import { fetchGridObject } from './client'
import { hasGridObjectQuery, readGridObjectQuery, readGridObjectWindow, validObjectDate, type GridObjectDetail } from './objectNavigation'

export function useGridObjectContext() {
  const route = inject(routeLocationKey, null)
  const pagePath = route?.path
  const active = computed(() => Boolean(route) && route?.path === pagePath)
  // KeepAlive pages retain their own context while another route is visible.
  const query = shallowRef(route?.query ?? {})
  watch(() => route?.fullPath, () => { if (active.value) query.value = route?.query ?? {} })
  const hasContext = computed(() => hasGridObjectQuery(query.value))
  const reference = computed(() => readGridObjectQuery(query.value, { regionId: currentRegion.value.id, companyId: selectedCompanyId.value }))
  const date = computed(() => validObjectDate(query.value.objectDate) ? query.value.objectDate : todayBeijing())
  const timeWindow = computed(() => readGridObjectWindow(query.value))
  const detail = shallowRef<GridObjectDetail | null>(null)
  const loading = ref(false), error = ref('')
  let epoch = 0
  watch(() => [active.value, JSON.stringify(query.value), currentRegion.value.id, selectedCompanyId.value], async () => {
    const request = ++epoch
    detail.value = null; loading.value = false; error.value = ''
    if (!active.value || !hasContext.value) return
    const target = reference.value
    if (!target) { error.value = '对象关联与当前公司或地区不一致，请返回原页面或清除关联后查看。'; return }
    loading.value = true
    try {
      const result = await fetchGridObject(target)
      if (request !== epoch) return
      if (result.reference.regionId !== target.regionId || result.reference.kind !== target.kind || result.reference.id !== target.id) throw new Error('对象身份校验失败')
      detail.value = result
    } catch (cause) { if (request === epoch) error.value = cause instanceof Error ? cause.message : '对象关联读取失败' }
    finally { if (request === epoch) loading.value = false }
  }, { immediate: true })
  onBeforeUnmount(() => { epoch++ })
  return { reference, detail, date, timeWindow, error, loading, hasContext, active }
}
