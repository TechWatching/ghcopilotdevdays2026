// Extension: event-composer
// A form canvas to compose a new MTG Bordeaux event (event, talks, speakers,
// partners) and write it into the Nuxt Content files, with a same-day check
// against the La Grappe Numérique community calendar.
//
// Wiring only: the draft lives in lib/composer.mjs, the canvas page is served
// by lib/server.mjs from ui/, and site files are planned in lib/repo.mjs.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { ComposerError, createComposer } from "./lib/composer.mjs";
import { createUiServer } from "./lib/server.mjs";
import { isValidDay, SOCIAL_TYPES } from "./lib/shared.mjs";

const extensionDir = dirname(fileURLToPath(import.meta.url));
let session = null;

// Only problems reach the session timeline; routine activity stays quiet.
function log(message, level = "info") {
    if (level !== "warning" && level !== "error") return;
    session?.log(message, { level }).catch(() => {});
}

// Nothing below touches the disk or the network until the canvas is used.
const composer = createComposer({
    extensionDir,
    log,
    send: async (prompt) => {
        if (!session) throw new ComposerError("not_ready", "The session isn't ready yet. Try again in a moment.", 503);
        await session.send({ prompt });
    },
});
const server = createUiServer({ composer, extensionDir, log });
const seeded = new Set();

function toCanvasError(err) {
    if (err instanceof CanvasError) return err;
    if (err instanceof ComposerError) {
        let message = err.message;
        if (err.code === "validation_failed") {
            const errors = (err.extra?.plan?.issues ?? []).filter((i) => i.level === "error");
            if (errors.length) message += `\n${errors.map((i) => `- ${i.path}: ${i.message}`).join("\n")}`;
        }
        if (err.code === "date_conflict") {
            const lines = (err.extra?.conflicts ?? []).map((e) => {
                const where = e.online ? "online" : [e.venue, e.city].filter(Boolean).join(", ");
                return `- ${[e.time, e.title, where].filter(Boolean).join(" · ")}${e.url ? ` (${e.url})` : ""}`;
            });
            if (lines.length) message += `\n${lines.join("\n")}`;
        }
        return new CanvasError(err.code, message);
    }
    log(`The event composer failed: ${err?.stack ?? err}`, "error");
    return new CanvasError("internal", err?.message || "Something went wrong.");
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const handle = (fn) => async (ctx) => {
    try {
        return await fn(isObject(ctx.input) ? ctx.input : {}, ctx);
    } catch (err) {
        throw toCanvasError(err);
    }
};

// Schemas -------------------------------------------------------------------

const DAY = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const IMAGE = { type: "string", description: "Site path of an image under public/, starting with /, e.g. /speakers/jane-doe.png or /companies/acme.svg, or a full https:// URL. The user can also upload one in the form." };
const URL_TEXT = (description) => ({ type: "string", description });

const companySchema = {
    anyOf: [
        { type: "string", description: "Company name. A company seen at earlier events reuses its link and logo." },
        {
            type: "object",
            properties: { name: { type: "string" }, link: URL_TEXT("Company website."), logo: IMAGE },
            additionalProperties: false,
        },
        { type: "null", description: "Remove the company." },
    ],
};

const socialSchema = {
    anyOf: [
        { type: "string", description: "Profile URL; the network is detected from the link." },
        {
            type: "object",
            properties: {
                type: { type: "string", description: `One of ${SOCIAL_TYPES.join(", ")}. Omit it to detect the network from the link.` },
                link: URL_TEXT("Profile URL."),
            },
            required: ["link"],
            additionalProperties: false,
        },
    ],
};

const speakerSchema = {
    anyOf: [
        { type: "integer", description: "Id of a speaker already on the site." },
        { type: "string", description: "A speaker id such as \"#12\", or a full name. A name that matches an existing speaker reuses that profile." },
        {
            type: "object",
            properties: {
                id: { type: "integer", description: "Id of a speaker already on the site. Send it alone." },
                name: { type: "string", description: "Full name, split into first and last name. Use firstname and lastname instead for compound names." },
                firstname: { type: "string" },
                lastname: { type: "string" },
                role: { type: "string", description: "Job title, e.g. Cloud Architect." },
                company: companySchema,
                photo: IMAGE,
                socials: { type: "array", items: socialSchema },
            },
            additionalProperties: false,
        },
    ],
};

const talkSchema = {
    anyOf: [
        { type: "string", description: "Talk title." },
        {
            type: "object",
            properties: {
                title: { type: "string" },
                abstract: { type: "string", description: "Plain-text description of the talk; line breaks are kept." },
                replay: URL_TEXT("Replay video URL, usually added after the event."),
                speakers: { type: "array", items: speakerSchema, description: "Replaces this talk's speakers." },
            },
            additionalProperties: false,
        },
    ],
};

const partnerSchema = {
    anyOf: [
        { type: "string", description: "Partner name. A partner seen at earlier events reuses its link and logo." },
        {
            type: "object",
            properties: { name: { type: "string" }, link: URL_TEXT("Partner website."), logo: IMAGE },
            required: ["name"],
            additionalProperties: false,
        },
    ],
};

const updateSchema = {
    type: "object",
    properties: {
        reset: { type: "boolean", description: "Start from an empty draft before applying the other fields." },
        event: {
            type: "object",
            properties: {
                name: { type: "string", description: "Event name: \"Meetup n°N\" for regular meetups (get_draft gives the next number), or the name of a special event." },
                date: { ...DAY, description: "Event day, YYYY-MM-DD." },
                url: URL_TEXT("Registration page (Meetup, Luma…)."),
                location: { type: "string", description: "Venue name. get_draft lists the venues used before." },
                replay: URL_TEXT("Replay playlist or video URL, usually added after the event."),
            },
            additionalProperties: false,
        },
        talks: { type: "array", items: talkSchema, description: "The full ordered list of talks." },
        partners: { type: "array", items: partnerSchema, description: "The full list of partners (sponsors and hosts)." },
    },
    additionalProperties: false,
};

// Canvas --------------------------------------------------------------------

const canvas = createCanvas({
    id: "event-composer",
    displayName: "MTG event composer",
    description:
        "Form to create a new MTG Bordeaux event with its talks, speakers and partners in the site content, warning when La Grappe Numérique lists another community event the same day.",
    inputSchema: {
        type: "object",
        properties: { date: { ...DAY, description: "Optional event date to prefill when the draft has none." } },
        additionalProperties: false,
    },
    actions: [
        {
            name: "get_draft",
            description:
                "Read the draft shared with the form: event fields, talks with their speakers, partners, validation issues with suggested fixes, availability of the chosen date on La Grappe Numérique, the next ids, and prefill suggestions from MTG listings on La Grappe. Set includeFiles to also see the YAML each file would get.",
            inputSchema: {
                type: "object",
                properties: { includeFiles: { type: "boolean", description: "Include the planned file contents and diffs." } },
                additionalProperties: false,
            },
            handler: handle((input) => composer.agentView({ includeFiles: input.includeFiles === true })),
        },
        {
            name: "update_draft",
            description:
                "Edit the draft; the open form updates live. Only the keys you send change. event fields are merged one by one. talks and partners replace the whole list, but each item is matched to the current draft (talks by title, or by position when the title is omitted; partners and new speakers by name), so fields you omit and images the user uploaded are kept. Items can be plain strings: a talk title, a partner name, or a speaker name or id. A speaker whose name matches someone already on the site reuses that profile and isn't edited. Returns notes about anything adjusted and the issues left to fix.",
            inputSchema: updateSchema,
            handler: handle((input) => composer.agentUpdate(input)),
        },
        {
            name: "check_date",
            description:
                "Check whether a date is free: lists the other community events La Grappe Numérique (la-grappe-numerique/list-communities) has that day, MTG Bordeaux's own listings, and events already on the site.",
            inputSchema: {
                type: "object",
                properties: { date: { ...DAY, description: "Day to check, YYYY-MM-DD." } },
                required: ["date"],
                additionalProperties: false,
            },
            handler: handle((input) => composer.checkDate(input.date)),
        },
        {
            name: "create_event",
            description:
                "Write the draft into the site (content/events, content/talks, content/speakers, and images under public/), then clear the draft. Nothing is committed to git. Fails with date_conflict when La Grappe Numérique lists another community event that day: tell the user and only retry with acknowledgeConflicts after they confirm the date.",
            inputSchema: {
                type: "object",
                properties: { acknowledgeConflicts: { type: "boolean", description: "The user confirmed the date despite the same-day events." } },
                additionalProperties: false,
            },
            handler: handle((input) => composer.create("agent", { acknowledgeConflicts: input.acknowledgeConflicts === true })),
        },
    ],
    open: handle(async (input, ctx) => {
        const extra = Object.keys(input).filter((k) => k !== "date");
        if (extra.length) throw new CanvasError("invalid_input", `Unknown input ${extra.join(", ")}. Only date is accepted.`);
        if (input.date !== undefined && !isValidDay(input.date)) throw new CanvasError("invalid_input", "date must be a real date in the format YYYY-MM-DD.");
        await composer.ready();
        // open() runs again when the host restores the panel; seed only once.
        if (input.date && !seeded.has(ctx.instanceId)) {
            seeded.add(ctx.instanceId);
            await composer.seedDate(input.date);
        }
        composer.activate();
        const url = await server.acquire(ctx.instanceId);
        return { url, title: "New MTG event", status: composer.statusText() };
    }),
    onClose: (ctx) => {
        seeded.delete(ctx.instanceId);
        if (server.release(ctx.instanceId) === 0) composer.deactivate();
    },
});

session = await joinSession({ canvases: [canvas] });
