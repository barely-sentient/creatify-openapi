/** Source-file templates for the generated server project. */

export function genTsconfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        baseUrl: ".",
        paths: {
          "@api/*": ["src/generated/*"],
          "@api": ["src/generated/index.ts"],
        },
        ignoreDeprecations: "6.0",
      },
    },
    null,
    2
  ) + "\n";
}

export function genSrcIndex(port: number): string {
  return `import { createHttpServer, useCustomHandlers, useEventify, usePermissify } from "serveify-openapi";
import { useAutoCrud } from "autocrudify-openapi";
import type { RequestSessionCtx } from "./context.js";
import { useAjv } from "./plugins/use-ajv.js";
import { useTsify } from "./plugins/use-tsify.js";
import { runEventify } from "./plugins/run-eventify.js";
import { SQLiteAdapter } from "./setup/adapters/sqlite/index.js";
import { jectConfig } from "./setup/conf/ject.shared.js";

// NOTE: this project defaults to SQLite (var/db/app.db) until you supply
// your own persistify adapter. Swap SQLiteAdapter for your Postgres / MySQL /
// Mongo adapter and pass it to useAutoCrud below.
await createHttpServer({
  openApiFilePath: "./openapi/openapi.json",
  httpPort: ${port},
  jectOptions: jectConfig,
  plugins: [
    // First: auto-wire every conventional CRUD route to persistify repositories.
    // Custom handlers registered later win on conflicts (last write wins).
    useAutoCrud({ adapter: new SQLiteAdapter() }),
    useCustomHandlers,
    useEventify(),
    usePermissify,
    useAjv,
  ],
  async buildContext(): Promise<RequestSessionCtx> {
    // TODO: derive this from the request (auth header, session, ...).
    return {
      userId: 12,
      role: "user",
      locale: "en-gb",
      actionPerformedBy: "user",
    };
  },
});
`;
}

export function genContext(): string {
  return `import type { PermissionContext } from "permissify-openapi";

export type RequestSessionCtx = PermissionContext & {
  userId: number;
  role: string;
  locale: string;
};
`;
}

export function genUseAjv(): string {
  return `import Ajv, { type ValidateFunction } from "ajv";
import {
  type EnhancedRequest,
  getRequestSchemaForEndpoint,
  getResponseSchemaForEndpoint,
  type HttpMethod,
  type ServerPlugin,
} from "serveify-openapi";

const ajv = new Ajv({ allErrors: true, coerceTypes: true, strictSchema: false });

// Cache compiled schemas so we don't re-compile on every single request.
const schemaCache = new Map<string, ValidateFunction>();

export const useAjv: ServerPlugin = {
  async beforeRouting() {
    try {
      // @ts-ignore - generated at boot by tsify
      const validationImport = await import("@api/validation");
      if (!validationImport?.useValidator) return;
      const { useValidator } = validationImport;
      useValidator((async (schema: any, object: any) => {
        const validator = ajv.compile(schema);
        const isValid = validator(object);
        if (!isValid) {
          return { status: "failed", errors: validator.errors as [], data: object };
        }
        return { status: "success", errors: [], data: object };
      }) as any);
    } catch {
      // @api not generated yet; tsify runs in this same boot.
    }
  },

  async preRequest(req: EnhancedRequest, _ctx: unknown) {
    const method = req.method.toUpperCase() as HttpMethod;
    const cacheKey = \`\${method}:\${req.route}\`;
    let validate = schemaCache.get(cacheKey);
    if (!validate) {
      const requestSchema = getRequestSchemaForEndpoint(method, req.route);
      if (!requestSchema) return;
      try {
        validate = ajv.compile(requestSchema);
      } catch (error) {
        throw new Error(\`Error validating pre-request schema: \${error}\`);
      }
      schemaCache.set(cacheKey, validate);
    }
    const isValid = validate(req.body);
    if (!isValid) {
      const errorMessage = ajv.errorsText(validate.errors);
      // serveify maps thrown errors via error.status_code (default 500).
      throw Object.assign(new Error(\`[PRE] Validation failed: \${errorMessage}\`), {
        status_code: 400,
        errors: validate.errors,
      });
    }
  },

  // Response mismatches are server-side shape drift (e.g. autocrudify returns
  // raw rows while a spec declares an envelope). Warn loudly but pass the
  // result through - a 200 with a warning beats a 500 on the blessed path.
  // Tighten this to throw once your handlers match the spec envelopes.
  async postRequest(req, _ctx, result) {
    const method = (req as EnhancedRequest).method.toUpperCase() as HttpMethod;
    const route = (req as EnhancedRequest).route;
    const cacheKey = \`response:\${method}:\${route}\`;
    let validate = schemaCache.get(cacheKey);
    if (!validate) {
      const responseSchema = getResponseSchemaForEndpoint(method, route);
      if (!responseSchema) return;
      try {
        validate = ajv.compile(responseSchema);
      } catch (error) {
        throw new Error(\`Error validating post-request schema: \${error}\`);
      }
      schemaCache.set(cacheKey, validate);
    }
    const isValid = validate(result);
    if (!isValid) {
      const errorMessage = ajv.errorsText(validate.errors);
      console.warn(\`[AFTER] Response shape drift on \${route}: \${errorMessage}\`);
    }
  },
};
`;
}

export function genJectShared(): string {
  return `import type { JectOptions } from "json-ject";
import packageJson from "../../../package.json" with { type: "json" };

export const jectConfig: JectOptions = {
  variables: {
    $apiTitle: (packageJson as { name: string }).name,
    $apiVersion: (packageJson as { version: string }).version,
    $contactEmail: ".",
    $authDescription: ".",
  },
};
`;
}

export function genSchemaShared(): string {
  return `export const openApiSchema = "openapi/openapi.json";
`;
}

export function genCodegenScript(): string {
  return `import { eventifyOpenApi } from "eventify-openapi";
import { tsifyOpenApi } from "tsify-openapi";
import { jectConfig } from "../src/setup/conf/ject.shared.js";
import { openApiSchema } from "../src/setup/conf/schema.shared.js";

// openapi.json is king: edit it, then run "npm run codegen".
await tsifyOpenApi({
  jectCfg: jectConfig,
  input: openApiSchema,
  type: "file",
  outDir: "src/generated",
  tsconfigPath: "tsconfig.json",
});

await eventifyOpenApi({
  jectCfg: jectConfig,
  input: openApiSchema,
  type: "file",
  contextType: { name: "RequestSessionCtx", from: "../context.js" },
}).catch((err) => {
  if ((err as Error).message?.includes("No schemas found")) {
    console.log("eventify: no schemas in spec yet - skipping event catalog.");
    return;
  }
  throw err;
});

console.log("codegen done.");
`;
}

export function genHandlerExample(): string {
  return `import { registerEndpointHandler } from "serveify-openapi";

// Example custom handler. Handlers registered here run AFTER autocrudify's
// auto-wired CRUD handlers, so they win on conflicts (last write wins).
// Rename this file to *.handler.ts (e.g. users.handler.ts) to enable it -
// useCustomHandlers auto-imports every src/**/*.handler.ts before routing.
//
// registerEndpointHandler("GET", "/users/{id}", async (req, ctx) => {
//   return { id: req.params.id, name: "Ada" };
// });
`;
}

/**
 * DEV LAX permissions: allow-all for every entity capability so a freshly
 * scaffolded API works out of the box. Tighten these before production -
 * replace allowAll with real predicates (see commented example below).
 */
export function genLaxPermissions(entityNames: string[]): string {
  const imports = entityNames
    .map((n) => `import { ${n}Schema, type ${n} } from "@api/${n.toLowerCase()}";`)
    .join("\n");
  const rules = entityNames
    .map((n) =>
      (["Create", "Read", "Update", "Delete", "List"] as const)
        .map((a) => `permissions(of<${n}>(${n}Schema).${a}, all(allowAll, fields.all()));`)
        .join("\n")
    )
    .join("\n");
  return `import { all, fields, of, permissions, type RulePredicate } from "permissify-openapi";
${imports}

// DEV ONLY: lax allow-all so the API works immediately. Tighten before prod.
export const allowAll: RulePredicate = async () => ({ allowed: true });

${rules || "// No entities in the spec yet - add rules here once codegen produces @api/*."}

// Example of a tightened rule (uncomment + adapt):
// export const isAuthenticated: RulePredicate = async ({ context }) => {
//   const ctx = context as { userId?: unknown };
//   return ctx.userId
//     ? { allowed: true }
//     : { allowed: false, message: "Not authenticated" };
// };
// permissions(of<User>(UserSchema).Read, all(isAuthenticated, fields.all()));
`;
}

export function genGitignore(): string {
  return `node_modules/
dist/
src/generated/
var/db/*.db*
.env
`;
}

export function genProjectReadme(name: string, port: number): string {
  return `# ${name}

Generated with \`creatify-openapi\`. **openapi.json is king**: edit \`openapi/openapi.json\`
(plus \`openapi/blocks/*\`, \`openapi/entities/*\`, \`openapi/paths/*\`), then run:

\`\`\`bash
npm run codegen   # regenerate tsify types/APIs + eventify event catalog
npm start         # boot the serveify-openapi server on :${port}
\`\`\`

> If you're an LLM helping build on this project, stop and read AGENTS.md
> (or CLAUDE.md) instead — it's the full manual: project map, request
> lifecycle, every module, recipes, UI guidance, and the definition of done.

## Where things live

- \`openapi/openapi.json\` - the spec. JECT \`@require\` arrays merge left-to-right.
- \`src/generated/\` - tsify output (\`@api/*\`) + eventify \`*.events.ts\` (regenerated, do not hand-edit).
- \`src/handlers/*.handler.ts\` - your endpoint overrides (auto-loaded, win over autocrudify).
- \`src/permissions/*.permissions.ts\` - permissify rules (auto-loaded).
  \`lax.permissions.ts\` ships DEV allow-all per entity - tighten before prod.
- \`src/**/*.events.ts\` consumers - attach domain logic via \`Events.X.BeforeCreate.addEventListener(...)\`.
- \`src/setup/adapters/sqlite/\` - default SQLite persistify adapter
  (defaults to SQLite until you supply your own adapter).

## Stack

serveify-openapi (HTTP) + autocrudify-openapi (CRUD wiring) + persistify-openapi
(validation/permissions/events/persistence) + permissify-openapi + eventify-openapi
+ tsify-openapi + json-ject + ajv.
`;
}
