// Owns the event draft: normalization, persistence shared by every session of the
// repo, staged uploads, validation against the repo and La Grappe, and creation.

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { unwatchFile, watchFile } from "node:fs";
import { mkdir, readdir, rename, stat, unlink, utimes } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { createCalendar, GRAPPE_REPO, parisDay } from "./calendar.mjs";
import { readJson, writeFileAtomic } from "./fsutil.mjs";
import { applyPlan, computePlan, deepEqual, findRepoRoot, loadCatalog } from "./repo.mjs";
import { formatSize, isValidDay, LEGACY_SOCIAL_TYPES, nameKey, slugify, SOCIAL_TYPES } from "./shared.mjs";

const EXTENSION_NAME = "event-composer";
const STATE_VERSION = 1;
const IMAGE_EXTS = ["png", "jpg", "gif", "webp", "svg"];
const UPLOAD_ID = /^[a-f0-9]{16}$/;
const KEY_RE = /^[a-z0-9]{1,24}$/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const UNSAFE_SVG = /<script|<foreignObject|<!ENTITY|javascript:|\son[a-z]+\s*=/i;
const MINUTE = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE;

export const LIMITS = { talks: 30, speakers: 20, partners: 30, socials: 12, abstract: 10000, text: 500, upload: 5 * 1024 * 1024 };

export class ComposerError extends Error {
    constructor(code, message, status = 400, extra = undefined) {
        super(message);
        this.name = "ComposerError";
        this.code = code;
        this.status = status;
        this.extra = extra;
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const execFileP = promisify(execFile);
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const pick = (...values) => values.find((v) => typeof v === "string" && v.trim() !== "") ?? "";

// ---------------------------------------------------------------------------
// Draft normalization. Values are cleaned but not trimmed, so a field being
// typed in the canvas never fights the server copy.

function line(value, max = LIMITS.text) {
    if (value == null) return "";
    return String(value).replace(CONTROL, "").replace(/[\r\n]+/g, " ").slice(0, max);
}

function text(value, max = LIMITS.abstract) {
    if (value == null) return "";
    return String(value).replace(CONTROL, "").replace(/\r\n?/g, "\n").slice(0, max);
}

function uploadRef(value) {
    if (!isObject(value)) return null;
    const id = String(value.id ?? "");
    const ext = String(value.ext ?? "").toLowerCase();
    if (!UPLOAD_ID.test(id) || !IMAGE_EXTS.includes(ext)) return null;
    const size = Number(value.size);
    return { id, ext, name: line(value.name, 120), size: Number.isFinite(size) && size > 0 ? Math.round(size) : 0 };
}

const listOf = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []).filter(isObject);

export function emptyDraft() {
    return { event: { name: "", date: "", url: "", location: "", replay: "" }, talks: [], partners: [] };
}

function emptyCompany() {
    return { name: "", link: "", logo: "", logoUpload: null };
}

// Returns a draft with the exact shape computePlan expects and unique keys.
export function normalizeDraft(input) {
    const src = isObject(input) ? input : {};
    const seen = new Set();
    const key = (wanted) => {
        let k = typeof wanted === "string" && KEY_RE.test(wanted) ? wanted : "";
        while (!k || seen.has(k)) k = randomBytes(5).toString("hex");
        seen.add(k);
        return k;
    };
    const social = (x) => {
        const type = line(x.type, 20).trim().toUpperCase();
        return { key: key(x.key), type: SOCIAL_TYPES.includes(type) || LEGACY_SOCIAL_TYPES.includes(type) ? type : "", link: line(x.link) };
    };
    const speaker = (s) => {
        const k = key(s.key);
        if (s.mode === "existing") {
            const id = Number(s.id);
            return { key: k, mode: "existing", id: Number.isInteger(id) && id > 0 ? id : 0 };
        }
        const company = isObject(s.company) ? s.company : {};
        return {
            key: k,
            mode: "new",
            firstname: line(s.firstname),
            lastname: line(s.lastname),
            role: line(s.role),
            photo: line(s.photo),
            photoUpload: uploadRef(s.photoUpload),
            company: { name: line(company.name), link: line(company.link), logo: line(company.logo), logoUpload: uploadRef(company.logoUpload) },
            socials: listOf(s.socials, LIMITS.socials).map(social),
        };
    };
    const ev = isObject(src.event) ? src.event : {};
    return {
        event: { name: line(ev.name), date: line(ev.date, 32), url: line(ev.url), location: line(ev.location), replay: line(ev.replay) },
        talks: listOf(src.talks, LIMITS.talks).map((t) => ({
            key: key(t.key),
            title: line(t.title),
            abstract: text(t.abstract),
            replay: line(t.replay),
            speakers: listOf(t.speakers, LIMITS.speakers).map(speaker),
        })),
        partners: listOf(src.partners, LIMITS.partners).map((p) => ({
            key: key(p.key),
            name: line(p.name),
            link: line(p.link),
            logo: line(p.logo),
            logoUpload: uploadRef(p.logoUpload),
        })),
    };
}

function uploadsIn(draft) {
    const refs = [];
    for (const t of draft.talks) {
        for (const s of t.speakers) {
            if (s.mode !== "new") continue;
            if (s.photoUpload) refs.push(s.photoUpload);
            if (s.company.logoUpload) refs.push(s.company.logoUpload);
        }
    }
    for (const p of draft.partners) if (p.logoUpload) refs.push(p.logoUpload);
    return refs;
}

const isEmptyDraft = (draft) => deepEqual(draft, emptyDraft());

// ---------------------------------------------------------------------------
// Uploads

function sniffImage(buf) {
    if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return "png";
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
    const head = buf.subarray(0, 12).toString("latin1");
    if (/^GIF8[79]a/.test(head)) return "gif";
    if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "webp";
    const start = buf.subarray(0, 4096).toString("utf8").replace(/^\uFEFF/, "");
    if (/^\s*(?:<\?xml[^>]*\?>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<svg[\s>]/i.test(start)) return "svg";
    return null;
}

function cleanFileName(name) {
    const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
    return base.replace(CONTROL, "").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
}

// ---------------------------------------------------------------------------
// Views

const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const weekdayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long" });

function describeEvent(e) {
    const where = e.online ? "online" : [e.venue, e.city].filter(Boolean).join(", ");
    return `“${e.title}”${e.time ? ` at ${e.time}` : ""}${where ? ` (${where})` : ""}`;
}

const eventView = ({ title, day, time, url, communities, online, venue, city }) => ({ title, day, time, url, communities, online, venue, city });

function availabilityIssues(info) {
    const issues = [];
    const add = (level, code, message, extra) => issues.push({ level, path: "event.date", code, message, ...extra });
    const refresh = { label: "Try again", action: "refresh-calendar" };
    const n = info.conflicts.length;
    if (n === 1) {
        add("warning", "calendar-conflict", `Another community plans ${describeEvent(info.conflicts[0])} that day.`, { events: info.conflicts.map(eventView) });
    } else if (n > 1) {
        const named = info.conflicts.slice(0, 3).map((e) => `“${e.title}”${e.online ? " (online)" : ""}`).join(", ");
        add("warning", "calendar-conflict", `${n} other community events are planned that day: ${named}${n > 3 ? ` and ${n - 3} more` : ""}.`, {
            events: info.conflicts.map(eventView),
        });
    }
    if (info.listings.length) {
        add("info", "calendar-listing", `MTG Bordeaux is already listed on La Grappe that day: ${describeEvent(info.listings[0])}.`, { events: info.listings.map(eventView) });
    }
    if (info.status === "loading" || info.status === "idle") {
        add("info", "calendar-loading", "Checking La Grappe Numérique for other events that day…");
    } else if (info.status === "error") {
        add("warning", "calendar-unavailable", `Couldn't check La Grappe Numérique for other events that day${info.error ? ` (${info.error})` : ""}.`, { fix: refresh });
    } else if (info.stale) {
        add("info", "calendar-stale", `La Grappe Numérique couldn't be refreshed (${info.error}), so this check uses the copy from ${timeFormat.format(info.fetchedAt)}.`, { fix: refresh });
    }
    return issues;
}

// The browser never needs source paths or full original files.
function clientPlan(plan) {
    return {
        ...plan,
        files: plan.files.map((f) => {
            const base = { path: f.path, status: f.status, kind: f.kind, label: f.label };
            if (f.status === "updated") return { ...base, diff: f.diff };
            if (f.kind === "image") return { ...base, previewUrl: f.previewUrl, size: f.size };
            return { ...base, content: f.content };
        }),
    };
}

function compactPlan(plan) {
    return {
        ok: plan.ok,
        counts: plan.counts,
        event: plan.event,
        issues: plan.issues.map((i) => ({ level: i.level, path: i.path, code: i.code, message: i.message, ...(i.fix ? { fix: i.fix.label } : {}) })),
        files: plan.files.map((f) => `${f.status === "new" ? "create" : "update"} ${f.path}${f.label ? ` (${f.label})` : ""}`),
    };
}

function diffText(rows) {
    return (rows ?? []).map((r) => (r.t === "gap" ? "…" : `${r.t === "add" ? "+" : r.t === "del" ? "-" : " "} ${r.text}`)).join("\n");
}

function describeDraft(draft, catalog) {
    const image = (value, upload) => (upload ? `(uploaded ${upload.name || "image"})` : value);
    return {
        event: draft.event,
        talks: draft.talks.map((t) => ({
            title: t.title,
            abstract: t.abstract,
            replay: t.replay,
            speakers: t.speakers.map((s) =>
                s.mode === "existing"
                    ? { id: s.id, name: catalog?.speakerById.get(s.id)?.name ?? "(missing)", existing: true }
                    : {
                          firstname: s.firstname,
                          lastname: s.lastname,
                          role: s.role,
                          photo: image(s.photo, s.photoUpload),
                          company: s.company.name ? { name: s.company.name, link: s.company.link, logo: image(s.company.logo, s.company.logoUpload) } : null,
                          socials: s.socials.map((x) => ({ type: x.type || "auto", link: x.link })),
                      },
            ),
        })),
        partners: draft.partners.map((p) => ({ name: p.name, link: p.link, logo: image(p.logo, p.logoUpload) })),
    };
}

function catalogView(catalog) {
    return {
        next: catalog.next,
        events: catalog.events.map((e) => ({ id: e.id, name: e.name, date: e.date })),
        speakers: catalog.speakers.map((s) => ({
            id: s.id,
            name: s.name,
            firstname: s.firstname,
            lastname: s.lastname,
            role: s.role,
            company: s.company?.name ?? "",
            photo: s.photo,
            talks: s.talks.length,
        })),
        companies: catalog.companies,
        locations: catalog.locations,
    };
}

function shiftDay(day, delta) {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Agent updates: forgiving input (ids, names, plain strings) merged into the
// current draft so omitted fields keep what the user already typed.

function findSpeaker(catalog, name) {
    const key = nameKey(name);
    if (!key) return null;
    const slug = slugify(name);
    return catalog.speakers.find((s) => nameKey(s.name) === key || nameKey(`${s.lastname} ${s.firstname}`) === key || s.slug === slug) ?? null;
}

function splitName(full) {
    const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
    return { firstname: parts[0] ?? "", lastname: parts.slice(1).join(" ") };
}

const given = (src, field) => src[field] !== undefined;
const textOf = (v) => (v == null ? "" : String(v));

// Keeps a previous upload unless the caller sets an explicit path.
function imageField(src, field, prev, prevUpload) {
    if (given(src, field)) return { value: textOf(src[field]), upload: null };
    return { value: prevUpload ? "" : (prev ?? ""), upload: prevUpload ?? null };
}

function mergeCompany(src, prev, catalog) {
    if (src === undefined) return prev ? structuredClone(prev) : emptyCompany();
    if (src === null || src === "") return emptyCompany();
    const c = typeof src === "string" ? { name: src } : isObject(src) ? src : {};
    const name = textOf(c.name).trim();
    const known = name ? catalog.companies.find((x) => nameKey(x.name) === nameKey(name)) : null;
    const same = prev && name && nameKey(prev.name) === nameKey(name) ? prev : null;
    const logo = given(c, "logo") ? { value: textOf(c.logo), upload: null } : same?.logoUpload ? { value: "", upload: same.logoUpload } : { value: pick(same?.logo, known?.logo), upload: null };
    return { name, link: given(c, "link") ? textOf(c.link) : pick(same?.link, known?.link), logo: logo.value, logoUpload: logo.upload };
}

const socialsFrom = (list) =>
    (Array.isArray(list) ? list : [])
        .map((x) => (typeof x === "string" ? { type: "", link: x } : isObject(x) ? { type: textOf(x.type), link: textOf(x.link ?? x.url) } : null))
        .filter(Boolean);

function speakerId(item) {
    if (typeof item === "number") return item;
    if (typeof item === "string" && /^\s*#?\d+\s*$/.test(item)) return Number(item.replace(/[#\s]/g, ""));
    if (isObject(item) && item.id !== undefined && !["name", "firstname", "lastname"].some((k) => given(item, k))) return Number(item.id);
    return null;
}

function buildSpeakers(list, previousNew, previousHere, catalog, notes, where) {
    if (!Array.isArray(list)) throw new ComposerError("invalid_input", `${where}: speakers must be an array.`);
    const out = [];
    for (const item of list) {
        const id = speakerId(item);
        if (id !== null) {
            if (catalog.speakerById.has(id)) out.push({ key: previousHere.find((s) => s.mode === "existing" && s.id === id)?.key, mode: "existing", id });
            else notes.push(`${where}: skipped speaker #${id}, which doesn't exist.`);
            continue;
        }
        const src = typeof item === "string" ? { name: item } : isObject(item) ? item : null;
        if (!src) continue;
        const names = given(src, "name") && !given(src, "firstname") && !given(src, "lastname")
            ? splitName(src.name)
            : { firstname: textOf(src.firstname).trim(), lastname: textOf(src.lastname).trim() };
        const fullName = `${names.firstname} ${names.lastname}`.trim();
        if (!fullName) {
            notes.push(`${where}: skipped a speaker without a name.`);
            continue;
        }
        const match = findSpeaker(catalog, given(src, "name") ? textOf(src.name) : fullName);
        if (match) {
            const edits = Object.keys(src).some((k) => !["name", "firstname", "lastname", "id"].includes(k));
            out.push({ key: previousHere.find((s) => s.mode === "existing" && s.id === match.id)?.key, mode: "existing", id: match.id });
            notes.push(`${where}: used ${match.name}'s existing profile (#${match.id})${edits ? "; existing profiles aren't edited here" : ""}.`);
            continue;
        }
        const prev = previousNew.find((p) => nameKey(`${p.firstname} ${p.lastname}`) === nameKey(fullName));
        if (!names.lastname) notes.push(`${where}: add ${fullName}'s last name.`);
        const photo = imageField(src, "photo", prev?.photo, prev?.photoUpload);
        out.push({
            key: prev?.key,
            mode: "new",
            firstname: names.firstname,
            lastname: names.lastname,
            role: given(src, "role") ? textOf(src.role) : (prev?.role ?? ""),
            photo: photo.value,
            photoUpload: photo.upload,
            company: mergeCompany(src.company, prev?.company, catalog),
            socials: given(src, "socials") ? socialsFrom(src.socials) : (prev?.socials ?? []),
        });
    }
    return out;
}

function buildTalks(list, previous, catalog, notes) {
    if (!Array.isArray(list)) throw new ComposerError("invalid_input", "talks must be an array.");
    if (list.length > LIMITS.talks) throw new ComposerError("invalid_input", `An event can have at most ${LIMITS.talks} talks.`);
    const previousNew = previous.flatMap((t) => t.speakers.filter((s) => s.mode === "new"));
    const used = new Set();
    return list.map((item, i) => {
        const src = typeof item === "string" ? { title: item } : isObject(item) ? item : {};
        const title = given(src, "title") ? textOf(src.title) : undefined;
        let prev = title !== undefined && nameKey(title) ? previous.find((p) => !used.has(p.key) && nameKey(p.title) === nameKey(title)) : undefined;
        // Without a title, the talk at the same position is the one being edited.
        if (!prev && title === undefined && previous[i] && !used.has(previous[i].key)) prev = previous[i];
        if (prev) used.add(prev.key);
        return {
            key: prev?.key,
            title: title ?? prev?.title ?? "",
            abstract: given(src, "abstract") ? textOf(src.abstract) : (prev?.abstract ?? ""),
            replay: given(src, "replay") ? textOf(src.replay) : (prev?.replay ?? ""),
            speakers: given(src, "speakers") ? buildSpeakers(src.speakers, previousNew, prev?.speakers ?? [], catalog, notes, `Talk ${i + 1}`) : (prev?.speakers ?? []),
        };
    });
}

function buildPartners(list, previous, catalog, notes) {
    if (!Array.isArray(list)) throw new ComposerError("invalid_input", "partners must be an array.");
    return list.map((item) => {
        const src = typeof item === "string" ? { name: item } : isObject(item) ? item : {};
        const name = textOf(src.name).trim();
        const prev = name ? previous.find((p) => nameKey(p.name) === nameKey(name)) : undefined;
        const known = name ? catalog.companies.find((c) => nameKey(c.name) === nameKey(name)) : undefined;
        if (known && !prev && (known.link || known.logo) && (!given(src, "link") || !given(src, "logo"))) {
            notes.push(`Partner ${name}: reused the link and logo from earlier events.`);
        }
        const logo = given(src, "logo") ? { value: textOf(src.logo), upload: null } : prev?.logoUpload ? { value: "", upload: prev.logoUpload } : { value: pick(prev?.logo, known?.logo), upload: null };
        return { key: prev?.key, name, link: given(src, "link") ? textOf(src.link) : pick(prev?.link, known?.link), logo: logo.value, logoUpload: logo.upload };
    });
}

// ---------------------------------------------------------------------------
// Composer

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function createComposer({ extensionDir, log = () => {}, send = async () => {}, artifactsDir, calendarOptions = {} } = {}) {
    const home = process.env.COPILOT_HOME || join(homedir(), ".copilot");
    const artifacts = artifactsDir ?? join(home, "extensions", EXTENSION_NAME, "artifacts");
    const writer = `${process.pid}-${randomBytes(3).toString("hex")}`;
    const listeners = new Set();
    let root = null;
    let repoKey = "";
    let branch = "";
    let stateFile = "";
    let uploadsDir = "";
    let calendar = null;
    let state = { rev: 0, writer: "", draft: emptyDraft(), lastResult: null, updatedAt: null };
    let lastCounts = null;
    let initPromise = null;
    let initialized = false;
    let wantWatch = false;
    let watcherOn = false;
    let chain = Promise.resolve();

    function emit(reason, origin = "external") {
        const event = { type: "changed", reason, rev: state.rev, origin };
        for (const fn of listeners) {
            try {
                fn(event);
            } catch (err) {
                log(`A change listener failed (${err.message}).`, "warning");
            }
        }
    }

    // Serializes mutations and disk syncs within this process.
    function exclusive(fn) {
        const run = chain.then(fn, fn);
        chain = run.catch(() => {});
        return run;
    }

    async function git(args) {
        try {
            const { stdout } = await execFileP("git", args, { cwd: root, timeout: 5000, windowsHide: true });
            return stdout.trim();
        } catch {
            return "";
        }
    }

    function fromDisk(saved) {
        return {
            rev: Number.isInteger(saved.rev) && saved.rev >= 0 ? saved.rev : 0,
            writer: textOf(saved.writer),
            draft: normalizeDraft(saved.draft),
            lastResult: isObject(saved.lastResult) ? saved.lastResult : null,
            updatedAt: typeof saved.updatedAt === "string" ? saved.updatedAt : null,
        };
    }

    async function readState() {
        try {
            const saved = await readJson(stateFile);
            return saved?.version === STATE_VERSION ? fromDisk(saved) : null;
        } catch (err) {
            if (err instanceof SyntaxError) {
                const aside = stateFile.replace(/\.json$/, `.unreadable-${Date.now()}.json`);
                await rename(stateFile, aside).catch(() => {});
                log(`The saved draft was unreadable, so it was moved to ${aside}.`, "warning");
            } else {
                log(`Couldn't read the saved draft (${err.message}).`, "warning");
            }
            return null;
        }
    }

    // Adopts a newer draft written by another session's extension process.
    async function syncFromDisk() {
        const saved = await readState();
        if (!saved || saved.writer === writer || (saved.rev === state.rev && saved.writer === state.writer)) return false;
        state = saved;
        return true;
    }

    const sync = () =>
        exclusive(async () => {
            if (await syncFromDisk()) emit("external");
        });

    async function commit(draft, lastResult = null) {
        const next = { rev: state.rev + 1, writer, draft, lastResult, updatedAt: new Date().toISOString() };
        await writeFileAtomic(stateFile, `${JSON.stringify({ version: STATE_VERSION, ...next }, null, 2)}\n`);
        state = next;
    }

    const onFileChange = (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs) sync().catch(() => {});
    };
    function startWatching() {
        if (watcherOn || !initialized) return;
        watchFile(stateFile, { interval: 1000, persistent: false }, onFileChange);
        watcherOn = true;
    }
    function stopWatching() {
        if (!watcherOn) return;
        unwatchFile(stateFile, onFileChange);
        watcherOn = false;
    }

    async function gcUploads(maxAge) {
        let names = [];
        try {
            names = await readdir(uploadsDir);
        } catch {
            return;
        }
        const keep = new Set(uploadsIn(state.draft).map((r) => `${r.id}.${r.ext}`));
        const now = Date.now();
        for (const name of names) {
            if (keep.has(name)) continue;
            const file = join(uploadsDir, name);
            try {
                if (now - (await stat(file)).mtimeMs > maxAge) await unlink(file);
            } catch {
                // Already gone or briefly locked; the next pass gets it.
            }
        }
    }

    async function init() {
        root = findRepoRoot([extensionDir, process.cwd()]);
        if (!root) {
            throw new ComposerError("repo_not_found", "Couldn't find content/meetups/events.yml. Open the composer from a session in the MTG Bordeaux site repository.", 500);
        }
        const remote = await git(["remote", "get-url", "origin"]);
        const m = /[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remote);
        repoKey = (m ? slugify(`${m[1]}-${m[2]}`, 60) : "") || slugify(basename(root), 60) || "repo";
        branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
        const dir = join(artifacts, repoKey);
        stateFile = join(dir, "draft.json");
        uploadsDir = join(dir, "uploads");
        await mkdir(uploadsDir, { recursive: true });
        state = (await readState()) ?? state;
        calendar = createCalendar({ cacheFile: join(artifacts, "la-grappe-cache.json"), log, onChange: () => emit("calendar"), ...calendarOptions });
        await calendar.readCache();
        initialized = true;
        if (wantWatch) startWatching();
        void gcUploads(DAY_MS);
    }

    function ready() {
        initPromise ??= init().catch((err) => {
            initPromise = null;
            throw err;
        });
        return initPromise;
    }

    function readCatalog() {
        try {
            return { catalog: loadCatalog(root) };
        } catch (err) {
            return { error: `Couldn't read the site content (${err.message}).` };
        }
    }

    async function evaluate(draft) {
        const { catalog, error } = readCatalog();
        const day = draft.event.date.trim();
        let availability = null;
        let extraIssues = [];
        if (isValidDay(day)) {
            void calendar.ensure();
            const info = calendar.dayInfo(day);
            extraIssues = availabilityIssues(info);
            availability = {
                day,
                status: info.status === "idle" ? "loading" : info.status,
                fetchedAt: info.fetchedAt,
                stale: info.stale,
                error: info.error,
                conflicts: info.conflicts.map(eventView),
                listings: info.listings.map(eventView),
                siteEvents: catalog ? catalog.events.filter((e) => e.date === day).map((e) => ({ id: e.id, name: e.name })) : [],
            };
        }
        if (!catalog) {
            const counts = { error: 1, warning: 0, info: 0 };
            lastCounts = counts;
            const issues = [{ level: "error", path: "repo", code: "repo-unreadable", message: error }];
            return { plan: { fatal: true, ok: false, counts, issues, event: null, talks: {}, speakers: {}, files: [], summary: null, calendar: availability }, catalog: null };
        }
        const uploads = {};
        await Promise.all(
            uploadsIn(draft).map(async (ref) => {
                const path = join(uploadsDir, `${ref.id}.${ref.ext}`);
                try {
                    uploads[ref.id] = { path, size: (await stat(path)).size, ext: ref.ext };
                } catch {
                    // computePlan reports it as a missing upload.
                }
            }),
        );
        const plan = computePlan(catalog, draft, { uploads, today: parisDay(), extraIssues });
        plan.calendar = availability;
        lastCounts = plan.counts;
        return { plan, catalog };
    }

    const resultView = () => (state.lastResult ? { ...state.lastResult, sameWorktree: state.lastResult.root === root } : null);

    function candidatesFor(catalog, today) {
        return calendar
            .ourListings({ today, since: shiftDay(today, -365), excludeDays: catalog ? catalog.events.map((e) => e.date) : [] })
            .map((e) => ({ title: e.title, day: e.day, time: e.time, url: e.url, venue: e.venue, city: e.city, upcoming: e.day >= today }));
    }

    const isoTime = (ms) => (ms ? new Date(ms).toISOString() : null);
    const STAGED_NAME = /^[a-f0-9]{16}\.(?:png|jpg|gif|webp|svg)$/;
    const REPO_IMAGE = /\.(?:png|jpe?g|gif|webp|svg|avif|ico)$/i;

    async function getState() {
        await ready();
        await sync();
        void calendar.ensure();
        const { rev, draft } = state;
        const { plan, catalog } = await evaluate(draft);
        const today = parisDay();
        return {
            rev,
            draft,
            lastResult: resultView(),
            plan: clientPlan(plan),
            catalog: catalog ? catalogView(catalog) : null,
            calendar: calendar.snapshot(),
            candidates: candidatesFor(catalog, today),
            today,
            repo: { root, branch, key: repoKey },
            limits: LIMITS,
        };
    }

    async function putDraft(input, baseRev, origin = "ui") {
        await ready();
        if (!isObject(input)) throw new ComposerError("invalid_input", "Send the draft as a JSON object.");
        if (!Number.isInteger(baseRev)) throw new ComposerError("invalid_input", "baseRev must be the revision the edit was based on.");
        const saved = await exclusive(async () => {
            if (await syncFromDisk()) emit("external");
            if (baseRev !== state.rev) {
                throw new ComposerError("stale_draft", "The draft changed somewhere else. The latest version was loaded.", 409, { rev: state.rev });
            }
            const draft = normalizeDraft(input);
            if (!deepEqual(draft, state.draft)) {
                await commit(draft);
                emit("draft", origin);
            }
            return { rev: state.rev, draft: state.draft, adjusted: !deepEqual(draft, input) };
        });
        const { plan } = await evaluate(saved.draft);
        return { rev: saved.rev, plan: clientPlan(plan), ...(saved.adjusted ? { draft: saved.draft } : {}) };
    }

    async function upload(buf, name) {
        await ready();
        if (!buf?.length) throw new ComposerError("empty_upload", "The file is empty.");
        if (buf.length > LIMITS.upload) {
            throw new ComposerError("upload_too_large", `This image is ${formatSize(buf.length)}. Use an image under ${formatSize(LIMITS.upload)}.`, 413);
        }
        const ext = sniffImage(buf);
        if (!ext) throw new ComposerError("unsupported_image", "Use a PNG, JPEG, GIF, WebP or SVG image.", 415);
        if (ext === "svg" && UNSAFE_SVG.test(buf.toString("utf8"))) {
            throw new ComposerError("unsafe_svg", "This SVG contains scripts or embedded content. Export a plain SVG or a PNG instead.", 415);
        }
        const id = createHash("sha256").update(buf).digest("hex").slice(0, 16);
        const file = join(uploadsDir, `${id}.${ext}`);
        try {
            const now = new Date();
            await utimes(file, now, now);
        } catch {
            await writeFileAtomic(file, buf);
        }
        return { id, ext, name: cleanFileName(name), size: buf.length };
    }

    // Absolute path of an image the canvas may preview, or null.
    function resolveImage(kind, name) {
        if (!initialized) return null;
        if (kind === "staged") return STAGED_NAME.test(name) ? join(uploadsDir, name) : null;
        if (kind !== "repo" || !REPO_IMAGE.test(name)) return null;
        const segments = name.split("/").filter(Boolean);
        if (!segments.length || segments.some((s) => s === "." || s === ".." || /[\\:\0]/.test(s))) return null;
        return join(root, "public", ...segments);
    }

    async function create(origin = "agent", { acknowledgeConflicts = false } = {}) {
        await ready();
        // A cold La Grappe check gets a moment, so the same-day warning is reliable.
        if (isValidDay(state.draft.event.date.trim())) await Promise.race([calendar.ensure(), sleep(4000)]);
        return exclusive(async () => {
            if (await syncFromDisk()) emit("external");
            const draft = state.draft;
            if (isEmptyDraft(draft)) throw new ComposerError("empty_draft", "The draft is empty. Fill in the event first.", 422);
            const { plan } = await evaluate(draft);
            if (plan.fatal || !plan.ok) {
                throw new ComposerError("validation_failed", `Fix ${plural(plan.counts.error, "error")} before creating the event.`, 422, { plan: clientPlan(plan) });
            }
            const conflicts = plan.calendar?.conflicts ?? [];
            if (conflicts.length && !acknowledgeConflicts) {
                throw new ComposerError(
                    "date_conflict",
                    `${conflicts.length === 1 ? `“${conflicts[0].title}” is` : `${conflicts.length} other community events are`} planned on ${plan.event.date}. Confirm the date to create the event anyway.`,
                    409,
                    { conflicts },
                );
            }
            let files;
            try {
                files = applyPlan(root, plan);
            } catch (err) {
                throw new ComposerError("write_failed", `Nothing was written: ${err.message}`, 500);
            }
            const lastResult = { at: new Date().toISOString(), eventId: plan.event.id, name: plan.event.name, date: plan.event.date, files, root, branch };
            try {
                await commit(emptyDraft(), lastResult);
            } catch (err) {
                log(`The event was created, but the saved draft couldn't be cleared (${err.message}).`, "warning");
                state = { rev: state.rev + 1, writer, draft: emptyDraft(), lastResult, updatedAt: lastResult.at };
            }
            branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])) || branch;
            emit("created", origin);
            void gcUploads(10 * MINUTE);
            return { rev: state.rev, ...resultView() };
        });
    }

    async function reset(origin = "agent") {
        await ready();
        await exclusive(async () => {
            await syncFromDisk();
            await commit(emptyDraft(), null);
            emit("reset", origin);
        });
        void gcUploads(10 * MINUTE);
        return { rev: state.rev };
    }

    async function seedDate(date) {
        await ready();
        if (!isValidDay(date)) return false;
        return exclusive(async () => {
            if (await syncFromDisk()) emit("external");
            if (state.draft.event.date.trim()) return false;
            const draft = structuredClone(state.draft);
            draft.event.date = date;
            await commit(draft);
            emit("draft", "agent");
            return true;
        });
    }

    async function refreshCalendar() {
        await ready();
        await calendar.ensure({ force: true });
        return calendar.snapshot();
    }

    async function calendarRange(from, to) {
        await ready();
        if (!isValidDay(from) || !isValidDay(to) || from > to || shiftDay(from, 62) < to) {
            throw new ComposerError("invalid_range", "Ask for at most two months, with from and to dates as YYYY-MM-DD.");
        }
        void calendar.ensure();
        const { catalog } = readCatalog();
        return {
            ...calendar.snapshot(),
            from,
            to,
            events: calendar.eventsBetween(from, to).map((e) => ({ ...eventView(e), ours: e.ours })),
            siteEvents: catalog ? catalog.events.filter((e) => e.date >= from && e.date <= to).map((e) => ({ id: e.id, name: e.name, date: e.date })) : [],
        };
    }

    async function askCopilot() {
        await ready();
        const r = state.lastResult;
        if (!r) throw new ComposerError("nothing_created", "Create the event first.", 409);
        if (r.root !== root) throw new ComposerError("other_worktree", `The files were written in ${r.root}. Ask from a session that works in that folder.`, 409);
        const files = r.files.map((f) => `- ${f.status === "new" ? "created" : "updated"} ${f.path}`).join("\n");
        await send(
            [
                `I used the event composer canvas to create MTG Bordeaux event #${r.eventId}, “${r.name}” on ${r.date}. It wrote these files:`,
                files,
                "",
                "Please review them, run `pnpm generate` to check that the site still builds, then commit them on the current branch and open a pull request.",
            ].join("\n"),
        );
        return { sent: true };
    }

    async function checkDate(date) {
        await ready();
        const day = textOf(date).trim();
        if (!isValidDay(day)) throw new ComposerError("invalid_date", "Use a real date in the format YYYY-MM-DD.");
        await Promise.race([calendar.ensure(), sleep(8000)]);
        const info = calendar.dayInfo(day);
        const { catalog } = readCatalog();
        const siteEvents = catalog ? catalog.events.filter((e) => e.date === day).map((e) => ({ id: e.id, name: e.name })) : [];
        const weekday = weekdayFormat.format(new Date(`${day}T00:00:00Z`));
        const checked = info.status === "ready";
        let summary;
        if (!checked) summary = `Couldn't check La Grappe Numérique${info.error ? ` (${info.error})` : " yet"}.`;
        else if (!info.conflicts.length) summary = `La Grappe Numérique lists no other community event on ${weekday} ${day}.`;
        else summary = `La Grappe Numérique lists ${plural(info.conflicts.length, "other community event")} on ${weekday} ${day}: ${info.conflicts.map(describeEvent).join("; ")}.`;
        if (siteEvents.length) summary += ` The site already has ${siteEvents.map((e) => `#${e.id} “${e.name}”`).join(", ")} that day.`;
        return {
            date: day,
            weekday,
            free: checked ? info.conflicts.length === 0 && siteEvents.length === 0 : null,
            summary,
            status: info.status,
            fetchedAt: isoTime(info.fetchedAt),
            stale: info.stale,
            error: info.error,
            conflicts: info.conflicts.map(eventView),
            mtgListings: info.listings.map(eventView),
            siteEvents,
            source: `https://github.com/${GRAPPE_REPO}`,
        };
    }

    async function agentUpdate(input) {
        await ready();
        const src = isObject(input) ? input : {};
        const notes = [];
        const unknown = Object.keys(src).filter((k) => !["reset", "event", "talks", "partners"].includes(k));
        if (unknown.length) notes.push(`Ignored ${unknown.join(", ")}: only reset, event, talks and partners are accepted. Speakers go inside each talk.`);
        if (src.event !== undefined && !isObject(src.event)) throw new ComposerError("invalid_input", "event must be an object.");
        const { catalog, error } = readCatalog();
        if (!catalog) throw new ComposerError("repo_unreadable", error, 500);
        const saved = await exclusive(async () => {
            if (await syncFromDisk()) emit("external");
            const base = src.reset ? emptyDraft() : state.draft;
            const next = structuredClone(base);
            if (src.event) {
                for (const field of Object.keys(src.event)) {
                    if (Object.hasOwn(next.event, field)) next.event[field] = textOf(src.event[field]);
                    else notes.push(`Ignored event.${field}: the event has name, date, url, location and replay.`);
                }
            }
            if (src.talks !== undefined) next.talks = buildTalks(src.talks, base.talks, catalog, notes);
            if (src.partners !== undefined) next.partners = buildPartners(src.partners, base.partners, catalog, notes);
            const draft = normalizeDraft(next);
            if (src.reset || !deepEqual(draft, state.draft)) {
                await commit(draft);
                emit("draft", "agent");
            }
            return { rev: state.rev, draft: state.draft };
        });
        const { plan } = await evaluate(saved.draft);
        return { rev: saved.rev, notes, plan: compactPlan(plan) };
    }

    async function agentView({ includeFiles = false } = {}) {
        await ready();
        await sync();
        void calendar.ensure();
        const { rev, draft } = state;
        const { plan, catalog } = await evaluate(draft);
        const c = plan.calendar ?? calendar.snapshot();
        const view = {
            rev,
            repo: { root, branch },
            draft: describeDraft(draft, catalog),
            plan: compactPlan(plan),
            calendar: { ...c, fetchedAt: isoTime(c.fetchedAt) },
            lastResult: resultView(),
            suggestions: {
                nextIds: catalog?.next ?? null,
                prefill: candidatesFor(catalog, parisDay()).slice(0, 3),
                locations: catalog?.locations ?? [],
            },
        };
        if (includeFiles) {
            view.files = plan.files.map((f) => ({
                path: f.path,
                status: f.status,
                ...(f.kind === "image" ? { size: f.size } : f.status === "updated" ? { diff: diffText(f.diff) } : { content: f.content }),
            }));
        }
        return view;
    }

    function statusText() {
        if (!initialized) return "";
        const ev = state.draft.event;
        if (isEmptyDraft(state.draft)) return state.lastResult ? `Event #${state.lastResult.eventId} created` : "Empty draft";
        const parts = [ev.name.trim() || "Untitled event"];
        if (ev.date.trim()) parts.push(ev.date.trim());
        parts.push(plural(state.draft.talks.length, "talk"));
        if (lastCounts?.error) parts.push(plural(lastCounts.error, "error"));
        return parts.join(" · ");
    }

    return {
        ready,
        getState,
        putDraft,
        upload,
        resolveImage,
        create,
        reset,
        seedDate,
        refreshCalendar,
        calendarRange,
        askCopilot,
        checkDate,
        agentUpdate,
        agentView,
        statusText,
        subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        activate() {
            wantWatch = true;
            startWatching();
        },
        deactivate() {
            wantWatch = false;
            stopWatching();
        },
    };
}
