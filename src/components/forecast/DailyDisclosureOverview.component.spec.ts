import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'

const api = vi.hoisted(() => ({
  loadDailyDisclosure: vi.fn(),
}))

vi.mock('@/services/forecast/dailyDisclosure', () => ({
  DISCLOSURE_GROUPS: [
    { id: 'price', label: '结算价格' },
    { id: 'forecast', label: '系统预测' },
    { id: 'actual', label: '实际运行' },
    { id: 'balance', label: '跨省与供需' },
  ],
  loadDailyDisclosure: api.loadDailyDisclosure,
}))

const disclosureCardStub = defineComponent({
  name: 'DisclosureDatasetCard',
  props: { dataset: { type: Object, required: true } },
  setup(_, { expose }) {
    const resize = vi.fn()
    expose({ resize })
    return { resize }
  },
  template: '<div class="dataset-card">{{ dataset.spec.title }}</div>',
})

import DailyDisclosureOverview from './DailyDisclosureOverview.vue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function dataset(id: string, group: 'price' | 'forecast' | 'actual' | 'balance', status: 'ready' | 'partial' | 'empty' | 'error' = 'ready') {
  return {
    spec: {
      id,
      family: 'yn_system_forecast',
      title: `${id}-标题`,
      group,
      nature: group === 'price' ? 'price' : group === 'actual' ? 'actual' : 'forecast',
      unit: group === 'price' ? '元/MWh' : '原始值',
      slots: group === 'price' ? 24 : 96,
    },
    date: '2026-06-25',
    status,
    rows: [],
    series: status === 'empty' || status === 'error'
      ? []
      : [{
          id,
          label: `${id}-曲线`,
          scope: 'yn',
          scopeLabel: '云南省内',
          targetDate: group === 'actual' ? null : '2026-06-26',
          unit: group === 'price' ? '元/MWh' : '原始值',
          labels: ['00:00'],
          points: [100],
          previous: [90],
          validPoints: 1,
          expectedPoints: group === 'price' ? 24 : 96,
          conflicts: 0,
        }],
    warnings: status === 'partial' ? ['存在缺口'] : [],
    error: status === 'error' ? '读取失败' : '',
    sourceLabel: '已导入披露 · 真实数据回放',
    capturedAt: '2026-06-25T10:00:00+08:00',
    ingestedAt: '2026-06-25T10:02:00+08:00',
  }
}

const stubs = {
  ElButton: {
    props: ['type', 'loading', 'disabled'],
    emits: ['click'],
    template: '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
  },
  ElInput: {
    props: ['modelValue', 'clearable', 'placeholder'],
    emits: ['update:modelValue'],
    template: '<input class="search-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  ElAlert: { props: ['title'], template: '<div class="alert">{{ title }}</div>' },
  ElTable: { template: '<div class="coverage-table"><slot /></div>' },
  ElTableColumn: { template: '<div />' },
}

let wrappers: VueWrapper[] = []

async function render(props = { regionId: 'yunnan', date: '2026-06-25' }) {
  const wrapper = mount(DailyDisclosureOverview, {
    props,
    global: {
      stubs: {
        ...stubs,
        DisclosureDatasetCard: disclosureCardStub,
      },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  api.loadDailyDisclosure.mockReset()
})

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
})

describe('DailyDisclosureOverview', () => {
  it('无日期时不发请求，并提示先选择日期', async () => {
    const wrapper = await render({ regionId: 'yunnan', date: '' })
    expect(api.loadDailyDisclosure).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请先在页面顶部选择日期')
    expect((wrapper.find('button').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('加载成功后只渲染可绘制数据集，并保留覆盖清单', async () => {
    api.loadDailyDisclosure.mockResolvedValueOnce([
      dataset('da_user_price', 'price'),
      dataset('load_forecast', 'forecast', 'partial'),
      dataset('hydro_actual', 'actual', 'empty'),
      dataset('yn_system_supply_demand', 'balance', 'error'),
    ])
    const wrapper = await render()
    expect(api.loadDailyDisclosure).toHaveBeenCalledWith('yunnan', '2026-06-25')
    expect(wrapper.findAll('.dataset-card')).toHaveLength(2)
    expect(wrapper.find('.coverage-table').exists()).toBe(true)
    expect(wrapper.text()).toContain('4 个已接数据集')
  })

  it('地区切到非云南时清空旧结果且不再请求', async () => {
    api.loadDailyDisclosure.mockResolvedValueOnce([dataset('load_forecast', 'forecast')])
    const wrapper = await render()
    expect(wrapper.findAll('.dataset-card')).toHaveLength(1)
    await wrapper.setProps({ regionId: 'guangdong' })
    await flushPromises()
    expect(wrapper.findAll('.dataset-card')).toHaveLength(0)
    expect(wrapper.text()).toContain('当前只接入云南公开数据')
  })

  it('全空日期不冒称存在原始记录，也不画空占位框', async () => {
    api.loadDailyDisclosure.mockResolvedValueOnce([dataset('load_actual', 'actual', 'empty')])
    const wrapper = await render()
    expect(wrapper.findAll('.dataset-card')).toHaveLength(0)
    expect(wrapper.text()).toContain('该日期没有可展示的已导入记录')
    expect(wrapper.text()).not.toContain('该日期存在已接披露记录')
  })

  it('有原始行但无安全曲线时仍保留可核查卡片', async () => {
    const rawOnly = { ...dataset('load_actual', 'actual', 'partial'), series: [], rows: [{ timePoint: 'bad', value: 12 }] }
    api.loadDailyDisclosure.mockResolvedValueOnce([rawOnly])
    const wrapper = await render()
    expect(wrapper.findAll('.dataset-card')).toHaveLength(1)
    expect(wrapper.find('.coverage-table').exists()).toBe(true)
  })

  it('搜索卸载后 resize 仅调用当前卡片，清除搜索可恢复卡片', async () => {
    api.loadDailyDisclosure.mockResolvedValueOnce([dataset('load_actual', 'actual'), dataset('da_user_price', 'price')])
    const wrapper = await render()
    const stale = wrapper.findAllComponents(disclosureCardStub).find((card) => card.text().includes('da_user_price'))!
    const oldResize = stale.vm.resize
    await wrapper.find('.search-input').setValue('load_actual')
    ;(wrapper.vm as unknown as { resize: () => void }).resize()
    expect(oldResize).not.toHaveBeenCalled()
    expect(wrapper.findAll('.dataset-card')).toHaveLength(1)
    await wrapper.find('.search-input').setValue('')
    expect(wrapper.findAll('.dataset-card')).toHaveLength(2)
  })

  it('失败可重试，采集时间不会说成业务数据截止日', async () => {
    api.loadDailyDisclosure.mockRejectedValueOnce(new Error('公开数据读取失败'))
    const wrapper = await render()
    expect(wrapper.text()).toContain('公开数据读取失败')
    api.loadDailyDisclosure.mockResolvedValueOnce([dataset('load_actual', 'actual')])
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('最近采集/导入时间')
    expect(wrapper.text()).not.toContain('当前已导入数据截止')
    expect(wrapper.findAll('.dataset-card')).toHaveLength(1)
  })

  it('卸载后丢弃迟到响应', async () => {
    const pending = deferred<ReturnType<typeof dataset>[]>()
    api.loadDailyDisclosure.mockReturnValueOnce(pending.promise)
    const wrapper = await render()
    wrapper.unmount()
    wrappers = []
    pending.resolve([dataset('load_actual', 'actual')])
    await flushPromises()
    expect(wrapper.findAll('.dataset-card')).toHaveLength(0)
  })

  it('A→B→A 的迟到响应不会回写旧结果', async () => {
    const first = deferred<ReturnType<typeof dataset>[]>()
    const second = deferred<ReturnType<typeof dataset>[]>()
    const third = deferred<ReturnType<typeof dataset>[]>()
    api.loadDailyDisclosure
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise)

    const wrapper = mount(DailyDisclosureOverview, {
      props: { regionId: 'yunnan', date: '2026-06-25' },
      global: {
        stubs: {
          ...stubs,
          DisclosureDatasetCard: disclosureCardStub,
        },
      },
    })
    wrappers.push(wrapper)

    await wrapper.setProps({ date: '2026-06-26' })
    await wrapper.setProps({ date: '2026-06-25' })
    third.resolve([dataset('load_forecast', 'forecast')])
    await flushPromises()
    first.resolve([dataset('da_user_price', 'price')])
    second.resolve([dataset('hydro_actual', 'actual')])
    await flushPromises()

    expect(wrapper.text()).toContain('load_forecast-标题')
    expect(wrapper.text()).not.toContain('da_user_price-标题')
    expect(wrapper.text()).not.toContain('hydro_actual-标题')
  })
})
