// 模板实例探针纯逻辑测试（node 环境；传输层在 templateInstanceClient，不进 node 测试）
import { describe, expect, it } from 'vitest'
import {
  classifyInstanceError,
  classifyInstanceResponse,
  FEED_ABSENT_NOTE,
  toTodoViews,
  type TemplateInstanceSummary
} from './templateInstanceApi'

const inst = (over: Partial<TemplateInstanceSummary> = {}): TemplateInstanceSummary => ({
  id: 'i1',
  templateId: 'T01',
  periodKey: '2026-08-14',
  status: 'pending',
  dueAt: null,
  updatedAt: null,
  ...over
})

describe('classifyInstanceResponse（能力探针四态）', () => {
  it('404/405 → 触发引擎未上线', () => {
    expect(classifyInstanceResponse(404, null)).toEqual({ available: false, reason: 'endpoint-absent' })
    expect(classifyInstanceResponse(405, null)).toEqual({ available: false, reason: 'endpoint-absent' })
  })

  it('401/403 → 无权限（与未上线区分：可提示联系管理员）', () => {
    expect(classifyInstanceResponse(401, null)).toEqual({ available: false, reason: 'unauthorized' })
    expect(classifyInstanceResponse(403, null)).toEqual({ available: false, reason: 'unauthorized' })
  })

  it('200 + 裸数组 / {data} / {instances} 三种信封均可提取', () => {
    const row = { id: 'a', template_id: 'T01', period_key: '2026-08-14', status: 'pending' }
    for (const body of [[row], { data: [row] }, { instances: [row] }]) {
      const feed = classifyInstanceResponse(200, body)
      expect(feed).toMatchObject({ available: true })
      if (feed.available) {
        expect(feed.instances).toHaveLength(1)
        expect(feed.instances[0]).toMatchObject({ id: 'a', templateId: 'T01', status: 'pending', dueAt: null })
      }
    }
  })

  it('200 + 空列表 = 引擎在线但无待办（不是未上线）', () => {
    const feed = classifyInstanceResponse(200, { data: [] })
    expect(feed).toEqual({ available: true, instances: [] })
  })

  it('200 但形态不符（静态托管 HTML 兜底/null）→ 视为未上线，不把垃圾当空列表', () => {
    expect(classifyInstanceResponse(200, '<!doctype html>')).toEqual({ available: false, reason: 'endpoint-absent' })
    expect(classifyInstanceResponse(200, null)).toEqual({ available: false, reason: 'endpoint-absent' })
    // 行存在但字段全不合法 → 同样降级（宁降级不误读）
    expect(classifyInstanceResponse(200, { data: [{ nope: 1 }] })).toEqual({ available: false, reason: 'endpoint-absent' })
  })

  it('503/500 → 端点在但暂不可用（可重试）', () => {
    expect(classifyInstanceResponse(503, { detail: 'data_unavailable' })).toEqual({ available: false, reason: 'unreachable' })
  })

  it('网络异常统一归 unreachable', () => {
    expect(classifyInstanceError(new TypeError('Failed to fetch'))).toEqual({ available: false, reason: 'unreachable' })
  })

  it('未上线文案不带假分母承诺', () => {
    expect(FEED_ABSENT_NOTE).toContain('不拿假分母')
  })
})

describe('toTodoViews（待办排序与逾期推导）', () => {
  const NOW = '2026-08-15T08:00:00+08:00'

  it('只收 pending/draft；submitted/reviewed 不是待办', () => {
    const views = toTodoViews(
      [inst({ id: 'p', status: 'pending' }), inst({ id: 's', status: 'submitted' }), inst({ id: 'r', status: 'reviewed' }), inst({ id: 'd', status: 'draft' })],
      NOW
    )
    expect(views.map((v) => v.id)).toEqual(['p', 'd'])
  })

  it('截止越早越前，无时限沉底；逾期（dueAt < now）标红位', () => {
    const views = toTodoViews(
      [
        inst({ id: 'none', dueAt: null }),
        inst({ id: 'late', dueAt: '2026-08-16T18:00:00+08:00' }),
        inst({ id: 'overdue', dueAt: '2026-08-15T06:00:00+08:00' }),
        inst({ id: 'soon', dueAt: '2026-08-15T12:00:00+08:00' })
      ],
      NOW
    )
    expect(views.map((v) => v.id)).toEqual(['overdue', 'soon', 'late', 'none'])
    expect(views.find((v) => v.id === 'overdue')?.overdue).toBe(true)
    expect(views.find((v) => v.id === 'soon')?.overdue).toBe(false)
    expect(views.find((v) => v.id === 'none')?.overdue).toBe(false)
  })

  it('同截止按 updatedAt 新者在前；非法日期串按无时限处理不抛', () => {
    const views = toTodoViews(
      [
        inst({ id: 'old', dueAt: '2026-08-16T18:00:00+08:00', updatedAt: '2026-08-14T09:00:00+08:00' }),
        inst({ id: 'new', dueAt: '2026-08-16T18:00:00+08:00', updatedAt: '2026-08-15T07:00:00+08:00' }),
        inst({ id: 'bad-date', dueAt: 'not-a-date' })
      ],
      NOW
    )
    expect(views.map((v) => v.id)).toEqual(['new', 'old', 'bad-date'])
    expect(views.find((v) => v.id === 'bad-date')?.overdue).toBe(false)
  })
})
