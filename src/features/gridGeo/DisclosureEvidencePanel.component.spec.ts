// 守住披露证据与标注隔离：切换对象/公司不得被旧响应覆盖，冲突不得丢稿。dljy#2897。
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import DisclosureEvidencePanel from './DisclosureEvidencePanel.vue'
import type { GridDisclosureEvent } from './types'

const api = vi.hoisted(() => ({ detail: vi.fn(), manifest: vi.fn(), save: vi.fn() }))
vi.mock('./client', () => ({ fetchGridDisclosureEvent: api.detail, fetchGridGeoManifest: api.manifest, saveGridDisclosureOverlay: api.save }))

function event(id: string): GridDisclosureEvent {
  return {
    eventId: id, providerId: 'csg-authorized-export', category: 'outage', title: `事件 ${id}`, summary: '源记录停运事实',
    regionId: 'yunnan', spatialBinding: { kind: 'region', ref: 'yunnan', label: '云南', coordinates: null },
    businessDate: '2026-07-01', effectiveAt: '2026-07-01T12:00:00+08:00', expiresAt: null, publishedAt: null,
    sourceImportedAt: '2026-07-02T08:00:00+08:00', importedAt: '2026-09-09T08:00:00+08:00', confidence: 'verified-source-row',
    source: { file: 'source.csv', recordId: id, url: null, sourceTable: 'tb_disclosure_actual_unplanned_unit_outage', sourceType: 'IMPORT', mock: false, productionWrite: false, dataAvailability: 'available', license: '授权导出', originalLinkStatus: 'unavailable-in-export' },
  }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
function mountPanel(id = 'a') { return mount(DisclosureEvidencePanel, { props: { event: event(id), scopeKey: 'yunnan:company-a' } }) }

beforeEach(() => {
  vi.resetAllMocks()
  api.detail.mockImplementation(async (id: string) => ({ event: event(id), overlays: [] }))
  api.manifest.mockResolvedValue({ capabilities: { canWrite: false } })
})

describe('披露事件证据与协作', () => {
  it('没有来源发布时间和URL时明确留空，不用源入库时间或编译时间冒充', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.text()).toContain('未提供发布时间')
    expect(wrapper.findAll('a')).toHaveLength(0)
    expect(wrapper.text()).toContain('暂无设备坐标')
    wrapper.unmount()
  })

  it('更换对象后拒绝旧详情响应，个人笔记从新对象重新加载', async () => {
    const old = deferred<{ event: GridDisclosureEvent; overlays: never[] }>()
    api.detail.mockImplementationOnce(() => old.promise)
    const wrapper = mountPanel('a')
    await wrapper.setProps({ event: event('b') })
    await flushPromises()
    old.resolve({ event: event('a'), overlays: [] })
    await flushPromises()
    expect(wrapper.find('h3').text()).toBe('事件 b')
    expect(api.detail).toHaveBeenLastCalledWith('b', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    wrapper.unmount()
  })

  it('公司编辑权限未知或拒绝时只读，个人标注仍可保存', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('button.save').attributes('disabled')).toBeUndefined()
    await wrapper.findAll('.scope-tabs button')[1].trigger('click')
    expect(wrapper.find('fieldset').attributes('disabled')).toBeDefined()
    expect(wrapper.find('button.save').attributes('disabled')).toBeDefined()
    expect(api.save).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('提交既有版本号，冲突保留正在编辑的笔记并显示失败', async () => {
    api.detail.mockResolvedValue({ event: event('a'), overlays: [{ eventId: 'a', scope: 'user', favorite: true, note: '旧稿', tags: [], version: 4 }] })
    api.save.mockRejectedValue(new Error('标注版本冲突，请重新读取'))
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.find('textarea').setValue('新稿，不能静默覆盖')
    await wrapper.find('button.save').trigger('click')
    await flushPromises()
    expect(api.save).toHaveBeenCalledWith('a', expect.objectContaining({ scope: 'user', expectedVersion: 4, note: '新稿，不能静默覆盖' }))
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('新稿，不能静默覆盖')
    expect(wrapper.text()).toContain('标注版本冲突')
    wrapper.unmount()
  })

  it('切换公司后旧保存响应不能填入新公司表单', async () => {
    const pending = deferred<{ eventId: string; scope: string; favorite: boolean; note: string; tags: string[]; version: number }>()
    api.save.mockReturnValue(pending.promise)
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.find('textarea').setValue('公司A笔记')
    await wrapper.find('button.save').trigger('click')
    await wrapper.setProps({ scopeKey: 'yunnan:company-b' })
    await flushPromises()
    pending.resolve({ eventId: 'a', scope: 'user', favorite: false, note: '公司A笔记', tags: [], version: 1 })
    await flushPromises()
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.text()).not.toContain('已保存')
    wrapper.unmount()
  })

  it('保存个人收藏后同步卡片状态，下一次保存使用服务端新版本', async () => {
    api.save.mockImplementation(async (_id, payload) => ({ eventId: 'a', ...payload, version: payload.expectedVersion + 1 }))
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.find('textarea').setValue('跟踪已披露的有效时间')
    await wrapper.find('button.save').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('favorite-change')?.at(-1)).toEqual([{ eventId: 'a', favorite: true }])
    expect(wrapper.text()).toContain('已保存')
    await wrapper.find('button.save').trigger('click')
    await flushPromises()
    expect(api.save).toHaveBeenLastCalledWith('a', expect.objectContaining({ expectedVersion: 1, favorite: true }))
    wrapper.unmount()
  })

  it('父卡片回写收藏状态不重新加载同一详情，避免循环请求和清空表单', async () => {
    const host = defineComponent({
      setup() {
        const selected = ref(event('a'))
        return () => h(DisclosureEvidencePanel, {
          event: selected.value, scopeKey: 'yunnan:company-a',
          onFavoriteChange: (update: { favorite: boolean }) => { selected.value = { ...selected.value, personalFavorite: update.favorite } },
        })
      },
    })
    const wrapper = mount(host)
    await flushPromises()
    await wrapper.find('textarea').setValue('尚未提交的笔记')
    await flushPromises()
    expect(api.detail).toHaveBeenCalledTimes(1)
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('尚未提交的笔记')
    wrapper.unmount()
  })

  it.each(['actual', 'planned'] as const)('检修区间准确标注%s停复电时间，不展示源字段名称', async (basis) => {
    const prefix = basis === 'actual' ? '实际' : '计划'
    const item: GridDisclosureEvent = { ...event('a'), category: 'maintenance', expiresAt: '2026-07-03T19:00:00+08:00', timeQuality: { effective: 'source', published: 'unknown', intervalBasis: basis, issues: [] } }
    item.source.time = { startField: `${prefix}停电日期`, endField: `${prefix}复电时间` }
    api.detail.mockResolvedValue({ event: item, overlays: [] })
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.get('[data-testid="desk-interval-basis"]').text()).toBe(`${prefix}停复电区间`)
    expect(wrapper.get('.time-list').text()).toContain(`${prefix}停电`)
    expect(wrapper.get('.time-list').text()).toContain(`${prefix}复电`)
    expect(wrapper.get('.time-list').text()).not.toContain('开始依据字段')
    expect(wrapper.get('.time-list').text()).not.toContain('结束依据字段')
    expect(wrapper.get('.time-list').text()).toContain('2026/07/03')
    expect(wrapper.get('[data-testid="desk-interval-basis"]').text()).not.toContain(basis === 'actual' ? '计划' : '实际')
    wrapper.unmount()
  })

  it.each(['outage', 'intervention'] as const)('%s仅有源单点时不制造停复电范围或结束时刻', async (category) => {
    const item: GridDisclosureEvent = { ...event('a'), category, timeQuality: { effective: 'source', published: 'unknown', intervalBasis: 'point', issues: [] } }
    item.source.time = { startField: '干预时刻', endField: null }
    api.detail.mockResolvedValue({ event: item, overlays: [] })
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.get('[data-testid="desk-interval-basis"]').text()).toBe('仅已知单点，结束时间未提供')
    expect(wrapper.get('.time-list').text()).not.toContain('开始依据字段')
    expect(wrapper.get('.time-list').text()).not.toContain('结束依据字段')
    expect(wrapper.get('.time-list').text()).not.toContain('停复电区间')
    const end = wrapper.findAll('.time-list dl > div').find((row) => row.find('dt').text() === '结束时间')!
    expect(end.find('dd').text()).toBe('未提供')
    wrapper.unmount()
  })

  it('干预等完整source区间采用通用有效区间措辞', async () => {
    api.detail.mockResolvedValue({ event: { ...event('a'), category: 'intervention', expiresAt: '2026-07-01T13:00:00+08:00', timeQuality: { effective: 'source', published: 'unknown', intervalBasis: 'source', issues: [] } }, overlays: [] })
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.get('[data-testid="desk-interval-basis"]').text()).toBe('来源有效区间')
    expect(wrapper.get('.time-list').text()).not.toContain('停复电')
    wrapper.unmount()
  })

  it('仅业务日检修保持区间待核验，入库时间不补作停电时间', async () => {
    api.detail.mockResolvedValue({ event: { ...event('a'), category: 'maintenance', effectiveAt: null, timeQuality: { effective: 'business-date', published: 'unknown', intervalBasis: 'unknown', issues: [] } }, overlays: [] })
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.get('[data-testid="desk-interval-basis"]').text()).toBe('有效区间待核验')
    const start = wrapper.findAll('.time-list dl > div').find((row) => row.find('dt').text() === '生效时间')!
    expect(start.find('dd').text()).toBe('未提供')
    expect(wrapper.get('.time-list').text()).not.toContain('停复电区间')
    wrapper.unmount()
  })
})
