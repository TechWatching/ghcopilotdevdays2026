// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@nuxt/content', '@nuxtjs/i18n'],
  css: ['~/assets/css/main.css'],
  ssr: true,
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
  },
  i18n: {
    defaultLocale: 'fr',
    locales: [
      {
        code: 'fr',
        language: 'fr-FR',
        name: 'Français',
        file: 'fr.json'
      }
    ],
    langDir: 'locales'
  }
})
