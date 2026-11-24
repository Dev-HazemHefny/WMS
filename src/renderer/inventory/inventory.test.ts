import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { buildSync } from "esbuild";

const cases = [
  "navigation and access",
  "scoped overview and balances",
  "stock item identity and totals",
  "warehouse reporting and search",
  "movement cursor, errors, and stale requests",
  "read-only consistency",
  "session expiration, logout, and account switching",
  "stock operations lookup and document flows",
  "stock operations session isolation",
];

let results: Record<string, string | null>;

beforeAll(() => {
  const temporaryRoot = resolve(tmpdir());
  const temp = mkdtempSync(join(temporaryRoot, "wms-inventory-jest-"));
  if (dirname(resolve(temp)) !== temporaryRoot) throw new Error("Invalid Inventory test directory");
  try {
    // Use the bundler Vite already installs and Electron's Chromium for DOM events and effects.
    const viteRequire = createRequire(require.resolve("vite/package.json"));
    const esbuild = viteRequire("esbuild") as { buildSync: typeof buildSync };
    esbuild.buildSync({
      entryPoints: [join(__dirname, "inventory.browser.tsx")],
      outfile: join(temp, "test.js"),
      bundle: true,
      platform: "browser",
      define: { "process.env.NODE_ENV": '"development"' },
    });
    writeFileSync(join(temp, "index.html"),
      '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><link rel="stylesheet" href="./test.css"><div id="root"></div><script src="./test.js"></script></html>');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const electron: string = require("electron");
    const run = spawnSync(electron, [join(__dirname, "inventory-test-host.cjs"), temp], {
      env, encoding: "utf8", timeout: 60_000, windowsHide: true,
    });
    const output = run.stdout?.split(/\r?\n/).find(line => line.startsWith("INVENTORY_RESULTS "));
    if (run.error || run.status !== 0 || !output) {
      throw new Error(`Inventory browser tests failed to run: ${run.error ?? run.status}\n${run.stdout}\n${run.stderr}`);
    }
    results = JSON.parse(output.slice("INVENTORY_RESULTS ".length));
  } finally {
    rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
  }
}, 70_000);

test.each(cases)("%s", name => {
  expect(results[name]).toBeNull();
});
