// 复盘完成度统计（reviewCompletion）不变量锁：覆盖率分母只数「当月∩覆盖窗∩≤今天」，
// 填写率分母为 0 或端点缺席时必须返回 null（严禁用 100%/0% 冒充「全填完/全没填」）。
// 坏掉的症状：覆盖外月份出 0%、引擎缺席时填写率出 0%、event:xxx 实例被当日锚计入
// 产出天数、跨月实例泄入统计。口径来源：《视频参考优化清单.md》附录 B1（2026-09-03 拍板）。
import { describe, expect, it } from 'vitest'
import { reviewCompletionOf, reviewableDaysInMonth } from './reviewCompletion'
import type { TemplateInstanceSummary } from './templateInstanceApi'

const COVERAGE = { start: '2026-04-01', end: '2026-05-30' }

function inst(periodKey: string, status: TemplateInstanceSummary['status']): TemplateInstanceSummary {
  return { id: periodKey + status, templateId: 'T08', periodKey, status, dueAt: null, updatedAt: null }
}

describe('reviewableDaysInMonth', () => {
  it('整月落在覆盖窗内且已过完 → 全月天数（窗口末端截断）', () => {
    // 2026-05-15 视角看 5 月：只数到 15 日
    expect(reviewableDaysInMonth('2026-05', '2026-05-15', COVERAGE)).toBe(15)
    // 2026-09 视角看 5 月：全月已过，但窗口末端 05-30 截断 → 30 天（5-31 在窗外）
    expect(reviewableDaysInMonth('2026-05', '2026-09-03', COVERAGE)).toBe(30)
  })

  it('覆盖窗裁剪：月末超出窗口按窗口末端截断', () => {
    expect(reviewableDaysInMonth('2026-05', '2026-09-03', { start: '2026-04-01', end: '2026-05-30' })).toBe(30)
  })

  it('反例：覆盖外月份 / 未登记地区 / 今天早于月初 / 脏输入 → 0', () => {
    expect(reviewableDaysInMonth('2026-09', '2026-09-03', COVERAGE)).toBe(0)
    expect(reviewableDaysInMonth('2026-09', '2026-09-03', null)).toBe(0)
    expect(reviewableDaysInMonth('2026-05', '2026-04-15', COVERAGE)).toBe(0)
    expect(reviewableDaysInMonth('2026-13', '2026-09-03', COVERAGE)).toBe(0)
    expect(reviewableDaysInMonth('bad', '2026-09-03', COVERAGE)).toBe(0)
  })
})

describe('reviewCompletionOf', () => {
  const base = { month: '2026-05', today: '2026-09-03', coverage: COVERAGE }

  it('端点缺席：覆盖率出真实分母下的 0%，填写率必须为 null', () => {
    const r = reviewCompletionOf({ ...base, feed: { available: false, reason: 'endpoint-absent' } })
    expect(r.feedAvailable).toBe(false)
    expect(r.reviewableDays).toBe(30)
    expect(r.producedDays).toBe(0)
    expect(r.coveragePct).toBe(0)
    expect(r.fillPct).toBeNull()
  })

  it('端点可用：日锚实例按提交状态折算产出天数与填写率', () => {
    const r = reviewCompletionOf({
      ...base,
      feed: {
        available: true,
        instances: [
          inst('2026-05-10', 'submitted'),
          inst('2026-05-10', 'draft'), // 同日未提交不重复也不计产出
          inst('2026-05-12', 'reviewed'),
          inst('2026-05-12', 'submitted'), // 同日双实例只算一天
          inst('2026-05-20', 'pending'),
          inst('event:JC-20260521-01', 'submitted'), // 事件锚不计入产出天数
          inst('2026-04-08', 'submitted') // 跨月实例不泄入 5 月
        ]
      }
    })
    expect(r.producedDays).toBe(2)
    expect(r.coveragePct).toBeCloseTo(2 / 30, 8)
    // 应填分母按 periodKey 月份前缀统计：4-08 跨月排除；event: 锚无月份前缀同样排除
    // （事件锚实例不计入填写率分子/分母，口径见实现文件头注）
    expect(r.instancesTotal).toBe(5)
    expect(r.instancesSubmitted).toBe(3)
    expect(r.fillPct).toBeCloseTo(3 / 5, 8)
  })

  it('反例：无可回测天（覆盖外月）→ coveragePct=null；有实例但全未提交 → fillPct=0 而非 null', () => {
    const absent = reviewCompletionOf({ month: '2026-09', today: '2026-09-03', coverage: COVERAGE, feed: { available: false, reason: 'endpoint-absent' } })
    expect(absent.coveragePct).toBeNull()
    expect(absent.reviewableDays).toBe(0)

    const noneDone = reviewCompletionOf({
      ...base,
      feed: { available: true, instances: [inst('2026-05-10', 'pending'), inst('2026-05-11', 'draft')] }
    })
    expect(noneDone.instancesTotal).toBe(2)
    expect(noneDone.instancesSubmitted).toBe(0)
    expect(noneDone.fillPct).toBe(0)
    expect(noneDone.coveragePct).toBe(0)
  })

  it('反例：实例端点可用但当月零实例 → fillPct=null（不出 100% 冒充全填完）', () => {
    const r = reviewCompletionOf({ ...base, feed: { available: true, instances: [] } })
    expect(r.instancesTotal).toBe(0)
    expect(r.fillPct).toBeNull()
    expect(r.coveragePct).toBe(0)
  })
})
