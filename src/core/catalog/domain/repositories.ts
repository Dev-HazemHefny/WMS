import type {
  Barcode,
  BarcodeView,
  Brand,
  Category,
  PackagingListItem,
  PackagingListQuery,
  PackagingUnit,
  PackagingView,
  Page,
  PageQuery,
  Product,
  ProductListItem,
  ProductListQuery,
  ProductLookup,
  Unit,
  VariantAttribute,
  VariantListItem,
  VariantListQuery
} from "../../../shared/catalog/types";

export interface CategoryRepository {
  insert(category: Category): void;
  update(category: Category): void;
  delete(id: string): void;
  findById(id: string): Category | null;
  findByCode(code: string): Category | null;
  list(query: PageQuery): Page<Category>;
  listAll(): Category[];
  countProducts(id: string): number;
  countChildren(id: string): number;
}

export interface UnitRepository {
  insert(unit: Unit): void;
  update(unit: Unit): void;
  delete(id: string): void;
  findById(id: string): Unit | null;
  findByName(name: string): Unit | null;
  findBySymbol(symbol: string): Unit | null;
  list(query: PageQuery): Page<Unit>;
  listAll(): Unit[];
  countUsage(id: string): number;
}

export interface BrandRepository {
  insert(brand: Brand): void;
  update(brand: Brand): void;
  delete(id: string): void;
  findById(id: string): Brand | null;
  findByCode(code: string): Brand | null;
  list(query: PageQuery): Page<Brand>;
  listAll(): Brand[];
  countProducts(id: string): number;
}

export interface ProductRepository {
  insert(product: Product): void;
  update(product: Product): void;
  delete(id: string): void;
  findById(id: string): Product | null;
  list(query: ProductListQuery): Page<ProductListItem>;
  lookup(): ProductLookup[];
  countDependents(id: string): { variants: number; barcodes: number; packaging: number };
  skuOwner(sku: string): { ownerType: "product" | "variant"; ownerId: string } | null;
}

export interface StoredVariant {
  id: string;
  productId: string;
  sku: string;
  name: string;
  baseUnitId: string;
  attributesSignature: string;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
  attributes: VariantAttribute[];
}

export interface VariantRepository {
  insert(variant: StoredVariant): void;
  update(variant: StoredVariant): void;
  delete(id: string): void;
  findById(id: string): StoredVariant | null;
  listByProduct(productId: string): StoredVariant[];
  list(query: VariantListQuery): Page<VariantListItem>;
  findBySignature(productId: string, signature: string): string | null;
  countDependents(id: string): { barcodes: number; packaging: number };
}

export interface PackagingRepository {
  insert(unit: PackagingUnit): void;
  update(unit: PackagingUnit): void;
  delete(id: string): void;
  findById(id: string): PackagingUnit | null;
  listForOwner(ownerType: "product" | "variant", ownerId: string): PackagingView[];
  list(query: PackagingListQuery): Page<PackagingListItem>;
  findByOwnerAndUnit(ownerType: "product" | "variant", ownerId: string, unitId: string): PackagingUnit | null;
  countBarcodeLinks(id: string): number;
  hasFractionalForProduct(productId: string): boolean;
}

export interface BarcodeRepository {
  insert(barcode: Barcode): void;
  delete(id: string): void;
  findById(id: string): Barcode | null;
  findByCode(code: string): Barcode | null;
  list(query: PageQuery): Page<BarcodeView>;
  listForProduct(productId: string): BarcodeView[];
  listForVariant(variantId: string): BarcodeView[];
  findViewByCode(code: string): BarcodeView | null;
}
