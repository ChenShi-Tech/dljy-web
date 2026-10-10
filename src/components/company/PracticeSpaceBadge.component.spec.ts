// 守什么：练习空间顶栏徽标（ChenShi-Tech/dljy#3403）——只在当前公司是练习公司时渲染，
// 显示公司名与退出入口，点退出调用 exitPracticeSpace，根元素带 data-guide 定位锚点。
// 坏掉的症状：非练习公司也挂徽标误导用户；进了练习空间没有标识，导引数据被当成真实
// 经营数据；点退出不退出，用户被锁在练习上下文里。
// Issue: ChenShi-Tech/dljy#3403
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('@/services/company/practiceSpace', async () => {
  const { ref } = await import('vue')
  return {
    currentPracticeCompany: ref(null),
    exitPracticeSpace: vi.fn()
  }
})

import PracticeSpaceBadge from './PracticeSpaceBadge.vue'
import { currentPracticeCompany, exitPracticeSpace } from '@/services/company/practiceSpace'
import { mount } from '@/test/mount'

const practiceRef = currentPracticeCompany as unknown as ReturnType<typeof ref<{ companyId: string; name: string; parentCompanyId: string | null } | null>>

describe('PracticeSpaceBadge（练习空间顶栏徽标，#3403）', () => {
  beforeEach(() => {
    practiceRef.value = null
    vi.mocked(exitPracticeSpace).mockClear()
  })

  it('非练习公司 → 不渲染任何内容', () => {
    const wrapper = mount(PracticeSpaceBadge)
    expect(wrapper.find('[data-guide="practice-space-badge"]').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('练习公司 → 渲染「练习空间 · 公司名 · 退出」与 data-guide 锚点', () => {
    practiceRef.value = { companyId: 'comp-cgn-yunnan-practice', name: '【练习】中广核云南新能源', parentCompanyId: 'comp-cgn-yunnan' }
    const wrapper = mount(PracticeSpaceBadge)
    const root = wrapper.find('[data-guide="practice-space-badge"]')
    expect(root.exists()).toBe(true)
    expect(wrapper.text()).toContain('练习空间')
    expect(wrapper.text()).toContain('【练习】中广核云南新能源')
    const exit = wrapper.find('.practice-badge-exit')
    expect(exit.exists()).toBe(true)
    expect(exit.text()).toBe('退出')
  })

  it('点退出 → 调用 exitPracticeSpace', async () => {
    practiceRef.value = { companyId: 'comp-cgn-yunnan-practice', name: '【练习】中广核云南新能源', parentCompanyId: 'comp-cgn-yunnan' }
    const wrapper = mount(PracticeSpaceBadge)
    await wrapper.find('.practice-badge-exit').trigger('click')
    expect(exitPracticeSpace).toHaveBeenCalledTimes(1)
  })

  it('退出抛错 → 不向上冒泡打断用户', async () => {
    practiceRef.value = { companyId: 'comp-cgn-yunnan-practice', name: '【练习】中广核云南新能源', parentCompanyId: 'comp-cgn-yunnan' }
    vi.mocked(exitPracticeSpace).mockImplementation(() => {
      throw new Error('boom')
    })
    const wrapper = mount(PracticeSpaceBadge)
    await expect(wrapper.find('.practice-badge-exit').trigger('click')).resolves.toBeUndefined()
    expect(exitPracticeSpace).toHaveBeenCalledTimes(1)
    vi.mocked(exitPracticeSpace).mockRestore()
  })
})
