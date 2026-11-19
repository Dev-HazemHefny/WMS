export type RecordStatus = "active" | "inactive";
export type ProductType = "simple" | "with_variants";
export type PackagingOwnerType = "product" | "variant";
export type UnitDimension = "count" | "mass" | "volume" | "length" | "area" | "other";

export interface PageQuery {
  search?: string;
  status?: RecordStatus;
  page: number;
  pageSize: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Category {
  id: string;
  name: string;
  code: string;
  description: string | null;
  parentId: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}

export interface Unit {
  id: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  description: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Brand {
  id: string;
  name: string;
  code: string;
  description: string | null;
  imagePath: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  categoryId: string;
  baseUnitId: string;
  description: string | null;
  imagePath: string | null;
  brandId: string | null;
  productType: ProductType;
  allowDecimalQuantity: boolean;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListItem {
  id: string;
  name: string;
  sku: string;
  categoryName: string;
  brandName: string | null;
  baseUnitName: string;
  baseUnitSymbol: string;
  productType: ProductType;
  status: RecordStatus;
  updatedAt: string;
}

export interface ProductLookup {
  id: string;
  name: string;
  sku: string;
  productType: ProductType;
  status: RecordStatus;
  baseUnitId: string;
}

export interface VariantAttribute {
  id: string;
  name: string;
  value: string;
}

export interface PackagingUnit {
  id: string;
  ownerType: PackagingOwnerType;
  ownerId: string;
  unitId: string;
  numerator: number;
  denominator: number;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PackagingView {
  id: string;
  ownerType: PackagingOwnerType;
  ownerId: string;
  unitId: string;
  unitName: string;
  unitSymbol: string;
  numerator: number;
  denominator: number;
  factorLabel: string;
  status: RecordStatus;
}

export interface PackagingListItem extends PackagingView {
  ownerName: string;
  productId: string;
  productName: string;
}

export interface Barcode {
  id: string;
  code: string;
  productId: string | null;
  variantId: string | null;
  productPackagingUnitId: string | null;
  variantPackagingUnitId: string | null;
  createdAt: string;
}

export interface BarcodeView {
  id: string;
  code: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  packagingLabel: string | null;
  productPackagingUnitId: string | null;
  variantPackagingUnitId: string | null;
  createdAt: string;
}

export interface VariantView {
  id: string;
  productId: string;
  sku: string;
  name: string;
  baseUnitId: string;
  baseUnitName: string;
  baseUnitSymbol: string;
  status: RecordStatus;
  attributes: VariantAttribute[];
  packaging: PackagingView[];
  barcodes: BarcodeView[];
}

export interface VariantListItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  name: string;
  attributeSummary: string;
  status: RecordStatus;
  baseUnitName: string;
}

export interface ProductDetails {
  product: Product;
  categoryName: string;
  brandName: string | null;
  baseUnitName: string;
  baseUnitSymbol: string;
  packaging: PackagingView[];
  variants: VariantView[];
  barcodes: BarcodeView[];
}

export interface BarcodeMatch {
  barcode: BarcodeView;
  product: ProductDetails;
}

export interface BarcodeLabel {
  code: string;
  productName: string;
  sku: string;
  variantName: string | null;
  attributeSummary: string | null;
  unitLabel: string | null;
}

export interface CategoryInput {
  name: string;
  code: string;
  description?: string | null;
  parentId?: string | null;
}

export interface UnitInput {
  name: string;
  symbol: string;
  dimension: UnitDimension;
  description?: string | null;
}

export interface BrandInput {
  name: string;
  code: string;
  description?: string | null;
  imageDataUrl?: string | null;
}

export interface PackagingDraft {
  unitId: string;
  conversionFactor: string;
}

export interface BarcodeDraft {
  code: string;
  packagingUnitId?: string | null;
}

export interface VariantDraft {
  name: string;
  sku: string;
  baseUnitId?: string | null;
  attributes: Array<{ name: string; value: string }>;
  packaging?: PackagingDraft[];
  barcodes?: BarcodeDraft[];
}

export interface ProductInput {
  name: string;
  sku: string;
  categoryId: string;
  baseUnitId: string;
  description?: string | null;
  imageDataUrl?: string | null;
  brandId?: string | null;
  productType: ProductType;
  allowDecimalQuantity: boolean;
  packaging?: PackagingDraft[];
  barcodes?: BarcodeDraft[];
  variants?: VariantDraft[];
}

export interface ProductListQuery extends PageQuery {
  categoryId?: string;
  brandId?: string;
  productType?: ProductType;
}

export interface VariantListQuery extends PageQuery {
  productId?: string;
}

export interface PackagingListQuery extends PageQuery {
  productId?: string;
}

export interface IdPayload {
  id: string;
}

export interface AddPackagingInput {
  ownerType: PackagingOwnerType;
  ownerId: string;
  unitId: string;
  conversionFactor: string;
}

export interface UpdatePackagingInput {
  id: string;
  unitId: string;
  conversionFactor: string;
}

export interface AddBarcodeInput {
  code: string;
  productId?: string | null;
  variantId?: string | null;
  packagingUnitId?: string | null;
}

export interface CreateVariantInput {
  productId: string;
  name: string;
  sku: string;
  baseUnitId?: string | null;
  attributes: Array<{ name: string; value: string }>;
}

export interface UpdateVariantInput {
  id: string;
  name: string;
  sku: string;
  baseUnitId: string;
  attributes: Array<{ name: string; value: string }>;
}
