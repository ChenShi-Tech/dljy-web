// 数据与口径状态行组件测试（trading-day-morning-summary-and-lazy-stages 任务 4.3）
// 验收：无条目不渲染；有条目默认一行摘要、展开逐条可见；caveat/info 分色。
import { describe, expect, it } from 'vitest'
import DataStatusLine from './DataStatusLine.vue'
import { mount } from '@/test/mount'

describe('DataStatusLine（数据与口径状态行）', () => {
  it('无条目不渲染任何内容（不占常驻横幅位）', () => {
    const wrapper = mount(DataStatusLine, { props: { items: [] } })
    expect(wrapper.find('.dsl').exists()).toBe(false)
  })

  it('有条目默认收起为一行摘要，展开后逐条可见', async () => {
    const wrapper = mount(DataStatusLine, {
      props: {
        items: [
          { tone: 'info', text: '正在晨会复盘窗口内（08:00–08:30），目标 5 分钟内完成' },
          { tone: 'caveat', text: '已过晨会复盘窗口——补写仍然留痕，但今日要点价值已打折' }
        ]
      }
    })
    expect(wrapper.find('.dsl-bar').text()).toContain('数据与口径状态 2 条')
    expect(wrapper.text()).not.toContain('已过晨会复盘窗口')

    await wrapper.find('.dsl-bar').trigger('click')
    expect(wrapper.text()).toContain('正在晨会复盘窗口内')
    expect(wrapper.text()).toContain('已过晨会复盘窗口')
  })
})
