// 立场上下文单测（Epic #2193 · #2195）。
//
// 继承自已删除的 positionContext.spec.ts 的两条红线断言（语义随「推导上收服务端」
// 平移，断言方向不变）：
//   ① 立场集合与 allowedSubjectTypes（数据可见范围）正交——扩大那个不得扩大这个；
//   ② 空态不默认——会话未就绪/数据脏 → 空集合，绝不静默回落成某个具体立场
//     （默认成售电就是把储能主体的单据换成售电单据）。
// 新增服务端权威语义：允许集合只来自 user.stances 下发，前端零推导。
import { beforeEach, describe, expect, it } from 'vitest'
import type { Stance } from '@/services/governance'

// stanceContext 在浏览器运行，读 window.localStorage 记住作业立场；单测是纯 node
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

const {
  syncStancesFromSession,
  setActiveStance,
  clearStanceContext,
  activeStance,
  activeStanceKey,
  activeStanceType,
  stances,
  isMultiStance,
  requiresStanceSelection,
  currentStanceHeader,
  stanceKeyOf
} = await import('./stanceContext')

function stance(partial: Partial<Stance>): Stance {
  return { subjectType: 'TRADER', subjectId: 'TRADER-X', subjectName: '交易组合', crossView: false, ...partial }
}

/** 服务端典型下发形态：home TRADER + 公司注册立场三个 crossView（沿用账号主体 id）。 */
function traderMultiStance(): Stance[] {
  return [
    stance({ subjectType: 'TRADER', crossView: false }),
    stance({ subjectType: 'RETAILER', crossView: true }),
    stance({ subjectType: 'STORAGE', crossView: true }),
    stance({ subjectType: 'GENERATOR', crossView: true })
  ]
}

beforeEach(() => {
  storage._store.clear()
  clearStanceContext()
})

describe('允许集合只来自服务端下发，前端零推导', () => {
  it('user.stances 原样生效（home 首位 + crossView 标记透传）', () => {
    syncStancesFromSession({ subjectType: 'TRADER', subjectId: 'TRADER-X', subjectName: '组合', stances: traderMultiStance() })
    expect(stances.value.map((s) => s.subjectType)).toEqual(['TRADER', 'RETAILER', 'STORAGE', 'GENERATOR'])
    expect(stances.value[0].crossView).toBe(false)
    expect(stances.value.slice(1).every((s) => s.crossView)).toBe(true)
    expect(isMultiStance.value).toBe(true)
    // 多立场未选择：不默认任何立场，等待选择页
    expect(activeStance.value).toBeNull()
    expect(requiresStanceSelection()).toBe(true)
  })

  it('扩大 allowedSubjectTypes 不会扩大可用立场（两者正交）', () => {
    // allowedSubjectTypes 是 data-scope 的行过滤维度；若被误当立场来源，这个账号
    // 就能装配出集合外立场的单据——那是越权面。断言用单立场账号才有区分力：
    // 服务端只下发了 home 一项，任何本地字段都不得把它变多。
    syncStancesFromSession({
      subjectType: 'RETAILER',
      subjectId: 'RETAILER-X',
      subjectName: '售电公司',
      // 故意夹带与立场无关的用户字段：允许集合必须只认 stances，不受其影响
      ...( { allowedSubjectTypes: ['RETAILER', 'GENERATOR', 'STORAGE'] } as Record<string, unknown>),
      stances: [stance({ subjectType: 'RETAILER', subjectId: 'RETAILER-X', subjectName: '售电公司' })]
    } as Parameters<typeof syncStancesFromSession>[0])
    expect(stances.value.map((s) => s.subjectType)).toEqual(['RETAILER'])
    expect(isMultiStance.value).toBe(false)
  })

  it('服务端 stances 缺失（旧会话/降级部署）按 home 单立场兜底', () => {
    syncStancesFromSession({ subjectType: 'STORAGE', subjectId: 'STORAGE-X', subjectName: '储能组合' })
    expect(stances.value).toHaveLength(1)
    expect(stances.value[0]).toEqual({ subjectType: 'STORAGE', subjectId: 'STORAGE-X', subjectName: '储能组合', crossView: false })
    expect(activeStanceType.value).toBe('STORAGE')
    expect(requiresStanceSelection()).toBe(false)
  })

  it('非法/脏形态条目被剔除，不猜测', () => {
    syncStancesFromSession({
      subjectType: 'TRADER',
      subjectId: 'TRADER-X',
      subjectName: '组合',
      stances: [
        { subjectType: 'POS_X', subjectId: 'x', subjectName: '脏类型', crossView: false },
        stance({ subjectType: 'RETAILER', subjectId: 'RETAILER-X', crossView: true }),
        { subjectType: 'GENERATOR', subjectId: 'GEN-X' } // 缺 crossView 字段
      ]
    })
    expect(stances.value.map((s) => s.subjectType)).toEqual(['RETAILER'])
  })
})

describe('空态不默认（继承 positionContext 红线）', () => {
  it('会话未就绪时为空，不默认成任何立场', () => {
    syncStancesFromSession(null)
    expect(stances.value).toEqual([])
    // 关键：不得回落成 RETAILER —— 那会把储能主体的单据换成售电单据
    expect(activeStance.value).toBeNull()
    expect(requiresStanceSelection()).toBe(false)
  })

  it('主体类型脏数据时为空态', () => {
    syncStancesFromSession({ subjectType: 'POS_X', subjectId: 'x', subjectName: '脏' })
    expect(stances.value).toEqual([])
    expect(activeStance.value).toBeNull()
  })
})

describe('切换守卫：未授权立场切不动', () => {
  it('切到集合内的立场成功并写入请求头值', () => {
    syncStancesFromSession({ subjectType: 'TRADER', subjectId: 'TRADER-X', subjectName: '组合', stances: traderMultiStance() })
    const key = stanceKeyOf(stance({ subjectType: 'STORAGE', subjectId: 'TRADER-X', crossView: true }))
    expect(setActiveStance(key)).toBe(true)
    expect(activeStanceType.value).toBe('STORAGE')
    expect(currentStanceHeader()).toBe(`STORAGE:TRADER-X`)
    expect(requiresStanceSelection()).toBe(false)
  })

  it('切到集合外的立场被拒且不改变现状', () => {
    syncStancesFromSession({ subjectType: 'TRADER', subjectId: 'TRADER-X', subjectName: '组合', stances: traderMultiStance() })
    expect(setActiveStance('LOAD:LOAD-X')).toBe(false)
    expect(activeStanceKey.value).toBeNull()
  })
})

describe('本地偏好须经允许集合守卫', () => {
  it('本地存的立场在集合内则恢复（刷新页面不丢立场）', () => {
    const user = { subjectType: 'TRADER', subjectId: 'TRADER-X', subjectName: '组合', stances: traderMultiStance() }
    syncStancesFromSession(user)
    setActiveStance('STORAGE:TRADER-X')
    // 模拟刷新：重新从会话同步
    syncStancesFromSession(user)
    expect(activeStanceType.value).toBe('STORAGE')
  })

  it('本地脏值（换账号/收回授权后残留）一律失效，多立场重进选择态', () => {
    storage.setItem('dljy.activeStance', 'GENERATOR:TRADER-X')
    syncStancesFromSession({
      subjectType: 'RETAILER',
      subjectId: 'RETAILER-X',
      subjectName: '售电公司',
      stances: [stance({ subjectType: 'RETAILER', subjectId: 'RETAILER-X', subjectName: '售电公司' })]
    })
    // 单立场账号：本地脏值不得越权生效，自动落 home
    expect(activeStanceType.value).toBe('RETAILER')
    expect(activeStanceKey.value).toBe('RETAILER:RETAILER-X')
  })

  it('登出清空后不把立场泄漏给下一个账号', () => {
    syncStancesFromSession({ subjectType: 'TRADER', subjectId: 'TRADER-X', subjectName: '组合', stances: traderMultiStance() })
    setActiveStance('GENERATOR:TRADER-X')
    clearStanceContext()
    expect(stances.value).toEqual([])
    expect(activeStance.value).toBeNull()

    // 下一个账号是专职储能岗：不得继承上一个账号选的 GENERATOR
    syncStancesFromSession({ subjectType: 'STORAGE', subjectId: 'STORAGE-X', subjectName: '储能组合' })
    expect(activeStanceType.value).toBe('STORAGE')
  })
})

describe('单立场账号零打扰', () => {
  it('单立场自动落 home，无选择页、无切换器', () => {
    syncStancesFromSession({
      subjectType: 'GENERATOR',
      subjectId: 'GENERATOR-YN-CGN',
      subjectName: '中广核云南',
      stances: [stance({ subjectType: 'GENERATOR', subjectId: 'GENERATOR-YN-CGN', subjectName: '中广核云南' })]
    })
    expect(isMultiStance.value).toBe(false)
    expect(requiresStanceSelection()).toBe(false)
    expect(activeStanceType.value).toBe('GENERATOR')
    expect(currentStanceHeader()).toBe('GENERATOR:GENERATOR-YN-CGN')
  })
})
