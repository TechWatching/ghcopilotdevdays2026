<script setup lang="ts">
const { t } = useI18n()

const { data: meetupsDoc } = await useAsyncData('events-list', () =>
  queryCollection('meetups').first()
)

const events = computed(() => {
  const list = meetupsDoc.value?.events ?? []
  return [...list].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
})

useSeoMeta({ title: t('seo.events') })
</script>

<template>
  <div>
    <section class="border-b border-default">
      <UContainer class="py-12">
        <h1 class="text-3xl md:text-4xl font-bold">{{ t('events.title') }}</h1>
        <p class="mt-2 text-muted">
          {{ t('events.description') }}
        </p>
        <UBadge class="mt-4" color="primary" variant="subtle">{{ events.length }} {{ t('events.badge') }}</UBadge>
      </UContainer>
    </section>

    <UContainer class="py-10">
      <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <EventCard v-for="ev in events" :key="ev.id" :event="ev" />
      </div>
    </UContainer>
  </div>
</template>
