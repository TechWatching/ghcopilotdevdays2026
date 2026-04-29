<script setup lang="ts">
defineProps<{
  talk: {
    id: number
    title: string
    abstract?: string
    replay?: string
  }
  speakers?: { firstname: string, lastname: string, photo?: string }[]
}>()
</script>

<template>
  <UCard class="h-full">
    <template #header>
      <h3 class="font-semibold text-base">{{ talk.title }}</h3>
      <div v-if="speakers?.length" class="flex flex-wrap items-center gap-2 mt-2">
        <div v-for="s in speakers" :key="`${s.firstname}-${s.lastname}`" class="flex items-center gap-1.5 text-sm">
          <UAvatar :src="s.photo" :alt="`${s.firstname} ${s.lastname}`" size="xs" />
          <span>{{ s.firstname }} {{ s.lastname }}</span>
        </div>
      </div>
    </template>

    <p v-if="talk.abstract" class="text-sm whitespace-pre-line">{{ talk.abstract }}</p>

    <template v-if="talk.replay" #footer>
      <UButton :to="talk.replay" target="_blank" icon="i-lucide-play" variant="outline" color="neutral" size="sm">
        Replay
      </UButton>
    </template>
  </UCard>
</template>
