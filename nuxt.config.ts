// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@nuxt/content'],
  css: ['~/assets/css/main.css'],
  ssr: false,
  experimental: {
    // Avoid Nuxt 4.4.5's missing server-entry error in SPA development mode.
    viteEnvironmentApi: true
  },
  nitro: {
    preset: 'static'
  },
  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
      link: [{ rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }]
    }
  },
  ui: {
    colorMode: true
  }
})
