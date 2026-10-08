// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@nuxt/content'],
  css: ['~/assets/css/main.css'],
  ssr: false,
  nitro: {
    preset: 'static',
    // Windows workaround for Nuxt 4.6.0: the default `nuxt/dist` inline rule misses backslash paths, which
    // breaks prerendering. Remove once a release containing the fix ships (nuxt/nuxt#36467).
    externals: {
      inline: [/[\\/]node_modules[\\/]nuxt[\\/]dist[\\/]/]
    }
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
