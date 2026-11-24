import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import Database from "better-sqlite3";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import fs from "node:fs";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteCatalog } from "@core/catalog/infrastructure/create-sqlite-catalog";
import { FileImageStorage } from "@core/catalog/infrastructure/file-image-storage";
import { createSqliteIdentity } from "@core/identity/infrastructure/create-sqlite-identity";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type { IpcResult } from "@shared/ipc/result";
import { runMigrations } from "../database/migrations";
import { createVerifiedSnapshot, stageRestore } from "../recovery";
import { registerCatalogHandlers } from "./catalog-handlers";
import { forgetWindow, trustWindow } from "./dispatch";

jest.mock("electron", () => ({ ipcMain: { handle: jest.fn() } }));

const channels = IPC_CHANNELS.catalog;
const original = "data:image/png;base64,aW1hZ2UtYQ==";
const sameFormat = "data:image/png;base64,aW1hZ2UtYg==";
const differentFormat = "data:image/jpeg;base64,aW1hZ2UtYw==";
const originalBytes = Buffer.from("image-a");
const frame = { url: "file:///catalog-media-test/index.html" };
const event = { sender: { id: 93, mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent;
const handlers = new Map<string, Parameters<typeof ipcMain.handle>[1]>();
let root: string;
let db: Database.Database;
let images: FileImageStorage;
let catalog: ReturnType<typeof createSqliteCatalog>;
let productInput: Parameters<typeof catalog.createProduct>[0];
const brandInput = { name: "Brand", code: "BRAND", imageDataUrl: original };
type AuditFailureCase = [action: string, channel: string, imageDataUrl: string | null | undefined];

function invoke(channel: string, input: unknown): Promise<IpcResult<unknown>> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error("Missing handler " + channel);
  return handler(event, input);
}

function auditRows() {
  return db.prepare("SELECT action,target FROM audit ORDER BY id").all();
}

function rejectAudit() {
  db.exec(`CREATE TEMP TRIGGER reject_catalog_audit BEFORE INSERT ON audit
    BEGIN SELECT RAISE(ABORT, 'QA audit failure'); END`);
}

function mediaFiles(folder: "products" | "brands") {
  return readdirSync(join(root, "media", folder)).sort().map(name => folder + "/" + name);
}

function expectRestorableImage(imagePath: string) {
  const backup = createVerifiedSnapshot(db, root, join(root, "backups"));
  const staged = stageRestore(backup, root);
  expect(readFileSync(join(root, staged, "media", imagePath))).toEqual(originalBytes);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wms-catalog-media-"));
  db = new Database(join(root, "warehouse.sqlite"));
  runMigrations(db);
  images = new FileImageStorage(join(root, "media"));
  catalog = createSqliteCatalog(db, images);
  const category = catalog.createCategory({ name: "Category", code: "CAT" });
  const unit = catalog.createUnit({ name: "Piece", symbol: "pc", dimension: "count" });
  productInput = {
    name: "Product", sku: "PRODUCT", categoryId: category.id, baseUnitId: unit.id,
    productType: "simple", allowDecimalQuantity: false, imageDataUrl: original,
  };
  db.exec("INSERT INTO operators VALUES ('actor','Catalog test','unused'); INSERT INTO operator_roles VALUES ('actor','admin');");
  handlers.clear();
  jest.mocked(ipcMain.handle).mockImplementation((channel, handler) => { handlers.set(channel, handler); });
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  trustWindow(event.sender.id, url => url === frame.url);
  const identity = createSqliteIdentity(db);
  jest.spyOn(identity, "actor").mockReturnValue("actor");
  registerCatalogHandlers(catalog, identity, db);
});

afterEach(() => {
  forgetWindow(event.sender.id);
  db.close();
  rmSync(root, { recursive: true, force: true });
  jest.restoreAllMocks();
});

it("preserves the old product bytes when the stock-history base-unit constraint rejects an update", () => {
  const { product } = catalog.createProduct(productInput);
  const nextUnit = catalog.createUnit({ name: "Box", symbol: "bx", dimension: "count" });
  db.prepare("INSERT INTO documents (id,kind,state,lines) VALUES ('fixture','receipt','draft',?)")
    .run(JSON.stringify([{ item: "p:" + product.id, location: "fixture", quantity: "1" }]));
  expect(() => catalog.updateProduct(product.id, {
    ...productInput, baseUnitId: nextUnit.id, imageDataUrl: sameFormat,
  })).toThrow(expect.objectContaining({ code: "CONSTRAINT" }));
  expect(catalog.getProduct(product.id).product).toEqual(product);
  expect(images.read(product.imagePath!)).toBe(original);
  expect(mediaFiles("products")).toEqual([product.imagePath]);
  expect(auditRows()).toEqual([]);
  expectRestorableImage(product.imagePath!);
});

it.each<AuditFailureCase>([
  ["replace with the same format", channels.products.update, sameFormat],
  ["replace with a different format", channels.products.update, differentFormat],
  ["remove the image", channels.products.update, null],
  ["delete the product", channels.products.delete, undefined],
])("preserves product and media when audit fails after attempting to %s", async (_action, channel, imageDataUrl) => {
  const { product } = catalog.createProduct(productInput);
  rejectAudit();
  await expect(invoke(channel, channel === channels.products.delete ? { id: product.id } : {
    ...productInput, id: product.id, name: "Changed", imageDataUrl,
  })).resolves.toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
  expect(catalog.getProduct(product.id).product).toEqual(product);
  expect(images.read(product.imagePath!)).toBe(original);
  expect(mediaFiles("products")).toEqual([product.imagePath]);
  expect(auditRows()).toEqual([]);
  expectRestorableImage(product.imagePath!);
});

it.each<AuditFailureCase>([
  ["replace", channels.brands.update, differentFormat],
  ["remove the image from", channels.brands.update, null],
  ["delete", channels.brands.delete, undefined],
])("preserves brand and media when audit fails after attempting to %s the brand", async (_action, channel, imageDataUrl) => {
  const brand = catalog.createBrand(brandInput);
  rejectAudit();
  await expect(invoke(channel, channel === channels.brands.delete ? { id: brand.id } : {
    ...brandInput, id: brand.id, name: "Changed", imageDataUrl,
  })).resolves.toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
  expect(catalog.lookupBrands()).toEqual([brand]);
  expect(images.read(brand.imagePath!)).toBe(original);
  expect(mediaFiles("brands")).toEqual([brand.imagePath]);
  expect(auditRows()).toEqual([]);
  expectRestorableImage(brand.imagePath!);
});

it("removes staged product and brand images when audited creates fail", async () => {
  rejectAudit();
  for (const [channel, input] of [
    [channels.products.create, productInput], [channels.brands.create, brandInput],
  ] as const) {
    await expect(invoke(channel, input)).resolves.toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
  }
  expect(catalog.lookupProducts()).toEqual([]);
  expect(catalog.lookupBrands()).toEqual([]);
  expect(mediaFiles("products")).toEqual([]);
  expect(mediaFiles("brands")).toEqual([]);
  expect(auditRows()).toEqual([]);
});

it.each(["products", "brands"] as const)("commits replacement, removal and deletion for %s through IPC", async folder => {
  const product = folder === "products";
  const input = product ? productInput : brandInput;
  const entity = product ? catalog.createProduct(productInput).product : catalog.createBrand(brandInput);
  const get = () => product ? catalog.getProduct(entity.id).product : catalog.lookupBrands()[0];
  const { update, delete: remove } = channels[folder];
  let previous = entity.imagePath;
  for (const imageDataUrl of [sameFormat, differentFormat, undefined, null, original]) {
    const payload = { ...input, id: entity.id, imageDataUrl };
    if (imageDataUrl === undefined) delete payload.imageDataUrl;
    await expect(invoke(update, payload)).resolves.toMatchObject({ ok: true });
    const current = get().imagePath;
    if (imageDataUrl === undefined) {
      expect(current).toBe(previous);
      expect(images.read(current!)).toBe(differentFormat);
    } else {
      if (previous) expect(images.read(previous)).toBeNull();
      if (imageDataUrl === null) expect(current).toBeNull();
      else {
        expect(current).not.toBe(previous);
        expect(new FileImageStorage(join(root, "media")).read(current!)).toBe(imageDataUrl);
      }
    }
    expect(mediaFiles(folder)).toEqual(current ? [current] : []);
    previous = current;
  }
  await expect(invoke(remove, { id: entity.id })).resolves.toMatchObject({ ok: true });
  expect(mediaFiles(folder)).toEqual([]);
  expect(auditRows()).toEqual([
    ...Array.from({ length: 5 }, () => ({ action: update, target: entity.id })),
    { action: remove, target: entity.id },
  ]);
});

it("keeps parent effects pending and reverses only changes from a failed nested savepoint", () => {
  const { product } = catalog.createProduct(productInput);
  const brand = catalog.createBrand(brandInput);
  const error = new Error("QA nested rollback");

  const updated = catalog.runMutation(() => {
    const { product: pending } = catalog.updateProduct(product.id, { ...productInput, imageDataUrl: sameFormat });
    expect(images.read(product.imagePath!)).toBe(original);
    expect(images.read(pending.imagePath!)).toBe(sameFormat);

    expect(() => catalog.runMutation(() => {
      catalog.updateBrand(brand.id, { ...brandInput, imageDataUrl: differentFormat });
      expect(mediaFiles("brands")).toHaveLength(2);
      throw error;
    })).toThrow(error);
    expect(catalog.lookupBrands()).toEqual([brand]);
    expect(mediaFiles("brands")).toEqual([brand.imagePath]);
    expect(mediaFiles("products")).toHaveLength(2);
    return pending;
  });

  expect(catalog.getProduct(product.id).product).toEqual(updated);
  expect(images.read(updated.imagePath!)).toBe(sameFormat);
  expect(mediaFiles("products")).toEqual([updated.imagePath]);
  expect(images.read(brand.imagePath!)).toBe(original);
});

it("retains the old image when COMMIT itself fails a deferred foreign key check", () => {
  const brand = catalog.createBrand(brandInput);
  expect(() => catalog.runMutation(() => {
    catalog.updateBrand(brand.id, { ...brandInput, imageDataUrl: sameFormat });
    expect(images.read(brand.imagePath!)).toBe(original);
    db.pragma("defer_foreign_keys = ON");
    db.exec("INSERT INTO audit(actor,action,target) VALUES ('missing','fixture','fixture')");
  })).toThrow(/FOREIGN KEY constraint failed/);

  expect(db.inTransaction).toBe(false);
  expect(catalog.lookupBrands()).toEqual([brand]);
  expect(images.read(brand.imagePath!)).toBe(original);
  expect(mediaFiles("brands")).toEqual([brand.imagePath]);
  expect(auditRows()).toEqual([]);
});

it("retains a shared historical file until its last committed reference is gone", () => {
  const { product } = catalog.createProduct({ ...productInput, imageDataUrl: undefined });
  const brand = catalog.createBrand({ ...brandInput, imageDataUrl: undefined });
  const legacyPath = images.save({ folder: "products", fileName: product.id + ".png", dataUrl: original });
  db.prepare("UPDATE products SET image_path=? WHERE id=?").run(legacyPath, product.id);
  db.prepare("UPDATE brands SET image_path=? WHERE id=?").run(legacyPath, brand.id);

  catalog.deleteProduct(product.id);
  expect(images.read(legacyPath)).toBe(original);
  expectRestorableImage(legacyPath);
  catalog.deleteBrand(brand.id);
  expect(images.read(legacyPath)).toBeNull();
});

it("keeps the original error if staging cleanup fails and leaves the old media intact", () => {
  const brand = catalog.createBrand(brandInput);
  const failure = new Error("QA original rollback");
  const remove = jest.spyOn(images, "remove").mockImplementation(() => { throw new Error("QA cleanup failure"); });
  expect(() => catalog.runMutation(() => {
    catalog.updateBrand(brand.id, { ...brandInput, imageDataUrl: sameFormat });
    throw failure;
  })).toThrow(failure);

  expect(remove).toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalledWith(brand.imagePath);
  expect(catalog.lookupBrands()).toEqual([brand]);
  expect(images.read(brand.imagePath!)).toBe(original);
});

it("reports IPC success when the committed replacement leaves an old file for later cleanup", async () => {
  const brand = catalog.createBrand(brandInput);
  const remove = jest.spyOn(images, "remove").mockImplementation(() => { throw new Error("QA locked file"); });
  await expect(invoke(channels.brands.update, {
    ...brandInput, id: brand.id, imageDataUrl: differentFormat,
  })).resolves.toMatchObject({ ok: true });

  const current = catalog.lookupBrands()[0];
  expect(current.imagePath).not.toBe(brand.imagePath);
  expect(images.read(current.imagePath!)).toBe(differentFormat);
  expect(images.read(brand.imagePath!)).toBe(original);
  expect(remove).toHaveBeenCalledWith(brand.imagePath);
  expect(auditRows()).toEqual([{ action: channels.brands.update, target: brand.id }]);
});

it("refuses filename collisions and removes a partially written new file", () => {
  const data = { folder: "brands", fileName: "fixture.png", dataUrl: original };
  const saved = images.save(data);
  expect(() => images.save({ ...data, dataUrl: sameFormat })).toThrow(/EEXIST/);
  expect(images.read(saved)).toBe(original);

  const failure = new Error("QA short write");
  const write = fs.writeFileSync;
  jest.spyOn(fs, "writeFileSync").mockImplementationOnce(file => {
    write(file, "partial image");
    throw failure;
  });
  expect(() => images.save({ ...data, fileName: "partial.png" })).toThrow(failure);
  expect(mediaFiles("brands")).toEqual([saved]);
});
