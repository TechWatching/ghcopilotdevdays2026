<script setup lang="ts">
const error = useError()
useSeoMeta({ title: 'Erreur — MTG Bordeaux' })
</script>

<template>
  <UApp>
    <div class="min-h-screen flex items-center justify-center p-8">
      <UCard class="max-w-md text-center">
        <h1 class="text-2xl font-bold mb-2">{{ error?.statusCode || 500 }}</h1>
        <p class="text-muted mb-4">{{ error?.statusMessage || 'Une erreur est survenue.' }}</p>
        <UButton to="/" icon="i-lucide-home">Retour à l'accueil</UButton>
      </UCard>
    </div>
  </UApp>
</template>
