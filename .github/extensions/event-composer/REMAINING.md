# Event composer: remaining work

The MTG event composer canvas (`.github/extensions/event-composer/`) lets an organizer fill in a form to create a new event, with its talks, speakers and partners, in `content/`. It warns when La Grappe Numérique (la-grappe-numerique/list-communities) lists another community event on the same day.

## Done and tested

- `lib/yaml-lite.mjs`, `lib/shared.mjs`, `lib/repo.mjs`, `lib/fsutil.mjs`, `lib/calendar.mjs`, `lib/composer.mjs`, `lib/server.mjs`
- `extension.mjs`: registers the `event-composer` canvas (open input `{date}`) and the actions `get_draft`, `update_draft`, `check_date` and `create_event`.
- `ui/index.html` and `ui/app.css` (almost complete)
- `ui/app.js` up to the `// @@CONTINUE@@` marker:
  - helpers, state `S`, saving loop, SSE, render core, inline messages
  - top bar and La Grappe prefill
  - `field()`, event section, availability panel with the month calendar

## Goal: the smallest version that works

`ui/app.js` calls functions that don't exist yet, so the page fails at runtime. Replace the `// @@CONTINUE@@` marker with the missing pieces.

### 1. Talks and speakers

- `buildTalks()`: `section#sec-talks`, a list of talks with title, abstract and replay, plus Add, Remove and Move buttons.
- Speakers per talk:
  - Pick an existing speaker with a `<select>` built from `S.catalog.speakers`; this adds `{key, mode:"existing", id}`.
  - Or add a new speaker `{key, mode:"new", firstname, lastname, role, photo:"", photoUpload:null, company:{name, link, logo:"", logoUpload:null}, socials:[]}`.
  - Text fields for the new speaker's details. Photo and logo can be plain path fields at first (`/speakers/x.jpg`, `/companies/x.png`).
- `paintStatuses()`: can be a no-op at first.

### 2. Partners

- `buildPartners()`: name, link and logo path for each partner, with Add and Remove buttons.

### 3. Review and action bar

- `reviewSig()`/`buildReview()`: the list of `S.plan.issues` and the list of `S.plan.files` (paths, with content inside `<details>`).
- `barSig()`/`buildBar()`: a status line and a "Create event" button.
  - The button calls `flushSave()`, then `POST /api/create`.
  - On 409 `date_conflict`: `confirm()`, then retry with `{acknowledgeConflicts:true}`.
  - On 422: set `S.attempted = true`, adopt `err.extra.plan`, and render.
  - On success: call `reload()`.
- `applyFix(kp, code)`:
  - `set` → `setAt(indexPathOf(kp), value)`
  - `use-existing` → replace the speaker with `{key, mode:"existing", id}`
  - `refresh-calendar` → `refreshCalendar()`
  - then `edited(true)` and `render()`.

### 4. Done view, wiring and boot

- `buildDone()` must return an array. It shows the created files, a "Start another event" button (sets `S.dismissed`) and an "Ask Copilot to review and open a PR" button (`POST /api/ask-copilot`).
- `liveUpdate(kp)`: on `event.date`, set `S.focusDay` and call `syncMonth()`; always call `renderDerived()`.
- `expired()`: set `S.expired`, close `source`, and show a `.fail` message.
- Delegated listeners on `app`:
  - `input`/`change` on `[data-path]` → `setAt(S.draft, path, value)`, `liveUpdate`, `edited()`
  - `focusout` → `S.touched.add(kp)`, `flushSave()`
- `boot()`: `GET /api/state` → `adoptState`, set `S.booted`, `syncMonth()`, `render()`, `openEvents()`. Then remove the marker.

### 5. Check

- `node --check` on a `.mjs` copy of `ui/app.js`.
- Run `extensions_reload`, then `open_canvas({canvasId:"event-composer"})`.
- Run `check_date` on 2026-10-15; expect the conflict with "MEETUP #6 - BDX Testing Community".
- Create a throwaway event, check the files, then revert `content/` and `public/`.

## Later (nice to have)

- Speaker combobox with search instead of a `<select>`, and "New speaker…" that prefills the name.
- Image uploads (`POST /api/upload?name=`, raw body, 5 MB at most) with drag and drop, preview, and `photoUpload`/`logoUpload` refs.
- Socials editor (an auto-detect type plus `SOCIAL_TYPES`).
- Partner autofill from `S.catalog.companies`.
- Undo toasts for removals, move with focus management, and speaker statuses (new, existing, merged).
- Review: "Go to" buttons and diff rendering for updated files (`diff` rows `{t: ctx|add|del|gap, text}`).
- CSS tweaks: `.cal-head h4`, `.avail :is(h3, h4)`, `.btn[aria-disabled="true"]`, `.verdict.loading`.
- Impeccable detector pass on `ui/`, then a visual check at desktop and narrow widths.

## Reference

- Session tests (outside the repo): `~/.copilot/session-state/5fff4787-3914-47fa-aeb0-dea19048103e/files/tests/*.test.mjs`. Run them with `node <test> <repoRoot>`.
- Server API: `GET /api/state`, `PUT /api/draft {draft, baseRev}`, `GET /api/calendar?from&to`, `POST /api/calendar/refresh`, `POST /api/upload`, `POST /api/create`, `POST /api/reset`, `POST /api/ask-copilot`.
  - Send the headers `x-composer-token` and `x-composer-client`; `api()` in `app.js` already handles them.
