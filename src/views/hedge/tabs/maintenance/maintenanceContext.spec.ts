// 维护写请求收口 useMaintenanceWrite 单测（ChenShi-Tech/dljy#3423，HW-10）。
//
// 守的不变量：写请求进行中再次提交直接忽略（不依赖按钮禁用）；成功先 notifyDataChanged 再交给调用方收尾；
// 过期响应（切公司/地区后才回来）既不收尾也不报错；切换后发起的新写请求不会被旧请求的收尾提前解锁；只读时不发请求。
// 坏掉的症状：双击生成两个版本；写入成功今明页签不重取；上一家公司的保存结果显示在新公司页面上。
import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useMaintenanceWrite } from './maintenanceContext'
import type { MaintenanceContext } from './maintenanceContext'
import { maintenanceFailureOf } from '@/services/hedge/hedgeMaintenanceModel'

function fakeContext() {
  let generation = 0
  const writable = ref(true)
  const notifyDataChanged = vi.fn()
  const context = {
    workbench: { notifyDataChanged },
    // 写请求只随公司/地区切换作废（#221 审查 R1-01）：桩里用 generation 模拟切公司。
    contextRequest: () => {
      const mine = generation
      return () => mine === generation
    },
    writable: computed(() => writable.value),
    failureOf: maintenanceFailureOf,
  } as unknown as MaintenanceContext
  return { context, writable, notifyDataChanged, switchCompany: () => { generation += 1 } }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (err: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useMaintenanceWrite', () => {
  it('进行中再次提交被忽略；成功先通知重取再收尾，收尾时仍可关闭表单', async () => {
    const { context, notifyDataChanged } = fakeContext()
    const writer = useMaintenanceWrite(context)
    const pending = deferred<string>()
    const send = vi.fn(() => pending.promise)
    const order: string[] = []
    notifyDataChanged.mockImplementation(() => order.push('notify'))
    const onSuccess = vi.fn(() => { order.push('success') })
    const first = writer.run('save', send, { onSuccess, onFailure: vi.fn() })
    expect(writer.busy.value).toBe('save')
    expect(await writer.run('save', send, { onSuccess, onFailure: vi.fn() })).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
    pending.resolve('ok')
    expect(await first).toBe(true)
    expect(order).toEqual(['notify', 'success'])
    expect(onSuccess).toHaveBeenCalledWith('ok')
    expect(writer.busy.value).toBeNull()
  })

  it('失败交给 onFailure（已换算成提示），不通知重取', async () => {
    const { context, notifyDataChanged } = fakeContext()
    const writer = useMaintenanceWrite(context)
    const onFailure = vi.fn()
    const err = Object.assign(new Error('已被他人更新'), { status: 409, errorCode: 'VERSION_CONFLICT', details: null })
    expect(await writer.run('save', () => Promise.reject(err), { onSuccess: vi.fn(), onFailure })).toBe(false)
    expect(onFailure.mock.calls[0]![0].text).toContain('刷新后核对再重试')
    expect(notifyDataChanged).not.toHaveBeenCalled()
    expect(writer.busy.value).toBeNull()
  })

  it('切公司后才回来的旧响应：不收尾、不通知；reset 后新请求不被旧请求的收尾解锁', async () => {
    const { context, notifyDataChanged, switchCompany } = fakeContext()
    const writer = useMaintenanceWrite(context)
    const stale = deferred<string>()
    const onSuccess = vi.fn()
    const first = writer.run('save', () => stale.promise, { onSuccess, onFailure: vi.fn() })
    switchCompany()
    writer.reset()
    const fresh = deferred<string>()
    const second = writer.run('save', () => fresh.promise, { onSuccess: vi.fn(), onFailure: vi.fn() })
    stale.resolve('old')
    expect(await first).toBe(false)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(notifyDataChanged).not.toHaveBeenCalled()
    expect(writer.busy.value).toBe('save')
    fresh.resolve('new')
    expect(await second).toBe(true)
    expect(writer.busy.value).toBeNull()
  })

  it('只读时不发请求', async () => {
    const { context, writable } = fakeContext()
    writable.value = false
    const writer = useMaintenanceWrite(context)
    const send = vi.fn(async () => 'ok')
    expect(await writer.run('save', send, { onSuccess: vi.fn(), onFailure: vi.fn() })).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})
