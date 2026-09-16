// 中长期合同经济内容编辑器（dljy#2939）。
// 守什么：环境价值价格只属于绿电——电能属性切到常规时清空已填的环境价值价格，不留一个隐藏着又会被提交的值。
// 坏掉的症状：先选绿电填了环境价值、再改回常规，保存后合同带着看不见也改不了的环境价值，持仓单列出环境价值金额。
import { describe, expect, it } from 'vitest'
import { mount } from '@/test/mount'
import { emptyEconomicsDraft } from '@/services/midlong/economicsDraft'
import MidlongEconomicsEditor from './MidlongEconomicsEditor.vue'

describe('中长期合同经济内容编辑器', () => {
  it('电能属性从绿电切到常规：清空环境价值价格；绿电时保留', async () => {
    const draft = { ...emptyEconomicsDraft(), environmentPrice: '12' }
    const w = mount(MidlongEconomicsEditor, { props: { modelValue: draft, documentKind: 'OBLIGATION', energyAttribute: 'GREEN' } })
    expect(w.emitted('update:modelValue')).toBeUndefined()
    await w.setProps({ energyAttribute: 'CONVENTIONAL' })
    const emitted = w.emitted('update:modelValue') as Array<[{ environmentPrice: string }]>
    expect(emitted.at(-1)![0].environmentPrice).toBe('')
  })
})
