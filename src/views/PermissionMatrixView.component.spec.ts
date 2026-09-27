// 权限矩阵保存/恢复的提示纪律（dljy#3265）：后端失败只弹失败警告（含「未在服务端生效」）
// 并降级到本地暂存，绝不允许再弹「已保存」成功提示；后端成功必须弹成功提示（主路径也要锁）。
// 坏掉的症状：一次操作先后弹「同步失败」与「已保存」，管理员误以为权限已在服务端生效。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

// vi.mock 工厂会被提升到文件顶部：工厂里引用的桩必须经 vi.hoisted 定义，否则 TDZ 报错
const { ElMessage, auth } = vi.hoisted(() => ({
  ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
  auth: {
    getAuthDirectory: vi.fn(),
    saveServerRoleAccessOverride: vi.fn(),
    resetServerRoleAccessOverride: vi.fn(),
  },
}))
vi.mock('element-plus', () => ({ ElMessage }))
vi.mock('@/services/auth', () => auth)
import PermissionMatrixView from './PermissionMatrixView.vue'
import { getAccessOverrides } from '@/services/governance'

const STUBS = {
  'el-segmented': { template: '<div class="stub-segmented" />' },
  'el-tag': { template: '<span class="stub-tag"><slot /></span>' },
  // 不手动 $emit('click')：父级 @click 经 attrs 直接落到根 <button>（手动 emit 会让点击触发两次）
  'el-button': { template: '<button class="stub-btn" :disabled="disabled"><slot /></button>', props: ['disabled', 'loading', 'type'] },
  'el-select': { template: '<div class="stub-select"><slot /></div>', props: ['modelValue'] },
  'el-option': { template: '<div class="stub-option" />', props: ['label', 'value'] },
  'el-input': { template: '<input class="stub-input" />', props: ['modelValue'] },
  'el-collapse': { template: '<div class="stub-collapse"><slot /></div>', props: ['modelValue'] },
  'el-collapse-item': { template: '<div class="stub-collapse-item"><slot name="title" /><slot /></div>', props: ['name'] },
  'el-checkbox': { template: '<label class="stub-checkbox"><slot /></label>', props: ['modelValue', 'indeterminate', 'disabled'] },
  'el-switch': { template: '<span class="stub-switch" />', props: ['modelValue', 'disabled'] },
  'el-table': { template: '<div class="stub-table"><slot /></div>', props: ['data'] },
  'el-table-column': { template: '<div class="stub-table-column" />' },
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  auth.getAuthDirectory.mockResolvedValue({ database: { file: 'auth.json' }, users: [] })
  auth.saveServerRoleAccessOverride.mockResolvedValue({})
  auth.resetServerRoleAccessOverride.mockResolvedValue({})
})

async function mountView() {
  const w = mount(PermissionMatrixView, { global: { stubs: STUBS } })
  await flushPromises()
  return w
}

function findButton(w: VueWrapper, text: string) {
  const btn = w.findAll('button.stub-btn').find((b) => b.text().trim() === text)
  if (!btn) throw new Error(`找不到按钮：${text}`)
  return btn
}

function lastMessage(fn: ReturnType<typeof vi.fn>) {
  const calls = fn.mock.calls as unknown as string[][]
  return calls[calls.length - 1]?.[0] ?? ''
}

describe('保存矩阵（saveSelectedRole）', () => {
  it('后端保存成功：弹成功提示，不弹失败警告', async () => {
    const w = await mountView()
    await findButton(w, '保存矩阵').trigger('click')
    await flushPromises()
    expect(ElMessage.success).toHaveBeenCalledTimes(1)
    expect(lastMessage(ElMessage.success)).toBe('交易员权限矩阵已保存')
    expect(ElMessage.warning).not.toHaveBeenCalled()
  })

  it('后端保存失败：弹「未在服务端生效」失败警告且不带成功提示，矩阵降级到本地暂存', async () => {
    auth.saveServerRoleAccessOverride.mockRejectedValue(new Error('HTTP 500'))
    const w = await mountView()
    await findButton(w, '保存矩阵').trigger('click')
    await flushPromises()
    // 修复前：catch 之后仍无条件弹「已保存」，此断言会红
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.warning).toHaveBeenCalledTimes(1)
    const warned = lastMessage(ElMessage.warning)
    expect(warned).toContain('未在服务端生效')
    expect(warned).toContain('HTTP 500')
    expect(getAccessOverrides().TRADER).toBeTruthy()
  })
})

describe('恢复当前角色默认（resetSelectedRole）', () => {
  it('后端重置成功：弹成功提示，不弹失败警告', async () => {
    const w = await mountView()
    await findButton(w, '恢复默认').trigger('click')
    await flushPromises()
    expect(ElMessage.success).toHaveBeenCalledTimes(1)
    expect(lastMessage(ElMessage.success)).toBe('交易员已恢复默认矩阵')
    expect(ElMessage.warning).not.toHaveBeenCalled()
  })

  it('后端重置失败：弹「未在服务端生效」失败警告且不带成功提示', async () => {
    auth.resetServerRoleAccessOverride.mockRejectedValue(new Error('HTTP 502'))
    const w = await mountView()
    await findButton(w, '恢复默认').trigger('click')
    await flushPromises()
    // 修复前：catch 之后仍无条件弹「已恢复默认矩阵」，此断言会红
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.warning).toHaveBeenCalledTimes(1)
    const warned = lastMessage(ElMessage.warning)
    expect(warned).toContain('未在服务端生效')
    expect(warned).toContain('HTTP 502')
  })
})

describe('恢复全部角色默认（resetAllRoles）', () => {
  it('后端重置成功：弹成功提示，不弹失败警告', async () => {
    const w = await mountView()
    await findButton(w, '恢复全部默认').trigger('click')
    await flushPromises()
    expect(ElMessage.success).toHaveBeenCalledTimes(1)
    expect(lastMessage(ElMessage.success)).toBe('所有角色已恢复默认矩阵')
    expect(ElMessage.warning).not.toHaveBeenCalled()
  })

  it('后端重置失败：弹「未在服务端生效」失败警告且不带成功提示', async () => {
    auth.resetServerRoleAccessOverride.mockRejectedValue(new Error('HTTP 503'))
    const w = await mountView()
    await findButton(w, '恢复全部默认').trigger('click')
    await flushPromises()
    // 修复前：catch 之后仍无条件弹「已恢复默认矩阵」，此断言会红
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.warning).toHaveBeenCalledTimes(1)
    const warned = lastMessage(ElMessage.warning)
    expect(warned).toContain('未在服务端生效')
    expect(warned).toContain('HTTP 503')
  })
})
