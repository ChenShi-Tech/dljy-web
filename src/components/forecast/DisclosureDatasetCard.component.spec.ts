import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'

const chartSpy = vi.hoisted(() => ({
  setOption: vi.fn(),
  resize: vi.fn(),
  showLoading: vi.fn(),
  hideLoading: vi.fn(),
  dispose: vi.fn(),
  instance: vi.fn(),
}))

vi.mock('@/composables/useEChart', () => ({
  useEChart: () => chartSpy,
}))

import DisclosureDatasetCard from './DisclosureDatasetCard.vue'
import type { DisclosureDatasetResult } from '@/services/forecast/dailyDisclosure'

function buildDataset(overrides: Partial<DisclosureDatasetResult> = {}): DisclosureDatasetResult {
  return {
    spec: {
      id: 'load_forecast',
      family: 'yn_system_forecast',
      title: '统调负荷预测',
      group: 'forecast',
      nature: 'forecast',
      unit: '原始值',
      slots: 96,
    },
    date: '2026-06-25',
    status: 'ready',
    rows: [
      { operateDate: '2026-06-25', targetDate: '2026-06-26', timePoint: '00:00', value: 100, region: 'yn', metric: 'load_forecast' },
    ],
    series: [
      {
        id: 'yn',
        label: '云南省内',
        scope: 'yn',
        scopeLabel: '云南省内',
        targetDate: '2026-06-26',
        unit: '原始值',
        labels: ['00:00', '00:15'],
        points: [100, 120],
        previous: [90, 110],
        validPoints: 2,
        expectedPoints: 96,
        conflicts: 0,
      },
      {
        id: 'all',
        label: '南网全网',
        scope: 'all',
        scopeLabel: '南网全网',
        targetDate: '2026-06-26',
        unit: '原始值',
        labels: ['00:00', '00:15'],
        points: [200, 220],
        previous: [190, 210],
        validPoints: 2,
        expectedPoints: 96,
        conflicts: 0,
      },
    ],
    warnings: ['功率类历史单位标注存在冲突；当前按采集原值展示，未缩放或换算为电量。'],
    sourceLabel: '已导入披露 · 真实数据回放',
    capturedAt: '2026-06-25T08:00:00+08:00',
    ingestedAt: '2026-06-25T08:05:00+08:00',
    ...overrides,
  }
}

const stubs = {
  ElButton: {
    props: ['plain', 'size'],
    emits: ['click'],
    template: '<button @click="$emit(\'click\')"><slot /></button>',
  },
  ElSelect: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<select class="scope-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>',
  },
  ElOption: {
    props: ['label', 'value'],
    template: '<option :value="value">{{ label }}</option>',
  },
  ElDialog: {
    props: ['modelValue', 'title'],
    emits: ['update:modelValue'],
    template: '<div v-if="modelValue" class="dialog"><slot /></div>',
  },
  ElTable: { template: '<div class="table"><slot /></div>' },
  ElTableColumn: { template: '<div><slot :row="{ value: 1 }" /></div>' },
  ElPagination: {
    props: ['currentPage'],
    emits: ['current-change'],
    template: '<button class="pager" @click="$emit(\'current-change\', 2)">page</button>',
  },
}

let wrappers: VueWrapper[] = []

async function render(dataset = buildDataset()) {
  const wrapper = mount(DisclosureDatasetCard, {
    props: { dataset },
    global: { stubs },
  })
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  chartSpy.setOption.mockReset()
  chartSpy.resize.mockReset()
  chartSpy.showLoading.mockReset()
  chartSpy.hideLoading.mockReset()
  chartSpy.dispose.mockReset()
  chartSpy.instance.mockReset()
})

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
})

describe('DisclosureDatasetCard', () => {
  it('默认优先展示云南范围曲线，并输出图表配置', async () => {
    await render()
    const option = chartSpy.setOption.mock.calls.at(-1)?.[0]
    expect(option.series).toHaveLength(1)
    expect(option.series[0].name).toBe('云南省内')
    expect(option.series[0].lineStyle.type).toBe('dashed')
  })

  it('切换范围后重新绘图', async () => {
    const wrapper = await render()
    await wrapper.find('.scope-select').setValue(JSON.stringify(['all', '2026-06-26', '原始值']))
    const option = chartSpy.setOption.mock.calls.at(-1)?.[0]
    expect(option.series[0].name).toBe('南网全网')
  })

  it('查看明细时展示原始表格与上一快照提示', async () => {
    const wrapper = await render()
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('.dialog').exists()).toBe(true)
    expect(wrapper.text()).toContain('含上一快照值')
  })

  it('暴露 resize 方法给父组件调用', async () => {
    const wrapper = await render()
    ;(wrapper.vm as unknown as { resize: () => void }).resize()
    expect(chartSpy.resize).toHaveBeenCalledTimes(1)
  })

  it('价格使用阶梯实线、保留缺口且不平滑', async () => {
    const price = buildDataset()
    price.spec = { ...price.spec, nature: 'price', unit: '元/MWh', slots: 24 }
    price.series = [{ ...price.series[0], points: [-5, null], validPoints: 1, unit: '元/MWh' }]
    await render(price)
    const option = chartSpy.setOption.mock.calls.at(-1)?.[0]
    expect(option.series[0]).toMatchObject({ step: 'end', connectNulls: false, smooth: false, data: [-5, null] })
    expect(option.series[0].lineStyle.type).not.toBe('dashed')
  })

  it('同范围不同目标日或单位不会被画在同一坐标轴', async () => {
    const mixed = buildDataset()
    mixed.series = [mixed.series[0],
      { ...mixed.series[0], id: 'next-date', targetDate: '2026-06-27' },
      { ...mixed.series[0], id: 'frequency', unit: 'Hz' },
    ]
    const wrapper = await render(mixed)
    expect(wrapper.findAll('option')).toHaveLength(3)
    expect(chartSpy.setOption.mock.calls.at(-1)?.[0].series).toHaveLength(1)
    await wrapper.find('.scope-select').setValue(JSON.stringify(['yn', '2026-06-26', 'Hz']))
    expect(chartSpy.setOption.mock.calls.at(-1)?.[0].yAxis.name).toBe('Hz')
  })

  it('原始行无法绘图时显示原因和明细入口，不画空图框', async () => {
    const wrapper = await render(buildDataset({ series: [], status: 'partial' }))
    expect(wrapper.find('.disclosure-card__chart').exists()).toBe(false)
    expect(wrapper.text()).toContain('有原始记录，但没有可安全绘制的有效曲线')
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('.dialog').exists()).toBe(true)
    expect(wrapper.text()).toContain('全部统计范围和原始字段')
  })
})
