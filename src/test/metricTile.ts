import type { VueWrapper } from '@vue/test-utils'

/** 按标签读出指标卡的主数与单位；页面把数字、单位分开渲染，断言拼接文本会随排版漂移。复盘与中长期两域通用（#2954，两域页面均已改用公共 MetricTile 的 .tile/.k/.v 结构）。 */
export function metricTile(wrapper: VueWrapper, label: string): { value: string; unit: string } | null {
  const tile = wrapper.findAll('.tile').find(node => node.find('.k').text().trim() === label)
  if (!tile) return null
  const unit = tile.find('.v small').exists() ? tile.find('.v small').text().trim() : ''
  const value = tile.find('.v').text().replace(unit, '').trim()
  return { value, unit }
}
