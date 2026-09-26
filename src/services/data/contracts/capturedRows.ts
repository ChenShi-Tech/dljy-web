// 采集回放载荷的行类型（消费方此前 fetchCaptured<any> 整行裸奔）。
// 字段按消费路径观测收敛：只登记已被页面读取的字段，未观测字段不预设——
// 新消费出现时先补类型再取数（与 debt #9「脏数据边界手写守卫」收敛方向一致）。

/**
 * `/api/real` 回放信封（列表族）：rows / data 二选一由后端与采集包形态定，
 * 消费侧以 Array.isArray 守卫后使用（401/403 降级空信封也走此形状）。
 */
export interface CapturedListEnvelope<Row> {
  code?: number
  data?: Row[]
  rows?: Row[]
  accessDenied?: boolean
  msg?: string
}

/**
 * yn_system_forecast 三族（load_forecast / new_energy_forecast_d1 / inter_provincial_forecast）行。
 * 目标日口径：new_energy_forecast_d1 为滚动 D-1 集（operateDate=发布日、targetDate=目标日），
 * 单日期表 targetDate=null 回退 operateDate。
 */
export type YnForecastRow = {
  /** 发布日 */
  operateDate?: string
  /** 被预测的目标日（滚动集归组键，可能为 null） */
  targetDate?: string | null
  /** 断面时点（外送合计按 timePoint 分桶） */
  timePoint?: number | string
  /** 地区/断面名（含「云南」的断面行用于总送出合计） */
  region?: string
  /** 指标键（如 inter_provincial_send） */
  metric?: string
  /** 指标值；消费处 typeof 守卫窄化为 number */
  value?: number | string | null
}
