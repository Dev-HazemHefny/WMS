import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../../src/shared/ipc/channels";
import type { AppInfo, WarehouseApi } from "../../src/shared/ipc/contracts";
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
  VariantListItem,
  VariantView,
} from "../../src/shared/catalog/types";
import { ClientError } from "../../src/shared/ipc/client-error";
import type { IpcResult } from "../../src/shared/ipc/result";
import type { BranchDto, BranchDetailsDto, WarehouseDto, WarehouseDetailsDto, StorageLocationDto, ResolvedLocationDto, LocationPathDto, DefinitionPageDto } from "../../src/shared/warehouses/types";
import type { SessionCapabilities } from "../../src/shared/identity/types";

async function invoke<T>(channel: string, args?: unknown): Promise<T> {
  const result: IpcResult<T> = await ipcRenderer.invoke(channel, args);
  if (result.ok) return result.data;
  throw new ClientError(result.error.code, result.error.message);
}

const warehouseApi: WarehouseApi = {
  warehouses: {
    branches: {
      create: input => invoke<BranchDto>(IPC_CHANNELS.warehouses.branches.create,input),
      update: input => invoke<BranchDto>(IPC_CHANNELS.warehouses.branches.update,input),
      list: input => invoke<DefinitionPageDto<BranchDto>>(IPC_CHANNELS.warehouses.branches.list,input),
      get: input => invoke<BranchDetailsDto>(IPC_CHANNELS.warehouses.branches.get,input),
      listWarehouses: input => invoke<readonly WarehouseDto[]>(IPC_CHANNELS.warehouses.branches.listWarehouses,input),
      setStatus: input => invoke<BranchDto>(IPC_CHANNELS.warehouses.branches.setStatus,input),
    },
    warehouses: {
      create: input => invoke<WarehouseDto>(IPC_CHANNELS.warehouses.warehouses.create,input),
      update: input => invoke<WarehouseDto>(IPC_CHANNELS.warehouses.warehouses.update,input),
      list: input => invoke<DefinitionPageDto<WarehouseDto>>(IPC_CHANNELS.warehouses.warehouses.list,input),
      get: input => invoke<WarehouseDetailsDto>(IPC_CHANNELS.warehouses.warehouses.get,input),
      reassign: input => invoke<WarehouseDto>(IPC_CHANNELS.warehouses.warehouses.reassign,input),
      setStatus: input => invoke<WarehouseDto>(IPC_CHANNELS.warehouses.warehouses.setStatus,input),
    },
    locations: {
      create: input => invoke<StorageLocationDto>(IPC_CHANNELS.warehouses.locations.create,input),
      update: input => invoke<StorageLocationDto>(IPC_CHANNELS.warehouses.locations.update,input),
      list: input => invoke<DefinitionPageDto<StorageLocationDto>>(IPC_CHANNELS.warehouses.locations.list,input),
      get: input => invoke<ResolvedLocationDto>(IPC_CHANNELS.warehouses.locations.get,input),
      tree: input => invoke<readonly StorageLocationDto[]>(IPC_CHANNELS.warehouses.locations.tree,input),
      path: input => invoke<readonly LocationPathDto[]>(IPC_CHANNELS.warehouses.locations.path,input),
      stockable: input => invoke<readonly ResolvedLocationDto[]>(IPC_CHANNELS.warehouses.locations.stockable,input),
      reparent: input => invoke<StorageLocationDto>(IPC_CHANNELS.warehouses.locations.reparent,input),
      setStatus: input => invoke<StorageLocationDto>(IPC_CHANNELS.warehouses.locations.setStatus,input),
    },
  },
  identity: {
    getCapabilities: () => invoke<SessionCapabilities>(IPC_CHANNELS.identity.capabilities),
    add: (i) => invoke("identity:add", i),
    setupRequired: () => invoke("identity:setup"),
    login: (input) => invoke("identity:login", input),
    logout: () => invoke("identity:logout"),
  },
  recovery: {
    backup: () => invoke("recovery:backup"),
    restore: () => invoke("recovery:restore"),
  },
  inventory: {
    execute: command => invoke("inventory:execute", command),
    getStockBalance: input => invoke(IPC_CHANNELS.inventory.getStockBalance, input),
    getStockItemStock: input => invoke(IPC_CHANNELS.inventory.getStockItemStock, input),
    getWarehouseStock: input => invoke(IPC_CHANNELS.inventory.getWarehouseStock, input),
    getAvailableQuantity: input => invoke(IPC_CHANNELS.inventory.getAvailableQuantity, input),
    getInventoryHistory: input => invoke(IPC_CHANNELS.inventory.getInventoryHistory, input),
    verifyBalanceConsistency: input => invoke(IPC_CHANNELS.inventory.verifyBalanceConsistency, input),
  },
  system: {
    getAppInfo: () => invoke<AppInfo>(IPC_CHANNELS.system.getAppInfo),
  },
  catalog: {
    categories: {
      list: (args) =>
        invoke<Page<Category>>(IPC_CHANNELS.catalog.categories.list, args),
      lookup: () => invoke<Category[]>(IPC_CHANNELS.catalog.categories.lookup),
      tree: () =>
        invoke<CategoryTreeNode[]>(IPC_CHANNELS.catalog.categories.tree),
      create: (args) =>
        invoke<Category>(IPC_CHANNELS.catalog.categories.create, args),
      update: (args) =>
        invoke<Category>(IPC_CHANNELS.catalog.categories.update, args),
      activate: (args) =>
        invoke<Category>(IPC_CHANNELS.catalog.categories.activate, args),
      deactivate: (args) =>
        invoke<Category>(IPC_CHANNELS.catalog.categories.deactivate, args),
      delete: (args) =>
        invoke<void>(IPC_CHANNELS.catalog.categories.delete, args),
    },
    units: {
      list: (args) => invoke<Page<Unit>>(IPC_CHANNELS.catalog.units.list, args),
      lookup: () => invoke<Unit[]>(IPC_CHANNELS.catalog.units.lookup),
      create: (args) => invoke<Unit>(IPC_CHANNELS.catalog.units.create, args),
      update: (args) => invoke<Unit>(IPC_CHANNELS.catalog.units.update, args),
      activate: (args) =>
        invoke<Unit>(IPC_CHANNELS.catalog.units.activate, args),
      deactivate: (args) =>
        invoke<Unit>(IPC_CHANNELS.catalog.units.deactivate, args),
      delete: (args) => invoke<void>(IPC_CHANNELS.catalog.units.delete, args),
    },
    brands: {
      list: (args) =>
        invoke<Page<Brand>>(IPC_CHANNELS.catalog.brands.list, args),
      lookup: () => invoke<Brand[]>(IPC_CHANNELS.catalog.brands.lookup),
      create: (args) => invoke<Brand>(IPC_CHANNELS.catalog.brands.create, args),
      update: (args) => invoke<Brand>(IPC_CHANNELS.catalog.brands.update, args),
      activate: (args) =>
        invoke<Brand>(IPC_CHANNELS.catalog.brands.activate, args),
      deactivate: (args) =>
        invoke<Brand>(IPC_CHANNELS.catalog.brands.deactivate, args),
      delete: (args) => invoke<void>(IPC_CHANNELS.catalog.brands.delete, args),
    },
    products: {
      list: (args) =>
        invoke<Page<ProductListItem>>(IPC_CHANNELS.catalog.products.list, args),
      lookup: () =>
        invoke<ProductLookup[]>(IPC_CHANNELS.catalog.products.lookup),
      get: (args) =>
        invoke<ProductDetails>(IPC_CHANNELS.catalog.products.get, args),
      create: (args) =>
        invoke<ProductDetails>(IPC_CHANNELS.catalog.products.create, args),
      update: (args) =>
        invoke<ProductDetails>(IPC_CHANNELS.catalog.products.update, args),
      activate: (args) =>
        invoke<Product>(IPC_CHANNELS.catalog.products.activate, args),
      deactivate: (args) =>
        invoke<Product>(IPC_CHANNELS.catalog.products.deactivate, args),
      delete: (args) =>
        invoke<void>(IPC_CHANNELS.catalog.products.delete, args),
    },
    variants: {
      list: (args) =>
        invoke<Page<VariantListItem>>(IPC_CHANNELS.catalog.variants.list, args),
      get: (args) =>
        invoke<VariantView>(IPC_CHANNELS.catalog.variants.get, args),
      create: (args) =>
        invoke<VariantView>(IPC_CHANNELS.catalog.variants.create, args),
      update: (args) =>
        invoke<VariantView>(IPC_CHANNELS.catalog.variants.update, args),
      activate: (args) =>
        invoke<VariantView>(IPC_CHANNELS.catalog.variants.activate, args),
      deactivate: (args) =>
        invoke<VariantView>(IPC_CHANNELS.catalog.variants.deactivate, args),
      delete: (args) =>
        invoke<void>(IPC_CHANNELS.catalog.variants.delete, args),
    },
    packaging: {
      list: (args) =>
        invoke<Page<PackagingListItem>>(
          IPC_CHANNELS.catalog.packaging.list,
          args,
        ),
      add: (args) =>
        invoke<PackagingView>(IPC_CHANNELS.catalog.packaging.add, args),
      update: (args) =>
        invoke<PackagingView>(IPC_CHANNELS.catalog.packaging.update, args),
      activate: (args) =>
        invoke<PackagingView>(IPC_CHANNELS.catalog.packaging.activate, args),
      deactivate: (args) =>
        invoke<PackagingView>(IPC_CHANNELS.catalog.packaging.deactivate, args),
      delete: (args) =>
        invoke<void>(IPC_CHANNELS.catalog.packaging.delete, args),
    },
    barcodes: {
      list: (args) =>
        invoke<Page<BarcodeView>>(IPC_CHANNELS.catalog.barcodes.list, args),
      add: (args) =>
        invoke<BarcodeView>(IPC_CHANNELS.catalog.barcodes.add, args),
      delete: (args) =>
        invoke<void>(IPC_CHANNELS.catalog.barcodes.delete, args),
      find: (args) =>
        invoke<{ barcode: BarcodeView; product: ProductDetails }>(
          IPC_CHANNELS.catalog.barcodes.find,
          args,
        ),
      label: (args) =>
        invoke<BarcodeLabel>(IPC_CHANNELS.catalog.barcodes.label, args),
    },
    media: {
      read: (args) =>
        invoke<string | null>(IPC_CHANNELS.catalog.media.read, args),
    },
  },
};

contextBridge.exposeInMainWorld("warehouse", warehouseApi);

export type WarehouseApiExported = typeof warehouseApi;
