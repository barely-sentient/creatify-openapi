/** File contents for the generated server project. All templates are embedded
 * so the published npx package works from dist/ alone. */

export function genPackageJson(name: string): string {
  return JSON.stringify(
    {
      name,
      type: "module",
      version: "1.0.0",
      scripts: {
        start: "npx tsx src/index.ts",
        codegen: "npx tsx scripts/codegen.ts",
      },
      dependencies: {
        ajv: "^8.20.0",
        "autocrudify-openapi": "^1.0.1",
        "eventify-openapi": "^1.0.3",
        express: "^4.19.2",
        "json-ject": "^1.0.7",
        "permissify-openapi": "^1.0.0",
        "persistify-openapi": "^1.0.0",
        "serveify-openapi": "^1.0.21",
        sqlite3: "^6.0.1",
        "tsify-openapi": "^1.0.2",
        tsx: "^4.23.0",
      },
      devDependencies: {
        "@types/express": "^4.17.21",
        "@types/node": "^22.7.0",
        "@types/sqlite3": "^3.1.11",
        typescript: "^5.6.0",
      },
    },
    null,
    2
  ) + "\n";
}
