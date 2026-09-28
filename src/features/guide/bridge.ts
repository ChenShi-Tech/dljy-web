// 操作导引与页面之间的桥（dljy#3404）。
// 叶子纪律：运行时只 import vue（类型 import 编译后消失），不碰 companyContext / router
// 等业务模块——否则任何局部 mock 这些模块的 spec 都会连坐挂掉。
// 页面侧：useGuideForm / useGuideState / emitGuideSignal；运行器侧：read*/fill*/signal 订阅。
import { getCurrentInstance, onMounted, onUnmounted } from 'vue'

export type GuideFormAdapter = {
  read(): Record<string, unknown>
  fill(values: Record<string, unknown>): void
  submit?(): void | Promise<void>
}

/** 表单源：直接传 reactive 对象（fill=Object.assign），或传适配器。 */
export type GuideFormSource = Record<string, unknown> | GuideFormAdapter

type FormEntry = {
  read(): Record<string, unknown>
  fill(values: Record<string, unknown>): void
  submit?(): void | Promise<void>
  active(): boolean
}

const forms = new Map<string, Set<FormEntry>>()
const states = new Map<string, { snapshot: () => object | null; token: object }>()
const signals = new Map<string, Set<(payload: unknown) => void>>()

function isAdapter(source: GuideFormSource): source is GuideFormAdapter {
  return typeof (source as GuideFormAdapter).read === 'function'
}

function toEntry(source: GuideFormSource, active?: () => boolean): FormEntry {
  const isActive = active ?? (() => true)
  if (isAdapter(source)) {
    // submit 的非空窄化不跨闭包，先落到局部常量。
    const doSubmit = source.submit
    return {
      read: () => source.read(),
      fill: (values) => source.fill(values),
      submit: doSubmit ? () => doSubmit() : undefined,
      active: isActive,
    }
  }
  // reactive 对象：fill 直接合并；read 展开顶层属性，在 watch getter 里调用即可建立响应依赖。
  return {
    read: () => ({ ...source }),
    fill: (values) => Object.assign(source, values),
    active: isActive,
  }
}

/** 注册表单；返回注销函数，注销只清自己这一条（同 key 其它注册不受影响）。 */
export function registerGuideForm(key: string, source: GuideFormSource, active?: () => boolean): () => void {
  let set = forms.get(key)
  if (!set) {
    set = new Set()
    forms.set(key, set)
  }
  const entry = toEntry(source, active)
  set.add(entry)
  const setRef = set
  return () => {
    setRef.delete(entry)
    if (setRef.size === 0) forms.delete(key)
  }
}

/** 生效表单项：同一 key 多处注册（KeepAlive 下列表页与详情页并存）时取 active() 为真的第一个。 */
function activeForm(key: string): FormEntry | null {
  const set = forms.get(key)
  if (!set) return null
  for (const entry of set) {
    if (entry.active()) return entry
  }
  return null
}

/** 读表单当前值（在 watch getter 里调用可追踪 reactive 变化）；无生效表单返回 null。 */
export function readGuideForm(key: string): Record<string, unknown> | null {
  return activeForm(key)?.read() ?? null
}

/** 写入示例值；找不到生效表单（如对话框没开）返回 false，由调用方提示。 */
export function fillGuideForm(key: string, values: Record<string, unknown>): boolean {
  const entry = activeForm(key)
  if (!entry) return false
  entry.fill(values)
  return true
}

/** 触发表单自带提交（如持仓筛选的「查询」）；表单没有 submit 返回 false。 */
export async function submitGuideForm(key: string): Promise<boolean> {
  const entry = activeForm(key)
  if (!entry?.submit) return false
  await entry.submit()
  return true
}

/** 组件侧表单登记：onMounted 注册、onUnmounted 注销且只清自己。 */
export function useGuideForm(key: string, source: GuideFormSource, opts?: { active?: () => boolean }): () => void {
  let dispose: (() => void) | null = null
  if (getCurrentInstance()) {
    onMounted(() => {
      dispose = registerGuideForm(key, source, opts?.active)
    })
    onUnmounted(() => dispose?.())
  } else {
    // 无组件实例（纯函数场景）：立即注册，调用方用返回值自行清理。
    dispose = registerGuideForm(key, source, opts?.active)
  }
  return () => dispose?.()
}

/** 页面服务端状态快照登记：刷新后运行器靠它按真实数据找回进度；返回注销函数（只清自己）。 */
export function useGuideState(key: string, snapshot: () => object | null): () => void {
  const token = {}
  const put = () => states.set(key, { snapshot, token })
  const dispose = () => {
    // 只清自己：被后来的注册覆盖时不删别人的。
    if (states.get(key)?.token === token) states.delete(key)
  }
  if (getCurrentInstance()) {
    onMounted(put)
    onUnmounted(dispose)
  } else {
    put()
  }
  return dispose
}

/** 读状态快照（watch getter 里调用可追踪）；未登记返回 null。 */
export function readGuideState(key: string): object | null {
  return states.get(key)?.snapshot() ?? null
}

/** 订阅导引信号；返回注销函数。 */
export function onGuideSignal(name: string, cb: (payload: unknown) => void): () => void {
  let set = signals.get(name)
  if (!set) {
    set = new Set()
    signals.set(name, set)
  }
  const setRef = set
  setRef.add(cb)
  return () => {
    setRef.delete(cb)
    if (setRef.size === 0) signals.delete(name)
  }
}

/** 页面成功分支发信号（payload 见 midlong/anchors.ts 的信号契约）。 */
export function emitGuideSignal(name: string, payload?: unknown): void {
  const set = signals.get(name)
  if (!set) return
  // 复制后遍历：回调里注销自己不该中断其它订阅。
  for (const cb of [...set]) cb(payload)
}

/** 测试用：清空全部登记（避免用例间串扰），生产代码不得调用。 */
export function resetGuideBridge(): void {
  forms.clear()
  states.clear()
  signals.clear()
}
