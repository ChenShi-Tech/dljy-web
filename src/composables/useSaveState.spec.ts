// 契约与 6 个历史副本一致：前置清态、成功写 saveMsg（save() 返回值）、
// 失败写 saveError（Error.message 优先，否则 errorFallback）、无论成败 finally 复位 saving。
import { describe, expect, it } from 'vitest'
import { useSaveState } from '@/composables/useSaveState'

describe('useSaveState 写回三态', () => {
  it('成功路径：saving 复位为 false，saveMsg 取 save() 返回文案，saveError 保持空', async () => {
    const { saving, saveMsg, saveError, runSave } = useSaveState()
    await runSave(async () => '市场判断已写回，S3 方向判断可直接读取')
    expect(saving.value).toBe(false)
    expect(saveMsg.value).toBe('市场判断已写回，S3 方向判断可直接读取')
    expect(saveError.value).toBe('')
  })

  it('失败路径：Error 抛出时 saveError 取 e.message，saving 仍复位', async () => {
    const { saving, saveMsg, saveError, runSave } = useSaveState()
    await runSave(async () => {
      throw new Error('preflight 校验失败')
    }, { errorFallback: '写回失败' })
    expect(saving.value).toBe(false)
    expect(saveMsg.value).toBe('')
    expect(saveError.value).toBe('preflight 校验失败')
  })

  it('非 Error 抛出物回退到 errorFallback；未传时用默认「写回失败」', async () => {
    const a = useSaveState()
    await a.runSave(async () => {
      throw '字符串异常'
    }, { errorFallback: '保存失败' })
    expect(a.saveError.value).toBe('保存失败')

    const b = useSaveState()
    await b.runSave(async () => {
      throw 42
    })
    expect(b.saveError.value).toBe('写回失败')
  })

  it('并发语义：每次 runSave 先清空上一次的 msg/error', async () => {
    const { saveMsg, saveError, runSave } = useSaveState()
    await runSave(async () => '第一次成功')
    await runSave(async () => {
      throw new Error('第二次失败')
    }, { errorFallback: '写回失败' })
    expect(saveMsg.value).toBe('')
    expect(saveError.value).toBe('第二次失败')
  })
})
