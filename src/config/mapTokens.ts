/**
 * 三维地图凭据的运行时解析层
 * ------------------------------------------------------------------
 * 背景：Cesium ion token 原先只有 `import.meta.env.VITE_CESIUM_ION_TOKEN` 一条来源，
 * 那是 **Vite 构建期** 注入的常量——意味着「地形供应商」下拉框里的
 * 「Cesium World Terrain」永远灰着显示「未配置 token」，而界面上根本没有任何地方
 * 可以填。对本地开发只是麻烦（改 .env.local 重启），对现场交付则是死结：
 * 客户拿到的是构建产物，没有源码也没有构建环境，永远开不了那一档。
 *
 * 这里把凭据抽成「运行时优先、构建期兜底」的两级来源：
 *   1. localStorage（用户在地形面板里填的）—— 现场可改，立即生效
 *   2. import.meta.env（构建期注入的）—— 开发与内部部署的默认值
 *
 * 为什么 localStorage 排在前面：它是「本机这个人此刻的选择」，语义上应当压过
 * 打包时烧进去的默认值；否则一旦构建期配了 token，现场就再也换不掉。
 *
 * 安全说明：ion token 是**前端可见**的第三方地图服务凭据（Cesium 官方就是这么用的，
 * 它随每个瓦片请求发出，任何人 F12 都能看到），不属于需要保密的后端密钥。放在
 * localStorage 与放在构建产物里的暴露面完全相同，因此不引入额外风险。
 */

/** localStorage 键；与 `useViewPreference` 的 `dljy.grid-geo.*` 前缀同族。 */
export const ION_TOKEN_STORAGE_KEY = 'dljy.grid-geo.ion-token'

/** 凭据变更事件名：地图组件监听它以重建 imagery/terrain，无需刷新页面。 */
export const MAP_TOKEN_CHANGE_EVENT = 'dljy:map-token-change'

/** 凭据来源，供 UI 如实说明「这个 token 是哪来的」。 */
export type IonTokenSource = 'runtime' | 'build' | 'none'

/**
 * 本会话内的凭据值，用于 localStorage 写不进去时兜底。
 *
 * `null` = 本会话没设过，一切以存储/构建期为准；`''` = 用户在本会话显式清除过
 * （应回落构建期值，而不是把存储里的残留读回来）。两者必须分开，用一个空串表达
 * 不了「没设过」和「设成了空」的区别。
 *
 * 没有这一层的话，隐私模式/嵌入式部署里 setItem 抛异常时 `writeIonToken` 会立刻
 * 重读存储并把刚填的 token 丢掉——而那恰恰是这条容错分支唯一要服务的环境。
 */
let sessionToken: string | null = null

function readStorage(): string {
  // 隐私模式/禁用存储时 localStorage 取值会抛；拿不到凭据可接受，页面崩溃不可接受。
  try {
    if (typeof localStorage === 'undefined') return ''
    return String(localStorage.getItem(ION_TOKEN_STORAGE_KEY) ?? '').trim()
  } catch {
    return ''
  }
}

function readBuildTime(): string {
  return String(import.meta.env.VITE_CESIUM_ION_TOKEN ?? '').trim()
}

/** 当前生效的 ion token；无凭据时返回空串（调用方据此判断是否可用）。 */
export function resolveIonToken(): string {
  if (sessionToken !== null) return sessionToken || readBuildTime()
  return readStorage() || readBuildTime()
}

/** 当前 token 的来源，用于面板文案区分「你填的」与「打包时带的」。 */
export function resolveIonTokenSource(): IonTokenSource {
  const runtime = sessionToken !== null ? sessionToken : readStorage()
  if (runtime) return 'runtime'
  if (readBuildTime()) return 'build'
  return 'none'
}

export function hasIonToken(): boolean {
  return resolveIonToken().length > 0
}

/**
 * 写入运行时 token。传空串表示清除运行时值、回落到构建期值。
 * @returns 写入后实际生效的 token（便于调用方立即据此重建地图）
 */
export function writeIonToken(token: string): string {
  const value = String(token ?? '').trim()
  // 先记会话值再落盘：落盘失败时这一层仍然生效，本次会话按新值走（跨会话才丢）。
  sessionToken = value
  try {
    if (typeof localStorage !== 'undefined') {
      if (value) localStorage.setItem(ION_TOKEN_STORAGE_KEY, value)
      else localStorage.removeItem(ION_TOKEN_STORAGE_KEY)
    }
  } catch {
    // 写失败只意味着跨会话不被记住，不中断本次保存。
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MAP_TOKEN_CHANGE_EVENT))
  }
  return resolveIonToken()
}

/** ArcGIS 影像/高程服务的可选 token（免费源不需要；企业版 ArcGIS Online 才用）。 */
export function resolveArcgisToken(): string {
  return String(import.meta.env.VITE_GRID_GEO_ARCGIS_TOKEN ?? '').trim()
}
