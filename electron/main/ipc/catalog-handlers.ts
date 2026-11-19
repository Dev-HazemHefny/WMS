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

type UnknownExecute = (input: any) => unknown;

function register(channel: string, schema: z.ZodType<any, any, unknown>, execute: UnknownExecute): void {
  ipcMain.handle(channel, async (_event, input: unknown) => {
    return handle({ schema, execute })(input);
  });
}

export function registerCatalogHandlers(userDataPath: string): void {
  const db: Database.Database = getDatabase();
  const images = new FileImageStorage(join(userDataPath, "media"));
  const catalog: CatalogUseCases = createSqliteCatalog(db, images);

  const asIdInput = (input: unknown) => ({ id: String((input as { id?: unknown }).id) });

  // Categories
  register(IPC_CHANNELS.catalog.categories.list, S.pageQuerySchema, (q) => catalog.listCategories(q as any));
  register(IPC_CHANNELS.catalog.categories.lookup, noInputSchema, () => catalog.lookupCategories());
  register(IPC_CHANNELS.catalog.categories.tree, noInputSchema, () => catalog.listCategoryTree());
  register(IPC_CHANNELS.catalog.categories.create, S.categoryInputSchema, (i) => catalog.createCategory(i as any));
  register(
    IPC_CHANNELS.catalog.categories.update,
    updateSchema(S.categoryInputSchema),
    (input) => {
      const { id, ...rest } = input as { id: string; [key: string]: unknown };
      return catalog.updateCategory(id, rest as any);
    }
  );
  register(IPC_CHANNELS.catalog.categories.activate, S.idPayloadSchema, (input) =>
    catalog.activateCategory(asIdInput(input).id)
  );
  register(IPC_CHANNELS.catalog.categories.deactivate, S.idPayloadSchema, (input) =>
    catalog.deactivateCategory(asIdInput(input).id)
  );
  register(IPC_CHANNELS.catalog.categories.delete, S.idPayloadSchema, (input) =>
    catalog.deleteCategory(asIdInput(input).id)
  );

  // Units
  register(IPC_CHANNELS.catalog.units.list, S.pageQuerySchema, (q) => catalog.listUnits(q as any));
  register(IPC_CHANNELS.catalog.units.lookup, noInputSchema, () => catalog.lookupUnits());
  register(IPC_CHANNELS.catalog.units.create, S.unitInputSchema, (i) => catalog.createUnit(i as any));
  register(
    IPC_CHANNELS.catalog.units.update,
    updateSchema(S.unitInputSchema),
    (input) => {
      const { id, ...rest } = input as { id: string; [key: string]: unknown };
      return catalog.updateUnit(id, rest as any);
    }
  );
  register(IPC_CHANNELS.catalog.units.activate, S.idPayloadSchema, (input) => catalog.activateUnit(asIdInput(input).id));
  register(IPC_CHANNELS.catalog.units.deactivate, S.idPayloadSchema, (input) => catalog.deactivateUnit(asIdInput(input).id));
  register(IPC_CHANNELS.catalog.units.delete, S.idPayloadSchema, (input) => catalog.deleteUnit(asIdInput(input).id));

  // Brands
  register(IPC_CHANNELS.catalog.brands.list, S.pageQuerySchema, (q) => catalog.listBrands(q as any));
  register(IPC_CHANNELS.catalog.brands.lookup, noInputSchema, () => catalog.lookupBrands());
  register(IPC_CHANNELS.catalog.brands.create, S.brandInputSchema, (i) => catalog.createBrand(i as any));
  register(
    IPC_CHANNELS.catalog.brands.update,
    updateSchema(S.brandInputSchema),
    (input) => {
      const { id, ...rest } = input as { id: string; [key: string]: unknown };
      return catalog.updateBrand(id, rest as any);
    }
  );
  register(IPC_CHANNELS.catalog.brands.activate, S.idPayloadSchema, (input) => catalog.activateBrand(asIdInput(input).id));
  register(IPC_CHANNELS.catalog.brands.deactivate, S.idPayloadSchema, (input) => catalog.deactivateBrand(asIdInput(input).id));
  register(IPC_CHANNELS.catalog.brands.delete, S.idPayloadSchema, (input) => catalog.deleteBrand(asIdInput(input).id));

  // Products
  register(IPC_CHANNELS.catalog.products.list, productListQuerySchema, (q) => catalog.listProducts(q as any));
  register(IPC_CHANNELS.catalog.products.lookup, noInputSchema, () => catalog.lookupProducts());
  register(IPC_CHANNELS.catalog.products.get, S.idPayloadSchema, (input) => catalog.getProduct(asIdInput(input).id));
  register(IPC_CHANNELS.catalog.products.create, S.productInputSchema, (i) => catalog.createProduct(i as any));
  register(
    IPC_CHANNELS.catalog.products.update,
    updateSchema(S.productInputSchema),
    (input) => {
      const { id, ...rest } = input as { id: string; [key: string]: unknown };
      return catalog.updateProduct(id, rest as any);
    }
  );
  register(IPC_CHANNELS.catalog.products.activate, S.idPayloadSchema, (input) => catalog.activateProduct(asIdInput(input).id));
  register(IPC_CHANNELS.catalog.products.deactivate, S.idPayloadSchema, (input) => catalog.deactivateProduct(asIdInput(input).id));
  register(IPC_CHANNELS.catalog.products.delete, S.idPayloadSchema, (input) => catalog.deleteProduct(asIdInput(input).id));

  // Variants
  register(IPC_CHANNELS.catalog.variants.list, variantListQuerySchema, (q) => catalog.listVariants(q as any));
  register(IPC_CHANNELS.catalog.variants.get, S.idPayloadSchema, (input) => catalog.getVariant(asIdInput(input).id));
  register(IPC_CHANNELS.catalog.variants.create, S.createVariantInputSchema, (i) => catalog.createVariant(i as any));
  register(
    IPC_CHANNELS.catalog.variants.update,
    S.updateVariantInputSchema,
    (i) => catalog.updateVariant(i as any)
  );
  register(IPC_CHANNELS.catalog.variants.activate, S.idPayloadSchema, (input) => catalog.activateVariant(asIdInput(input)));
  register(IPC_CHANNELS.catalog.variants.deactivate, S.idPayloadSchema, (input) => catalog.deactivateVariant(asIdInput(input)));
  register(IPC_CHANNELS.catalog.variants.delete, S.idPayloadSchema, (input) => catalog.deleteVariant(asIdInput(input)));

  // Packaging
  register(IPC_CHANNELS.catalog.packaging.list, packagingListQuerySchema, (q) => catalog.listPackaging(q as any));
  register(IPC_CHANNELS.catalog.packaging.add, S.addPackagingInputSchema, (i) => catalog.addPackaging(i as any));
  register(IPC_CHANNELS.catalog.packaging.update, S.updatePackagingInputSchema, (i) => catalog.updatePackaging(i as any));
  register(IPC_CHANNELS.catalog.packaging.activate, S.idPayloadSchema, (input) => catalog.activatePackaging(asIdInput(input)));
  register(IPC_CHANNELS.catalog.packaging.deactivate, S.idPayloadSchema, (input) => catalog.deactivatePackaging(asIdInput(input)));
  register(IPC_CHANNELS.catalog.packaging.delete, S.idPayloadSchema, (input) => catalog.deletePackaging(asIdInput(input)));

  // Barcodes
  register(IPC_CHANNELS.catalog.barcodes.list, S.pageQuerySchema, (q) => catalog.listBarcodes(q as any));
  register(IPC_CHANNELS.catalog.barcodes.add, S.addBarcodeInputSchema, (i) => catalog.addBarcode(i as any));
  register(IPC_CHANNELS.catalog.barcodes.delete, S.idPayloadSchema, (input) => catalog.deleteBarcode(asIdInput(input)));
  register(IPC_CHANNELS.catalog.barcodes.find, barcodeCodeSchema, ({ code }) => catalog.findProductByBarcode(String(code)));
  register(IPC_CHANNELS.catalog.barcodes.label, barcodeCodeSchema, ({ code }) => catalog.prepareBarcodeLabel(String(code)));

  // Media
  register(IPC_CHANNELS.catalog.media.read, S.mediaReadSchema, ({ relativePath }) =>
    catalog.readImage(String(relativePath))
  );

  logger.info("Catalog IPC handlers registered");
}
