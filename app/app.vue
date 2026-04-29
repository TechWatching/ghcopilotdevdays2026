<template>
  <UApp>
    <div class="min-h-screen flex flex-col">
      <AppHeader />
      <main class="flex-1">
        <NuxtPage />
      </main>
      <AppFooter />
    </div>
  </UApp>
</template>

<script setup lang="ts">
useSeoMeta({
  title: 'MTG Bordeaux — Microsoft Tech Group',
  description: 'Communauté technique bordelaise autour des technologies Microsoft. Meetups, talks, replays.',
  ogTitle: 'MTG Bordeaux',
  ogDescription: 'Communauté technique bordelaise autour des technologies Microsoft.',
  ogImage: '/social-card.png',
  twitterCard: 'summary_large_image'
})
</script>
