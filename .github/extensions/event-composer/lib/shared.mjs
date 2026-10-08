// Pure helpers shared by the extension (Node) and the canvas UI (browser).

export const SOCIAL_TYPES = ["LINKEDIN", "GITHUB", "BLUESKY", "X", "MASTODON", "YOUTUBE", "BLOG", "WEBSITE"];
export const LEGACY_SOCIAL_TYPES = ["TWITTER"];

export const SOCIAL_LABELS = {
    LINKEDIN: "LinkedIn",
    GITHUB: "GitHub",
    BLUESKY: "Bluesky",
    X: "X (Twitter)",
    TWITTER: "Twitter",
    MASTODON: "Mastodon",
    YOUTUBE: "YouTube",
    BLOG: "Blog",
    WEBSITE: "Website",
};

function stripAccents(text) {
    return String(text ?? "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[œŒ]/g, "oe")
        .replace(/[æÆ]/g, "ae")
        .replace(/ß/g, "ss");
}

// URL-safe slug, cut at a word boundary when longer than `max`.
export function slugify(text, max = 80) {
    const base = stripAccents(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (base.length <= max) return base;
    const cut = base.slice(0, max + 1);
    const at = cut.lastIndexOf("-");
    return (at > 0 ? cut.slice(0, at) : base.slice(0, max)).replace(/-+$/, "");
}

// Accent-, case- and punctuation-insensitive comparison key for names.
export function nameKey(text) {
    return stripAccents(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isHttpUrl(value) {
    if (typeof value !== "string" || /\s/.test(value)) return false;
    try {
        const url = new URL(value);
        return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
    } catch {
        return false;
    }
}

export function isValidDay(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
    if (!m) return false;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const BLOG_HOSTS = /(?:^|\.)(?:medium\.com|dev\.to|hashnode\.dev|hashnode\.com|substack\.com|blogspot\.com|wordpress\.com|ghost\.io)$/;
const MASTODON_HOSTS = /(?:^|\.)(?:mastodon\.[a-z.]+|mstdn\.[a-z.]+|fosstodon\.org|hachyderm\.io|piaille\.fr|framapiaf\.org|infosec\.exchange|social\.[a-z0-9.-]+|toot\.[a-z.]+)$/;

// Best guess of the social network behind a profile link; null when the link is not a URL.
export function detectSocialType(link) {
    let url;
    try {
        url = new URL(String(link ?? "").trim());
    } catch {
        return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname;
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "LINKEDIN";
    if (host === "github.com") return "GITHUB";
    if (host === "bsky.app" || host.endsWith(".bsky.social")) return "BLUESKY";
    if (host === "x.com" || host === "twitter.com" || host.endsWith(".twitter.com")) return "X";
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") return "YOUTUBE";
    if (BLOG_HOSTS.test(host) || /(?:^|[.-])blog(?:[.-]|$)/.test(host) || /^\/blog(?:\/|$)/.test(path)) return "BLOG";
    if (MASTODON_HOSTS.test(host) || /^\/@[^/@]+\/?$/.test(path)) return "MASTODON";
    return "WEBSITE";
}

export function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
