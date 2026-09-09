# Agent guide (CLAUDE.md) — building apps with creatify-openapi

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

### IMPORTANT: `web/*` applications are NOT separate Node projects

A project may have multiple applications:

```text
web/
  frontend/
  admin/
  customer/
  b2b/
```

These are all part of the **same root project**.

Do NOT create a `package.json`, `node_modules`, or independently managed Node
project inside every `web/<app>` directory unless the user explicitly asks for
that architecture.

UIs should share the root project's:

* dependencies
* TypeScript configuration
* build tooling
* framework dependencies
* generated API clients
* generated API types
* generated schemas
* validation infrastructure

This is intentional. A customer area, frontend, admin area and B2B area will
often use the same framework and tooling.

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

The UI applications can have independent entry points, components and visual
designs while still sharing the root project's dependency and tooling setup.

### API generation ownership

**`tsify-openapi` owns API generation.**

It generates the TypeScript API surface from the OpenAPI specification,
including:

* entity types
* entity schemas
* API request functions
* validation infrastructure
* generated exports

The generated API functions are already suitable for browser use.

**Do NOT generate another API client.**

**Do NOT recreate the API functions with `fetch`, Axios, or another HTTP
library when a generated function already exists.**

**Do NOT create duplicate entity interfaces or OpenAPI schemas in the UI.**

When a UI needs API functionality, reuse what `tsify-openapi` generated.

The UI is responsible for **rendering and user interaction**, not for
reimplementing the API layer.

Golden workflow:

**edit spec → `npm run codegen` → write backend logic → `npm start` →
test with curl → build UI using the generated API clients and validation**

---

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

6. **The UI?** How many applications under `web/`, and which framework/style
   approach should they use?

   UIs are part of the root project. Do NOT create a separate Node package for
   each UI.

   Default suggestion: one React application bundled with esbuild + sass.
   Multiple React applications under `web/` are fine when the product needs
   separate areas.

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

Enable AJV in every UI entry point and use the shared validation infrastructure
rather than creating a second validation system.

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

* **`tsify-openapi`** — **THE API CLIENT, TYPE AND SCHEMA GENERATOR.**

  Spec → generated entity modules containing `Type`, `Schema` and API
  functions, plus validation infrastructure and generated indexes.

  It also patches tsconfig `@api/*` paths.

  It re-runs on every boot and via `npm run codegen`.

  **This is the single source of truth for the TypeScript API surface.**

  Both server and browser code should reuse its generated output.

  If the UI needs to call an existing endpoint, import the generated API
  function from `@api/*`.

  If the UI needs an endpoint that does not exist, change the OpenAPI
  specification and regenerate. Do NOT work around the missing endpoint by
  implementing ad-hoc API logic in the browser.

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

The generated TypeScript type, schema and API functions are then available to
both server and browser code.

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

### The UI does not own the API layer

A UI should:

1. import the generated API function
2. call it
3. receive typed data
4. render the result
5. manage local UI state
6. display loading/error/empty states
7. collect user input
8. use the generated validation infrastructure

The UI should NOT:

* regenerate API clients
* create duplicate entity types
* duplicate OpenAPI schemas
* recreate generated request functions
* manually construct HTTP requests when a generated API function exists
* contain database logic
* contain persistence logic
* contain server-side permissions
* contain server-side business rules
* contain domain event processing
* introduce a separate validation schema for an existing OpenAPI model
* create an `api.ts` abstraction merely to wrap the generated API clients

The OpenAPI specification and `tsify-openapi` are the source of truth.

### Generated API clients

`tsify-openapi` generates plain browser-compatible API functions.

**Reuse these directly.**

Import the generated API surface from `@api/*` and call those functions from
the UI.

For example, conceptually:

```text
OpenAPI specification
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
                ▼
          UI rendering
```

If the UI needs functionality that is not represented by a generated API
function, the correct solution is normally to update the OpenAPI contract,
regenerate, implement the backend capability, and then consume the generated
function.

### Client-side AJV

**Every UI must enable AJV in its `index.tsx` entry point.**

The backend already uses AJV. The UI should use the same generated validation
infrastructure so validation occurs consistently on both sides of the API
boundary.

Do not introduce a second validation library when AJV and the project's
generated validation infrastructure already provide the required behaviour.

### `useValidator`

Use `useValidator` for client-side validation.

`useValidator` applies the generated OpenAPI validation contract and is designed
to work across client and server code.

This means validation follows the same source of truth:

```text
              OpenAPI schema
                    │
                    ▼
              tsify-openapi
                    │
             generated schema
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
      Server AJV           Client AJV
          │                   │
          ▼                   ▼
    API validation        UI validation
```

Do not manually duplicate the same validation rules in React components or
create parallel schemas for entities already represented by the OpenAPI
contract.

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

These applications may have different layouts, routes and components, but
they share the root project's dependencies, tooling, generated API surface and
validation infrastructure.

### UI build tooling

**Default recommendation: React + esbuild + sass.**

This is a recommendation, not a requirement.

The user may choose React, Vue, plain JavaScript, Tailwind, plain CSS or
another framework/tooling approach.

Whatever stack is selected, integrate it with the root project.

Do NOT create an independent package for each UI merely because there are
multiple UI areas.

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

The UI should consume the verified API response shape rather than inventing or
assuming a different one.

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

8. **`web/*` is not a collection of independent Node packages.** Do not add
   per-UI `package.json` files or dependency trees unless explicitly requested.

9. **`tsify-openapi` already generates the API clients.** Do not regenerate,
   duplicate or wrap them unnecessarily.

10. **AJV must be enabled in every UI entry point.** Use the project's existing
    generated validation infrastructure and `useValidator`.

11. **UI code is presentation/application code, not backend code.** Business
    logic, persistence, permissions and domain events belong on the server.

---

## 8. Frontend guidance

Multiple UIs can bolt onto one API — that's the point of `web/`.

However, each UI is **not an independent Node package**.

The correct mental model is:

```text
Root project
│
├── package.json
├── tsconfig.json
├── node_modules/
├── src/
│   └── generated/
│
└── web/
    ├── frontend/
    ├── admin/
    ├── customer/
    └── b2b/
```

All UI applications use the root project's dependencies and configuration.

### Suggested layout

```text
web/<app>/

  src/
    index.tsx
    components/
    styles/

  static/
    index.html
    app.js
    app.css
```

Do NOT add:

```text
web/frontend/package.json
web/admin/package.json
web/customer/package.json
```

unless the user explicitly asks for separate package boundaries.

### UI responsibilities

UI code is responsible for:

* rendering
* layout
* styling
* user interaction
* local UI state
* loading/error/empty states
* form presentation
* calling generated API functions
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

**do not implement a workaround in the UI.**

Instead:

1. update the OpenAPI specification
2. run codegen
3. implement any required backend logic
4. verify the endpoint
5. consume the newly generated API function from the UI

### Validation responsibility

Validation derives from the OpenAPI contract.

Every UI entry point must enable AJV in `index.tsx` and use `useValidator`
for client-side validation.

The backend performs the corresponding server-side validation.

The result is:

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

* [ ] Every `web/<app>` builds successfully.

* [ ] Every UI consumes the generated `tsify-openapi` API functions.

* [ ] No duplicate API client, API wrapper or generated TypeScript API layer
  has been created unnecessarily.

* [ ] No unnecessary `package.json` or independent Node project has been
  created inside `web/*`.

* [ ] Every UI entry point enables AJV.

* [ ] Every UI uses `useValidator` / generated validation infrastructure where
  validation is required.

* [ ] No duplicate OpenAPI entity types or validation schemas have been
  introduced into the UI.

* [ ] UIs talk to the verified endpoints; no hardcoded mock API data is left
  in the finished application.

* [ ] No server/business logic has leaked into UI components.

* [ ] Summarize for the user: what was built, exact commands to run it, what
  you left as TODO (permissions? adapter swap? envelope wrappers?).
