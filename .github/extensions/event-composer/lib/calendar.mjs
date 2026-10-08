// La Grappe Numérique's aggregated community calendar, cached on disk and shared
// by every extension process.

import { readJson, writeFileAtomic } from "./fsutil.mjs";
import { nameKey } from "./shared.mjs";

export const GRAPPE_REPO = "la-grappe-numerique/list-communities";
export const GRAPPE_URL = `https://raw.githubusercontent.com/${GRAPPE_REPO}/main/events.json`;
export const OUR_COMMUNITY = "mtg-bordeaux";
const CACHE_VERSION = 1;
const RETRY_AFTER_FAILURE = 60 * 1000;

const parisFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});

function parisParts(date) {
    const p = Object.fromEntries(parisFormat.formatToParts(date).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function parisDay(date = new Date()) {
    return parisParts(date).day;
}

// Wall-clock values that are naive or carry a Paris offset are kept as written;
// UTC and other offsets are converted to Paris time.
function splitDate(value) {
    const s = String(value ?? "").trim();
    const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
    if (!m) return null;
    const [, day, time = "", zone] = m;
    if (!zone || !time || /^\+0[12]:?00$/.test(zone)) return { day, time };
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? { day, time } : parisParts(d);
}

const clean = (v) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s === "undefined" || s === "null" ? "" : s;
};

function communitiesOf(raw) {
    const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
    const out = [];
    for (const entry of list) {
        for (const part of String(entry ?? "").split(",")) {
            const c = part.trim();
            if (c && !out.includes(c)) out.push(c);
        }
    }
    return out;
}

function normalizeEvent(raw) {
    if (!raw || typeof raw !== "object") return null;
    const when = splitDate(raw.date);
    if (!when) return null;
    const venue = raw.venue && typeof raw.venue === "object" ? raw.venue : {};
    const communities = communitiesOf(raw.communities);
    const url = clean(raw.url);
    return {
        title: clean(raw.title) || "Untitled event",
        day: when.day,
        time: when.time === "00:00" ? "" : when.time,
        url: /^https?:\/\//i.test(url) ? url : "",
        communities,
        online: raw.is_online === true,
        venue: clean(venue.name) || (typeof raw.location === "string" ? clean(raw.location) : ""),
        city: clean(venue.city),
        ours: communities.some((c) => c.toLowerCase() === OUR_COMMUNITY),
    };
}

function urlKey(event) {
    if (!event.url) return "";
    const meetup = /meetup\.com\/[^/]+\/events\/(\d+)/i.exec(event.url);
    if (meetup) return `meetup:${meetup[1]}`;
    try {
        const u = new URL(event.url);
        const path = u.pathname.replace(/\/+$/, "").toLowerCase();
        // A bare home page says nothing about which event it is.
        if (!path) return "";
        return `${event.day}|${u.hostname.replace(/^www\./, "").toLowerCase()}${path}`;
    } catch {
        return "";
    }
}

// Normalizes the raw events.json list: Paris days, split communities, duplicates merged.
export function parseGrappeEvents(list) {
    const out = [];
    const index = new Map();
    for (const raw of Array.isArray(list) ? list : []) {
        const e = normalizeEvent(raw);
        if (!e) continue;
        const title = nameKey(e.title);
        const keys = [urlKey(e), title ? `${e.day}|${title}` : ""].filter(Boolean);
        const found = keys.map((k) => index.get(k)).find(Boolean);
        const target = found ?? e;
        if (found) {
            if (!found.time && e.time) found.time = e.time;
            if (!found.venue && e.venue) found.venue = e.venue;
            if (!found.city && e.city) found.city = e.city;
            if (!found.url && e.url) found.url = e.url;
            for (const c of e.communities) if (!found.communities.includes(c)) found.communities.push(c);
            found.ours ||= e.ours;
        } else {
            out.push(e);
        }
        for (const k of keys) if (!index.has(k)) index.set(k, target);
    }
    return out.sort((a, b) => a.day.localeCompare(b.day) || (a.time || "99").localeCompare(b.time || "99") || a.title.localeCompare(b.title));
}

const NO_CONNECTION = ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH"];

function describe(err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") return "the request timed out";
    const cause = err?.cause;
    const code = cause?.code ?? err?.code;
    if (NO_CONNECTION.includes(code)) return `no connection to GitHub (${code})`;
    const detail = cause?.message && cause.message !== err?.message ? cause.message : code;
    return `${err?.message || String(err)}${detail ? ` (${detail})` : ""}`;
}

// Connection resets and 5xx answers are usually blips worth one more try.
function isTransient(err) {
    if (err?.status >= 500) return true;
    return err instanceof TypeError && !NO_CONNECTION.includes(err.cause?.code ?? err.code);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createCalendar({ cacheFile, log = () => {}, onChange = () => {}, url = GRAPPE_URL, ttl = 10 * 60 * 1000, timeout = 15000, retryDelay = 750, fetchImpl = fetch }) {
    const state = { events: [], fetchedAt: 0, error: "", failedAt: 0, loading: false };
    let byDay = new Map();
    let inflight = null;
    const notify = () => {
        try {
            onChange();
        } catch (err) {
            log(`Calendar listener failed (${err.message}).`, "warning");
        }
    };

    function setEvents(events, fetchedAt) {
        state.events = events;
        state.fetchedAt = fetchedAt;
        byDay = new Map();
        for (const e of events) {
            if (!byDay.has(e.day)) byDay.set(e.day, []);
            byDay.get(e.day).push(e);
        }
    }

    async function readCache() {
        try {
            const cached = await readJson(cacheFile);
            if (cached?.version === CACHE_VERSION && cached.source === url && Array.isArray(cached.events) && cached.fetchedAt > state.fetchedAt) {
                setEvents(cached.events, cached.fetchedAt);
                return true;
            }
        } catch (err) {
            log(`Ignoring unreadable La Grappe cache (${err.message}).`, "warning");
        }
        return false;
    }

    const isFresh = () => Date.now() - state.fetchedAt < ttl;

    async function download() {
        for (let attempt = 1; ; attempt++) {
            try {
                const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeout), headers: { accept: "application/json" } });
                if (!res.ok) throw Object.assign(new Error(`GitHub answered HTTP ${res.status}`), { status: res.status });
                return await res.json();
            } catch (err) {
                if (attempt >= 2 || !isTransient(err)) throw err;
                await sleep(retryDelay);
            }
        }
    }

    async function refresh(force) {
        if (!force && (await readCache()) && isFresh()) {
            state.error = "";
            return;
        }
        state.loading = true;
        notify();
        try {
            const body = await download();
            const list = Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : null;
            if (!list) throw new Error("events.json has an unexpected format");
            const fetchedAt = Date.now();
            setEvents(parseGrappeEvents(list), fetchedAt);
            state.error = "";
            await writeFileAtomic(cacheFile, JSON.stringify({ version: CACHE_VERSION, source: url, fetchedAt, events: state.events })).catch((err) => {
                log(`Couldn't cache the La Grappe calendar (${err.message}).`, "warning");
            });
        } catch (err) {
            state.error = describe(err);
            state.failedAt = Date.now();
            log(`Couldn't refresh the La Grappe calendar: ${state.error}.`, "warning");
        } finally {
            state.loading = false;
        }
    }

    // Loads fresh data when needed; concurrent callers share one request.
    function ensure({ force = false } = {}) {
        if (inflight) return inflight;
        if (!force && isFresh()) return Promise.resolve(snapshot());
        if (!force && state.failedAt && Date.now() - state.failedAt < RETRY_AFTER_FAILURE) return Promise.resolve(snapshot());
        inflight = (async () => {
            try {
                await refresh(force);
            } catch (err) {
                state.error = describe(err);
                state.failedAt = Date.now();
            } finally {
                inflight = null;
            }
            notify();
            return snapshot();
        })();
        return inflight;
    }

    function snapshot() {
        const hasData = state.fetchedAt > 0;
        return {
            status: hasData ? "ready" : state.loading || inflight ? "loading" : state.error ? "error" : "idle",
            loading: state.loading,
            fetchedAt: hasData ? state.fetchedAt : null,
            error: state.error || null,
            stale: hasData && Boolean(state.error),
            count: state.events.length,
            source: GRAPPE_REPO,
        };
    }

    function dayInfo(day) {
        const events = byDay.get(day) ?? [];
        return { ...snapshot(), day, conflicts: events.filter((e) => !e.ours), listings: events.filter((e) => e.ours) };
    }

    function eventsBetween(from, to) {
        return state.events.filter((e) => e.day >= from && e.day <= to);
    }

    // MTG Bordeaux listings that could prefill a new event.
    function ourListings({ today, excludeDays = [], since, limit = 8 }) {
        const skip = new Set(excludeDays);
        const ours = state.events.filter((e) => e.ours && !skip.has(e.day) && e.day >= since);
        const upcoming = ours.filter((e) => e.day >= today);
        const past = ours.filter((e) => e.day < today).reverse();
        return [...upcoming, ...past].slice(0, limit);
    }

    return { ensure, snapshot, dayInfo, eventsBetween, ourListings, readCache };
}
