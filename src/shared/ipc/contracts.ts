import type { StockCommand, StockResult } from "./stock";
import type {
  BarcodeLabel,
  BarcodeView,
  Brand,
  Category,
  CategoryTreeNode,
  PackagingListItem,
  PackagingView,
  Page,
  Product,
  ProductDetails,
  ProductListItem,
  ProductLookup,
  Unit,
  UnitDimension,
  VariantListItem,
  VariantView
} from "../catalog/types";

export interface AppInfo {
  appName: string;
  databaseReady: boolean;
}

export interface WarehouseApi {
  identity:{ add(input:{name:string;password:string;roles:("admin"|"clerk"|"supervisor")[]}):Promise<void>; setupRequired():Promise<boolean>; login(input:{name:string;password:string;setup:boolean}):Promise<void>; logout():Promise<void> };
  recovery:{backup():Promise<string|null>;restore():Promise<string|null>};
  inventory:{ execute(command:StockCommand):Promise<StockResult> };
  system: {
    getAppInfo(): Promise<AppInfo>;
  };
  catalog: {
    categories: {
      list(args: {
        search?: string | null;
        status?: "active" | "inactive" | null;
        page: number;
        pageSize: number;
      }): Promise<Page<Category>>;
      lookup(): Promise<Category[]>;
      tree(): Promise<CategoryTreeNode[]>;
      create(args: {
        name: string;
        code: string;
        description?: string | null;
        parentId?: string | null;
      }): Promise<Category>;
      update(args: {
        id: string;
        name: string;
        code: string;
        description?: string | null;
        parentId?: string | null;
      }): Promise<Category>;
      activate(args: { id: string }): Promise<Category>;
      deactivate(args: { id: string }): Promise<Category>;
      delete(args: { id: string }): Promise<void>;
    };
    units: {
      list(args: {
        search?: string | null;
        status?: "active" | "inactive" | null;
        page: number;
        pageSize: number;
      }): Promise<Page<Unit>>;
      lookup(): Promise<Unit[]>;
      create(args: { name: string; symbol: string; dimension: UnitDimension; description?: string | null }): Promise<Unit>;
      update(args: {
        id: string;
        name: string;
        symbol: string;
        dimension: UnitDimension;
        description?: string | null;
      }): Promise<Unit>;
      activate(args: { id: string }): Promise<Unit>;
      deactivate(args: { id: string }): Promise<Unit>;
      delete(args: { id: string }): Promise<void>;
    };
    brands: {
      list(args: {
        search?: string | null;
        status?: "active" | "inactive" | null;
        page: number;
        pageSize: number;
      }): Promise<Page<Brand>>;
      lookup(): Promise<Brand[]>;
      create(args: {
        name: string;
        code: string;
        description?: string | null;
        imageDataUrl?: string | null;
      }): Promise<Brand>;
      update(args: {
        id: string;
        name: string;
        code: string;
        description?: string | null;
        imageDataUrl?: string | null;
      }): Promise<Brand>;
      activate(args: { id: string }): Promise<Brand>;
      deactivate(args: { id: string }): Promise<Brand>;
      delete(args: { id: string }): Promise<void>;
    };
    products: {
      list(args: {
        search?: string | null;
        status?: "active" | "inactive" | null;
        page: number;
        pageSize: number;
        categoryId?: string | null;
        brandId?: string | null;
        productType?: "simple" | "with_variants" | null;
      }): Promise<Page<ProductListItem>>;
      lookup(): Promise<ProductLookup[]>;
      get(args: { id: string }): Promise<ProductDetails>;
      create(args: {
        name: string;
        sku: string;
        categoryId: string;
        baseUnitId: string;
        description?: string | null;
        imageDataUrl?: string | null;
        brandId?: string | null;
        productType: "simple" | "with_variants";
        allowDecimalQuantity: boolean;
        packaging?: Array<{ unitId: string; conversionFactor: string }>;
        barcodes?: Array<{ code: string; packagingUnitId?: string | null }>;
        variants?: Array<{
          name: string;
          sku: string;
          baseUnitId?: string | null;
          attributes: Array<{ name: string; value: string }>;
          packaging?: Array<{ unitId: string; conversionFactor: string }>;
          barcodes?: Array<{ code: string; packagingUnitId?: string | null }>;
        }>;
      }): Promise<ProductDetails>;
      update(args: {
        id: string;
        name: string;
        sku: string;
        categoryId: string;
        baseUnitId: string;
        description?: string | null;
        imageDataUrl?: string | null;
        brandId?: string | null;
        productType: "simple" | "with_variants";
        allowDecimalQuantity: boolean;
      }): Promise<ProductDetails>;
      activate(args: { id: string }): Promise<Product>;
      deactivate(args: { id: string }): Promise<Product>;
      delete(args: { id: string }): Promise<void>;
    };
    variants: {
      list(args: {
        search?: string | null;
        status?: "active" | "inactive" | null;
        page: number;
        pageSize: number;
        productId?: string | null;
      }): Promise<Page<VariantListItem>>;
      get(args: { id: string }): Promise<VariantView>;
      create(args: {
        productId: string;
        name: string;
        sku: string;
        baseUnitId?: string | null;
        attributes: Array<{ name: string; value: string }>;
      }): Promise<VariantView>;
      update(args: {
        id: string;
        name: string;
        sku: string;
        baseUnitId: string;
        attributes: Array<{ name: string; value: string }>;
      }): Promise<VariantView>;
      activate(args: { id: string }): Promise<VariantView>;
      deactivate(args: { id: string }): Promise<VariantView>;
      delete(args: { id: string }): Promise<void>;
    };
    packaging: {
      list(args: {
        search?: string | null;
        status?: "active" | "inactive" | null;
        page: number;
        pageSize: number;
        productId?: string | null;
      }): Promise<Page<PackagingListItem>>;
      add(args: {
        ownerType: "product" | "variant";
        ownerId: string;
        unitId: string;
        conversionFactor: string;
      }): Promise<PackagingView>;
      update(args: {
        id: string;
        unitId: string;
        conversionFactor: string;
      }): Promise<PackagingView>;
      activate(args: { id: string }): Promise<PackagingView>;
      deactivate(args: { id: string }): Promise<PackagingView>;
      delete(args: { id: string }): Promise<void>;
    };
    barcodes: {
      list(args: {
        search?: string | null;
        status?: "active" | "inactive" | null;
        page: number;
        pageSize: number;
      }): Promise<Page<BarcodeView>>;
      add(args: {
        code: string;
        productId?: string | null;
        variantId?: string | null;
        packagingUnitId?: string | null;
      }): Promise<BarcodeView>;
      delete(args: { id: string }): Promise<void>;
      find(args: { code: string }): Promise<{ barcode: BarcodeView; product: ProductDetails }>;
      label(args: { code: string }): Promise<BarcodeLabel>;
    };
    media: {
      read(args: { relativePath: string }): Promise<string | null>;
    };
  };
}
