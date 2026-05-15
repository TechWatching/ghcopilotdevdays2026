<script setup lang="ts">
const { t } = useI18n()

const links = computed(() => [
  [
    { label: t('nav.home'), to: '/', icon: 'i-lucide-home' },
    { label: t('nav.speakers'), to: '/speakers', icon: 'i-lucide-users' },
    { label: t('nav.events'), to: '/events', icon: 'i-lucide-calendar' }
  ]
])
</script>

<template>
  <header class="sticky top-0 z-40 backdrop-blur bg-default/80 border-b border-default">
    <UContainer class="flex items-center justify-between h-16 gap-4">
      <NuxtLink to="/" class="flex items-center gap-2 font-semibold">
        <UIcon name="i-simple-icons-microsoft" class="text-xl text-primary" />
        <span>MTG Bordeaux</span>
      </NuxtLink>
      <UNavigationMenu :items="links" class="hidden md:flex" />
      <div class="flex items-center gap-2">
        <UColorModeButton />
        <UButton
          to="https://sessionize.com/mtg/"
          target="_blank"
          icon="i-lucide-mic"
          color="primary"
          variant="solid"
          class="hidden sm:inline-flex"
        >
          {{ t('nav.callForSpeakers') }}
        </UButton>
      </div>
    </UContainer>
    <UNavigationMenu :items="links" class="md:hidden border-t border-default" />
  </header>
</template>
