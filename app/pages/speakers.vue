<script setup lang="ts">
const { data: speakers } = await useAsyncData('speakers-list', () =>
  queryCollection('speakers').all()
)

const sorted = computed(() =>
  [...(speakers.value ?? [])].sort((a, b) => a.lastname.localeCompare(b.lastname, 'fr'))
)

useSeoMeta({ title: 'Speakers — MTG Bordeaux' })
</script>

<template>
  <div>
    <section class="border-b border-default">
      <UContainer class="py-12">
        <h1 class="text-3xl md:text-4xl font-bold">Speakers</h1>
        <p class="mt-2 text-muted">
          Les intervenant·e·s qui ont partagé leur expertise lors des meetups MTG Bordeaux.
        </p>
        <UBadge class="mt-4" color="primary" variant="subtle">{{ sorted.length }} speakers</UBadge>
      </UContainer>
    </section>

    <UContainer class="py-10">
      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <SpeakerCard v-for="s in sorted" :key="`${s.firstname}-${s.lastname}`" :speaker="s" />
      </div>
    </UContainer>
  </div>
</template>
