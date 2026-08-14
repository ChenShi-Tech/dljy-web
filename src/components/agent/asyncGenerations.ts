// AgentChatPanel 两条异步通道的世代簿记。
//
// 面板同时跑两类互不感知的异步：**流式运行**（SSE，send/decide/attach）与**历史加载**
// （fetchHistoryTranscript）。任一方晚归都会写回共享状态（messages/session/streaming），
// 所以两边各自带世代号做 stale 检查。
//
// 真正难的不是"各自加守卫"，而是**两者必须互相作废**——PR #1426 连续七轮 codex 审查里，
// 有五轮都是同一类漏网：给一条通道加了守卫，却没让它作废另一条。散在组件里的
// `++streamGeneration` / `historyLoadGeneration++` 有 20+ 处，每新增一个入口就得重新想一遍
// 规则；把规则收进这里，入口只需选对语义动词。
//
// 交叉作废规则（改这里等于改语义，务必连同 spec 一起改）：
// | 动作 | 流世代 | 历史世代 | 为什么 |
// |---|---|---|---|
// | `beginStream` 开新流 | ++ | **++** | 用户点历史会话后未返回就发新消息：历史响应仍有效 → 会中止刚启动的 SSE 并用旧 transcript 覆盖新消息 |
// | `beginHistoryLoad` 载历史 | 不动 | ++ | 流的作废由调用方显式 `invalidateStream()`（要连带 abort reader + 复位 UI，不只是数字） |
// | `invalidateStream` 切走/新建 | ++ | 不动 | 仅停流；loadHistory 内部调用它时不能顺手作废自己的历史世代 |
// | `invalidateHistoryLoad` 新建对话 | 不动 | ++ | 在途 transcript 会把新建的空会话覆盖回旧会话 |
//
// 纯函数模块（不依赖 Vue 响应式），便于单测锁死上表。

export interface AsyncGenerations {
  /** 开一次新的流式运行；返回本次流世代。**同时作废在途历史加载。** */
  beginStream(): number
  /** 开一次历史加载；返回本次历史世代。不动流世代。 */
  beginHistoryLoad(): number
  /** 作废在途流（切会话/新建对话）。不动历史世代。 */
  invalidateStream(): void
  /** 作废在途历史加载（新建对话）。不动流世代。 */
  invalidateHistoryLoad(): void
  /** 该流世代是否已过期（过期 → 其回调/收尾一律跳过，不得碰共享状态）。 */
  isStreamStale(generation: number): boolean
  /** 该历史世代是否已过期（过期 → 不得写回 messages/session）。 */
  isHistoryStale(generation: number): boolean
}

export function createAsyncGenerations(): AsyncGenerations {
  let stream = 0
  let history = 0
  return {
    beginStream() {
      history += 1
      stream += 1
      return stream
    },
    beginHistoryLoad() {
      history += 1
      return history
    },
    invalidateStream() {
      stream += 1
    },
    invalidateHistoryLoad() {
      history += 1
    },
    isStreamStale(generation) {
      return generation !== stream
    },
    isHistoryStale(generation) {
      return generation !== history
    },
  }
}
