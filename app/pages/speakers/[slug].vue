<script setup lang="ts">
import { formatDateFr, socialIcon, isWhiteLogo, talkNumericId, speakerSlug } from '~/utils/format'

const route = useRoute()
const slug = String(route.params.slug)

const [{ data: allSpeakers }, { data: allTalks }, { data: meetupsDoc }] = await Promise.all([
  useAsyncData(`speaker-${slug}-speakers`, () => queryCollection('speakers').all()),
  useAsyncData(`speaker-${slug}-talks`, () => queryCollection('talks').all()),
  useAsyncData(`speaker-${slug}-meetups`, () => queryCollection('meetups').first())
])

const speaker = computed(() =>
  (allSpeakers.value ?? []).find((s: any) => speakerSlug(s) === slug)
)

if (!speaker.value) {
  throw createError({ statusCode: 404, statusMessage: 'Speaker introuvable', fatal: true })
}

const eventsById = computed(() => {
  const map = new Map<number, any>()
  for (const e of (meetupsDoc.value?.events ?? [])) map.set(e.id, e)
  return map
})

const talks = computed(() => {
  const ids: number[] = speaker.value?.talks ?? []
  return ids
    .map((id) => {
      const talk = (allTalks.value ?? []).find((t: any) => talkNumericId(t) === id)
      if (!talk) return null
      const event = talk.meetup != null ? eventsById.value.get(talk.meetup) : undefined
      return { id, talk, event }
    })
    .filter(Boolean) as { id: number, talk: any, event: any }[]
})

useSeoMeta({
  title: () =>
    speaker.value
      ? `${speaker.value.firstname} ${speaker.value.lastname} — MTG Bordeaux`
      : 'Speaker — MTG Bordeaux',
  description: () =>
    speaker.value?.role
      ? `${speaker.value.firstname} ${speaker.value.lastname}, ${speaker.value.role}${speaker.value.company?.name ? ' @ ' + speaker.value.company.name : ''}`
      : undefined
})
</script>

<template>
  <div v-if="speaker">
    <section class="border-b border-default bg-elevated/30">
      <UContainer class="py-12">
        <UButton
          to="/speakers"
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          size="sm"
          class="mb-4"
        >
          Retour aux speakers
        </UButton>

        <div class="flex flex-col sm:flex-row sm:items-center gap-6">
          <UAvatar
            :src="speaker.photo"
            :alt="`${speaker.firstname} ${speaker.lastname}`"
            size="3xl"
          />
          <div class="min-w-0 flex-1">
            <h1 class="text-3xl md:text-4xl font-bold">
              {{ speaker.firstname }} {{ speaker.lastname }}
            </h1>
            <p v-if="speaker.role" class="mt-2 text-muted">{{ speaker.role }}</p>

            <div v-if="speaker.company" class="mt-3 flex items-center gap-2">
              <a
                v-if="speaker.company.logo"
                :href="speaker.company.link || undefined"
                :target="speaker.company.link ? '_blank' : undefined"
                :rel="speaker.company.link ? 'noopener' : undefined"
                :title="speaker.company.name"
                :aria-label="speaker.company.name"
                class="w-10 h-10 rounded-md p-1 shadow-sm ring-1 ring-black/5 flex items-center justify-center"
                :class="isWhiteLogo(speaker.company.logo) ? 'bg-gray-900' : 'bg-white dark:bg-gray-100'"
              >
                <img
                  :src="speaker.company.logo"
                  :alt="speaker.company.name"
                  class="max-w-full max-h-full object-contain"
                >
              </a>
              <a
                v-if="speaker.company.link"
                :href="speaker.company.link"
                target="_blank"
                rel="noopener"
                class="text-sm hover:underline"
              >
                {{ speaker.company.name }}
              </a>
              <span v-else class="text-sm">{{ speaker.company.name }}</span>
            </div>

            <div v-if="speaker.socials?.length" class="mt-4 flex flex-wrap gap-1">
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
          </div>
        </div>
      </UContainer>
    </section>

    <UContainer class="py-10">
      <h2 class="text-2xl font-bold mb-6">Talks ({{ talks.length }})</h2>
      <div v-if="talks.length" class="grid gap-6 lg:grid-cols-2">
        <UCard v-for="{ id, talk, event } in talks" :key="id" class="h-full">
          <template #header>
            <h3 class="font-semibold text-base">{{ talk.title }}</h3>
            <NuxtLink
              v-if="event"
              :to="`/events/${event.id}`"
              class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted hover:text-default"
            >
              <span class="flex items-center gap-1.5">
                <UIcon name="i-lucide-calendar-days" />
                {{ event.name }}
              </span>
              <span v-if="event.date" class="flex items-center gap-1.5">
                <UIcon name="i-lucide-calendar" />
                {{ formatDateFr(event.date) }}
              </span>
            </NuxtLink>
          </template>

          <p v-if="talk.abstract" class="text-sm whitespace-pre-line">{{ talk.abstract }}</p>

          <template v-if="talk.replay" #footer>
            <UButton
              :to="talk.replay"
              target="_blank"
              icon="i-lucide-play"
              variant="outline"
              color="neutral"
              size="sm"
            >
              Replay
            </UButton>
          </template>
        </UCard>
      </div>
      <p v-else class="text-muted">Aucun talk renseigné pour ce speaker.</p>
    </UContainer>
  </div>
</template>
