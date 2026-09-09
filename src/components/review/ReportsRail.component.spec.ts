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

  // 报告文件交付（清单 R4 文件半边 + C-1 批量下载）：勾选驱动批量、未勾选置灰、单份 emit 原条目
  it('未勾选时批量下载置灰；勾选后 emit download-reports 只带勾选条目', async () => {
    const w = mount(ReportsRail, { props: { reports } })
    const bulk = w.find('.bulk-btn')
    expect((bulk.element as HTMLButtonElement).disabled).toBe(true)
    const boxes = w.findAll('.li input[type="checkbox"]')
    await boxes[1].setValue(true)
    expect((bulk.element as HTMLButtonElement).disabled).toBe(false)
    expect(bulk.text()).toContain('1')
    await bulk.trigger('click')
    const emitted = w.emitted('download-reports')!
    expect(emitted[0][0]).toEqual([reports[1]])
  })

  it('全选/取消全选切换所有行；下载中（downloading）禁用下载控件', async () => {
    const w = mount(ReportsRail, { props: { reports, downloading: false } })
    await w.find('.pick-all input').setValue(true)
    expect(w.findAll('.li input[type="checkbox"]:checked')).toHaveLength(2)
    await w.find('.pick-all input').setValue(false)
    expect(w.findAll('.li input[type="checkbox"]:checked')).toHaveLength(0)

    const busy = mount(ReportsRail, { props: { reports, downloading: true } })
    expect((busy.find('.bulk-btn').element as HTMLButtonElement).disabled).toBe(true)
    const row0Buttons = busy.findAll('.li')[0].findAll('button')
    expect(row0Buttons[row0Buttons.length - 1].text()).toBe('下载') // 下载按钮仍在但禁用
    expect((row0Buttons[row0Buttons.length - 1].element as HTMLButtonElement).disabled).toBe(true)
    await row0Buttons[row0Buttons.length - 1].trigger('click')
    expect(busy.emitted('download-report')).toBeUndefined()
  })

  it('行内「下载」emit download-report 带原条目', async () => {
    const w = mount(ReportsRail, { props: { reports } })
    const rowButtons = w.findAll('.li')[0].findAll('button')
    await rowButtons[rowButtons.length - 1].trigger('click')
    expect(w.emitted('download-report')![0][0]).toMatchObject({ session_id: 'sched_1', path: 'r1.md' })
  })
})
