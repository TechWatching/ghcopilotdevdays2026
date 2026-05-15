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
const { t } = useI18n()

useSeoMeta({
  title: t('seo.title'),
  description: t('seo.description'),
  ogTitle: t('seo.ogTitle'),
  ogDescription: t('seo.ogDescription'),
  ogImage: '/social-card.png',
  twitterCard: 'summary_large_image'
})
</script>
