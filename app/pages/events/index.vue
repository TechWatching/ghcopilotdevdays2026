<script setup lang="ts">
const { data: meetupsDoc } = await useAsyncData('events-list', () =>
  queryCollection('meetups').first()
)

const sortedEvents = computed(() => {
  const list = meetupsDoc.value?.events ?? []
  return [...list].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
})

const allPartners = computed(() => {
  const names = new Set<string>()
  for (const ev of sortedEvents.value) {
    for (const p of ev.partners ?? []) {
      if (p.name) names.add(p.name)
    }
  }
  return [...names].sort()
})

const allLocations = computed(() => {
  const locs = new Set<string>()
  for (const ev of sortedEvents.value) {
    if (ev.location) locs.add(ev.location)
  }
  return [...locs].sort()
})

const selectedPartners = ref<string[]>([])
const selectedLocations = ref<string[]>([])

function togglePartner(name: string) {
  const idx = selectedPartners.value.indexOf(name)
  if (idx === -1) selectedPartners.value.push(name)
  else selectedPartners.value.splice(idx, 1)
}

function toggleLocation(loc: string) {
  const idx = selectedLocations.value.indexOf(loc)
  if (idx === -1) selectedLocations.value.push(loc)
  else selectedLocations.value.splice(idx, 1)
}

function clearAllFilters() {
  selectedPartners.value = []
  selectedLocations.value = []
}

const events = computed(() => {
  const noPartnerFilter = selectedPartners.value.length === 0
  const noLocationFilter = selectedLocations.value.length === 0
  if (noPartnerFilter && noLocationFilter) return sortedEvents.value
  return sortedEvents.value.filter(ev => {
    const partnerMatch = noPartnerFilter || (ev.partners ?? []).some((p: { name: string }) => selectedPartners.value.includes(p.name))
    const locationMatch = noLocationFilter || selectedLocations.value.includes(ev.location)
    return partnerMatch && locationMatch
  })
})

useSeoMeta({ title: 'Événements — MTG Bordeaux' })
</script>

<template>
  <div>
    <section class="border-b border-default">
      <UContainer class="py-12">
        <h1 class="text-3xl md:text-4xl font-bold">Événements</h1>
        <p class="mt-2 text-muted">
          Tous les meetups organisés par le MTG Bordeaux, du plus récent au plus ancien.
        </p>
        <UBadge class="mt-4" color="primary" variant="subtle">{{ events.length }} meetups</UBadge>
      </UContainer>
    </section>

    <section class="border-b border-default">
      <UContainer class="py-4">
        <div class="flex flex-wrap gap-2 items-center">
          <UButton
            size="sm"
            color="primary"
            :variant="selectedPartners.length === 0 && selectedLocations.length === 0 ? 'solid' : 'outline'"
            @click="clearAllFilters"
          >
            Tous
          </UButton>
        </div>
        <div class="flex flex-wrap gap-2 items-center mt-3">
          <span class="text-xs text-muted font-medium w-full">Partenaires :</span>
          <UButton
            v-for="partner in allPartners"
            :key="partner"
            size="sm"
            color="primary"
            :variant="selectedPartners.includes(partner) ? 'solid' : 'outline'"
            @click="togglePartner(partner)"
          >
            {{ partner }}
          </UButton>
        </div>
        <div class="flex flex-wrap gap-2 items-center mt-3">
          <span class="text-xs text-muted font-medium w-full">Lieux :</span>
          <UButton
            v-for="loc in allLocations"
            :key="loc"
            size="sm"
            color="neutral"
            :variant="selectedLocations.includes(loc) ? 'solid' : 'outline'"
            @click="toggleLocation(loc)"
          >
            {{ loc }}
          </UButton>
        </div>
      </UContainer>
    </section>

    <UContainer class="py-10">
      <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <EventCard v-for="ev in events" :key="ev.id" :event="ev" />
      </div>
    </UContainer>
  </div>
</template>
