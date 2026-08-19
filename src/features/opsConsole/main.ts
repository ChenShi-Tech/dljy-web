// 数据运维台独立入口（Epic #2169 P2-2b · #2174）：管理页自主前端迁出后的独立控制台。
// 装配对齐 grid-geo 独立入口先例（ElementPlus + 全局样式 + initTheme），另挂 pinia
// （六页消费 auth/region 等全局 store）与 opsRouter（六页 + ADMIN/BOSS 门）。
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import '@/styles/global.css'
import '@/styles/theme.css'
import '@/styles/theme-arc.css'
import '@/styles/responsive.css'
import '@/styles/charts.css'
import { initTheme } from '@/services/theme'
import OpsConsoleApp from './OpsConsoleApp.vue'
import { opsRouter } from './opsRouter'

initTheme()

createApp(OpsConsoleApp).use(createPinia()).use(ElementPlus).use(opsRouter).mount('#app')
