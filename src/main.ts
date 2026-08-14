import { createApp } from 'vue'
import { installRegionPackages } from './features/regions'
// pinia（Phase 0 统一数据层）：必须在 router 之前挂，供 capturedData 等数据层 store
// 在路由守卫与组件 setup 中可用。
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'

import App from './App.vue'
import router from './router'
import './styles/global.css'
import './styles/theme.css'
import './styles/theme-arc.css'
import './styles/responsive.css'
import './styles/charts.css'
// 统一主题入口(services/theme):经典/弧光/霓虹/暖纸 四档 + 峰平谷时段。
// 挂载前先按已存储值设好 <html data-theme>,避免首屏闪原版。
import { initTheme } from '@/services/theme'

initTheme()

// 地区扩展包装配（Epic #1431 S3）：把各省专属面板注册到内核命名插槽。
// 必须在 mount 前完成，内核渲染时才能解析到插槽。
installRegionPackages()

const app = createApp(App)

app.use(createPinia())
app.use(ElementPlus)
app.use(router)
app.mount('#app')
