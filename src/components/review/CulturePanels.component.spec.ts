// 情绪化识别面板 + 会议纪要组件测试（#2049：停用无残留 / 识别呈现 / 归档提醒）
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/services/trading/decisionLogStore', () => ({ loadLog: vi.fn() }))

import { loadLog } from '@/services/trading/decisionLogStore'
import EmotionPatternPanel from './EmotionPatternPanel.vue'
import MeetingMinutesForm from './MeetingMinutesForm.vue'
import { mount } from '@/test/mount'
import { EMOTION_TOGGLE_KEY } from '@/services/review/emotionRules'

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'a', seq: 1, targetDate: '2026-08-14', decisionPoint: '晚高峰申报量',
  judgement: '看涨', p10: 99, p50: 100, p90: 101, actual: 120, lesson: '', ...over
})

beforeEach(() => {
  vi.mocked(loadLog).mockReset()
  localStorage.removeItem(EMOTION_TOGGLE_KEY)
})

async function settle(wrapper: ReturnType<typeof mount>) {
  await nextTick()
  return wrapper
}

describe('EmotionPatternPanel', () => {
  it('识别结果呈现：文化红线横幅 + 过度自信/犹豫标注 + 覆盖说明（追涨杀跌不打标）', async () => {
    vi.mocked(loadLog).mockReturnValue([
      entry({ seq: 1, p10: 99, p50: 100, p90: 101, actual: 120 }),
      entry({ seq: 2, id: 'b', decisionPoint: '晚高峰申报量' })
    ] as never)
    const wrapper = await settle(mount(EmotionPatternPanel))
    const text = wrapper.text()
    expect(text).toContain('非考核依据')
    expect(text).toContain('不做排名')
    expect(text).toContain('过度自信')
    expect(text).toContain('犹豫')
    expect(text).toContain('追涨/杀跌需价格波动上下文')
  })

  it('整体停用：切换开关后识别内容零残留（只剩停用说明）', async () => {
    vi.mocked(loadLog).mockReturnValue([entry()] as never)
    const wrapper = await settle(mount(EmotionPatternPanel))
    await wrapper.find('.emo-switch input').setValue(true)
    const text = wrapper.text()
    expect(text).toContain('已整体停用')
    expect(text).not.toContain('过度自信')
    expect(text).not.toContain('识别结果')
    expect(localStorage.getItem(EMOTION_TOGGLE_KEY)).toBe('1')
  })

  it('无高置信信号：宁缺勿滥文案（不打标不等于没有问题）', async () => {
    vi.mocked(loadLog).mockReturnValue([] as never)
    const wrapper = await settle(mount(EmotionPatternPanel))
    expect(wrapper.text()).toContain('宁缺勿滥')
    expect(wrapper.text()).toContain('不打标不等于没有问题')
  })
})

describe('MeetingMinutesForm', () => {
  it('归档提醒随会议日期联动（+1 工作日）', async () => {
    const wrapper = await settle(mount(MeetingMinutesForm))
    const input = wrapper.find<HTMLInputElement>('.mm-head input[type="date"]')
    await input.setValue('2026-08-14') // 周五 → 下周一
    expect(wrapper.text()).toContain('2026-08-17')
    await input.setValue('2026-08-11') // 周二 → 周三
    expect(wrapper.text()).toContain('2026-08-12')
  })

  it('上期回查诚实占位 + 案例库检索占位（不展示假案例）', async () => {
    const wrapper = await settle(mount(MeetingMinutesForm))
    const text = wrapper.text()
    expect(text).toContain('上期改进措施回查')
    expect(text).toContain('端点随服务端化上线')
    expect(text).toContain('案例库检索强化')
    expect(text).toContain('不展示假案例')
  })
})
