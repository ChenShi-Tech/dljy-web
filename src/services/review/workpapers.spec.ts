// 守底稿错误文案：服务端业务文案要透传，传输层兜底不能顶替业务指引。dljy#2872。
// @vitest-environment happy-dom
// services/api 在模块加载期就读 localStorage 取地区，纯 node 环境下 import 即崩。
import { describe, expect, it } from 'vitest'
import { decisionLinkError, decisionLookupError, workpaperError } from './workpapers'
import { ApiError } from '@/services/api'

const apiError = (code: number, msg?: string) => new ApiError(msg ?? `API request failed: ${code}`, { status: code, code, payload: { code, msg } })

describe('底稿与关联的错误文案', () => {
  it('两种 409 各自透传，但都保留内容未丢的安抚', () => {
    const draft = workpaperError(apiError(409, '底稿已有新版本，请先重新读取，保留当前修改后再合并'))
    const decision = workpaperError(apiError(409, '申报已经更新，请重新核对后关联'))
    expect(draft).toContain('底稿已有新版本')
    expect(decision).toContain('申报已经更新')
    // 只回一句「申报已经更新」，主笔会以为刚写的正文已经作废。
    for (const text of [draft, decision]) expect(text).toContain('当前文字已保留')
  })
  it('服务端未给业务文案时回到按状态的中文指引，不把传输错误摆给交易员', () => {
    // api.ts 在缺 msg 时兜的是英文 `API request failed: <status>`，它不是业务文案。
    expect(workpaperError(apiError(403))).toBe('当前账号不能修改这份报告。主笔可编辑发布，同事可添加批注。')
    expect(workpaperError(apiError(404))).toBe('当前公司和地区内没有找到这份报告或资料。')
    expect(workpaperError(apiError(400))).toBe('内容尚未通过校验，请核对标题、材料范围和原因状态。')
    expect(workpaperError(apiError(409))).toContain('底稿已有更新或请求发生冲突')
    for (const code of [400, 403, 404, 409]) expect(workpaperError(apiError(code))).not.toContain('API request failed')
  })
  it('服务端给了业务文案就按原文呈现', () => {
    expect(workpaperError(apiError(400, '业务申报与模拟演练不能作为同一复盘的本次依据，请分别建稿'))).toBe('业务申报与模拟演练不能作为同一复盘的本次依据，请分别建稿')
    expect(decisionLinkError(apiError(404, '当前范围内没有这笔明确归属的申报'))).toBe('当前范围内没有这笔明确归属的申报')
  })
  it('回查失败不说成「没有关联」，也不提根本不存在的依据输入框', () => {
    const text = decisionLookupError(apiError(503))
    expect(text).toContain('不表示没有复盘关联过这笔申报')
    expect(text).not.toContain('关联依据')
    expect(text).not.toContain('API request failed')
    // 服务端给了业务文案仍按原文呈现。
    expect(decisionLookupError(apiError(403, '当前账号没有所选公司的操作权限'))).toBe('当前账号没有所选公司的操作权限')
  })
  it('关联失败缺业务文案时说明依据仍在，不让交易员重写理由', () => {
    const text = decisionLinkError(apiError(503))
    expect(text).toContain('关联依据仍然保留')
    expect(text).not.toContain('API request failed')
    expect(decisionLinkError(new Error('网络中断'))).toContain('关联依据仍然保留')
  })
})
