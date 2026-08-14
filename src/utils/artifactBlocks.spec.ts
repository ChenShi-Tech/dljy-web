// Artifact 围栏解析回归：agent 流式 Markdown → 有序块，约定围栏提升为一等 artifact。
// 守的核心不变量：① 绝不丢内容——JSON 解析失败安全降级为代码块；② 半开围栏（流式
// 正在生成/漏写闭合）不吞掉后续 artifact；③ 流式切分 stable/tail 的边界 = 最后一个
// 闭合围栏，让对话框边流边渲染而不闪重。
//
// ⚠️ dompurify 被 mock 为透传：本模块经 renderMarkdown 间接依赖 DOMPurify，而实测本仓
// happy-dom（vitest 4 + dompurify 3.4.13）下 sanitize 会剥掉所有标签只剩文本（真实
// 浏览器正常），非源码 bug。透传后块结构断言不受影响；涉及 html 内容处只断言
// markdown-it 渲染层的稳定片段。
import { describe, expect, it, vi } from 'vitest'

const sanitizePassthrough = vi.hoisted(() => (html: string) => html)
vi.mock('dompurify', () => ({
  default: { sanitize: sanitizePassthrough, isSupported: true },
}))

import {
  codeBlock,
  looseParseJson,
  parseArtifactBlocks,
  pendingArtifactLabel,
  splitStreamingArtifacts
} from './artifactBlocks'

describe('looseParseJson：宽容 LLM 常见脏 JSON，失败返 undefined（绝不 eval）', () => {
  it('标准 JSON 全类型直达', () => {
    expect(looseParseJson('{"a":1}')).toEqual({ a: 1 })
    expect(looseParseJson('[1,2]')).toEqual([1, 2])
    expect(looseParseJson('"str"')).toBe('str')
    expect(looseParseJson('123')).toBe(123)
    expect(looseParseJson('true')).toBe(true)
    expect(looseParseJson('null')).toBe(null) // null 是合法解析结果
  })

  it('对象/数组尾随逗号被清理', () => {
    expect(looseParseJson('{"a":1,}')).toEqual({ a: 1 })
    expect(looseParseJson('[1,2,]')).toEqual([1, 2])
  })

  it('行注释与块注释被剥离', () => {
    expect(looseParseJson('{"a": 1, // 备注\n"b": 2}')).toEqual({ a: 1, b: 2 })
    expect(looseParseJson('/* 头部\n注释 */\n{"a":1}')).toEqual({ a: 1 })
  })

  it('字符串里的 // 不被误删（URL 完整保留）', () => {
    expect(looseParseJson('{"u":"http://x.com/a"}')).toEqual({ u: 'http://x.com/a' })
  })

  it.each([
    ['单引号键', "{ 'a': 1 }"], // 宽容范围只有注释+尾逗号，单引号不放宽
    ['截断对象', '{"a":'],
    ['截断数组', '[1,2'],
    ['空串', ''],
    ['前导垃圾', 'json {"a":1}'],
    ['只注释', '// nothing'],
  ])('%s → undefined（失败哨兵，调用方降级代码块）', (_label, src) => {
    expect(looseParseJson(src)).toBeUndefined()
  })
})

describe('codeBlock：行数与原文保留', () => {
  it('lang/label/code 原样，lines 按行数，html 走高亮', () => {
    const b = codeBlock('js', '标签', 'const a = 1\nconst b = 2')
    expect(b).toMatchObject({ kind: 'code', lang: 'js', label: '标签', code: 'const a = 1\nconst b = 2', lines: 2 })
    expect(b.html).toContain('hljs-keyword')
  })

  it('空串 code → lines 0（不是 1）', () => {
    expect(codeBlock('txt', '', '').lines).toBe(0)
  })

  it('未知 lang 自动检测，不抛错', () => {
    const b = codeBlock('foobar-lang', 'L', 'const x = 1')
    expect(b.kind).toBe('code')
    expect(b.code).toBe('const x = 1')
  })
})

describe('parseArtifactBlocks：混合围栏 → 有序块', () => {
  const MIXED = [
    '前言段落。',
    '```card',
    '{"title":"卡","metrics":[{"label":"x","value":1}]}',
    '```',
    '中段文本。',
    '```math',
    'E = mc^2',
    '```',
    '结尾文本。'
  ].join('\n')

  it('多类型混合 → kind 序列 markdown/card/markdown/math/markdown，内容各就各位', () => {
    const blocks = parseArtifactBlocks(MIXED)
    expect(blocks.map((b) => b.kind)).toEqual(['markdown', 'card', 'markdown', 'math', 'markdown'])
    const card = blocks[1]
    expect(card).toMatchObject({
      kind: 'card',
      title: '卡',
      metrics: [{ label: 'x', value: 1, unit: undefined, delta: undefined, trend: undefined, tone: undefined, hint: undefined }]
    })
    expect(blocks[3]).toMatchObject({ kind: 'math', code: 'E = mc^2' })
  })

  it('纯文本 → 单 markdown 块；空串/纯空白 → []', () => {
    expect(parseArtifactBlocks('hello').map((b) => b.kind)).toEqual(['markdown'])
    expect(parseArtifactBlocks('')).toEqual([])
    expect(parseArtifactBlocks('  \n  ')).toEqual([])
  })

  it('CRLF 输入与 LF 等价', () => {
    const src = '正文\r\n```math\r\nE=1\r\n```'
    expect(parseArtifactBlocks(src).map((b) => b.kind)).toEqual(['markdown', 'math'])
    expect(parseArtifactBlocks(src)[1]).toMatchObject({ code: 'E=1' })
  })

  it('波浪号围栏同样识别', () => {
    expect(parseArtifactBlocks('~~~math\nE=1\n~~~')[0]).toMatchObject({ kind: 'math', code: 'E=1' })
  })
})

describe('parseArtifactBlocks：chart/json 围栏的提升与降级（STREAM-2）', () => {
  const OPT = '{"series":[{"type":"line","data":[1]}]}'

  it('```chart + 合法 option 对象 → kind chart，title 透传', () => {
    const [b] = parseArtifactBlocks('```chart 我的图\n' + OPT + '\n```')
    expect(b).toMatchObject({ kind: 'chart', title: '我的图' })
    expect((b as unknown as { option: { series: unknown[] } }).option.series).toHaveLength(1)
  })

  it('```chart 非法 JSON → 降级 code 块（内容不丢、不抛错）', () => {
    const [b] = parseArtifactBlocks('```chart\n{oops')
    expect(b).toMatchObject({ kind: 'code', lang: 'json' })
    expect((b as { code: string }).code).toBe('{oops')
  })

  it('```chart 合法但非对象（数组/数字）→ 降级 code', () => {
    expect(parseArtifactBlocks('```chart\n[1,2]')[0].kind).toBe('code')
    expect(parseArtifactBlocks('```chart\n42')[0].kind).toBe('code')
  })

  it('```json 内容是 ECharts option → 提升为 chart（容错 agent 误用 json 围栏）', () => {
    expect(parseArtifactBlocks('```json\n' + OPT + '\n```')[0].kind).toBe('chart')
  })

  it('```json 普通 JSON → 保持代码块', () => {
    expect(parseArtifactBlocks('```json\n{"a":1}')[0].kind).toBe('code')
  })

  it('STREAM-2 回归：series 是字符串数组/无 type 对象 → 不当图表（防 setOption 崩）', () => {
    expect(parseArtifactBlocks('```json\n{"series":["a","b"]}')[0].kind).toBe('code')
    expect(parseArtifactBlocks('```json\n{"series":[{"name":"x"}]}')[0].kind).toBe('code') // 无 type
    expect(parseArtifactBlocks('```json\n{"series":[{"type":"not-a-type"}]}')[0].kind).toBe('code') // 未登记 type
    expect(parseArtifactBlocks('```json\n{"series":[]}')[0].kind).toBe('code') // 空数组
  })

  it('未知围栏类型 → 按普通代码块保内容', () => {
    const [b] = parseArtifactBlocks('```foobar 备注\nxyz\n```')
    expect(b).toMatchObject({ kind: 'code', lang: 'foobar', label: '备注', code: 'xyz' })
  })
})

describe('parseArtifactBlocks：半开围栏与隐式闭合（流式/漏写闭合容错）', () => {
  it('未闭合围栏吞到文末，仍成块不丢内容', () => {
    const [b] = parseArtifactBlocks('```chart\n{"series":[{"type":"line"}]')
    // 截断 JSON（缺最外层 }）解析失败 → 降级 code；但围栏体逐字保留
    expect(b).toMatchObject({ kind: 'code', code: '{"series":[{"type":"line"}]' })
  })

  it('未闭合围栏遇新开围栏隐式结束，不吞后续 artifact', () => {
    // agent 漏写 ```math 的闭合符：若不隐式结束，```timeline 会被吞进公式体
    const src = '```math\nE=1\n```timeline\n[{"title":"事件"}]'
    const blocks = parseArtifactBlocks(src)
    expect(blocks.map((b) => b.kind)).toEqual(['math', 'timeline'])
    expect(blocks[0]).toMatchObject({ code: 'E=1' })
    expect(blocks[1]).toMatchObject({ events: [{ title: '事件' }] })
  })

  it('闭合围栏须 ≥ 开围栏长度且整行：3 反引号关不住 4 反引号围栏', () => {
    // 开 ````（4 个），闭合 ```（3 个）不够长 → 不识别，围栏吞到文末
    const src = '````math\nE=1\n```\ntrailing'
    const blocks = parseArtifactBlocks(src)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'math', code: 'E=1\n```\ntrailing' })
  })

  it('更长的闭合围栏合法（5 关 4）', () => {
    const src = '````math\nE=1\n`````'
    expect(parseArtifactBlocks(src)).toMatchObject([{ kind: 'math', code: 'E=1' }])
  })
})

describe('parseArtifactBlocks：callout / card 的诚实降级', () => {
  it('```warning 标题 → level warning，正文走 markdown 渲染', () => {
    const [b] = parseArtifactBlocks('```warning 注意\n**正文**\n```')
    expect(b).toMatchObject({ kind: 'callout', level: 'warning', title: '注意' })
    expect((b as { html: string }).html).toContain('<strong>正文</strong>')
  })

  it('```callout danger 标题：title 首词覆盖级别', () => {
    const [b] = parseArtifactBlocks('```callout danger 风险\n内容\n```')
    expect(b).toMatchObject({ kind: 'callout', level: 'critical', title: '风险' })
  })

  it('无级别词的 callout 归 info 且有默认标题', () => {
    const [b] = parseArtifactBlocks('```callout\n内容\n```')
    expect(b).toMatchObject({ kind: 'callout', level: 'info', title: '提示' })
  })

  it('card 无有效 metrics → 降级 code（不渲染空卡）', () => {
    expect(parseArtifactBlocks('```card\n{"metrics":[]}')[0].kind).toBe('code')
    expect(parseArtifactBlocks('```card\nnot-json')[0].kind).toBe('code')
  })

  it('card 支持顶层数组变体', () => {
    const [b] = parseArtifactBlocks('```card 我的卡\n[{"label":"x","value":2}]')
    expect(b).toMatchObject({ kind: 'card', title: '我的卡', metrics: [{ label: 'x', value: 2 }] })
  })
})

describe('pendingArtifactLabel：未闭合 artifact 围栏的「生成中」标签', () => {
  it('未闭合 chart → 图表', () => {
    expect(pendingArtifactLabel('前言\n```chart\n{"series":')).toBe('图表')
  })

  it('带标题不影响识别：```declaration x → 申报曲线', () => {
    expect(pendingArtifactLabel('```declaration 7月申报\n{')).toBe('申报曲线')
  })

  it('全部闭合 → null', () => {
    expect(pendingArtifactLabel('```chart\n' + '{"series":[{"type":"line"}]}' + '\n```')).toBeNull()
  })

  it.each([
    ['json（无 label，不打扰 token 动画）', '```json\n{"a":'],
    ['普通代码围栏', '```js\nconst x ='],
    ['未登记类型', '```foobar\nx'],
    ['空输入', ''],
  ])('%s → null', (_label, src) => {
    expect(pendingArtifactLabel(src)).toBeNull()
  })

  it('现行为记录（源码可疑点）：半开围栏后再遇新开围栏，label 仍跟随**旧**类型', () => {
    // pendingArtifactLabel 的扫描循环没有 splitStreamingArtifacts/parseArtifactBlocks 的
    // 「隐式 reopen 改判」分支：```math 漏闭合、```timeline 接管后，它仍报「公式」。
    // 后果：流式骨架显示旧类型标签（正在生成公式→其实在生成时间线），仅提示文案错位，
    // 无数据丢失；三函数口径不一致，待统一后更新本用例。
    expect(pendingArtifactLabel('```math\nE\n```timeline\n[')).toBe('公式')
    // 对照：splitStreamingArtifacts 对同一输入有 reopen 改判（见下组用例）。
    expect(splitStreamingArtifacts('```math\nE\n```timeline\n[').pendingLabel).toBe('时间线')
  })
})

describe('splitStreamingArtifacts：stable/tail 切分边界', () => {
  it('围栏全闭合 → stable 截到闭合围栏行，其后纯文本归 tail（仍在打字的部分渐显）', () => {
    const src = '前言\n```chart\n{"series":[{"type":"line"}]}\n```\n后记'
    expect(splitStreamingArtifacts(src)).toEqual({
      stable: '前言\n```chart\n{"series":[{"type":"line"}]}\n```',
      tail: '后记',
      pendingLabel: null
    })
  })

  it('尾部半开围栏：stable 截到最后一个闭合围栏，tail 含其后全部', () => {
    const closed = '```chart\n{"series":[{"type":"line"}]}\n```'
    const src = closed + '\n生成中前导文本\n```card\n{"metrics":'
    const r = splitStreamingArtifacts(src)
    expect(r.stable).toBe(closed)
    expect(r.tail).toBe('生成中前导文本\n```card\n{"metrics":')
    expect(r.pendingLabel).toBe('测算卡片')
  })

  it('无任何围栏 → 全部是 tail（逐 token 渐显，stable 为空）', () => {
    expect(splitStreamingArtifacts('正在输出的文字')).toEqual({
      stable: '',
      tail: '正在输出的文字',
      pendingLabel: null
    })
  })

  it('空串 → 三空', () => {
    expect(splitStreamingArtifacts('')).toEqual({ stable: '', tail: '', pendingLabel: null })
  })

  it('无 label 类型半开（json）→ pendingLabel null（不打扰，直显原文）', () => {
    const r = splitStreamingArtifacts('```json\n{"a":')
    expect(r.stable).toBe('')
    expect(r.pendingLabel).toBeNull()
  })

  it('半开围栏遇新开围栏改判（与 parseArtifactBlocks 一致），stable 仍无内容', () => {
    const src = '```math\nE=1\n```timeline\n[{"title":"x"}]'
    const r = splitStreamingArtifacts(src)
    expect(r.stable).toBe('') // 无任何闭合围栏
    expect(r.pendingLabel).toBe('时间线') // 跟随最新未闭合类型
    // 与 parseArtifactBlocks 的块序列一致性（同一输入两视角）
    expect(parseArtifactBlocks(src).map((b) => b.kind)).toEqual(['math', 'timeline'])
  })
})
