// 液态玻璃球独立预览入口（orb-preview.html）：不登录、不连后端，
// 用于挑预设/调参数/验证 WebGPU 环境。与 grid-geo.html 的 standalone 模式同构。
import { createApp, defineComponent, h } from 'vue'
import LiquidGlassOrb from './LiquidGlassOrb.vue'
import { ORB_PRESETS, type OrbPresetId } from './orbPresets'

const OrbCard = defineComponent({
  props: { preset: { type: String as () => OrbPresetId, required: true }, size: { type: Number, default: 120 } },
  setup(props) {
    return () =>
      h('div', { class: 'orb-card' }, [
        h('div', { class: 'orb-ball', style: { width: `${props.size}px`, height: `${props.size}px` } }, [
          h(LiquidGlassOrb, { preset: props.preset })
        ]),
        h('span', { class: 'orb-label' }, ORB_PRESETS[props.preset].label)
      ])
  }
})

const App = defineComponent({
  setup() {
    const ids = Object.keys(ORB_PRESETS) as OrbPresetId[]
    return () =>
      h('div', { class: 'page' }, [
        h('h1', '液态玻璃球 · AI 球预览'),
        h('p', { class: 'sub' }, 'WebGPU 渲染；不支持的环境自动降级为 CSS 静态玻璃球。'),
        h(
          'div',
          { class: 'grid' },
          ids.map((id) => h(OrbCard, { key: id, preset: id }))
        ),
        h('h2', '大尺寸（AI 助手入口 64px 放大对照）'),
        h('div', { class: 'row' }, [
          h(OrbCard, { preset: 'blueDrop', size: 220 }),
          h(OrbCard, { preset: 'siri', size: 220 }),
          h(OrbCard, { preset: 'aurora', size: 220 })
        ])
      ])
  }
})

createApp(App).mount('#app')
