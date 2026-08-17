// 昨夜智能体报告卡组件测试（Epic #2033 · M1 · #2040）
// 验收：空态齐全（昨夜未生成/正文失败/列表失败），只读+跳转、无写回。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

vi.mock('@/services/quant/quantClient', () => ({
  fetchReports: vi.fn(),
  fetchReportContent: vi.fn()
}))

import { fetchReportContent, fetchReports } from '@/services/quant/quantClient'
import OvernightReportCard from './OvernightReportCard.vue'
import { mount } from '@/test/mount'

const nowSec = Math.floor(Date.now() / 1000)
const schedItem = (mtime: number, session = 'sched_abc') => ({
  session_id: session,
  path: 'reports/daily_review_x.md',
  title: 'daily_review_2026-08-14.md',
  mtime
})

beforeEach(() => {
  vi.mocked(fetchReports).mockReset()
  vi.mocked(fetchReportContent).mockReset()
  push.mockReset()
})

async function settle(wrapper: ReturnType<typeof mount>) {
  await nextTick()
  await nextTick()
  await nextTick()
  return wrapper
}

describe('OvernightReportCard（昨夜智能体报告卡）', () => {
  it('36h 内有 sched_ 报告 → 标题+定时产出+摘要，点击跳复盘中心全文', async () => {
    vi.mocked(fetchReports).mockResolvedValue([schedItem(nowSec - 3600), schedItem(nowSec - 7200, 'sched_old')])
    vi.mocked(fetchReportContent).mockResolvedValue('# 复盘报告\n\n昨日偏差主要来自晚高峰预测偏低，建议今日上调基荷段申报。')
    const wrapper = await settle(mount(OvernightReportCard))
    const text = wrapper.text()
    expect(text).toContain('daily_review_2026-08-14.md')
    expect(text).toContain('定时产出')
    expect(text).toContain('偏差主要来自晚高峰')
    // 取最新（mtime 最大）
    expect(fetchReportContent).toHaveBeenCalledWith('sched_abc', 'reports/daily_review_x.md')
    await wrapper.find('.orc-card').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/xhjy/review', query: { report: 'sched_abc' } })
  })

  it('窗口内只有手动报告（非 sched_）→ 昨夜未生成 + 手动触发入口', async () => {
    vi.mocked(fetchReports).mockResolvedValue([schedItem(nowSec - 60, 'manual_xyz')])
    const wrapper = await settle(mount(OvernightReportCard))
    expect(wrapper.text()).toContain('昨夜未生成')
    await wrapper.find('.orc-trigger').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/xhjy/review', query: { run: '1' } })
  })

  it('报告列表软失败 → 降级「昨夜未生成」，不抛错', async () => {
    vi.mocked(fetchReports).mockRejectedValue(new TypeError('Failed to fetch'))
    const wrapper = await settle(mount(OvernightReportCard))
    expect(wrapper.text()).toContain('昨夜未生成')
  })

  it('正文取失败 → 标题仍在，摘要区显示失败原因', async () => {
    vi.mocked(fetchReports).mockResolvedValue([schedItem(nowSec - 60)])
    vi.mocked(fetchReportContent).mockRejectedValue(new Error('403 越权'))
    const wrapper = await settle(mount(OvernightReportCard))
    const text = wrapper.text()
    expect(text).toContain('daily_review_2026-08-14.md')
    expect(text).toContain('正文摘要不可用')
    expect(text).toContain('403 越权')
  })

  it('超过 36h 的 sched_ 报告不算昨夜（窗口纪律）', async () => {
    vi.mocked(fetchReports).mockResolvedValue([schedItem(nowSec - 40 * 3600)])
    const wrapper = await settle(mount(OvernightReportCard))
    expect(wrapper.text()).toContain('昨夜未生成')
  })
})
