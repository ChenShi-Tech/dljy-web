import { watch } from 'vue'
import { currentRegion } from '@/services/region/regionContext'

// 切换地区时重新执行页面的数据加载。首屏由各页自身的 onMounted 负责，这里只在
// 地区变化后触发，故不加 immediate。集中封装避免各页重复 import watch/currentRegion，
// 也规避与页面已有的 watch 导入产生重复声明冲突。
export function onRegionChange(reload: () => void | Promise<void>) {
  watch(() => currentRegion.value.id, () => {
    void reload()
  })
}
