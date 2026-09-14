// 台账输出变量明细取自共享标的注册表，不把输入协变量或未知标的推断成某种目标。
import { FORECAST_TARGETS, targetUnit } from 'shared/forecast/target-registry.mjs'

export function forecastTargetDetails(targets: readonly string[]) {
  return [...new Set(targets.filter((target) => typeof target === 'string' && target.trim()))].map((id) => {
    const spec = FORECAST_TARGETS.find((target) => target.id === id)
    return {
      id,
      name: spec?.labelZh ?? `未登记目标（${id}）`,
      unit: targetUnit(id) ?? '单位未声明',
      interval: spec?.granularity === '15min' ? '15分钟 / 每日96点'
        : spec?.granularity === '60min' ? '1小时 / 每日24点'
          : spec?.granularity === 'daily' ? '每日1点' : '粒度未声明',
    }
  })
}
