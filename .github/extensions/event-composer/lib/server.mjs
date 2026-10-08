// Loopback HTTP server for the composer canvas: static UI, JSON API, server-sent
// change events and image previews. Open canvas instances share one server.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { ComposerError, LIMITS } from "./composer.mjs";
import { formatSize } from "./shared.mjs";

const STATIC = {
    "/": ["ui/index.html", "text/html; charset=utf-8"],
    "/index.html": ["ui/index.html", "text/html; charset=utf-8"],
    "/app.js": ["ui/app.js", "text/javascript; charset=utf-8"],
    "/app.css": ["ui/app.css", "text/css; charset=utf-8"],
    "/shared.mjs": ["lib/shared.mjs", "text/javascript; charset=utf-8"],
};
const IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
};
const HTML_CSP =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
const IMAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const BASE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const MAX_JSON = 1024 * 1024;
const CLIENT_ID = /^[A-Za-z0-9_-]{1,40}$/;
const HEARTBEAT_MS = 25 * 1000;

function sendJson(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, { ...BASE_HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(data) });
    res.end(data);
}

const contentType = (req) => String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();

// Reads at most `max` bytes; larger bodies are drained and rejected.
function readBody(req, max, tooLarge) {
    return new Promise((resolve, reject) => {
        const declared = Number(req.headers["content-length"]);
        if (declared > max) {
            req.resume();
            reject(tooLarge(declared));
            return;
        }
        const chunks = [];
        let size = 0;
        let over = false;
        req.on("data", (chunk) => {
            if (over) return;
            size += chunk.length;
            if (size > max) {
                over = true;
                reject(tooLarge(size));
            } else chunks.push(chunk);
        });
        req.on("end", () => {
            if (!over) resolve(Buffer.concat(chunks));
        });
        req.on("error", reject);
    });
}

async function readJsonBody(req) {
    if (contentType(req) !== "application/json") {
        throw new ComposerError("unsupported_media_type", "Send JSON with Content-Type: application/json.", 415);
    }
    const buf = await readBody(req, MAX_JSON, () => new ComposerError("body_too_large", "The request is too large.", 413));
    if (!buf.length) return {};
    let body;
    try {
        body = JSON.parse(buf.toString("utf8"));
    } catch {
        throw new ComposerError("invalid_json", "The request body isn't valid JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ComposerError("invalid_json", "The request body must be a JSON object.");
    return body;
}

export function createUiServer({ composer, extensionDir, log = () => {} }) {
    const token = randomBytes(24).toString("base64url");
    const tokenBuf = Buffer.from(token);
    const holders = new Set();
    const streams = new Set();
    let server = null;
    let starting = null;
    let port = 0;
    let unsubscribe = null;
    let heartbeat = null;

    const validToken = (value) => {
        const given = Buffer.from(String(value ?? ""));
        return given.length === tokenBuf.length && timingSafeEqual(given, tokenBuf);
    };

    function broadcast(event) {
        const frame = `event: changed\ndata: ${JSON.stringify(event)}\n\n`;
        for (const res of streams) res.write(frame);
    }

    async function serveStatic(res, [file, type]) {
        let body;
        try {
            body = await readFile(join(extensionDir, ...file.split("/")));
        } catch {
            throw new ComposerError("not_found", `The canvas file ${file} is missing.`, 404);
        }
        const csp = type.startsWith("text/html") ? { "Content-Security-Policy": HTML_CSP } : {};
        res.writeHead(200, { ...BASE_HEADERS, ...csp, "Content-Type": type, "Content-Length": body.length });
        res.end(body);
    }

    async function serveImage(res, file) {
        const type = file ? IMAGE_TYPES[extname(file).toLowerCase()] : undefined;
        const info = type ? await stat(file).catch(() => null) : null;
        if (!info?.isFile()) throw new ComposerError("not_found", "There is no image at this path.", 404);
        res.writeHead(200, { ...BASE_HEADERS, "Cache-Control": "no-cache", "Content-Security-Policy": IMAGE_CSP, "Content-Type": type, "Content-Length": info.size });
        createReadStream(file)
            .on("error", () => res.destroy())
            .pipe(res);
    }

    function openStream(req, res) {
        res.writeHead(200, { ...BASE_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
        res.write("retry: 2000\n\n");
        streams.add(res);
        req.on("close", () => streams.delete(res));
    }

    async function api(req, res, url) {
        const id = String(req.headers["x-composer-client"] ?? "");
        const origin = CLIENT_ID.test(id) ? `ui:${id}` : "ui";
        switch (`${req.method} ${url.pathname}`) {
            case "GET /api/state":
                return sendJson(res, 200, await composer.getState());
            case "PUT /api/draft": {
                const body = await readJsonBody(req);
                return sendJson(res, 200, await composer.putDraft(body.draft, body.baseRev, origin));
            }
            case "GET /api/calendar":
                return sendJson(res, 200, await composer.calendarRange(url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? ""));
            case "POST /api/calendar/refresh":
                await readJsonBody(req);
                return sendJson(res, 200, await composer.refreshCalendar());
            case "POST /api/upload": {
                if (contentType(req) !== "application/octet-stream") {
                    throw new ComposerError("unsupported_media_type", "Upload the raw file with Content-Type: application/octet-stream.", 415);
                }
                const tooLarge = (size) =>
                    new ComposerError("upload_too_large", `This image is ${formatSize(size)}. Use an image under ${formatSize(LIMITS.upload)}.`, 413);
                const buf = await readBody(req, LIMITS.upload, tooLarge);
                return sendJson(res, 200, await composer.upload(buf, url.searchParams.get("name") ?? ""));
            }
            case "POST /api/create": {
                const body = await readJsonBody(req);
                return sendJson(res, 200, await composer.create(origin, { acknowledgeConflicts: body.acknowledgeConflicts === true }));
            }
            case "POST /api/reset":
                await readJsonBody(req);
                return sendJson(res, 200, await composer.reset(origin));
            case "POST /api/ask-copilot":
                await readJsonBody(req);
                return sendJson(res, 200, await composer.askCopilot());
            default:
                throw new ComposerError("not_found", "Unknown API route.", 404);
        }
    }

    async function handle(req, res) {
        const host = String(req.headers.host ?? "");
        if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new ComposerError("bad_host", "Unexpected Host header.", 421);
        const url = new URL(req.url ?? "/", `http://${host}`);
        const path = url.pathname;
        if (req.method === "GET" && Object.hasOwn(STATIC, path)) return serveStatic(res, STATIC[path]);
        const forbidden = () => new ComposerError("forbidden", "This canvas link has expired. Close the canvas and open it again.", 403);
        if (path.startsWith("/api/")) {
            if (!validToken(req.headers["x-composer-token"])) throw forbidden();
            return api(req, res, url);
        }
        if (req.method !== "GET") throw new ComposerError("not_found", "Not found.", 404);
        if (!validToken(url.searchParams.get("t"))) throw forbidden();
        if (path === "/events") return openStream(req, res);
        if (path.startsWith("/staged/")) return serveImage(res, composer.resolveImage("staged", path.slice("/staged/".length)));
        if (path.startsWith("/repo/")) {
            let rel = "";
            try {
                rel = decodeURIComponent(path.slice("/repo/".length));
            } catch {
                // Malformed escapes fall through to a 404.
            }
            return serveImage(res, composer.resolveImage("repo", rel));
        }
        throw new ComposerError("not_found", "Not found.", 404);
    }

    function fail(res, err) {
        if (res.headersSent) {
            res.destroy();
            return;
        }
        if (err instanceof ComposerError) {
            if (err.status === 413) res.setHeader("Connection", "close");
            sendJson(res, err.status, { error: { code: err.code, message: err.message, ...(err.extra ?? {}) } });
            return;
        }
        log(`A canvas request failed: ${err?.stack ?? err}`, "error");
        sendJson(res, 500, { error: { code: "internal", message: err?.message || "Something went wrong." } });
    }

    function start() {
        if (server) return Promise.resolve();
        starting ??= new Promise((resolve, reject) => {
            const s = createServer((req, res) => {
                handle(req, res).catch((err) => fail(res, err));
            });
            s.once("error", reject);
            s.listen(0, "127.0.0.1", () => {
                s.off("error", reject);
                s.on("error", (err) => log(`The canvas server failed (${err.message}).`, "error"));
                server = s;
                port = s.address().port;
                unsubscribe = composer.subscribe(broadcast);
                heartbeat = setInterval(() => {
                    for (const res of streams) res.write(": ping\n\n");
                }, HEARTBEAT_MS);
                heartbeat.unref();
                resolve();
            });
        }).finally(() => {
            starting = null;
        });
        return starting;
    }

    function stop() {
        unsubscribe?.();
        unsubscribe = null;
        clearInterval(heartbeat);
        heartbeat = null;
        for (const res of streams) res.end();
        streams.clear();
        if (server) {
            server.close();
            server.closeAllConnections();
        }
        server = null;
        port = 0;
    }

    return {
        async acquire(instanceId) {
            holders.add(instanceId);
            await start();
            return `http://127.0.0.1:${port}/?t=${token}`;
        },
        // Returns how many instances still use the server; it stops at zero.
        release(instanceId) {
            holders.delete(instanceId);
            if (!holders.size) {
                if (starting) starting.then(() => holders.size || stop(), () => {});
                else stop();
            }
            return holders.size;
        },
        close: stop,
    };
}
