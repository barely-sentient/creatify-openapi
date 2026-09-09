# Agent guide (AGENTS.md) — building apps with creatify-openapi

> You are helping a user build a web application on a creatify-openapi project.
>
> This file is your manual. The human README is the short version; THIS file is
> the complete one. Follow it and you can take a user from an idea to a running
> website in one session.

## 1. The big picture (read this first)

A creatify project is a **backend + one or more frontends**, all driven by a
single API description file:

* `openapi/openapi.json` — **THE BOSS FILE.** Describes every entity (data
  shape) and every route. EVERYTHING below is generated or derived from it.

* `src/*` — **server side.** The API. You may add files here (handlers,
  permissions, events, adapters) but NEVER hand-edit `src/generated/`.

* `web/*` — **applications (UIs).** This is where websites and apps live.
  The backend serves JSON; each folder under `web/` is a separate UI/application
  consuming the same project API.

**IMPORTANT: UIs are NOT separate Node projects.**

A project may have multiple applications such as:

```text
web/
  frontend/
  admin/
  customer/
  b2b/
```

but these are all part of the **same root project**.

Do NOT create a `package.json`, `node_modules`, or independently managed Node
project inside every `web/<app>` directory unless the user explicitly asks for
that architecture.

Frontend applications should share the root project's:

* dependencies
* TypeScript configuration
* build tooling
* generated API clients
* generated API types
* validation infrastructure
* common framework dependencies

This is intentional. A customer frontend, admin area and B2B application will
very often use the same framework and tooling.

Suggested structure:

```text
my-api/

  package.json
  tsconfig.json

  openapi/
    openapi.json

  src/
    index.ts
    generated/
    handlers/
    permissions/
    plugins/
    setup/

  web/
    frontend/
      src/
        index.tsx
        components/
        styles/

    admin/
      src/
        index.tsx
        components/
        styles/

    customer/
      src/
        index.tsx
        components/
        styles/

  scripts/
    codegen.ts
```

Each UI may have its own entry point, components and styling, but they remain
part of the root project rather than becoming separate packages.

### The most important ownership rule

The project already has a complete API generation system.

**`tsify-openapi` owns API client generation.**

Do NOT generate another API client, another set of request functions, or another
parallel TypeScript API layer.

After code generation, reuse the generated:

* entity types
* JSON schemas
* API functions
* validation helpers
* generated API exports

The UI should consume these directly.

The UI's responsibility is **rendering and interaction**.

Do not put API implementation, request construction, API schema duplication,
or server/business logic into UI components.

Golden workflow:

**edit spec → `npm run codegen` → write backend logic → `npm start` →
test the API → build UI using the generated API clients and validation**

---

## 2. How to run a session with the user

When the user says "I'm building X with creatify", walk them through these
questions BEFORE writing anything. Small projects can skip steps, but always
cover 1, 2 and 6:

1. **What is it?** One paragraph: what the app does, who uses it.

2. **What are the things?** The entities (nouns): e.g. User, Post, Product,
   Order, Booking. For each: fields, which are required, which are unique.

3. **Starting point?** (a) existing database to import, (b) prefab blocks
   (`users`, `roles`, `blog`, `shop`, `categories`, `comments`, `payments`,
   ... — each auto-pulls its dependencies), or (c) blank spec.

   Combine freely: import DB + add blocks on top.

4. **Custom behavior?** Anything beyond plain CRUD: e.g. "email on signup",
   "stock decreases on order", "slug from title". These become event listeners.

5. **Who can do what?** Auth model per entity (public read? owner-only edit?
   admin-only delete?). Scaffold ships allow-all DEV rules — you MUST replace
   them with real ones before calling anything done.

6. **The UI?** How many applications under `web/`, and which framework/style
   approach should they use?

   UIs are part of the root project. Do not create independent Node packages
   for them.

   Default suggestion: one React application with esbuild + sass, or multiple
   React applications under `web/` when the product needs separate areas.

Then:

1. produce/extend the spec
2. run codegen
3. verify the API with curl
4. build the UI against the verified API
5. verify the UI

**Never build UI API logic against untested endpoints.**

---

## 3. The request lifecycle (what happens when a call arrives)

```text
HTTP request
  → serveify: express.json() parses body, route matched from spec
  → preRequest plugins: Ajv validates req.body against the spec (400 if bad)
  → handler: autocrudify's auto-CRUD, or YOUR *.handler.ts (yours wins ties)
  → persistify pipeline (writes): validate → permissions (403) → Before hooks
      → database adapter → After hooks
  → postRequest plugins: Ajv response check (warns on drift, passes through)
  → 200 + JSON
    (or status_code from any thrown error — see §7 gotchas)
```

Client-side validation uses the same generated OpenAPI validation information.

Use the generated schemas and `useValidator` rather than inventing separate
UI validation schemas where possible.

---

## 4. The modules and how they fit together

* **`serveify-openapi`** — HTTP server. Reads the spec, registers one Express
  route per `method + path`, runs plugin hooks. Key APIs:

  `createHttpServer({ openApiFilePath, httpPort, plugins, buildContext })`,

  `registerEndpointHandler("GET", "/users/{id}", handler)`,

  `useCustomHandlers` (auto-loads `src/**/\*.handler.ts`),

  `useEventify` (auto-loads `src/**/\*.events.ts`),

  `usePermissify` (auto-loads `src/**/\*.permissions.ts`).

  IMPORTANT: plugin order in `src/index.ts` is load-bearing —
  `useAutoCrud` FIRST, custom loaders after (last registered wins conflicts).

* **`autocrudify-openapi`** — `useAutoCrud({ adapter })`. Creates one table per
  entity, wires the 6 conventional routes
  (`GET|POST /things`, `GET|PUT|PATCH|DELETE /things/{id}`). Returns raw
  rows/arrays (`POST` → created row WITH id, `DELETE` → `{success:true}`,
  missing → 404). Nested routes (`/users/{id}/orders`) are NOT auto-wired —
  write handlers for those.

* **`persistify-openapi`** — `repository.configure({adapter})`,
  `setupRepository(schema)`, repo methods
  (`create/getOne/getMany/updateOne/deleteOne`). Runs the
  validate→permissions→Before→save→After pipeline on every write. Throws
  `ValidationFailedError` (400) and `PermissionDeniedError` (403) — both
  carry `status_code`, which serveify turns into the HTTP status.

* **`permissify-openapi`** — rules bound to the SAME schemas tsify generates:

  `permissions(of<User>(UserSchema).Update, all(isAuth, isSelf,
  fields.only(['email'])))`, checked via `checkCapabilities`.

  Combinators: `all/any/not`; field filters:
  `fields.all/only/allExcept`.

  Context `{actionPerformedBy:'system'}` bypasses everything (background jobs).

* **`tsify-openapi`** — **THE API CLIENT AND TYPE GENERATOR.**

  The OpenAPI spec generates the TypeScript API surface, including:

  * entity `Type`s
  * entity `Schema`s
  * API request functions
  * validation information
  * generated exports

  It also patches TypeScript configuration with the `@api/*` paths.

  **Both server and browser code must reuse these generated APIs.**

  NEVER regenerate or duplicate these API clients manually.

  NEVER create a second `fetch` wrapper around the generated clients unless
  there is a genuinely necessary application-specific abstraction.

  If the UI needs to load or mutate data, import and call the generated API
  function from `@api/*`.

* **`eventify-openapi`** — spec → generated entity events and event index:
  6 hooks per entity

  (`BeforeCreate/AfterCreate/BeforeUpdate/AfterUpdate/BeforeDelete/AfterDelete`).

  Listeners run in order, each one's return becomes the next one's input;
  returning `undefined` keeps the payload. Put domain logic here, never in
  generated files (use separate files importing `{ Events }`).

* **`json-ject`** — the spec is modular: `@require` arrays merge files
  left-to-right (dependencies first). Paths in `@require` are relative to the
  PROJECT ROOT (where you run `npm start`), not to the file containing them.

* **`migratify-openapi`** — one-shot DB importer (MySQL/Postgres/MongoDB) that
  writes `openapi.json` + `entities/` + `paths/`. Run via the creatify
  interview, not by hand.

* **`openapi-blocks`** — prefab entities+routes installed under
  `openapi/blocks/<name>/` and referenced from the root. Check
  `block.json → requires` when combining blocks.

---

## 5. Recipes (copy these patterns)

### Add an entity

Add its schema (with `title` + `x-entity` + `x-table`) to
`components.schemas` (inline or a new file under `openapi/` wired via
`@require`), add flat routes `GET|POST /slugs` +
`GET|PUT|PATCH|DELETE /slugs/{id}` mirroring an existing block's
`routes.json`, run codegen, add lax→real permissions, curl-test.

The generated TypeScript type, schema and API functions will then become
available to both server and UI code.

### Add a field

Edit the entity schema, codegen, the table column is added automatically
(existing data untouched), update permissions `fields.*` if needed.

### Custom endpoint

Create `src/handlers/<thing>.handler.ts` calling

`registerEndpointHandler("METHOD", "/path/{param}", async (req, ctx) => ...)`.

`req.params / req.query / req.body` are available. No import needed anywhere —
glob-loaded before routing. It overrides autocrudify on conflict.

### Domain logic

New file (e.g. `src/events/user.events.ts` — any path,
`*.events.ts` is auto-loaded):

`Events.User.BeforeCreate.addEventListener(async (ctx, user) => updatedUser)`.

### Permissions

Edit/add `src/permissions/*.permissions.ts`. Start from the generated
`lax.permissions.ts` (allow-all per entity) and replace `allowAll` with real
predicates + field filters.

Deny-by-default: anything unregistered returns 403.

### Swap the database

Implement `PersistenceAdapter` (see
`src/setup/adapters/sqlite/index.ts` for the full reference) and pass it to
`useAutoCrud({ adapter })`.

Tell the user SQLite is the default until then.

---

## 6. Consuming the API from a UI

This section is especially important.

### The UI does NOT own API logic

A UI should:

1. import the generated API function
2. call it
3. receive typed data
4. render the result
5. display loading/error/empty states
6. collect user input
7. use the generated validation infrastructure

A UI should NOT:

* regenerate API clients
* create duplicate entity types
* duplicate OpenAPI schemas
* manually construct requests that a generated API function already supports
* contain server-side business logic
* contain persistence/database logic
* create a second API abstraction solely to wrap generated clients
* place API implementation inside components

The OpenAPI spec and `tsify-openapi` are the source of truth.

For example, conceptually:

```text
OpenAPI spec
     │
     ▼
tsify-openapi
     │
     ├── Types
     ├── Schemas
     ├── API functions
     └── Validation
          │
          ▼
       web/*
          │
          └── UI renders and interacts with the data
```

### Generated API clients

`tsify-openapi` generates plain browser-compatible API functions.

**Reuse these directly.**

Import the generated API surface from `@api/*` and use those functions from
the UI.

Do not write another API client with `fetch`, Axios, or a custom request layer
when the generated client already provides the required operation.

The generated clients are the intended bridge between the OpenAPI contract and
the browser.

### Client-side AJV validation

The UI must enable AJV.

The backend already uses AJV, and the same validation infrastructure is
available to the browser.

Every UI entry point should enable AJV in its `index.tsx` before rendering the
application, using the project's existing validation setup.

Conceptually:

```text
web/frontend/src/index.tsx
    │
    ├── enable AJV
    │
    └── render application
```

**Do not invent a separate validation library or validation schema for the UI
when the generated OpenAPI validation infrastructure already covers the
requirement.**

### `useValidator`

`useValidator` is the shared validation mechanism.

It applies the generated OpenAPI/AJV validation on both client and server
sides, giving the application consistent validation behaviour across the
boundary.

Use it for UI input/form validation rather than duplicating validation rules
inside components.

This means:

```text
                 OpenAPI schema
                       │
                       ▼
                 tsify-openapi
                       │
              generated schemas
                       │
              ┌────────┴────────┐
              ▼                 ▼
          Server AJV         Client AJV
              │                 │
              ▼                 ▼
         API validation      UI validation
```

The goal is **one contract, one set of generated schemas, validation on both
sides**.

### Multiple UIs

Multiple UIs can consume the same generated API:

```text
                    OpenAPI
                       │
                       ▼
                 tsify-openapi
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
      frontend       admin       customer
          │            │            │
          └────────────┼────────────┘
                       ▼
                     API
```

For example:

```text
web/
  frontend/
    src/
      index.tsx
      components/

  admin/
    src/
      index.tsx
      components/

  customer/
    src/
      index.tsx
      components/
```

They may have different layouts and application-specific components, but they
share the root project's dependencies, TypeScript setup, generated API code
and validation infrastructure.

### UI build tooling

**Default recommendation: React + esbuild + sass.**

This is a recommendation, not a requirement.

The user may choose React, Vue, plain JavaScript, another framework, Tailwind,
plain CSS, or another supported approach.

Whatever stack is selected, keep it integrated with the root project rather
than creating an unnecessary independent Node project for each UI.

### API base URL

Base URLs come from `servers[0].url` in the spec (default
`http://localhost:<port>`).

For browser applications, either call the absolute API URL or, recommended for
local development, proxy `/api` → the API port to avoid CORS
(`serveify` does not set CORS headers).

### Response shapes

Single-resource routes return the row object.

List routes return a raw array.

Delete returns:

```json
{"success": true}
```

Errors are:

```json
{"status": "failed", "message": "..."}
```

with `errors` detail on 400 validation failures.

Block specs may declare envelope shapes such as:

```json
{"data": [], "total": 10}
```

The server currently returns raw rows and logs drift warnings; write a
`.handler.ts` wrapper if the API genuinely needs to return the envelope.

The UI should consume whatever shape the verified API actually returns rather
than assuming an unverified response structure.

---

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

8. **Do not create a separate Node package for each UI.** `web/*` applications
   are part of the root project and should share its dependencies and tooling.

9. **Do not regenerate API clients in the UI.** `tsify-openapi` already
   generates the API functions, types and schemas. Reuse them.

10. **Do not duplicate validation rules in the UI.** Enable AJV in the UI
    entry point and use `useValidator` / generated schemas.

---

## 8. Frontend guidance

`web/*` contains the project's UI applications.

It is a **directory for applications, not a monorepo of independent packages.**

Do not create:

```text
web/frontend/package.json
web/admin/package.json
web/customer/package.json
```

unless the user explicitly requests separate package boundaries.

Prefer:

```text
package.json
tsconfig.json

src/
  ...

web/
  frontend/
    src/
      index.tsx
      components/
      styles/

  admin/
    src/
      index.tsx
      components/
      styles/
```

All applications should use the root project's installed dependencies.

### UI responsibilities

UI code is responsible for:

* rendering
* layout
* styling
* user interaction
* local UI state
* loading/error/empty states
* form presentation
* invoking generated API functions
* displaying validation errors

UI code is NOT responsible for:

* implementing API clients
* duplicating OpenAPI types
* duplicating OpenAPI schemas
* persistence
* database access
* server-side permissions
* server-side business rules
* domain event processing
* recreating generated validation infrastructure

### API responsibility

The API contract lives in:

```text
openapi/openapi.json
```

The generated API surface comes from:

```text
tsify-openapi
```

If a UI needs an API capability that does not exist:

**do not work around the missing API in the UI.**

Instead:

1. update the OpenAPI spec
2. run codegen
3. implement any required backend logic
4. verify the endpoint
5. consume the newly generated API function from the UI

### Validation responsibility

Validation should derive from the OpenAPI contract.

Enable AJV in each UI's `index.tsx` and use `useValidator` for client-side
validation.

The backend performs the corresponding server-side validation.

This provides a consistent contract:

```text
                  OpenAPI
                     │
                     ▼
               tsify-openapi
                     │
            ┌────────┴────────┐
            │                 │
         Server             Browser
            │                 │
          AJV               AJV
            │                 │
            └───────┬─────────┘
                    ▼
             same contract
```

### Development loop

Run the API from the project root:

```bash
npm start
```

Then run/build the desired UI using the root project's tooling.

Proxy API calls to avoid CORS where appropriate.

Because all UIs share the root project, do not introduce another package
installation or dependency tree merely because a second UI is being added.

---

## 9. Definition of done (check before handing over)

* [ ] `npm run codegen` runs clean; `src/generated/` contains one module
  per entity plus `.events.ts` files.

* [ ] `npm start` boots with no errors; startup logs list wired CRUD routes.

* [ ] Curl-proven: list (200, array), create (200, row WITH id), read one,
  update, delete, read-after-delete (404), invalid body (400), no-permission
  call (403 — after replacing lax rules with real ones for at least one
  check).

* [ ] `lax.permissions.ts` replaced or tightened — never ship allow-all
  silently. Say so out loud in your summary.

* [ ] Every UI under `web/*` builds successfully.

* [ ] Every UI uses the generated `tsify-openapi` API functions rather than
  generating or implementing duplicate API clients.

* [ ] No unnecessary `package.json` or independent Node project has been
  created inside `web/*`.

* [ ] Every UI entry point enables AJV.

* [ ] UI validation uses the shared generated validation infrastructure and
  `useValidator` rather than duplicating OpenAPI validation rules.

* [ ] UIs talk to the verified endpoints; no hardcoded mock API data is left
  in the finished application.

* [ ] No server/business logic has leaked into UI components.

* [ ] Summarize for the user: what was built, exact commands to run it, what
  you left as TODO (permissions? adapter swap? envelope wrappers?).
