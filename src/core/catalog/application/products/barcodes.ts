import type {
  AddBarcodeInput,
  Barcode,
  BarcodeLabel,
  BarcodeMatch,
  BarcodeView,
  IdPayload,
  Page,
  PageQuery
} from "../../../../shared/catalog/types";
import { DomainError } from "../../domain/errors";
import { parseBarcode } from "../../domain/values";
import type { ProductContext } from "./context";

const SAFE_IMAGE_PATH = /^(products|brands)\/[a-zA-Z0-9.-]+$/;

export function createBarcodeUseCases(ctx: ProductContext) {
  const { deps, requireProduct, requireVariant, details, insertBarcode } = ctx;

  const findProductByBarcode = (code: string): BarcodeMatch => {
    const normalized = parseBarcode(code);
    const barcode = deps.barcodes.findViewByCode(normalized);
    if (!barcode) throw new DomainError("BARCODE_NOT_FOUND", "لا يوجد صنف بهذا الباركود");
    const productId = barcode.productId ?? deps.variants.findById(barcode.variantId ?? "")?.productId;
    if (!productId) throw new DomainError("PRODUCT_NOT_FOUND", "الصنف غير موجود");
    return { barcode, product: details(productId) };
  };

  return {
    listBarcodes(query: PageQuery): Page<BarcodeView> {
      return deps.barcodes.list(query);
    },
    addBarcode(input: AddBarcodeInput): Barcode {
      const productId = input.productId ?? null;
      const variantId = input.variantId ?? null;
      if ((productId ? 1 : 0) + (variantId ? 1 : 0) !== 1) {
        throw new DomainError("BARCODE_TARGET", "يجب ربط الباركود بصنف أو متغير واحد");
      }
      const variant = variantId ? requireVariant(variantId) : null;
      const product = variant ? requireProduct(variant.productId) : requireProduct(productId!);
      if (variant && variant.productId !== product.id) {
        throw new DomainError("VARIANT_MISMATCH", "المتغير لا يتبع هذا الصنف");
      }
      return insertBarcode(input.code, product, variantId, input.packagingUnitId ?? null);
    },
    deleteBarcode({ id }: IdPayload): void {
      if (!deps.barcodes.findById(id)) throw new DomainError("BARCODE_NOT_FOUND", "الباركود غير موجود");
      deps.barcodes.delete(id);
    },
    findProductByBarcode,
    prepareBarcodeLabel(code: string): BarcodeLabel {
      const match = findProductByBarcode(code);
      const variant = match.barcode.variantId
        ? match.product.variants.find((item) => item.id === match.barcode.variantId) ?? null
        : null;
      return {
        code: match.barcode.code,
        productName: match.product.product.name,
        sku: variant?.sku ?? match.product.product.sku,
        variantName: variant?.name ?? null,
        attributeSummary: variant
          ? variant.attributes.map((attribute) => `${attribute.name}: ${attribute.value}`).join("، ")
          : null,
        unitLabel: match.barcode.packagingLabel ?? `${match.product.baseUnitName} (${match.product.baseUnitSymbol})`
      };
    },
    readImage(relativePath: string): string | null {
      if (!SAFE_IMAGE_PATH.test(relativePath)) {
        throw new DomainError("INVALID_PATH", "مسار الصورة غير صالح");
      }
      return deps.images.read(relativePath);
    }
  };
}

export type BarcodeUseCases = ReturnType<typeof createBarcodeUseCases>;
