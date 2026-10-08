<script setup lang="ts">
import { socialIcon, isWhiteLogo } from '~/utils/format'

defineProps<{
  speaker: {
    firstname: string
    lastname: string
    photo?: string
    role?: string
    company?: { name: string, link?: string, logo?: string } | null
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

    <template #footer>
      <div class="flex h-10 items-center gap-3">
        <div v-if="speaker.socials?.length" class="flex shrink-0 gap-1">
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
        <!-- Fixed height, width follows the logo's aspect ratio (capped), so wide wordmarks stay legible. -->
        <a
          v-if="speaker.company?.logo"
          :href="speaker.company.link || undefined"
          :target="speaker.company.link ? '_blank' : undefined"
          :rel="speaker.company.link ? 'noopener' : undefined"
          :title="speaker.company.name"
          :aria-label="speaker.company.name"
          class="ml-auto flex h-10 min-w-10 max-w-28 items-center justify-center rounded-md p-1.5 shadow-sm ring-1 ring-black/5"
          :class="isWhiteLogo(speaker.company.logo) ? 'bg-gray-900' : 'bg-white dark:bg-gray-100'"
        >
          <img
            :src="speaker.company.logo"
            :alt="speaker.company.name"
            class="h-full w-auto min-w-0 max-w-full object-contain"
          >
        </a>
      </div>
    </template>
  </UCard>
</template>
