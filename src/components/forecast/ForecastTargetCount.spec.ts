// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import ForecastTargetCount from './ForecastTargetCount.vue'

const slot = { template: '<div><slot/></div>' }

describe('ForecastTargetCount', () => {
  it('点击支持目标数后展示输出目标说明，而不是协变量说明', async () => {
    const wrapper = mount(ForecastTargetCount, {
      props: {
        modelName: '测试模型',
        targets: ['price_user_da_settlement', 'load'],
        declared: true,
      },
      global: {
        stubs: {
          ElButton: { props: ['ariaLabel'], emits: ['click'], template: '<button @click="$emit(\'click\')"><slot/></button>' },
          ElDialog: slot,
          ElEmpty: { props: ['description'], template: '<p>{{description}}</p>' },
        },
      },
    })

    expect(wrapper.text()).toContain('2')
    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('用户侧日前统一结算电价')
    expect(wrapper.text()).toContain('统调负荷')
    expect(wrapper.text()).toContain('不是输入协变量的数量')
  })

  it('单一已接入目标始终只计 1 个，不把协变量数量混进来', async () => {
    const wrapper = mount(ForecastTargetCount, {
      props: {
        modelName: '单目标模型',
        targets: ['price'],
        declared: true,
      },
      global: {
        stubs: {
          ElButton: { props: ['ariaLabel'], emits: ['click'], template: '<button @click="$emit(\'click\')"><slot/></button>' },
          ElDialog: slot,
          ElEmpty: { props: ['description'], template: '<p>{{description}}</p>' },
        },
      },
    })

    expect(wrapper.text()).toContain('1')
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('现货出清电价')
    expect(wrapper.text()).toContain('不是输入协变量的数量')
  })

  it('旧目录未登记输出目标时，不把兼容全集当作已确认能力', async () => {
    const wrapper = mount(ForecastTargetCount, {
      props: {
        modelName: '旧模型',
        targets: ['price', 'load'],
        declared: false,
      },
      global: {
        stubs: {
          ElButton: { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot/></button>' },
          ElDialog: slot,
          ElEmpty: { props: ['description'], template: '<p>{{description}}</p>' },
        },
      },
    })

    expect(wrapper.text()).toContain('未登记')
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('未登记输出目标的通用算法不视为已训练模型')
  })
})
