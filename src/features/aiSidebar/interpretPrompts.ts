// 侧边栏解读的开场问题模板。系统提示词（解读角色与口径）不在前端：由后端按页面提示词白名单 key 取。

/** 已声明数据切片的页面的通用开场问题（切片随本轮消息下发，故可声明「数据已在上下文」）。 */
export function defaultInterpretQuestion(label: string): string {
  return `请解读本页「${label}」的关键发现与判断（数据已在上下文，仅就已给切片解读、勿臆造未取项）`
}
