<script setup lang="ts">
// 模型台账的可点击目标数量：输出目标与输入协变量必须分开解释。
import { computed, ref, watch } from 'vue'
import { forecastTargetDetails } from '@/services/forecast/forecastTargetDetails'

const props = withDefaults(defineProps<{ targets: string[]; modelName: string; declared?: boolean }>(), { declared: true })
const opened = ref(false)
const details = computed(() => forecastTargetDetails(props.targets))
watch(() => [props.modelName, props.targets, props.declared], () => { opened.value = false })
</script>

<template>
  <el-button class="target-count" link type="primary" :aria-label="`查看${modelName}的预测目标声明`" @click="opened = true">{{ declared ? details.length : '未声明' }}</el-button>
  <el-dialog v-if="opened" v-model="opened" :title="`${modelName} · 支持的预测目标`" width="min(520px, 92vw)" append-to-body>
    <p class="target-help">以下是这个算法可以预测的输出变量，不代表同时输出，也不是输入协变量的数量。具体日期是否可运行，还取决于该地区的数据和模型输入要求。</p>
    <ul v-if="declared && details.length" class="target-details">
      <li v-for="item in details" :key="item.id">
        <span>{{ item.name }}</span>
        <small>{{ item.id }} · {{ item.unit }} · {{ item.interval }}</small>
      </li>
    </ul>
    <el-empty v-else :description="declared ? '该算法声明的支持目标为空' : '旧目录未声明支持目标，不能把兼容选项当作已确认能力'" />
    <p class="target-help">协变量是帮助预测的输入，例如温度、历史负荷、风速；支持目标数不能用来判断模型使用了多少协变量。</p>
  </el-dialog>
</template>

<style scoped>
.target-count { min-width: 32px; min-height: 32px; text-decoration: underline; text-underline-offset: 3px; }
.target-help { margin: 0 0 14px; color: var(--el-text-color-secondary); font-size: var(--font-sm, 12px); line-height: 1.7; }
.target-details { list-style: none; padding: 0; margin: 0 0 16px; max-height: 45vh; overflow-y: auto; }
.target-details li { padding: 8px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.target-details span, .target-details small { display: block; overflow-wrap: anywhere; }
.target-details small { margin-top: 4px; color: var(--el-text-color-secondary); }
</style>
