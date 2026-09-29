// 套保工作台共享状态单测（HW-05/06/10；#3420）：页签依赖的作用域判定、只读与横幅语义。
import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { get value() { return { id: 'yunnan' } } },
}))

vi.mock('@/services/company/companyContext', async () => {
  const { ref } = await import('vue')
  return { selectedCompanyId: ref('comp-a') }
})

import { createHedgeWorkbench } from './useHedgeWorkbench'
import { selectedCompanyId } from '@/services/company/companyContext'

const scopes: Array<ReturnType<typeof effectScope>> = []
function create() {
  const scope = effectScope()
  scopes.push(scope)
  const workbench = scope.run(() => createHedgeWorkbench())
  if (!workbench) throw new Error('未创建工作台共享状态')
  return workbench
}

describe('createHedgeWorkbench', () => {
  afterEach(() => {
    while (scopes.length) scopes.pop()?.stop()
    selectedCompanyId.value = 'comp-a'
  })

  it('切公司后切回同一家公司，切换前发出的请求仍判为过期（会话代次，HW-06）', () => {
    const workbench = create()
    const current = workbench.scopedRequest()
    expect(current()).toBe(true)
    selectedCompanyId.value = 'comp-b'
    expect(current()).toBe(false)
    selectedCompanyId.value = 'comp-a'
    // 作用域键已与发起时相同，只有代次能识别出这是切换前的旧请求。
    expect(current()).toBe(false)
    expect(workbench.scopedRequest()()).toBe(true)
  })

  it('认知时点或粒度变化让在途请求过期，上下文键只随公司/地区变化', () => {
    const workbench = create()
    const contextBefore = workbench.contextKey.value
    const byAsOf = workbench.scopedRequest()
    workbench.asOfInput.value = '2026-09-01T00:00:00+08:00'
    expect(byAsOf()).toBe(false)
    expect(workbench.asOf.value).toBe('2026-09-01T00:00:00+08:00')
    const byGranularity = workbench.scopedRequest()
    workbench.granularity.value = 'DAY'
    expect(byGranularity()).toBe(false)
    expect(workbench.contextKey.value).toBe(contextBefore)
    selectedCompanyId.value = 'comp-b'
    expect(workbench.contextKey.value).not.toBe(contextBefore)
  })

  it('历史视角横幅按已同步的认知时点显示；清空时点后需再次同步才收起（HW-05）', () => {
    const workbench = create()
    workbench.asOfInput.value = '2026-09-01'
    expect(workbench.showAsOfBanner.value).toBe(false)
    workbench.syncAsOfBanner()
    expect(workbench.showAsOfBanner.value).toBe(true)
    workbench.clearAsOf()
    expect(workbench.asOf.value).toBeNull()
    expect(workbench.showAsOfBanner.value).toBe(true)
    workbench.syncAsOfBanner()
    expect(workbench.showAsOfBanner.value).toBe(false)
  })

  it('403 后转只读；写入通知递增修订号（HW-10）', () => {
    const workbench = create()
    expect(workbench.canWrite.value).toBe(true)
    workbench.markReadOnly()
    expect(workbench.canWrite.value).toBe(false)
    const before = workbench.dataRevision.value
    workbench.notifyDataChanged()
    expect(workbench.dataRevision.value).toBe(before + 1)
  })
})
