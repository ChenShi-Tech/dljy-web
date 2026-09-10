// Mock 演示会话判定（PRD：docs/product/mock-demo-account-prd.md）。
//
// 唯一判定依据：登录用户名 `mock-` 前缀。判定不依赖任何环境变量——配错 env 也不会让
// 真实账号看到演示数据、或让演示账号看到真实数据（隔离是需求红线，见 PRD §4.2）。
// 判定结果按 localStorage 原始串 memo（一次会话内重复 fetch 判定零解析开销）。

const USER_KEY = 'dljy_governance_user'
export const MOCK_DEMO_PREFIX = 'mock-'
/** mock 会话专属存储命名空间：演示写操作/智能体会话等全部挂前缀，真实账号无读取路径。 */
export const MOCK_NAMESPACE = 'dljy.mock.'

/** 账号切换/登出时需要一并清理的跨账号数据面缓存键（PRD 边界 5：缓存串扰）。 */
const SESSION_SCOPED_KEYS = ['dljy.currentCompanyId', 'dljy.piPocSessionIds'] as const

export function isMockDemoUsername(username: unknown): boolean {
  return typeof username === 'string' && username.trim().toLowerCase().startsWith(MOCK_DEMO_PREFIX)
}

export function isMockDemoUser(user: unknown): boolean {
  return Boolean(user) && typeof user === 'object' && isMockDemoUsername((user as { username?: unknown }).username)
}

function readStoredUserRaw(): string | null {
  try {
    return localStorage.getItem(USER_KEY)
  } catch {
    return null
  }
}

let memoRaw: string | null | undefined
let memoActive = false

/** 当前登录态是否为 mock 演示会话。fetch 守卫每次请求都会调用，按原始串 memo。 */
export function isMockActive(): boolean {
  const raw = readStoredUserRaw()
  if (raw !== memoRaw) {
    memoRaw = raw
    memoActive = false
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw)
        memoActive = isMockDemoUser(parsed)
      } catch {
        memoActive = false
      }
    }
  }
  return memoActive
}

function purgeNamespacedKeys(storage: Storage) {
  const doomed: string[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (key && (key.startsWith(MOCK_NAMESPACE) || (SESSION_SCOPED_KEYS as readonly string[]).includes(key))) {
      doomed.push(key)
    }
  }
  for (const key of doomed) storage.removeItem(key)
}

/**
 * 清理 mock 会话数据 + 跨账号数据面缓存。在登出、以及「新登录身份与上一身份 mock 属性不同」
 * 时调用，保证真实账号读不到 `dljy.mock.*`、mock 账号不带上一账号的公司/会话残留。
 */
export function resetSessionScopedCaches(): void {
  try {
    purgeNamespacedKeys(sessionStorage)
    purgeNamespacedKeys(localStorage)
  } catch {
    /* 隐私模式等 storage 不可用场景：mock 数据本就写不进去，忽略 */
  }
}
