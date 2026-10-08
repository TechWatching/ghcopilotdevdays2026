// Reads the site's content files, turns a draft into a validated write plan,
// and applies that plan atomically (rolling back on any failure).

import { constants as fsc, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { parseYaml, quote, scalar, textEntry } from "./yaml-lite.mjs";
import { detectSocialType, formatSize, isHttpUrl, isValidDay, LEGACY_SOCIAL_TYPES, nameKey, slugify, SOCIAL_TYPES } from "./shared.mjs";

export const EVENTS_FILE = "content/meetups/events.yml";
const TALKS_DIR = "content/talks";
const SPEAKERS_DIR = "content/speakers";
const LARGE_IMAGE = 1024 * 1024;

const str = (v) => (v == null ? "" : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => {
    const n = Number(v);
    return v === null || v === "" || !Number.isFinite(n) ? null : n;
};
const leadingNumber = (file) => Number.parseInt(file.split(".")[0], 10);
const maxOf = (values) => values.filter((v) => Number.isFinite(v)).reduce((a, b) => Math.max(a, b), 0);

export function findRepoRoot(starts) {
    for (const start of starts.filter(Boolean)) {
        let dir = resolve(start);
        for (;;) {
            if (existsSync(join(dir, EVENTS_FILE))) return dir;
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    }
    return null;
}

function listYaml(dir) {
    try {
        return readdirSync(dir, { withFileTypes: true })
            .filter((d) => d.isFile() && /\.ya?ml$/i.test(d.name))
            .map((d) => d.name)
            .sort((a, b) => leadingNumber(a) - leadingNumber(b) || a.localeCompare(b));
    } catch {
        return [];
    }
}

function textStyle(text, fallback) {
    if (!text || !text.includes("\n")) return fallback;
    return { eol: text.includes("\r\n") ? "\r\n" : "\n", finalNewline: /\n$/.test(text) };
}

// ---------------------------------------------------------------------------
// Catalog

export function loadCatalog(root) {
    const problems = [];
    const read = (rel) => readFileSync(join(root, ...rel.split("/")), "utf8");

    const eventsText = read(EVENTS_FILE);
    const eventsDoc = parseYaml(eventsText);
    if (!eventsDoc || typeof eventsDoc !== "object" || !Array.isArray(eventsDoc.events)) {
        throw new Error(`${EVENTS_FILE} has no "events:" list`);
    }
    const events = eventsDoc.events.filter((e) => e && typeof e === "object");
    const eventsStyle = textStyle(eventsText, { eol: "\n", finalNewline: true });

    const talks = [];
    let talksStyle = null;
    for (const name of listYaml(join(root, TALKS_DIR))) {
        const file = `${TALKS_DIR}/${name}`;
        try {
            const text = read(file);
            talksStyle ??= textStyle(text, null);
            const data = parseYaml(text) ?? {};
            talks.push({ id: leadingNumber(name), file, title: str(data.title), meetup: num(data.meetup), yamlId: num(data.id) });
        } catch (err) {
            problems.push({ file, message: err.message });
            talks.push({ id: leadingNumber(name), file, title: "", meetup: null, yamlId: null });
        }
    }

    const speakers = [];
    const speakerFileIds = [];
    let speakersStyle = null;
    for (const name of listYaml(join(root, SPEAKERS_DIR))) {
        const file = `${SPEAKERS_DIR}/${name}`;
        const id = leadingNumber(name);
        speakerFileIds.push(id);
        const stem = name.replace(/\.ya?ml$/i, "");
        const dot = stem.indexOf(".");
        try {
            const text = read(file);
            speakersStyle ??= textStyle(text, null);
            const data = parseYaml(text) ?? {};
            const firstname = str(data.firstname).trim();
            const lastname = str(data.lastname).trim();
            const company = data.company && typeof data.company === "object"
                ? { name: str(data.company.name).trim(), link: str(data.company.link).trim(), logo: str(data.company.logo).trim() }
                : null;
            speakers.push({
                id,
                file,
                text,
                slug: str(data.slug).trim() || (dot >= 0 ? stem.slice(dot + 1) : stem),
                firstname,
                lastname,
                name: `${firstname} ${lastname}`.trim(),
                role: str(data.role).trim(),
                photo: str(data.photo).trim(),
                company: company && company.name ? company : null,
                talks: arr(data.talks).map(Number).filter(Number.isFinite),
            });
        } catch (err) {
            problems.push({ file, message: err.message });
        }
    }

    const publicListings = new Map();
    const listPublic = (dir) => {
        if (!publicListings.has(dir)) {
            let names = [];
            try {
                names = readdirSync(join(root, "public", ...dir.split("/").filter(Boolean)), { withFileTypes: true })
                    .filter((d) => d.isFile())
                    .map((d) => d.name);
            } catch {
                names = [];
            }
            publicListings.set(dir, names);
        }
        return publicListings.get(dir);
    };

    // Resolves a site path such as /companies/x.png against public/.
    const lookupPublic = (sitePath) => {
        if (isHttpUrl(sitePath)) return { status: "external" };
        if (!sitePath.startsWith("/") || sitePath.includes("\\") || sitePath.split("/").includes("..")) return { status: "invalid" };
        const rel = sitePath.slice(1);
        const slash = rel.lastIndexOf("/");
        const dir = slash >= 0 ? rel.slice(0, slash) : "";
        const name = rel.slice(slash + 1);
        const names = listPublic(dir);
        if (names.includes(name)) return { status: "ok" };
        const other = names.find((n) => n.toLowerCase() === name.toLowerCase());
        if (other) return { status: "case", actual: `/${dir ? `${dir}/` : ""}${other}` };
        return { status: "missing" };
    };
    const fixCase = (sitePath) => {
        if (!sitePath) return "";
        const found = lookupPublic(sitePath);
        return found.status === "case" ? found.actual : sitePath;
    };

    // Known companies (newest first) from partners and speaker profiles, for autofill.
    const companies = new Map();
    const addCompany = (name, link, logo) => {
        const n = str(name).trim();
        if (!n) return;
        const key = nameKey(n);
        const current = companies.get(key);
        if (!current) companies.set(key, { name: n, link: str(link).trim(), logo: fixCase(str(logo).trim()) });
        else {
            if (!current.link && link) current.link = str(link).trim();
            if (!current.logo && logo) current.logo = fixCase(str(logo).trim());
        }
    };
    for (const e of [...events].reverse()) for (const p of arr(e.partners)) if (p && typeof p === "object") addCompany(p.name, p.link || p.url, p.logo);
    for (const s of [...speakers].reverse()) if (s.company) addCompany(s.company.name, s.company.link, s.company.logo);

    const locations = [];
    for (const e of [...events].reverse()) {
        const loc = str(e.location).trim();
        if (loc && !locations.some((l) => nameKey(l) === nameKey(loc))) locations.push(loc);
    }

    const meetupNumbers = events.map((e) => {
        const m = /meetup\s*n\s*[°ºo]?\s*(\d+)/i.exec(str(e.name));
        return m ? Number(m[1]) : NaN;
    });

    return {
        root,
        problems,
        events: events.map((e) => ({ ...e, id: num(e.id), date: str(e.date).slice(0, 10), name: str(e.name) })),
        eventsText,
        eventsDoc,
        talks,
        speakers,
        speakerById: new Map(speakers.map((s) => [s.id, s])),
        companies: [...companies.values()],
        locations,
        styles: {
            events: eventsStyle,
            talks: talksStyle ?? eventsStyle,
            speakers: speakersStyle ?? eventsStyle,
        },
        next: {
            eventId: maxOf([...events.map((e) => num(e.id)), ...talks.map((t) => t.meetup)]) + 1,
            talkId: maxOf([
                ...talks.map((t) => t.id),
                ...talks.map((t) => t.yamlId),
                ...speakers.flatMap((s) => s.talks),
                ...events.flatMap((e) => arr(e.talks).map(Number)),
            ]) + 1,
            speakerId: maxOf(speakerFileIds) + 1,
            meetupNumber: maxOf(meetupNumbers) + 1,
        },
        listPublic,
        lookupPublic,
        fixCase,
    };
}

// ---------------------------------------------------------------------------
// Plan

function cleanText(value) {
    return str(value)
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/, ""))
        .join("\n")
        .trim();
}

// Builds the full, validated list of file writes for a normalized draft.
// opts.uploads maps staged upload ids to { path, size }; opts.today is YYYY-MM-DD (Paris).
export function computePlan(catalog, draft, opts = {}) {
    const uploads = opts.uploads ?? {};
    const today = opts.today ?? "";
    const issues = [];
    const add = (level, path, code, message, extra) => issues.push({ level, path, code, message, ...(extra ?? {}) });

    for (const p of catalog.problems) add("warning", "repo", "repo-problem", `Couldn't read ${p.file}: ${p.message}`);

    const checkUrl = (path, value, what) => {
        if (value && !isHttpUrl(value)) add("error", path, "invalid-url", `Enter the full ${what}, starting with https://`);
    };

    const images = [];
    const claims = new Map();
    const taken = new Map();
    const takenIn = (dir) => {
        if (!taken.has(dir)) taken.set(dir, new Set(catalog.listPublic(dir).map((n) => n.toLowerCase())));
        return taken.get(dir);
    };
    const claimUpload = (upload, dir, base, path) => {
        const staged = uploads[upload.id];
        if (!staged) {
            add("error", path, "missing-upload", "The uploaded image is no longer available. Upload it again.");
            return "";
        }
        if (claims.has(upload.id)) return claims.get(upload.id);
        const ext = staged.ext || upload.ext;
        const names = takenIn(dir);
        const stem = slugify(base, 60) || "image";
        let name = `${stem}.${ext}`;
        for (let n = 2; names.has(name.toLowerCase()); n++) name = `${stem}-${n}.${ext}`;
        names.add(name.toLowerCase());
        const sitePath = `/${dir}/${name}`;
        claims.set(upload.id, sitePath);
        images.push({
            path: `public/${dir}/${name}`,
            status: "new",
            kind: "image",
            source: staged.path,
            previewUrl: `/staged/${upload.id}.${ext}`,
            size: staged.size,
            label: upload.name ? `from ${upload.name}` : "",
        });
        if (staged.size > LARGE_IMAGE) {
            add("warning", path, "large-image", `This image is ${formatSize(staged.size)}. Compress it under 1 MB to keep the site fast.`);
        }
        return sitePath;
    };
    const checkImagePath = (path, value) => {
        if (!value || isHttpUrl(value)) return value;
        if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
            add("error", path, "path-format", "Use a site path such as /speakers/jane-doe.jpg, or a full https:// link.");
            return value;
        }
        if (!value.startsWith("/")) {
            add("error", path, "path-format", `Start the path with “/”.`, { fix: { label: `Use /${value}`, action: "set", value: `/${value}` } });
            return value;
        }
        const found = catalog.lookupPublic(value);
        if (found.status === "invalid") {
            add("error", path, "path-format", "Use a path inside public/, such as /speakers/jane-doe.jpg.");
        } else if (found.status === "case") {
            add("warning", path, "case-mismatch", `The file is named ${found.actual}. Letter case matters once the site is deployed.`, {
                fix: { label: `Use ${found.actual}`, action: "set", value: found.actual },
            });
        } else if (found.status === "missing") {
            add("warning", path, "missing-file", `There is no file at public${value}. Upload the image or fix the path.`);
        }
        return value;
    };

    // Event -----------------------------------------------------------------
    const eventId = catalog.next.eventId;
    const ev = {
        name: str(draft.event.name).trim(),
        date: str(draft.event.date).trim(),
        url: str(draft.event.url).trim(),
        location: str(draft.event.location).trim(),
        replay: str(draft.event.replay).trim(),
    };
    const dateOk = isValidDay(ev.date);
    if (!ev.name) add("error", "event.name", "required", "Add the event name.");
    else {
        const same = catalog.events.find((e) => nameKey(e.name) === nameKey(ev.name));
        if (same) add("warning", "event.name", "duplicate-name", `The site already has an event named “${same.name}” (#${same.id}).`);
    }
    if (!ev.date) add("error", "event.date", "required", "Pick the event date.");
    else if (!dateOk) add("error", "event.date", "invalid-date", "Use a real date in the format YYYY-MM-DD.");
    else {
        if (today && ev.date < today) add("warning", "event.date", "past-date", "This date is in the past.");
        for (const e of catalog.events.filter((x) => x.date === ev.date)) {
            add("warning", "event.date", "site-clash", `The site already lists “${e.name}” (#${e.id}) on this day.`, { eventId: e.id });
        }
    }
    for (const extra of opts.extraIssues ?? []) issues.push(extra);
    if (!ev.location) add("warning", "event.location", "no-location", "Add the venue so the event card shows where it happens.");
    checkUrl("event.url", ev.url, "event page link");
    checkUrl("event.replay", ev.replay, "replay link");

    // Talks and speakers ----------------------------------------------------
    const talkInfo = {};
    const speakerInfo = {};
    const talkRecords = [];
    const newSpeakers = [];
    const newByKey = new Map();
    const existingUse = new Map();

    if (!draft.talks.length) add("warning", "talks", "no-talks", "No talks yet. Add at least one so the event page has an agenda.");

    draft.talks.forEach((talk, ti) => {
        const base = `talks.${ti}`;
        const id = catalog.next.talkId + ti;
        const title = str(talk.title).trim();
        const abstract = cleanText(talk.abstract);
        const replay = str(talk.replay).trim();
        if (!title) add("error", `${base}.title`, "required", "Add the talk title, or remove this talk.");
        else {
            const same = catalog.talks.find((t) => t.title && nameKey(t.title) === nameKey(title));
            if (same) add("warning", `${base}.title`, "duplicate-talk", `Talk #${same.id} already has this title.`);
        }
        if (!abstract) add("warning", `${base}.abstract`, "no-abstract", "Add an abstract. The event page shows it under the title.");
        checkUrl(`${base}.replay`, replay, "replay link");
        const file = `${TALKS_DIR}/${id}.${slugify(title, 60) || "talk"}.yml`;
        talkInfo[talk.key] = { id, file };
        talkRecords.push({ id, file, title, abstract, replay });
        if (!talk.speakers.length) add("warning", `${base}.speakers`, "no-speakers", "No speakers yet.");

        const onThisTalk = new Set();
        talk.speakers.forEach((s, si) => {
            const sp = `${base}.speakers.${si}`;
            if (s.mode === "existing") {
                const existing = catalog.speakerById.get(s.id);
                if (!existing) {
                    add("error", sp, "missing-speaker", `Speaker #${s.id} no longer exists. Remove it and pick the speaker again.`);
                    return;
                }
                speakerInfo[s.key] = { id: s.id, status: "existing", file: existing.file };
                if (onThisTalk.has(`id:${s.id}`)) {
                    add("warning", sp, "duplicate-speaker", `${existing.name} is already on this talk.`);
                    return;
                }
                onThisTalk.add(`id:${s.id}`);
                if (!existingUse.has(s.id)) existingUse.set(s.id, []);
                existingUse.get(s.id).push(id);
                return;
            }

            const fields = validateNewSpeaker(s, sp);
            if (!fields) return;
            if (fields.conflict) {
                const match = fields.conflict;
                add("error", sp, "existing-speaker", `${match.name} already has a profile (#${match.id}).`, {
                    fix: { label: "Use the existing profile", action: "use-existing", speakerId: match.id },
                });
                speakerInfo[s.key] = { id: match.id, status: "conflict" };
                return;
            }
            let group = newByKey.get(fields.groupKey);
            if (group) {
                speakerInfo[s.key] = { id: group.id, status: "merged", primaryKey: group.key, primaryTalk: group.talkIndex, file: group.file };
                if (onThisTalk.has(`new:${fields.groupKey}`)) {
                    add("warning", sp, "duplicate-speaker", `${fields.firstname} ${fields.lastname} is already on this talk.`);
                    return;
                }
                group.talkIds.push(id);
                mergeSpeaker(group, fields);
            } else {
                const newId = catalog.next.speakerId + newSpeakers.length;
                const slug = fields.slug || `speaker-${newId}`;
                group = {
                    key: s.key,
                    path: sp,
                    talkIndex: ti,
                    id: newId,
                    file: `${SPEAKERS_DIR}/${newId}.${slug}.yml`,
                    slug,
                    firstname: fields.firstname,
                    lastname: fields.lastname,
                    role: "",
                    photo: null,
                    company: { name: "", link: "", logo: null },
                    socials: [],
                    talkIds: [id],
                };
                mergeSpeaker(group, fields);
                newSpeakers.push(group);
                newByKey.set(fields.groupKey, group);
                speakerInfo[s.key] = { id: newId, status: "new", file: group.file, slug };
            }
            onThisTalk.add(`new:${fields.groupKey}`);
        });
    });

    // Images are { value } for typed paths or { upload } for staged files; uploads
    // are only claimed once we know which instance of a speaker provides them.
    function imageSource(upload, value, path) {
        if (upload) return { upload, path };
        const v = checkImagePath(path, str(value).trim());
        return v ? { value: v, path } : null;
    }
    function resolveImage(source, dir, base) {
        if (!source) return "";
        return source.upload ? claimUpload(source.upload, dir, base, source.path) : source.value;
    }

    function validateNewSpeaker(s, sp) {
        const firstname = str(s.firstname).trim();
        const lastname = str(s.lastname).trim();
        if (!firstname) add("error", `${sp}.firstname`, "required", "Add the first name.");
        if (!lastname) add("error", `${sp}.lastname`, "required", "Add the last name.");
        const fullName = `${firstname} ${lastname}`.trim();
        const slug = slugify(fullName);
        const key = nameKey(fullName);
        if (firstname && lastname) {
            const conflict = catalog.speakers.find((x) => (slug && x.slug === slug) || (key && nameKey(x.name) === key));
            if (conflict) return { conflict };
        }
        const photo = imageSource(s.photoUpload, s.photo, `${sp}.photo`);
        const company = {
            name: str(s.company?.name).trim(),
            link: str(s.company?.link).trim(),
            logo: imageSource(s.company?.logoUpload, s.company?.logo, `${sp}.company.logo`),
        };
        checkUrl(`${sp}.company.link`, company.link, "company link");
        if (!company.name && (company.link || company.logo)) {
            add("warning", `${sp}.company.name`, "company-without-name", "Add the company name, or its link and logo will be left out.");
        }
        const socials = [];
        arr(s.socials).forEach((social, k) => {
            const path = `${sp}.socials.${k}`;
            const link = str(social.link).trim();
            if (!link) {
                add("error", `${path}.link`, "required", "Add the profile link, or remove this row.");
                return;
            }
            if (!isHttpUrl(link)) {
                add("error", `${path}.link`, "invalid-url", "Enter the full profile link, starting with https://");
                return;
            }
            let type = str(social.type).trim().toUpperCase();
            if (!type) type = detectSocialType(link) ?? "WEBSITE";
            if (!SOCIAL_TYPES.includes(type) && !LEGACY_SOCIAL_TYPES.includes(type)) {
                add("error", `${path}.type`, "invalid-social", "Pick a network from the list.");
                return;
            }
            socials.push({ type, link });
        });
        if (!firstname || !lastname) return null;
        return { firstname, lastname, slug, groupKey: slug || fullName.toLowerCase(), role: str(s.role).trim(), photo, company, socials };
    }

    function mergeSpeaker(group, fields) {
        if (!group.role) group.role = fields.role;
        if (!group.photo) group.photo = fields.photo;
        if (!group.company.name && fields.company.name) group.company = { ...fields.company };
        else if (nameKey(group.company.name) === nameKey(fields.company.name)) {
            if (!group.company.link) group.company.link = fields.company.link;
            if (!group.company.logo) group.company.logo = fields.company.logo;
        }
        for (const social of fields.socials) {
            if (!group.socials.some((x) => x.link.replace(/\/+$/, "") === social.link.replace(/\/+$/, ""))) group.socials.push(social);
        }
    }

    for (const g of newSpeakers) {
        if (!g.photo) add("warning", `${g.path}.photo`, "no-photo", "No photo yet. The site will show their initials.");
        g.photo = resolveImage(g.photo, "speakers", g.slug);
        g.company.logo = g.company.name ? resolveImage(g.company.logo, "companies", g.company.name) : "";
    }

    // Partners --------------------------------------------------------------
    const partners = [];
    const partnerKeys = new Set();
    draft.partners.forEach((p, i) => {
        const base = `partners.${i}`;
        const name = str(p.name).trim();
        const link = str(p.link).trim();
        if (!name) add("error", `${base}.name`, "required", "Add the partner name, or remove this partner.");
        checkUrl(`${base}.link`, link, "partner link");
        const logo = p.logoUpload
            ? claimUpload(p.logoUpload, "companies", name || "partner", `${base}.logo`)
            : checkImagePath(`${base}.logo`, str(p.logo).trim());
        if (!name) return;
        if (partnerKeys.has(nameKey(name))) {
            add("warning", `${base}.name`, "duplicate-partner", `${name} is already listed as a partner.`);
            return;
        }
        partnerKeys.add(nameKey(name));
        if (!logo) add("info", `${base}.logo`, "no-logo", "No logo. The site will show the partner name instead.");
        partners.push({ name, ...(link ? { link } : {}), ...(logo ? { logo } : {}) });
    });

    // Files -----------------------------------------------------------------
    const files = [];
    const talkIds = talkRecords.map((t) => t.id);
    const eventObject = {
        id: eventId,
        name: ev.name,
        date: ev.date,
        ...(ev.url ? { url: ev.url } : {}),
        ...(ev.location ? { location: ev.location } : {}),
        talks: talkIds,
        ...(partners.length ? { partners } : {}),
        ...(ev.replay ? { replay: ev.replay } : {}),
    };
    try {
        const content = insertEventBlock(catalog.eventsText, eventObject);
        verifyEventsEdit(catalog.eventsText, content, eventObject);
        files.push({ path: EVENTS_FILE, status: "updated", kind: "event", original: catalog.eventsText, content, label: `add event #${eventId}` });
    } catch (err) {
        add("error", "repo", "events-file", `Couldn't add the event to ${EVENTS_FILE} automatically (${err.message}).`);
    }

    const talksStyle = catalog.styles.talks;
    for (const t of talkRecords) {
        const lines = [`id: ${t.id}`, `title: ${quote(t.title)}`, `meetup: ${eventId}`];
        if (t.abstract) lines.push(...textEntry("abstract", t.abstract));
        if (t.replay) lines.push(`replay: ${scalar(t.replay)}`);
        const content = joinLines(lines, talksStyle);
        const expected = { id: t.id, title: t.title, meetup: eventId, ...(t.abstract ? { abstract: t.abstract } : {}), ...(t.replay ? { replay: t.replay } : {}) };
        verifyGenerated(content, expected, t.file, add);
        files.push({ path: t.file, status: "new", kind: "talk", content, label: t.title ? `talk #${t.id}` : `talk #${t.id} (untitled)` });
    }

    const speakersStyle = catalog.styles.speakers;
    for (const g of newSpeakers) {
        const lines = [`firstname: ${scalar(g.firstname)}`, `lastname: ${scalar(g.lastname)}`, `slug: ${scalar(g.slug)}`];
        if (g.photo) lines.push(`photo: ${scalar(g.photo)}`);
        if (g.role) lines.push(`role: ${scalar(g.role)}`);
        if (g.company.name) {
            lines.push("company:", `    name: ${scalar(g.company.name)}`);
            if (g.company.link) lines.push(`    link: ${scalar(g.company.link)}`);
            if (g.company.logo) lines.push(`    logo: ${scalar(g.company.logo)}`);
        }
        lines.push(`talks: [${g.talkIds.join(", ")}]`);
        if (g.socials.length) {
            lines.push("socials:");
            for (const s of g.socials) lines.push(`    - type: ${s.type}`, `      link: ${scalar(s.link)}`);
        }
        const content = joinLines(lines, speakersStyle);
        const expected = {
            firstname: g.firstname,
            lastname: g.lastname,
            slug: g.slug,
            ...(g.photo ? { photo: g.photo } : {}),
            ...(g.role ? { role: g.role } : {}),
            ...(g.company.name
                ? { company: { name: g.company.name, ...(g.company.link ? { link: g.company.link } : {}), ...(g.company.logo ? { logo: g.company.logo } : {}) } }
                : {}),
            talks: g.talkIds,
            ...(g.socials.length ? { socials: g.socials } : {}),
        };
        verifyGenerated(content, expected, g.file, add);
        files.push({ path: g.file, status: "new", kind: "speaker", content, label: `${g.firstname} ${g.lastname}, speaker #${g.id}` });
    }

    for (const [speakerId, ids] of existingUse) {
        const s = catalog.speakerById.get(speakerId);
        try {
            const content = addTalksToSpeaker(s.text, ids);
            verifySpeakerEdit(s.text, content, ids);
            files.push({ path: s.file, status: "updated", kind: "speaker", original: s.text, content, label: `${s.name}: add talk ${ids.map((x) => `#${x}`).join(", ")}` });
        } catch (err) {
            add("error", "repo", "speaker-file", `Couldn't add the talk to ${s.file} automatically (${err.message}).`);
        }
    }
    files.push(...images);

    for (const f of files) if (f.status === "updated") f.diff = lineDiff(f.original, f.content);

    const counts = { error: 0, warning: 0, info: 0 };
    for (const issue of issues) counts[issue.level] = (counts[issue.level] ?? 0) + 1;
    return {
        ok: counts.error === 0,
        counts,
        issues,
        event: { id: eventId, name: ev.name, date: dateOk ? ev.date : "" },
        talks: talkInfo,
        speakers: speakerInfo,
        files,
        summary: {
            eventId,
            talkIds,
            newSpeakers: newSpeakers.length,
            updatedSpeakers: existingUse.size,
            images: images.length,
        },
    };
}

function joinLines(lines, style) {
    return lines.join(style.eol) + (style.finalNewline ? style.eol : "");
}

function verifyGenerated(content, expected, file, add) {
    try {
        const parsed = parseYaml(content);
        if (!deepEqual(parsed, expected)) throw new Error("the generated YAML reads back differently");
    } catch (err) {
        add("error", "repo", "generated-yaml", `Generated ${file} is not valid (${err.message}). Please report this.`);
    }
}

export function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((v, k) => deepEqual(v, b[k]));
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

// ---------------------------------------------------------------------------
// Text edits

function splitText(text) {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const finalNewline = /\n$/.test(text);
    const lines = text.split(/\r?\n/);
    if (finalNewline) lines.pop();
    return { eol, finalNewline, lines };
}

const IGNORABLE = /^[ \t]*(?:#.*)?$/;

export function insertEventBlock(text, event) {
    const { eol, finalNewline, lines } = splitText(text);
    const start = lines.findIndex((l) => /^events[ \t]*:[ \t]*(?:#.*)?$/.test(l));
    if (start < 0) throw new Error('no top-level "events:" block list');

    let last = start;
    let itemIndent = null;
    let fieldIndent = null;
    for (let k = start + 1; k < lines.length; k++) {
        const line = lines[k];
        if (IGNORABLE.test(line)) continue;
        if (/^\S/.test(line) && !/^-(?:[ \t]|$)/.test(line)) break;
        last = k;
        const m = /^( *)-( +)\S/.exec(line);
        if (m && itemIndent === null) {
            itemIndent = m[1].length;
            fieldIndent = itemIndent + 1 + m[2].length;
        }
    }
    itemIndent ??= 2;
    fieldIndent ??= itemIndent + 2;

    let partnerItem = fieldIndent + 2;
    let partnerField = partnerItem + 2;
    for (let k = start + 1; k < lines.length - 1; k++) {
        if (new RegExp(`^ {${fieldIndent}}partners[ \\t]*:[ \\t]*$`).test(lines[k])) {
            const m = /^( *)-( +)\S/.exec(lines[k + 1]);
            if (m) {
                partnerItem = m[1].length;
                partnerField = partnerItem + 1 + m[2].length;
                break;
            }
        }
    }

    const pad = (n) => " ".repeat(n);
    const item = `${pad(itemIndent)}-${pad(fieldIndent - itemIndent - 1)}`;
    const field = pad(fieldIndent);
    const block = [`${item}id: ${event.id}`, `${field}name: ${scalar(event.name)}`, `${field}date: ${isValidDay(event.date) ? event.date : scalar(event.date)}`];
    if (event.url) block.push(`${field}url: ${scalar(event.url)}`);
    if (event.location) block.push(`${field}location: ${scalar(event.location)}`);
    block.push(`${field}talks: [${event.talks.join(", ")}]`);
    if (event.partners?.length) {
        block.push(`${field}partners:`);
        const pItem = `${pad(partnerItem)}-${pad(partnerField - partnerItem - 1)}`;
        for (const p of event.partners) {
            block.push(`${pItem}name: ${scalar(p.name)}`);
            if (p.link) block.push(`${pad(partnerField)}link: ${scalar(p.link)}`);
            if (p.logo) block.push(`${pad(partnerField)}logo: ${scalar(p.logo)}`);
        }
    }
    if (event.replay) block.push(`${field}replay: ${scalar(event.replay)}`);

    lines.splice(last + 1, 0, ...block);
    return lines.join(eol) + (finalNewline ? eol : "");
}

function verifyEventsEdit(before, after, event) {
    const a = parseYaml(before);
    const b = parseYaml(after);
    if (!Array.isArray(b?.events) || b.events.length !== a.events.length + 1) throw new Error("the new event did not land in the list");
    if (!deepEqual(b.events.slice(0, -1), a.events)) throw new Error("existing events would change");
    const restA = { ...a, events: null };
    const restB = { ...b, events: null };
    if (!deepEqual(restA, restB)) throw new Error("other keys would change");
    if (!deepEqual(b.events[b.events.length - 1], event)) throw new Error("the new event reads back differently");
}

export function addTalksToSpeaker(text, ids) {
    const { eol, finalNewline, lines } = splitText(text);
    const k = lines.findIndex((l) => /^talks[ \t]*:/.test(l));
    if (k >= 0) {
        const rest = lines[k].replace(/^talks[ \t]*:[ \t]*/, "");
        if (rest.startsWith("[")) {
            const close = rest.indexOf("]");
            if (close < 0) throw new Error("unterminated talks list");
            const inner = rest.slice(1, close);
            const items = inner.split(",").map((s) => s.trim()).filter(Boolean);
            const separator = items.length > 1 && !/,[ \t]/.test(inner) ? "," : ", ";
            lines[k] = `talks: [${[...items, ...ids].join(separator)}]${rest.slice(close + 1)}`;
        } else if (rest === "" || rest.startsWith("#")) {
            let last = k;
            let indent = null;
            for (let j = k + 1; j < lines.length; j++) {
                if (IGNORABLE.test(lines[j])) continue;
                const m = /^( *)-(?:[ \t]|$)/.exec(lines[j]);
                if (m && (indent === null || m[1].length === indent)) {
                    indent = m[1].length;
                    last = j;
                    continue;
                }
                break;
            }
            if (indent === null) lines[k] = `talks: [${ids.join(", ")}]`;
            else lines.splice(last + 1, 0, ...ids.map((id) => `${" ".repeat(indent)}- ${id}`));
        } else {
            throw new Error("unexpected talks format");
        }
    } else {
        const socials = lines.findIndex((l) => /^socials[ \t]*:/.test(l));
        const line = `talks: [${ids.join(", ")}]`;
        if (socials >= 0) lines.splice(socials, 0, line);
        else lines.push(line);
    }
    return lines.join(eol) + (finalNewline ? eol : "");
}

function verifySpeakerEdit(before, after, ids) {
    const a = parseYaml(before) ?? {};
    const b = parseYaml(after) ?? {};
    const expected = [...arr(a.talks).map(Number), ...ids];
    if (!deepEqual(arr(b.talks).map(Number), expected)) throw new Error("the talks list reads back differently");
    if (!deepEqual({ ...a, talks: null }, { ...b, talks: null })) throw new Error("other fields would change");
}

// Small line diff (LCS on the changed middle) rendered as context hunks.
export function lineDiff(before, after, context = 2) {
    const a = before.split(/\r?\n/);
    const b = after.split(/\r?\n/);
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    const am = a.slice(p, a.length - s);
    const bm = b.slice(p, b.length - s);
    // Too large for LCS: show the middle as a plain replacement.
    const small = am.length * bm.length <= 1_000_000;
    const dp = small ? Array.from({ length: am.length + 1 }, () => new Array(bm.length + 1).fill(0)) : null;
    if (small) {
        for (let i = am.length - 1; i >= 0; i--) {
            for (let j = bm.length - 1; j >= 0; j--) {
                dp[i][j] = am[i] === bm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }
    const ops = [];
    for (let k = 0; k < p; k++) ops.push({ t: "ctx", text: a[k] });
    let i = 0;
    let j = 0;
    while (i < am.length || j < bm.length) {
        if (small && i < am.length && j < bm.length && am[i] === bm[j]) {
            ops.push({ t: "ctx", text: am[i] });
            i++;
            j++;
        } else if (i < am.length && (j >= bm.length || !small || dp[i + 1][j] >= dp[i][j + 1])) {
            ops.push({ t: "del", text: am[i++] });
        } else {
            ops.push({ t: "add", text: bm[j++] });
        }
    }
    for (let k = a.length - s; k < a.length; k++) ops.push({ t: "ctx", text: a[k] });

    let oldNo = 0;
    let newNo = 0;
    for (const op of ops) {
        if (op.t !== "add") op.oldNo = ++oldNo;
        if (op.t !== "del") op.newNo = ++newNo;
    }
    const keep = ops.map((op, k) => op.t !== "ctx" || ops.slice(Math.max(0, k - context), k + context + 1).some((x) => x.t !== "ctx"));
    const rows = [];
    ops.forEach((op, k) => {
        if (keep[k]) rows.push(op);
        else if (!rows.length || rows[rows.length - 1].t !== "gap") rows.push({ t: "gap" });
    });
    return rows;
}

// ---------------------------------------------------------------------------
// Apply

function inside(root, rel) {
    const abs = resolve(root, ...rel.split("/"));
    const base = resolve(root) + sep;
    if (!abs.startsWith(base)) throw new Error(`Refusing to write outside the repository: ${rel}`);
    return abs;
}

// Writes images, then new files, then edits; restores everything if any step fails.
export function applyPlan(root, plan) {
    if (!plan.ok) throw new Error("The draft still has errors.");
    const order = { image: 0, talk: 1, speaker: 1, event: 2 };
    const steps = [...plan.files].sort((x, y) => (x.status === "updated") - (y.status === "updated") || order[x.kind] - order[y.kind]);
    const journal = [];
    try {
        for (const f of steps) {
            const abs = inside(root, f.path);
            if (f.status === "new") {
                mkdirSync(dirname(abs), { recursive: true });
                if (f.kind === "image") copyFileSync(f.source, abs, fsc.COPYFILE_EXCL);
                else writeFileSync(abs, f.content, { flag: "wx" });
                journal.push({ abs, created: true });
            } else {
                const current = readFileSync(abs, "utf8");
                if (current !== f.original) throw new Error(`${f.path} changed since the preview was built. Review the plan and try again.`);
                writeFileSync(abs, f.content);
                journal.push({ abs, original: f.original });
            }
        }
    } catch (err) {
        for (const entry of journal.reverse()) {
            try {
                if (entry.created) unlinkSync(entry.abs);
                else writeFileSync(entry.abs, entry.original);
            } catch {
                // Best effort: keep restoring the remaining files.
            }
        }
        if (err && err.code === "EEXIST") {
            throw new Error(`A file with the same name appeared meanwhile (${err.dest ?? err.path ?? "unknown"}). Nothing was written; try again.`);
        }
        throw err;
    }
    return steps.map((f) => ({ path: f.path, status: f.status, kind: f.kind }));
}
