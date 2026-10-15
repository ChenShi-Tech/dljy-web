// 储能预置价回落可见（dljy#3731 遗留缺陷⑦ · yunnan-launch-readiness
// spot-degradation-honesty delta「储能预置价回落必须可见」）：价格序列不可用
// （清空/全部非法）回落「典型双峰」预置时必须显示标注；输入恢复可解析后标注消失。
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@/test/mount'

vi.mock('@/services/trading/storageAssetsClient', () => ({
  listStorageAssets: vi.fn(async () => [])
}))
vi.mock('@/services/declarations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/declarations')>()),
  savePreflight: vi.fn()
}))
vi.mock('@/components/agent/AgentChatPanel.vue', () => ({
  __esModule: true,
  default: { template: '<div class="stub-agent" />' }
}))

import StorageDispatchBlock from './StorageDispatchBlock.vue'

function findPricesTextarea(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('textarea.sb-prices')
}

function fallbackMarker(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[data-test="sb-preset-fallback"]')
}

describe('储能预置价回落可见（缺陷⑦）', () => {
  it('价格序列清空后：计算按预置回落且出现可见标注', async () => {
    const wrapper = mount(StorageDispatchBlock, { props: { declaration: null } })
    expect(fallbackMarker(wrapper).exists()).toBe(false)

    const textarea = findPricesTextarea(wrapper)
    await textarea.setValue('   ')
    expect(fallbackMarker(wrapper).exists()).toBe(true)
    expect(fallbackMarker(wrapper).text()).toContain('典型双峰')
    // 计算仍按预置形态进行（24 个决策单元），不中断也不冒充输入
    expect(wrapper.text()).toContain('价格序列（24 个决策单元）')
  })

  it('全部非法输入同样触发回落标注', async () => {
    const wrapper = mount(StorageDispatchBlock, { props: { declaration: null } })
    await findPricesTextarea(wrapper).setValue('abc, , x')
    expect(fallbackMarker(wrapper).exists()).toBe(true)
  })

  it('输入恢复可解析后标注消失（随真实输入呈现）', async () => {
    const wrapper = mount(StorageDispatchBlock, { props: { declaration: null } })
    await findPricesTextarea(wrapper).setValue('')
    expect(fallbackMarker(wrapper).exists()).toBe(true)

    await findPricesTextarea(wrapper).setValue('100, 200, 300')
    expect(fallbackMarker(wrapper).exists()).toBe(false)
    expect(wrapper.text()).toContain('价格序列（3 个决策单元）')
  })
})
