<script setup lang="ts">
import { normalizeLogo } from '~/utils/format'
defineProps<{
  partner: { name: string, link?: string, url?: string, logo?: string }
}>()
</script>

<template>
  <a
    :href="partner.link || partner.url || '#'"
    target="_blank"
    rel="noopener"
    :title="partner.name"
    class="inline-flex items-center justify-center bg-white rounded p-2 h-14 w-32 hover:scale-105 transition-transform"
  >
    <img
      v-if="partner.logo"
      :src="normalizeLogo(partner.logo)"
      :alt="partner.name"
      class="max-h-full max-w-full object-contain"
    >
    <span v-else class="text-xs text-gray-700">{{ partner.name }}</span>
  </a>
</template>
