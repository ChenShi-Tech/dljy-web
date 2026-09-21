import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import DisclosureMetricPicker from './DisclosureMetricPicker.vue'

const groups = [
  { id: 'price', label: '市场电价', metrics: [{ id: 'price', label: '用户侧统一电价' }] },
  { id: 'load', label: '负荷与供需', metrics: [{ id: 'load', label: '负荷预测与实际' }, { id: 'non-market', label: '非市场化电源出力' }] },
  { id: 'new-energy', label: '新能源与水电', metrics: [{ id: 'hydro', label: '水电实际出力' }, { id: 'hydro-week', label: '水电周平均出力预测' }] },
  { id: 'transmission', label: '联络线与断面', metrics: [{ id: 'key-line', label: '关键线路与变压器实际潮流' }] },
]
const cleanup: Array<() => void> = []
function mountPicker(modelValue = 'price') {
  const host = document.createElement('div')
  document.body.append(host)
  const wrapper = mount(DisclosureMetricPicker, { attachTo: host, props: { modelValue, groups } })
  cleanup.push(() => { wrapper.unmount(); host.remove() })
  return wrapper
}
async function openPicker(wrapper: ReturnType<typeof mountPicker>) {
  wrapper.get<HTMLInputElement>('[role="combobox"]').element.focus()
  await wrapper.get('.el-select__wrapper').trigger('click')
  await flushPromises()
}
function options() { return [...document.querySelectorAll<HTMLElement>('.disclosure-metric-menu [role="option"]')] }
function visibleOptions() { return options().filter(option => option.style.display !== 'none') }
function option(id: string) { const item = options().find(item => item.dataset.metricId === id); if (!item) throw new Error(`Missing metric ${id}`); return item }
afterEach(async () => { cleanup.splice(0).forEach(dispose => dispose()); await flushPromises() })

describe('主图指标分组搜索选择器', () => {
  it('保留可访问名称和当前值，展开分组菜单并标明当前选项', async () => {
    const wrapper = mountPicker()
    await flushPromises()
    expect(wrapper.classes()).toContain('metric-picker')
    const input = wrapper.get('[role="combobox"]')
    expect(input.attributes('aria-label')).toBe('主图指标')
    expect(input.attributes('aria-expanded')).toBe('false')
    expect(wrapper.text()).toContain('用户侧统一电价')
    await openPicker(wrapper)
    expect(input.attributes('aria-expanded')).toBe('true')
    expect(document.querySelector('[role="listbox"][aria-label="主图指标"]')).not.toBeNull()
    expect([...document.querySelectorAll('.disclosure-metric-menu .el-select-group__title')].map(item => item.textContent)).toEqual(groups.map(group => group.label))
    expect(option('price').getAttribute('aria-selected')).toBe('true')
    expect(option('price').querySelector('.disclosure-metric-option-check')).not.toBeNull()
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('输入筛选指标而不立即切换曲线，点击结果才发出一次选择与change', async () => {
    const wrapper = mountPicker()
    await openPicker(wrapper)
    await wrapper.get('[role="combobox"]').setValue('水电')
    await flushPromises()
    expect(visibleOptions().map(item => item.dataset.metricId)).toEqual(['hydro', 'hydro-week'])
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.emitted('change')).toBeUndefined()
    option('hydro-week').click()
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toEqual([['hydro-week']])
    expect(wrapper.emitted('change')).toEqual([[]])
    await wrapper.setProps({ modelValue: 'hydro-week' })
    expect(wrapper.get('[role="combobox"]').attributes('aria-expanded')).toBe('false')
    expect(wrapper.text()).toContain('水电周平均出力预测')
  })

  it('无匹配时提供中文空态，清空搜索恢复全部指标', async () => {
    const wrapper = mountPicker()
    await openPicker(wrapper)
    const input = wrapper.get('[role="combobox"]')
    await input.setValue('不可能存在的指标')
    await flushPromises()
    expect(visibleOptions()).toHaveLength(0)
    expect(document.querySelector('.disclosure-metric-menu .el-select-dropdown__empty')?.textContent).toContain('没有匹配的指标')
    await input.setValue('')
    await flushPromises()
    expect(visibleOptions()).toHaveLength(groups.reduce((count, group) => count + group.metrics.length, 0))
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('方向键导航并用Enter选择，保持输入焦点以继续键盘操作', async () => {
    const wrapper = mountPicker()
    const input = wrapper.get<HTMLInputElement>('[role="combobox"]')
    input.element.focus()
    await input.trigger('keydown', { key: 'ArrowDown', code: 'ArrowDown' })
    await flushPromises()
    expect(input.attributes('aria-expanded')).toBe('true')
    await input.trigger('keydown', { key: 'ArrowDown', code: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter', code: 'Enter' })
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toEqual([['load']])
    expect(wrapper.emitted('change')).toEqual([[]])
    expect(input.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(input.element)
  })

  it('搜索后Enter选择首个匹配项，Escape遵循组件库清搜索和关闭行为', async () => {
    const wrapper = mountPicker()
    await openPicker(wrapper)
    const input = wrapper.get<HTMLInputElement>('[role="combobox"]')
    await input.setValue('关键线路')
    await flushPromises()
    await input.trigger('keydown', { key: 'Enter', code: 'Enter' })
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toEqual([['key-line']])
    await wrapper.setProps({ modelValue: 'key-line' })
    await openPicker(wrapper)
    await input.setValue('水电')
    await flushPromises()
    await input.trigger('keydown', { key: 'Escape', code: 'Escape' })
    await flushPromises()
    expect(input.element.value).toBe('')
    await input.trigger('keydown', { key: 'Escape', code: 'Escape' })
    await flushPromises()
    expect(input.attributes('aria-expanded')).toBe('false')
    expect(wrapper.emitted('change')).toHaveLength(1)
    expect(document.activeElement).toBe(input.element)
  })

  it('点击外部关闭菜单，重选当前指标不产生重复change', async () => {
    const wrapper = mountPicker()
    await openPicker(wrapper)
    option('price').click()
    await flushPromises()
    expect(wrapper.emitted('change')).toBeUndefined()
    await openPicker(wrapper)
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    await flushPromises()
    expect(wrapper.get('[role="combobox"]').attributes('aria-expanded')).toBe('false')
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('外部主题切换更新当前标题和勾选，不擅自发出change', async () => {
    const wrapper = mountPicker()
    await wrapper.setProps({ modelValue: 'key-line' })
    await flushPromises()
    expect(wrapper.text()).toContain('关键线路与变压器实际潮流')
    await openPicker(wrapper)
    expect(option('price').getAttribute('aria-selected')).toBe('false')
    expect(option('key-line').getAttribute('aria-selected')).toBe('true')
    expect(option('key-line').querySelector('.disclosure-metric-option-check')).not.toBeNull()
    expect(wrapper.emitted('change')).toBeUndefined()
  })
})
