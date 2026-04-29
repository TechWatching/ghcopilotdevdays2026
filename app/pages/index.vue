<script setup lang="ts">
const { data: meetupsDoc } = await useAsyncData('home-events', () =>
  queryCollection('meetups').first()
)

const events = computed(() => {
  const list = meetupsDoc.value?.events ?? []
  return [...list].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
})

const latest = computed(() => events.value.slice(0, 3))

const allPartners = computed(() => {
  const seen = new Map<string, any>()
  for (const ev of events.value) {
    for (const p of ev.partners ?? []) {
      if (!seen.has(p.name)) seen.set(p.name, p)
    }
  }
  return [...seen.values()]
})

const communityLinks = [
  { label: 'Sessionize (Call for speakers)', to: 'https://sessionize.com/mtg/', icon: 'i-lucide-mic' },
  { label: 'Meetup', to: 'https://www.meetup.com/mtg-bordeaux/', icon: 'i-simple-icons-meetup' },
  { label: 'La Grappe Numérique', to: 'https://www.lagrappenumerique.fr/#/mtg-bordeaux/', icon: 'i-lucide-grape' },
  { label: 'LinkedIn', to: 'https://www.linkedin.com/company/mtg-bordeaux', icon: 'i-simple-icons-linkedin' },
  { label: 'Bluesky', to: 'https://bsky.app/profile/mtgbordeaux.bsky.social', icon: 'i-simple-icons-bluesky' },
  { label: 'Discord MTG:France', to: 'https://discord.gg/tsJJSwKAac', icon: 'i-simple-icons-discord' },
  { label: 'MTG:France', to: 'https://www.mtg-france.org/', icon: 'i-lucide-globe' },
  { label: 'bordeaux@mtg-france.org', to: 'mailto:bordeaux@mtg-france.org', icon: 'i-lucide-mail' }
]
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="relative overflow-hidden border-b border-default">
      <div class="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5 pointer-events-none" />
      <UContainer class="py-20 md:py-28 relative">
        <div class="max-w-3xl">
          <UBadge color="primary" variant="subtle" class="mb-4">Microsoft Tech Group</UBadge>
          <h1 class="text-4xl md:text-6xl font-bold tracking-tight">
            MTG <span class="text-primary">Bordeaux</span>
          </h1>
          <p class="mt-4 text-lg md:text-xl text-muted">
            La communauté bordelaise autour des technologies Microsoft. Meetups, talks et échanges
            entre passionné·e·s du Cloud, du développement et de l'écosystème Microsoft.
          </p>
          <div class="mt-8 flex flex-wrap gap-3">
            <UButton to="/events" icon="i-lucide-calendar" size="lg" color="primary">
              Voir les événements
            </UButton>
            <UButton to="/speakers" icon="i-lucide-users" size="lg" variant="outline" color="neutral">
              Découvrir les speakers
            </UButton>
            <UButton
              to="https://sessionize.com/mtg/"
              target="_blank"
              icon="i-lucide-mic"
              size="lg"
              variant="ghost"
              color="neutral"
            >
              Proposer un talk
            </UButton>
          </div>
        </div>
      </UContainer>
    </section>

    <!-- About -->
    <section class="py-16">
      <UContainer class="grid gap-10 md:grid-cols-3">
        <div class="md:col-span-2 space-y-4">
          <h2 class="text-2xl md:text-3xl font-bold">À propos du groupe</h2>
          <p class="text-muted">
            Le <strong>Microsoft Tech Group: Bordeaux</strong> est un groupe d'utilisateurs basé à Bordeaux,
            dédié aux technologies Microsoft : Azure, .NET, GitHub, développeurs et IA. Nous organisons
            régulièrement des meetups gratuits avec des talks de la communauté, des replays accessibles
            à tous et des échanges autour des partenaires de l'écosystème.
          </p>
          <p class="text-muted">
            Le MTG Bordeaux est membre de
            <a href="https://www.mtg-france.org/" target="_blank" rel="noopener" class="text-primary hover:underline">MTG:France</a>,
            le réseau national des Microsoft Tech Groups.
          </p>
        </div>
        <UCard>
          <template #header>
            <h3 class="font-semibold flex items-center gap-2">
              <UIcon name="i-lucide-link" /> Rejoindre &amp; suivre
            </h3>
          </template>
          <ul class="space-y-1.5 text-sm">
            <li v-for="l in communityLinks" :key="l.label">
              <UButton
                :to="l.to"
                :icon="l.icon"
                :target="l.to.startsWith('http') ? '_blank' : undefined"
                variant="link"
                color="neutral"
                class="px-0"
              >
                {{ l.label }}
              </UButton>
            </li>
          </ul>
        </UCard>
      </UContainer>
    </section>

    <!-- Latest events -->
    <section v-if="latest.length" class="py-16 bg-elevated/50">
      <UContainer>
        <div class="flex items-end justify-between mb-8">
          <div>
            <h2 class="text-2xl md:text-3xl font-bold">Derniers événements</h2>
            <p class="text-muted">Les meetups les plus récents organisés à Bordeaux.</p>
          </div>
          <UButton to="/events" icon="i-lucide-arrow-right" trailing variant="ghost" color="neutral">
            Tout voir
          </UButton>
        </div>
        <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <EventCard v-for="ev in latest" :key="ev.id" :event="ev" />
        </div>
      </UContainer>
    </section>

    <!-- Partners -->
    <section v-if="allPartners.length" class="py-16">
      <UContainer>
        <h2 class="text-2xl md:text-3xl font-bold mb-2">Nos partenaires</h2>
        <p class="text-muted mb-8">Merci aux entreprises qui nous accueillent et nous soutiennent.</p>
        <div class="flex flex-wrap gap-4">
          <PartnerLogo v-for="p in allPartners" :key="p.name" :partner="p" />
        </div>
      </UContainer>
    </section>
  </div>
</template>
