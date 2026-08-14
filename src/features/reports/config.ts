// 报表中心特性开关：默认开启（与云南交易/南网披露一致用 DISABLE 反向开关）。
// 报表中心对取数失败做优雅降级（占位 + “模拟数据”标注），不强依赖后端报表服务就绪。
export const REPORTS_FEATURE_ENABLED = import.meta.env.VITE_DISABLE_REPORTS !== '1'
