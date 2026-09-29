// @vitest-environment happy-dom
// 公司档案页的并发读守卫（dljy-web#228，codex R1-01）。
//
// 守什么：连续切换公司（或挂载后公司列表刷新校正选中公司）时，reload() 与 reloadRegistry()
// 都是「先发后到」的并发源——发请求前须记下序号与公司快照，应用结果与 finally 清 loading 前
// 都核对「仍是最新请求且公司未变」，过期响应整体丢弃（失败时的空数组与错误提示也不例外）。
// 坏掉的症状：先切公司 A 再切公司 B、A 的响应晚于 B 返回 → 页面立场被 A 的旧值覆盖
// （A 失败时被清成空数组），A 的 finally 还会提前清掉 B 的 loading；公司档案本体同理。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import { mount } from '@/test/mount'
import { selectedCompanyId } from '@/services/company/companyContext'
import CompanyProfileView from './CompanyProfileView.vue'

// 可控 deferred 队列：每次调用取一个新 Promise，由测试决定谁先谁后返回（模拟「先发后到」）。
const api = vi.hoisted(() => {
  function deferred() {
    let resolve!: (value: unknown) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<unknown>((r, j) => {
      resolve = r
      reject = j
    })
    return { promise, resolve, reject }
  }
  type Deb = { promise: Promise<unknown>; resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
  const profileQueue: Deb[] = []
  const registryQueue: Deb[] = []
  return {
    deferred,
    profileQueue,
    registryQueue,
    fetchProfile: vi.fn(() => {
      const d = deferred()
      profileQueue.push(d)
      return d.promise
    }),
    fetchCompanySubjectTypes: vi.fn((companyId: unknown) => {
      const d = deferred() as Deb & { companyId?: unknown }
      d.companyId = companyId
      registryQueue.push(d)
      return d.promise
    })
  }
})
vi.mock('@/services/company/companyApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/company/companyApi')>()),
  fetchProfile: api.fetchProfile,
  fetchCompanySubjectTypes: api.fetchCompanySubjectTypes
}))

// 公司上下文与页面权限都按当前用户取公司归属；mock 成可切公司的平台管理员（ADMIN，本公司 c-a）。
const auth = vi.hoisted(() => ({
  user: { username: 'admin', roleCode: 'ADMIN', companyId: 'c-a', companyName: '公司A' }
}))
vi.mock('@/services/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/auth')>()),
  getCurrentUser: () => auth.user
}))

type ProfileViewVM = {
  form: { contact: string; address: string; businessScope: string }
  registryLoading: boolean
  loading: boolean
}

function mountView() {
  const wrapper = mount(CompanyProfileView, {
    global: {
      stubs: {
        CompanyScopeBar: { template: '<div class="stub-scope-bar" />' },
        MigratedToAdminNotice: { template: '<div class="stub-migrated-notice" />' }
      }
    }
  })
  activeWrapper = wrapper
  return { wrapper, vm: wrapper.vm as unknown as ProfileViewVM }
}

// 组件实例必须先卸载再复位公司上下文：残留实例的 watch(selectedCompanyId) 会跟着
// beforeEach 的复位再发一轮请求，把 deferred 队列搅乱（谁先谁后就不可控了）。
let activeWrapper: ReturnType<typeof mountView>['wrapper'] | null = null
afterEach(() => {
  activeWrapper?.unmount()
  activeWrapper = null
})

beforeEach(() => {
  vi.clearAllMocks()
  api.profileQueue.length = 0
  api.registryQueue.length = 0
  localStorage.clear()
  // 每个用例都从公司 A 起步（模块级公司上下文是跨用例单例，须显式复位）。
  selectedCompanyId.value = 'c-a'
})

describe('切换公司的并发读守卫（dljy-web#228，codex R1-01）', () => {
  it('先切公司 A 再切公司 B，A 的立场响应晚于 B 返回 → 页面保持 B 的立场，loading 已结束', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({}) as never)
    const { wrapper, vm } = mountView()
    expect(api.registryQueue).toHaveLength(1) // 挂载即发 A 的请求（先发）

    selectedCompanyId.value = 'c-b'
    await nextTick() // watch 触发 reloadAll，B 的请求入队（后发、先回）
    expect(api.registryQueue).toHaveLength(2)
    expect(api.fetchCompanySubjectTypes).toHaveBeenNthCalledWith(1, 'c-a')
    expect(api.fetchCompanySubjectTypes).toHaveBeenNthCalledWith(2, 'c-b')

    api.registryQueue[1].resolve(['RETAILER']) // B 的立场先回
    await flushPromises()
    expect(vm.registryLoading).toBe(false)
    expect(wrapper.text()).toContain('售电公司')

    api.registryQueue[0].resolve(['GENERATOR']) // A 的立场晚到 → 丢弃
    await flushPromises()
    expect(wrapper.text()).toContain('售电公司')
    expect(wrapper.text()).not.toContain('电厂')
    expect(vm.registryLoading).toBe(false)
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('A 的立场请求失败晚于 B 返回 → 不把立场清成空数组，也不弹过期错误', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({}) as never)
    const { wrapper } = mountView()

    selectedCompanyId.value = 'c-b'
    await nextTick()
    api.registryQueue[1].resolve(['RETAILER'])
    await flushPromises()
    expect(wrapper.text()).toContain('售电公司')

    api.registryQueue[0].reject(new Error('公司A请求失败')) // A 失败晚到 → 丢弃，不清空、不弹错
    await flushPromises()
    expect(wrapper.text()).toContain('售电公司')
    expect(wrapper.text()).not.toContain('未登记多立场')
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('公司档案本体同理：A 的档案响应晚于 B 返回 → 不覆盖 B 的档案（同类一并处理）', async () => {
    const { vm } = mountView()
    expect(api.profileQueue).toHaveLength(1)

    selectedCompanyId.value = 'c-b'
    await nextTick()
    expect(api.profileQueue).toHaveLength(2)

    api.profileQueue[1].resolve({ contact: 'B-联系人', address: 'B-地址', businessScope: 'B-经营范围' })
    await flushPromises()
    expect(vm.form.contact).toBe('B-联系人')
    expect(vm.loading).toBe(false)

    api.profileQueue[0].resolve({ contact: 'A-联系人', address: 'A-地址', businessScope: 'A-经营范围' })
    await flushPromises()
    expect(vm.form.contact).toBe('B-联系人')
    expect(vm.loading).toBe(false)
  })
})
