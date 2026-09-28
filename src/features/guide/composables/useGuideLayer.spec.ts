// 导引浮层层级（ChenShi-Tech/dljy#3404）。
// 守什么：目标换成新元素时重新取 z-index（盖过之后才打开的对话框）；同一元素重复解析不取号。
// 坏掉的症状：进入对话框里的步骤后，卡片和高亮环落在对话框遮罩下面看不见（实机走查踩到过）。
import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'
import { useGuideLayer } from './useGuideLayer'

function counter(start: number) {
  let n = start
  return () => ++n
}

describe('useGuideLayer', () => {
  it('初始取一次；目标换成新元素时重新取号，同一元素重复赋值不取号，目标消失保持原值', () => {
    const target = shallowRef<HTMLElement | null>(null)
    const z = useGuideLayer(target, counter(2010))
    expect(z.value).toBe(2011)
    const pageButton = {} as HTMLElement
    target.value = pageButton
    expect(z.value).toBe(2012)
    target.value = pageButton
    expect(z.value).toBe(2012)
    const dialogField = {} as HTMLElement
    target.value = dialogField
    expect(z.value).toBe(2013)
    target.value = null
    expect(z.value).toBe(2013)
  })
})
