// RelationExplorer 共享类型（从 SFC 抽出——<script setup> 不能 export 具名类型）。

/** 参考竖线配置（原页面按小时叠加的 xnyzd/xnyg/xnygd 竖线）。 */
export interface RelationReferenceLine {
  /** 取自 dataset 的哪个数组。 */
  array: 'xnyzd' | 'xnyg' | 'xnygd'
  /** 数组内索引（xnygd 的 D+1..5 对应 0..4）。 */
  arrayIndex: number
  color: string
  width: number
  /** 图例文案；有则进图例，无（如 D+1..5 细线）则不进。 */
  legendLabel?: string
  /** 地区能力门控维度 id（status !== 'hidden' 才显示）；不填则不门控。 */
  dimensionId?: string
}
