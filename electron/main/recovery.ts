import { CURRENT_SCHEMA_VERSION, runMigrations, verifyDatabase } from "./database/migrations";
import Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import {
  openSync, readSync, closeSync, copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
const filename = "warehouse.sqlite";
function checksum(path:string){
 const hash=createHash("sha256"),buffer=Buffer.alloc(256*1024),fd=openSync(path,"r");
 try{let bytes:number;while((bytes=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,bytes));return hash.digest("hex")}finally{closeSync(fd)}
}
function images(db: Database.Database) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='products'").get())
    return [];
  return db
    .prepare(
      "SELECT image_path FROM products WHERE image_path IS NOT NULL UNION SELECT image_path FROM brands WHERE image_path IS NOT NULL",
    )
    .pluck()
    .all() as string[];
}
function mediaPath(dir: string, key: string) {
  if (!/^(products|brands)\/[\p{L}\p{N}_. -]+\.(png|jpe?g|webp)$/iu.test(key))
    throw Error("Invalid media path");
  const parts = key.split("/");
  const media = join(dir, "media");
  for (const p of [dir, media, join(media, parts[0]), join(media, key)])
    if (existsSync(p) && lstatSync(p).isSymbolicLink())
      throw Error("Invalid backup link");
  return join(media, key);
}
function verifyDb(db: Database.Database) {
  return verifyDatabase(db);
}
function copyMedia(from: string, to: string, key: string) {
  const dest = mediaPath(to, key);
  const source = mediaPath(from, key);
  const expected = checksum(source);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  const actual = checksum(dest);
  if (actual !== expected) throw new Error("Media copy failed: " + key);
  return actual;
}
export function snapshot(db: Database.Database, live: string, parent: string) {
  mkdirSync(parent, { recursive: true });
  const dest = join(parent, "wms-" + randomUUID());
  mkdirSync(dest);
  const path = join(dest, filename);
  db.prepare("VACUUM INTO ?").run(path);
  const copy = new Database(path, { readonly: true });
  try {
    const schema = verifyDb(copy);
    const files: Record<string, string> = {};
    for (const key of images(copy)) files[key] = copyMedia(live, dest, key);
    writeFileSync(
      join(dest, "manifest.json"),
      JSON.stringify({ format: 1, schema, database: checksum(path), files }),
    );
  } finally {
    copy.close();
  }
  return dest;
}
export function activeDirectory(root: string) {
  const pointer = join(root, "active-dataset");
  if (!existsSync(pointer)) return root;
  const id = readFileSync(pointer, "utf8");
  if (!/^dataset-[a-f0-9-]{36}$/.test(id))
    throw Error("Invalid dataset pointer");
  const dir = join(root, id);
  if (!existsSync(join(dir, filename))) throw Error("Active database missing");
  return dir;
}
/** Copy and reopen a backup without running migrations on the verification copy. */
function copyVerifiedBackup(source: string, dest: string): void {
  const manifest = JSON.parse(
    readFileSync(join(source, "manifest.json"), "utf8"),
  );
  if (
    manifest.format !== 1 ||
    checksum(join(source, filename)) !== manifest.database
  )
    throw Error("Invalid backup checksum");
  mkdirSync(dest, { recursive: true });
  const path = join(dest, filename);
  copyFileSync(join(source, filename), path);
  if (checksum(path) !== manifest.database) throw Error("Database copy failed");
  const db = new Database(path, { readonly: true });
  try {
    if (verifyDb(db) !== manifest.schema) throw Error("Schema mismatch");
    for (const key of images(db))
      if (copyMedia(source, dest, key) !== manifest.files[key])
        throw Error("Invalid media checksum: " + key);
  } finally {
    db.close();
  }
}

export function verifyRestorableSnapshot(source: string, verificationParent: string): void {
  mkdirSync(verificationParent, { recursive: true });
  const copy = mkdtempSync(join(verificationParent, "verify-"));
  try {
    copyVerifiedBackup(source, copy);
  } finally {
    // Only this function's newly allocated verification directory is removed.
    rmSync(copy, { recursive: true, force: true });
  }
}

export function createVerifiedSnapshot(db: Database.Database, live: string, parent: string): string {
  const backup = snapshot(db, live, parent);
  verifyRestorableSnapshot(backup, parent);
  return backup;
}

export function stageRestore(source: string, root: string) {
  const id = "dataset-" + randomUUID();
  const dest = join(root, id);
  copyVerifiedBackup(source, dest);
  const db = new Database(join(dest, filename));
  try {
    db.pragma("foreign_keys=ON");
    runMigrations(db, CURRENT_SCHEMA_VERSION, {
      beforeUpgrade: () => { createVerifiedSnapshot(db, dest, join(dest, "backups")); },
    });
    verifyDb(db);
  } finally { db.close(); }
  return id;
}
export function confirmStartup(root: string) {
  const marker = join(root, "restore-pending");
  if (existsSync(marker)) unlinkSync(marker);
}
export function rollbackRestore(root: string) {
  const marker = join(root, "restore-pending");
  if (!existsSync(marker)) return false;
  const previous = readFileSync(marker, "utf8"),
    pointer = join(root, "active-dataset");
  if (previous) {
    const temp = join(root, "previous-" + randomUUID());
    writeFileSync(temp, previous, { flush: true });
    renameSync(temp, pointer);
  } else if (existsSync(pointer)) unlinkSync(pointer);
  confirmStartup(root);
  return true;
}
export function activate(root: string, id: string) {
  const pointer = join(root, "active-dataset");
  writeFileSync(
    join(root, "restore-pending"),
    existsSync(pointer) ? readFileSync(pointer) : "",
    { flush: true },
  );
  const temp = join(root, "active-" + randomUUID());
  writeFileSync(temp, id, { flush: true });
  renameSync(temp, join(root, "active-dataset"));
}
