// @vitest-environment happy-dom
// ↑ 勿删：本文件不是 *.component.spec.ts，vitest node project 默认不给 DOM；composable
//   依赖的 regionContext 顶层读写 localStorage，靠此 pragma 按文件切到 happy-dom。
// composables/useRegionReload.spec.ts — 切区重载封装回归
// 守什么不变量：
//   ① onRegionChange 只在「地区 id 实际变化」后触发 reload，首屏由各页自身
//      onMounted 负责，注册时不立即执行（无 immediate）。
//   ② 地区隔离红线：切区必须重载数据（旧地区数据不可沿用），坏掉的症状是
//      切区后页面仍显示他省回放数据。
//   ③ reload 支持返回 Promise（异步重载），由封装 void 掉不阻塞。
//
// regionContext 走真实模块：切区用真实 setCurrentRegionId（连带验证其
// isSelectableRegion 守卫对非法 id 的拒绝不会误触发重载）。
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentRegionId } from '../services/region/regionContext'
import { onRegionChange } from './useRegionReload'

describe('onRegionChange', () => {
  beforeEach(() => {
    setCurrentRegionId('yunnan') // 归位（上一用例可能已切区）
  })

  it('注册时不立即执行（无 immediate，首屏由各页 onMounted 负责）', async () => {
    const reload = vi.fn()
    onRegionChange(reload)
    await nextTick()
    expect(reload).not.toHaveBeenCalled()
  })

  it('切区后触发 reload 一次', async () => {
    const reload = vi.fn()
    onRegionChange(reload)

    setCurrentRegionId('shanxi')
    await nextTick()

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('连续切区逐次触发（云南→山西→云南共两次）', async () => {
    const reload = vi.fn()
    onRegionChange(reload)

    setCurrentRegionId('shanxi')
    await nextTick()
    setCurrentRegionId('yunnan')
    await nextTick()

    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('setCurrentRegionId 同 id（无实际变化）不触发', async () => {
    const reload = vi.fn()
    onRegionChange(reload)

    setCurrentRegionId('yunnan')
    await nextTick()

    expect(reload).not.toHaveBeenCalled()
  })

  it('setCurrentRegionId 非法 id 被守卫拒绝：不切区、不触发、不抛错', async () => {
    const reload = vi.fn()
    onRegionChange(reload)

    expect(() => setCurrentRegionId('not-a-region')).not.toThrow()
    await nextTick()

    expect(reload).not.toHaveBeenCalled()
  })

  it('reload 返回 Promise（异步重载）同样被调用', async () => {
    const reload = vi.fn().mockResolvedValue(undefined)
    onRegionChange(reload)

    setCurrentRegionId('shanxi')
    await nextTick()

    expect(reload).toHaveBeenCalledTimes(1)
  })
})
