import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const checker = resolve(__dirname, "../../../../scripts/check-boundaries.cjs");

function check(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "wms-boundaries-"));
  try {
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      baseUrl: ".",
      paths: { "@core/*": ["src/core/*"] },
    } }));
    for (const [name, source] of Object.entries(files)) {
      const file = join(root, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
    }
    const result = spawnSync(process.execPath, [checker], {
      cwd: root,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
    });
    if (result.error) throw result.error;
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it.each(["application", "domain"])("rejects %s imports of same-module infrastructure", layer => {
  const result = check({
    [`src/core/identity/${layer}/consumer.ts`]: `import type { Adapter } from "@core/identity/infrastructure/adapter";`,
    "src/core/identity/infrastructure/adapter.ts": "export interface Adapter {}",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`src/core/identity/${layer}/consumer.ts imports src/core/identity/infrastructure/adapter.ts`);
});

it.each([
  ["application", "node:crypto"], ["domain", "crypto"], ["application", "fs/promises"],
  ["domain", "node:sqlite"], ["application", "better-sqlite3"], ["domain", "sqlite3"],
  ["application", "electron"], ["domain", "electron/main"],
])("rejects platform import %s -> %s before resolving external packages", (layer, dependency) => {
  const result = check({ [`src/core/identity/${layer}/consumer.ts`]: `import "${dependency}";` });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`src/core/identity/${layer}/consumer.ts imports ${dependency}`);
});

it("allows infrastructure-to-application, shared types, and cross-module public contracts", () => {
  const result = check({
    "src/core/identity/infrastructure/adapter.ts": 'import type { Port } from "../application/ports"; import "node:crypto";',
    "src/core/identity/application/ports.ts": 'import type { Shared } from "../../shared/types"; export type Port = Shared;',
    "src/core/identity/public.ts": 'export type { Port } from "./application/ports";',
    "src/core/shared/types.ts": "export interface Shared {}",
    "src/core/catalog/application/consumer.ts": 'import type { Port } from "@core/identity/public";',
  });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("passed for 5 modules");
});

it("still rejects private cross-module imports", () => {
  const result = check({
    "src/core/catalog/application/consumer.ts": 'import "@core/identity/application/ports";',
    "src/core/identity/application/ports.ts": "export {};",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("imports private src/core/identity/application/ports.ts");
});

it("still rejects import cycles", () => {
  const result = check({
    "src/core/identity/application/a.ts": 'import "./b";',
    "src/core/identity/application/b.ts": 'import "./a";',
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("src/core/identity/application/a.ts -> src/core/identity/application/b.ts -> src/core/identity/application/a.ts");
});
