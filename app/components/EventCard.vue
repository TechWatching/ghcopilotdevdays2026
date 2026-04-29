<script setup lang="ts">
import { formatDateFr, normalizeLogo } from '~/utils/format'

defineProps<{
  event: {
    id: number
    name: string
    date: string
    location?: string
    url?: string
    replay?: string
    partners?: { name: string, link?: string, url?: string, logo?: string }[]
    talks?: number[]
  }
}>()
</script>

<template>
  <UCard class="h-full hover:shadow-lg transition-shadow">
    <template #header>
      <div class="flex items-start justify-between gap-3">
        <div>
          <h3 class="font-semibold text-lg">
            <NuxtLink :to="`/events/${event.id}`" class="hover:text-primary">
              {{ event.name }}
            </NuxtLink>
          </h3>
          <p class="text-sm text-muted flex items-center gap-1 mt-1">
            <UIcon name="i-lucide-calendar" class="w-4 h-4" />
            {{ formatDateFr(event.date) }}
          </p>
          <p v-if="event.location" class="text-sm text-muted flex items-center gap-1">
            <UIcon name="i-lucide-map-pin" class="w-4 h-4" />
            {{ event.location }}
          </p>
        </div>
        <UBadge v-if="event.talks?.length" color="neutral" variant="subtle">
          {{ event.talks.length }} talk{{ event.talks.length > 1 ? 's' : '' }}
        </UBadge>
      </div>
    </template>

    <div v-if="event.partners?.length" class="flex flex-wrap items-center gap-3">
      <span class="text-xs text-muted">Partenaires :</span>
      <a
        v-for="p in event.partners"
        :key="p.name"
        :href="p.link || p.url"
        target="_blank"
        rel="noopener"
        :title="p.name"
        class="inline-block"
      >
        <img
          v-if="p.logo"
          :src="normalizeLogo(p.logo)"
          :alt="p.name"
          class="h-8 w-auto object-contain bg-white rounded p-1"
        >
        <span v-else>{{ p.name }}</span>
      </a>
    </div>

    <template #footer>
      <div class="flex flex-wrap gap-2">
        <UButton :to="`/events/${event.id}`" icon="i-lucide-arrow-right" trailing color="primary" variant="solid" size="sm">
          Voir le détail
        </UButton>
        <UButton v-if="event.replay" :to="event.replay" target="_blank" icon="i-lucide-play" variant="outline" color="neutral" size="sm">
          Replay
        </UButton>
        <UButton v-if="event.url" :to="event.url" target="_blank" icon="i-simple-icons-meetup" variant="ghost" color="neutral" size="sm">
          Meetup
        </UButton>
      </div>
    </template>
  </UCard>
</template>
