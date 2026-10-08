// Small file helpers: atomic JSON writes that tolerate Windows file locks.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function writeFileAtomic(file, data) {
    await mkdir(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(temp, data);
    for (let attempt = 0; ; attempt++) {
        try {
            await rename(temp, file);
            return;
        } catch (err) {
            // Another process may briefly hold the target open (EPERM/EBUSY on Windows).
            if (attempt >= 8 || !["EPERM", "EBUSY", "EACCES"].includes(err.code)) {
                await unlink(temp).catch(() => {});
                throw err;
            }
            await sleep(25 * (attempt + 1));
        }
    }
}

export async function readJson(file) {
    try {
        return JSON.parse(await readFile(file, "utf8"));
    } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
    }
}
