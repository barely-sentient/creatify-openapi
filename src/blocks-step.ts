import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { multiselect } from "./prompt.js";
import {
  appendRequires,
  baseRoot,
  cleanEmptyRequires,
  loadRootIfExists,
  normalizeMigratifyRoot,
  readJson,
  writeRoot,
} from "./openapi-root.js";

export const BLOCKS_REPO = "https://github.com/barely-sentient/openapi-blocks";

export type BlockManifest = {
  name: string;
  version?: string;
  description?: string;
  entities?: string[];
  requires?: string[];
  routes?: string[];
};

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyFile(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

/** Topological order: dependencies first (clone of requires closure). */
function orderBlocks(selected: string[], byName: Map<string, BlockManifest>): string[] {
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visit = (name: string) => {
    if (ordered.includes(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Circular block dependency involving "${name}".`);
    }
    visiting.add(name);
    for (const dep of byName.get(name)?.requires ?? []) {
      if (!byName.has(dep)) {
        throw new Error(`Block "${name}" requires unknown block "${dep}".`);
      }
      visit(dep);
    }
    visiting.delete(name);
    ordered.push(name);
  };
  for (const name of selected) visit(name);
  return ordered;
}

/**
 * Step 2: optionally install prefabs from the openapi-blocks repo.
 * Clones the repo, lets the user pick blocks, resolves the requires closure,
 * copies each block's entities.json/routes.json (plus manifest) under
 * openapi/blocks/<name>/, and wires them into the root via JECT @require
 * arrays (left-to-right merge, dependencies first). Validates the final root
 * parses as JSON.
 */
export async function blocksStep(
  targetDir: string,
  openapiDir: string,
  projectName: string,
  port: number,
  nonInteractive: boolean
): Promise<{ installed: string[] }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "creatify-blocks-"));
  try {
    console.log("");
    console.log(`Cloning ${BLOCKS_REPO} ...`);
    const clone = spawnSync("git", ["clone", "--depth", "1", BLOCKS_REPO, tmp], {
      stdio: "inherit",
      shell: true,
    });
    if (clone.status !== 0) {
      throw new Error("git clone failed. Is git installed and the network reachable?");
    }

    const entries = await fs.readdir(tmp, { withFileTypes: true });
    const manifests: BlockManifest[] = [];
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name.startsWith("_")) continue;
      const manifestPath = path.join(tmp, e.name, "block.json");
      if (!(await exists(manifestPath))) continue;
      const m = (await readJson(manifestPath)) as BlockManifest;
      if (!m.name) m.name = e.name;
      manifests.push(m);
    }
    if (manifests.length === 0) {
      throw new Error("No blocks found in the cloned repo (no block.json manifests).");
    }
    manifests.sort((a, b) => a.name.localeCompare(b.name));
    const byName = new Map(manifests.map((m) => [m.name, m]));

    let picked: number[];
    if (nonInteractive) {
      picked = [];
    } else {
      picked = await multiselect(
        "Which prefabs would you like to install? (dependencies auto-included)",
        manifests.map((m) => ({
          name: m.name,
          desc: `${m.description ?? ""} [entities: ${(m.entities ?? []).join(", ") || "none"}; requires: ${(m.requires ?? []).join(", ") || "none"}]`,
        }))
      );
    }
    if (picked.length === 0) return { installed: [] };

    const selected = picked.map((i) => manifests[i]?.name as string);
    const ordered = orderBlocks(selected, byName);
    console.log(`Installing blocks (dependency order): ${ordered.join(", ")}`);

    // Copy block payloads into the project.
    for (const name of ordered) {
      const srcDir = path.join(tmp, name);
      const destDir = path.join(openapiDir, "blocks", name);
      for (const file of ["entities.json", "routes.json", "block.json"]) {
        const src = path.join(srcDir, file);
        if (await exists(src)) await copyFile(src, path.join(destDir, file));
      }
      // Validate each copied payload parses.
      for (const file of ["entities.json", "routes.json"]) {
        await readJson(path.join(destDir, file));
      }
    }

    // Wire into the root. Require paths are project-root-relative because
    // JECT resolves @require relative to the working directory (project root).
    const prefix = "./openapi/";
    let root = await loadRootIfExists(openapiDir);
    if (root) {
      root = await normalizeMigratifyRoot(root, openapiDir, prefix);
    } else {
      root = baseRoot(projectName, port);
    }
    const routeReqs = ordered.map((n) => `${prefix}blocks/${n}/routes.json`);
    const entityReqs = ordered.map((n) => `${prefix}blocks/${n}/entities.json`);
    root.paths = appendRequires(root.paths ?? {}, routeReqs);
    root.components = root.components ?? {};
    root.components.schemas = appendRequires(root.components.schemas ?? {}, entityReqs);

    await writeRoot(openapiDir, root);
    console.log(`Wired ${ordered.length} block(s) into openapi/openapi.json via @require.`);
    void targetDir;
    return { installed: ordered };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Ensure a base root exists when neither migratify nor blocks produced one. */
export async function ensureBaseRoot(
  openapiDir: string,
  projectName: string,
  port: number
): Promise<void> {
  if (await loadRootIfExists(openapiDir)) return;
  await writeRoot(openapiDir, cleanEmptyRequires(baseRoot(projectName, port)));
}
