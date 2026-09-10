import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import '@/styles/global.css'
import '@/styles/theme.css'
import '@/styles/theme-arc.css'
import '@/styles/responsive.css'
import { initTheme } from '@/services/theme'
// Mock 演示账号 fetch 守卫（PRD §4.3 边界 7）：grid-geo.html 独立入口与主应用同源共享
// 登录态，mock 会话下同样不回源真实后端；判定与分流逻辑与主入口完全一致。
import { installMockFetchGuard } from '@/services/mock/fetchGuard'
import GridGeoStandaloneApp from './GridGeoStandaloneApp.vue'

initTheme()
installMockFetchGuard()
createApp(GridGeoStandaloneApp).use(ElementPlus).mount('#app')
