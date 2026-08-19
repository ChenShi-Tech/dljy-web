// 顶层工具组归并回归。
//
// 归并本身不涉及数据安全，但边界写错会让对话流渲染错乱（工具卡丢失、重复、或把子智能体
// 内部工具误提到顶层），且这类错误在流式界面里很难肉眼定位。故把边界逐个钉死：
// index=0 的越界访问、subRole 排除、被文本打断的连续性、组头统计取值。
import { describe, expect, it } from 'vitest'

import {
  isToolGroupStart,
  isTopLevelTool,
  summarizeToolGroup,
  toolGroupBasis,
  topToolGroupAt,
} from '@/components/agent/toolGrouping'

const label = (n: string) => ({ calc_bidding_space: '竞价空间测算' }[n] ?? n)

const tool = (name: string, status: 'running' | 'done' | 'error' = 'done', extra = {}) =>
  ({ kind: 'tool', name, status, ...extra })
const text = () => ({ kind: 'text', name: '', status: 'done' as const })

describe('isTopLevelTool', () => {
  it('只认 kind=tool 且无 subRole', () => {
    expect(isTopLevelTool(tool('a'))).toBe(true)
    expect(isTopLevelTool(tool('a', 'done', { subRole: 'market_analyst' }))).toBe(false)
    expect(isTopLevelTool(text())).toBe(false)
  })

  it('undefined/null 不炸（组首判定会访问 segs[-1]）', () => {
    expect(isTopLevelTool(undefined)).toBe(false)
    expect(isTopLevelTool(null)).toBe(false)
  })
})

describe('isToolGroupStart', () => {
  it('首位工具算起点（segs[-1] 越界不应误判）', () => {
    expect(isToolGroupStart([tool('a'), tool('b')], 0)).toBe(true)
  })

  it('组内非首位不算起点', () => {
    expect(isToolGroupStart([tool('a'), tool('b')], 1)).toBe(false)
  })

  it('被文本打断后重新开组', () => {
    const segs = [tool('a'), text(), tool('b')]
    expect(isToolGroupStart(segs, 0)).toBe(true)
    expect(isToolGroupStart(segs, 2)).toBe(true)
  })

  it('子智能体内部工具不参与顶层归并', () => {
    const segs = [tool('a', 'done', { subRole: 'market_analyst' }), tool('b')]
    expect(isToolGroupStart(segs, 0)).toBe(false)
    // 前一个是 subRole 工具（非顶层），故 b 自成新组起点
    expect(isToolGroupStart(segs, 1)).toBe(true)
  })

  it('非工具段不是起点', () => {
    expect(isToolGroupStart([text(), tool('a')], 0)).toBe(false)
  })
})

describe('topToolGroupAt', () => {
  it('取连续顶层工具，遇非工具段即止', () => {
    const segs = [tool('a'), tool('b'), text(), tool('c')]
    expect(topToolGroupAt(segs, 0).map((t) => t.name)).toEqual(['a', 'b'])
    expect(topToolGroupAt(segs, 3).map((t) => t.name)).toEqual(['c'])
  })

  it('遇子智能体工具即止（不把它并进顶层组）', () => {
    const segs = [tool('a'), tool('b', 'done', { subRole: 'risk_sentinel' }), tool('c')]
    expect(topToolGroupAt(segs, 0).map((t) => t.name)).toEqual(['a'])
  })

  it('越界下标返回空组', () => {
    expect(topToolGroupAt([tool('a')], 5)).toEqual([])
  })
})

describe('summarizeToolGroup', () => {
  it('统计 done/total，label 取正在跑的工具', () => {
    const s = summarizeToolGroup(
      [tool('calc_bidding_space'), tool('x', 'running'), tool('y')],
      label
    )
    expect(s.total).toBe(3)
    expect(s.done).toBe(2)
    expect(s.running).toBe(true)
    expect(s.label).toBe('x')
  })

  it('全部完成时 label 取最后一个（用中文名）', () => {
    const s = summarizeToolGroup([tool('x'), tool('calc_bidding_space')], label)
    expect(s.running).toBe(false)
    expect(s.label).toBe('竞价空间测算')
  })

  it('任一失败即标错（组头显示 ✗）', () => {
    expect(summarizeToolGroup([tool('a'), tool('b', 'error')], label).error).toBe(true)
    expect(summarizeToolGroup([tool('a')], label).error).toBe(false)
  })

  it('空组不炸', () => {
    const s = summarizeToolGroup([], label)
    expect(s).toMatchObject({ done: 0, total: 0, label: '', running: false, error: false })
  })
})

describe('toolGroupBasis：组头必须取最弱口径', () => {
  // 组默认折叠。若取"最后一个"，前面用过 synthetic_mock、后面用了 captured 时组头会显示
  // captured，把"用了合成数据"藏进折叠里，混合来源被呈现为全真实数据（Mock 标注纪律）。
  it('synthetic 在前、captured 在后 → 仍显示 synthetic', () => {
    const segs = [tool('a', 'done', { basis: 'synthetic' }), tool('b', 'done', { basis: 'captured' })]
    expect(toolGroupBasis(segs)).toBe('synthetic')
  })

  it('captured 在前、synthetic 在后 → 同样显示 synthetic（与顺序无关）', () => {
    const segs = [tool('a', 'done', { basis: 'captured' }), tool('b', 'done', { basis: 'synthetic' })]
    expect(toolGroupBasis(segs)).toBe('synthetic')
  })

  it('illustrative 弱于 captured/real', () => {
    expect(toolGroupBasis([
      tool('a', 'done', { basis: 'real' }),
      tool('b', 'done', { basis: 'illustrative' }),
      tool('c', 'done', { basis: 'captured' }),
    ])).toBe('illustrative')
  })

  it('全是真实口径时取其中较弱者', () => {
    expect(toolGroupBasis([
      tool('a', 'done', { basis: 'real' }),
      tool('b', 'done', { basis: 'captured' }),
    ])).toBe('captured')
  })

  it('未知口径按最弱处理（宁可保守，不把未知当真实）', () => {
    expect(toolGroupBasis([
      tool('a', 'done', { basis: 'captured' }),
      tool('b', 'done', { basis: 'weird_new_basis' }),
    ])).toBe('weird_new_basis')
  })

  it('无口径的工具不参与判定', () => {
    expect(toolGroupBasis([tool('a'), tool('b', 'done', { basis: 'captured' })])).toBe('captured')
  })

  it('都没有口径时返回 undefined（不伪造标注）', () => {
    expect(toolGroupBasis([tool('a'), tool('b')])).toBeUndefined()
  })
})
