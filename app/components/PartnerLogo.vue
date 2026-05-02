<script setup lang="ts">
import { isWhiteLogo, normalizeLogo } from '~/utils/format'
const props = defineProps<{
  partner: { name: string, link?: string, url?: string, logo?: string }
}>()
const needsDarkBg = computed(() => isWhiteLogo(props.partner.logo))
</script>

<template>
  <a
    :href="partner.link || partner.url || '#'"
    target="_blank"
    rel="noopener"
    :title="partner.name"
    class="inline-flex items-center justify-center rounded p-2 h-14 w-32 hover:scale-105 transition-transform"
    :class="needsDarkBg ? 'bg-gray-900' : 'bg-white'"
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
