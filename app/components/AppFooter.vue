<script setup lang="ts">
const communityLinks = [
  { label: 'Call for speakers', to: 'https://sessionize.com/mtg/', icon: 'i-lucide-mic' },
  { label: 'Meetup', to: 'https://www.meetup.com/mtg-bordeaux/', icon: 'i-simple-icons-meetup' },
  { label: 'La Grappe Numérique', to: 'https://www.lagrappenumerique.fr/#/mtg-bordeaux/', icon: 'i-lucide-grape' },
  { label: 'LinkedIn', to: 'https://www.linkedin.com/company/mtg-bordeaux', icon: 'i-simple-icons-linkedin' },
  { label: 'Bluesky', to: 'https://bsky.app/profile/mtgbordeaux.bsky.social', icon: 'i-simple-icons-bluesky' },
  { label: 'Discord MTG:France', to: 'https://discord.gg/tsJJSwKAac', icon: 'i-simple-icons-discord' },
  { label: 'MTG:France', to: 'https://www.mtg-france.org/', icon: 'i-lucide-globe' }
]
</script>

<template>
  <footer class="border-t border-default mt-16">
    <UContainer class="py-10 grid gap-8 md:grid-cols-3">
      <div>
        <h3 class="font-semibold mb-2">Microsoft Tech Group: Bordeaux</h3>
        <p class="text-sm text-muted">
          Communauté technique bordelaise autour des technologies Microsoft. Membre de MTG:France.
        </p>
      </div>
      <div>
        <h3 class="font-semibold mb-2">Liens</h3>
        <ul class="space-y-1 text-sm">
          <li v-for="l in communityLinks" :key="l.label">
            <UButton
              :to="l.to"
              :icon="l.icon"
              target="_blank"
              variant="link"
              color="neutral"
              size="sm"
              class="px-0"
            >
              {{ l.label }}
            </UButton>
          </li>
        </ul>
      </div>
      <div>
        <h3 class="font-semibold mb-2">Contact</h3>
        <UButton
          to="mailto:bordeaux@mtg-france.org"
          icon="i-lucide-mail"
          variant="link"
          color="neutral"
          class="px-0"
        >
          bordeaux@mtg-france.org
        </UButton>
      </div>
    </UContainer>
    <UContainer class="py-4 border-t border-default text-xs text-muted flex justify-between">
      <span>© {{ new Date().getFullYear() }} MTG Bordeaux</span>
      <span>Built with Nuxt &amp; Nuxt UI</span>
    </UContainer>
  </footer>
</template>
