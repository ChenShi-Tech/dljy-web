import { YUNNAN_TRADING_FEATURE_ENABLED } from './config'
import type { NavItem } from '../../data/navigation'

// 云南交易工作台（/xhjy/yunnan）已并入「现货交易驾驶舱」/dashboard（现货交易分组首位）：
// 身份区域 hero + 分组 tab + 7 个真实数据 panel 全部迁入 TradingCockpitView.vue，
// 侧栏不再保留「云南交易工作台」独立入口（功能收敛到一个旗舰首页，避免入口重叠）。
// 原 /xhjy/yunnan 及其 11 个 alias 子路径已 redirect 到 /dashboard（带 ?tab= 预选），深链不丢。
// 导出保留 null（navigation.ts 的 spread 注入点 `[...(yunnanTradingNavigation ? [...] : [])]`
// 因 null 自动展开为空数组），feature flag 保留以备回滚。
export const yunnanTradingNavigation: NavItem | null = null
void YUNNAN_TRADING_FEATURE_ENABLED // 保留 import 备回滚（feature 门控逻辑不再产生菜单项）
