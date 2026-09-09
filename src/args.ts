export type CreatifyArgs = {
  dir: string;
  force: boolean;
  noInstall: boolean;
  noCodegen: boolean;
  yes: boolean;
  port: number | null;
  name: string | null;
  help: boolean;
};

const DEFAULTS: CreatifyArgs = {
  dir: ".",
  force: false,
  noInstall: false,
  noCodegen: false,
  yes: false,
  port: null,
  name: null,
  help: false,
};

export function parseArgs(argv: string[]): CreatifyArgs {
  const args: CreatifyArgs = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    const next = () => argv[++i] ?? "";
    switch (a) {
      case "--force":
      case "-f":
        args.force = true;
        break;
      case "--no-install":
        args.noInstall = true;
        break;
      case "--no-codegen":
        args.noCodegen = true;
        break;
      case "--yes":
      case "-y":
        args.yes = true;
        break;
      case "--port":
      case "-p": {
        const v = parseInt(next(), 10);
        if (!Number.isNaN(v)) args.port = v;
        break;
      }
      case "--name":
      case "-n":
        args.name = next() || null;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (a.startsWith("--port=")) {
          const v = parseInt(a.split("=").slice(1).join("="), 10);
          if (!Number.isNaN(v)) args.port = v;
        } else if (a.startsWith("--name=")) {
          args.name = a.split("=").slice(1).join("=") || null;
        } else if (!a.startsWith("-") && args.dir === ".") {
          args.dir = a;
        }
        break;
    }
  }
  return args;
}

export function printHelp(): void {
  console.log(`creatify-openapi: generate a serveify-openapi server project from an openapi.json (json-ject) spec.

Usage:
  creatify [dir] [--port 3000] [--name my-api] [--force] [--no-install] [--no-codegen] [--yes]

Options:
  --port, -p    HTTP port for the generated server. Prompts if omitted (default 3000).
  --name, -n    Project name. Prompts if omitted (defaults to target folder name).
  --force, -f   Overwrite existing files without asking.
  --no-install  Skip npm install in the generated project.
  --no-codegen  Skip the initial tsify + eventify codegen run.
  --yes, -y     Non-interactive: skip DB import and prefab prompts (base project only).
  --help, -h    Show this help.

Flow:
  1. Optional: import an existing database via migratify-openapi.
  2. Optional: install prefabs from https://github.com/barely-sentient/openapi-blocks.
  3. Scaffolds a server project (serveify + autocrudify + persistify + permissify,
     tsify types, eventify events). openapi.json is king: edit it, run npm run codegen.
`);
}
