// 筛选条件 ⇄ 路由 query 双向同步：刷新页面/分享链接后筛选状态可还原。
// 交互体验优化：此前仅个别视图（PriceAnalysisView/FshqView）手写了 query 还原，
// 这里抽成通用 composable 供所有带筛选器的视图使用。
//
// 用法（在 setup 顶层调用）：
//   const date = ref(today())
//   const mode = ref<'rq' | 'jy'>('rq')
//   useQuerySync({ date, mode })
//
// 约定：值为空字符串时从 query 中移除该键；number/boolean 自动按初始类型还原。
import { watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

export type QuerySyncValue = string | number | boolean

export function useQuerySync(fields: Record<string, Ref<QuerySyncValue>>) {
  const route = useRoute()
  const router = useRouter()

  // 进入页面时按 query 还原（按各 ref 当前值的类型做反序列化）
  for (const [key, field] of Object.entries(fields)) {
    const raw = route.query[key]
    if (typeof raw !== 'string' || raw === '') continue
    const current = field.value
    if (typeof current === 'number') {
      const n = Number(raw)
      if (Number.isFinite(n)) field.value = n
    } else if (typeof current === 'boolean') {
      field.value = raw === '1' || raw === 'true'
    } else {
      field.value = raw
    }
  }

  // 变更时写回 query（replace 不污染历史栈）
  watch(Object.values(fields), () => {
    const query: Record<string, string> = {}
    for (const [key, value] of Object.entries(route.query)) {
      if (typeof value === 'string') query[key] = value
    }
    for (const [key, field] of Object.entries(fields)) {
      const v = field.value
      const serialized = typeof v === 'boolean' ? (v ? '1' : '0') : String(v)
      if (serialized === '') delete query[key]
      else query[key] = serialized
    }
    router.replace({ query }).catch(() => {
      /* 路由守卫重定向时忽略 */
    })
  })
}
