// P2 对话框会话代次（dljy#2971）。
// 守什么：对话框关闭 / 重开或写入目标改变后，此前快照的提交被判为过期。
// 坏掉的症状：读文件期间重开到另一份合同，旧的等待完成后把内容写到新合同上。
import { describe, expect, it } from 'vitest'
import { createDialogSession } from './midlongP2Session'

describe('P2 对话框会话代次', () => {
  it('同一会话、同一写入目标才算当前；重开或目标改变即过期', () => {
    const session = createDialogSession()
    session.renew()
    const token = session.begin('7|1')
    expect(session.isCurrent(token, '7|1')).toBe(true)
    expect(session.isCurrent(token, '8|1')).toBe(false)
    session.renew()
    expect(session.isCurrent(token, '7|1')).toBe(false)
    expect(session.isCurrent(session.begin('7|1'), '7|1')).toBe(true)
  })
})
