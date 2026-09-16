// 页面背景：侧边栏每一轮消息都附带的「用户正在看什么」（统一 AI 侧边栏 PI-03）。
// 纯函数，便于单测；取值（路由、地区、公司）在侧边栏壳里完成。

export interface AiPageContext {
  page_label: string
  route: string
  region: { id: string; name: string }
  company: { id: string; name: string }
}

export function buildPageContext(input: {
  routePath: string
  routeTitle?: string | null
  pageLabel?: string | null
  region: { id: string; name: string }
  company: { companyId: string; name: string }
}): AiPageContext {
  return {
    page_label: input.pageLabel || input.routeTitle || input.routePath,
    route: input.routePath,
    region: { id: input.region.id, name: input.region.name },
    company: { id: input.company.companyId, name: input.company.name }
  }
}

/**
 * 一轮消息的不可信上下文：页面背景每轮都带；数据切片只在发起它的那一轮带（design D4）。
 * 两者分键（page_context / slice），互不覆盖。
 */
export function composeMessageContext(
  page: AiPageContext,
  slice: Record<string, unknown> | null
): Record<string, unknown> {
  return slice ? { page_context: page, slice } : { page_context: page }
}
