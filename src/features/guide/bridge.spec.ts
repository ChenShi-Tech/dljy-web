// 导引桥（bridge）的注册注销纪律（ChenShi-Tech/dljy#3404）。
// 守什么：同 key 多处注册时注销只清自己这一条、读值按 active() 选生效表单；
// fill / submit 的返回值语义；信号订阅注销与「回调里注销自己不打断别人」。
// 坏掉的症状：KeepAlive 下列表页与详情页并存时，一个页面卸载把另一个页面同 key 的
// 表单一起注销掉，「帮我填」从此失效；或信号回调互相覆盖丢事件。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref, watch } from 'vue'
import {
  emitGuideSignal, fillGuideForm, onGuideSignal, readGuideForm, readGuideState, registerGuideForm,
  resetGuideBridge, submitGuideForm, useGuideState,
} from './bridge'

afterEach(() => resetGuideBridge())

describe('表单注册', () => {
  it('同 key 多处注册：注销只清自己，另一个注册不受影响', () => {
    const a = reactive({ v: 'a' })
    const b = reactive({ v: 'b' })
    const disposeA = registerGuideForm('k', a)
    registerGuideForm('k', b)
    expect(readGuideForm('k')).toMatchObject({ v: 'a' })
    disposeA()
    expect(readGuideForm('k')).toMatchObject({ v: 'b' })
  })

  it('同 key 多处注册：按 active() 取第一个生效的（KeepAlive 下旧页面 inactive）', () => {
    const stale = reactive({ v: 'stale' })
    const live = reactive({ v: 'live' })
    registerGuideForm('k', stale, () => false)
    registerGuideForm('k', live, () => true)
    expect(readGuideForm('k')).toMatchObject({ v: 'live' })
  })

  it('fill：无生效表单返回 false 不抛错；有表单写入并返回 true', () => {
    expect(fillGuideForm('none', { x: 1 })).toBe(false)
    const form = reactive({ x: '' })
    registerGuideForm('k', form)
    expect(fillGuideForm('k', { x: '1' })).toBe(true)
    expect(form.x).toBe('1')
  })

  it('submit：reactive 对象没有 submit 返回 false；适配器带 submit 才被调用', async () => {
    const plain = reactive({ x: '' })
    registerGuideForm('plain', plain)
    await expect(submitGuideForm('plain')).resolves.toBe(false)

    const submit = vi.fn()
    registerGuideForm('adapter', { read: () => ({ x: '1' }), fill: () => {}, submit })
    await expect(submitGuideForm('adapter')).resolves.toBe(true)
    expect(submit).toHaveBeenCalledTimes(1)
  })
})

describe('状态快照注册', () => {
  it('后来的注册覆盖同 key，先来的注销不误删别人的', () => {
    useGuideState('s', () => ({ who: 'first' }))
    const disposeSecond = useGuideState('s', () => ({ who: 'second' }))
    expect(readGuideState('s')).toMatchObject({ who: 'second' })
    // second 注销后没有注册者了：first 已被覆盖，不应残留误删 / 误还原。
    disposeSecond()
    expect(readGuideState('s')).toBeNull()
  })
})

describe('登记表响应式（推进条件先挂、页面后登记）', () => {
  it('watch 先于 useGuideState 登记挂上：页面登记后与状态变化都能被感知', async () => {
    const seen: Array<object | null> = []
    const stop = watch(() => readGuideState('late'), (v) => { seen.push(v) })
    const months = ref<string[]>([])
    useGuideState('late', () => ({ months: months.value }))
    await nextTick()
    expect(seen.at(-1)).toEqual({ months: [] })
    months.value = ['2026-10']
    await nextTick()
    expect(seen.at(-1)).toEqual({ months: ['2026-10'] })
    stop()
  })

  it('watch 先于表单登记挂上：表单登记后能读到值', async () => {
    const seen: Array<Record<string, unknown> | null> = []
    const stop = watch(() => readGuideForm('lateForm'), (v) => { seen.push(v) })
    registerGuideForm('lateForm', reactive({ subjectKey: 'X' }))
    await nextTick()
    expect(seen.at(-1)).toEqual({ subjectKey: 'X' })
    stop()
  })
})

describe('信号', () => {
  it('订阅收到 payload 的浅拷贝语义：注销后不再收', () => {
    const got: unknown[] = []
    const off = onGuideSignal('sig', (payload) => got.push(payload))
    emitGuideSignal('sig', { id: 1 })
    off()
    emitGuideSignal('sig', { id: 2 })
    expect(got).toEqual([{ id: 1 }])
  })

  it('回调里注销自己不打断其它订阅（复制后遍历）', () => {
    const seen: string[] = []
    const offSelf = onGuideSignal('sig', () => {
      seen.push('self')
      offSelf()
    })
    onGuideSignal('sig', () => seen.push('other'))
    emitGuideSignal('sig')
    emitGuideSignal('sig')
    expect(seen).toEqual(['self', 'other', 'other'])
  })
})
