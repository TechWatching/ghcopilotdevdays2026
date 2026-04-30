// https://nuxt.com/docs/api/configuration/nuxt-config
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function speakerSlugFromFilename(filename: string): string {
  const base = filename.replace(/\.ya?ml$/i, '')
  const dot = base.indexOf('.')
  return dot >= 0 ? base.slice(dot + 1) : base
}

function speakerSlugs(): string[] {
  const dir = resolve(__dirname, 'content/speakers')
  const slugs = readdirSync(dir)
    .filter(f => f.endsWith('.yml'))
    .map((f) => {
      const text = readFileSync(resolve(dir, f), 'utf8')
      const m = text.match(/^slug:\s*(.+?)\s*$/m)
      return m?.[1]?.trim() || speakerSlugFromFilename(f)
    })
    .filter((s): s is string => Boolean(s))
  console.log(`[nuxt.config] Discovered ${slugs.length} speaker slugs for prerender`)
  return slugs
}

export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@nuxt/content'],
  css: ['~/assets/css/main.css'],
  ssr: true,
  nitro: {
    preset: 'static',
    prerender: {
      crawlLinks: true,
      routes: speakerSlugs().map(slug => `/speakers/${slug}`)
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
