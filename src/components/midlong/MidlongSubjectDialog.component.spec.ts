// 交易主体登记对话框与操作导引桥（ChenShi-Tech/dljy#3404）。
// 守什么：useGuideForm(FORM.subject) 把表单 reactive 登记进 bridge，导引的「帮我填示例值」
// 能直接写进真实表单（含 stationIds 多选）；登记成功才发 SIGNAL.subjectCreated（带 id 与
// subjectKey 供后续步骤对号），失败不发（导引不推进）。
// 坏掉的症状：「帮我填」点了没反应或填进另一个对话框；保存失败导引也往前走、后续步骤
// 拿不到主体 id 全部错位。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import { fillGuideForm, onGuideSignal, resetGuideBridge } from '@/features/guide/bridge'
import { FORM, SIGNAL } from '@/features/guide/midlong/anchors'
import MidlongSubjectDialog from './MidlongSubjectDialog.vue'

const hoisted = vi.hoisted(() => ({ createSubject: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/services/midlong/midlongApi', () => ({
  createSubject: hoisted.createSubject,
  midlongFailureOf: (e: unknown) => ({ status: 500, errorCode: 'STORAGE_UNAVAILABLE', message: String(e), details: null }),
}))

const stations = [
  { id: 11, name: '风电一场', type: 'WIND' },
  { id: 12, name: '光伏二场', type: 'SOLAR' },
]

async function open() {
  const w = mount(MidlongSubjectDialog, { props: { modelValue: false, subjects: [], stations, canWrite: true } })
  await w.setProps({ modelValue: true })
  await flushPromises()
  return w
}

afterEach(() => {
  vi.clearAllMocks()
  resetGuideBridge()
})
enableAutoUnmount(afterEach)

describe('交易主体对话框与导引桥', () => {
  it('fillGuideForm(FORM.subject) 把示例值写进真实表单（含 stationIds），提交载荷带全部值', async () => {
    hoisted.createSubject.mockResolvedValue({ id: 7, subjectKey: 'GUIDE-01020304' })
    const w = await open()

    const ok = fillGuideForm(FORM.subject, {
      subjectKey: 'GUIDE-01020304', displayName: '【教学演示】测试主体', unitCode: '', unitCodeSource: '',
      verificationNote: '教学示例', stationIds: [11, 12],
    })
    expect(ok).toBe(true)
    await flushPromises() // fill 写进 reactive 后要等一拍，v-model 绑定的 input 与按钮 disabled 才刷新
    expect((w.find('[data-guide="ml-subject-key"] input').element as HTMLInputElement).value).toBe('GUIDE-01020304')
    expect((w.find('[data-guide="ml-subject-name"] input').element as HTMLInputElement).value).toBe('【教学演示】测试主体')

    await w.findAll('.el-dialog__footer button').find((b) => /登记主体/.test(b.text()))!.trigger('click')
    await flushPromises()
    expect(hoisted.createSubject).toHaveBeenCalledWith(expect.objectContaining({
      subjectKey: 'GUIDE-01020304', stationIds: [11, 12],
    }))
  })

  it('登记成功发 SIGNAL.subjectCreated，载荷带 id 与 subjectKey；表单随即清空', async () => {
    hoisted.createSubject.mockResolvedValue({ id: 7, subjectKey: 'GUIDE-01020304' })
    const w = await open()
    fillGuideForm(FORM.subject, { subjectKey: 'GUIDE-01020304', displayName: '【教学演示】测试主体', stationIds: [] })
    await flushPromises()

    const seen: unknown[] = []
    onGuideSignal(SIGNAL.subjectCreated, (p) => seen.push(p))
    await w.findAll('.el-dialog__footer button').find((b) => /登记主体/.test(b.text()))!.trigger('click')
    await flushPromises()

    expect(seen).toEqual([{ id: 7, subjectKey: 'GUIDE-01020304' }])
    expect(w.emitted('created')).toEqual([[{ id: 7, subjectKey: 'GUIDE-01020304' }]])
    expect((w.find('[data-guide="ml-subject-key"] input').element as HTMLInputElement).value).toBe('')
  })

  it('登记失败不发信号（导引不能在失败时推进），错误留在界面', async () => {
    hoisted.createSubject.mockRejectedValue(new Error('编号重复'))
    const w = await open()
    fillGuideForm(FORM.subject, { subjectKey: 'GUIDE-DUP', displayName: '重复主体', stationIds: [] })
    await flushPromises()

    const seen: unknown[] = []
    onGuideSignal(SIGNAL.subjectCreated, (p) => seen.push(p))
    await w.findAll('.el-dialog__footer button').find((b) => /登记主体/.test(b.text()))!.trigger('click')
    await flushPromises()

    expect(seen).toEqual([])
    expect(w.text()).toContain('编号重复')
  })
})
