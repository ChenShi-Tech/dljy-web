import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '@/services/auth'

// positionContext 在浏览器运行，读 window.localStorage 记住作业视角；单测是纯 node
// 环境，import 前需最小 stub（范式同 companyContext.spec.ts）。
function memoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    _store: store
  }
}
const storage = memoryStorage()
;(globalThis as unknown as { window: { localStorage: typeof storage } }).window = { localStorage: storage }

vi.mock('@/services/auth', () => ({ getStoredUser: vi.fn() }))

const { getStoredUser } = await import('@/services/auth')
const {
  syncPositionsFromSession,
  setActivePosition,
  clearPositionContext,
  activePosition,
  availablePositions,
  isMultiPosition
} = await import('./positionContext')

/** 'dljy-demo' 是 companyPositions 里显式登记的多立场公司（售电/储能/发电）。 */
const MULTI = 'dljy-demo'
/** 未登记多立场的普通公司 → 回落会话主立场单值。 */
const SINGLE = 'comp-shanxi'

function fakeUser(overrides: Partial<AuthUser>): AuthUser {
  return { username: 'u', companyId: SINGLE, subjectType: 'RETAILER', ...overrides } as AuthUser
}

beforeEach(() => {
  storage._store.clear()
  clearPositionContext()
  vi.mocked(getStoredUser).mockReset()
})

describe('立场集合来自公司注册，不来自数据可见范围', () => {
  it('扩大 allowedSubjectTypes 不会扩大可用立场（两者正交）', () => {
    // allowedSubjectTypes 是 data-scope 的行过滤维度；若被误当成立场集合，
    // 这个账号就能装配出发电/储能侧单据 —— 那是越权面。
    //
    // 断言必须用**跨立场视角**才有区分力：专业岗无论如何都只取主立场单值，
    // 即使代码错误地读了 allowedSubjectTypes，结果也一样 —— 那种断言是
    // 「因错误的理由通过」。TRADER 会取「公司注册全集」，误读会直接漏出来。
    syncPositionsFromSession(
      fakeUser({
        companyId: SINGLE, // 公司未登记多立场
        subjectType: 'TRADER',
        allowedSubjectTypes: ['RETAILER', 'GENERATOR', 'STORAGE'] as never
      })
    )
    expect(availablePositions.value).toEqual(['TRADER'])
  })

  it('普通公司的专业岗只有自己的主立场', () => {
    syncPositionsFromSession(fakeUser({ companyId: SINGLE, subjectType: 'STORAGE' }))
    expect(availablePositions.value).toEqual(['STORAGE'])
    expect(activePosition.value).toBe('STORAGE')
    expect(isMultiPosition.value).toBe(false)
  })

  it('多立场公司的专业岗仍只作业自己那条线（分岗，不是全能）', () => {
    // 天泰形态：公司既买又卖，但售电经理只管售电、储能运营只管储能。
    syncPositionsFromSession(fakeUser({ companyId: MULTI, subjectType: 'RETAILER' }))
    expect(availablePositions.value).toEqual(['RETAILER'])
    expect(isMultiPosition.value).toBe(false)
  })

  it('多立场公司的组合视角（TRADER）可在注册立场间切换', () => {
    syncPositionsFromSession(fakeUser({ companyId: MULTI, subjectType: 'TRADER' }))
    expect(availablePositions.value).toEqual(['RETAILER', 'STORAGE', 'GENERATOR'])
    expect(isMultiPosition.value).toBe(true)
  })

  it('公司未登记多立场时，组合视角退回自身（至少有三线全集可用）', () => {
    syncPositionsFromSession(fakeUser({ companyId: SINGLE, subjectType: 'TRADER' }))
    expect(availablePositions.value).toEqual(['TRADER'])
  })
})

describe('配置不一致与会话缺失一律空态，不猜测', () => {
  it('会话未就绪时为空，不默认成任何立场', () => {
    vi.mocked(getStoredUser).mockReturnValue(null)
    syncPositionsFromSession()
    expect(availablePositions.value).toEqual([])
    // 关键：不得回落成 RETAILER —— 那会把储能主体的单据换成售电单据
    expect(activePosition.value).toBeNull()
  })

  it('主立场非法（脏数据）时为空态', () => {
    syncPositionsFromSession(fakeUser({ subjectType: 'POS_X' as never }))
    expect(availablePositions.value).toEqual([])
    expect(activePosition.value).toBeNull()
  })

  it('公司显式登记的立场不含用户主立场时为空态，不放行', () => {
    // 'dljy-demo' 登记了售电/储能/发电，没有登记「负荷主体」。
    // 用户自称 LOAD 而公司没注册该主体 = 配置错误，放行等于允许提交无权主体的单据。
    syncPositionsFromSession(fakeUser({ companyId: MULTI, subjectType: 'LOAD' }))
    expect(availablePositions.value).toEqual([])
    expect(activePosition.value).toBeNull()
  })
})

describe('切换守卫：未授权立场切不动', () => {
  it('切到可用集合内的立场成功', () => {
    syncPositionsFromSession(fakeUser({ companyId: MULTI, subjectType: 'TRADER' }))
    expect(setActivePosition('STORAGE')).toBe(true)
    expect(activePosition.value).toBe('STORAGE')
  })

  it('切到集合外的立场被拒且不改变现状', () => {
    syncPositionsFromSession(fakeUser({ companyId: SINGLE, subjectType: 'RETAILER' }))
    expect(setActivePosition('GENERATOR')).toBe(false)
    expect(activePosition.value).toBe('RETAILER')
  })
})

describe('本地偏好须经可用集合守卫', () => {
  it('本地存的视角在集合内则恢复（刷新页面不丢视角）', () => {
    const user = fakeUser({ companyId: MULTI, subjectType: 'TRADER' })
    syncPositionsFromSession(user)
    setActivePosition('STORAGE')
    syncPositionsFromSession(user)
    expect(activePosition.value).toBe('STORAGE')
  })

  it('本地脏值（换了公司/收回授权后残留）一律回落，不越权生效', () => {
    storage.setItem('dljy.activePosition', 'GENERATOR')
    syncPositionsFromSession(fakeUser({ companyId: SINGLE, subjectType: 'RETAILER' }))
    expect(activePosition.value).toBe('RETAILER')
  })

  it('登出清空后不把视角泄漏给下一个账号', () => {
    syncPositionsFromSession(fakeUser({ companyId: MULTI, subjectType: 'TRADER' }))
    setActivePosition('GENERATOR')
    clearPositionContext()
    expect(availablePositions.value).toEqual([])
    expect(activePosition.value).toBeNull()

    // 下一个账号是普通公司的储能岗：不得继承上一个账号选的 GENERATOR
    syncPositionsFromSession(fakeUser({ companyId: SINGLE, subjectType: 'STORAGE' }))
    expect(activePosition.value).toBe('STORAGE')
  })
})
