import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { OPENAPI_ROOT_FILE } from "./openapi-root.js";

export type MigratifyResult = { imported: boolean };

function runMigratify(openapiDir: string, force: boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    // Run with cwd=openapiDir and --out . so migratify writes
    // openapi.json + entities/ + paths/ into the openapi dir.
    // stdio is inherited so migratify's own engine/connection prompts work.
    const args = ["-y", "migratify-openapi", "--out", "."];
    if (force) args.push("--force");
    const child = spawn("npx", args, { cwd: openapiDir, stdio: "inherit", shell: true });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * Step 1: optionally import an existing database via migratify-openapi
 * (spawned as a subprocess so creatify stays free of DB drivers).
 * Returns true when an openapi.json root now exists in openapiDir.
 */
export async function migratifyStep(openapiDir: string, force: boolean): Promise<MigratifyResult> {
  await fs.mkdir(openapiDir, { recursive: true });
  console.log("");
  console.log("Running migratify-openapi inside ./openapi ...");
  const code = await runMigratify(openapiDir, force);
  if (code !== 0) {
    throw new Error(`migratify-openapi exited with code ${code}.`);
  }
  try {
    await fs.access(path.join(openapiDir, OPENAPI_ROOT_FILE));
    return { imported: true };
  } catch {
    console.log("migratify wrote no openapi.json (empty database?). Continuing with a base spec.");
    return { imported: false };
  }
}
