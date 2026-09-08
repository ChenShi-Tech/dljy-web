import { CloudSun, FileSearch, GitBranch, LayoutDashboard, MapPinned, Network, Orbit, Waypoints } from 'lucide-vue-next'
import type { NavItem } from '@/data/navigation'
import { GRID_GEO_REGION_IDS } from './config'

// 「电力市场空间态势」（/grid-assets/market）于 2026-09-08 摘出侧栏，功能已并入
// 「空间联动驾驶舱」的市场回放场景——驾驶舱那边本就有同一份数据加载器、图层切换、
// 排行榜与单厂详情，且多了日期选择，两页并存只是让用户在两个入口间猜哪个更全。
// 路由与页面按用户拍板保留（同「测算工具」「地区通用」的下架方式），整合若有遗漏
// 仍可走深链回去比对。
export const gridGeoNavigation: NavItem = {
  path: '/grid-assets',
  title: '空间资产',
  icon: Orbit,
  regionIds: GRID_GEO_REGION_IDS,
  children: [
    {
      path: '/grid-assets/command',
      title: '空间联动驾驶舱',
      icon: LayoutDashboard,
      regionIds: GRID_GEO_REGION_IDS,
    },
    {
      path: '/grid-assets/plants',
      title: '电厂地理空间',
      icon: MapPinned,
      regionIds: GRID_GEO_REGION_IDS,
    },
    {
      path: '/grid-assets/nodes',
      title: '节点空间资产',
      icon: Waypoints,
      regionIds: GRID_GEO_REGION_IDS,
    },
    {
      path: '/grid-assets/topology',
      title: '授权网架',
      icon: GitBranch,
      regionIds: GRID_GEO_REGION_IDS,
    },
    {
      path: '/grid-assets/disclosures',
      title: '公开披露空间层',
      icon: FileSearch,
      regionIds: GRID_GEO_REGION_IDS,
    },
    {
      path: '/grid-assets/weather-impact',
      title: '气象交易影响时序',
      icon: CloudSun,
      regionIds: GRID_GEO_REGION_IDS,
    },
    {
      path: '/grid-assets/operator-profile',
      title: '南网国网展示画像',
      icon: Network,
      regionIds: GRID_GEO_REGION_IDS,
    },
  ],
}
