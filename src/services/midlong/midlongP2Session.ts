// 中长期售电 P2 对话框的会话代次（dljy#2971）。
// 对话框里「先 await（读文件等）再写」或写请求较慢时，用户可能已关闭对话框、重开到另一份合同或另一类分配。
// 提交开始时（任何 await 之前）快照写入目标与代次，await 之后核对：代次或写入目标变了，就放弃写入，
// 或放弃把结果、报错、关闭动作作用到新的会话上——旧会话的内容不能写到新对象上。

export interface DialogSessionToken {
  generation: number
  target: string
}

export function createDialogSession() {
  let generation = 0
  return {
    /** 对话框打开或关闭时调用：此前发起的提交一律视为过期。 */
    renew() {
      generation += 1
    },
    /** 提交开始时调用；target 是写入目标的键（合同、版本、分配类型等）。 */
    begin(target: string): DialogSessionToken {
      return { generation, target }
    },
    /** await 之后调用：代次未变且写入目标未变才继续。 */
    isCurrent(token: DialogSessionToken, target: string) {
      return token.generation === generation && token.target === target
    },
  }
}

/** 放弃过期写入时给用户的提示。 */
export const STALE_DIALOG_WRITE_MESSAGE = '对话框已关闭或已切换到其他对象，已放弃这次提交，没有保存任何内容'
