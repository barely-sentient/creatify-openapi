import * as fs from "node:fs/promises";
import * as path from "node:path";

export const OPENAPI_ROOT_FILE = "openapi.json";

/** Read+parse a JSON file. */
export async function readJson(filePath: string): Promise<any> {
  return JSON.parse(await fs.readFile(filePath, "utf-8"));
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively rebase every `@require` string that looks like a relative path
 * so it resolves from the project root instead of the openapi/ dir.
 * e.g. "./paths/users.json" -> "./openapi/paths/users.json".
 */
export function rebaseRequires(node: unknown, prefix: string): unknown {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map((e) => rebaseRequires(e, prefix));
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === "@require") {
      const v = obj["@require"];
      const fix = (s: unknown) =>
        typeof s === "string" && (s.startsWith("./") || s.startsWith("../") || (!s.startsWith("/") && !/^[a-zA-Z]+:\/\//.test(s)))
          ? prefix + s.replace(/^\.\//, "")
          : s;
      return { "@require": Array.isArray(v) ? v.map(fix) : fix(v) };
    }
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, rebaseRequires(v, prefix)])
    );
  }
  return node;
}

function asRequireList(node: unknown): string[] | null {
  if (
    node &&
    typeof node === "object" &&
    !Array.isArray(node) &&
    "@require" in (node as Record<string, unknown>)
  ) {
    const v = (node as Record<string, unknown>)["@require"];
    if (typeof v === "string") return [v];
    if (Array.isArray(v) && v.every((e) => typeof e === "string")) return v as string[];
  }
  return null;
}

/**
 * Normalize a migratify-style root (literal "/path" and "Schema" entries holding
 * single @require nodes) into array-style @require roots so block prefabs can be
 * appended. JECT drops sibling keys when a node holds a directive, so literal
 * entries and a top-level @require array cannot coexist.
 *
 * Literal maps are moved to openapi/paths/_migratify.json and
 * openapi/entities/_migratify.json (requires already rebased to project root).
 */
export async function normalizeMigratifyRoot(
  root: any,
  openapiDir: string,
  requirePrefix: string
): Promise<any> {
  const rebased = rebaseRequires(root, requirePrefix) as any;
  const paths = rebased.paths ?? {};
  const schemas = rebased.components?.schemas ?? {};

  const pathList = asRequireList(paths);
  const schemaList = asRequireList(schemas);

  if (pathList && schemaList) return rebased; // already array-style

  const out: any = { ...rebased };
  const newPathReqs: string[] = [...(pathList ?? [])];
  const newSchemaReqs: string[] = [...(schemaList ?? [])];

  if (!pathList && paths && typeof paths === "object" && Object.keys(paths).length > 0) {
    await fs.mkdir(path.join(openapiDir, "paths"), { recursive: true });
    await fs.writeFile(
      path.join(openapiDir, "paths", "_migratify.json"),
      JSON.stringify(paths, null, 2) + "\n",
      "utf-8"
    );
    newPathReqs.unshift(`${requirePrefix}paths/_migratify.json`);
  }
  if (!schemaList && schemas && typeof schemas === "object" && Object.keys(schemas).length > 0) {
    await fs.mkdir(path.join(openapiDir, "entities"), { recursive: true });
    await fs.writeFile(
      path.join(openapiDir, "entities", "_migratify.json"),
      JSON.stringify(schemas, null, 2) + "\n",
      "utf-8"
    );
    newSchemaReqs.unshift(`${requirePrefix}entities/_migratify.json`);
  }

  out.paths = { "@require": newPathReqs };
  out.components = { ...(out.components ?? {}), schemas: { "@require": newSchemaReqs } };
  return out;
}

/** Append require entries (deduped) to an array-style @require node. */
export function appendRequires(node: any, entries: string[]): any {
  const list = asRequireList(node) ?? [];
  for (const e of entries) {
    if (!list.includes(e)) list.push(e);
  }
  return { "@require": list };
}

/** Minimal base root used when there is no migratify import. */
export function baseRoot(name: string, port: number): any {
  return {
    openapi: "3.1.0",
    info: { title: `${name} API`, version: "1.0.0" },
    servers: [{ url: `http://localhost:${port}` }],
    paths: { "@require": [] },
    components: { schemas: { "@require": [] } },
  };
}

/** Remove empty @require arrays so a block-less spec stays clean. */
export function cleanEmptyRequires(root: any): any {
  if (root.paths && Array.isArray(root.paths["@require"]) && root.paths["@require"].length === 0) {
    root.paths = {};
  }
  const schemas = root.components?.schemas;
  if (schemas && Array.isArray(schemas["@require"]) && schemas["@require"].length === 0) {
    root.components.schemas = {};
  }
  return root;
}

export async function loadRootIfExists(openapiDir: string): Promise<any | null> {
  const p = path.join(openapiDir, OPENAPI_ROOT_FILE);
  if (!(await exists(p))) return null;
  return readJson(p);
}

export async function writeRoot(openapiDir: string, root: any): Promise<void> {
  await fs.mkdir(openapiDir, { recursive: true });
  await fs.writeFile(
    path.join(openapiDir, OPENAPI_ROOT_FILE),
    JSON.stringify(root, null, 2) + "\n",
    "utf-8"
  );
}
