<script setup lang="ts">
const { t } = useI18n()

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
          <UBadge color="primary" variant="subtle" class="mb-4">{{ t('home.hero.badge') }}</UBadge>
          <h1 class="text-4xl md:text-6xl font-bold tracking-tight">
            MTG <span class="text-primary">Bordeaux</span>
          </h1>
          <p class="mt-4 text-lg md:text-xl text-muted">
            {{ t('home.hero.description') }}
          </p>
          <div class="mt-8 flex flex-wrap gap-3">
            <UButton to="/events" icon="i-lucide-calendar" size="lg" color="primary">
              {{ t('home.hero.seeEvents') }}
            </UButton>
            <UButton to="/speakers" icon="i-lucide-users" size="lg" variant="outline" color="neutral">
              {{ t('home.hero.discoverSpeakers') }}
            </UButton>
            <UButton
              to="https://sessionize.com/mtg/"
              target="_blank"
              icon="i-lucide-mic"
              size="lg"
              variant="ghost"
              color="neutral"
            >
              {{ t('home.hero.proposeATalk') }}
            </UButton>
          </div>
        </div>
      </UContainer>
    </section>

    <!-- About -->
    <section class="py-16">
      <UContainer class="grid gap-10 md:grid-cols-3">
        <div class="md:col-span-2 space-y-4">
          <h2 class="text-2xl md:text-3xl font-bold">{{ t('home.about.title') }}</h2>
          <i18n-t keypath="home.about.description1" tag="p" class="text-muted">
            <template #strong>
              <strong>Microsoft Tech Group: Bordeaux</strong>
            </template>
          </i18n-t>
          <i18n-t keypath="home.about.description2" tag="p" class="text-muted">
            <template #link>
              <a href="https://www.mtg-france.org/" target="_blank" rel="noopener" class="text-primary hover:underline">MTG:France</a>
            </template>
          </i18n-t>
        </div>
        <UCard>
          <template #header>
            <h3 class="font-semibold flex items-center gap-2">
              <UIcon name="i-lucide-link" /> {{ t('home.about.joinAndFollow') }}
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
            <h2 class="text-2xl md:text-3xl font-bold">{{ t('home.latestEvents.title') }}</h2>
            <p class="text-muted">{{ t('home.latestEvents.description') }}</p>
          </div>
          <UButton to="/events" icon="i-lucide-arrow-right" trailing variant="ghost" color="neutral">
            {{ t('home.latestEvents.seeAll') }}
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
        <h2 class="text-2xl md:text-3xl font-bold mb-2">{{ t('home.partners.title') }}</h2>
        <p class="text-muted mb-8">{{ t('home.partners.description') }}</p>
        <div class="flex flex-wrap gap-4">
          <PartnerLogo v-for="p in allPartners" :key="p.name" :partner="p" />
        </div>
      </UContainer>
    </section>
  </div>
</template>
