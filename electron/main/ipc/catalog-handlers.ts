import { ipcMain } from "electron";
import { join } from "node:path";
import { z } from "zod";
import type Database from "better-sqlite3";
import { createSqliteCatalog, type CatalogUseCases } from "@core/catalog/infrastructure/create-sqlite-catalog";
import { FileImageStorage } from "@core/catalog/infrastructure/file-image-storage";
import { handle } from "@core/shared/ipc/handle";
import * as S from "@shared/ipc/schemas";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import { getDatabase } from "../database";
import { createLogger } from "../logger";

const logger = createLogger("ipc:catalog");
const noInputSchema = z.undefined();

type AnySchema = z.ZodType<any, any, unknown>;
type Executor = (input: any) => unknown;

function updateSchema<T extends z.ZodRawShape>(base: z.ZodObject<T>) {
  return z.object({ id: z.string().min(1, "المعرف مطلوب"), ...base.shape });
}

const productListQuerySchema = S.pageQuerySchema.extend({
  categoryId: z.string().nullable().optional(),
  brandId: z.string().nullable().optional(),
  productType: z.enum(["simple", "with_variants"]).nullable().optional()
});

const variantListQuerySchema = S.pageQuerySchema.extend({
  productId: z.string().nullable().optional()
});

const packagingListQuerySchema = S.pageQuerySchema.extend({
  productId: z.string().nullable().optional()
});

const barcodeCodeSchema = z.object({ code: z.string().min(1, "قيمة الباركود مطلوبة") });

function register(channel: string, schema: AnySchema, execute: Executor): void {
  ipcMain.handle(channel, async (_event, input: unknown) => handle({ schema, execute })(input));
}

/** Registers an "update" channel whose payload is `{ id } & <input fields>`. */
function registerUpdate<T extends z.ZodRawShape>(
  channel: string,
  base: z.ZodObject<T>,
  execute: (id: string, rest: any) => unknown
): void {
  register(channel, updateSchema(base), (input) => {
    const { id, ...rest } = input as { id: string; [key: string]: unknown };
    return execute(id, rest);
  });
}

/** Registers an "activate/deactivate/delete" channel that only needs an id. */
function registerIdAction(channel: string, execute: (id: string) => unknown): void {
  register(channel, S.idPayloadSchema, (input) => execute(String((input as { id?: unknown }).id)));
}

export function registerCatalogHandlers(userDataPath: string): void {
  const db: Database.Database = getDatabase();
  const images = new FileImageStorage(join(userDataPath, "media"));
  const catalog: CatalogUseCases = createSqliteCatalog(db, images);

  // Categories
  register(IPC_CHANNELS.catalog.categories.list, S.pageQuerySchema, (q) => catalog.listCategories(q));
  register(IPC_CHANNELS.catalog.categories.lookup, noInputSchema, () => catalog.lookupCategories());
  register(IPC_CHANNELS.catalog.categories.tree, noInputSchema, () => catalog.listCategoryTree());
  register(IPC_CHANNELS.catalog.categories.create, S.categoryInputSchema, (i) => catalog.createCategory(i));
  registerUpdate(IPC_CHANNELS.catalog.categories.update, S.categoryInputSchema, (id, rest) =>
    catalog.updateCategory(id, rest)
  );
  registerIdAction(IPC_CHANNELS.catalog.categories.activate, (id) => catalog.activateCategory(id));
  registerIdAction(IPC_CHANNELS.catalog.categories.deactivate, (id) => catalog.deactivateCategory(id));
  registerIdAction(IPC_CHANNELS.catalog.categories.delete, (id) => catalog.deleteCategory(id));

  // Units
  register(IPC_CHANNELS.catalog.units.list, S.pageQuerySchema, (q) => catalog.listUnits(q));
  register(IPC_CHANNELS.catalog.units.lookup, noInputSchema, () => catalog.lookupUnits());
  register(IPC_CHANNELS.catalog.units.create, S.unitInputSchema, (i) => catalog.createUnit(i));
  registerUpdate(IPC_CHANNELS.catalog.units.update, S.unitInputSchema, (id, rest) => catalog.updateUnit(id, rest));
  registerIdAction(IPC_CHANNELS.catalog.units.activate, (id) => catalog.activateUnit(id));
  registerIdAction(IPC_CHANNELS.catalog.units.deactivate, (id) => catalog.deactivateUnit(id));
  registerIdAction(IPC_CHANNELS.catalog.units.delete, (id) => catalog.deleteUnit(id));

  // Brands
  register(IPC_CHANNELS.catalog.brands.list, S.pageQuerySchema, (q) => catalog.listBrands(q));
  register(IPC_CHANNELS.catalog.brands.lookup, noInputSchema, () => catalog.lookupBrands());
  register(IPC_CHANNELS.catalog.brands.create, S.brandInputSchema, (i) => catalog.createBrand(i));
  registerUpdate(IPC_CHANNELS.catalog.brands.update, S.brandInputSchema, (id, rest) => catalog.updateBrand(id, rest));
  registerIdAction(IPC_CHANNELS.catalog.brands.activate, (id) => catalog.activateBrand(id));
  registerIdAction(IPC_CHANNELS.catalog.brands.deactivate, (id) => catalog.deactivateBrand(id));
  registerIdAction(IPC_CHANNELS.catalog.brands.delete, (id) => catalog.deleteBrand(id));

  // Products
  register(IPC_CHANNELS.catalog.products.list, productListQuerySchema, (q) => catalog.listProducts(q));
  register(IPC_CHANNELS.catalog.products.lookup, noInputSchema, () => catalog.lookupProducts());
  register(IPC_CHANNELS.catalog.products.get, S.idPayloadSchema, (input) => catalog.getProduct(String(input.id)));
  register(IPC_CHANNELS.catalog.products.create, S.productInputSchema, (i) => catalog.createProduct(i));
  registerUpdate(IPC_CHANNELS.catalog.products.update, S.productInputSchema, (id, rest) =>
    catalog.updateProduct(id, rest)
  );
  registerIdAction(IPC_CHANNELS.catalog.products.activate, (id) => catalog.activateProduct(id));
  registerIdAction(IPC_CHANNELS.catalog.products.deactivate, (id) => catalog.deactivateProduct(id));
  registerIdAction(IPC_CHANNELS.catalog.products.delete, (id) => catalog.deleteProduct(id));

  // Variants
  register(IPC_CHANNELS.catalog.variants.list, variantListQuerySchema, (q) => catalog.listVariants(q));
  register(IPC_CHANNELS.catalog.variants.get, S.idPayloadSchema, (input) => catalog.getVariant(String(input.id)));
  register(IPC_CHANNELS.catalog.variants.create, S.createVariantInputSchema, (i) => catalog.createVariant(i));
  register(IPC_CHANNELS.catalog.variants.update, S.updateVariantInputSchema, (i) => catalog.updateVariant(i));
  registerIdAction(IPC_CHANNELS.catalog.variants.activate, (id) => catalog.activateVariant({ id }));
  registerIdAction(IPC_CHANNELS.catalog.variants.deactivate, (id) => catalog.deactivateVariant({ id }));
  registerIdAction(IPC_CHANNELS.catalog.variants.delete, (id) => catalog.deleteVariant({ id }));

  // Packaging
  register(IPC_CHANNELS.catalog.packaging.list, packagingListQuerySchema, (q) => catalog.listPackaging(q));
  register(IPC_CHANNELS.catalog.packaging.add, S.addPackagingInputSchema, (i) => catalog.addPackaging(i));
  register(IPC_CHANNELS.catalog.packaging.update, S.updatePackagingInputSchema, (i) => catalog.updatePackaging(i));
  registerIdAction(IPC_CHANNELS.catalog.packaging.activate, (id) => catalog.activatePackaging({ id }));
  registerIdAction(IPC_CHANNELS.catalog.packaging.deactivate, (id) => catalog.deactivatePackaging({ id }));
  registerIdAction(IPC_CHANNELS.catalog.packaging.delete, (id) => catalog.deletePackaging({ id }));

  // Barcodes
  register(IPC_CHANNELS.catalog.barcodes.list, S.pageQuerySchema, (q) => catalog.listBarcodes(q));
  register(IPC_CHANNELS.catalog.barcodes.add, S.addBarcodeInputSchema, (i) => catalog.addBarcode(i));
  registerIdAction(IPC_CHANNELS.catalog.barcodes.delete, (id) => catalog.deleteBarcode({ id }));
  register(IPC_CHANNELS.catalog.barcodes.find, barcodeCodeSchema, ({ code }) =>
    catalog.findProductByBarcode(String(code))
  );
  register(IPC_CHANNELS.catalog.barcodes.label, barcodeCodeSchema, ({ code }) =>
    catalog.prepareBarcodeLabel(String(code))
  );

  // Media
  register(IPC_CHANNELS.catalog.media.read, S.mediaReadSchema, ({ relativePath }) =>
    catalog.readImage(String(relativePath))
  );

  logger.info("Catalog IPC handlers registered");
}
