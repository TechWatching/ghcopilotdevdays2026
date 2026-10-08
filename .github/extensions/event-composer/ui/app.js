// MTG event composer: the canvas UI. Plain browser modules, no build step.
// The server owns the draft and computes the plan; this page edits the draft,
// renders the plan, and checks the chosen day against La Grappe Numérique.

import { SOCIAL_TYPES, SOCIAL_LABELS, nameKey, isHttpUrl, isValidDay, detectSocialType, formatSize } from "/shared.mjs";

const TOKEN = new URLSearchParams(location.search).get("t") ?? "";
const hex = (n) =>
    Array.from(crypto.getRandomValues(new Uint8Array(Math.ceil(n / 2))), (b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, n);
const CLIENT = hex(16);
const newKey = () => hex(10);

// Issues about the chosen day live in the availability panel, not under the date field.
const PANEL_CODES = new Set(["calendar-conflict", "calendar-listing", "calendar-loading", "calendar-unavailable", "calendar-stale", "site-clash"]);
const WEEKDAYS = [
    ["Mo", "Monday"],
    ["Tu", "Tuesday"],
    ["We", "Wednesday"],
    ["Th", "Thursday"],
    ["Fr", "Friday"],
    ["Sa", "Saturday"],
    ["Su", "Sunday"],
];
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
const IMAGE_ACCEPT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ...IMAGE_TYPES].join(",");
const SAVE_DELAY = 400;
const LEVEL_WORD = { error: "Error", warning: "Warning", info: "Note" };
const LEVEL_ORDER = { error: 0, warning: 1, info: 2 };
const FIELD_LABELS = {
    name: "Name",
    date: "Date",
    location: "Venue",
    url: "Registration link",
    replay: "Replay",
    talks: "Talks",
    title: "Title",
    abstract: "Abstract",
    speakers: "Speakers",
    firstname: "First name",
    lastname: "Last name",
    role: "Role",
    photo: "Photo",
    link: "Link",
    logo: "Logo",
};
const COMPANY_LABELS = { name: "Company", link: "Company link", logo: "Company logo" };
const GRAPPE_URL = "https://github.com/la-grappe-numerique/list-communities";

const app = document.getElementById("app");

const S = {
    booted: false,
    expired: false,
    rev: 0,
    draft: null,
    plan: null,
    catalog: null,
    calendar: null,
    candidates: [],
    today: "",
    repo: null,
    limits: {},
    lastResult: null,
    touched: new Set(),
    attempted: false,
    localErrors: new Map(),
    uploading: new Map(),
    month: "",
    months: new Map(),
    focusDay: "",
    peekDay: "",
    verdictKey: null,
    openFiles: new Set(),
    combos: new Map(),
    confirm: null,
    creating: false,
    asked: "",
    dismissed: "",
    calendarRefreshing: false,
    save: { state: "saved", message: "" },
    notice: null,
};

// --- DOM helpers ---------------------------------------------------------------

const PROPS = new Set(["checked", "disabled", "hidden", "htmlFor", "tabIndex", "selected", "className", "open"]);

function h(tag, props, ...children) {
    const el = document.createElement(tag);
    let value;
    for (const [k, v] of Object.entries(props ?? {})) {
        if (v == null || v === false) continue;
        if (k === "value") value = v;
        else if (k === "class") el.className = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (PROPS.has(k)) el[k] = v;
        else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children.flat(Infinity)) {
        if (c == null || c === false || c === "") continue;
        el.append(c instanceof Node ? c : String(c));
    }
    if (value !== undefined) el.value = value;
    return el;
}

const ICONS = {
    x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
    plus: '<path d="M8 3.25v9.5M3.25 8h9.5"/>',
    up: '<path d="M8 12.75v-9.5M4.25 7L8 3.25 11.75 7"/>',
    down: '<path d="M8 3.25v9.5M4.25 9L8 12.75 11.75 9"/>',
    left: '<path d="M9.75 3.5L5.25 8l4.5 4.5"/>',
    right: '<path d="M6.25 3.5l4.5 4.5-4.5 4.5"/>',
    check: '<path d="M3.25 8.5l3 3 6.5-7"/>',
    error: '<circle cx="8" cy="8" r="6.25"/><path d="M8 4.75v3.75"/><circle class="fill" cx="8" cy="11.1" r=".9"/>',
    warning:
        '<path d="M7.13 2.75a1 1 0 0 1 1.74 0l5.37 9.5a1 1 0 0 1-.87 1.5H2.63a1 1 0 0 1-.87-1.5z"/><path d="M8 6.25v3"/><circle class="fill" cx="8" cy="11.35" r=".85"/>',
    info: '<circle cx="8" cy="8" r="6.25"/><path d="M8 7.25v3.75"/><circle class="fill" cx="8" cy="4.9" r=".9"/>',
    refresh: '<path d="M13 8a5 5 0 1 1-1.46-3.54"/><path d="M13 2.75V5.5h-2.75"/>',
    upload: '<path d="M8 10.25v-7.5M4.75 6L8 2.75 11.25 6"/><path d="M2.75 10.5v1.75a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V10.5"/>',
    image: '<rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.5"/><circle cx="5.75" cy="6.25" r="1.1"/><path d="M2.75 11.75l3.5-3.25 2.5 2.25 1.75-1.5 2.75 2.5"/>',
    free: '<circle cx="8" cy="8" r="6.25"/><path d="M5.25 8.25l1.9 1.9 3.6-3.9"/>',
};

function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.innerHTML = ICONS[name] ?? "";
    return svg;
}

const byFocus = (id) => app.querySelector(`[data-focus="${CSS.escape(id)}"]`);

function focusId(id, scroll = true) {
    const el = byFocus(id);
    if (!el) return false;
    el.focus({ preventScroll: true });
    if (scroll) el.scrollIntoView({ block: "nearest" });
    return true;
}

// --- Server --------------------------------------------------------------------

async function api(method, path, body, { raw = false, keepalive = false } = {}) {
    const headers = { "x-composer-token": TOKEN, "x-composer-client": CLIENT };
    let payload;
    if (raw) {
        headers["content-type"] = "application/octet-stream";
        payload = body;
    } else if (body !== undefined) {
        headers["content-type"] = "application/json";
        payload = JSON.stringify(body);
    }
    let res;
    try {
        res = await fetch(path, { method, headers, body: payload, keepalive, cache: "no-store" });
    } catch {
        throw Object.assign(new Error("The canvas server isn't responding."), { code: "network" });
    }
    let data = null;
    try {
        data = await res.json();
    } catch {
        // Some errors have no body.
    }
    if (!res.ok) {
        const { code, message, ...extra } = data?.error ?? {};
        throw Object.assign(new Error(message || `The canvas server answered ${res.status}.`), { code: code || "http", status: res.status, extra });
    }
    return data;
}

const withToken = (url) => `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(TOKEN)}`;
const stagedUrl = (ref) => withToken(`/staged/${ref.id}.${ref.ext}`);
const REPO_IMAGE = /\.(?:png|jpe?g|gif|webp|svg|avif|ico)$/i;

// Preview URL for an image value: https links as is, site paths through the canvas server.
function repoUrl(value) {
    const v = String(value ?? "").trim();
    if (/^https:\/\//i.test(v)) return isHttpUrl(v) ? v : "";
    if (!v.startsWith("/") || !REPO_IMAGE.test(v)) return "";
    const segments = v.split("/").filter(Boolean);
    if (segments.some((s) => s === "." || s === "..")) return "";
    return withToken(`/repo/${segments.map(encodeURIComponent).join("/")}`);
}

// --- Draft paths ---------------------------------------------------------------
// Index paths ("talks.0.title") address the draft; key paths ("talks.k3f.title")
// stay attached to the same item when items move, so focus and messages use them.

function getAt(obj, path) {
    let cur = obj;
    for (const p of path.split(".")) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

function setAt(obj, path, value) {
    const parts = path.split(".");
    const last = parts.pop();
    const parent = getAt(obj, parts.join("."));
    if (parent != null) parent[last] = value;
}

function keyPathIn(draft, path) {
    let cur = draft;
    return path
        .split(".")
        .map((p) => {
            const next = cur?.[p];
            const out = Array.isArray(cur) && next && typeof next.key === "string" ? next.key : p;
            cur = next;
            return out;
        })
        .join(".");
}
const keyPath = (path) => keyPathIn(S.draft, path);

function indexPathOf(kp) {
    const out = [];
    let node = S.draft;
    for (const seg of kp.split(".")) {
        if (Array.isArray(node)) {
            const i = node.findIndex((x) => x?.key === seg);
            if (i < 0) return null;
            out.push(String(i));
            node = node[i];
        } else {
            if (node == null || typeof node !== "object" || !(seg in node)) return null;
            out.push(seg);
            node = node[seg];
        }
    }
    return out.join(".");
}

// Index path of an object inside the draft, or null once it has been removed.
function pathOf(target) {
    const walk = (node, path) => {
        if (node === target) return path;
        if (!node || typeof node !== "object") return null;
        for (const [k, v] of Object.entries(node)) {
            const found = walk(v, path ? `${path}.${k}` : k);
            if (found != null) return found;
        }
        return null;
    };
    return walk(S.draft, "");
}

// Plans arrive with index paths; key paths keep messages on the right item after moves.
function adoptPlan(plan, basis = S.draft) {
    for (const issue of plan?.issues ?? []) issue.kp = issue.path ? keyPathIn(basis, issue.path) : "";
    S.plan = plan ?? null;
}

let undoGeneration = 0;
const cloneDraft = (draft = S.draft) => JSON.parse(JSON.stringify(draft));
const isBlankDraft = (d) =>
    !d || (Object.values(d.event ?? {}).every((v) => v === "") && !(d.talks?.length ?? 0) && !(d.partners?.length ?? 0));

// --- Dates and words -------------------------------------------------------------

const dayDate = (day) => new Date(`${day}T00:00:00Z`);
const toDay = (d) => d.toISOString().slice(0, 10);
const FMT_LONG = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const FMT_SHORT = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const FMT_SHORT_YEAR = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const FMT_MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const fmtLong = (day) => (isValidDay(day) ? FMT_LONG.format(dayDate(day)) : day);
const fmtShort = (day) =>
    isValidDay(day) ? (day.slice(0, 4) === (S.today || "").slice(0, 4) ? FMT_SHORT : FMT_SHORT_YEAR).format(dayDate(day)) : day;
const fmtMonth = (month) => FMT_MONTH.format(dayDate(`${month}-01`));

function addDays(day, n) {
    const d = dayDate(day);
    d.setUTCDate(d.getUTCDate() + n);
    return toDay(d);
}
const monthOf = (day) => day.slice(0, 7);
function addMonths(month, n) {
    const [y, m] = month.split("-").map(Number);
    return toDay(new Date(Date.UTC(y, m - 1 + n, 1))).slice(0, 7);
}
// Same day of the month n months away, clamped to the month's length.
function shiftMonth(day, n) {
    const month = addMonths(monthOf(day), n);
    const [y, m] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${month}-${String(Math.min(Number(day.slice(8, 10)), last)).padStart(2, "0")}`;
}
// The Monday on or before the first of the month: six weeks of 42 days from there.
function gridStart(month) {
    const first = `${month}-01`;
    return addDays(first, -((dayDate(first).getUTCDay() + 6) % 7));
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Accepts an ISO string or epoch milliseconds (the calendar snapshot uses those).
function ago(iso) {
    const t = typeof iso === "number" ? iso : Date.parse(iso ?? "");
    if (!Number.isFinite(t)) return "";
    const minutes = Math.round(Math.max(0, Date.now() - t) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${plural(hours, "hour")} ago`;
    return `${plural(Math.round(hours / 24), "day")} ago`;
}

function fullName(s) {
    return `${s?.firstname ?? ""} ${s?.lastname ?? ""}`.trim();
}

// --- Announcements and toasts -----------------------------------------------------

function announce(text, assertive = false) {
    const el = document.getElementById(assertive ? "alert" : "live");
    if (!el) return;
    el.textContent = "";
    setTimeout(() => {
        el.textContent = text;
    }, 60);
}

const toastEl = document.getElementById("toast");
const toastState = { timer: 0, remaining: 0, started: 0, held: false };

function toast(text, { action, onAction } = {}) {
    clearTimeout(toastState.timer);
    const button = action
        ? h(
              "button",
              {
                  type: "button",
                  onclick: () => {
                      hideToast();
                      onAction?.();
                  },
              },
              action,
          )
        : null;
    toastEl.replaceChildren(h("p", null, text), button);
    toastEl.hidden = false;
    toastState.held = false;
    toastState.remaining = action ? 8000 : 6000;
    runToast();
    announce(action ? `${text} ${action} is available at the end of the page.` : text);
}

function runToast() {
    toastState.started = Date.now();
    clearTimeout(toastState.timer);
    toastState.timer = setTimeout(hideToast, toastState.remaining);
}

function holdToast() {
    if (toastEl.hidden || toastState.held) return;
    toastState.held = true;
    clearTimeout(toastState.timer);
    toastState.remaining = Math.max(2000, toastState.remaining - (Date.now() - toastState.started));
}

function releaseToast() {
    if (!toastState.held || toastEl.matches(":hover") || toastEl.contains(document.activeElement)) return;
    toastState.held = false;
    runToast();
}

function hideToast() {
    clearTimeout(toastState.timer);
    toastState.held = false;
    toastEl.hidden = true;
    toastEl.replaceChildren();
}

toastEl.addEventListener("pointerenter", holdToast);
toastEl.addEventListener("focusin", holdToast);
toastEl.addEventListener("pointerleave", () => setTimeout(releaseToast, 0));
toastEl.addEventListener("focusout", () => setTimeout(releaseToast, 0));

// Offers Undo for a change; `restore` returns false when the change can no longer be undone.
function withUndo(text, restore, focusAfter) {
    const generation = undoGeneration;
    toast(text, {
        action: "Undo",
        onAction: () => {
            if (S.creating || S.expired || undoGeneration !== generation || restore() === false) {
                toast("The draft has changed since, so this can't be undone.");
                return;
            }
            edited(true);
            render();
            const target = typeof focusAfter === "function" ? focusAfter() : focusAfter;
            if (target) focusId(target);
            announce("Undone.");
        },
    });
}

// --- Saving ----------------------------------------------------------------------
// Each edit bumps editSeq; a single save loop sends the latest draft until the
// server has seen every edit. The server answers with the plan for that draft.

let editSeq = 0;
let savedSeq = 0;
let saveTimer = 0;
let retryTimer = 0;
let saving = null;
let offlineAnnounced = false;

const hasPendingEdits = () => savedSeq < editSeq;

function edited(immediate = false) {
    editSeq++;
    if (S.save.state === "saved") S.save = { state: "saving", message: "" };
    paintSave();
    if (S.confirm) {
        S.confirm = null;
        renderDerived();
    }
    clearTimeout(saveTimer);
    if (immediate) void flushSave();
    else saveTimer = setTimeout(() => void flushSave(), SAVE_DELAY);
}

function flushSave() {
    clearTimeout(saveTimer);
    clearTimeout(retryTimer);
    if (saving) return saving;
    if (!hasPendingEdits() || S.expired) return Promise.resolve(!S.expired);
    saving = (async () => {
        try {
            while (hasPendingEdits()) {
                const seq = editSeq;
                const sent = cloneDraft();
                const r = await api("PUT", "/api/draft", { draft: sent, baseRev: S.rev });
                savedSeq = Math.max(savedSeq, seq);
                if (r.rev < S.rev) continue;
                S.rev = r.rev;
                if (r.draft && seq === editSeq) {
                    // The server adjusted what was sent (length caps, invalid choices): show its copy.
                    S.draft = r.draft;
                    adoptPlan(r.plan, r.draft);
                    render();
                } else {
                    adoptPlan(r.plan, r.draft ?? sent);
                }
            }
            S.save = { state: "saved", message: "" };
            offlineAnnounced = false;
            if (S.notice?.kind === "save") S.notice = null;
            renderDerived();
            return true;
        } catch (err) {
            handleSaveError(err);
            return false;
        } finally {
            saving = null;
        }
    })();
    return saving;
}

function handleSaveError(err) {
    if (err.code === "forbidden") return expired();
    if (err.code === "network") {
        S.save = { state: "offline", message: "" };
        paintSave();
        if (!offlineAnnounced) {
            offlineAnnounced = true;
            announce("Can't reach the canvas server. Your changes will be saved when it's back.");
        }
        retryTimer = setTimeout(() => void flushSave(), 3000);
        return;
    }
    if (err.code === "stale_draft") {
        savedSeq = editSeq;
        S.save = { state: "saved", message: "" };
        void reload().then((ok) => ok && toast("The draft changed somewhere else, so the latest version was loaded."));
        return;
    }
    S.save = { state: "error", message: err.message };
    S.notice = { kind: "save", message: `Your latest changes aren't saved. ${err.message}`, action: "Try again", run: () => void flushSave() };
    renderDerived();
}

function paintSave() {
    const el = document.getElementById("save");
    if (!el) return;
    const { state } = S.save;
    const quiet = state === "saved" && isBlankDraft(S.draft);
    const sig = quiet ? "quiet" : state;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.dataset.state = state;
    const label = { saving: "Saving…", saved: "Saved", offline: "Offline · will retry", error: "Not saved" }[state];
    el.replaceChildren(...(quiet ? [] : [state === "saved" ? icon("check") : null, label].filter(Boolean)));
}

// --- Server state -------------------------------------------------------------------

function adoptState(st) {
    undoGeneration++;
    S.combos.clear();
    S.rev = st.rev;
    S.draft = st.draft;
    S.catalog = st.catalog ?? null;
    S.calendar = st.calendar ?? null;
    S.candidates = st.candidates ?? [];
    S.today = st.today || S.today;
    S.repo = st.repo ?? S.repo;
    S.limits = st.limits ?? S.limits;
    S.lastResult = st.lastResult ?? null;
    adoptPlan(st.plan, st.draft);
    if (isBlankDraft(st.draft)) {
        S.touched.clear();
        S.localErrors.clear();
        S.attempted = false;
    }
}

function syncMonth() {
    const day = S.draft?.event?.date ?? "";
    if (isValidDay(day) && monthOf(day) !== S.month) {
        S.month = monthOf(day);
        void loadMonth(S.month);
    }
}

// Replaces the local draft with the server's, dropping edits that weren't saved.
async function reload() {
    try {
        const st = await api("GET", "/api/state");
        clearTimeout(saveTimer);
        savedSeq = editSeq;
        S.confirm = null;
        adoptState(st);
        syncMonth();
        render();
        return true;
    } catch (err) {
        if (err.code === "forbidden") expired();
        else toast(`Couldn't load the latest draft. ${err.message}`);
        return false;
    }
}

const catalogSig = (c) => (c ? JSON.stringify([c.next, c.speakers?.length, c.companies?.length, c.events?.length, c.locations?.length]) : "");
let lastRefresh = 0;
let refreshing = null;

// Picks up changes the event stream may have missed: La Grappe data, site content, the draft.
function refreshState(force = false) {
    const busy = () => !S.booted || S.expired || saving || hasPendingEdits() || S.creating;
    if (busy() || refreshing || (!force && Date.now() - lastRefresh < 5000)) return refreshing ?? Promise.resolve();
    lastRefresh = Date.now();
    refreshing = (async () => {
        try {
            const st = await api("GET", "/api/state");
            if (busy()) return;
            const full = st.rev !== S.rev || catalogSig(st.catalog) !== catalogSig(S.catalog) || Boolean(st.lastResult) !== Boolean(S.lastResult);
            if (full) {
                S.confirm = null;
                adoptState(st);
                syncMonth();
                render();
            } else {
                Object.assign(S, { calendar: st.calendar, candidates: st.candidates ?? [], today: st.today || S.today, lastResult: st.lastResult ?? null });
                adoptPlan(st.plan, S.draft);
                renderDerived();
            }
        } catch (err) {
            if (err.code === "forbidden") expired();
        } finally {
            refreshing = null;
        }
    })();
    return refreshing;
}

// --- Event stream -------------------------------------------------------------------

const CHANGE_TEXT = {
    draft: ["Copilot updated the draft.", "The draft was edited in another window.", "The draft changed from another Copilot session."],
    created: ["Copilot created the event.", "The event was created from another window.", "The event was created from another Copilot session."],
    reset: ["Copilot cleared the draft.", "The draft was cleared in another window.", "The draft was cleared from another Copilot session."],
};
let source = null;
let sourceBroken = false;
let calendarTimer = 0;
let changeChain = Promise.resolve();

function openEvents() {
    if (S.expired) return;
    source?.close();
    const es = new EventSource(withToken("/events"));
    source = es;
    es.addEventListener("changed", (e) => {
        let data;
        try {
            data = JSON.parse(e.data);
        } catch {
            return;
        }
        changeChain = changeChain.then(() => onChanged(data)).catch(() => {});
    });
    es.addEventListener("open", () => {
        if (!sourceBroken) return;
        sourceBroken = false;
        void refreshState(true);
    });
    es.addEventListener("error", () => {
        sourceBroken = true;
        if (source !== es || es.readyState !== EventSource.CLOSED) return;
        void refreshState(true);
        setTimeout(() => source === es && openEvents(), 5000);
    });
}

async function onChanged(data) {
    if (data.reason === "calendar") {
        clearTimeout(calendarTimer);
        calendarTimer = setTimeout(() => {
            S.months.clear();
            monthsVersion++;
            void loadMonth(S.month);
            void refreshState(true);
        }, 300);
        return;
    }
    if (data.origin === `ui:${CLIENT}`) return;
    if (saving) await saving;
    if (!(data.rev > S.rev)) return;
    if (!(await reload())) return;
    const who = data.origin === "agent" ? 0 : String(data.origin ?? "").startsWith("ui") ? 1 : 2;
    toast((CHANGE_TEXT[data.reason] ?? CHANGE_TEXT.draft)[who]);
}

// --- Rendering ------------------------------------------------------------------
// render() rebuilds the form from S. renderDerived() repaints only what follows from
// the plan (messages, availability, review, action bar), so typing never loses focus.

let registry = new Map();
let regionSigs = new Map();
let pointerDown = false;
let pointerTimer = 0;
let deferred = "";

// A rebuild between pointerdown and click would swallow the click, so it waits.
document.addEventListener(
    "pointerdown",
    () => {
        pointerDown = true;
        clearTimeout(pointerTimer);
        pointerTimer = setTimeout(releasePointer, 3000);
    },
    true,
);
document.addEventListener("pointerup", releasePointer, true);
document.addEventListener("pointercancel", releasePointer, true);

function releasePointer() {
    clearTimeout(pointerTimer);
    if (!pointerDown) return;
    pointerDown = false;
    const kind = deferred;
    deferred = "";
    if (kind) setTimeout(() => (kind === "full" ? render() : renderDerived()), 0);
}

function captureFocus() {
    const el = document.activeElement;
    const host = el?.closest?.("[data-focus]");
    if (!host || !app.contains(host)) return null;
    const saved = { id: host.dataset.focus, start: null, end: null, dir: "none" };
    try {
        if (typeof el.selectionStart === "number") {
            saved.start = el.selectionStart;
            saved.end = el.selectionEnd;
            saved.dir = el.selectionDirection ?? "none";
        }
    } catch {
        // Inputs such as type=date have no selection.
    }
    return saved;
}

function restoreFocus(saved) {
    if (!saved) return;
    const el = byFocus(saved.id);
    if (!el || el === document.activeElement) return;
    el.focus({ preventScroll: true });
    if (saved.start == null) return;
    try {
        el.setSelectionRange(saved.start, saved.end, saved.dir);
    } catch {
        // Not a text control any more.
    }
}

function render() {
    if (!S.booted || S.expired) return;
    if (pointerDown) {
        deferred = "full";
        return;
    }
    const focus = captureFocus();
    const scroller = document.scrollingElement;
    const top = scroller?.scrollTop ?? 0;
    registry = new Map();
    regionSigs = new Map();
    app.replaceChildren(...build());
    app.removeAttribute("aria-busy");
    paintDerived();
    restoreFocus(focus);
    if (scroller) scroller.scrollTop = top;
}

function renderDerived() {
    if (!S.booted || S.expired) return;
    if (pointerDown) {
        deferred ||= "derived";
        return;
    }
    paintDerived();
}

function paintDerived() {
    paintMessages();
    paintStatuses();
    paintAgo();
    paintSave();
    region("notice-slot", JSON.stringify([S.notice?.message, S.notice?.action]), buildNotice);
    region("prefill-slot", prefillSig(), buildPrefill);
    region("avail", availSig(), buildAvail);
    region("review", reviewSig(), buildReview);
    region("bar", barSig(), buildBar);
}

// Rebuilds a region only when its signature changed, keeping focus inside it.
function region(id, sig, build) {
    const host = document.getElementById(id);
    if (!host || regionSigs.get(id) === sig) return;
    regionSigs.set(id, sig);
    const focus = host.contains(document.activeElement) ? captureFocus() : null;
    host.replaceChildren(...[build()].flat(Infinity).filter(Boolean));
    restoreFocus(focus);
}

function paintAgo() {
    for (const el of app.querySelectorAll("[data-ago]")) {
        const raw = el.dataset.ago;
        const text = ago(/^\d+$/.test(raw) ? Number(raw) : raw);
        if (el.textContent !== text) el.textContent = text;
    }
}

// --- Inline messages ----------------------------------------------------------------
// A slot sits under one or more controls and shows the plan's issues for their key
// paths. Errors stay hidden until a control is left (touched) or creation was tried.

function slot({ kps, ids = kps, always = false, controls = ids }) {
    const el = h("div", { class: "msgs", id: `m-${kps[0]}` });
    registry.set(el.id, { kps, ids, always, controls });
    return el;
}

function paintMessages() {
    const byKp = new Map();
    const push = (kp, m) => {
        if (!byKp.has(kp)) byKp.set(kp, []);
        byKp.get(kp).push(m);
    };
    for (const [kp, msg] of S.localErrors) push(kp, { level: "error", code: "local", message: msg, kp, local: true });
    for (const issue of S.plan?.issues ?? []) {
        if (issue.kp && !PANEL_CODES.has(issue.code)) push(issue.kp, issue);
    }
    for (const [id, reg] of registry) {
        const el = document.getElementById(id);
        if (!el) continue;
        const visible = reg.always || S.attempted || reg.ids.some((x) => S.touched.has(x));
        const shown = reg.kps
            .flatMap((kp) => byKp.get(kp) ?? [])
            .filter((m) => m.local || visible || m.level === "info")
            .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
        const sig = JSON.stringify(shown.map((m) => [m.level, m.code, m.message, m.fix?.label ?? ""]));
        if (el.dataset.sig !== sig) {
            el.dataset.sig = sig;
            const focus = el.contains(document.activeElement) ? captureFocus() : null;
            el.replaceChildren(...shown.map((m) => message(m)));
            restoreFocus(focus);
        }
        const invalid = shown.some((m) => m.level === "error");
        for (const c of reg.controls) {
            const control = byFocus(c);
            if (!control) continue;
            if (invalid) control.setAttribute("aria-invalid", "true");
            else control.removeAttribute("aria-invalid");
        }
    }
}

function message(m) {
    return h(
        "p",
        { class: `msg ${m.level}` },
        icon(m.level),
        h("span", null, h("span", { class: "sr-only" }, `${LEVEL_WORD[m.level]}: `), m.message, m.fix ? " " : null, m.fix ? fixButton(m) : null),
    );
}

// Fix buttons look the issue up again when clicked, so they never apply a stale fix.
function fixButton(issue, cls = "link-btn", prefix = "fix") {
    return h(
        "button",
        { type: "button", class: cls, "data-focus": `${prefix}:${issue.kp}:${issue.code}`, onclick: () => applyFix(issue.kp, issue.code, prefix) },
        issue.fix.label,
    );
}

// --- Page ----------------------------------------------------------------------------

const RECENT_RESULT = 12 * 3600 * 1000;
const showDone = () =>
    Boolean(S.lastResult) &&
    isBlankDraft(S.draft) &&
    S.dismissed !== S.lastResult.at &&
    Date.now() - Date.parse(S.lastResult.at) < RECENT_RESULT;

function build() {
    if (!S.draft) return [h("p", { class: "boot" }, "Loading the draft…")];
    if (showDone()) return buildDone();
    return [
        buildTop(),
        h("div", { id: "notice-slot" }),
        h("div", { id: "prefill-slot" }),
        buildEvent(),
        buildTalks(),
        buildPartners(),
        h(
            "section",
            { class: "sec", id: "sec-review", "aria-labelledby": "review-h" },
            h("div", { class: "sec-head" }, h("h2", { id: "review-h" }, "Review")),
            h("div", { id: "review" }),
        ),
        h("div", { id: "bar", class: "bar" }),
    ];
}

function buildTop() {
    const next = S.catalog?.next;
    return h(
        "header",
        { class: "top" },
        h(
            "div",
            { class: "top-text" },
            h("h1", null, next ? `New event #${next.eventId}` : "New event"),
            h("p", { class: "top-meta" }, "MTG Bordeaux", S.repo?.branch ? [" · writes to branch ", h("code", null, S.repo.branch)] : null),
        ),
        h("p", { id: "save", class: "save" }),
    );
}

function buildNotice() {
    const n = S.notice;
    if (!n) return null;
    return h(
        "div",
        { class: "notice", role: "alert" },
        h("p", null, n.message),
        n.action ? h("button", { type: "button", class: "btn small", "data-focus": "notice", onclick: () => n.run() }, n.action) : null,
    );
}

// --- Prefill from La Grappe -----------------------------------------------------------
// MTG Bordeaux events listed on La Grappe but missing from the site: one click copies
// the name, date, link and venue.

const prefillShown = () => !S.draft.event.name && !S.draft.event.date && S.candidates.length > 0;
const prefillSig = () => JSON.stringify(prefillShown() ? S.candidates.slice(0, 4).map((c) => [c.day, c.title]) : []);

function buildPrefill() {
    if (!prefillShown()) return null;
    return h(
        "div",
        { class: "prefill", role: "group", "aria-labelledby": "prefill-h" },
        h("p", { id: "prefill-h" }, "La Grappe Numérique lists these MTG Bordeaux events that aren't on the site yet. Start from one:"),
        h(
            "div",
            { class: "prefill-list" },
            S.candidates.slice(0, 4).map((c, i) =>
                h(
                    "button",
                    { type: "button", class: "chip", "data-focus": `prefill:${i}`, title: c.title, onclick: () => applyCandidate(c) },
                    h("span", { class: "chip-date" }, fmtShort(c.day)),
                    h("span", { class: "chip-title" }, c.title),
                ),
            ),
        ),
    );
}

function knownLocation(venue) {
    const v = String(venue ?? "").trim();
    if (!v) return "";
    return (S.catalog?.locations ?? []).find((l) => nameKey(l) === nameKey(v)) ?? v;
}

function applyCandidate(c) {
    const ev = S.draft.event;
    const before = { ...ev };
    ev.name = c.title;
    ev.date = c.day;
    if (!ev.url && isHttpUrl(c.url ?? "")) ev.url = c.url;
    if (!ev.location && c.venue) ev.location = knownLocation(c.venue);
    S.focusDay = c.day;
    syncMonth();
    edited(true);
    render();
    focusId("event.name");
    withUndo(
        "Filled in from the La Grappe Numérique listing.",
        () => {
            Object.assign(S.draft.event, before);
            syncMonth();
        },
        "prefill:0",
    );
}

// --- Fields ---------------------------------------------------------------------------
// Controls carry their index path (data-path) for edits and their key path (data-focus)
// for focus and messages, so both survive reordering.

function field(path, opts = {}) {
    const kp = keyPath(path);
    const id = `f-${kp}`;
    const hintId = opts.hint ? `h-${kp}` : null;
    const type = opts.type ?? "text";
    const attrs = {
        id,
        class: "input",
        value: getAt(S.draft, path) ?? "",
        placeholder: opts.placeholder,
        list: opts.list,
        autocomplete: "off",
        inputmode: opts.inputmode,
        spellcheck: opts.spellcheck,
        maxlength: type === "date" ? null : (opts.maxlength ?? S.limits.text ?? 500),
        "data-focus": kp,
        "data-path": path,
        "aria-describedby": [hintId, `m-${kp}`].filter(Boolean).join(" "),
        "aria-required": opts.required ? "true" : null,
    };
    const control = opts.textarea ? h("textarea", { ...attrs, rows: 5 }) : h("input", { ...attrs, type });
    return h(
        "div",
        { class: opts.cls ? `field ${opts.cls}` : "field" },
        h(
            "div",
            { class: "label-row" },
            h("label", { htmlFor: id }, opts.label),
            opts.required ? h("span", { class: "req" }, "Required") : null,
            opts.labelExtra,
        ),
        control,
        opts.hint ? h("p", { class: "hint", id: hintId }, opts.hint) : null,
        slot({ kps: [kp] }),
        opts.extra,
    );
}

// --- Event ----------------------------------------------------------------------------

function buildEvent() {
    const ev = S.draft.event;
    const n = S.catalog?.next?.meetupNumber;
    const numbered = n ? `Meetup n°${n}` : "";
    const useNumbered = numbered
        ? h(
              "button",
              {
                  type: "button",
                  class: "link-btn",
                  "data-focus": "use-numbered",
                  hidden: Boolean(ev.name),
                  onclick: () => {
                      S.draft.event.name = numbered;
                      const input = byFocus("event.name");
                      if (input) input.value = numbered;
                      focusId("event.name", false);
                      liveUpdate("event.name");
                      edited();
                  },
              },
              `Use “${numbered}”`,
          )
        : null;
    const locations = S.catalog?.locations ?? [];
    return h(
        "section",
        { class: "sec", id: "sec-event", "aria-labelledby": "event-h" },
        h("div", { class: "sec-head" }, h("h2", { id: "event-h" }, "Event")),
        h(
            "div",
            { class: "event-grid" },
            h(
                "div",
                { class: "stack" },
                field("event.name", { label: FIELD_LABELS.name, required: true, placeholder: numbered || null, labelExtra: useNumbered }),
                field("event.date", { label: FIELD_LABELS.date, required: true, type: "date" }),
                field("event.location", { label: FIELD_LABELS.location, list: locations.length ? "dl-locations" : null, placeholder: locations[0] ?? null }),
                locations.length ? h("datalist", { id: "dl-locations" }, locations.map((l) => h("option", { value: l }))) : null,
                field("event.url", { label: FIELD_LABELS.url, type: "url", spellcheck: "false", placeholder: "https://www.meetup.com/mtg-bordeaux/events/…" }),
                field("event.replay", { label: FIELD_LABELS.replay, type: "url", spellcheck: "false", placeholder: "https://", hint: "Add it once the recording is online." }),
            ),
            h("aside", { id: "avail", class: "avail", "aria-labelledby": "avail-h" }),
        ),
    );
}

// --- Availability ----------------------------------------------------------------------
// The verdict answers "is this day free?" from the plan, which the server computes for the
// saved date. The month grid shows what La Grappe Numérique lists around it.

let monthsVersion = 0;
const monthLoads = new Map();
const panelIssues = () => (S.plan?.issues ?? []).filter((i) => PANEL_CODES.has(i.code));

function availSig() {
    const cal = S.plan?.calendar;
    const m = S.months.get(S.month);
    return JSON.stringify([
        S.draft?.event?.date ?? "",
        S.month,
        S.today,
        monthsVersion,
        m ? [m.status, m.fetchedAt, m.error] : null,
        cal ? [cal.day, cal.status, cal.fetchedAt, cal.stale, cal.conflicts?.length, cal.listings?.length] : null,
        panelIssues().map((i) => [i.code, i.message]),
        S.calendarRefreshing,
        S.calendar?.fetchedAt ?? null,
    ]);
}

function verdict() {
    const date = S.draft.event.date;
    if (!isValidDay(date)) return { kind: "idle", title: "Pick a date" };
    const cal = S.plan?.calendar;
    if (!cal || cal.day !== date) return { kind: "loading", title: `Checking ${fmtShort(date)}…` };
    const issues = panelIssues();
    const conflicts = cal.conflicts ?? [];
    const clashes = issues.filter((i) => i.code === "site-clash");
    const note = issues.find((i) => i.code === "calendar-unavailable" || i.code === "calendar-stale");
    if (conflicts.length || clashes.length) {
        const title = conflicts.length ? `${plural(conflicts.length, "other event")} that day` : "The site has an event that day";
        return { kind: "conflict", title, conflicts, clashes, note };
    }
    if (note?.code === "calendar-unavailable" || cal.status === "error") {
        const fallback = { message: `Couldn't reach La Grappe Numérique${cal.error ? ` (${cal.error})` : ""}.` };
        return { kind: "error", title: "Couldn't check this day", note: note ?? fallback };
    }
    if (cal.status === "loading" || cal.status === "idle") return { kind: "loading", title: `Checking ${fmtShort(date)}…` };
    return { kind: "free", title: "No other event that day", listings: cal.listings ?? [], note };
}

function evItem(e) {
    const where = e.online ? "Online" : [e.venue, e.city].filter(Boolean).join(", ");
    const meta = [e.time, (e.communities ?? []).join(", "), where].filter(Boolean).join(" · ");
    const title = isHttpUrl(e.url ?? "")
        ? h("a", { class: "ev-title", href: e.url, target: "_blank", rel: "noreferrer" }, e.title)
        : h("span", { class: "ev-title" }, e.title);
    return h("li", { class: "ev" }, title, meta ? h("span", { class: "ev-meta" }, meta) : null);
}

function evList(events, max = 4) {
    const extra = events.length - max;
    return h("ul", { class: "ev-list" }, events.slice(0, max).map(evItem), extra > 0 ? h("li", { class: "ev-meta" }, `and ${extra} more`) : null);
}

function buildVerdict() {
    const v = verdict();
    const date = S.draft.event.date;
    const key = JSON.stringify([date, v.kind, v.conflicts?.length ?? 0, v.clashes?.length ?? 0]);
    const fresh = S.verdictKey !== null && key !== S.verdictKey && v.kind !== "loading" && v.kind !== "idle";
    if (v.kind !== "loading") {
        if (fresh) announce(`${fmtLong(date)}: ${v.title}.`);
        S.verdictKey = key;
    }
    const body = [];
    if (v.kind === "idle") body.push(h("p", null, "The date is checked against the events other Bordeaux communities list on La Grappe Numérique."));
    if (v.kind === "loading") body.push(h("p", null, "Looking for other community events on La Grappe Numérique."));
    if (v.kind === "conflict") {
        for (const c of v.clashes) body.push(h("p", null, c.message));
        if (v.conflicts.length) body.push(evList(v.conflicts));
        body.push(h("p", { class: "muted" }, "You can still create it: you'll be asked to confirm."));
    }
    if (v.kind === "free") {
        body.push(h("p", null, `Nothing else is listed on La Grappe Numérique for ${fmtLong(date)}.`));
        if (v.listings.length) body.push(h("p", { class: "muted" }, "Already announced there:"), evList(v.listings, 2));
    }
    if (v.note) body.push(h("p", null, v.note.message), v.note.fix ? fixButton(v.note, "btn small", "pfix") : null);
    const iconName = { idle: "info", loading: "refresh", conflict: "warning", error: "warning", free: "free" }[v.kind];
    return h(
        "div",
        { class: `verdict ${v.kind}${fresh ? " enter" : ""}` },
        icon(iconName),
        h("p", { class: "verdict-title" }, v.title),
        h("div", { class: "verdict-body" }, body),
    );
}

function monthData(month = S.month) {
    return S.months.get(month) ?? null;
}

function dayInfo(day) {
    const m = monthData();
    if (!m || m.status === "error") return null;
    const events = m.byDay.get(day) ?? [];
    return { others: events.filter((e) => !e.ours), ours: events.filter((e) => e.ours), site: m.site.get(day) ?? [] };
}

function visibleFocusDay() {
    const date = S.draft.event.date;
    for (const d of [S.focusDay, date, S.today]) if (isValidDay(d) && monthOf(d) === S.month) return d;
    return `${S.month}-01`;
}

function buildAvail() {
    if (!S.month) S.month = monthOf(isValidDay(S.draft.event.date) ? S.draft.event.date : S.today || toDay(new Date()));
    const date = S.draft.event.date;
    const m = monthData();
    if (!m) void loadMonth(S.month);
    const focusDay = visibleFocusDay();
    const start = gridStart(S.month);
    const rows = [];
    for (let w = 0; w < 6; w++) {
        const cells = [];
        for (let d = 0; d < 7; d++) {
            const day = addDays(start, w * 7 + d);
            const info = dayInfo(day);
            const others = info?.others.length ?? 0;
            const ours = Boolean(info && (info.ours.length || info.site.length));
            const label = [fmtLong(day), others ? plural(others, "other community event") : "", ours ? "MTG Bordeaux event" : ""].filter(Boolean).join(", ");
            const cls = ["day", monthOf(day) !== S.month && "out", day === S.today && "today"].filter(Boolean).join(" ");
            cells.push(
                h(
                    "td",
                    null,
                    h(
                        "button",
                        {
                            type: "button",
                            class: cls,
                            tabIndex: day === focusDay ? 0 : -1,
                            "data-day": day,
                            "data-focus": `day:${day}`,
                            "aria-label": label,
                            "aria-pressed": day === date ? "true" : "false",
                            "aria-current": day === S.today ? "date" : null,
                            onclick: () => pickDay(day),
                            onpointerenter: () => peek(day),
                        },
                        h("span", { class: "day-num", "aria-hidden": "true" }, String(Number(day.slice(8)))),
                        others || ours
                            ? h("span", { class: "dots", "aria-hidden": "true" }, Array.from({ length: Math.min(others, 3) }, () => h("span", { class: "dot" })), ours ? h("span", { class: "dot ours" }) : null)
                            : null,
                    ),
                ),
            );
        }
        rows.push(h("tr", null, cells));
    }
    const fetchedAt = S.calendar?.fetchedAt ?? m?.fetchedAt ?? null;
    return [
        h("h3", { id: "avail-h" }, "Same-day check"),
        buildVerdict(),
        h(
            "div",
            { class: "cal" },
            h(
                "div",
                { class: "cal-head" },
                h("button", { type: "button", class: "btn small quiet icon-only", "data-focus": "cal-prev", "aria-label": "Previous month", onclick: () => goMonth(-1) }, icon("left")),
                h("h4", { id: "cal-month" }, fmtMonth(S.month)),
                h("button", { type: "button", class: "btn small quiet icon-only", "data-focus": "cal-next", "aria-label": "Next month", onclick: () => goMonth(1) }, icon("right")),
            ),
            h(
                "table",
                { class: "cal-grid", id: "cal-grid", role: "grid", "aria-labelledby": "cal-month", onkeydown: onGridKey, onpointerleave: () => peek("") },
                h("thead", null, h("tr", null, WEEKDAYS.map(([short, long]) => h("th", { scope: "col", abbr: long }, short)))),
                h("tbody", null, rows),
            ),
            h("p", { class: "cal-detail", id: "cal-detail" }, detailParts()),
            h(
                "div",
                { class: "cal-foot" },
                h("span", { class: "legend" }, h("span", { class: "dot", "aria-hidden": "true" }), "Other communities"),
                h("span", { class: "legend" }, h("span", { class: "dot ours", "aria-hidden": "true" }), "MTG Bordeaux"),
                h(
                    "span",
                    null,
                    "From ",
                    h("a", { href: GRAPPE_URL, target: "_blank", rel: "noreferrer" }, "La Grappe Numérique"),
                    fetchedAt ? [", updated ", h("span", { "data-ago": String(fetchedAt) }, ago(fetchedAt))] : null,
                ),
                h(
                    "button",
                    {
                        type: "button",
                        class: "btn small quiet",
                        "data-focus": "cal-refresh",
                        "aria-disabled": S.calendarRefreshing ? "true" : null,
                        onclick: () => void refreshCalendar(),
                    },
                    icon("refresh"),
                    S.calendarRefreshing ? "Refreshing…" : "Refresh",
                ),
            ),
        ),
    ];
}

function peek(day) {
    if (S.peekDay === day) return;
    S.peekDay = day;
    paintDetail();
}

function paintDetail() {
    document.getElementById("cal-detail")?.replaceChildren(...detailParts());
}

function detailParts() {
    const grid = document.getElementById("cal-grid");
    const date = S.draft.event.date;
    const day = S.peekDay || (grid?.contains(document.activeElement) ? S.focusDay : "") || (isValidDay(date) && monthOf(date) === S.month ? date : "");
    const m = monthData();
    let parts;
    if (!m) parts = ["Loading La Grappe Numérique…"];
    else if (m.status === "error") parts = [`Couldn't load this month${m.error ? ` (${m.error})` : ""}.`];
    else if (!day) parts = ["Point at a day to see what's planned."];
    else {
        const info = dayInfo(day);
        const names = [...info.site.map((e) => `“${e.name}” (#${e.id}, on the site)`), ...info.ours.map((e) => `“${e.title}” (MTG Bordeaux)`), ...info.others.map((e) => `“${e.title}”`)];
        parts = [h("span", { class: "cal-detail-day" }, fmtShort(day)), " · ", names.length ? names.join(", ") : "Nothing listed"];
    }
    return parts;
}

function onGridKey(e) {
    const btn = e.target.closest?.("button.day");
    if (!btn || e.altKey || e.ctrlKey || e.metaKey) return;
    const day = btn.dataset.day;
    const dow = (dayDate(day).getUTCDay() + 6) % 7;
    const moves = {
        ArrowLeft: () => addDays(day, -1),
        ArrowRight: () => addDays(day, 1),
        ArrowUp: () => addDays(day, -7),
        ArrowDown: () => addDays(day, 7),
        Home: () => addDays(day, -dow),
        End: () => addDays(day, 6 - dow),
        PageUp: () => shiftMonth(day, e.shiftKey ? -12 : -1),
        PageDown: () => shiftMonth(day, e.shiftKey ? 12 : 1),
    };
    if (!moves[e.key]) return;
    e.preventDefault();
    moveDayFocus(moves[e.key]());
}

function moveDayFocus(day) {
    S.focusDay = day;
    if (monthOf(day) !== S.month) {
        S.month = monthOf(day);
        void loadMonth(S.month);
        renderDerived();
        announce(fmtMonth(S.month));
    } else {
        for (const b of app.querySelectorAll("#cal-grid button.day")) b.tabIndex = b.dataset.day === day ? 0 : -1;
    }
    focusId(`day:${day}`, false);
    paintDetail();
}

function goMonth(n) {
    S.month = addMonths(S.month, n);
    void loadMonth(S.month);
    renderDerived();
    announce(fmtMonth(S.month));
}

function pickDay(day) {
    if (!isValidDay(day)) return;
    S.draft.event.date = day;
    S.focusDay = day;
    S.touched.add("event.date");
    const input = byFocus("event.date");
    if (input) input.value = day;
    liveUpdate("event.date");
    edited();
}

// Loads the six-week grid of a month; a newer version (after a refresh) wins.
function loadMonth(month) {
    if (!month || S.months.has(month)) return Promise.resolve();
    const version = monthsVersion;
    const id = `${version}:${month}`;
    if (monthLoads.has(id)) return monthLoads.get(id);
    const from = gridStart(month);
    const p = (async () => {
        try {
            const r = await api("GET", `/api/calendar?from=${from}&to=${addDays(from, 41)}`);
            if (version !== monthsVersion) return;
            const byDay = new Map();
            const site = new Map();
            const push = (map, day, item) => (map.get(day) ?? map.set(day, []).get(day)).push(item);
            for (const e of r.events ?? []) push(byDay, e.day, e);
            for (const e of r.siteEvents ?? []) push(site, e.date, e);
            S.months.set(month, { status: r.status, fetchedAt: r.fetchedAt, error: r.error, byDay, site });
        } catch (err) {
            if (err.code === "forbidden") return expired();
            if (version === monthsVersion) S.months.set(month, { status: "error", error: err.message, byDay: new Map(), site: new Map() });
        } finally {
            monthLoads.delete(id);
        }
        renderDerived();
    })();
    monthLoads.set(id, p);
    return p;
}

async function refreshCalendar() {
    if (S.calendarRefreshing) return;
    S.calendarRefreshing = true;
    renderDerived();
    try {
        S.calendar = await api("POST", "/api/calendar/refresh", {});
        S.months.clear();
        monthsVersion++;
        if (S.calendar?.error) toast(`Couldn't refresh La Grappe Numérique (${S.calendar.error}).`);
        else announce("La Grappe Numérique is up to date.");
    } catch (err) {
        if (err.code === "forbidden") return expired();
        toast(`Couldn't refresh La Grappe Numérique. ${err.message}`);
    } finally {
        S.calendarRefreshing = false;
    }
    void loadMonth(S.month);
    await refreshState(true);
    renderDerived();
}

// --- Talks, speakers and partners ------------------------------------------------------

function mutate(change) {
    if (S.creating || S.expired) return;
    change();
    edited(true);
    render();
}

function removeItem(listKp, key, label, focusAfter) {
    const path = indexPathOf(listKp);
    const list = path && getAt(S.draft, path);
    const index = list?.findIndex((x) => x.key === key) ?? -1;
    if (index < 0 || S.creating || S.expired) return;
    const item = JSON.parse(JSON.stringify(list[index]));
    const nextKey = list[index + 1]?.key;
    mutate(() => list.splice(index, 1));
    focusId(focusAfter);
    withUndo(`${label} removed.`, () => {
        const currentPath = indexPathOf(listKp);
        const current = currentPath && getAt(S.draft, currentPath);
        const limit = S.limits[listKp.split(".").at(-1)];
        if (!current || (limit && current.length >= limit) || current.some((x) => x.key === key)) return false;
        const next = current.findIndex((x) => x.key === nextKey);
        current.splice(next < 0 ? Math.min(index, current.length) : next, 0, item);
    }, focusAfter);
}

function newSpeaker(name = "") {
    const [firstname = "", ...rest] = name.trim().split(/\s+/);
    return { key: newKey(), mode: "new", firstname, lastname: rest.join(" "), role: "", photo: "", photoUpload: null,
        company: { name: "", link: "", logo: "", logoUpload: null }, socials: [] };
}

function speakerCombo(talk, add) {
    const id = `pick-${talk.key}`;
    const state = S.combos.get(id) ?? { query: "", open: false, active: 0 };
    S.combos.set(id, state);
    const input = h("input", { id, class: "input", role: "combobox", autocomplete: "off", value: state.query,
        placeholder: "Search by name or company…", "data-focus": id, "aria-autocomplete": "list", "aria-controls": `${id}-list`,
        "aria-expanded": "false", disabled: talk.speakers.length >= (S.limits.speakers ?? 20) });
    const list = h("div", { id: `${id}-list`, class: "combo-list", role: "listbox", "aria-label": "Speakers", hidden: true });
    let choices = [];
    const choose = (choice) => {
        if (!choice || S.creating || S.expired) return;
        const speaker = choice.new ? newSpeaker(state.query) : { key: newKey(), mode: "existing", id: choice.id };
        state.query = "";
        state.open = false;
        state.skipFocus = !choice.new;
        add(speaker);
        focusId(choice.new ? `talks.${talk.key}.speakers.${speaker.key}.firstname` : id);
    };
    const paint = () => {
        const query = nameKey(state.query);
        choices = (S.catalog?.speakers ?? []).filter((s) => !talk.speakers.some((x) => x.mode === "existing" && x.id === s.id)
            && nameKey(`${s.name || fullName(s)} ${s.company || ""}`).includes(query));
        choices.push({ new: true });
        state.active = Math.max(0, Math.min(state.active, choices.length - 1));
        input.setAttribute("aria-expanded", String(state.open));
        if (state.open) input.setAttribute("aria-activedescendant", `${id}-opt-${state.active}`);
        else input.removeAttribute("aria-activedescendant");
        list.hidden = !state.open;
        list.replaceChildren(...choices.map((s, i) => h("div", { id: `${id}-opt-${i}`, class: `combo-opt${s.new ? " new" : ""}`,
            role: "option", "aria-selected": String(i === state.active), onpointerdown: (e) => e.preventDefault(), onclick: () => choose(s) },
            s.new ? icon("plus") : null, h("div", { class: "combo-opt-text" }, s.new ? `New speaker${state.query.trim() ? ` “${state.query.trim()}”` : "…"}` : s.name || fullName(s),
                !s.new && s.company ? h("p", { class: "combo-opt-meta" }, s.company) : null))));
    };
    input.addEventListener("focus", () => { if (state.skipFocus) state.skipFocus = false; else state.open = true; paint(); });
    input.addEventListener("input", () => { state.query = input.value; state.active = 0; state.open = true; paint(); });
    input.addEventListener("blur", () => { state.open = false; paint(); });
    input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); state.open = false; paint(); }
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (state.open) state.active += e.key === "ArrowDown" ? 1 : -1;
            state.open = true;
            paint();
            document.getElementById(`${id}-opt-${state.active}`)?.scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter" && state.open) { e.preventDefault(); choose(choices[state.active]); }
    });
    paint();
    return h("div", { class: "field" }, h("label", { htmlFor: id }, "Add a speaker"), h("div", { class: "combo" }, input, list));
}

function imageField(path, label) {
    const kp = keyPath(path);
    const uploadPath = `${path}Upload`;
    const ref = getAt(S.draft, uploadPath);
    const uploading = S.uploading.has(kp);
    const control = field(path, { label, placeholder: "/speakers/jane-doe.png or https://…" });
    const input = control.querySelector("input");
    input.disabled = uploading;
    const picker = h("input", { type: "file", accept: IMAGE_ACCEPT, hidden: true, "aria-label": `Choose ${label.toLowerCase()}`, onchange: (e) => {
        const file = e.target.files[0];
        if (file) void uploadImage(kp, file);
    } });
    const url = ref ? stagedUrl(ref) : repoUrl(input.value);
    const preview = h("div", { class: "image-preview", "data-image-preview": kp }, url ? h("img", { src: url, alt: `${label} preview`, onerror: (e) => e.target.replaceWith(icon("image")) }) : icon("image"));
    const controls = h("div", { class: "image-controls" });
    if (ref) {
        input.hidden = true;
        controls.append(h("span", { class: "upload-chip", title: ref.name }, ref.name, ` · ${formatSize(ref.size)}`));
    } else controls.append(input);
    controls.append(picker, h("button", { type: "button", class: "btn small", "data-focus": `upload:${kp}`, disabled: uploading,
        onclick: () => picker.click() }, icon("upload"), uploading ? "Uploading…" : ref ? "Replace" : "Upload"));
    if (ref || input.value) controls.append(h("button", { type: "button", class: "btn small quiet", disabled: uploading,
        "aria-label": `Clear ${label.toLowerCase()}`, onclick: () => mutate(() => {
            const current = indexPathOf(kp);
            if (current) { setAt(S.draft, current, ""); setAt(S.draft, `${current}Upload`, null); }
        }) }, icon("x")));
    const zone = h("div", { class: "image-field", "aria-busy": String(uploading), ondragover: (e) => {
        e.preventDefault(); if (!uploading) zone.classList.add("drop");
    }, ondragleave: (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("drop"); }, ondrop: (e) => {
        e.preventDefault(); zone.classList.remove("drop");
        if (e.dataTransfer.files.length !== 1) { S.localErrors.set(kp, "Drop one image at a time."); renderDerived(); }
        else void uploadImage(kp, e.dataTransfer.files[0]);
    } }, preview, controls);
    control.insertBefore(zone, control.querySelector(".msgs"));
    if (ref) controls.prepend(input);
    control.append(h("p", { class: "hint" }, `Or drop an image here · PNG, JPEG, GIF, WebP or SVG · up to ${formatSize(S.limits.upload ?? 5 * 1024 * 1024)}`));
    return control;
}

async function uploadImage(kp, file) {
    if (S.creating || S.expired || S.uploading.has(kp) || !indexPathOf(kp)) return;
    S.localErrors.delete(kp);
    const limit = S.limits.upload ?? 5 * 1024 * 1024;
    if (file.size > limit || !file.size) {
        S.localErrors.set(kp, !file.size ? "This file is empty. Choose an image." : `Choose an image under ${formatSize(limit)}.`);
        renderDerived(); return;
    }
    const request = {};
    const generation = undoGeneration;
    S.uploading.set(kp, request);
    render();
    try {
        const ref = await api("POST", `/api/upload?name=${encodeURIComponent(file.name)}`, file, { raw: true });
        const path = indexPathOf(kp);
        if (path && generation === undoGeneration && S.uploading.get(kp) === request) {
            setAt(S.draft, path, "");
            setAt(S.draft, `${path}Upload`, ref);
            edited(true);
            announce(`${file.name} uploaded.`);
        }
    } catch (err) {
        if (err.code === "forbidden") return expired();
        if (indexPathOf(kp) && generation === undoGeneration) S.localErrors.set(kp, `${err.message} Choose another image or try again.`);
    } finally {
        S.uploading.delete(kp);
        render();
        focusId(`upload:${kp}`, false);
    }
}

function buildSocials(speaker, path) {
    const listKp = keyPath(`${path}.socials`);
    return h("div", { class: "socials" }, h("h4", null, "Social profiles"), speaker.socials.map((social, i) => {
        const sp = `${path}.socials.${i}`;
        const typeKp = keyPath(`${sp}.type`);
        const linkKp = keyPath(`${sp}.link`);
        const select = h("select", { class: "input", value: social.type, "aria-label": `Social network ${i + 1}`, "data-focus": typeKp, "data-path": `${sp}.type` },
            h("option", { value: "" }, "Auto-detect"), social.type && !SOCIAL_TYPES.includes(social.type) ? h("option", { value: social.type }, SOCIAL_LABELS[social.type] || social.type) : null,
            SOCIAL_TYPES.map((type) => h("option", { value: type }, SOCIAL_LABELS[type])));
        const link = h("input", { type: "url", class: "input", value: social.link, placeholder: "https://", maxlength: S.limits.text,
            "aria-label": `Social link ${i + 1}`, "data-focus": linkKp, "data-path": `${sp}.link`, "aria-describedby": `m-${linkKp}` });
        return h("div", { class: "social" }, select, link,
            h("button", { type: "button", class: "btn small quiet", "aria-label": `Remove social profile ${i + 1}`,
                onclick: () => removeItem(listKp, social.key, "Social profile", `add:${listKp}`) }, icon("x")),
            slot({ kps: [linkKp, typeKp], ids: [linkKp, typeKp] }),
            !social.type && detectSocialType(social.link) ? h("p", { class: "hint social-detected" }, `Detected: ${SOCIAL_LABELS[detectSocialType(social.link)]}`) : null);
    }), h("button", { type: "button", class: "btn small", "data-focus": `add:${listKp}`, disabled: speaker.socials.length >= (S.limits.socials ?? 12), onclick: () => {
        const social = { key: newKey(), type: "", link: "" };
        mutate(() => { const p = indexPathOf(listKp); if (p) getAt(S.draft, p).push(social); });
        focusId(`${listKp}.${social.key}.link`);
    } }, icon("plus"), "Add social profile"));
}

function buildTalks() {
    const talks = S.draft.talks;
    return h("section", { class: "sec", id: "sec-talks", "aria-labelledby": "talks-h" },
        h("div", { class: "sec-head" }, h("h2", { id: "talks-h" }, "Talks and speakers")),
        slot({ kps: ["talks"], always: true }),
        talks.length ? h("div", { class: "talks" }, talks.map((talk, i) => {
            const path = `talks.${i}`;
            const move = (offset) => {
                let target;
                mutate(() => {
                    const current = S.draft.talks.findIndex((t) => t.key === talk.key);
                    target = current + offset;
                    if (current < 0 || target < 0 || target >= S.draft.talks.length) return;
                    const [item] = S.draft.talks.splice(current, 1);
                    S.draft.talks.splice(target, 0, item);
                });
                focusId(`talks.${talk.key}.title`);
                announce(`Talk moved to position ${target + 1}.`);
            };
            return h("div", { class: "talk" },
                h("div", { class: "talk-rail", "aria-hidden": "true" }, h("span", { class: "talk-num" }, i + 1)),
                h("div", { class: "talk-body" },
                    h("div", { class: "talk-head" }, h("h3", null, `Talk ${i + 1}`),
                        h("button", { type: "button", class: "btn small quiet", disabled: i === 0, "aria-label": `Move talk ${i + 1} up`, onclick: () => move(-1) }, icon("up")),
                        h("button", { type: "button", class: "btn small quiet", disabled: i === talks.length - 1, "aria-label": `Move talk ${i + 1} down`, onclick: () => move(1) }, icon("down")),
                        h("button", { type: "button", class: "btn small quiet", "aria-label": `Remove talk ${i + 1}`, onclick: () => removeItem("talks", talk.key, "Talk", "add-talk") }, "Remove")),
                    field(`${path}.title`, { label: "Title", required: true }),
                    field(`${path}.abstract`, { label: "Abstract", textarea: true, maxlength: S.limits.abstract }),
                    field(`${path}.replay`, { label: "Replay", type: "url", placeholder: "https://" }),
                    buildSpeakers(talk, path)));
        })) : h("p", { class: "hint" }, "Add a talk to include its description and speakers."),
        h("button", { type: "button", class: "btn", "data-focus": "add-talk", disabled: talks.length >= (S.limits.talks ?? 30), onclick: () => mutate(() => {
            S.draft.talks.push({ key: newKey(), title: "", abstract: "", replay: "", speakers: [] });
        }) }, icon("plus"), "Add talk"));
}

function buildSpeakers(talk, path) {
    const speakers = S.catalog?.speakers ?? [];
    const pickerId = `pick-${talk.key}`;
    const add = (speaker) => mutate(() => {
        const current = S.draft.talks.find((t) => t.key === talk.key);
        if (current && current.speakers.length < (S.limits.speakers ?? 20)) current.speakers.push(speaker);
    });
    return h("div", { class: "speakers-block" },
        h("h4", null, "Speakers"),
        slot({ kps: [keyPath(`${path}.speakers`)], always: true }),
        h("div", { class: "speakers" }, talk.speakers.map((speaker, i) => {
            const sp = `${path}.speakers.${i}`;
            const known = speakers.find((s) => s.id === speaker.id);
            return h("div", { class: `speaker ${speaker.mode}` },
                h("div", { class: "speaker-row" },
                    h("div", { class: "speaker-who" },
                        speaker.mode === "existing" && repoUrl(known?.photo) ? h("img", { class: "avatar", src: repoUrl(known.photo), alt: "", onerror: (e) => e.target.remove() }) : null,
                        h("div", null, h("p", { class: "speaker-name" }, speaker.mode === "existing" ? known?.name || fullName(known) || `Speaker #${speaker.id}` : `New speaker ${i + 1}`),
                            known?.company ? h("p", { class: "speaker-meta" }, [known.role, known.company].filter(Boolean).join(" · ")) : null,
                            h("p", { class: "speaker-meta", "data-speaker-status": speaker.key }))),
                    h("button", { type: "button", class: "btn small quiet", "aria-label": `Remove speaker ${i + 1} from ${talk.title || "this talk"}`, onclick: () => removeItem(keyPath(`${path}.speakers`), speaker.key, "Speaker", pickerId) }, "Remove")),
                slot({ kps: [keyPath(sp)], always: true }),
                speaker.mode === "new" ? [
                    field(`${sp}.firstname`, { label: "First name", required: true }),
                    field(`${sp}.lastname`, { label: "Last name", required: true }),
                    field(`${sp}.role`, { label: "Role" }),
                    imageField(`${sp}.photo`, "Photo"),
                    companyField(`${sp}.company.name`, "Company"),
                    field(`${sp}.company.link`, { label: "Company link", type: "url" }),
                    imageField(`${sp}.company.logo`, "Company logo"),
                    buildSocials(speaker, sp),
                ] : null);
        })),
        speakerCombo(talk, add));
}

function companyField(path, label, required = false) {
    const kp = keyPath(path);
    const listId = `companies-${kp}`;
    return field(path, { label, required, list: listId, extra: h("datalist", { id: listId },
        (S.catalog?.companies ?? []).map((company) => h("option", { value: company.name }))) });
}

function autofillCompany(path, previousName) {
    const parent = path.slice(0, -5);
    const company = getAt(S.draft, parent);
    const known = (S.catalog?.companies ?? []).find((c) => nameKey(c.name) === nameKey(company.name));
    if (!known) return;
    const previous = (S.catalog?.companies ?? []).find((c) => nameKey(c.name) === nameKey(previousName));
    if (!company.link || (previous?.link && company.link === previous.link)) company.link = known.link || "";
    if (!company.logoUpload && (!company.logo || (previous?.logo && company.logo === previous.logo))) company.logo = known.logo || "";
}

function buildPartners() {
    return h("section", { class: "sec", id: "sec-partners", "aria-labelledby": "partners-h" },
        h("div", { class: "sec-head" }, h("h2", { id: "partners-h" }, "Partners")),
        h("div", { class: "partners" }, S.draft.partners.map((partner, i) => {
            const path = `partners.${i}`;
            return h("div", { class: "partner" },
                h("div", { class: "partner-head" }, h("h3", null, `Partner ${i + 1}`),
                    h("button", { type: "button", class: "btn small quiet", "aria-label": `Remove partner ${i + 1}`,                     onclick: () => removeItem("partners", partner.key, "Partner", "add-partner") }, "Remove")),
                companyField(`${path}.name`, "Name", true),
                field(`${path}.link`, { label: "Link", type: "url" }),
                imageField(`${path}.logo`, "Logo"));
        })),
        h("button", { type: "button", class: "btn", "data-focus": "add-partner", disabled: S.draft.partners.length >= (S.limits.partners ?? 30), onclick: () => mutate(() => {
            S.draft.partners.push({ key: newKey(), name: "", link: "", logo: "", logoUpload: null });
        }) }, icon("plus"), "Add partner"));
}

function paintStatuses() {
    for (const el of app.querySelectorAll("[data-speaker-status]")) {
        const info = S.plan?.speakers?.[el.dataset.speakerStatus];
        const text = !info ? "" : info.status === "merged" ? `Shares the profile from talk ${info.primaryTalk + 1} · speaker #${info.id}`
            : info.status === "existing" ? `Existing profile · speaker #${info.id}`
            : info.status === "new" ? `New profile · speaker #${info.id}` : "A profile with this name already exists";
        if (el.textContent !== text) el.textContent = text;
    }
}

// --- Review and creation --------------------------------------------------------------

const reviewSig = () => JSON.stringify([S.plan, S.attempted]);

function buildReview() {
    const issues = S.plan?.issues ?? [];
    const files = S.plan?.files ?? [];
    return [
        issues.length ? h("ul", { class: "issues" }, issues.map((issue) => h("li", { class: `issue ${issue.level}` },
            icon(issue.level), h("div", null, h("p", null, `${LEVEL_WORD[issue.level]}: ${issue.message}`),
                issue.path ? h("p", { class: "issue-where" }, issue.path) : null),
            h("div", { class: "issue-actions" }, issue.kp ? h("button", { type: "button", class: "btn small quiet", "data-focus": `goto:${issue.kp}:${issue.code}`, onclick: () => {
                S.touched.add(issue.kp);
                renderDerived();
                const target = byFocus(issue.kp) || app.querySelector(`[data-focus^="${CSS.escape(issue.kp)}."]`) || document.getElementById(`sec-${issue.kp.split(".")[0]}`);
                if (target) { if (!target.matches("input, select, textarea, button, a[href]")) target.setAttribute("tabindex", "-1"); target.focus(); target.scrollIntoView({ block: "center", behavior: "instant" }); }
            } }, "Go to") : null, issue.fix ? fixButton(issue, "btn small", "review-fix") : null)))) : h("p", { class: "summary" }, "No validation issues."),
        h("h3", { class: "files-head" }, `Files to write (${files.length})`),
        files.length ? h("div", { class: "files" }, files.map((file) => h("details", {
            class: "file", open: S.openFiles.has(file.path), ontoggle: (e) => {
                if (e.target.open) S.openFiles.add(file.path);
                else S.openFiles.delete(file.path);
            },
        }, h("summary", { "data-focus": `file:${file.path}` }, h("span", { class: `badge ${file.status}` }, file.status), h("code", { class: "file-path" }, file.path)),
        file.content != null ? h("pre", { class: "code" }, file.content) : file.diff ? h("pre", { class: "code", "aria-label": "File changes" }, file.diff.map((row) =>
            h("span", { class: `d ${row.t}` }, row.t === "gap" ? "…" : `${row.t === "add" ? "+" : row.t === "del" ? "−" : " "} ${row.text}`)))
            : file.kind === "image" ? h("div", { class: "file-image" }, h("img", { src: withToken(file.previewUrl), alt: file.label || "Uploaded image", onerror: (e) => e.target.replaceWith(h("span", null, "Preview unavailable")) }),
                h("p", null, file.label || "Image", h("span", { class: "muted" }, ` · ${formatSize(file.size)}`))) : null))) : h("p", { class: "hint" }, "Fill in the event to preview its files."),
    ];
}

const barSig = () => JSON.stringify([S.creating, S.uploading.size, S.save.state, hasPendingEdits(), S.plan?.counts, S.plan?.ok]);

function buildBar() {
    const errors = S.plan?.counts?.error ?? 0;
    const warnings = S.plan?.counts?.warning ?? 0;
    const status = S.creating ? "Creating event…" : S.uploading.size ? "Wait for image uploads to finish…" : hasPendingEdits() ? "Saving your latest changes…" : errors ? `Fix ${plural(errors, "error")} before creating.` : warnings ? `${plural(warnings, "warning")} to review.` : "Ready to create the event.";
    return [h("p", { class: `bar-status ${errors ? "error" : warnings ? "warning" : "ready"}`, role: "status" }, icon(errors ? "error" : warnings ? "warning" : "check"), status),
        h("div", { class: "bar-actions" }, h("button", { type: "button", class: "btn primary", "data-focus": "create-event", disabled: S.creating || S.uploading.size > 0, onclick: () => void createEvent() }, S.creating ? "Creating…" : "Create event"))];
}

async function createEvent() {
    if (S.creating || S.expired || S.uploading.size) return;
    S.creating = true;
    app.inert = true;
    renderDerived();
    try {
        if (!(await flushSave()) || hasPendingEdits()) return;
        try {
            await api("POST", "/api/create", {});
        } catch (err) {
            if (err.status !== 409 || err.code !== "date_conflict") throw err;
            if (!confirm(`${err.message}\n\nCreate the event on this date anyway?`)) return;
            await api("POST", "/api/create", { acknowledgeConflicts: true });
        }
        await reload();
    } catch (err) {
        if (err.code === "forbidden") return expired();
        if (err.status === 422) {
            S.attempted = true;
            if (err.extra?.plan) adoptPlan(err.extra.plan);
            render();
            announce(err.message, true);
        } else toast(`Couldn't create the event. ${err.message}`);
    } finally {
        S.creating = false;
        app.inert = false;
        renderDerived();
    }
}

function applyFix(kp, code) {
    const issue = (S.plan?.issues ?? []).find((i) => i.kp === kp && i.code === code);
    const fix = issue?.fix;
    if (!fix || S.creating) return;
    if (fix.action === "refresh-calendar") return void refreshCalendar();
    const path = indexPathOf(kp);
    if (!path) return;
    if (fix.action === "set") setAt(S.draft, path, fix.value);
    else if (fix.action === "use-existing") {
        const speaker = getAt(S.draft, path);
        setAt(S.draft, path, { key: speaker.key, mode: "existing", id: fix.speakerId });
    } else return;
    liveUpdate(kp);
    edited(true);
    render();
}

function buildDone() {
    const result = S.lastResult;
    return [buildTop(), h("section", { class: "done" },
        h("h2", { class: "done-title", tabIndex: -1, "data-focus": "done-title" }, icon("check"), `Created “${result.name}”`),
        h("p", null, `${fmtLong(result.date)} · Files are written locally, not committed.`),
        h("ul", { class: "done-files" }, result.files.map((file) => h("li", null, h("span", { class: `badge ${file.status}` }, file.status), h("code", { class: "file-path" }, file.path)))),
        h("div", { class: "done-actions" },
            h("button", { type: "button", class: "btn", onclick: () => { S.dismissed = result.at; render(); focusId("event.name"); } }, "Start another event"),
            h("button", { type: "button", class: "btn primary", disabled: S.asked === result.at || S.asked === "sending" || result.sameWorktree === false, onclick: async () => {
                S.asked = "sending";
                render();
                try {
                    await api("POST", "/api/ask-copilot", {});
                    S.asked = result.at;
                    toast("Asked Copilot to review the files and open a pull request.");
                } catch (err) {
                    S.asked = "";
                    if (err.code === "forbidden") return expired();
                    toast(`Couldn't ask Copilot. ${err.message}`);
                }
                render();
            } }, S.asked === result.at ? "Copilot notified" : S.asked === "sending" ? "Asking Copilot…" : "Ask Copilot to review and open a PR")))];
}

// --- Wiring and boot ------------------------------------------------------------------

function liveUpdate(kp) {
    if (kp === "event.date") {
        S.focusDay = S.draft.event.date;
        syncMonth();
    }
    renderDerived();
}

function expired() {
    S.expired = true;
    source?.close();
    clearTimeout(saveTimer);
    clearTimeout(retryTimer);
    app.inert = false;
    app.removeAttribute("aria-busy");
    app.replaceChildren(h("div", { class: "fail", role: "alert" }, h("h1", null, "Canvas connection expired"), h("p", null, "Reopen the event composer from Copilot to reconnect. Your saved draft is kept.")));
}

function onEdit(e) {
    const control = e.target.closest?.("[data-path]");
    if (!control || S.creating || S.expired) return;
    const kp = control.dataset.focus;
    const path = indexPathOf(kp);
    if (!path) return;
    const value = control.type === "checkbox" ? control.checked : control.value;
    const previous = getAt(S.draft, path);
    if (previous === value) return;
    if (S.uploading.has(kp)) return;
    S.localErrors.delete(kp);
    setAt(S.draft, path, value);
    if (path.endsWith(".photo") || path.endsWith(".logo")) {
        setAt(S.draft, `${path}Upload`, null);
        const preview = app.querySelector(`[data-image-preview="${CSS.escape(kp)}"]`);
        const url = repoUrl(value);
        preview?.replaceChildren(url ? h("img", { src: url, alt: "Image preview", onerror: (e) => e.target.replaceWith(icon("image")) }) : icon("image"));
    }
    if (path.endsWith(".company.name") || /^partners\.\d+\.name$/.test(path)) {
        autofillCompany(path, previous);
        const parent = path.slice(0, -5);
        for (const part of ["link", "logo"]) {
            const control = byFocus(keyPath(`${parent}.${part}`));
            if (control) control.value = getAt(S.draft, `${parent}.${part}`);
        }
    }
    edited();
    liveUpdate(kp);
}
app.addEventListener("input", onEdit);
app.addEventListener("change", onEdit);
app.addEventListener("focusout", (e) => {
    const control = e.target.closest?.("[data-path]");
    if (!control || S.expired) return;
    S.touched.add(control.dataset.focus);
    renderDerived();
    void flushSave();
});
window.addEventListener("online", () => void flushSave());
window.addEventListener("focus", () => void refreshState(true));
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refreshState(true);
});

async function boot() {
    app.setAttribute("aria-busy", "true");
    try {
        adoptState(await api("GET", "/api/state"));
        S.booted = true;
        syncMonth();
        render();
        openEvents();
    } catch (err) {
        if (err.code === "forbidden") return expired();
        app.removeAttribute("aria-busy");
        app.replaceChildren(h("div", { class: "fail", role: "alert" }, h("h1", null, "Couldn't load the event composer"), h("p", null, err.message),
            h("button", { type: "button", class: "btn", onclick: () => void boot() }, "Try again")));
    }
}
void boot();
