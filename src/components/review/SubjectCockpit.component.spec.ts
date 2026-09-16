// 三主体驾驶舱组件测试（#2048：按业务呈现 / 暂缺资料诚实 / 售电公司口径真数 / 储能模拟价格明示）
// 同时守页面红线：不出现模板编号、议题号、缺口编号、接口名或工程分批说明。dljy#2875。
import { describe, expect, it } from 'vitest'
import SubjectCockpit from './SubjectCockpit.vue'
import { mount } from '@/test/mount'

const LEAKS = /#\d{3,}|\b[TRNE]\d{1,2}\b|\bD\d\b|quant|\/review|data_gap|批 \d|illustrative|MOCK|注册表|台账/

describe('SubjectCockpit', () => {
  it('售电默认态：公司日度真数 + 分客户暂缺说明 + 复盘表清单（含通用表）', () => {
    const wrapper = mount(SubjectCockpit, {
      props: { daySummary: { date: '2026-08-14', declaredTotalMwh: 400, deviationMwh: 12.5, deviationPct: 0.031, estimatedPenaltyYuan: 3000 } }
    })
    const text = wrapper.text()
    expect(text).toContain('公司日度申报与偏差')
    expect(text).toContain('12.50 MWh')
    expect(text).toContain('3.10%')
    expect(text).toContain('暂无分客户明细')
    expect(text).toContain('代理购电偏差复盘表')
    expect(text).toContain('决策复盘单') // 通用复盘表适用全部业务
    expect(text).not.toMatch(LEAKS)
  })

  it('售电无真数 → 不显示数值也不推算；点击复盘表发 open-template', async () => {
    const wrapper = mount(SubjectCockpit, { props: { daySummary: null } })
    expect(wrapper.text()).toContain('不显示数值，也不做推算')
    await wrapper.find('.sc-tpl').trigger('click')
    expect(wrapper.emitted('open-template')![0]).toEqual(['T01'])
  })

  it('新能源：场站实时数据与 24 时段口径说明', async () => {
    const wrapper = mount(SubjectCockpit, { props: { daySummary: null } })
    await wrapper.findAll('.sc-tabs button')[1].trigger('click')
    const text = wrapper.text()
    expect(text).toContain('云南场站')
    expect(text).toContain('出力预测准确率复盘表')
    expect(text).toContain('按小时聚合')
    expect(text).not.toMatch(LEAKS)
  })

  it('储能：模拟价格显式警示 + 等待数据接入诚实呈现', async () => {
    const wrapper = mount(SubjectCockpit, { props: { daySummary: null } })
    await wrapper.findAll('.sc-tabs button')[2].trigger('click')
    const text = wrapper.text()
    expect(text).toContain('模拟数据')
    expect(text).toContain('不能用于实盘编排')
    expect(text).toContain('等待数据接入')
    expect(text).toContain('24时段充放电策略编排表')
    expect(text).not.toMatch(LEAKS)
  })
})
