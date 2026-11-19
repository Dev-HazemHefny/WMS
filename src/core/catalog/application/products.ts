import { createBarcodeUseCases } from "./products/barcodes";
import { createProductContext, type ProductDependencies } from "./products/context";
import { createProductCrudUseCases } from "./products/crud";
import { createPackagingUseCases } from "./products/packaging";
import { createVariantUseCases } from "./products/variants";

/**
 * Product aggregate use cases.
 *
 * Each sub-service owns one concern (products, variants, packaging, barcodes)
 * and shares only the catalog context helpers. The public surface is unchanged
 * so existing IPC handlers keep working as before.
 */
export function createProductUseCases(deps: ProductDependencies) {
  const context = createProductContext(deps);
  return {
    ...createProductCrudUseCases(context),
    ...createVariantUseCases(context),
    ...createPackagingUseCases(context),
    ...createBarcodeUseCases(context)
  };
}

export type ProductUseCases = ReturnType<typeof createProductUseCases>;
export type { ProductDependencies } from "./products/context";
