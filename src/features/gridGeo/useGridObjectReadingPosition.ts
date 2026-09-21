import { inject, nextTick, onActivated } from 'vue'
import { onBeforeRouteLeave, routeLocationKey } from 'vue-router'
import { currentRegion } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'

const positions = new Map<string, number>()
/** Each cached spatial page restores its own company/region/route reading position. */
export function useGridObjectReadingPosition() {
  const route = inject(routeLocationKey, null)
  if (!route) return
  const pagePath = route.path
  const key = (fullPath: string) => `${currentRegion.value.id}:${selectedCompanyId.value}:${fullPath}`
  onBeforeRouteLeave((_to, from) => {
    positions.set(key(from.fullPath), document.querySelector<HTMLElement>('.page-shell')?.scrollTop ?? 0)
    if (positions.size > 100) positions.delete(positions.keys().next().value!)
  })
  onActivated(async () => {
    const fullPath = route.fullPath, scopeKey = key(fullPath)
    await nextTick()
    if (route.path !== pagePath || route.fullPath !== fullPath || key(fullPath) !== scopeKey) return
    const shell = document.querySelector<HTMLElement>('.page-shell')
    if (shell) shell.scrollTop = positions.get(scopeKey) ?? 0
  })
}
