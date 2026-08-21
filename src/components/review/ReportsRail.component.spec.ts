// 复盘报告库（Epic #2033 · #2038 外壳）：空态诚实、最新一份高亮、定时/手动来源、「全部」入口条件。
import { describe, expect, it } from 'vitest'
import { mount } from '@/test/mount'
import ReportsRail from './ReportsRail.vue'

const reports = [
  { session_id: 'sched_1', path: 'r1.md', title: '05-18 日度复盘', mtime: 1_779_000_000 },
  { session_id: 'sess_2', path: 'r2.md', title: '05-17 日度复盘', mtime: 1_778_900_000 }
]

describe('ReportsRail', () => {
  it('无报告 → 诚实空态，不渲染任何条目', () => {
    const w = mount(ReportsRail, { props: { reports: [] } })
    const box = w.get('[data-testid="review-reports"]')
    expect(box.text()).toContain('暂无报告')
    expect(box.findAll('.li')).toHaveLength(0)
    expect(box.find('.cnt').text()).toBe('0')
  })

  it('最新一份高亮，来源按 session_id 前缀判定定时/手动', () => {
    const w = mount(ReportsRail, { props: { reports } })
    const rows = w.get('[data-testid="review-reports"]').findAll('.li')
    expect(rows).toHaveLength(2)
    expect(rows[0].classes()).toContain('latest')
    expect(rows[0].text()).toContain('定时')
    expect(rows[1].classes()).not.toContain('latest')
    expect(rows[1].text()).toContain('手动')
  })

  it('点阅读 emit open-report 带原条目', async () => {
    const w = mount(ReportsRail, { props: { reports } })
    await w.get('[data-testid="review-reports"]').findAll('.li')[1].find('button').trigger('click')
    expect(w.emitted('open-report')![0][0]).toMatchObject({ session_id: 'sess_2', path: 'r2.md' })
  })

  it('超过 maxReports 才截断并出现「全部」入口', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ session_id: `s${i}`, path: `p${i}`, title: `r${i}`, mtime: 1 }))
    const w = mount(ReportsRail, { props: { reports: many, maxReports: 8 } })
    expect(w.get('[data-testid="review-reports"]').findAll('.li')).toHaveLength(8)
    expect(w.find('.all').exists()).toBe(true)
    expect(mount(ReportsRail, { props: { reports } }).find('.all').exists()).toBe(false)
  })
})
