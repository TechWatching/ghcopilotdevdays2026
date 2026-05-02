// Logos that are white (or near-white) on transparent and need a dark backdrop to be visible.
const WHITE_LOGOS = new Set<string>([
  '/companies/sfeir.svg',
  '/companies/pulumi.svg',
  '/companies/enseirb-matemca.svg',
  '/companies/github.png',
  '/companies/hello-asso.png'
])

export function isWhiteLogo(path?: string): boolean {
  if (!path) return false
  return WHITE_LOGOS.has(path)
}

export function normalizeLogo(path?: string): string {
  if (!path) return ''
  if (/^(https?:)?\/\//.test(path)) return path
  return path.startsWith('/') ? path : `/${path}`
}

export function socialIcon(type: string): string {
  const t = type.toUpperCase()
  switch (t) {
    case 'LINKEDIN': return 'i-simple-icons-linkedin'
    case 'GITHUB': return 'i-simple-icons-github'
    case 'BLUESKY': return 'i-simple-icons-bluesky'
    case 'TWITTER':
    case 'X': return 'i-simple-icons-x'
    case 'MASTODON': return 'i-simple-icons-mastodon'
    case 'YOUTUBE': return 'i-simple-icons-youtube'
    case 'BLOG': return 'i-lucide-rss'
    case 'WEBSITE': return 'i-lucide-globe'
    default: return 'i-lucide-link'
  }
}

export function talkNumericId(t: any): number {
  const stem = String(t?.stem ?? '').split('/').pop() ?? ''
  return Number.parseInt(stem.split('.')[0] ?? '', 10)
}

// Speakers are stored in `content/speakers/<n>.<slug>.yml`. The leading number
// is the speaker id; the rest is the URL-safe slug. We prefer an explicit
// `slug` field in the YAML when present, otherwise derive it from the stem.
export function speakerSlug(s: any): string {
  if (s?.slug) return String(s.slug)
  const stem = String(s?.stem ?? '').split('/').pop() ?? ''
  const dot = stem.indexOf('.')
  return dot >= 0 ? stem.slice(dot + 1) : stem
}

export function formatDateFr(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return String(date)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}
