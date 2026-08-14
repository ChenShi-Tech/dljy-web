import { FileBarChart } from 'lucide-vue-next'
import type { NavItem } from '../../data/navigation'

// 报表中心：全主体通用入口，置于顶层菜单。具体报表数据按 DataScope/subjectType 在数据层隔离。
export const reportsNavigation: NavItem = {
  path: '/report/center',
  title: '报表中心',
  icon: FileBarChart
}
