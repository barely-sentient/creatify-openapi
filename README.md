# creatify-openapi

Going from "I need an API" to a running server, normally: define routes, write
handlers, add a database layer, validation, permissions, typed clients... days of
boilerplate.

`creatify` flips it around. **You describe your API in one file
(`openapi.json`), and the tool builds the whole server for you** ; routes,
database tables, validation, permissions, typed TypeScript clients, and domain
events. Then you just add your business logic.

```bash
npx creatify ./my-api
```

That's it. Answer two questions, get a running API.

## How it works (the 30-second version)

1. You run `npx creatify ./my-api`.
2. It asks if you have an **existing database** ; say yes and it reads your
   tables and turns them into an API spec automatically.
3. It asks if you want **ready-made building blocks** (users, blog, shop,
   teams...) ; say yes, pick the ones you want, and they're wired in for you,
   dependencies included.
4. It creates your project, installs everything, and generates all the code.

You end up with a server where every standard endpoint (`GET /users`,
`POST /users`, `GET /users/{id}`, ...) **just works** out of the box, saving to
a local database. Your job from there: write the special bits (event listeners
for your domain logic, any custom endpoints, real permission rules).

## Quick start

```bash
# Interactive - answer 2 questions, done (recommended first time)
npx creatify ./my-api

# Or skip the questions entirely
npx creatify ./my-api --yes --name my-api --port 3000

cd my-api
npm start         # http://localhost:3000 - your API is live
```

(`npx creatify-openapi` works too ; same tool, longer name.)

## The two questions, explained

```
Would you like to set up based off an existing database? [y/N]:
```

Say **yes** if you already have a MySQL, Postgres, or MongoDB database. The tool
looks at your tables and builds the API spec from them ; one set of endpoints
per table. You connect with a connection string or by answering host/user/password
prompts.

```
Would you like to use any prefabs from
https://github.com/barely-sentient/openapi-blocks? [y/N]:
```

Say **yes** to browse ready-made API pieces: user accounts, roles, blog posts,
products and orders, comments, teams, payments, and more. Pick by number:

```
Which prefabs would you like to install? (dependencies auto-included)
  1. blog - Blog posts + categories. [entities: Post, ...; requires: users, ...]
  2. shop - Products, orders, reviews. [entities: Product, ...; requires: users, ...]
  3. users - User accounts. [entities: User; requires: roles]
Enter numbers (comma separated, blank = none): 2,3
```

If something you pick needs something else (shop needs users), it's included
automatically. Say **no** twice and you get a blank project to shape yourself.

## Command options

```text
npx creatify [folder] [options]

--port, -p    Which port the server runs on (default 3000)
--name, -n    Project name (defaults to the folder name)
--force, -f   Overwrite existing files without asking
--no-install  Skip npm install (do it yourself later)
--no-codegen  Skip generating code during setup (run npm run codegen later)
--yes, -y     Skip both questions, straight to a blank project
--help, -h    Show help
```

## Your project, tour in 60 seconds

```text
my-api/
  openapi/
    openapi.json          # THE BOSS FILE. Your whole API is described here.
    blocks/<name>/        # building blocks you installed
    entities/ paths/      # from your database, if you imported one
  src/
    generated/            # auto-created code: types, API clients, events.
                          # NEVER edit by hand - it gets overwritten.
    handlers/             # YOUR custom endpoints go here (*.handler.ts).
                          # These beat the automatic ones when they overlap.
    permissions/          # lax.permissions.ts lets everything through while
                          # you develop. Lock it down before going live!
    plugins/              # automatic stuff: code regeneration, validation
    setup/adapters/sqlite # the database driver (SQLite file, zero setup)
  scripts/codegen.ts      # rebuilds src/generated from openapi.json
```

The golden rule: **edit `openapi/openapi.json`, then run `npm run codegen`.**
Everything else follows from the spec.

## Everyday workflow

**Add a field?** Edit the spec, run `npm run codegen`, the TypeScript types update
everywhere.

**Add business logic?** Listen for events ; don't touch `src/generated/`:

```ts
import { Events } from "eventify-openapi";

// Stamp every new user automatically
Events.User.BeforeCreate.addEventListener(async (ctx, user) => {
  return { ...user, createdAt: new Date().toISOString() };
});
```

**Need a custom endpoint?** Drop a file in `src/handlers/`, it loads itself:

```ts
// src/handlers/greet.handler.ts
import { registerEndpointHandler } from "serveify-openapi";

registerEndpointHandler("GET", "/greet/{name}", async (req) => {
  return { hello: req.params.name };
});
```

**Going live?** Two jobs: replace the dev database adapter if you outgrow SQLite,
and replace the allow-all rules in `src/permissions/` with real ones (there's a
commented example in the generated file showing how).

## What's inside

Your project runs on the openapi family, each doing one job:

- **serveify-openapi** ; turns the spec into a real HTTP server
- **autocrudify-openapi** ; gives every standard endpoint a working database
  handler, so `GET/POST /users` works with zero code
- **persistify-openapi** ; every write goes: validate → check permissions →
  run your `Before` hooks → save → run your `After` hooks
- **permissify-openapi** ; who can do what, per entity
- **tsify-openapi** ; TypeScript types + ready-to-call API functions (`UserApi`)
- **eventify-openapi** ; typed events (`BeforeCreate`, `AfterUpdate`, ...) to
  hang your logic on
- **json-ject** ; lets the spec live in many files via `@require` includes
- **Ajv** ; checks requests and responses match the spec

## You need

- Node 18 or newer.
- `git` installed, if you want building blocks.
- Internet, for downloading packages (and for the database/prefab steps).

## Working on creatify itself

```bash
npm install
npm run build   # compiles to dist/
node dist/index.js ./tmp-demo --yes --no-install --no-codegen
```

## License

MIT
