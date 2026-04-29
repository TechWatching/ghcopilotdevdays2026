const LOGO_FIXES: Record<string, string> = {
  '/companies/pulumi.png': '/companies/pulumi.svg',
  '/companies/sfeir.png': '/companies/sfeir.svg',
  '/companies/avanade.png': '/companies/Avanade.png'
}

export function normalizeLogo(path?: string): string | undefined {
  if (!path) return path
  return LOGO_FIXES[path] ?? path
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

export function formatDateFr(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return String(date)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}
