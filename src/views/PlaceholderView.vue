<script setup lang="ts">
// Handoff placeholder. Renders the real-page metadata defined on each route in
// router/index.ts so the running app is a faithful, self-documenting map of the
// production menu (from getRouters). These placeholders should be replaced with real views
// that load the captured data described here. See docs/data/data-inventory.md.
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const meta = computed(() => route.meta as Record<string, any>)
const kind = computed(() => (meta.value.kind as string) || 'real')
const kindLabel = computed(() => ({ real: '真实数据', forecast: '预测数据', mixed: '混合(含预测)' }[kind.value] || '数据'))
const kindTagType = computed(() => ({ real: 'success', forecast: 'danger', mixed: 'warning' }[kind.value] || 'info'))
</script>

<template>
  <div class="placeholder">
    <div class="ph-head">
      <div>
        <div class="ph-crumb">{{ meta.block }}</div>
        <h2 class="ph-title">{{ meta.title }}</h2>
      </div>
      <el-tag :type="kindTagType" effect="dark" size="large">{{ kindLabel }}</el-tag>
    </div>

    <el-alert
      v-if="kind === 'forecast' || kind === 'mixed'"
      type="warning"
      :closable="false"
      show-icon
      class="ph-warn"
      title="预测数据警告"
    >
      此页（或其中预测类型序列）为<strong>简陋算法预测的值，不是真实数据，数值不可信</strong>。
      还原时<strong>仅参考其输出格式/字段结构/业务逻辑</strong>，不要将预测数值当作可信业务数据。
    </el-alert>

    <el-descriptions :column="1" border class="ph-desc">
      <el-descriptions-item label="真实接口">
        <code>{{ meta.endpoint }}</code>
      </el-descriptions-item>
      <el-descriptions-item label="本地真实数据">
        <code>data/private/capture-raw/{{ meta.dataPath }}/</code>
      </el-descriptions-item>
      <el-descriptions-item v-if="meta.scope" label="数据规模/范围">
        {{ meta.scope }}
      </el-descriptions-item>
      <el-descriptions-item v-if="meta.note" label="说明">
        {{ meta.note }}
      </el-descriptions-item>
      <el-descriptions-item label="路由码 (getRouters)">
        <code>{{ meta.code }}</code>
      </el-descriptions-item>
    </el-descriptions>

    <p class="ph-todo">
      ⏳ 待实现：按上方真实数据构建本页视图。页面映射全表见
      <code>docs/data/data-inventory.md</code>；预测逻辑见 <code>docs/forecast/forecast-logic.md</code>。
    </p>
  </div>
</template>

<style scoped>
.placeholder { padding: 24px; max-width: 920px; }
.ph-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.ph-crumb { color: var(--el-text-color-secondary); font-size: 13px; }
.ph-title { margin: 4px 0 0; font-size: 22px; }
.ph-warn { margin-bottom: 16px; }
.ph-desc { margin-bottom: 16px; }
.ph-desc code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.ph-todo { color: var(--el-text-color-regular); font-size: 13px; background: var(--el-fill-color-light); padding: 12px 14px; border-radius: 6px; }
.ph-todo code { color: var(--el-color-primary); }
</style>
