<script setup lang="ts">
import { useRouter } from 'vue-router'
import { AlertTriangle, ArrowRight, BookOpen } from 'lucide-vue-next'

defineProps<{
  moduleTitle: string
  expectedRegionLabel: string
  currentRegionLabel: string
}>()

const router = useRouter()
</script>

<template>
  <section class="region-scoped-notice">
    <div class="notice-icon">
      <AlertTriangle :size="22" />
    </div>
    <div class="notice-copy">
      <span>地区专属模块</span>
      <h2>{{ moduleTitle }}</h2>
      <p>
        当前地区为 {{ currentRegionLabel }}，该模块只在 {{ expectedRegionLabel }} 地区启用。当前地区保留通用交易入口和待定制框架。
      </p>
      <div class="notice-actions">
        <el-button type="primary" :icon="ArrowRight" @click="router.push('/xhjy/region')">
          当前地区交易
        </el-button>
        <el-button :icon="BookOpen" @click="router.push('/sdzl/region-rules')">
          地区规则体系
        </el-button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.region-scoped-notice {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  min-height: 220px;
  padding: 22px;
  border: 1px solid var(--line-faint);
  border-radius: 8px;
  background: var(--panel-sub);
  color: var(--text);
}

.notice-icon {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  background: var(--warning-tint);
  color: var(--warning);
}

.notice-copy {
  min-width: 0;
}

.notice-copy span {
  color: var(--warning);
  font-size: var(--font-md);
  font-weight: 700;
}

.notice-copy h2 {
  margin: 7px 0 8px;
  color: var(--text);
  font-size: var(--font-24);
  letter-spacing: 0;
}

.notice-copy p {
  max-width: 720px;
  margin: 0;
  color: var(--text-soft);
  line-height: 1.7;
}

.notice-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

@media (max-width: 720px) {
  .region-scoped-notice {
    padding: 16px;
  }
}
</style>
