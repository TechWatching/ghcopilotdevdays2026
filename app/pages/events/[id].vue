<script setup lang="ts">
import { formatDateFr, normalizeLogo } from '~/utils/format'

const route = useRoute()
const id = Number(route.params.id)

const [{ data: meetupsDoc }, { data: allTalks }, { data: allSpeakers }] = await Promise.all([
  useAsyncData(`event-${id}-meetups`, () => queryCollection('meetups').first()),
  useAsyncData(`event-${id}-talks`, () => queryCollection('talks').all()),
  useAsyncData(`event-${id}-speakers`, () => queryCollection('speakers').all())
])

const event = computed(() => meetupsDoc.value?.events?.find((e: any) => e.id === id))

function talkNumericId(t: any): number {
  const stem = String(t?.stem ?? '').split('/').pop() ?? ''
  return Number.parseInt(stem.split('.')[0] ?? '', 10)
}

const talks = computed(() => {
  if (!event.value) return []
  const orderedIds: number[] = event.value.talks ?? []
  const forMeetup = (allTalks.value ?? []).filter((t: any) => t.meetup === id)
  // Order by the YAML `talks: [..]` sequence in events.yml when possible.
  return forMeetup.sort((a: any, b: any) => {
    const ia = orderedIds.indexOf(talkNumericId(a))
    const ib = orderedIds.indexOf(talkNumericId(b))
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })
})

function speakersOf(talkId: number) {
  return (allSpeakers.value ?? []).filter((s: any) => (s.talks ?? []).includes(talkId))
}

if (!event.value) {
  throw createError({ statusCode: 404, statusMessage: 'Événement introuvable', fatal: true })
}

useSeoMeta({
  title: () => event.value ? `${event.value.name} — MTG Bordeaux` : 'Événement — MTG Bordeaux'
})
</script>

<template>
  <div v-if="event">
    <section class="border-b border-default bg-elevated/30">
      <UContainer class="py-12">
        <UButton to="/events" icon="i-lucide-arrow-left" variant="ghost" color="neutral" size="sm" class="mb-4">
          Retour aux événements
        </UButton>
        <h1 class="text-3xl md:text-4xl font-bold">{{ event.name }}</h1>
        <div class="mt-3 flex flex-wrap gap-4 text-muted">
          <span class="flex items-center gap-1.5">
            <UIcon name="i-lucide-calendar" />{{ formatDateFr(event.date) }}
          </span>
          <span v-if="event.location" class="flex items-center gap-1.5">
            <UIcon name="i-lucide-map-pin" />{{ event.location }}
          </span>
        </div>

        <div class="mt-6 flex flex-wrap gap-2">
          <UButton v-if="event.replay" :to="event.replay" target="_blank" icon="i-lucide-play" color="primary">
            Voir le replay
          </UButton>
          <UButton v-if="event.url" :to="event.url" target="_blank" icon="i-simple-icons-meetup" variant="outline" color="neutral">
            Page Meetup
          </UButton>
        </div>

        <div v-if="event.partners?.length" class="mt-8">
          <h2 class="text-sm font-semibold text-muted mb-2">Partenaires</h2>
          <div class="flex flex-wrap gap-3">
            <PartnerLogo v-for="p in event.partners" :key="p.name" :partner="p" />
          </div>
        </div>
      </UContainer>
    </section>

    <UContainer class="py-10">
      <h2 class="text-2xl font-bold mb-6">Talks ({{ talks.length }})</h2>
      <div v-if="talks.length" class="grid gap-6 lg:grid-cols-2">
        <TalkItem
          v-for="t in talks"
          :key="talkNumericId(t)"
          :talk="t"
          :speakers="speakersOf(talkNumericId(t))"
        />
      </div>
      <p v-else class="text-muted">Aucun talk renseigné pour cet événement.</p>
    </UContainer>
  </div>
</template>
