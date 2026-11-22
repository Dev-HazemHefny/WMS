import { bind } from "./dispatch";
import type { Identity } from "@core/identity/application/identity";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { CatalogUseCases } from "@core/catalog/infrastructure/create-sqlite-catalog";
import * as S from "@shared/ipc/schemas";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import { createLogger } from "../logger";

const logger = createLogger("ipc:catalog");
const noInputSchema = z.undefined();

type CatalogApi = import("@shared/ipc/contracts").WarehouseApi["catalog"];
type ChannelMethod<C extends string> =
  C extends `catalog:${infer M extends keyof CatalogApi}:${infer A}`
    ? A extends keyof CatalogApi[M]
      ? CatalogApi[M][A]
      : never
    : never;
type Response<C extends string> =
  ChannelMethod<C> extends (...args: never[]) => Promise<infer R> ? R : never;
function updateSchema<T extends z.ZodRawShape>(base: z.ZodObject<T>) {
  return z.object({ id: z.string().min(1, "المعرف مطلوب"), ...base.shape });
}

const productListQuerySchema = S.pageQuerySchema.extend({
  categoryId: z.string().nullish().transform(value => value ?? undefined),
  brandId: z.string().nullish().transform(value => value ?? undefined),
  productType: z.enum(["simple", "with_variants"]).nullish().transform(value => value ?? undefined),
});

const variantListQuerySchema = S.pageQuerySchema.extend({
  productId: z.string().nullish().transform(value => value ?? undefined),
});

const packagingListQuerySchema = S.pageQuerySchema.extend({
  productId: z.string().nullish().transform(value => value ?? undefined),
});

const barcodeCodeSchema = z.object({
  code: z.string().min(1, "قيمة الباركود مطلوبة"),
});

export function registerCatalogHandlers(
  catalog: CatalogUseCases,
  identity: Identity,
  db: Database.Database,
): void {
  function register<C extends string, S extends z.ZodTypeAny>(
    channel: C,
    schema: S,
    execute: (input: z.output<S>) => Response<NoInfer<C>>,
  ): void {
    bind(channel, schema, (input, window) => {
      const actor = identity.actor(window);
      const mutation =
        /[.:](create|update|delete|add|activate|deactivate)$/.test(channel);
      identity.authorize(actor, mutation ? "catalog" : "read");
      if (!mutation) return execute(input);
      return db.transaction(() => {
        const result = execute(input);
        db.prepare("INSERT INTO audit(actor,action,target) VALUES(?,?,?)").run(
          actor,
          channel,
          input?.id ??
            (result && typeof result === "object" && "id" in result
              ? result.id
              : "catalog"),
        );
        return result;
      })();
    });
  }

  // Categories
  register(IPC_CHANNELS.catalog.categories.list, S.pageQuerySchema, (q) =>
    catalog.listCategories(q),
  );
  register(IPC_CHANNELS.catalog.categories.lookup, noInputSchema, () =>
    catalog.lookupCategories(),
  );
  register(IPC_CHANNELS.catalog.categories.tree, noInputSchema, () =>
    catalog.listCategoryTree(),
  );
  register(IPC_CHANNELS.catalog.categories.create, S.categoryInputSchema, (i) =>
    catalog.createCategory(i),
  );
  register(
    IPC_CHANNELS.catalog.categories.update,
    updateSchema(S.categoryInputSchema),
    ({ id, ...rest }) => catalog.updateCategory(id, rest),
  );
  register(
    IPC_CHANNELS.catalog.categories.activate,
    S.idPayloadSchema,
    ({ id }) => catalog.activateCategory(id),
  );
  register(
    IPC_CHANNELS.catalog.categories.deactivate,
    S.idPayloadSchema,
    ({ id }) => catalog.deactivateCategory(id),
  );
  register(
    IPC_CHANNELS.catalog.categories.delete,
    S.idPayloadSchema,
    ({ id }) => catalog.deleteCategory(id),
  );

  // Units
  register(IPC_CHANNELS.catalog.units.list, S.pageQuerySchema, (q) =>
    catalog.listUnits(q),
  );
  register(IPC_CHANNELS.catalog.units.lookup, noInputSchema, () =>
    catalog.lookupUnits(),
  );
  register(IPC_CHANNELS.catalog.units.create, S.unitInputSchema, (i) =>
    catalog.createUnit(i),
  );
  register(
    IPC_CHANNELS.catalog.units.update,
    updateSchema(S.unitInputSchema),
    ({ id, ...rest }) => catalog.updateUnit(id, rest),
  );
  register(IPC_CHANNELS.catalog.units.activate, S.idPayloadSchema, ({ id }) =>
    catalog.activateUnit(id),
  );
  register(IPC_CHANNELS.catalog.units.deactivate, S.idPayloadSchema, ({ id }) =>
    catalog.deactivateUnit(id),
  );
  register(IPC_CHANNELS.catalog.units.delete, S.idPayloadSchema, ({ id }) =>
    catalog.deleteUnit(id),
  );

  // Brands
  register(IPC_CHANNELS.catalog.brands.list, S.pageQuerySchema, (q) =>
    catalog.listBrands(q),
  );
  register(IPC_CHANNELS.catalog.brands.lookup, noInputSchema, () =>
    catalog.lookupBrands(),
  );
  register(IPC_CHANNELS.catalog.brands.create, S.brandInputSchema, (i) =>
    catalog.createBrand(i),
  );
  register(
    IPC_CHANNELS.catalog.brands.update,
    updateSchema(S.brandInputSchema),
    ({ id, ...rest }) => catalog.updateBrand(id, rest),
  );
  register(IPC_CHANNELS.catalog.brands.activate, S.idPayloadSchema, ({ id }) =>
    catalog.activateBrand(id),
  );
  register(
    IPC_CHANNELS.catalog.brands.deactivate,
    S.idPayloadSchema,
    ({ id }) => catalog.deactivateBrand(id),
  );
  register(IPC_CHANNELS.catalog.brands.delete, S.idPayloadSchema, ({ id }) =>
    catalog.deleteBrand(id),
  );

  // Products
  register(IPC_CHANNELS.catalog.products.list, productListQuerySchema, (q) =>
    catalog.listProducts(q),
  );
  register(IPC_CHANNELS.catalog.products.lookup, noInputSchema, () =>
    catalog.lookupProducts(),
  );
  register(IPC_CHANNELS.catalog.products.get, S.idPayloadSchema, (input) =>
    catalog.getProduct(String(input.id)),
  );
  register(IPC_CHANNELS.catalog.products.create, S.productInputSchema, (i) =>
    catalog.createProduct(i),
  );
  register(
    IPC_CHANNELS.catalog.products.update,
    updateSchema(S.productInputSchema),
    ({ id, ...rest }) => catalog.updateProduct(id, rest),
  );
  register(
    IPC_CHANNELS.catalog.products.activate,
    S.idPayloadSchema,
    ({ id }) => catalog.activateProduct(id),
  );
  register(
    IPC_CHANNELS.catalog.products.deactivate,
    S.idPayloadSchema,
    ({ id }) => catalog.deactivateProduct(id),
  );
  register(IPC_CHANNELS.catalog.products.delete, S.idPayloadSchema, ({ id }) =>
    catalog.deleteProduct(id),
  );

  // Variants
  register(IPC_CHANNELS.catalog.variants.list, variantListQuerySchema, (q) =>
    catalog.listVariants(q),
  );
  register(IPC_CHANNELS.catalog.variants.get, S.idPayloadSchema, (input) =>
    catalog.getVariant(String(input.id)),
  );
  register(
    IPC_CHANNELS.catalog.variants.create,
    S.createVariantInputSchema,
    (i) => catalog.createVariant(i),
  );
  register(
    IPC_CHANNELS.catalog.variants.update,
    S.updateVariantInputSchema,
    (i) => catalog.updateVariant(i),
  );
  register(
    IPC_CHANNELS.catalog.variants.activate,
    S.idPayloadSchema,
    ({ id }) => catalog.activateVariant({ id }),
  );
  register(
    IPC_CHANNELS.catalog.variants.deactivate,
    S.idPayloadSchema,
    ({ id }) => catalog.deactivateVariant({ id }),
  );
  register(IPC_CHANNELS.catalog.variants.delete, S.idPayloadSchema, ({ id }) =>
    catalog.deleteVariant({ id }),
  );

  // Packaging
  register(IPC_CHANNELS.catalog.packaging.list, packagingListQuerySchema, (q) =>
    catalog.listPackaging(q),
  );
  register(IPC_CHANNELS.catalog.packaging.add, S.addPackagingInputSchema, (i) =>
    catalog.addPackaging(i),
  );
  register(
    IPC_CHANNELS.catalog.packaging.update,
    S.updatePackagingInputSchema,
    (i) => catalog.updatePackaging(i),
  );
  register(
    IPC_CHANNELS.catalog.packaging.activate,
    S.idPayloadSchema,
    ({ id }) => catalog.activatePackaging({ id }),
  );
  register(
    IPC_CHANNELS.catalog.packaging.deactivate,
    S.idPayloadSchema,
    ({ id }) => catalog.deactivatePackaging({ id }),
  );
  register(IPC_CHANNELS.catalog.packaging.delete, S.idPayloadSchema, ({ id }) =>
    catalog.deletePackaging({ id }),
  );

  // Barcodes
  register(IPC_CHANNELS.catalog.barcodes.list, S.pageQuerySchema, (q) =>
    catalog.listBarcodes(q),
  );
  register(IPC_CHANNELS.catalog.barcodes.add, S.addBarcodeInputSchema, (i) =>
    catalog.addBarcode(i),
  );
  register(IPC_CHANNELS.catalog.barcodes.delete, S.idPayloadSchema, ({ id }) =>
    catalog.deleteBarcode({ id }),
  );
  register(IPC_CHANNELS.catalog.barcodes.find, barcodeCodeSchema, ({ code }) =>
    catalog.findProductByBarcode(String(code)),
  );
  register(IPC_CHANNELS.catalog.barcodes.label, barcodeCodeSchema, ({ code }) =>
    catalog.prepareBarcodeLabel(String(code)),
  );

  // Media
  register(
    IPC_CHANNELS.catalog.media.read,
    S.mediaReadSchema,
    ({ relativePath }) => catalog.readImage(String(relativePath)),
  );

  logger.info("Catalog IPC handlers registered");
}
