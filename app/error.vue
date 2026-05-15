<script setup lang="ts">
const { t } = useI18n()
const error = useError()
useSeoMeta({ title: t('seo.error') })
</script>

<template>
  <UApp>
    <div class="min-h-screen flex items-center justify-center p-8">
      <UCard class="max-w-md text-center">
        <h1 class="text-2xl font-bold mb-2">{{ error?.statusCode || 500 }}</h1>
        <p class="text-muted mb-4">{{ error?.statusMessage || t('error.defaultMessage') }}</p>
        <UButton to="/" icon="i-lucide-home">{{ t('error.backHome') }}</UButton>
      </UCard>
    </div>
  </UApp>
</template>
