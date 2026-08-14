import { GRID_OPERATOR_PROFILE_REGION_IDS } from 'shared/region/grid-operator-profiles.mjs'

// 空间资产模块默认开启；现场不需要时可用反向开关关闭菜单与路由，API 保持只读可用。
export const GRID_GEO_FEATURE_ENABLED = import.meta.env.VITE_DISABLE_GRID_GEO !== '1'
export const GRID_GEO_REGION_IDS = [...GRID_OPERATOR_PROFILE_REGION_IDS]
