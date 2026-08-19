// @vitest-environment happy-dom
// ↑ 勿删：exportCsv 依赖 document.createElement / URL.createObjectURL，node project 无 DOM。
//   happy-dom 缺的 URL 静态方法在 spec 层补齐（不动源码），下载动作用 spy 捕获。
//
// CSV 导出回归：RFC 4180 转义 + UTF-8 BOM。坏掉的症状最隐蔽，Excel 打开含逗号/
// 引号的单元格错列（账单金额对不上号），或中文表头乱码被当成数据脏列。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportCsv } from './exportCsv'

const capturedBlobs: Blob[] = []
let clickSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  capturedBlobs.length = 0
  // happy-dom 的 URL 可能缺 blob 静态方法：缺则补桩，再统一 spy 捕获。
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:mock'
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    URL.revokeObjectURL = () => undefined
  }
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
    capturedBlobs.push(b as Blob)
    return 'blob:mock'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const blobText = async () => await capturedBlobs[0]!.text()

describe('exportCsv：RFC 4180 引号转义（手算对拍）', () => {
  it('含引号/逗号/换行的值逐一手算对拍', async () => {
    exportCsv('r', ['h1', 'h2'], [
      ['a"b', 'x,y'],
      ['l1\nl2', 5],
    ])
    const text = await blobText()
    // 手算：
    //   表头无特殊字符 → h1,h2
    //   'a"b' 含 " → 整格引号包裹、内部 " 双写 → "a""b"
    //   'x,y' 含 , → "x,y"
    //   'l1\nl2' 含换行 → "l1\nl2"；5 纯数字不引号
    //   行间 \r\n（RFC 4180 规定 CRLF）
    expect(text).toBe('﻿h1,h2\r\n"a""b","x,y"\r\n"l1\nl2",5')
  })

  it('普通值不加引号（不过度转义，文件保持可读）', async () => {
    exportCsv('r', ['a', 'b'], [['1', 'hello']])
    expect(await blobText()).toBe('﻿a,b\r\n1,hello')
  })

  it('null/undefined 单元格 → 空串（不产 "null" 文本）', async () => {
    exportCsv('r', ['a', 'b'], [[null, undefined]])
    expect(await blobText()).toBe('﻿a,b\r\n,')
  })

  it('回车也在转义触发集合内', async () => {
    exportCsv('r', ['a'], [['l1\rl2']])
    expect(await blobText()).toBe('﻿a\r\n"l1\rl2"')
  })
})

describe('exportCsv：BOM 与类型', () => {
  it('首个字节是 UTF-8 BOM（Excel 直开中文不乱码）', async () => {
    exportCsv('r', ['名称'], [['中文']])
    expect((await blobText()).charCodeAt(0)).toBe(0xfeff)
  })

  it('blob MIME 为 text/csv;charset=utf-8', () => {
    exportCsv('r', ['a'], [['1']])
    expect(capturedBlobs[0]!.type).toBe('text/csv;charset=utf-8')
  })

  it('空表头/空行不抛错，内容仅 BOM', async () => {
    exportCsv('r', [], [])
    expect(await blobText()).toBe('﻿')
  })
})

describe('exportCsv：下载触发与文件名', () => {
  it('触发一次 click，download 补 .csv 后缀', () => {
    exportCsv('月度账单', ['a'], [['1']])
    expect(clickSpy).toHaveBeenCalledTimes(1)
    const link = clickSpy.mock.contexts[0] as HTMLAnchorElement
    expect(link.download).toBe('月度账单.csv')
    expect(link.href).toBe('blob:mock')
  })

  it.each([
    ['a.csv', 'a.csv'], // 已有后缀不重复
    ['DATA.CSV', 'DATA.CSV'], // 大小写不敏感判定
    ['report', 'report.csv'],
    ['a.b', 'a.b.csv'],
  ])('文件名 %s → %s', (input, expected) => {
    exportCsv(input, ['a'], [['1']])
    const link = clickSpy.mock.contexts[clickSpy.mock.contexts.length - 1] as HTMLAnchorElement
    expect(link.download).toBe(expected)
  })

  it('下载后 revokeObjectURL 释放（长会话导出多次不泄漏 blob）', () => {
    exportCsv('r', ['a'], [['1']])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })
})
