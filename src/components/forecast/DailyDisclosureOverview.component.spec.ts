import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { selectedCompanyId } from '@/services/company/companyContext'

vi.mock('@/services/company/companyContext', async () => {
  const { ref } = await import('vue')
  return { selectedCompanyId: ref('company-a') }
})

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
        DailyDisclosureTexts: true,
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
  window.localStorage.clear()
  selectedCompanyId.value = 'company-a'
})

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
})

describe('DailyDisclosureOverview', () => {
  // 不变量：同一数据集的不同统计范围都能独立选择，不能只露出默认范围或用空卡占位。
  it('逐曲线建立看板，勾选、全选与清空会立即更新图表', async () => {
    const data = dataset('load_forecast', 'forecast')
    data.series.push({ ...data.series[0], id: 'all', scope: 'all', scopeLabel: '南网全网' })
    api.loadDailyDisclosure.mockResolvedValue([data, dataset('missing', 'actual', 'empty')])
    const wrapper = await render()
    expect(wrapper.findAll('.dataset-card')).toHaveLength(2)
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('共 2 条可用曲线，已选择 2 条')
    expect(wrapper.html().indexOf('dataset-card')).toBeLessThan(wrapper.html().indexOf('id="daily-disclosure-texts"'))
    await wrapper.find('.daily-disclosure__board-head button').trigger('click')
    expect(wrapper.find('.daily-disclosure__board-head button').attributes('aria-expanded')).toBe('true')
    await wrapper.find('input[type="checkbox"]').setValue(false)
    expect(wrapper.findAll('.dataset-card')).toHaveLength(1)
    await wrapper.findAll('button').find((button) => button.text() === '清空选择')!.trigger('click')
    expect(wrapper.findAll('.dataset-card')).toHaveLength(0)
    expect(wrapper.text()).toContain('你尚未选择展示曲线')
    expect(wrapper.text()).not.toContain('该日期没有可展示的已导入数值记录')
    await wrapper.findAll('button').find((button) => button.text() === '显示全部曲线')!.trigger('click')
    expect(wrapper.findAll('.dataset-card')).toHaveLength(2)
  })

  // 不变量：搜索不是取消选择，重载、重新打开和换日不丢个人选择，不保存曲线数值。
  it('选择可记忆，搜索与换日不清空偏好', async () => {
    const data = dataset('load_forecast', 'forecast')
    data.series[0].id = JSON.stringify(['yn', '2026-06-26', 'load_forecast'])
    api.loadDailyDisclosure.mockResolvedValue([data, dataset('da_user_price', 'price')])
    const wrapper = await render()
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    await checkboxes.find((checkbox) => checkbox.attributes('aria-label')?.includes('load_forecast'))!.setValue(false)
    await wrapper.find('.search-input').setValue('load_forecast')
    expect(wrapper.findAll('.dataset-card')).toHaveLength(0)
    expect(wrapper.text()).toContain('当前搜索条件下没有已选曲线')
    await wrapper.find('.search-input').setValue('')
    expect(wrapper.findAll('.dataset-card')).toHaveLength(1)
    const next = { ...data, date: '2026-06-26', series: [{ ...data.series[0], targetDate: '2026-06-27', id: JSON.stringify(['yn', '2026-06-27', 'load_forecast']) }] }
    api.loadDailyDisclosure.mockResolvedValue([next, dataset('da_user_price', 'price')])
    await wrapper.setProps({ date: '2026-06-26' })
    await flushPromises()
    expect(wrapper.findAll('.dataset-card')).toHaveLength(1)
    wrapper.unmount()
    wrappers = []
    const reopened = await render({ regionId: 'yunnan', date: '2026-06-26' })
    expect(reopened.findAll('.dataset-card')).toHaveLength(1)
    expect(window.localStorage.getItem('dljy.disclosure-board.v1.yunnan.company-a')).not.toContain('points')
  })

  // 不变量：切公司即清空旧结果；其他公司的偏好或迟到响应不能串入当前看板。
  it('公司切换隔离偏好并丢弃旧公司响应', async () => {
    const pending = deferred<ReturnType<typeof dataset>[]>()
    api.loadDailyDisclosure.mockResolvedValueOnce([dataset('load_actual', 'actual')]).mockReturnValueOnce(pending.promise)
    const wrapper = await render()
    await wrapper.find('input[type="checkbox"]').setValue(false)
    selectedCompanyId.value = 'company-b'
    await flushPromises()
    expect(wrapper.findAll('.dataset-card')).toHaveLength(0)
    api.loadDailyDisclosure.mockResolvedValueOnce([dataset('da_user_price', 'price')])
    selectedCompanyId.value = 'company-c'
    await flushPromises()
    pending.resolve([dataset('load_actual', 'actual')])
    await flushPromises()
    expect(wrapper.findAll('.dataset-card')).toHaveLength(1)
    expect(wrapper.find('.dataset-card').text()).toContain('da_user_price')
    expect(wrapper.text()).not.toContain('load_actual-标题')
  })

  // 不变量：浏览器禁用或损坏存储时仍默认显示有效曲线，不能导致整页异常。
  it('损坏的偏好不影响首屏曲线', async () => {
    window.localStorage.setItem('dljy.disclosure-board.v1.yunnan.company-a', '{broken')
    api.loadDailyDisclosure.mockResolvedValueOnce([dataset('load_actual', 'actual')])
    const wrapper = await render()
    expect(wrapper.findAll('.dataset-card')).toHaveLength(1)
  })

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
    expect(wrapper.text()).toContain('该日期没有可展示的已导入数值记录')
    expect(wrapper.text()).not.toContain('该日期存在已接披露记录')
  })

  it('有原始行但无安全曲线时仍保留可核查卡片', async () => {
    const rawOnly = { ...dataset('load_actual', 'actual', 'partial'), series: [], rows: [{ timePoint: 'bad', value: 12 }] }
    api.loadDailyDisclosure.mockResolvedValueOnce([rawOnly])
    const wrapper = await render()
    expect(wrapper.findAll('.dataset-card')).toHaveLength(1)
    expect(wrapper.find('.coverage-table').exists()).toBe(true)
  })

  // 不变量：搜索命中原始行而非可绘图面板时，不能误报用户未勾选。
  it('存在其他曲线时，搜索仅命中原始记录会解释不可绘图原因', async () => {
    const rawOnly = { ...dataset('raw_only', 'actual', 'partial'), series: [], rows: [{ timePoint: 'bad', value: 12 }] }
    api.loadDailyDisclosure.mockResolvedValueOnce([rawOnly, dataset('load_actual', 'actual')])
    const wrapper = await render()
    await wrapper.find('.search-input').setValue('raw_only')
    expect(wrapper.text()).toContain('当日有原始记录，但暂没有可安全绘制')
    expect(wrapper.text()).not.toContain('当前搜索条件下没有已选曲线')
    expect(wrapper.findAll('details .dataset-card')).toHaveLength(1)
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
          DailyDisclosureTexts: true,
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
