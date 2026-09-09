# Agent guide (CLAUDE.md) — building apps with creatify-openapi

> You are helping a user build a web application on a creatify-openapi project.
> This file is your manual. The human README is the short version; THIS file is
> the complete one. Follow it and you can take a user from an idea to a running
> website in one session.

## 1. The big picture (read this first)

A creatify project is a **backend + one or more frontends**, all driven by a
single API description file:

- `openapi/openapi.json` — **THE BOSS FILE.** Describes every entity (data
  shape) and every route. EVERYTHING below is generated or derived from it.
- `src/*` — **server side.** The API. You may add files here (handlers,
  permissions, events, adapters) but NEVER hand-edit `src/generated/`.
- `web/*` — **applications (UIs).** This is where websites and apps live. The
  backend team (this project) serves JSON; each folder under `web/` is an
  independent frontend that talks to it over HTTP.

```text
my-api/
  openapi/openapi.json     <- boss file: edit this, run npm run codegen
  src/
    index.ts               <- server boot (don't reorder plugins)
    generated/             <- AUTO-GENERATED types, API clients, events (do not edit)
    handlers/              <- custom endpoints (*.handler.ts, auto-loaded)
    permissions/           <- access rules (*.permissions.ts, auto-loaded)
    plugins/               <- codegen + validation wiring
    setup/                 <- db adapter + shared config
  web/
    frontend/              <- example UI #1 (React, plain JS, whatever - your call)
      static/              <- served files: app.js, app.css (built output + assets)
      src/                 <- UI source: index.tsx, components, styles
    admin/                 <- example UI #2 (optional second app, same API)
  scripts/codegen.ts       <- rebuilds src/generated from the spec
```

Golden workflow: **edit spec → `npm run codegen` → write logic → `npm start`
→ test with curl → build UI against the live API.**

## 2. How to run a session with the user

When the user says "I'm building X with creatify", walk them through these
questions BEFORE writing anything. Small projects can skip steps, but always
cover 1, 2 and 6:

1. **What is it?** One paragraph: what the app does, who uses it.
2. **What are the things?** The entities (nouns): e.g. User, Post, Product,
   Order, Booking. For each: fields, which are required, which are unique.
3. **Starting point?** (a) existing database to import, (b) prefab blocks
   (`users`, `roles`, `blog`, `shop`, `categories`, `comments`,
   `payments`, ... — each auto-pulls its dependencies), or (c) blank spec.
   Combine freely: import DB + add blocks on top.
4. **Custom behavior?** Anything beyond plain CRUD: e.g. "email on signup",
   "stock decreases on order", "slug from title". These become event listeners.
5. **Who can do what?** Auth model per entity (public read? owner-only edit?
   admin-only delete?). Scaffold ships allow-all DEV rules — you MUST replace
   them with real ones before calling anything done.
6. **The UI?** How many apps under `web/`, and each one's stack (see §8).
   Default suggestion: one React app bundled with esbuild + sass; tailwind or
   plain CSS if they prefer. Never force a stack — ask.

Then: produce/extend the spec, run codegen, verify the API with curl, THEN build
the UI against the verified live endpoints. Never build UI against untested
endpoints.

## 3. The request lifecycle (what happens when a call arrives)

```text
HTTP request
  → serveify: express.json() parses body, route matched from spec
  → preRequest plugins: Ajv validates req.body against the spec (400 if bad)
  → handler: autocrudify's auto-CRUD, or YOUR *.handler.ts (yours wins ties)
  → persistify pipeline (writes): validate → permissions (403) → Before hooks
      → database adapter → After hooks
  → postRequest plugins: Ajv response check (warns on drift, passes through)
  → 200 + JSON  (or status_code from any thrown error — see §7 gotchas)
```

## 4. The modules and how they fit together

- **serveify-openapi** — HTTP server. Reads the spec, registers one Express
  route per `method + path`, runs plugin hooks. Key APIs:
  `createHttpServer({ openApiFilePath, httpPort, plugins, buildContext })`,
  `registerEndpointHandler("GET", "/users/{id}", handler)`,
  `useCustomHandlers` (auto-loads `src/**/*.handler.ts`),
  `useEventify` (auto-loads `src/**/*.events.ts`),
  `usePermissify` (auto-loads `src/**/*.permissions.ts`).
  IMPORTANT: plugin order in `src/index.ts` is load-bearing —
  `useAutoCrud` FIRST, custom loaders after (last registered wins conflicts).
- **autocrudify-openapi** — `useAutoCrud({ adapter })`. Creates one table per
  entity, wires the 6 conventional routes
  (`GET|POST /things`, `GET|PUT|PATCH|DELETE /things/{id}`). Returns raw
  rows/arrays (`POST` → created row WITH id, `DELETE` → `{success:true}`,
  missing → 404). Nested routes (`/users/{id}/orders`) are NOT auto-wired —
  write handlers for those.
- **persistify-openapi** — `repository.configure({adapter})`,
  `setupRepository(schema)`, repo methods
  (`create/getOne/getMany/updateOne/deleteOne`). Runs the
  validate→permissions→Before→save→After pipeline on every write. Throws
  `ValidationFailedError` (400) and `PermissionDeniedError` (403) — both
  carry `status_code`, which serveify turns into the HTTP status.
- **permissify-openapi** — rules bound to the SAME schemas tsify generates:
  `permissions(of<User>(UserSchema).Update, all(isAuth, isSelf,
  fields.only(['email'])))`, checked via `checkCapabilities`.
  Combinators: `all/any/not`; field filters: `fields.all/only/allExcept`.
  Context `{actionPerformedBy:'system'}` bypasses everything (background jobs).
- **tsify-openapi** — spec → `src/generated/<entity>.ts` (Type, Schema,
  fetch Api) + `validation.ts` + `index.ts`; patches tsconfig `@api/*`
  paths. Re-runs on every boot AND via `npm run codegen`.
- **eventify-openapi** — spec → `src/generated/<entity>.events.ts` +
  `index.events.ts`: 6 hooks per entity
  (`BeforeCreate/AfterCreate/BeforeUpdate/AfterUpdate/BeforeDelete/AfterDelete`).
  Listeners run in order, each one's return becomes the next one's input;
  returning `undefined` keeps the payload. Put domain logic here, never in
  generated files (use separate files importing `{ Events }`).
- **json-ject** — the spec is modular: `@require` arrays merge files
  left-to-right (dependencies first). Paths in `@require` are relative to the
  PROJECT ROOT (where you run `npm start`), not to the file containing them.
- **migratify-openapi** — one-shot DB importer (MySQL/Postgres/MongoDB) that
  writes `openapi.json` + `entities/` + `paths/`. Run via the creatify
  interview, not by hand.
- **openapi-blocks** — prefab entities+routes installed under
  `openapi/blocks/<name>/` and referenced from the root. Check
  `block.json → requires` when combining blocks.

## 5. Recipes (copy these patterns)

**Add an entity:** add its schema (with `title` + `x-entity` + `x-table`)
to `components.schemas` (inline or a new file under `openapi/` wired via
`@require`), add flat routes `GET|POST /slugs` +
`GET|PUT|PATCH|DELETE /slugs/{id}` mirroring an existing block's
`routes.json`, run codegen, add lax→real permissions, curl-test.

**Add a field:** edit the entity schema, codegen, the table column is added
automatically (existing data untouched), update permissions `fields.*` if
needed.

**Custom endpoint:** create `src/handlers/<thing>.handler.ts` calling
`registerEndpointHandler("METHOD", "/path/{param}", async (req, ctx) => ...)`.
`req.params / req.query / req.body` are available. No import needed anywhere —
glob-loaded before routing. It overrides autocrudify on conflict.

**Domain logic:** new file (e.g. `src/events/user.events.ts` — any path,
`*.events.ts` is auto-loaded):
`Events.User.BeforeCreate.addEventListener(async (ctx, user) => updatedUser)`.

**Permissions:** edit/add `src/permissions/*.permissions.ts`. Start from the
generated `lax.permissions.ts` (allow-all per entity) and replace `allowAll`
with real predicates + field filters. Deny-by-default: anything unregistered
returns 403.

**Swap the database:** implement `PersistenceAdapter` (see
`src/setup/adapters/sqlite/index.ts` for the full reference) and pass it to
`useAutoCrud({ adapter })`. Tell the user SQLite is the default until then.

## 6. Consuming the API from a UI

- Reuse the generated clients: tsify's `<Entity>Api` are plain `fetch`
  wrappers — importable in browser code too.
- Base URLs come from `servers[0].url` in the spec (default
  `http://localhost:<port>`). For browser apps, either call the absolute API
  URL or (recommended for local dev) proxy `/api` → the API port to avoid CORS
  (serveify does not set CORS headers).
- Response shapes: single-resource routes return the row object; list routes
  return a raw array; delete returns `{success:true}`; errors are
  `{status:"failed", message}` (+ `errors` detail on 400s). Block specs may
  declare envelope shapes (`{data, total}`) — the server currently returns raw
  rows and logs drift warnings; write a `.handler.ts` wrapper if the UI wants
  the envelope.

## 7. Gotchas (learn from our scars)

1. `src/generated/` is overwritten on EVERY boot and codegen. Your code lives
   in `handlers/`, `permissions/`, `*.events.ts` (own files), `setup/`.
2. HTTP status comes from `status_code` on thrown errors — plain `status`
   is IGNORED. A throw with no `status_code` returns 200 with a failed body.
3. `lax.permissions.ts` is DEV-ONLY allow-all. Ship it to prod and everyone
   can do everything.
4. Empty spec (no entities): codegen/tsify emit only index+validation, eventify
   skips with a notice. Totally fine — add entities later.
5. JECT: `@require` paths resolve from project root; arrays merge
   left-to-right; a node holding `@require` drops sibling keys (never mix
   literal paths and `@require` at the same level).
6. Entity detection needs `x-entity` (or `title`/`x-table`); file names in
   `@api/` are the lowercased schema keys (`User` → `@api/user`).
7. `src/index.ts` plugin order matters: `useAutoCrud` first, custom handler
   loaders after.

## 8. Frontend guidance (no vendor lock-in)

Multiple UIs can bolt onto one API — that's the point of `web/`. Each app is
independent: own deps, own build, own deploy. Suggested layout per app:

```text
web/<app>/
  package.json        # own deps + scripts (build/dev)
  src/                # source: index.tsx, components/, styles/
  static/             # built output + assets: app.js, app.css, index.html
```

- **Default recommendation (not a requirement): React + esbuild + sass.**
  esbuild is one tiny dependency that bundles TSX and compiles sass-capable
  CSS fast: `esbuild src/index.tsx --bundle --outfile=static/app.js`.
  Recommend it; accept tailwind, plain CSS/JS, Vue, or anything else the user
  prefers — adapt the scaffold to THEIR choice.
- Keep API calls in one place per app (e.g. `src/api.ts` wrapping tsify's
  generated clients or plain fetch against the endpoint table).
- Dev loop: run API (`npm start` at root) + UI dev/build in `web/<app>`;
  proxy API calls to avoid CORS (see §6).
- Never put UI code in `src/` and never server code in `web/`. If the user
  asks for server-rendered pages, that's a custom handler serving HTML — say so
  explicitly rather than blurring the boundary.

## 9. Definition of done (check before handing over)

- [ ] `npm run codegen` runs clean; `src/generated/` contains one module
      per entity plus `.events.ts` files.
- [ ] `npm start` boots with no errors; startup logs list wired CRUD routes.
- [ ] Curl-proven: list (200, array), create (200, row WITH id), read one,
      update, delete, read-after-delete (404), invalid body (400), no-permission
      call (403 — after replacing lax rules with real ones for at least one check).
- [ ] `lax.permissions.ts` replaced or tightened — never ship allow-all
      silently. Say so out loud in your summary.
- [ ] Every `web/<app>` builds (`static/app.js` + CSS exist) and talks to
      the verified endpoints (no hardcoded mock data left in).
- [ ] Summarize for the user: what was built, exact commands to run it, what
      you left as TODO (permissions? adapter swap? envelope wrappers?).
