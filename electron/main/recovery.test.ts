import { it, expect } from "@jest/globals";
import Database from "better-sqlite3";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  activeDirectory,
  activate,
  rollbackRestore,
  snapshot,
  stageRestore,
} from "./recovery";
import { runMigrations } from "./database/migrations";
it("restores media and WAL data to a separate dataset and can undo activation", () => {
  const root = mkdtempSync(join(tmpdir(), "wms-recovery-"));
  const db = new Database(join(root, "warehouse.sqlite"));
  try {
    db.pragma("journal_mode=WAL");
    runMigrations(db);
    mkdirSync(join(root, "media", "brands"), { recursive: true });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2XkAAAAASUVORK5CYII=", "base64");
    writeFileSync(join(root, "media/brands/test.png"), png);
    db.exec(
      "INSERT INTO brands(id,code,name,image_path,status,created_at,updated_at) VALUES('1','BR','Brand','brands/test.png','active','now','now')",
    );
    const saved = snapshot(db, root, join(root, "backups"));
    const id = stageRestore(saved, root);
    activate(root, id);
    expect(
      readFileSync(
        join(activeDirectory(root), "media/brands/test.png"),
      ),
    ).toEqual(png);
    const restored = new Database(join(activeDirectory(root), "warehouse.sqlite"), { readonly: true });
    try {
      expect(restored.prepare("SELECT image_path FROM brands WHERE id='1'").pluck().get()).toBe("brands/test.png");
      expect(restored.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(restored.pragma("foreign_key_check")).toEqual([]);
    } finally { restored.close(); }
    expect(rollbackRestore(root)).toBe(true);
    expect(activeDirectory(root)).toBe(root);
    writeFileSync(join(saved, "media/brands/test.png"), "bad");
    expect(() => stageRestore(saved, root)).toThrow("checksum");
    writeFileSync(join(saved, "warehouse.sqlite"), "damaged QA fixture");
    expect(() => stageRestore(saved, root)).toThrow("checksum");
    expect(db.prepare("SELECT name FROM brands WHERE id='1'").pluck().get()).toBe("Brand");
    expect(activeDirectory(root)).toBe(root);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
