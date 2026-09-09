import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseFromUri } from "json-ject";
import { genPackageJson } from "./templates-package.js";
import {
  genCodegenScript,
  genContext,
  genGitignore,
  genHandlerExample,
  genJectShared,
  genLaxPermissions,
  genProjectReadme,
  genRunEventify,
  genSchemaShared,
  genSrcIndex,
  genTsconfig,
  genUseAjv,
  genUseTsify,
} from "./templates-src.js";
import { genSqliteAdapter } from "./templates-sqlite.js";

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Schema keys in the fully resolved spec (valid TS identifiers only). */
async function listEntities(targetDir: string, openapiDir: string): Promise<string[]> {
  try {
    const rootPath = path.join(openapiDir, "openapi.json");
    const doc = (await parseFromUri<any>(rootPath, {
      customFileLoader: async (p: string) => {
        const full = path.isAbsolute(p) ? p : path.join(targetDir, p);
        try {
          return JSON.parse(await fs.readFile(full, "utf-8"));
        } catch {
          return undefined;
        }
      },
    })) as any;
    const schemas = doc?.components?.schemas ?? {};
    return Object.keys(schemas).filter((k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k)).sort();
  } catch {
    return [];
  }
}

/**
 * Step 3: scaffold the server project around the openapi/ dir.
 * Never overwrites an existing openapi/openapi.json (migratify/blocks output wins).
 */
export async function scaffoldStep(
  targetDir: string,
  openapiDir: string,
  projectName: string,
  port: number,
  force: boolean
): Promise<void> {
  const write = async (rel: string, content: string, opts?: { overwrite?: boolean }) => {
    const full = path.join(targetDir, rel);
    if (!opts?.overwrite && !force && (await exists(full))) {
      console.log(`  keep ${rel} (exists)`);
      return;
    }
    await writeFile(full, content);
    console.log(`  wrote ${rel}`);
  };

  console.log("Scaffolding server project ...");
  await write("package.json", genPackageJson(projectName));
  await write("tsconfig.json", genTsconfig());
  await write(".gitignore", genGitignore());
  await write("README.md", genProjectReadme(projectName, port));
  await write("src/index.ts", genSrcIndex(port));
  await write("src/context.ts", genContext());
  await write("src/plugins/use-tsify.ts", genUseTsify());
  await write("src/plugins/run-eventify.ts", genRunEventify());
  await write("src/plugins/use-ajv.ts", genUseAjv());
  await write("src/setup/conf/ject.shared.ts", genJectShared());
  await write("src/setup/conf/schema.shared.ts", genSchemaShared());
  await write("src/setup/adapters/sqlite/index.ts", genSqliteAdapter());
  await write("scripts/codegen.ts", genCodegenScript());

  // Lax DEV permissions for every entity in the resolved spec, so the API
  // works out of the box. @require paths in the root are project-root
  // relative, so resolve them against targetDir via a custom loader.
  const entities = await listEntities(targetDir, openapiDir);
  await write("src/permissions/lax.permissions.ts", genLaxPermissions(entities));

  // Handler example: never overwrite real handlers; skip if any handler exists.
  const handlersDir = path.join(targetDir, "src", "handlers");
  let hasHandler = false;
  try {
    const files = await fs.readdir(handlersDir);
    hasHandler = files.some((f) => f.endsWith(".handler.ts"));
  } catch {
    // no handlers dir yet
  }
  if (!hasHandler) {
    await write("src/handlers/example.handler.example.ts", genHandlerExample());
  }

  // openapi.json is king: only the migratify/blocks steps or a fresh base write it.
  const rootPath = path.join(openapiDir, "openapi.json");
  if (!(await exists(rootPath))) {
    throw new Error("openapi/openapi.json is missing - ensureBaseRoot should have created it.");
  }
  console.log("  keep openapi/openapi.json (king)");
}
