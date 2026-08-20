// 云南地区扩展包画像（Epic #1431 S3 第二段）
// 只声明「本省是什么样的市场」，不含取数与渲染逻辑。能源结构占比一律 unknown
// `REGION_DRIVER` 只是 hydro/thermal 分类，接入真实装机/发电结构数据前不填数
// （与 mechanismProfile 的 B4 纪律同源：不可推导即 unknown，绝不猜测）。

export const YUNNAN_REGION_ID = 'yunnan'

export type RegionEnergyProfile = {
  regionId: string
  /** 主导驱动分类（来自 ML 特征管线 REGION_DRIVER 的同源事实） */
  keyDrivers: string[]
  /** 装机/发电占比：接入真实结构数据前一律 unknown */
  shares: { hydro: 'unknown'; thermal: 'unknown'; renewable: 'unknown' }
  /** 丰枯期月份（云南水电主导市场的机制性特征，来源同 ML 管线 WET_MONTHS） */
  wetMonths: number[]
  /** 本省专属机制说明（UI 可见，用于「该市场无此机制」的对照解释） */
  mechanismNotes: string[]
}

export const yunnanEnergyProfile: RegionEnergyProfile = {
  regionId: YUNNAN_REGION_ID,
  keyDrivers: ['hydro', 'water_inflow'],
  shares: { hydro: 'unknown', thermal: 'unknown', renewable: 'unknown' },
  wetMonths: [6, 7, 8, 9, 10],
  mechanismNotes: [
    '水电主导：来水丰枯直接驱动供给曲线，丰枯期价格结构差异显著',
    '南方区域联合出清 + 省内结算两级结构（出清模型事实源未接入前不作机器可读断言）',
    '西电东送断面外送量参与竞价空间计算'
  ]
}
