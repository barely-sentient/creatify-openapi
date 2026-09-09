#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseArgs, printHelp } from "./args.js";
import { blocksStep, ensureBaseRoot } from "./blocks-step.js";
import { migratifyStep } from "./migratify-step.js";
import { ask, confirm } from "./prompt.js";
import { scaffoldStep } from "./scaffold-step.js";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const targetDir = path.resolve(process.cwd(), args.dir);
  const openapiDir = path.join(targetDir, "openapi");
  await fs.mkdir(targetDir, { recursive: true });

  // Guard against clobbering an existing project.
  if (!args.force) {
    const clash: string[] = [];
    for (const f of ["package.json", "openapi/openapi.json", "src/index.ts"]) {
      if (await exists(path.join(targetDir, f))) clash.push(f);
    }
    if (clash.length > 0) {
      console.log(`Target already contains: ${clash.join(", ")}`);
      const overwrite = await confirm("Overwrite existing files? (openapi.json is still kept)", false);
      if (!overwrite) {
        console.log("Cancelled, existing files kept.");
        return;
      }
      args.force = true;
    }
  }

  let name = args.name;
  if (!name) {
    if (args.yes) {
      name = path.basename(targetDir) || "my-api";
    } else {
      const ans = (await ask(`Project name? (${path.basename(targetDir)}): `)).trim();
      name = ans || path.basename(targetDir) || "my-api";
    }
  }

  let port = args.port;
  if (port === null) {
    if (args.yes) {
      port = 3000;
    } else {
      const ans = (await ask("HTTP port? (3000): ")).trim();
      port = ans ? parseInt(ans, 10) || 3000 : 3000;
    }
  }

  console.log("");
  console.log(`Scaffolding "${name}" in ${targetDir} (port ${port})`);

  // Step 1: existing database via migratify?
  let useDb = false;
  if (args.yes) {
    useDb = false;
  } else {
    useDb = await confirm("Would you like to set up based off an existing database?", false);
  }
  if (useDb) {
    await migratifyStep(openapiDir, args.force);
  }

  // Step 2: prefabs from openapi-blocks?
  let useBlocks = false;
  if (args.yes) {
    useBlocks = false;
  } else {
    useBlocks = await confirm(
      "Would you like to use any prefabs from https://github.com/barely-sentient/openapi-blocks?",
      false
    );
  }
  if (useBlocks) {
    await blocksStep(targetDir, openapiDir, name, port, false);
  } else if (!useDb) {
    console.log("Skipping prefabs. (Re-run and answer yes to install openapi-blocks prefabs.)");
  }

  const reactApps: string[] = [];
  if (!args.yes && await confirm("Would you like to set up a React app here too?", false)) {
    while (true) {
      const appName = (await ask("Enter the app name: ")).trim();
      if (!/^[A-Za-z0-9_-]+$/.test(appName)) {
        console.log("App names may only contain letters, numbers, underscores, and hyphens.");
        continue;
      }
      if (appName.toLowerCase() === "shared") {
        console.log('"shared" is reserved for shared frontend code.');
        continue;
      }
      if (reactApps.some((name) => name.toLowerCase() === appName.toLowerCase())) {
        console.log("That app name has already been added.");
        continue;
      }
      reactApps.push(appName);
      if (!await confirm("Do you want to add any more?", false)) break;
    }
  }

  // Ensure there is always a root: openapi.json is king.
  await ensureBaseRoot(openapiDir, name, port);

  // Step 3: scaffold the server project (tsify/eventify/autocrudify/persistify/permissify wiring).
  await scaffoldStep(targetDir, openapiDir, name, port, args.force, reactApps);

  // Step 4: install + initial codegen.
  if (!args.noInstall) {
    console.log("");
    console.log("Installing dependencies (this may take a minute) ...");
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const installed = spawnSync(npmCmd, ["install", "--no-audit", "--no-fund"], {
      cwd: targetDir,
      stdio: "inherit",
      shell: true,
    });
    if (installed.status !== 0) {
      console.log("npm install failed. Run it manually, then run npm run codegen.");
      printNext(targetDir, port, false);
      return;
    }
  } else {
    console.log("Skipping npm install (--no-install).");
  }

  if (!args.noCodegen) {
    if (args.noInstall) {
      console.log("Skipping codegen (needs installed deps). Run npm install, then npm run codegen.");
    } else {
      console.log("");
      console.log("Running initial codegen (tsify + eventify) ...");
      const codegen = spawnSync("npx", ["tsx", "scripts/codegen.ts"], {
        cwd: targetDir,
        stdio: "inherit",
        shell: true,
      });
      if (codegen.status !== 0) {
        console.log("Codegen failed. Run npm run codegen manually once dependencies settle.");
        printNext(targetDir, port, false);
        return;
      }
    }
  }

  printNext(targetDir, port, true);
}

function printNext(targetDir: string, port: number, ready: boolean): void {
  console.log("");
  console.log("Done.");
  console.log(`  Project : ${targetDir}`);
  console.log(`  Spec    : openapi/openapi.json (king - edit it, then run npm run codegen)`);
  console.log(`  Default : SQLite (var/db/app.db) until you supply your own persistify adapter.`);
  console.log(`  Domain  : write event listeners (Events.X.BeforeCreate ...) and any missing`);
  console.log(`            endpoints in src/handlers/*.handler.ts.`);
  if (ready) {
    console.log(`  Start   : cd ${targetDir} && npm start   (http://localhost:${port})`);
  } else {
    console.log(`  Next    : cd ${targetDir} && npm install && npm run codegen && npm start`);
  }
}

main().catch((err) => {
  console.error(`creatify failed: ${(err as Error).message}`);
  process.exit(1);
});
