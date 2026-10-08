import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createComposer } from "../lib/composer.mjs";
import { createUiServer } from "../lib/server.mjs";
import uiSmoke from "./ui-smoke.js";

const extensionDir = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactsDir = await mkdtemp(join(tmpdir(), "event-composer-smoke-"));
const composer = createComposer({
    extensionDir,
    artifactsDir,
    calendarOptions: { fetchImpl: async () => new Response("[]", { status: 200 }) },
});
const server = createUiServer({ composer, extensionDir });
let browser;

try {
    composer.activate();
    const url = await server.acquire("smoke");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await page.goto(url);
    await page.getByRole("button", { name: "Add talk", exact: true }).waitFor();
    await uiSmoke(page);
    if (pageErrors.length) throw pageErrors[0];
    console.log("Event composer UI smoke test passed.");
} finally {
    await browser?.close();
    composer.deactivate();
    server.close();
    await rm(artifactsDir, { recursive: true, force: true });
}
