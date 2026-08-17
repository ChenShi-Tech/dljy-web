// 三主体驾驶舱组件测试（#2048：分批呈现 / data_gap 诚实 / 批1 真数 / E1 MOCK 明示）
import { describe, expect, it } from 'vitest'
import SubjectCockpit from './SubjectCockpit.vue'
import { mount } from '@/test/mount'

describe('SubjectCockpit', () => {
  it('批1 售电默认态：R1/R4 公司级真数 + 分客户缺口标注 + 模板清单（通用模板包含）', () => {
    const wrapper = mount(SubjectCockpit, {
      props: {
        daySummary: {
          date: '2026-08-14', declaredTotalMwh: 400, deviationMwh: 12.5,
          deviationPct: 0.031, estimatedPenaltyYuan: 3000
        }
      }
    })
    const text = wrapper.text()
    expect(text).toContain('批 1（先行）')
    expect(text).toContain('R1/R4 公司级日度行')
    expect(text).toContain('12.50 MWh')
    expect(text).toContain('3.10%')
    expect(text).toContain('分客户明细缺（D4）')
    expect(text).toContain('R1 代理购电偏差复盘表')
    expect(text).toContain('T01') // 通用模板适用全部主体
  })

  it('批1 无真数 → 「不出数不合成」；点击模板发 open-template', async () => {
    const wrapper = mount(SubjectCockpit, { props: { daySummary: null } })
    expect(wrapper.text()).toContain('不出数，不合成')
    const btn = wrapper.find('.sc-tpl')
    await btn.trigger('click')
    expect(wrapper.emitted('open-template')).toBeTruthy()
    expect(wrapper.emitted('open-template')![0]).toEqual(['T01'])
  })

  it('批2 新能源：N1 真实试点与 24 时段口径说明', async () => {
    const wrapper = mount(SubjectCockpit, { props: { daySummary: null } })
    const tabs = wrapper.findAll('.sc-tabs button')
    await tabs[1].trigger('click')
    const text = wrapper.text()
    expect(text).toContain('批 2')
    expect(text).toContain('中广核云南场站')
    expect(text).toContain('N1 出力预测准确率复盘表')
    expect(text).toContain('24 时段仅展示聚合')
  })

  it('批3 储能：E1 illustrative 即 MOCK 显式警示 + 等待数据接入诚实呈现', async () => {
    const wrapper = mount(SubjectCockpit, { props: { daySummary: null } })
    const tabs = wrapper.findAll('.sc-tabs button')
    await tabs[2].trigger('click')
    const text = wrapper.text()
    expect(text).toContain('批 3')
    expect(text).toContain('illustrative 即 MOCK')
    expect(text).toContain('不可用于实盘编排')
    expect(text).toContain('等待数据接入')
    expect(text).toContain('E1 24时段充放电策略编排表')
  })
})
