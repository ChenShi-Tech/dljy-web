// 「按实例世代钉死」的 session-ready 处理器工厂。
//
// 背景：申报台把 AgentChatPanel 挂在 `:key="\`draft-${draftRunKey}\`"` 上，点一次「协助起草」
// 就递增 runKey 强制重挂。旧实例的 `createAgentSession()` 不受卸载 abort 控制，会晚归并
// emit session-ready。
//
// 陷阱在**世代号是什么时候读的**：模板里写内联箭头
//   `@session-ready="(id) => onSessionReadyFor('draft', id, draftRunKey)"`
// 时，`draftRunKey` 会被编译成事件到达那一刻的 `$setup.draftRunKey` 访问——也就是**当前值**，
// 于是旧实例的迟到事件也能通过世代校验，用旧会话 id 覆盖新实例已登记的 id。用户看到的是：
// 连点两次「协助起草」后，侧栏高亮和后续续聊都落在被丢弃的那个会话上。
//
// 正确做法是让世代号在**渲染期**就烘进闭包：模板写 `@session-ready="handler('draft', draftRunKey)"`，
// 处理器表达式在渲染时求值，旧 vnode 保留携带旧世代的旧闭包，迟到事件因而被正确丢弃。
// 本模块把这一语义固化成 API——调用方只能"先拿 handler 再等事件"，没有读当前值的写法。

export interface SessionReadyGuardOptions<M extends string> {
  /** 取某模式当前的实例世代（响应式读取，调用时求值）。 */
  currentRunKey: (mode: M) => number
  /** 世代校验通过后落库会话 id。 */
  commit: (mode: M, sessionId: string) => void
}

/**
 * 返回一个**工厂**：`factory(mode, runKey)` → 事件处理器。
 * `runKey` 在调用工厂时即被闭包捕获，事件到达时只与当时的值比较。
 * 处理器返回 boolean 便于单测断言（模板中忽略返回值）。
 */
export function makeSessionReadyGuard<M extends string>(
  options: SessionReadyGuardOptions<M>
): (mode: M, runKey: number) => (sessionId: string) => boolean {
  return (mode, runKey) => (sessionId) => {
    if (runKey !== options.currentRunKey(mode)) return false // 旧实例的迟到事件
    options.commit(mode, sessionId)
    return true
  }
}
