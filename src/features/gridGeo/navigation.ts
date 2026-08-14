import { CloudSun, FileSearch, GitBranch, LayoutDashboard, MapPinned, Network, Orbit, Radar, Waypoints } from 'lucide-vue-next'
import type { NavItem } from '@/data/navigation'
import { GRID_GEO_REGION_IDS } from './config'

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
      path: '/grid-assets/market',
      title: '电力市场空间态势',
      icon: Radar,
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
