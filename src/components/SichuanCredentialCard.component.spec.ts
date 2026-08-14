// @vitest-environment happy-dom
//
// 四川凭据卡片的展示不变量（Issue #1620 / codex #1886 P2 闭环；#1925 通用凭据层适配）。
//
// 核心场景一：一次连通测试最长 20 秒，期间生效凭据可能被换掉。服务端此时会
// 丢弃结论（recorded:false），但**光服务端丢弃不够**——组件若仍留着那份报告，
// 状态区会拿它渲染成绿色「凭据有效」+ 令牌有效期，旁边加一句警告压不住这种误导。
// 这里断言的正是这条端到端闭环。
//
// 核心场景二（#1925）：凭据按录入账号分记录，生效的可能不是我。页面必须明示
// 「当前生效的是谁录入的」——否则会出现「我改了却没生效」而无从察觉。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const fetchStatus = vi.fn()
const testCredentials = vi.fn()

vi.mock('@/services/gridAccess', () => ({
  fetchGridCredentialStatus: (...args: unknown[]) => fetchStatus(...args),
  testGridCredentials: (...args: unknown[]) => testCredentials(...args),
  saveGridCredentials: vi.fn(),
  clearGridCredentials: vi.fn(),
}))

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

import SichuanCredentialCard from './SichuanCredentialCard.vue'

const MASKED = {
  appId: 'test…7890(共19字符)',
  appSecret: 'test…4321(共23字符)',
  // 掩码值必须是显然合成的（aaaa/bbbb…），不得从真实凭据的掩码输出复制——
  // 掩码首尾各 4 字符若来自真实密钥即构成部分泄露（web 镜像导出扫描会拦）。
  sm4Key: 'aaaa…bbbb(共32字符)',
  sm4Iv: 'cccc…dddd(共32字符)',
  sm2PrivateKey: 'eeee…ffff(共64字符)',
  sm2PublicKey: 'abab…cdcd(共66字符)',
}

function status(overrides: Record<string, unknown> = {}) {
  return {
    pointId: 'sgcc-sichuan',
    credentialEntry: true,
    own: {
      configured: true,
      missing: [],
      filledCount: 6,
      totalCount: 6,
      masked: MASKED,
      baseAddress: 'https://pmos.sc.sgcc.com.cn',
      accessTokenUri: 'https://pmos.sc.sgcc.com.cn/px-common-defense/oauth/token',
      updatedAt: '2026-08-08T06:00:00Z',
    },
    effective: {
      owner: 'admin',
      ownerCompanyId: null,
      ownedByViewer: true,
      updatedAt: '2026-08-08T06:00:00Z',
      configured: true,
      baseAddress: 'https://pmos.sc.sgcc.com.cn',
      accessTokenUri: 'https://pmos.sc.sgcc.com.cn/px-common-defense/oauth/token',
      lastTest: null,
    },
    defaultBaseAddress: 'https://pmos.sc.sgcc.com.cn',
    ...overrides,
  }
}

// el-input / el-button 用最小桩件替换：本测试关心的是文案与状态流转，不是 Element Plus 渲染。
const global = {
  stubs: {
    'el-input': { props: ['modelValue'], template: '<input :value="modelValue" />' },
    'el-button': { template: '<button><slot /></button>' },
  },
  directives: { loading: () => {} },
}

async function mountCard() {
  const wrapper = mount(SichuanCredentialCard, { global })
  await new Promise((resolve) => setTimeout(resolve, 0))
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('SichuanCredentialCard', () => {
  beforeEach(() => {
    fetchStatus.mockReset()
    testCredentials.mockReset()
    fetchStatus.mockResolvedValue(status())
  })

  it('测试期间生效凭据被更换时，不得把被丢弃的旧结论渲染成「凭据有效」', async () => {
    const wrapper = await mountCard()
    testCredentials.mockResolvedValue({
      result: 'ok',
      msg: '凭据有效，已成功换取访问令牌',
      tokenType: 'Bearer',
      expiresIn: 7200,
      expiresAt: '2026-08-08T08:00:00Z',
      // 服务端已判定这份结论属于旧凭据。
      recorded: false,
      notRecordedReason: '生效凭据在测试期间被更换，本次结论属于旧凭据，未写回——请对新凭据重新测试',
    })

    await wrapper.find('button:nth-of-type(2)').trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    const text = wrapper.text()
    expect(text).toContain('生效凭据在测试期间被更换')
    // 关键断言：被丢弃的结论不得出现在状态区（否则页面等于说「这套新凭据已验证」）。
    expect(text).not.toContain('凭据有效，已成功换取访问令牌')
    expect(text).not.toContain('有效期 120 分钟')
    expect(text).toContain('尚未测试')
  })

  it('结论正常写回时照常展示成功态与令牌元信息', async () => {
    const wrapper = await mountCard()
    testCredentials.mockResolvedValue({
      result: 'ok',
      msg: '凭据有效，已成功换取访问令牌',
      tokenType: 'Bearer',
      expiresIn: 7200,
      expiresAt: '2026-08-08T08:00:00Z',
      recorded: true,
    })

    await wrapper.find('button:nth-of-type(2)').trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    const text = wrapper.text()
    expect(text).toContain('凭据有效，已成功换取访问令牌')
    expect(text).toContain('有效期 120 分钟')
    expect(text).not.toContain('未写回')
  })

  it('掩码之外不展示任何明文，且缺项时列出还差什么', async () => {
    fetchStatus.mockResolvedValue(status({
      own: {
        ...status().own as Record<string, unknown>,
        configured: false,
        filledCount: 2,
        missing: ['sm4Key', 'sm4Iv', 'sm2PrivateKey', 'sm2PublicKey', 'accessTokenUri'],
      },
    }))
    const wrapper = await mountCard()
    const text = wrapper.text()
    expect(text).toContain('我已录入 2/6 项')
    expect(text).toContain('还差 5 项未录入')
    expect(text).toContain('sm4Key')
    // 掩码串本身可见，但不得出现完整密钥形态。
    expect(text).toContain('test…7890(共19字符)')
  })

  it('生效的不是我时有显著提示，且不出现别人的掩码（#1925 账号隔离）', async () => {
    fetchStatus.mockResolvedValue(status({
      own: null,
      effective: {
        ...status().effective as Record<string, unknown>,
        owner: 'other-admin',
        ownedByViewer: false,
      },
    }))
    const wrapper = await mountCard()
    const text = wrapper.text()
    expect(text).toContain('账号「other-admin」录入的凭据')
    expect(text).toContain('我看不到其内容')
    // own 为 null：状态区不得出现任何掩码（那会是别人的凭据信息）。
    expect(text).not.toContain('(共19字符)')
    expect(text).toContain('我未录入')
  })

  it('无任何生效凭据时明示采集会诚实失败', async () => {
    fetchStatus.mockResolvedValue(status({ own: null, effective: null }))
    const wrapper = await mountCard()
    expect(wrapper.text()).toContain('当前没有任何生效凭据')
  })

  it('非管理员看到明确的权限提示而不是空白表单', async () => {
    const { ApiError } = await import('@/services/api')
    fetchStatus.mockRejectedValue(new ApiError('仅系统管理员可管理', {
      status: 403,
      code: 403,
      payload: { code: 403, msg: '仅系统管理员可管理' },
    }))
    const wrapper = await mountCard()
    expect(wrapper.text()).toContain('仅系统管理员(ADMIN/BOSS)可管理四川开放平台凭据')
    expect(wrapper.text()).not.toContain('保存到服务端')
  })
})
