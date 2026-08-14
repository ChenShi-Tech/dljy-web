<script setup lang="ts">
// 参数表单 artifact：用户填写后把结果作为新消息回传给智能体（经 ARTIFACT_CONTEXT.submit）。
// 让 agent 能向用户「要参数」并据此重算，无需新增后端事件通道。
import { reactive, ref, inject } from 'vue'
import { FormInput, Send } from 'lucide-vue-next'
import type { FormArtifactBlock } from '../../../utils/artifactBlocks'
import ArtifactFrame from './ArtifactFrame.vue'
import { ARTIFACT_CONTEXT } from './context'

const props = defineProps<{ block: FormArtifactBlock }>()
const ctx = inject(ARTIFACT_CONTEXT, {})
const submitted = ref(false)
const model = reactive<Record<string, string>>({})
props.block.fields.forEach((f) => {
  model[f.name] = f.value ?? ''
})

function submit() {
  if (!ctx.submit || submitted.value) return
  const lines = props.block.fields.map((f) => `${f.label}：${model[f.name] || '(空)'}`)
  ctx.submit(`【${props.block.title}】\n${lines.join('\n')}`)
  submitted.value = true
}
</script>

<template>
  <ArtifactFrame kind="form" :title="block.title">
    <template #icon><FormInput :size="14" /></template>
    <div class="form-body">
      <div v-for="f in block.fields" :key="f.name" class="form-row">
        <label>{{ f.label }}</label>
        <select v-if="f.type === 'select'" v-model="model[f.name]" :disabled="submitted">
          <option value="">请选择</option>
          <option v-for="o in f.options" :key="o" :value="o">{{ o }}</option>
        </select>
        <textarea
          v-else-if="f.type === 'textarea'"
          v-model="model[f.name]"
          :placeholder="f.placeholder"
          :disabled="submitted"
          rows="3"
        />
        <input
          v-else
          v-model="model[f.name]"
          :type="f.type === 'number' ? 'number' : 'text'"
          :placeholder="f.placeholder"
          :disabled="submitted"
        />
      </div>
      <button class="submit-btn" :disabled="submitted || !ctx.submit" @click="submit">
        <Send :size="13" />{{ submitted ? '已提交' : block.submitLabel }}
      </button>
    </div>
  </ArtifactFrame>
</template>

<style scoped>
.form-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.form-row { display: flex; flex-direction: column; gap: 3px; }
.form-row label { font-size: 12px; opacity: 0.7; }
.form-row input, .form-row select, .form-row textarea {
  padding: 6px 9px; font-size: 13px; border: 1px solid rgba(125, 125, 125, 0.3); border-radius: 6px;
  background: var(--panel-bg, #fff); color: inherit; outline: none; font-family: inherit;
}
.form-row input:focus, .form-row select:focus, .form-row textarea:focus {
  border-color: var(--el-color-primary, #2563eb);
}
.form-row textarea { resize: vertical; }
.submit-btn {
  margin-top: 4px; align-self: flex-start; display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 16px; font-size: 13px; font-weight: 600; border: none; border-radius: 7px; cursor: pointer;
  background: var(--el-color-primary, #2563eb); color: #fff;
}
.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
