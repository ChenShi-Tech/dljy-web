<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useRoute } from 'vue-router'
const route = useRoute()
const Workbench = defineAsyncComponent(() => import('./review/ReviewWorkbenchView.vue'))
const Classic = defineAsyncComponent(() => import('./ReviewClassicView.vue'))
</script>
<template>
  <Workbench v-if="route.query.layout === 'decisions'" />
  <Classic v-else />
</template>
