// 中长期操作导引中尚未实现的条目（dljy#3404）：选择面板里灰显「规划中」，不可点。
// 只登记标题/摘要/涉及的锚点（plannedAnchors 仅作文档索引，锚点守卫不检查）。
// 「分解与场站」已实现（dljy#3405）；「计划与交易执行」已实现（dljy#3406，midlong/planExecution.ts）。
import type { GuideDefinition } from '../types'

export const plannedGuides: GuideDefinition[] = [
  {
    id: 'midlong.adjust-review',
    group: 'midlong',
    title: '调整与复盘账单',
    summary: '录入更正版本、复盘口径与账单核对。',
    status: 'planned',
    requires: [],
    needsWrite: true,
    steps: [],
    plannedAnchors: ['ml-correct-dialog', 'ml-review-bill'],
  },
]
