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
  <UCard
    class="h-full relative"
    :ui="{ body: 'p-0 sm:p-0' }"
  >
    <a
      v-if="speaker.company?.logo"
      :href="speaker.company.link || undefined"
      :target="speaker.company.link ? '_blank' : undefined"
      :rel="speaker.company.link ? 'noopener' : undefined"
      :title="speaker.company.name"
      :aria-label="speaker.company.name"
      class="absolute top-3 right-3 z-10 w-12 h-12 rounded-md p-1.5 shadow-sm ring-1 ring-black/5 flex items-center justify-center"
      :class="isWhiteLogo(speaker.company.logo) ? 'bg-gray-900' : 'bg-white dark:bg-gray-100'"
    >
      <img
        :src="speaker.company.logo"
        :alt="speaker.company.name"
        class="max-w-full max-h-full object-contain"
      >
    </a>

    <template #header>
      <div class="flex items-center gap-4 pr-14">
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
