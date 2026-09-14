import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DailyEnergyAnalysisPanel from './DailyEnergyAnalysisPanel.vue'
const api=vi.hoisted(()=>({fetchDailyEnergy:vi.fn(),captureDailyEnergy:vi.fn(),setOption:vi.fn()}))
vi.mock('@/services/review/dailyEnergy',async original=>({...await original<typeof import('@/services/review/dailyEnergy')>(),...api}))
vi.mock('@/composables/useEChart',()=>({useEChart:()=>({setOption:api.setOption})}))
const metric={baselineMwh:20,actualMwh:20,netDeviationMwh:0,absoluteDeviationMwh:10,absoluteDeviationPct:50,coverage:{records:2,paired:2,baseline:2,actual:2,excluded:0,unknownQuality:0}}
const result={periods:{current:{start:'2026-05-31',end:'2026-05-31'},reference:{start:'2026-05-24',end:'2026-05-24'}},labels:['综合预测电量','市场电量'],availablePlants:['厂站甲','厂站乙'],selectedPlants:['厂站甲','厂站乙'],current:metric,reference:metric,expectedPlantDays:2,daily:[{date:'2026-05-31',...metric}],plants:[{plant:'厂站甲',...metric}],exceptions:[{date:'2026-05-31',plant:'厂站甲',differenceMwh:5}],comparison:{matchedPlantDays:2,current:metric,reference:metric},notice:'真实日报，缺测不补零'}
beforeEach(()=>{vi.resetAllMocks();api.fetchDailyEnergy.mockResolvedValue(result);api.captureDailyEnergy.mockResolvedValue({id:'material'})})
const open=()=>mount(DailyEnergyAnalysisPanel,{props:{company:'company-a',region:'yunnan',date:'2026-05-31'}})
describe('公司周期电量分析',()=>{
  it('首次加载真实周期、显示净与绝对偏差，取材固定已完成范围',async()=>{
    const wrapper=open();await flushPromises()
    expect(wrapper.text()).toContain('净偏差');expect(wrapper.text()).toContain('逐厂站日绝对偏差');expect(wrapper.text()).toContain('10 MWh')
    expect(api.fetchDailyEnergy).toHaveBeenCalledWith('company-a',expect.objectContaining({basis:'forecast',actual:'market'}),expect.any(AbortSignal))
    await wrapper.findAll('button').find(b=>b.text()==='加入复盘底稿')!.trigger('click');await flushPromises()
    expect(api.captureDailyEnergy).toHaveBeenCalledWith('company-a',expect.objectContaining({period:expect.objectContaining({date:'2026-05-31'})}))
    expect(wrapper.emitted('material')).toHaveLength(1);wrapper.unmount()
  })
  it('改厂站后隐藏旧结果，重新统计与选择日期均由服务端计算',async()=>{
    const wrapper=open();await flushPromises()
    await wrapper.find('.plants input').setValue(true)
    expect(wrapper.text()).not.toContain('净偏差')
    await wrapper.findAll('button').find(b=>b.text()==='重新统计')!.trigger('click');await flushPromises()
    expect(api.fetchDailyEnergy).toHaveBeenLastCalledWith('company-a',expect.objectContaining({plants:['厂站甲']}),expect.any(AbortSignal))
    await wrapper.find('.exceptions input').setValue(true);await flushPromises()
    expect(api.fetchDailyEnergy).toHaveBeenLastCalledWith('company-a',expect.objectContaining({days:['2026-05-31']}),expect.any(AbortSignal));wrapper.unmount()
  })
  it('维护返回或独立打开后保留周期、厂站、口径和所选日期',async()=>{
    const selection={date:'2026-05-31',cadence:'month' as const,basis:'declared' as const,actual:'generation' as const,manual:true,referenceStart:'2026-03-01',referenceEnd:'2026-03-31',plants:['厂站甲'],days:['2026-05-31']}
    const wrapper=mount(DailyEnergyAnalysisPanel,{props:{company:'company-a',region:'yunnan',date:'2026-06-01',selection}});await flushPromises()
    expect(api.fetchDailyEnergy).toHaveBeenLastCalledWith('company-a',expect.objectContaining({period:expect.objectContaining({date:'2026-05-31',cadence:'month'}),basis:'declared',actual:'generation',plants:['厂站甲'],days:['2026-05-31'],referencePeriod:{start:'2026-03-01',end:'2026-03-31'}}),expect.any(AbortSignal));wrapper.unmount()
  })
  it('公司切换丢弃原统计，错误不暴露内部字段',async()=>{
    const wrapper=open();await flushPromises()
    api.fetchDailyEnergy.mockRejectedValue(new Error('missingDataJson SQL'))
    await wrapper.setProps({company:'other'});await flushPromises()
    expect(wrapper.text()).not.toContain('净偏差');expect(wrapper.text()).not.toContain('missingDataJson');expect(wrapper.text()).toContain('电量统计未完成')
    await wrapper.findAll('button').find(b=>b.text()==='维护电量资料')!.trigger('click');expect(wrapper.emitted('maintenance')).toHaveLength(1);wrapper.unmount()
  })
})
