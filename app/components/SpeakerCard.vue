<script setup lang="ts">
import { socialIcon, normalizeLogo } from '~/utils/format'

defineProps<{
  speaker: {
    firstname: string
    lastname: string
    photo?: string
    role?: string
    company?: { name: string, link?: string, url?: string, logo?: string }
    socials?: { type: string, link: string }[]
  }
}>()
</script>

<template>
  <UCard class="h-full">
    <template #header>
      <div class="flex items-center gap-4">
        <UAvatar
          :src="speaker.photo"
          :alt="`${speaker.firstname} ${speaker.lastname}`"
          size="xl"
        />
        <div class="min-w-0">
          <h3 class="font-semibold truncate">{{ speaker.firstname }} {{ speaker.lastname }}</h3>
          <p v-if="speaker.role" class="text-sm text-muted truncate">{{ speaker.role }}</p>
        </div>
      </div>
    </template>

    <div v-if="speaker.company" class="flex items-center gap-2 text-sm">
      <img
        v-if="speaker.company.logo"
        :src="normalizeLogo(speaker.company.logo)"
        :alt="speaker.company.name"
        class="w-6 h-6 object-contain rounded bg-white p-0.5"
      >
      <a
        v-if="speaker.company.link || speaker.company.url"
        :href="speaker.company.link || speaker.company.url"
        target="_blank"
        rel="noopener"
        class="hover:underline"
      >
        {{ speaker.company.name }}
      </a>
      <span v-else>{{ speaker.company.name }}</span>
    </div>

    <template v-if="speaker.socials?.length" #footer>
      <div class="flex flex-wrap gap-1">
        <UButton
          v-for="s in speaker.socials"
          :key="s.link"
          :to="s.link"
          :icon="socialIcon(s.type)"
          target="_blank"
          variant="ghost"
          color="neutral"
          size="sm"
          :aria-label="s.type"
        />
      </div>
    </template>
  </UCard>
</template>
