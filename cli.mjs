#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = dirname(fileURLToPath(import.meta.url));
const patchPath = join(packageDir, "patch.mjs");

async function isDevSpaceRoot(path) {
  try {
    await access(join(path, "package.json"));
    await access(join(path, "dist", "server.js"));
    return true;
  } catch {
    return false;
  }
}

function globalNpmRoot() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["root", "-g"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) return undefined;
  const root = result.stdout.trim();
  return root || undefined;
}

async function findDevSpaceRoot() {
  if (process.env.DEVSPACE_PACKAGE_ROOT) {
    if (await isDevSpaceRoot(process.env.DEVSPACE_PACKAGE_ROOT)) {
      return process.env.DEVSPACE_PACKAGE_ROOT;
    }
    throw new Error(`invalid DEVSPACE_PACKAGE_ROOT: ${process.env.DEVSPACE_PACKAGE_ROOT}`);
  }

  const candidates = [
    join(process.cwd(), "node_modules", "@waishnav", "devspace"),
    join(homedir(), ".local", "share", "devspace-kit", "node_modules", "@waishnav", "devspace"),
  ];

  const npmRoot = globalNpmRoot();
  if (npmRoot) candidates.push(join(npmRoot, "@waishnav", "devspace"));

  for (const candidate of candidates) {
    if (await isDevSpaceRoot(candidate)) return candidate;
  }

  return undefined;
}

async function main() {
  const root = await findDevSpaceRoot();
  if (!root) {
    throw new Error(
      "could not find @waishnav/devspace. Set DEVSPACE_PACKAGE_ROOT=/path/to/node_modules/@waishnav/devspace and retry.",
    );
  }

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  console.log(`[devspace-file-tools] DevSpace root: ${root}`);
  console.log(`[devspace-file-tools] DevSpace version: ${packageJson.version}`);

  const result = spawnSync(process.execPath, [patchPath], {
    stdio: "inherit",
    env: {
      ...process.env,
      DEVSPACE_PACKAGE_ROOT: root,
    },
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);

  console.log("[devspace-file-tools] done");
  console.log("Restart DevSpace and reconnect the MCP client to refresh its tool list.");
}

main().catch((error) => {
  console.error(`[devspace-file-tools] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
