// 教学示例依据文件（evidenceFile）的自我声明不变量（ChenShi-Tech/dljy#3404）。
// 守什么：文件名与正文都标明「教学示例 / 非真实依据」，并记录练习公司、合同编号、
// 运行标签与北京时间生成时间，可追溯到是哪次导引练习生成的；BOM + text/plain 与真实
// 上传走同一条 fileToBase64 通道。
// 坏掉的症状：示例文件混进真实核验依据里无法区分、无法清理追溯；或编码问题让上传
// 通道拒收。
import { describe, expect, it } from 'vitest'
import type { GuideCtx } from '../types'
import { makeExampleEvidenceFile } from './evidenceFile'

const ctx: GuideCtx = { runTag: 'GUIDE-01020304', regionId: 'yunnan', practiceCompanyId: 'c-practice-9', artifacts: {}, go: () => {} }

describe('makeExampleEvidenceFile', () => {
  it('文件名标明教学示例与合同编号，类型 text/plain', () => {
    const file = makeExampleEvidenceFile('NO-7', ctx)
    expect(file.name).toBe('教学示例-电子交易确认单-NO-7.txt')
    expect(file.type).toContain('text/plain')
  })

  it('正文首行声明非真实依据，并带练习公司 / 合同编号 / 运行标签 / 生成时间', async () => {
    const file = makeExampleEvidenceFile('NO-7', ctx)
    // BOM 用原始字节断言：Blob.text() 的 UTF-8 解码会剥掉前导 BOM（TextDecoder 默认行为）。
    const bytes = new Uint8Array(await file.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])

    const text = await file.text()
    expect(text).toContain('教学示例文件，非真实依据。')
    expect(text).toContain('练习公司：c-practice-9')
    expect(text).toContain('合同编号：NO-7')
    expect(text).toContain('运行标签：GUIDE-01020304')
    expect(text).toMatch(/生成时间（北京时间）：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
  })
})
