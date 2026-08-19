// 报告摘要提取纯函数测试（node 环境）
import { describe, expect, it } from 'vitest'
import { summarizeReportMd } from './reportDigest'

describe('summarizeReportMd', () => {
  it('跳过标题/短行，取首个实质段落', () => {
    const md = '# 日度复盘报告\n\n2026-08-14\n\n**结论**：昨日偏差主要来自晚高峰负荷预测系统性偏低，今日建议上调 5%。\n'
    expect(summarizeReportMd(md)).toContain('昨日偏差主要来自晚高峰')
  })

  it('去 markdown 记号（标题井号/加粗/表格竖线/引用）', () => {
    const md = '## 摘要\n> 昨日申报电量与实际基本一致，偏差集中在 19–21 时段。'
    expect(summarizeReportMd(md)).not.toMatch(/[#*>|]/)
  })

  it('超长截断加省略号；空正文返回空串', () => {
    const long = 'A'.repeat(200)
    expect(summarizeReportMd(long)).toBe(`${'A'.repeat(120)}…`)
    expect(summarizeReportMd('', 100)).toBe('')
    expect(summarizeReportMd('# 标题\n3.14\n', 100)).toBe('')
  })
})
