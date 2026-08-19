// @vitest-environment happy-dom
// ↑ 勿删：本文件不是 *.component.spec.ts，vitest node project 默认不给 DOM；动画依赖
//   requestAnimationFrame + 组件生命周期（onMounted/onBeforeUnmount），靠此 pragma 切
//   happy-dom（其 rAF 由 16ms 定时器驱动，真跑动画收敛，不 mock 时间轴）。
// composables/useCountUp.spec.ts — 数字滚动动画 + fmtNum 防御格式化回归
// 守什么不变量：
//   ① 动画从 '0' 出发、按 zh-CN 千分位格式收敛到目标值（easeOutCubic 中间轨迹属
//      实现细节，只钉两端：起点可观测、终点精确）。
//   ② decimals 控制小数位（minimumFractionDigits=maximumFractionDigits）。
//   ③ 卸载清理：onBeforeUnmount 取消未完成的动画帧/延迟，卸载后不再写 ref（泄漏 +
//      Vue 警告），动画冻结在中间值而非继续推进。
//   ④ fmtNum 防御：undefined/NaN/null 一律落 0（图表空系列 tooltip 不许崩调度）。
// 坏掉的症状：数字卡在 0 或中间值不收敛；切换页面后控制台「组件已卸载仍写 ref」告警；
// 空 tooltip 直接 throw 阻塞渲染。
import { defineComponent, h, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { fmtNum, useCountUp } from './useCountUp'

/** 挂载一个调用 useCountUp 的宿主组件（生命周期 hook 需组件上下文），交出 ref 与 wrapper。 */
function mountCountUp(target: number, opts: { duration?: number; decimals?: number; delay?: number } = {}) {
  let out!: Ref<string>
  const Comp = defineComponent({
    setup() {
      out = useCountUp(target, opts)
      return () => h('div')
    }
  })
  const wrapper = mount(Comp)
  return { wrapper, out }
}

describe('useCountUp', () => {
  it('从 0 出发，收敛到目标值（zh-CN 千分位）', async () => {
    const { out } = mountCountUp(1234, { duration: 150 })

    expect(out.value).toBe('0')
    await vi.waitFor(() => expect(out.value).toBe('1,234'))
  })

  it('decimals 固定小数位：1234.5 两位小数 → 1,234.50', async () => {
    const { out } = mountCountUp(1234.5, { duration: 150, decimals: 2 })

    await vi.waitFor(() => expect(out.value).toBe('1,234.50'))
  })

  it('目标为 0 → 收敛到 0', async () => {
    const { out } = mountCountUp(0, { duration: 150 })

    await vi.waitFor(() => expect(out.value).toBe('0'))
  })

  it('delay 期间保持 0，delay 结束后正常完成', async () => {
    const { out } = mountCountUp(42, { duration: 150, delay: 120 })

    expect(out.value).toBe('0')
    await vi.waitFor(() => expect(out.value).toBe('42'), { timeout: 2000 })
  })

  it('卸载清理（delay 挂起期）：unmount 取消延迟启动，动画永不开始', async () => {
    const { wrapper, out } = mountCountUp(42, { duration: 150, delay: 250 })

    wrapper.unmount()
    await new Promise((r) => setTimeout(r, 500)) // delay+duration 全程已过

    expect(out.value).toBe('0') // clearTimeout 生效：动画从未写入
  })

  it('卸载清理（动画进行中）：unmount 后冻结在中间值，不再推进到终点', async () => {
    const { wrapper, out } = mountCountUp(1234, { duration: 5000 })

    await new Promise((r) => setTimeout(r, 120)) // 动画推进到 ~2%（easeOut 早期）
    wrapper.unmount()
    await new Promise((r) => setTimeout(r, 200))

    expect(out.value).not.toBe('1,234') // cancelAnimationFrame 生效：终点永远不会到达
    expect(out.value).not.toBe('0') // 且确实推进过（非 delay 场景），冻结在中间
  })
})

describe('fmtNum · 防御性格式化', () => {
  it('千分位 + 指定小数位', () => {
    expect(fmtNum(1234567)).toBe('1,234,567')
    expect(fmtNum(1234567.891)).toBe('1,234,568') // maximumFractionDigits=0 四舍五入
    expect(fmtNum(1234567.891, 2)).toBe('1,234,567.89')
    expect(fmtNum(0.5, 2)).toBe('0.50')
    expect(fmtNum(42)).toBe('42')
  })

  it('undefined/NaN/null 一律落 0，不抛错（空 tooltip 防崩）', () => {
    expect(fmtNum(undefined as unknown as number)).toBe('0')
    expect(fmtNum(NaN)).toBe('0')
    expect(fmtNum(null as unknown as number)).toBe('0')
  })
})
