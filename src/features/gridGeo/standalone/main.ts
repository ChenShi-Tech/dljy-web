import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import '@/styles/global.css'
import '@/styles/theme.css'
import '@/styles/theme-arc.css'
import '@/styles/responsive.css'
import { initTheme } from '@/services/theme'
import GridGeoStandaloneApp from './GridGeoStandaloneApp.vue'

initTheme()
createApp(GridGeoStandaloneApp).use(ElementPlus).mount('#app')
