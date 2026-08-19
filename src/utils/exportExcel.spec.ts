// @vitest-environment happy-dom
// ↑ 勿删：exportBundleCsv 依赖 document.createElement / URL.createObjectURL，node 无 DOM。
//   happy-dom 缺的 URL 静态方法在 spec 层补桩（不动源码）；xlsx.writeFile 被 mock
//   真实 writeFile 在测试环境走 fs 写盘副作用，mock 后改为捕获 wb 并用 XLSX.write/read
//   回读验证序列化产物（比只看对象更能证明「写出的工作簿真的能被 Excel 读回」）。
//
// 回归：Excel/Zip 打包导出。坏掉的症状：数值列变文本（Excel 求和全 #VALUE!）、
// sheet 名非法导致文件损坏打不开、zip 内多表重名互相覆盖只剩一张。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const writeFileMock = vi.hoisted(() => vi.fn())
vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xlsx')>()
  return { ...actual, writeFile: writeFileMock }
})

import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { exportWorkbook } from './exportExcel'
import { exportBundleCsv } from './exportBundle'

/** 捕获到的 wb → 序列化 → 反序列化，模拟 Excel 读回。 */
function readBack(wb: XLSX.WorkBook): XLSX.WorkBook {
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return XLSX.read(data)
}

describe('exportWorkbook', () => {
  beforeEach(() => writeFileMock.mockClear())
  afterEach(() => vi.restoreAllMocks())

  it('多 sheet 写入：XLSX.read 回读后行列内容一致、数值保持 number 类型', () => {
    exportWorkbook('报表', [
      { name: '主表', rows: [['项目', '数量'], ['电费', 123.5]] },
      { name: '附表', rows: [['x']] },
    ])
    expect(writeFileMock).toHaveBeenCalledTimes(1)
    const [wb, filename] = writeFileMock.mock.calls[0]
    expect(filename).toBe('报表.xlsx') // 无后缀自动补
    const back = readBack(wb as XLSX.WorkBook)
    expect(back.SheetNames).toEqual(['主表', '附表'])
    const aoa = XLSX.utils.sheet_to_json(back.Sheets['主表'], { header: 1 }) as unknown[][]
    expect(aoa).toEqual([
      ['项目', '数量'],
      ['电费', 123.5],
    ])
    expect(typeof aoa[1]![1]).toBe('number') // 数值保型：Excel 里可直接 SUM
  })

  it('filename 已带 .xlsx 不重复补', () => {
    exportWorkbook('a.xlsx', [{ name: 'S', rows: [[1]] }])
    expect(writeFileMock.mock.calls[0]![1]).toBe('a.xlsx')
  })

  it('sheet 名清洗：非法字符 : \\ / ? * [ ] 替换为空格', () => {
    exportWorkbook('r', [{ name: 'a:b/c?d[e]', rows: [[1]] }])
    const [wb] = writeFileMock.mock.calls[0]
    expect((wb as XLSX.WorkBook).SheetNames).toEqual(['a b c d e'])
  })

  it('超长 sheet 名截到 28 字符（去重时再缩到 25 加 _N 后缀，仍 ≤31 的 Excel 硬限）', () => {
    const long = '字'.repeat(40)
    exportWorkbook('r', [{ name: long, rows: [[1]] }, { name: long + 'x', rows: [[1]] }])
    const [wb] = writeFileMock.mock.calls[0]
    const names = (wb as XLSX.WorkBook).SheetNames
    // 手算：两个 40 字名都截到前 28 字后完全相同 → 撞名 → 第二个走去重
    // base.slice(0,25) + '_1' = 25 字 + 2 字符 = 27 字。
    expect(names[0]).toBe('字'.repeat(28))
    expect(names[1]).toBe('字'.repeat(25) + '_1')
    expect(new Set(names).size).toBe(2) // 截断后不撞名
  })

  it('重名 sheet 去重：S / S / S → S / S_1 / S_2', () => {
    exportWorkbook('r', [
      { name: 'S', rows: [[1]] },
      { name: 'S', rows: [[2]] },
      { name: 'S', rows: [[3]] },
    ])
    const [wb] = writeFileMock.mock.calls[0]
    expect((wb as XLSX.WorkBook).SheetNames).toEqual(['S', 'S_1', 'S_2'])
  })

  it('空名 sheet 落到 SheetN 兜底', () => {
    exportWorkbook('r', [{ name: '', rows: [[1]] }, { name: '   ', rows: [[2]] }])
    const [wb] = writeFileMock.mock.calls[0]
    // 第二个 trim 后为空 → 兜底 Sheet2
    expect((wb as XLSX.WorkBook).SheetNames).toEqual(['Sheet1', 'Sheet2'])
  })

  it('空 sheets 仍触发 writeFile（现行为记录：与 exportBundleCsv 的空判不同，不拦空工作簿）', () => {
    exportWorkbook('r', [])
    expect(writeFileMock).toHaveBeenCalledTimes(1)
  })
})

describe('exportBundleCsv', () => {
  const capturedBlobs: Blob[] = []
  let clickSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    capturedBlobs.length = 0
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
  afterEach(() => vi.restoreAllMocks())

  it('jszip 解包：每表一个 CSV，内容含 BOM 与 RFC 4180 转义（手算对拍）', async () => {
    await exportBundleCsv('打包', [
      { name: '账单', header: ['a', 'b'], rows: [['x,y', 'q"z'], [1, 2]] },
    ])
    const zip = await JSZip.loadAsync(capturedBlobs[0])
    const csv = await zip.file('账单.csv')!.async('string')
    // 手算：表头 'a,b'；'x,y' 含逗号 → "x,y"；'q"z' 含引号 → "q""z"；数字不引号。
    // 口径差异（记录）：本模块行分隔是 \n（exportCsv 是 \r\n）。
    expect(csv).toBe('﻿a,b\n"x,y","q""z"\n1,2')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('重名表自动 (2)/(3) 后缀，互不覆盖', async () => {
    await exportBundleCsv('打包', [
      { name: 't', header: ['v'], rows: [['1']] },
      { name: 't', header: ['v'], rows: [['2']] },
      { name: 't', header: ['v'], rows: [['3']] },
    ])
    const zip = await JSZip.loadAsync(capturedBlobs[0])
    expect(Object.keys(zip.files).sort()).toEqual(['t (2).csv', 't (3).csv', 't.csv'])
    expect(await zip.file('t.csv')!.async('string')).toContain('1')
    expect(await zip.file('t (3).csv')!.async('string')).toContain('3')
  })

  it('空 tables 直接返回：不造空 zip、不触发下载（诚实语义红线）', async () => {
    await exportBundleCsv('打包', [])
    expect(capturedBlobs).toHaveLength(0)
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('zipName 后缀补 .zip，download 属性正确', async () => {
    await exportBundleCsv('多表导出', [{ name: 't', header: ['v'], rows: [['1']] }])
    expect(clickSpy).toHaveBeenCalledTimes(1)
    const link = clickSpy.mock.contexts[0] as HTMLAnchorElement
    expect(link.download).toBe('多表导出.zip')
    expect(link.href).toBe('blob:mock')
  })

  it('zipName 已带 .zip 不重复补', async () => {
    await exportBundleCsv('x.zip', [{ name: 't', header: ['v'], rows: [['1']] }])
    expect((clickSpy.mock.contexts[0] as HTMLAnchorElement).download).toBe('x.zip')
  })

  it('null 单元格转空串（zip 内不留 "null" 文本）', async () => {
    await exportBundleCsv('z', [{ name: 't', header: ['a', 'b'], rows: [[null, undefined]] }])
    const zip = await JSZip.loadAsync(capturedBlobs[0])
    expect(await zip.file('t.csv')!.async('string')).toBe('﻿a,b\n,')
  })

  it('下载后 revokeObjectURL 释放', async () => {
    await exportBundleCsv('z', [{ name: 't', header: ['v'], rows: [['1']] }])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })
})
