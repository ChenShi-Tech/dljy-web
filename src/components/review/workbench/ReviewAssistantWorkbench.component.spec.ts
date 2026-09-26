import { describe, it, expect, vi } from 'vitest'
import { mount } from '@/test/mount'
import { buildReviewEvidence } from '@/services/review/reviewEvidence'
import ReviewAssistantWorkbench from './ReviewAssistantWorkbench.vue'
vi.mock('@/components/agent/AgentChatPanel.vue', () => ({ default: { props: ['initialQuestion', 'contextPayload', 'restoreLastSession', 'promptKey'], emits: ['answer'], template: '<div>智能助手</div>' } }))
const snapshot = () => buildReviewEvidence({ company: 'a', region: 'yunnan', day: '2026-06-06', objectKey: '', objectLabel: '当日资料总览', simulated: true })
describe('报告人工核验流程', () => {
  it('无需模型即可编辑，分析建议不自动覆盖，编辑后撤销核对勾选', async () => {
    const w = mount(ReviewAssistantWorkbench, { props: { snapshot: snapshot(), mode: 'report' } })
    const field = w.get('textarea'); await field.setValue('人工记录：需要继续核实。')
    expect(w.emitted('draft')?.at(-1)?.[0]).toEqual('人工记录：需要继续核实。')
    await w.findAll('button').find(b => b.text() === '请助手拟写建议')!.trigger('click')
    const chat = w.findComponent({ name: 'AgentChatPanel' })
    // stub 按组件引用定位，避免依赖真实服务。
    const assistant = chat.exists() ? chat : w.findAllComponents({}).find(c => c.props('initialQuestion'))!
    assistant.vm.$emit('answer', '建议补充出清资料'); await w.vm.$nextTick()
    expect((field.element as HTMLTextAreaElement).value).toBe('人工记录：需要继续核实。')
    await w.get('input[type=checkbox]').setValue(true)
    await w.findAll('button').find(b => b.text() === '将分析建议追加到草稿')!.trigger('click')
    expect((field.element as HTMLTextAreaElement).value).toContain('人工记录：需要继续核实。')
    expect((field.element as HTMLTextAreaElement).value).toContain('建议补充出清资料')
    expect((w.get('input[type=checkbox]').element as HTMLInputElement).checked).toBe(false)
    expect(assistant.props('restoreLastSession')).toBe(false)
    expect(assistant.props('promptKey')).toBe('review_center')
    w.unmount()
  })
})
